/**
 * useAutoShabadAdvance — first-letter based auto-advance, conservative mode.
 *
 * Strategy: only ever leave the open Shabad when we're QUITE sure the singer
 * has moved on. Better to wait a few extra words (or even a verse) than to
 * jump to the wrong Shabad mid-line. Tentative/probationary mode is gone —
 * after any advance the next jump faces the same strict thresholds.
 *
 * Stage 1 (local, no network): "are these initials anywhere in the open Shabad?"
 *   - Check the last five spoken initials, allowing one mistranscription.
 *   - Fallback: a strict 4-letter sub-window matching exactly anywhere.
 *   - Pass → singer is still here, do nothing.
 *
 * Stage 2 (backend, only after several consecutive misses):
 *   - Send recent words to /api/voice/suggest.
 *   - Top "other" Shabad must clear a high confidence floor.
 *   - Always require a clear lead over current and competing candidates.
 *   - Confirm the same candidate on two fresh, separated observations.
 *   - Auto-hold freezes the display, but does not disable discovery.
 *   - After firing, a long cooldown prevents rapid re-jumps.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import { getMainVerse } from '../utils/gurmukhi';
import { matchLine } from '../utils/matchLine';
import { recordEvent } from '../utils/sessionRecorder';

const MIN_INITIALS_LEN = 5;          // need 5 letters before we even check
const RECENT_WORDS = 5;
const SUBWINDOW_LEN = 4;
const FUZZY_MISMATCH = 1;
const QUERY_RECENT_WORDS = 8;

const ABSENT_CHECKS_TO_FIRE = 2;
const CONFIDENCE_TO_OPEN = 60;       // top other must be a strong match
const QUEUE_CONFIDENCE_TO_OPEN = 60;
const QUEUE_MIN_SCORE_GAP = 8;
const MIN_MARGIN_OVER_CURRENT = 10;  // and beat current's score by at least this
const MIN_CANDIDATE_GAP = 8;
const CONFIRMATION_INTERVAL_MS = 1200;
const EVIDENCE_MAX_AGE_MS = 4000;
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
  // Mismatch-tolerant search of the full user signature.
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
  navigationBlocked = false,
  anchorVersion = 0,
  onAdvance,
}) {
  const absentCountRef = useRef(0);
  const lastSignatureRef = useRef('');
  const cooldownUntilRef = useRef(0);
  const inFlightRef = useRef(false);
  const requestStartedAtRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const candidateEvidenceRef = useRef(null);
  const lastObservationAtRef = useRef(null);
  const nextDiscoveryAtRef = useRef(0);
  const previousAnchorRef = useRef(anchorVersion);
  const queueCacheRef = useRef(new Map());
  const [preloadedQueue, setPreloadedQueue] = useState(new Map());

  const verseSignatures = useMemo(
    () => (shabadVerses || []).map((v) => firstLetters(v?.gurmukhi || '')),
    [shabadVerses]
  );

  // Reset discovery when the reader changes context or listening is toggled.
  // Cooldown is intentionally NOT reset — after an advance fires, the long
  // cooldown carries across the navigation so the new shabad gets a quiet
  // window to settle before any further re-evaluation.
  useEffect(() => {
    requestGenerationRef.current += 1;
    inFlightRef.current = false;
    absentCountRef.current = 0;
    lastSignatureRef.current = '';
    candidateEvidenceRef.current = null;
    lastObservationAtRef.current = null;
    nextDiscoveryAtRef.current = 0;
    if (anchorVersion !== previousAnchorRef.current) {
      previousAnchorRef.current = anchorVersion;
      cooldownUntilRef.current = Math.max(cooldownUntilRef.current, Date.now() + COOLDOWN_MS);
    }
    recordEvent('discovery', () => ({ action: 'invalidate', reason: navigationBlocked ? 'operator-blocked' : 'context-changed', generation: requestGenerationRef.current, cooldownMs: Math.max(0, cooldownUntilRef.current - Date.now()) }));
    return () => {
      requestGenerationRef.current += 1;
      recordEvent('discovery', { action: 'invalidate', reason: 'context-disposed', generation: requestGenerationRef.current });
    };
  }, [active, currentShabadId, navigationBlocked, anchorVersion]);

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
    if (!active || navigationBlocked || !currentShabadId || !verseSignatures.length || !onAdvance) return;

    const clearEvidence = (reason) => {
      requestGenerationRef.current += 1;
      inFlightRef.current = false;
      absentCountRef.current = 0;
      candidateEvidenceRef.current = null;
      recordEvent('discovery', { action: 'invalidate', reason, generation: requestGenerationRef.current });
    };

    const recentInitials = firstLetters(transcript, RECENT_WORDS);
    if (recentInitials.length < MIN_INITIALS_LEN) {
      clearEvidence('insufficient-input');
      lastSignatureRef.current = '';
      return;
    }

    if (recentInitials === lastSignatureRef.current) return;
    lastSignatureRef.current = recentInitials;

    const now = Date.now();
    if ((lastObservationAtRef.current != null && now - lastObservationAtRef.current > EVIDENCE_MAX_AGE_MS) ||
        (inFlightRef.current && now - requestStartedAtRef.current > EVIDENCE_MAX_AGE_MS)) {
      clearEvidence('evidence-expired');
    }
    lastObservationAtRef.current = now;

    // A local line score describes cursor tracking, not Shabad identity.
    // Positive current-text evidence can cancel even an in-flight discovery.
    if (isOnCurrentShabad(recentInitials, verseSignatures)) {
      clearEvidence('current-text-present');
      return;
    }

    absentCountRef.current += 1;
    recordEvent('discovery', { action: 'miss', signature: recentInitials, absentCount: absentCountRef.current, generation: requestGenerationRef.current });
    if (absentCountRef.current < ABSENT_CHECKS_TO_FIRE) return;
    if (inFlightRef.current || now < cooldownUntilRef.current || now < nextDiscoveryAtRef.current) return;

    const allTokens = String(transcript || '').trim().split(/\s+/).filter(Boolean);
    const queryWords = allTokens.slice(-QUERY_RECENT_WORDS);
    if (queryWords.length < 4) return;
    const query = queryWords.join(' ');

    inFlightRef.current = true;
    requestStartedAtRef.current = now;
    nextDiscoveryAtRef.current = now + CONFIRMATION_INTERVAL_MS;
    const generation = requestGenerationRef.current;
    const requestId = recordEvent('discovery', { action: 'request', tail: query, signature: recentInitials, generation })?.id || null;
    const isCurrentRequest = () => {
      const valid = generation === requestGenerationRef.current && Date.now() - now <= EVIDENCE_MAX_AGE_MS;
      if (!valid) recordEvent('discovery', { action: 'expired', requestId, generation, reason: generation !== requestGenerationRef.current ? 'context-invalidated' : 'response-too-old' });
      return valid;
    };

    const considerCandidate = (candidate) => {
      const previous = candidateEvidenceRef.current;
      const sameCandidate = previous && String(previous.shabadId) === String(candidate.shabadId);
      if (!sameCandidate || now - previous.observedAt > EVIDENCE_MAX_AGE_MS) {
        candidateEvidenceRef.current = { shabadId: candidate.shabadId, observedAt: now, signature: recentInitials };
        recordEvent('discovery', () => ({ action: 'pending', requestId, generation, shabadId: String(candidate.shabadId), confidence: candidate.confidence, evidenceAgeMs: Date.now() - now }));
        return;
      }
      if (recentInitials === previous.signature || now - previous.observedAt < CONFIRMATION_INTERVAL_MS) return;
      cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
      absentCountRef.current = 0;
      candidateEvidenceRef.current = null;
      recordEvent('discovery', () => ({ action: 'committed', requestId, generation, shabadId: String(candidate.shabadId), confidence: candidate.confidence, confirmationAgeMs: now - previous.observedAt, evidenceAgeMs: Date.now() - now, cooldownMs: Math.max(0, cooldownUntilRef.current - Date.now()) }));
      onAdvance(candidate);
    };

    const otherQueueCandidates = orderedQueueCandidates(queueCandidates, currentShabadId);

    const tryQueueFirst = async () => {
      const scored = await Promise.all(otherQueueCandidates.map(async (item, orderIndex) => {
        try {
          const cached = preloadedQueue.get(String(item.shabadId)) || await getQueueCacheEntry(item, queueCacheRef);
          if (!isCurrentRequest()) return null;
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
          if (!isCurrentRequest()) return null;
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
      // Queue order is a search preference, not evidence of identity. Compare
      // raw scores against both competitors and current on the same query.
      const secondScore = Math.max(0, ...ranked.slice(1).map((item) => item.rawConfidence));
      const currentScore = Number(matchLine(shabadVerses, query, { currentLine: -1 }).confidence || 0);
      recordEvent('discovery', () => ({ action: 'results', reason: 'queue', requestId, generation, currentConfidence: currentScore, evidenceAgeMs: Date.now() - now,
        competitors: ranked.map((item) => ({ position: { shabadId: String(item.item.shabadId) }, confidence: item.rawConfidence })) }));
      const confident =
        best.tracked &&
        best.rawConfidence >= QUEUE_CONFIDENCE_TO_OPEN &&
        best.rawConfidence >= currentScore + MIN_MARGIN_OVER_CURRENT &&
        best.rawConfidence >= secondScore + QUEUE_MIN_SCORE_GAP;

      if (!confident) return null;
      return candidateFromQueueData(best.item, best.data);
    };

    tryQueueFirst()
      .then((queuedMatch) => {
        if (!isCurrentRequest()) return null;
        if (queuedMatch?.shabadId) {
          considerCandidate(queuedMatch);
          return null;
        }
        return api.suggestShabads(query, {});
      })
      .then((res) => {
        if (!res || !isCurrentRequest()) return;
        const suggestions = (Array.isArray(res?.suggestions) ? res.suggestions : [])
          .filter((item) => item?.shabadId)
          .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
        const current = suggestions.find((s) =>
          s?.shabadId && String(s.shabadId) === String(currentShabadId)
        );
        const alternatives = suggestions.filter((s) =>
          s?.shabadId && String(s.shabadId) !== String(currentShabadId)
        );
        const topOther = alternatives[0];
        recordEvent('discovery', () => ({ action: 'results', reason: 'global', requestId, generation, evidenceAgeMs: Date.now() - now,
          competitors: suggestions.map((item) => ({ position: { shabadId: String(item.shabadId) }, confidence: item.confidence })) }));

        const otherConf = Number(topOther?.confidence || 0);
        const currentConf = Number(current?.confidence || 0);
        const runnerUpConf = Number(alternatives[1]?.confidence || 0);
        if (!topOther?.shabadId || otherConf < CONFIDENCE_TO_OPEN ||
            otherConf < currentConf + MIN_MARGIN_OVER_CURRENT ||
            otherConf < runnerUpConf + MIN_CANDIDATE_GAP) {
          candidateEvidenceRef.current = null;
          recordEvent('discovery', { action: 'rejected', requestId, generation, reason: 'insufficient-score-or-margin', confidence: otherConf, currentConfidence: currentConf });
          return;
        }

        considerCandidate(topOther);
      })
      .catch(() => {
        if (isCurrentRequest()) candidateEvidenceRef.current = null;
        recordEvent('discovery', { action: 'rejected', requestId, generation, reason: 'search-error' });
      })
      .finally(() => {
        if (generation === requestGenerationRef.current) inFlightRef.current = false;
      });
  }, [
    active,
    transcript,
    currentShabadId,
    verseSignatures,
    queueCandidates,
    preloadedQueue,
    navigationBlocked,
    anchorVersion,
    onAdvance,
  ]);
}
