/**
 * Client-side line matcher — a faithful port of the backend
 * matching.service.matchLine() (backend/src/services/matching.service.js).
 *
 * Why this exists: the live "which line is being sung" loop in
 * useLineTracking used to POST every ~190 ms to /api/voice/track-line. But
 * that endpoint is a *pure function* of the verses (already on the client)
 * and the transcript (already on the client) — it looks nothing up. Running
 * it in the browser removes the network from the hot loop entirely: lower
 * latency, no rate-limit, and it keeps following the singer even with the
 * backend unreachable or the wifi down (critical in a gurudwara).
 *
 * KEEP IN SYNC with the backend version. The scoring weights, the nearby-line
 * bias, and the hysteresis (farJumpUnclear / veryWeakSwitch) are copied
 * verbatim so the cursor behaves the same whether matched here or server-side.
 * The backend endpoint stays as a fallback / parity reference.
 *
 * Uses the same `fuzzball` library as the backend so scores are identical.
 */
// fuzzball is CommonJS. A namespace import + default fallback resolves the
// scoring fns whether bundled by Vite (default = module.exports) or run under
// Node's native ESM loader (named exports on the namespace, no default).
import * as fuzzball from 'fuzzball';
const fuzz = fuzzball.default || fuzzball;

// ── Gurmukhi normalization (mirrors backend/src/utils/gurmukhi.js) ──────────

const DEVA_TO_GURMUKHI = {
  'अ': 'ਅ', 'आ': 'ਆ', 'इ': 'ਇ', 'ई': 'ਈ', 'उ': 'ਉ', 'ऊ': 'ਊ',
  'ए': 'ਏ', 'ऐ': 'ਐ', 'ओ': 'ਓ', 'औ': 'ਔ',
  'क': 'ਕ', 'ख': 'ਖ', 'ग': 'ਗ', 'घ': 'ਘ', 'ङ': 'ਙ',
  'च': 'ਚ', 'छ': 'ਛ', 'ज': 'ਜ', 'झ': 'ਝ', 'ञ': 'ਞ',
  'ट': 'ਟ', 'ठ': 'ਠ', 'ड': 'ਡ', 'ढ': 'ਢ', 'ण': 'ਣ',
  'त': 'ਤ', 'थ': 'ਥ', 'द': 'ਦ', 'ध': 'ਧ', 'न': 'ਨ',
  'प': 'ਪ', 'फ': 'ਫ', 'ब': 'ਬ', 'भ': 'ਭ', 'म': 'ਮ',
  'य': 'ਯ', 'र': 'ਰ', 'ल': 'ਲ', 'व': 'ਵ', 'श': 'ਸ਼',
  'ष': 'ਸ਼', 'स': 'ਸ', 'ह': 'ਹ',
  'ा': 'ਾ', 'ि': 'ਿ', 'ी': 'ੀ', 'ु': 'ੁ', 'ू': 'ੂ',
  'े': 'ੇ', 'ै': 'ੈ', 'ो': 'ੋ', 'ौ': 'ੌ',
  'ं': 'ਂ', 'ः': 'ਃ', '्': '੍', '़': '਼',
};

const GURMUKHI_DIACRITIC_REGEX = /[ਁ-ਃ਼ਾ-੍ੑੰੱੵ]/g;

function transliterateDevanagari(text) {
  let out = '';
  for (const ch of text) out += DEVA_TO_GURMUKHI[ch] || ch;
  return out;
}

