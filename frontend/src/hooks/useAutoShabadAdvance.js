/**
 * useAutoShabadAdvance — first-letter based auto-advance, conservative mode.
 *
 * Strategy: only ever leave the open Shabad when we're QUITE sure the singer
 * has moved on. Better to wait a few extra words (or even a verse) than to
 * jump to the wrong Shabad mid-line. Tentative/probationary mode is gone —
 * after any advance the next jump faces the same strict thresholds.
 *
 * Stage 1 (local, no network): "are these initials anywhere in the open Shabad?"
 *   - Take first letter of each of the user's last 6 spoken words.
 *   - For each verse signature, allow up to TWO mismatched characters in a
 *     sliding window — generous so the singer's small mistranscriptions
 *     don't trigger a false miss.
 *   - Fallback: a strict 4-letter sub-window matching exactly anywhere.
 *   - Pass → singer is still here, do nothing.
 *
 * Stage 2 (backend, only after several consecutive misses):
 *   - Send recent words to /api/voice/suggest.
 *   - Top "other" Shabad must clear a high confidence floor.
 *   - If the current Shabad is also a respectable match, the new one must
 *     beat it by a large margin to override.
 *   - After firing, a long cooldown prevents rapid re-jumps.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { getMainVerse } from '../utils/gurmukhi';

const MIN_INITIALS_LEN = 5;          // need 5 letters before we even check
const RECENT_WORDS = 5;
const SUBWINDOW_LEN = 4;
const FUZZY_MISMATCH = 3;            // up to 3 wrong letters in fuzzy match
const QUERY_RECENT_WORDS = 8;

const ABSENT_CHECKS_TO_FIRE = 4;     // need 4 consecutive new-signature misses
const ABSENT_CHECKS_TO_FIRE_WHEN_UNTRACKED = 2;
const CONFIDENCE_TO_OPEN = 60;       // top other must be a strong match
const QUEUE_CONFIDENCE_TO_OPEN = 60;
const QUEUE_MIN_SCORE_GAP = 8;
const MIN_MARGIN_OVER_CURRENT = 10;  // and beat current's score by at least this
const CURRENT_STILL_OK = 70;         // if current ≥ 45 in suggestions, treat as ambiguous
const COOLDOWN_MS = 5000;            // long cooldown — no rapid re-jumps
const PRELOAD_QUEUE_LIMIT = 5;       // preload when Kirtan queue has fewer than 6 Shabads

const DANDA_RE = /[॥।]/;
const RAHAO_PREFIX_RE = /^ਰਹਾਉ/;

function firstLetters(text, takeLast) {
  const tokens = String(text || '')
    .trim()
    .split(/\s+/)
    .filter((t) => t && !DANDA_RE.test(t) && !RAHAO_PREFIX_RE.test(t));
  const recent = takeLast == null || takeLast >= tokens.length
    ? tokens
    : tokens.slice(-takeLast);
  return recent.map((w) => Array.from(w)[0] || '').join('');
}

function fuzzyContains(haystack, needle, maxMis) {
  if (needle.length === 0) return true;
  if (haystack.length < needle.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let mis = 0;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        mis += 1;
        if (mis > maxMis) break;
      }
    }
    if (mis <= maxMis) return true;
  }
  return false;
}

function isOnCurrentShabad(userInitials, verseSignatures, maxMis = FUZZY_MISMATCH) {
  // 2-mismatch tolerant search of the full user signature
  for (const vSig of verseSignatures) {
    if (fuzzyContains(vSig, userInitials, maxMis)) return true;
  }
  // 4-letter exact sub-window — catches verse-boundary crossings
  if (userInitials.length >= SUBWINDOW_LEN) {
    for (let i = 0; i <= userInitials.length - SUBWINDOW_LEN; i++) {
      const sub = userInitials.slice(i, i + SUBWINDOW_LEN);
      for (const vSig of verseSignatures) {
        if (vSig.includes(sub)) return true;
      }
    }
  }
  return false;
}

function orderedQueueCandidates(queueCandidates, currentShabadId) {
  const candidates = queueCandidates.filter((item) => String(item.shabadId) !== String(currentShabadId));
  const currentIndex = queueCandidates.findIndex((item) => String(item.shabadId) === String(currentShabadId));
  if (currentIndex < 0) return candidates;
  return [
    ...queueCandidates.slice(currentIndex + 1),
    ...queueCandidates.slice(0, currentIndex),
  ].filter((item) => item?.shabadId && String(item.shabadId) !== String(currentShabadId));
}

async function getQueueCacheEntry(item, queueCacheRef) {
  const key = String(item.shabadId);
  const cached = queueCacheRef.current.get(key);
  if (cached?.data) return cached;
  const data = await api.getShabad(item.shabadId);
  const next = {
    data,
    signatures: (data?.verses || []).map((v) => firstLetters(v?.gurmukhi || '')),
  };
  queueCacheRef.current.set(key, next);
  return next;
}

function candidateFromQueueData(item, data) {
  const mainVerse = getMainVerse(data?.verses, data?.meta);
  const firstVerse = data?.verses?.[0] || null;
  return {
    shabadId: data?.meta?.shabadId || item.shabadId,
    confidence: 88,
    gurmukhi: mainVerse?.gurmukhi || firstVerse?.gurmukhi || item.gurmukhi || '',
    mainGurmukhi: mainVerse?.gurmukhi || '',
    firstGurmukhi: firstVerse?.gurmukhi || item.firstGurmukhi || '',
    raag: data?.meta?.raag || item.raag || '',
    writer: data?.meta?.writer || item.writer || '',
    source: data?.meta?.source || item.source || '',
    pageNo: data?.meta?.pageNo || item.pageNo || null,
    queued: true,
    queueMatch: true,
    queueSessionId: item.queueSessionId || item.sessionId || 'kirtan',
    queueSessionLabel: item.queueSessionLabel || 'Kirtan queue',
  };
}

export default function useAutoShabadAdvance({
  active,
  transcript,
  currentShabadId,
  shabadVerses,
  queueEntries = [],
  currentLineTracked = false,
  currentLineConfidence = 0,
  onAdvance,
}) {
  const absentCountRef = useRef(0);
  const lastSignatureRef = useRef('');
  const cooldownUntilRef = useRef(0);
  const inFlightRef = useRef(false);
  const queueCacheRef = useRef(new Map());
  const [preloadedQueue, setPreloadedQueue] = useState(new Map());

  const verseSignatures = useMemo(
    () => (shabadVerses || []).map((v) => firstLetters(v?.gurmukhi || '')),
    [shabadVerses]
  );

  // Reset the miss counter when the open Shabad changes (new context).
  // Cooldown is intentionally NOT reset — after an advance fires, the long
  // cooldown carries across the navigation so the new shabad gets a quiet
  // window to settle before any further re-evaluation.
  useEffect(() => {
    absentCountRef.current = 0;
    lastSignatureRef.current = '';
  }, [currentShabadId]);

  const queueCandidates = useMemo(() => {
    const seen = new Set();
    return (Array.isArray(queueEntries) ? queueEntries : [])
      .filter((item) => item?.shabadId)
      .filter((item) => {
        const key = String(item.shabadId);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [queueEntries]);

  useEffect(() => {
    if (!active || queueCandidates.length === 0 || queueCandidates.length > PRELOAD_QUEUE_LIMIT) {
      setPreloadedQueue(new Map());
      return undefined;
    }

    let cancelled = false;
    const loadQueue = async () => {
      await Promise.all(queueCandidates.map(async (item) => {
        const key = String(item.shabadId);
        if (queueCacheRef.current.has(key)) return;
        try {
          const data = await api.getShabad(item.shabadId);
          queueCacheRef.current.set(key, {
            data,
            signatures: (data?.verses || []).map((v) => firstLetters(v?.gurmukhi || '')),
          });
        } catch {
          // Queue preload is best-effort; wider search remains the fallback.
        }
      }));
      if (!cancelled) setPreloadedQueue(new Map(queueCacheRef.current));
    };

    loadQueue();
    return () => { cancelled = true; };
  }, [active, queueCandidates]);

  useEffect(() => {
    if (!active || !currentShabadId || !verseSignatures.length || !onAdvance) return;
    if (inFlightRef.current || Date.now() < cooldownUntilRef.current) return;

    const recentInitials = firstLetters(transcript, RECENT_WORDS);
    if (recentInitials.length < MIN_INITIALS_LEN) {
      absentCountRef.current = 0;
      return;
    }

    if (recentInitials === lastSignatureRef.current) return;
    lastSignatureRef.current = recentInitials;

    const currentTrackerStrong = Boolean(currentLineTracked) && Number(currentLineConfidence || 0) >= 45;
    const currentInitialsStillMatch = isOnCurrentShabad(
      recentInitials,
      verseSignatures,
      currentTrackerStrong ? FUZZY_MISMATCH : 1
    );

    if (currentTrackerStrong || currentInitialsStillMatch) {
      absentCountRef.current = 0;
      return;
    }

    absentCountRef.current += 1;
    const checksToFire = currentTrackerStrong ? ABSENT_CHECKS_TO_FIRE : ABSENT_CHECKS_TO_FIRE_WHEN_UNTRACKED;
    if (absentCountRef.current < checksToFire) return;

    const allTokens = String(transcript || '').trim().split(/\s+/).filter(Boolean);
    const queryWords = allTokens.slice(-QUERY_RECENT_WORDS);
    if (queryWords.length < 4) return;
    const query = queryWords.join(' ');

    inFlightRef.current = true;

    const otherQueueCandidates = orderedQueueCandidates(queueCandidates, currentShabadId);

    const tryQueueFirst = async () => {
      const scored = await Promise.all(otherQueueCandidates.map(async (item, orderIndex) => {
        try {
          const cached = preloadedQueue.get(String(item.shabadId)) || await getQueueCacheEntry(item, queueCacheRef);
          const data = cached?.data;
          const verses = data?.verses || [];
          if (!verses.length) return null;

          const initialHit = cached?.signatures?.length
            ? isOnCurrentShabad(recentInitials, cached.signatures, 2)
            : false;
          const lineMatch = await api.trackLine(
            data?.meta?.shabadId || item.shabadId,
            query,
            verses,
            -1
          ).catch(() => null);
          const rawConfidence = Number(lineMatch?.confidence || 0);
          const tracked = Boolean(lineMatch?.tracked);
          const score =
            rawConfidence +
            (tracked ? 0 : -18) +
            (initialHit ? 8 : 0) +
            (orderIndex === 0 ? 5 : 0);

          return { item, data, score, rawConfidence, tracked, initialHit, orderIndex };
        } catch {
          return null;
        }
      }));

      const ranked = scored
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.orderIndex - b.orderIndex);
      const best = ranked[0];
      if (!best) return null;
      const secondScore = ranked[1]?.score ?? 0;
      const gap = best.score - secondScore;
      const confident =
        best.tracked &&
        best.rawConfidence >= QUEUE_CONFIDENCE_TO_OPEN &&
        (gap >= QUEUE_MIN_SCORE_GAP || best.score >= 78);

      if (!confident) return null;
      return candidateFromQueueData(best.item, best.data);
    };

    tryQueueFirst()
      .then((queuedMatch) => {
        if (queuedMatch?.shabadId) {
          cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
          absentCountRef.current = 0;
          onAdvance(queuedMatch);
          return null;
        }
        return api.suggestShabads(query, {});
      })
      .then((res) => {
        if (!res) return;
        const suggestions = Array.isArray(res?.suggestions) ? res.suggestions : [];
        const current = suggestions.find((s) =>
          s?.shabadId && String(s.shabadId) === String(currentShabadId)
        );
        const topOther = suggestions.find((s) =>
          s?.shabadId && String(s.shabadId) !== String(currentShabadId)
        );

        if (!topOther?.shabadId) return;
        const otherConf = Number(topOther.confidence || 0);
        const currentConf = Number(current?.confidence || 0);

        // Hard floor — top alternative must clear a high threshold.
        if (otherConf < CONFIDENCE_TO_OPEN) return;

        // If the current Shabad is also a respectable match, demand a clear
        // margin before overriding. A 70-vs-65 split means "passing
        // similarity" — keep singing on the current Shabad.
        if (currentConf >= CURRENT_STILL_OK && otherConf < currentConf + MIN_MARGIN_OVER_CURRENT) {
          return;
        }

        cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
        absentCountRef.current = 0;
        onAdvance(topOther);
      })
      .catch(() => {
        // best effort
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [
    active,
    transcript,
    currentShabadId,
    verseSignatures,
    queueCandidates,
    preloadedQueue,
    currentLineTracked,
    currentLineConfidence,
    onAdvance,
  ]);
}
