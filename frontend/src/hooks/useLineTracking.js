/**
 * useLineTracking - for a selected shabad, works out which line is being sung
 * from the latest transcript chunks.
 *
 * The matching runs entirely in the browser via matchLine() (a port of the
 * backend matching.service). The verses and transcript are already on the
 * client, so there's nothing to fetch — this used to POST /api/voice/track-line
 * every ~190ms. Doing it locally removes the network from the hot loop:
 * ~1ms instead of a round-trip, no rate-limit, and it keeps following even
 * with the backend unreachable or wifi down (the gurudwara reality).
 */
import { useEffect, useRef, useState } from 'react';
import { matchLine } from '../utils/matchLine';
import { recordDecision } from '../utils/sessionRecorder';

export default function useLineTracking({
  shabadId,
  verses,
  transcript,
  active,
  anchorLineIndex = null,
  anchorVersion = 0,
  intervalMs = 190,
}) {
  const [lineIndex, setLineIndex] = useState(-1);
  const [confidence, setConfidence] = useState(0);
  const [tracked, setTracked] = useState(false);
  const [debug, setDebug] = useState({ status: 'idle' });

  const lineIndexRef = useRef(-1);
  const lastRunRef = useRef(0);
  const lastTailRef = useRef('');
  const timerRef = useRef(null);
  // Far-jump confirmation: a non-adjacent line move must be the best result
  // for two consecutive polls before the cursor commits. Repetitive banis
  // (Anand Sahib especially — many lines share words) momentarily score a
  // wrong far line high; without this the cursor flicks there and snaps back.
  const pendingFarRef = useRef(null); // { line, count }

  // Warmup window — when the open shabad changes (auto-advance, manual
  // navigation, etc.) we don't run line tracking for ~1.5s. This stops the
  // cursor from flailing while the live transcript still contains stale
  // words from the previous shabad.
  const warmupUntilRef = useRef(0);
  const prevShabadIdRef = useRef(null);
  const prevAnchorVersionRef = useRef(anchorVersion);

  useEffect(() => {
    if (prevShabadIdRef.current != null && shabadId !== prevShabadIdRef.current) {
      warmupUntilRef.current = Date.now() + 1500;
      lastTailRef.current = '';
      pendingFarRef.current = null;
      setLineIndex(-1);
      setConfidence(0);
      setTracked(false);
      setDebug({ status: 'warming-up', reason: 'shabad-changed', lineIndex: -1, confidence: 0 });
    }
    prevShabadIdRef.current = shabadId;
  }, [shabadId]);

  useEffect(() => {
    lineIndexRef.current = lineIndex;
  }, [lineIndex]);

  useEffect(() => {
    if (!Number.isFinite(Number(anchorVersion)) || anchorVersion === prevAnchorVersionRef.current) return;
    prevAnchorVersionRef.current = anchorVersion;
    if (!verses?.length) return;

    const next = Math.min(
      verses.length - 1,
      Math.max(0, Number(anchorLineIndex) || 0)
    );

    warmupUntilRef.current = Date.now() + 450;
    lastTailRef.current = '';
    pendingFarRef.current = null;
    lineIndexRef.current = next;
    setLineIndex(next);
    setConfidence(0);
    setTracked(false);
    setDebug({ status: 'manual-anchor', reason: 'line-selected', lineIndex: next, confidence: 0 });
  }, [anchorLineIndex, anchorVersion, verses?.length]);

  useEffect(() => {
    if (!active || !shabadId || !verses?.length) {
      setDebug((prev) => (prev?.status === 'idle' ? prev : { ...prev, status: 'idle' }));
      return undefined;
    }

    const text = (transcript || '').trim();
    if (text.length < 2) {
      setDebug((prev) => (
        prev?.status === 'listening' && prev?.reason === 'waiting-for-transcript'
          ? prev
          : { ...prev, status: 'listening', reason: 'waiting-for-transcript' }
      ));
      return undefined;
    }

    const run = () => {
      // Skip while warming up after a shabad change — gives the new
      // transcript a moment to refresh before tracking takes hold.
      if (Date.now() < warmupUntilRef.current) {
        setDebug((prev) => ({ ...prev, status: 'warming-up', reason: 'recent-shabad-change' }));
        return;
      }
      const latest = (transcript || '').trim();
      if (latest.length < 2) return;

      // Short tail (last 5 words). Kirtan lines are typically 4-8 words long;
      // a tail of 8 mixes words across the line boundary and lets the previous
      // line "win" for an extra round or two. 5 keeps the score dominated by
      // what's being sung right now, so the cursor moves within ~1-2 words of
      // a line change.
      const tail = latest.split(/\s+/).slice(-5).join(' ');
      if (tail === lastTailRef.current) return;
      lastTailRef.current = tail;
      lastRunRef.current = Date.now();

      // Local match — no network. ~1ms over a typical shabad's verses.
      const res = matchLine(verses, tail, { currentLine: lineIndexRef.current });
      const nextConfidence = Number(res.confidence || 0);
      const nextTracked = Boolean(res.tracked);
      setConfidence(nextConfidence);
      setTracked(nextTracked);
      setDebug({
        status: nextTracked ? 'tracked' : 'no-match',
        state: nextTracked ? 'accepted' : 'rejected',
        reason: nextTracked ? 'tracked-locally' : 'confidence-too-low',
        transcriptTail: tail,
        candidates: verses.length,
        currentLineIndex: lineIndexRef.current,
        lineIndex: Number(res.lineIndex ?? -1),
        confidence: nextConfidence,
        tracked: nextTracked,
        score: nextConfidence,
        target: {
          type: 'shabad',
          groupId: shabadId,
          localIndex: Number(res.lineIndex ?? -1),
        },
        distance: Number.isFinite(Number(res.lineIndex))
          ? Math.abs(Number(res.lineIndex) - Number(lineIndexRef.current))
          : null,
      });

      // Capture this decision for session record/replay (no-op unless the
      // user has started recording from the Voice debug panel).
      recordDecision({
        shabadId,
        verses,
        transcript: latest,
        tail,
        currentLine: lineIndexRef.current,
        lineIndex: res.lineIndex,
        confidence: nextConfidence,
        tracked: nextTracked,
        reason: nextTracked ? 'tracked-locally' : 'confidence-too-low',
      });

      // matchLine still returns its best-guess line when confidence is weak.
      // Keep that signal for the badge/status, but don't move the cursor
      // unless it's a real tracked match; otherwise a new Shabad can make the
      // open Shabad keep "navigating" on low scores.
      if (nextTracked) {
        const cur = lineIndexRef.current;
        const next = res.lineIndex;
        const distance = cur < 0 ? 0 : Math.abs(next - cur);
        if (cur < 0 || next === cur || distance <= 1) {
          // First lock, same line, or a smooth adjacent move — commit at once.
          pendingFarRef.current = null;
          setLineIndex(next);
        } else {
          // Far jump (≥2 lines). Require the SAME far line to win two polls in
          // a row before committing, so a momentary high score on a repeated
          // line doesn't yank the cursor away and back (the Anand Sahib jitter).
          const pending = pendingFarRef.current;
          if (pending && pending.line === next) {
            pending.count += 1;
            if (pending.count >= 2) {
              pendingFarRef.current = null;
              setLineIndex(next);
            }
          } else {
            pendingFarRef.current = { line: next, count: 1 };
            // Hold the cursor on the current line this poll.
          }
        }
      } else if (lineIndexRef.current < 0) {
        setLineIndex(-1);
      }
    };

    const elapsed = Date.now() - lastRunRef.current;
    if (elapsed >= intervalMs) {
      run();
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(run, intervalMs - elapsed);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [shabadId, verses, transcript, active, intervalMs]);

  return { lineIndex, confidence, tracked, status: debug?.status || 'idle', debug };
}