function normalize(text) {
  if (!text) return '';
  let s = String(text);
  s = transliterateDevanagari(s);
  s = s.toLowerCase();
  s = s.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, ' ');
  s = s.replace(/[।॥]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function normalizeLoose(text) {
  return normalize(text).replace(GURMUKHI_DIACRITIC_REGEX, '');
}

function tokens(text) {
  return normalize(text).split(' ').filter(Boolean);
}

// ── Scoring helpers (mirror matching.service.js) ────────────────────────────

const TRACKED_LINE_MIN = 45; // = min(45, MIN_LINE_CONFIDENCE default 55)

function combinedScore(transcriptNorm, transcriptLoose, candidateNorm, candidateLoose) {
  const full = fuzz.token_set_ratio(transcriptNorm, candidateNorm);
  const loose = fuzz.token_set_ratio(transcriptLoose, candidateLoose);
  return Math.round(full * 0.65 + loose * 0.35);
}

function tokenOverlapScore(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const cand = new Set(candidateTokens);
  let exact = 0;
  let fuzzy = 0;
  for (const q of queryTokens) {
    if (cand.has(q)) {
      exact += 1;
      continue;
    }
    if (
      q.length >= 3 &&
      candidateTokens.some((c) => c.includes(q) || q.includes(c) || fuzz.ratio(q, c) >= 78)
    ) {
      fuzzy += 1;
    }
  }
  return Math.round(((exact + fuzzy * 0.7) / queryTokens.length) * 100);
}

function orderedCueScore(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0;
  let qi = 0;
  let hits = 0;
  for (const cand of candidateTokens) {
    const q = queryTokens[qi];
    if (!q) break;
    if (cand === q || cand.includes(q) || q.includes(cand) || fuzz.ratio(q, cand) >= 82) {
      hits += 1;
      qi += 1;
    }
  }
  return Math.round((hits / queryTokens.length) * 100);
}

function lineCueScore(queryTokens, lineText) {
  const cand = tokens(normalizeLoose(lineText));
  if (!queryTokens.length || !cand.length) return 0;
  const overlap = tokenOverlapScore(queryTokens, cand);
  const ordered = orderedCueScore(queryTokens, cand);
  const joinedQ = queryTokens.join(' ');
  const joinedC = cand.join(' ');
  const partial = joinedQ ? fuzz.partial_ratio(joinedQ, joinedC) : 0;
  return Math.round(Math.max(overlap, ordered * 0.9, partial * 0.75));
}

/**
 * Given a Shabad's verses and a transcript snippet, return the index of the
 * line being sung along with a confidence percentage.
 *
 *   matchLine(verses, transcript, { currentLine })
 *     → { lineIndex, confidence, tracked }
 */
export function matchLine(verses, transcript, opts = {}) {
  if (!Array.isArray(verses) || verses.length === 0) {
    return { lineIndex: -1, confidence: 0, tracked: false };
  }
  const norm = normalize(transcript);
  const loose = normalizeLoose(transcript);
  if (!norm) return { lineIndex: -1, confidence: 0, tracked: false };

  const transcriptToks = tokens(norm);
  const looseToks = tokens(loose);
  const transcriptLen = transcriptToks.length;
  const currentLine = Number.isInteger(Number(opts.currentLine)) ? Number(opts.currentLine) : -1;
  const cueTokens = looseToks.slice(-Math.min(3, Math.max(1, looseToks.length)));

  if (currentLine >= 0 && currentLine < verses.length && cueTokens.length <= 3) {
    const neighborhood = [currentLine, currentLine + 1, currentLine - 1]
      .filter((idx) => idx >= 0 && idx < verses.length);
    const cueScores = neighborhood
      .map((idx) => ({ idx, cue: lineCueScore(cueTokens, verses[idx]?.gurmukhi || '') }))
      .sort((a, b) => b.cue - a.cue);
    const bestCue = cueScores[0];
    const currentCue = cueScores.find((x) => x.idx === currentLine);

    if (
      bestCue &&
      bestCue.idx !== currentLine &&
      bestCue.cue >= (cueTokens.length === 1 ? 88 : 72) &&
      bestCue.cue - (currentCue?.cue || 0) >= (cueTokens.length === 1 ? 22 : 12)
    ) {
      return {
        lineIndex: bestCue.idx,
        confidence: Math.max(0, Math.min(100, bestCue.cue)),
        tracked: true,
      };
    }
  }

  let bestIdx = -1;
  let bestScore = -1;
  const lineScores = [];

  verses.forEach((v, i) => {
    const candNorm = normalize(v.gurmukhi);
    const candLoose = normalizeLoose(v.gurmukhi);
    if (!candNorm) return;

    const score = combinedScore(norm, loose, candNorm, candLoose);
    const overlap = Math.max(
      tokenOverlapScore(transcriptToks, tokens(candNorm)),
      tokenOverlapScore(looseToks, tokens(candLoose))
    );

    const partial = fuzz.partial_ratio(norm, candNorm);
    const candTokLen = tokens(candNorm).length;
    const partialWeight = Math.min(1, candTokLen / Math.max(3, transcriptLen));
    const partialEff = partial * partialWeight;

    let final = Math.round(score * 0.45 + partialEff * 0.25 + overlap * 0.30);

    if (currentLine >= 0) {
      // Anchor to the current line. Forward progression keeps its original
      // bias; backward moves are penalised harder. In a repetitive bani (many
      // lines share words) the common false match is a pull BACK to an earlier
      // identical line, while genuine movement is forward. A real return to an
      // earlier line (e.g. the rahau, sung again) still wins because it lands a
      // clear score margin that overcomes the penalty.
      const delta = i - currentLine;
      const distance = Math.abs(delta);
      if (distance === 0) final += 5;
      else if (delta === 1) final += 4;
      else if (delta === 2) final += 2;
      else if (delta > 0) final -= Math.min(14, (delta - 2) * 2);
      else if (delta === -1) final += 2;
      else if (delta === -2) final -= 4;
      else final -= Math.min(22, (distance - 2) * 4);
    } else if (i === 0) {
      final += 3;
    }

    lineScores[i] = { score: final, overlap };
    if (final > bestScore) {
      bestScore = final;
      bestIdx = i;
    }
  });

  if (currentLine >= 0 && currentLine < verses.length && bestIdx !== currentLine) {
    const current = lineScores[currentLine];
    const best = lineScores[bestIdx];
    const distance = Math.abs(bestIdx - currentLine);
    if (current && best) {
      const margin = best.score - current.score;
      const shortCue = transcriptLen <= 2;
      const farJumpUnclear = distance >= 3 && margin < 8;
      const veryWeakSwitch = shortCue && margin < 4 && current.overlap >= 55;
      if (farJumpUnclear || veryWeakSwitch) {
        bestIdx = currentLine;
        bestScore = current.score;
      }
    }
  }

  return {
    lineIndex: bestIdx,
    confidence: Math.max(0, Math.min(100, bestScore)),
    tracked: bestScore >= TRACKED_LINE_MIN,
  };
}

export default matchLine;
