/**
 * useShabadMatching - asks the backend for matching shabads based on the
 * current voice transcript. It runs on a short interval using the latest
 * transcript instead of debouncing, so continuous singing does not postpone
 * live suggestions until there is silence.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

const STICKY_TTL_MS = 6000;     // keep a missing suggestion visible this long
const DECAY_PER_CYCLE = 6;      // confidence drop per round it stays missing
const MIN_CHANGE_CHARS = 2;     // ignore tiny interim-recognition churn
const ERROR_BACKOFF_MS = 1400;  // brief pause before retrying the same audio

export default function useShabadMatching(transcript, filters, {
  active = true, intervalMs = 450,
} = {}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);
  const latestRef = useRef({ transcript, filters, active });
  const inFlightRef = useRef(false);
  const lastQueryRef = useRef('');
  const errorBackoffUntilRef = useRef(0);

  // Map of shabadId -> { item, lastSeen } so we can keep recently-seen
  // suggestions visible across rounds.
  const stickyRef = useRef(new Map());

  useEffect(() => {
    latestRef.current = { transcript, filters, active };
  }, [transcript, filters, active]);

  useEffect(() => {
    if (!active) {
      setLoading(false);
      return undefined;
    }

    let stopped = false;

    const runMatch = async () => {
      if (stopped || inFlightRef.current) return;
      if (Date.now() < errorBackoffUntilRef.current) return;

      const {
        transcript: latestTranscript,
        filters: latestFilters,
        active: latestActive,
      } = latestRef.current;
      if (!latestActive) return;

      const text = (latestTranscript || '').trim();
      const words = text.split(/\s+/).filter(Boolean);
      // Backend's matchShabads requires >=2 tokens, so anything shorter just
      // wastes a round-trip that comes back empty (which manifested as the
      // "Matching…" loader spinning without ever producing suggestions).
      // Wait for two words before asking the backend at all.
      if (words.length < 2) {
        setSuggestions([]);
        stickyRef.current.clear();
        lastQueryRef.current = '';
        setLoading(false);
        return;
      }

      const queryKey = `${text.slice(-180)}|${JSON.stringify(latestFilters || {})}`;
      const previous = lastQueryRef.current;
      if (
        queryKey === previous ||
        (previous && Math.abs(queryKey.length - previous.length) < MIN_CHANGE_CHARS)
      ) {
        return;
      }
      lastQueryRef.current = queryKey;

      const myId = ++reqIdRef.current;
      inFlightRef.current = true;
      setLoading(true);

      try {
        const res = await api.suggestShabads(text, latestFilters);
        if (stopped || myId !== reqIdRef.current) return;

        const fresh = Array.isArray(res.suggestions) ? res.suggestions : [];
        const now = Date.now();
        const sticky = stickyRef.current;

        const seenIds = new Set();
        for (const s of fresh) {
          if (s?.shabadId == null) continue;
          seenIds.add(s.shabadId);
          sticky.set(s.shabadId, { item: { ...s, stale: false }, lastSeen: now });
        }

        for (const [id, entry] of sticky) {
          if (seenIds.has(id)) continue;
          if (now - entry.lastSeen > STICKY_TTL_MS) {
            sticky.delete(id);
          } else {
            entry.item = {
              ...entry.item,
              confidence: Math.max(0, (entry.item.confidence ?? 0) - DECAY_PER_CYCLE),
              stale: true,
            };
          }
        }

        const freshSorted = [...sticky.values()]
          .filter((e) => !e.item.stale)
          .map((e) => e.item)
          .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
        const stale = [...sticky.values()]
          .filter((e) => e.item.stale)
          .map((e) => e.item)
          .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

        // Show every suggestion the backend returned, sorted by confidence.
        // The percentage badge on each card surfaces how strong the match is.
        setSuggestions([...freshSorted, ...stale].slice(0, 8));
        setError(null);
        errorBackoffUntilRef.current = 0;
      } catch (err) {
        if (stopped || myId !== reqIdRef.current) return;
        // Do not permanently mark this transcript as handled. A single slow
        // BaniDB round should not make the mic appear dead until the user
        // sings more words.
        lastQueryRef.current = '';
        errorBackoffUntilRef.current = Date.now() + ERROR_BACKOFF_MS;
        setError(err?.response?.data?.error || err.message || 'Match failed');
      } finally {
        if (myId === reqIdRef.current) setLoading(false);
        inFlightRef.current = false;
      }
    };

    runMatch();
    const interval = setInterval(runMatch, intervalMs);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [active, intervalMs]);

  return { suggestions, loading, error };
}
