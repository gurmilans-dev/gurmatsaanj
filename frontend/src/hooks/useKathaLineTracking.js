/**
 * Katha line tracking searches a small, preloaded neighbourhood first:
 * previous content, current content, then next content. That keeps matching
 * fast for Katha, where the spoken line is usually adjacent to the current
 * line or just across a Shabad/Ang boundary.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

const NAV_COOLDOWN_MS = 80;
const NO_MATCH_DISPLAY_MS = 2200;
const LOCAL_MATCH_FLOOR = 60;
const SHORT_QUERY_FLOOR = 70;
const EXPECTED_CORE_MATCH_FLOOR = 52;
const EXPECTED_CORE_SHORT_FLOOR = 60;
const EXPECTED_WINDOW_MATCH_FLOOR = 56;
const EXPECTED_WINDOW_SHORT_FLOOR = 64;
const COMMIT_DEBOUNCE_MS = 40;
const IMMEDIATE_COMMIT_SCORE = 78;
const REVERSE_COOLDOWN_MS = 900;
const REVERSE_MARGIN = 14;
const CORE_SCORE_GAP = 1;
const EXPECTED_SCORE_GAP = 3;
const NEAR_SCORE_GAP = 5;
const FAR_SCORE_GAP = 12;
const CROSS_GROUP_SCORE_GAP = 16;
const FAR_MATCH_FLOOR = 84;
const CROSS_GROUP_MATCH_FLOOR = 90;
const COOLDOWN_STRONG_SCORE = 90;
const RECENT_NAV_COOLDOWN_MS = 120;
const FAR_CONFIRM_WINDOW_MS = 3500;
const FAR_CONFIRM_SCORE = 88;
const OPENING_BOUNDARY_AMBIGUITY_GAP = 16;
const GURMUKHI_RE = /[\u0A00-\u0A7F]/;
const MATRA_RE = /[\u0A3C\u0A3E-\u0A42\u0A47-\u0A4D\u0A51\u0A70\u0A71\u0964\u0965]/g;
const NOISE_WORDS = new Set([
  'a', 'an', 'and', 'aa', 'ah', 'ha', 'han', 'haan', 'hmm', 'ji', 'jee', 'oh', 'uh', 'um',
  'waheguru', 'vahiguru', 'wahiguru', 'vaheguru',
  '\u0A1C\u0A40', // ji
  '\u0A39\u0A3E\u0A02', // haan
  '\u0A35\u0A3E\u0A39\u0A3F\u0A17\u0A41\u0A30\u0A42', // waheguru
]);

function tailWords(text, count) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).slice(-count).join(' ');
}

function debugKatha(...args) {
  try {
    if (localStorage.getItem('saanj-kirtan.debugKatha') === '1') {
      // eslint-disable-next-line no-console
      console.debug('[katha-match]', ...args);
    }
  } catch {
    // noop
  }
}

function cleanText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\u0A00-\u0A7Fa-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looseText(text) {
  return cleanText(text).replace(MATRA_RE, '');
}

function words(text) {
  return cleanText(text).split(/\s+/).filter(Boolean);
}

function looseWords(text) {
  return looseText(text).split(/\s+/).filter(Boolean);
}

function wordLength(word) {
  return Array.from(String(word || '')).length;
}

function isNoiseWord(word) {
  const clean = cleanText(word);
  if (!clean) return true;
  return NOISE_WORDS.has(clean) || NOISE_WORDS.has(looseText(clean));
}

function meaningfulWords(list) {
  return (list || []).filter((word) => !isNoiseWord(word) && wordLength(word) > 1);
}

function initialsFromWords(list) {
  return list.map((w) => Array.from(w)[0] || '').join('');
}

function queryInfo(text) {
  const isGurmukhi = GURMUKHI_RE.test(text);
  const rawWords = isGurmukhi ? looseWords(text) : words(text);
  const usefulWords = meaningfulWords(rawWords);
  return {
    isGurmukhi,
    rawWords,
    usefulWords,
    normalized: usefulWords.join(' '),
    initials: initialsFromWords(usefulWords),
  };
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j];
  }
  return prev[b.length];
}

function tokenSimilar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 4) return false;
  return editDistance(a, b) / maxLen <= 0.34;
}

function overlapScore(query, candidate) {
  if (!query.length || !candidate.length) return 0;
  let hits = 0;
  for (const q of query) {
    if (candidate.some((c) => tokenSimilar(q, c))) hits += 1;
  }
  return Math.round((hits / query.length) * 100);
}

function orderedScore(query, candidate) {
  if (!query.length || !candidate.length) return 0;
  let qi = 0;
  let hits = 0;
  for (const c of candidate) {
    const q = query[qi];
    if (!q) break;
    if (tokenSimilar(q, c)) {
      hits += 1;
      qi += 1;
    }
  }
  return Math.round((hits / query.length) * 100);
}

function initialsScore(queryInitials, candidateInitials) {
  if (!queryInitials || queryInitials.length < 2 || !candidateInitials) return 0;
  if (candidateInitials.includes(queryInitials)) return queryInitials.length >= 4 ? 96 : 84;
  if (queryInitials.length >= 4) {
    for (let i = 0; i <= queryInitials.length - 3; i += 1) {
      if (candidateInitials.includes(queryInitials.slice(i, i + 3))) return 72;
    }
  }
  return 0;
}

function proximityProfile(verse, flatIndex, currentFlatIndex, currentGroupId) {
  if (currentFlatIndex < 0 || flatIndex < 0) {
    return {
      distance: 999,
      absDistance: 999,
      sameGroup: false,
      isCoreNearby: false,
      isExpectedNearby: false,
      isBoundaryImmediate: false,
      isBoundaryWindow: false,
      isFirstInCurrentGroup: false,
      isNearby: false,
      isFar: true,
      isCrossGroup: true,
      isFirstInCurrentShabad: false,
      boost: 0,
      penalty: 20,
    };
  }
  const meta = verse.__katha;
  const distance = flatIndex - currentFlatIndex;
  const absDistance = Math.abs(distance);
  const sameGroup = String(meta?.groupId) === String(currentGroupId);
  const isFirstInCurrentGroup = sameGroup && Number(meta?.localIndex) === 0;
  const isFirstInCurrentShabad = isFirstInCurrentGroup && meta?.type === 'shabad';
  const isBoundaryImmediate = !sameGroup && absDistance <= 1;
  const isBoundaryWindow = !sameGroup && absDistance <= 3;
  const isSameGroupWindow = sameGroup && absDistance <= 3;
  const isCoreNearby = absDistance <= 1 || isFirstInCurrentGroup || isBoundaryImmediate;
  const isExpectedNearby = isCoreNearby || isSameGroupWindow || isBoundaryWindow;
  const isNearby = isExpectedNearby;
  let boost = 0;
  if (isBoundaryImmediate) boost = 22;
  else if (absDistance === 0) boost = 20;
  else if (absDistance === 1) boost = 20;
  else if (isFirstInCurrentGroup) boost = 16;
  else if (isBoundaryWindow && absDistance === 2) boost = 14;
  else if (isBoundaryWindow && absDistance === 3) boost = 10;
  else if (absDistance === 2) boost = 10;
  else if (absDistance === 3) boost = 6;

  let penalty = 0;
  if (!isExpectedNearby) {
    if (absDistance > 8) penalty += 16;
    else if (absDistance > 5) penalty += 10;
    else if (absDistance > 3) penalty += 5;
    if (!sameGroup) penalty += 8;
  }

  return {
    distance,
    absDistance,
    sameGroup,
    isCoreNearby,
    isExpectedNearby,
    isBoundaryImmediate,
    isBoundaryWindow,
    isFirstInCurrentGroup,
    isNearby,
    isFar: !isNearby,
    isCrossGroup: !sameGroup,
    isFirstInCurrentShabad,
    boost,
    penalty,
  };
}

function buildCandidate(flat, flatIndex, currentFlatIndex, currentGroupId) {
  const verse = flat[flatIndex] || {};
  // Reuse the per-verse features cached by makeFlat. Fall back to computing
  // them only if a verse somehow lacks the cache (defensive — shouldn't happen
  // for verses that went through makeFlat).
  const feat = verse.__feat || (() => {
    const gWords = looseWords(verse.gurmukhi || '');
    const rWords = words(verse.transliteration || '');
    return {
      gurmukhi: verse.gurmukhi || '',
      transliteration: verse.transliteration || '',
      gWords,
      rWords,
      gUsefulWords: meaningfulWords(gWords),
      rUsefulWords: meaningfulWords(rWords),
      gText: gWords.join(' '),
      rText: rWords.join(' '),
      gInitials: initialsFromWords(gWords),
      rInitials: initialsFromWords(rWords),
    };
  })();
  const profile = proximityProfile(verse, flatIndex, currentFlatIndex, currentGroupId);
  return {
    flatIndex,
    verse,
    meta: verse.__katha,
    gurmukhi: feat.gurmukhi,
    transliteration: feat.transliteration,
    gWords: feat.gWords,
    rWords: feat.rWords,
    gUsefulWords: feat.gUsefulWords,
    rUsefulWords: feat.rUsefulWords,
    gText: feat.gText,
    rText: feat.rText,
    gInitials: feat.gInitials,
    rInitials: feat.rInitials,
    ...profile,
  };
}

function scoreCandidate(queryText, candidate, info = queryInfo(queryText)) {
  const qWords = info.usefulWords;
  if (qWords.length === 0) {
    return {
      score: 0,
      base: 0,
      exact: 0,
      overlap: 0,
      ordered: 0,
      initials: 0,
      queryWordCount: 0,
    };
  }
  const qText = qWords.join(' ');
  const qInitials = info.initials;
  const cWords = info.isGurmukhi ? candidate.gUsefulWords : candidate.rUsefulWords;
  const cText = cWords.join(' ');
  const cInitials = info.isGurmukhi
    ? initialsFromWords(candidate.gUsefulWords)
    : initialsFromWords(candidate.rUsefulWords);

  let exact = 0;
  if (cText && qText) {
    if (cText.includes(qText)) exact = qWords.length >= 3 ? 98 : 82;
    else if (qText.includes(cText) && cWords.length >= 2) {
      const coverage = cWords.length / Math.max(qWords.length, 1);
      if (coverage >= 0.8) exact = 88;
      else if (coverage >= 0.6) exact = 76;
      else exact = 0;
    }
  }

  const overlap = overlapScore(qWords, cWords);
  const ordered = orderedScore(qWords, cWords);
  const initials = initialsScore(qInitials, cInitials);
  const base = Math.max(exact, initials, Math.round(overlap * 0.58 + ordered * 0.42));
  return {
    score: Math.max(0, Math.min(100, base + candidate.boost - candidate.penalty)),
    base,
    exact,
    overlap,
    ordered,
    initials,
    queryWordCount: qWords.length,
    boost: candidate.boost,
    penalty: candidate.penalty,
  };
}

function localMatch(queryText, matchContext, flat, currentGroupId) {
  const info = queryInfo(queryText);
  const candidates = matchContext.map
    .map((flatIndex) => buildCandidate(flat, flatIndex, matchContext.anchorIndex, currentGroupId))
    .filter((c) => c.meta);
  const scored = candidates
    .map((candidate) => {
      const details = scoreCandidate(queryText, candidate, info);
      return {
        candidate,
        ...details,
      };
    })
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return preferredCandidateOrder(b.candidate, matchContext) - preferredCandidateOrder(a.candidate, matchContext);
    });
  const best = scored[0] || null;
  const second = scored[1] || null;
  debugKatha('local-match', {
    transcript: queryText,
    normalizedTranscript: info.normalized,
    candidates: candidates.length,
    currentGroupId,
    bestScore: best?.score || 0,
    secondScore: second?.score || 0,
    bestTarget: best?.candidate?.meta ? {
      groupId: best.candidate.meta.groupId,
      type: best.candidate.meta.type,
      localIndex: best.candidate.meta.localIndex,
      distance: best.candidate.absDistance,
      expected: best.candidate.isExpectedNearby,
      boundary: best.candidate.isBoundaryImmediate || best.candidate.isBoundaryWindow,
      nearbyBoost: best.candidate.boost,
      penalty: best.candidate.penalty,
    } : null,
  });
  return { best, second, query: info, candidates: candidates.length };
}

function preferredCandidateOrder(candidate, matchContext) {
  if (!candidate?.meta) return 0;
  let preference = 0;
  if (candidate.absDistance === 0) preference += 4;
  if (candidate.absDistance === 1) preference += 6;
  if (candidate.isBoundaryImmediate) preference += 10;
  if (candidate.isBoundaryWindow) preference += 6;

  if (matchContext?.nearGroupEnd && candidate.isCrossGroup && candidate.distance > 0 && candidate.isExpectedNearby) {
    preference += 14;
  }
  if (matchContext?.nearGroupStart && candidate.isCrossGroup && candidate.distance < 0 && candidate.isExpectedNearby) {
    preference += 14;
  }
  if (matchContext?.nearGroupEnd && candidate.isFirstInCurrentGroup && candidate.distance < 0) {
    preference -= 12;
  }

  return preference;
}

function analyzeLocalMatch(queryText, matchContext, flat, currentGroupId, evaluateMatchQuality) {
  const match = localMatch(queryText, matchContext, flat, currentGroupId);
  const { best, second, query: queryMeta } = match;
  const quality = evaluateMatchQuality(
    best ? { ...best, candidates: match.candidates } : best,
    second ? { ...second, candidates: match.candidates } : second,
    queryMeta
  );
  return {
    match,
    best,
    second,
    queryMeta,
    quality,
    nextTracked: Boolean(quality.ok && best?.candidate?.meta),
    target: best?.candidate?.verse || null,
  };
}

function makeFlat(groups) {
  const flat = [];
  for (const group of groups || []) {
    const verses = Array.isArray(group?.verses) ? group.verses : [];
    verses.forEach((verse, localIndex) => {
      const gurmukhi = verse?.gurmukhi || '';
      const transliteration = verse?.transliteration || '';
      const gWords = looseWords(gurmukhi);
      const rWords = words(transliteration);
      flat.push({
        ...verse,
        __katha: {
          groupId: group.id,
          type: group.type,
          localIndex,
          group,
        },
        // Per-verse text features depend only on the verse, not the live
        // transcript. Precomputing them once here (makeFlat is memoised on
        // `groups`) means each ~50ms matching poll just scores against cached
        // tokenisations instead of re-tokenising every candidate verse every
        // time — the bulk of the old per-poll cost.
        __feat: {
          gurmukhi,
          transliteration,
          gWords,
          rWords,
          gUsefulWords: meaningfulWords(gWords),
          rUsefulWords: meaningfulWords(rWords),
          gText: gWords.join(' '),
          rText: rWords.join(' '),
          gInitials: initialsFromWords(gWords),
          rInitials: initialsFromWords(rWords),
        },
      });
    });
  }
  return flat;
}

function findFlatIndex(flat, groupId, localIndex) {
  return flat.findIndex((v) =>
    String(v.__katha?.groupId) === String(groupId) &&
    Number(v.__katha?.localIndex) === Number(localIndex)
  );
}

function buildPrioritizedContext(flat, currentGroupId, currentFlatIndex) {
  const seen = new Set();
  const indexes = [];
  const add = (idx) => {
    if (idx < 0 || idx >= flat.length || seen.has(idx)) return;
    seen.add(idx);
    indexes.push(idx);
  };

  const firstInCurrentGroup = flat.findIndex((v) =>
    String(v.__katha?.groupId) === String(currentGroupId) &&
    Number(v.__katha?.localIndex) === 0
  );
  const anchorIndex = currentFlatIndex >= 0 ? currentFlatIndex : firstInCurrentGroup;
  const anchorMeta = flat[anchorIndex]?.__katha || {};
  const currentLocalIndex = Number(anchorMeta.localIndex ?? 0);
  const currentGroupSize = Array.isArray(anchorMeta.group?.verses)
    ? anchorMeta.group.verses.length
    : 0;
  const distanceToGroupEnd = currentGroupSize > 0
    ? Math.max(0, currentGroupSize - 1 - currentLocalIndex)
    : 999;
  const nearGroupStart = currentLocalIndex <= 1;
  const nearGroupEnd = distanceToGroupEnd <= 1;

  add(anchorIndex);
  add(anchorIndex + 1);
  add(anchorIndex - 1);
  add(firstInCurrentGroup);

  for (let distance = 2; distance <= 8; distance += 1) {
    add(anchorIndex + distance);
    add(anchorIndex - distance);
  }

  flat.forEach((v, idx) => {
    if (String(v.__katha?.groupId) === String(currentGroupId)) add(idx);
  });
  flat.forEach((_, idx) => add(idx));

  const nearbyIndexes = indexes.filter((idx) => (
    proximityProfile(flat[idx], idx, anchorIndex, currentGroupId).isExpectedNearby
  ));
  const coreNearbyIndexes = indexes.filter((idx) => {
    const profile = proximityProfile(flat[idx], idx, anchorIndex, currentGroupId);
    const localIndex = Number(flat[idx]?.__katha?.localIndex ?? -1);
    if (profile.isCoreNearby) {
      if (nearGroupEnd && profile.isFirstInCurrentGroup && profile.distance < 0) return false;
      return true;
    }
    if (nearGroupEnd && profile.isBoundaryWindow && profile.distance > 0 && localIndex <= 2) return true;
    if (nearGroupStart && profile.isBoundaryWindow && profile.distance < 0) return true;
    return false;
  });
  const verses = indexes.map((idx) => flat[idx]);
  return {
    verses,
    map: indexes,
    coreNearbyVerses: coreNearbyIndexes.map((idx) => flat[idx]),
    coreNearbyMap: coreNearbyIndexes,
    nearbyVerses: nearbyIndexes.map((idx) => flat[idx]),
    nearbyMap: nearbyIndexes,
    currentIndex: indexes.indexOf(anchorIndex),
    anchorIndex,
    currentLocalIndex,
    distanceToGroupEnd,
    nearGroupStart,
    nearGroupEnd,
  };
}

function versesForMap(matchContext, map) {
  return map
    .map((idx) => matchContext.verses[matchContext.map.indexOf(idx)])
    .filter(Boolean);
}

function coreNearbyContext(matchContext) {
  const coreMap = Array.isArray(matchContext.coreNearbyMap) && matchContext.coreNearbyMap.length
    ? matchContext.coreNearbyMap
    : matchContext.map.slice(0, 4);

  return {
    ...matchContext,
    verses: Array.isArray(matchContext.coreNearbyVerses) && matchContext.coreNearbyVerses.length
      ? matchContext.coreNearbyVerses
      : versesForMap(matchContext, coreMap),
    map: coreMap,
  };
}

function expectedNearbyContext(matchContext) {
  const nearbyMap = Array.isArray(matchContext.nearbyMap) && matchContext.nearbyMap.length
    ? matchContext.nearbyMap
    : matchContext.map.slice(0, 4);

  return {
    ...matchContext,
    verses: Array.isArray(matchContext.nearbyVerses) && matchContext.nearbyVerses.length
      ? matchContext.nearbyVerses
      : versesForMap(matchContext, nearbyMap),
    map: nearbyMap,
  };
}

function currentGroupContext(matchContext, flat, currentGroupId) {
  const groupMap = matchContext.map.filter((idx) =>
    String(flat[idx]?.__katha?.groupId) === String(currentGroupId)
  );
  const map = groupMap.length ? groupMap : matchContext.map;
  return {
    ...matchContext,
    verses: versesForMap(matchContext, map),
    map,
    nearbyVerses: [],
    nearbyMap: [],
    coreNearbyVerses: [],
    coreNearbyMap: [],
  };
}

function isAcceptedNearbyMatch(result) {
  return Boolean(
    result?.nextTracked &&
    result?.best?.candidate?.isExpectedNearby &&
    result?.target?.__katha
  );
}

export default function useKathaLineTracking({
  active,
  transcript,
  groups,
  currentGroupId,
  currentLineIndex,
  onNavigate,
  stayInCurrentGroup = false,
  anchorLineIndex = null,
  anchorVersion = 0,
  // Speech recognition updates only a few times a second, so polling the
  // matcher every 25ms was mostly redundant work. ~55ms stays well below
  // perceptible lag while roughly halving the matching CPU. The unchanged-tail
  // dedupe (lastTailRef) already skips truly redundant runs on top of this.
  intervalMs = 55,
}) {
  const [lineIndex, setLineIndex] = useState(-1);
  const [confidence, setConfidence] = useState(0);
  const [tracked, setTracked] = useState(false);
  const [searchingWide, setSearchingWide] = useState(false);
  const [status, setStatus] = useState('idle');
  const [debug, setDebug] = useState(null);

  const reqIdRef = useRef(0);
  const lastRunRef = useRef(0);
  const lastTailRef = useRef('');
  const lastTailAtRef = useRef(0);
  const timerRef = useRef(null);
  const inFlightRef = useRef(false);
  const navCooldownUntilRef = useRef(0);
  const currentGroupRef = useRef(currentGroupId);
  const noMatchTimerRef = useRef(null);
  const statusRef = useRef(status);
  const pendingCommitRef = useRef(null);
  const farConfirmRef = useRef(null);
  const commitTimerRef = useRef(null);
  const committedRef = useRef({
    key: `${currentGroupId ?? ''}:${currentLineIndex >= 0 ? currentLineIndex : -1}`,
    groupId: currentGroupId,
    lineIndex: currentLineIndex >= 0 ? currentLineIndex : -1,
    score: 0,
    ts: 0,
  });
  const prevAnchorVersionRef = useRef(anchorVersion);

  const flat = useMemo(() => makeFlat(groups), [groups]);
  const currentFlatIndex = useMemo(() => (
    findFlatIndex(flat, currentGroupId, currentLineIndex >= 0 ? currentLineIndex : 0)
  ), [flat, currentGroupId, currentLineIndex]);
  const matchContext = useMemo(() => (
    buildPrioritizedContext(flat, currentGroupId, currentFlatIndex)
  ), [flat, currentGroupId, currentFlatIndex]);

  const clearPendingCommit = () => {
    pendingCommitRef.current = null;
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  };

  const clearFarConfirmation = () => {
    farConfirmRef.current = null;
  };

  const targetKey = (meta) => `${meta?.groupId ?? ''}:${Number(meta?.localIndex ?? -1)}`;

  const commitMatch = (meta, score, requestId) => {
    if (!meta || requestId !== reqIdRef.current) return false;
    if (stayInCurrentGroup && String(meta.groupId) !== String(currentGroupId)) {
      setStatus('listening');
      return false;
    }

    const now = Date.now();
    const key = targetKey(meta);
    const previous = committedRef.current || {};
    const sameTarget = previous.key === key;

    if (noMatchTimerRef.current) {
      clearTimeout(noMatchTimerRef.current);
      noMatchTimerRef.current = null;
    }
    setConfidence(score);
    setTracked(true);
    setSearchingWide(false);
    setStatus('tracked');

    if (sameTarget) {
      committedRef.current = {
        ...previous,
        score: Math.max(Number(previous.score || 0), score),
        ts: now,
      };
      return true;
    }

    committedRef.current = {
      key,
      groupId: meta.groupId,
      lineIndex: Number(meta.localIndex),
      score,
      ts: now,
    };

    debugKatha('commit', {
      score,
      target: {
        groupId: meta.groupId,
        type: meta.type,
        localIndex: meta.localIndex,
      },
    });

    if (String(meta.groupId) === String(currentGroupId)) {
      setLineIndex(meta.localIndex);
      return true;
    }

    if (now >= navCooldownUntilRef.current) {
      navCooldownUntilRef.current = now + NAV_COOLDOWN_MS;
      onNavigate?.(meta.group, meta.localIndex);
      return true;
    }

    return false;
  };

  const shouldRejectReverse = (meta, score, candidate) => {
    const previous = committedRef.current || {};
    if (!previous.key || String(previous.groupId) !== String(meta?.groupId)) return false;
    if (Date.now() - Number(previous.ts || 0) > REVERSE_COOLDOWN_MS) return false;
    if (Number(meta.localIndex) >= Number(previous.lineIndex)) return false;
    if (candidate?.isCoreNearby && score >= 88) return false;
    const margin = candidate?.isExpectedNearby ? 8 : REVERSE_MARGIN;
    return score < Number(previous.score || 0) + margin;
  };

  const shouldRejectRecentJump = (meta, candidate, score) => {
    const previous = committedRef.current || {};
    if (!previous.key || previous.key === targetKey(meta)) return false;
    if (Date.now() - Number(previous.ts || 0) > RECENT_NAV_COOLDOWN_MS) return false;
    if (candidate?.isCoreNearby && score >= 72) return false;
    if (candidate?.isExpectedNearby && score >= IMMEDIATE_COMMIT_SCORE) return false;
    return score < COOLDOWN_STRONG_SCORE;
  };

  const evaluateMatchQuality = (match, second, info) => {
    if (!match?.candidate?.meta) return { ok: false, reason: 'no-candidate' };

    const candidate = match.candidate;
    const score = Number(match.score || 0);
    const secondScore = Number(second?.score || 0);
    const strongTextMatch =
      match.exact >= 96 ||
      match.initials >= 96 ||
      (match.overlap >= 85 && match.ordered >= 70);
    const gateScore = strongTextMatch ? Math.max(score, Number(match.base || 0)) : score;
    const secondStrongTextMatch =
      second?.exact >= 96 ||
      second?.initials >= 96 ||
      (second?.overlap >= 85 && second?.ordered >= 70);
    const secondGateScore = secondStrongTextMatch
      ? Math.max(secondScore, Number(second?.base || 0))
      : secondScore;
    let comparisonSecondScore = secondGateScore;
    if (candidate.isExpectedNearby && second?.candidate && !second.candidate.isExpectedNearby) {
      comparisonSecondScore -= candidate.isCoreNearby ? 12 : 8;
    }
    const gap = gateScore - comparisonSecondScore;
    const wordCount = info?.usefulWords?.length || 0;
    const key = targetKey(candidate.meta);
    const sameTarget = committedRef.current?.key === key;
    const isFarMatch = candidate.isFar || (candidate.isCrossGroup && !candidate.isExpectedNearby);
    const isCrossGroupFar = candidate.isCrossGroup && !candidate.isExpectedNearby;
    const floor = isCrossGroupFar
      ? CROSS_GROUP_MATCH_FLOOR
      : isFarMatch
        ? FAR_MATCH_FLOOR
        : candidate.isCoreNearby
          ? wordCount <= 2
            ? EXPECTED_CORE_SHORT_FLOOR
            : EXPECTED_CORE_MATCH_FLOOR
          : candidate.isExpectedNearby
            ? wordCount <= 2
              ? EXPECTED_WINDOW_SHORT_FLOOR
              : EXPECTED_WINDOW_MATCH_FLOOR
            : wordCount <= 2
              ? SHORT_QUERY_FLOOR
              : LOCAL_MATCH_FLOOR;
    const requiredGap = isCrossGroupFar
      ? CROSS_GROUP_SCORE_GAP
      : isFarMatch
        ? FAR_SCORE_GAP
        : candidate.isCoreNearby
          ? CORE_SCORE_GAP
          : candidate.isExpectedNearby
            ? EXPECTED_SCORE_GAP
            : NEAR_SCORE_GAP;

    const detail = {
      normalizedTranscript: info?.normalized || '',
      candidates: match.candidates ?? matchContext.map.length,
      currentLineIndex,
      target: {
        groupId: candidate.meta.groupId,
        type: candidate.meta.type,
        localIndex: candidate.meta.localIndex,
      },
      score,
      gateScore,
      secondScore,
      secondGateScore,
      comparisonSecondScore,
      gap,
      base: match.base,
      exact: match.exact,
      overlap: match.overlap,
      ordered: match.ordered,
      initials: match.initials,
      distance: candidate.absDistance,
      isCoreNearby: candidate.isCoreNearby,
      isExpectedNearby: candidate.isExpectedNearby,
      isBoundaryImmediate: candidate.isBoundaryImmediate,
      isBoundaryWindow: candidate.isBoundaryWindow,
      isFirstInCurrentGroup: candidate.isFirstInCurrentGroup,
      nearbyBoost: candidate.boost,
      penalty: candidate.penalty,
      nearGroupStart: matchContext.nearGroupStart,
      nearGroupEnd: matchContext.nearGroupEnd,
      wordCount,
      floor,
      requiredGap,
    };

    if (wordCount < 2) {
      return { ok: false, reason: 'transcript-too-short', detail };
    }

    // Lowered floors so paraphrased katha speech still registers as "useful"
    // signal. The proximity bias in proximityProfile keeps false positives
    // bounded by anchoring matches to the current group / nearby verses.
    const hasUsefulTextSignal =
      match.exact >= 78 ||
      match.initials >= 80 ||
      match.overlap >= 50 ||
      (wordCount >= 3 && match.overlap >= 42 && match.ordered >= 38);

    if (!hasUsefulTextSignal) {
      return { ok: false, reason: 'low-information-transcript', detail };
    }

    const boundaryOpeningAlternative =
      second?.candidate?.isCrossGroup &&
      second.candidate.isExpectedNearby &&
      second.candidate.distance > 0 &&
      Number(second.candidate.meta?.localIndex ?? 999) <= 2;
    if (
      matchContext.nearGroupEnd &&
      candidate.isFirstInCurrentGroup &&
      candidate.distance < 0 &&
      boundaryOpeningAlternative &&
      wordCount <= 4 &&
      gateScore - secondGateScore < OPENING_BOUNDARY_AMBIGUITY_GAP
    ) {
      return { ok: false, reason: 'current-opening-ambiguous-near-boundary', detail };
    }

    if (gateScore < floor && !sameTarget) {
      return { ok: false, reason: 'score-too-low', detail };
    }

    if (gap < requiredGap && gateScore < (isFarMatch ? 94 : 88) && !sameTarget) {
      return { ok: false, reason: 'score-gap-too-small', detail };
    }

    if (isFarMatch && wordCount < 3 && match.exact < 96 && match.initials < 96) {
      return { ok: false, reason: 'far-transcript-too-short', detail };
    }

    if (shouldRejectRecentJump(candidate.meta, candidate, gateScore)) {
      return { ok: false, reason: 'recent-navigation-cooldown', detail };
    }

    const veryStrongFar = gateScore >= 94 && gap >= requiredGap + 4 && wordCount >= 3;
    if (isFarMatch && !sameTarget && !veryStrongFar) {
      const previous = farConfirmRef.current;
      const now = Date.now();
      if (
        previous?.key === key &&
        now - Number(previous.ts || 0) <= FAR_CONFIRM_WINDOW_MS &&
        gateScore >= FAR_CONFIRM_SCORE
      ) {
        clearFarConfirmation();
        return { ok: true, reason: 'far-confirmed', detail };
      }
      farConfirmRef.current = { key, score: gateScore, ts: now };
      return { ok: false, reason: 'far-match-needs-confirmation', detail };
    }

    clearFarConfirmation();
    return { ok: true, reason: 'accepted', detail };
  };

  const scheduleCommit = (meta, score, requestId, candidate) => {
    if (!meta || requestId !== reqIdRef.current) return false;
    if (shouldRejectReverse(meta, score, candidate)) {
      debugKatha('reject-reverse', {
        score,
        target: { groupId: meta.groupId, localIndex: meta.localIndex },
        previous: committedRef.current,
      });
      setStatus('listening');
      return false;
    }
    if (shouldRejectRecentJump(meta, candidate, score)) {
      debugKatha('reject', {
        reason: 'recent-navigation-cooldown',
        score,
        target: { groupId: meta.groupId, localIndex: meta.localIndex },
        previous: committedRef.current,
      });
      setStatus('listening');
      return false;
    }

    const key = targetKey(meta);
    const previous = committedRef.current || {};
    if (previous.key === key || candidate?.isExpectedNearby || score >= IMMEDIATE_COMMIT_SCORE) {
      clearPendingCommit();
      return commitMatch(meta, score, requestId);
    }

    pendingCommitRef.current = { key, meta, score, requestId };
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => {
      const pending = pendingCommitRef.current;
      commitTimerRef.current = null;
      if (!pending || pending.key !== key || pending.requestId !== reqIdRef.current) return;
      pendingCommitRef.current = null;
      commitMatch(pending.meta, pending.score, pending.requestId);
    }, COMMIT_DEBOUNCE_MS);
    setStatus('matching');
    return true;
  };

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (String(currentGroupRef.current) !== String(currentGroupId)) {
      reqIdRef.current += 1;
      clearPendingCommit();
      clearFarConfirmation();
      if (noMatchTimerRef.current) {
        clearTimeout(noMatchTimerRef.current);
        noMatchTimerRef.current = null;
      }
      lastTailRef.current = '';
      navCooldownUntilRef.current = Date.now() + NAV_COOLDOWN_MS;
      committedRef.current = {
        key: targetKey({ groupId: currentGroupId, localIndex: currentLineIndex >= 0 ? currentLineIndex : -1 }),
        groupId: currentGroupId,
        lineIndex: currentLineIndex >= 0 ? currentLineIndex : -1,
        score: 0,
        ts: 0,
      };
      setLineIndex(-1);
      setConfidence(0);
      setTracked(false);
      setSearchingWide(false);
      setStatus('listening');
      setDebug(null);
    }
    currentGroupRef.current = currentGroupId;
  }, [currentGroupId]);

  useEffect(() => {
    if (!Number.isFinite(Number(anchorVersion)) || anchorVersion === prevAnchorVersionRef.current) return;
    prevAnchorVersionRef.current = anchorVersion;

    const group = (groups || []).find((item) => String(item?.id) === String(currentGroupId));
    const groupSize = Array.isArray(group?.verses) ? group.verses.length : 0;
    if (!groupSize) return;

    const next = Math.min(
      groupSize - 1,
      Math.max(0, Number(anchorLineIndex) || 0)
    );

    reqIdRef.current += 1;
    clearPendingCommit();
    clearFarConfirmation();
    lastTailRef.current = '';
    navCooldownUntilRef.current = Date.now() + 450;
    committedRef.current = {
      key: targetKey({ groupId: currentGroupId, localIndex: next }),
      groupId: currentGroupId,
      lineIndex: next,
      score: 0,
      ts: Date.now(),
    };
    setLineIndex(next);
    setConfidence(0);
    setTracked(false);
    setSearchingWide(false);
    setStatus('listening');
  }, [anchorLineIndex, anchorVersion, currentGroupId, groups]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (noMatchTimerRef.current) clearTimeout(noMatchTimerRef.current);
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    clearFarConfirmation();
  }, []);

  useEffect(() => {
    const showNoMatchBriefly = () => {
      if (noMatchTimerRef.current) clearTimeout(noMatchTimerRef.current);
      setStatus('no-match');
      noMatchTimerRef.current = setTimeout(() => {
        setStatus('listening');
      }, NO_MATCH_DISPLAY_MS);
    };

    if (!active || !currentGroupId || flat.length === 0) {
      reqIdRef.current += 1;
      clearPendingCommit();
      clearFarConfirmation();
      if (noMatchTimerRef.current) {
        clearTimeout(noMatchTimerRef.current);
        noMatchTimerRef.current = null;
      }
      setStatus('idle');
      setSearchingWide(false);
      setDebug(null);
      return undefined;
    }
    const text = String(transcript || '').trim();
    if (text.length < 2) {
      setStatus('listening');
      setSearchingWide(false);
      return undefined;
    }

    const run = async () => {
      if (inFlightRef.current) return;
      if (Date.now() < navCooldownUntilRef.current) return;

      const latest = String(transcript || '').trim();
      if (latest.length < 2) return;
      // Try a tiny core-nearby tail first for fast current/next/previous
      // movement, then use richer tails when we need more context.
      const fastTail = tailWords(latest, 3);
      const shortTail = tailWords(latest, 4);
      const longTail = tailWords(latest, 6);
      const tailKey = `${fastTail}|${shortTail}|${longTail}`;
      if (!fastTail && !shortTail && !longTail) return;
      // Re-evaluate repeated tails often enough for adjacent-line movement
      // while avoiding churn when recognition keeps sending the same words.
      if (tailKey === lastTailRef.current && Date.now() - lastTailAtRef.current < 90) {
        if (statusRef.current === 'matching' || statusRef.current === 'searching') setStatus('listening');
        return;
      }
      lastTailRef.current = tailKey;
      lastTailAtRef.current = Date.now();

      const myId = ++reqIdRef.current;
      inFlightRef.current = true;
      lastRunRef.current = Date.now();
      setStatus('matching');

      try {
        const primaryTail = shortTail || longTail || fastTail;
        const effectiveContext = stayInCurrentGroup
          ? currentGroupContext(matchContext, flat, currentGroupId)
          : matchContext;
        const coreContext = coreNearbyContext(effectiveContext);
        const nearbyContext = expectedNearbyContext(effectiveContext);
        let result = fastTail
          ? analyzeLocalMatch(fastTail, coreContext, flat, currentGroupId, evaluateMatchQuality)
          : analyzeLocalMatch(primaryTail, nearbyContext, flat, currentGroupId, evaluateMatchQuality);

        if (!isAcceptedNearbyMatch(result) && primaryTail && primaryTail !== fastTail) {
          const nearbyResult = analyzeLocalMatch(primaryTail, nearbyContext, flat, currentGroupId, evaluateMatchQuality);
          if (
            isAcceptedNearbyMatch(nearbyResult) ||
            Number(nearbyResult.best?.score || 0) > Number(result.best?.score || 0)
          ) {
            result = nearbyResult;
          }
        }

        if (!isAcceptedNearbyMatch(result) && longTail && longTail !== shortTail) {
          const nearbyLongResult = analyzeLocalMatch(longTail, nearbyContext, flat, currentGroupId, evaluateMatchQuality);
          if (
            isAcceptedNearbyMatch(nearbyLongResult) ||
            Number(nearbyLongResult.best?.score || 0) > Number(result.best?.score || 0)
          ) {
            result = nearbyLongResult;
          }
        }

        if (!isAcceptedNearbyMatch(result)) {
          let widerResult = analyzeLocalMatch(primaryTail, effectiveContext, flat, currentGroupId, evaluateMatchQuality);
          if (longTail && longTail !== shortTail) {
            const longerResult = analyzeLocalMatch(longTail, effectiveContext, flat, currentGroupId, evaluateMatchQuality);
            if (
              longerResult.nextTracked ||
              Number(longerResult.best?.score || 0) > Number(widerResult.best?.score || 0)
            ) {
              widerResult = longerResult;
            }
          }

          if (
            widerResult.nextTracked ||
            Number(widerResult.best?.score || 0) > Number(result.best?.score || 0)
          ) {
            result = widerResult;
          }
        }
        if (myId !== reqIdRef.current) return;

        const { best, quality, nextTracked, target } = result;

        setConfidence(best?.score || 0);

        if (nextTracked && target?.__katha) {
          debugKatha('accepted', quality.detail);
          setDebug({
            state: 'accepted',
            reason: quality.reason,
            transcript: primaryTail,
            ...(quality.detail || {}),
          });
          scheduleCommit(target.__katha, quality.detail?.gateScore || best.score, myId, best.candidate);
          return;
        }

        clearPendingCommit();
        setTracked(false);
        if (quality.reason !== 'far-match-needs-confirmation') {
          clearFarConfirmation();
        }
        if (best?.candidate?.meta) {
          setDebug({
            state: 'rejected',
            reason: quality.reason,
            transcript: primaryTail,
            ...(quality.detail || {}),
          });
          debugKatha('reject', {
            reason: quality.reason,
            ...(quality.detail || {}),
          });
        } else {
          setDebug({
            state: 'rejected',
            reason: quality.reason || 'no-candidate',
            transcript: primaryTail,
          });
        }
        if (quality.reason === 'far-match-needs-confirmation') {
          setStatus('listening');
        } else {
          showNoMatchBriefly();
        }
      } catch {
        setDebug({ state: 'error', reason: 'match-error' });
        showNoMatchBriefly();
      } finally {
        inFlightRef.current = false;
        setSearchingWide(false);
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
  }, [
    active,
    transcript,
    flat,
    matchContext,
    groups,
    currentGroupId,
    onNavigate,
    intervalMs,
    stayInCurrentGroup,
  ]);

  return { lineIndex, confidence, tracked, searchingWide, status, debug };
}
