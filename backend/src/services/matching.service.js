/**
 * Matching service — turns raw transcribed text into:
 *   1. a ranked list of candidate Shabads with confidence scores, and
 *   2. for a chosen Shabad, the index of the line currently being sung.
 *
 * Spelling tolerance & "always show something" strategy:
 *   - Try BaniDB search with a tail of the transcript.
 *   - If zero hits, progressively shorten the tail (6 → 4 → 3 → 2 words).
 *   - Also try a Roman first-letter projection of the transcript ("man jeetai
 *     jag jeet" → "mjjj") which BaniDB's first-letter search handles natively.
 *   - Re-rank everything we collected with dual-channel fuzzy matching
 *     (full + vowel-stripped) so misspellings still surface the right Shabad.
 *   - When confidence is low, we mark the suggestions as "best guess" rather
 *     than dropping them — better than an empty UI.
 */
const fuzz = require('fuzzball');

const banidb = require('./banidb.service');
const { normalize, normalizeLoose, tokens } = require('../utils/gurmukhi');
const config = require('../config');

const MIN_QUERY_TOKENS = 2;
const TRACKED_LINE_MIN = Math.min(45, config.matching.minLineConfidence);
const LIVE_SEARCH_TIMEOUT_MS = 3500;

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve([]), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Combine two scoring channels into a single 0..100 confidence.
 * Loose match (vowels stripped) is weighted slightly less than full match.
 */
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
      candidateTokens.some((c) =>
        c.includes(q) ||
        q.includes(c) ||
        fuzz.ratio(q, c) >= 78
      )
    ) {
      fuzzy += 1;
    }
  }
  return Math.round(((exact + fuzzy * 0.7) / queryTokens.length) * 100);
}

function searchWindows(toks) {
  const windows = [];
  const add = (phrase) => {
    if (phrase && !windows.includes(phrase)) windows.push(phrase);
  };
  const sizes = [Math.min(6, toks.length), 5, 4, 3, 2, 1].filter((n) => n > 0 && n <= toks.length);
  for (const size of sizes) {
    for (let start = Math.max(0, toks.length - 8); start <= toks.length - size; start += 1) {
      const slice = toks.slice(start, start + size);
      add(slice.join(' '));
      if (slice.length >= 3) {
        // If one recognized word is wrong, search the phrase with each word
        // omitted once. "mitar pyaare nu X" can still match "pyaare nu".
        for (let drop = 0; drop < slice.length; drop += 1) {
          add(slice.filter((_, i) => i !== drop).join(' '));
        }
      }
    }
  }
  return windows
    .filter((w) => w.split(/\s+/).some((t) => t.length >= 3 || /[\u0A00-\u0A7F]/.test(t)))
    .slice(0, 24);
}

function orderedCueScore(queryTokens, candidateTokens) {
  if (!queryTokens.length || !candidateTokens.length) return 0;
  let qi = 0;
  let hits = 0;
  for (const cand of candidateTokens) {
    const q = queryTokens[qi];
    if (!q) break;
    if (
      cand === q ||
      cand.includes(q) ||
      q.includes(cand) ||
      fuzz.ratio(q, cand) >= 82
    ) {
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
 * Project a Gurmukhi or romanized phrase to its first-letter shorthand.
 * "man jeetai jag jeet" → "mjjj"
 * "ਮਨ ਜੀਤੈ ਜਗੁ ਜੀਤੁ"   → "ਮਜਜਜ"
 */
function firstLetters(text) {
  return tokens(text)
    .map((w) => Array.from(w)[0] || '')
    .join('');
}

/**
 * Deduplicate candidates by shabadId while preserving order.
 */
function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const c of arr) {
    const k = c.shabadId;
    if (k == null || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * Find candidate Shabads matching a transcribed snippet, with cascading
 * fallbacks so we almost always return something.
 *
 * Two improvements that matter for live kirtan:
 *   - Sliding window: only the last ~14 transcribed words are considered.
 *     Speech recognition accumulates across verses and stale words from
 *     earlier lines drown out the current line. Capping the window keeps
 *     suggestions tracking what's being sung *now*.
 *   - Parallel searches: word-windows and first-letter projections (6/4/3
 *     letters) all fire concurrently instead of cascading. This typically
 *     halves end-to-end latency and gives matra-tolerant first-letter hits
 *     equal weight with full-word hits, so a one-matra error doesn't
 *     evict the right shabad.
 */
async function matchShabads(transcript, filters = {}) {
  const norm = normalize(transcript);
  const allToks = tokens(norm);
  if (allToks.length < MIN_QUERY_TOKENS) return [];

  // Sliding window — only the most recent words matter.
  const toks = allToks.slice(-14);

  // First-letter projections of decreasing size. Multiple sizes give us
  // more chances to ride past a single mistranscribed first letter.
  // We also include "leading word dropped" variants — e.g. if the user said
  // "ਤਰ ਪਿਆਰੇ ਨੂੰ ਹਾਲ ਮੁਰੀਦਾਂ ਦਾ" and the engine missed the real first word
  // ("ਮਿਤ੍ਰ"), the projection of the last 6 words ("ਪਨਹਮਦ…") still matches
  // shabads where those letters appear later in the line.
  const flSizes = [7, 6, 5, 4, 3];
  const flQueries = [];
  const addFl = (fl) => {
    if (fl && fl.length >= 3 && fl.length <= 8 && !flQueries.includes(fl)) {
      flQueries.push(fl);
    }
  };
  for (const n of flSizes) {
    const slice = toks.slice(-n);
    addFl(firstLetters(slice.join(' ')));
    if (slice.length >= 4) {
      // Drop the leading word — recovers the right shabad when the speech
      // engine mistranscribed the first word of the user's phrase.
      addFl(firstLetters(slice.slice(1).join(' ')));
    }
  }

  // Run word-window searches AND first-letter searches in parallel.
  const settle = (p) => withTimeout(p, LIVE_SEARCH_TIMEOUT_MS)
    .then((v) => (Array.isArray(v) ? v : []))
    .catch(() => []);
  const wordPhrases = searchWindows(toks).slice(0, 8); // bound the fan-out
  const wordPromises = wordPhrases.map((phrase) =>
    settle(banidb.rawSearch(phrase, {
      ...filters,
      searchType: banidb.detectSearchType(phrase),
    }))
  );
  const flPromises = [];
  for (const fl of flQueries) {
    flPromises.push(settle(banidb.rawSearch(fl, { ...filters, searchType: 0 })));
    flPromises.push(settle(banidb.rawSearch(fl, { ...filters, searchType: 7 })));
  }

  const [wordResults, flResults] = await Promise.all([
    Promise.all(wordPromises),
    Promise.all(flPromises),
  ]);

  let candidates = [];
  for (const list of wordResults) candidates = candidates.concat(list);
  for (const list of flResults)   candidates = candidates.concat(list);

  candidates = dedupe(candidates);
  if (candidates.length === 0) return [];

  // 2b. Client-side safety filter — BaniDB occasionally ignores filter params
  // for first-letter searches, so we drop anything that doesn't match the
  // requested source/writer/raag. We only filter when we have a candidate ID
  // to compare against (skip if both sides are missing rather than nuke the
  // results).
  const wantSource = filters.source ? String(filters.source) : null;
  const wantWriter = filters.writer != null && filters.writer !== '' ? String(filters.writer) : null;
  const wantRaag   = filters.raag   != null && filters.raag   !== '' ? String(filters.raag)   : null;
  if (wantSource || wantWriter || wantRaag) {
    candidates = candidates.filter((c) => {
      if (wantSource && c.sourceId != null && String(c.sourceId) !== wantSource) return false;
      if (wantWriter && c.writerId != null && String(c.writerId) !== wantWriter) return false;
      if (wantRaag   && c.raagId   != null && String(c.raagId)   !== wantRaag)   return false;
      return true;
    });
    if (candidates.length === 0) return [];
  }

  // 3. Re-rank with fuzzy matching — score against the SAME sliding window
  // we used for searching, so the confidence reflects current alignment, not
  // a 5-minute-old accumulated transcript.
  const recentNorm  = toks.join(' ');
  const recentLoose = normalizeLoose(recentNorm);
  const queryTokens = tokens(recentLoose);
  const scored = candidates.map((c) => {
    const candNorm = normalize(c.gurmukhi);
    const candLoose = normalizeLoose(c.gurmukhi);
    const translitNorm = normalize(c.transliteration);
    const translitLoose = normalizeLoose(c.transliteration);
    const scriptScore = combinedScore(recentNorm, recentLoose, candNorm, candLoose);
    const romanScore = translitNorm ? combinedScore(recentNorm, recentLoose, translitNorm, translitLoose) : 0;
    const overlap = Math.max(
      tokenOverlapScore(queryTokens, tokens(candLoose)),
      tokenOverlapScore(queryTokens, tokens(translitLoose))
    );
    const confidence = Math.round(Math.max(scriptScore, romanScore) * 0.65 + overlap * 0.35);
    return { ...c, confidence };
  });

  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, config.matching.maxSuggestions);
}

/**
 * Given a Shabad and a transcript snippet, return the index of the line being
 * sung along with a confidence percentage.
 */
function matchLine(verses, transcript, opts = {}) {
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
      .map((idx) => ({
        idx,
        cue: lineCueScore(cueTokens, verses[idx]?.gurmukhi || ''),
      }))
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

    // Combined fuzzy score (full + loose), weighted as in matchShabads
    const score = combinedScore(norm, loose, candNorm, candLoose);
    const overlap = Math.max(
      tokenOverlapScore(transcriptToks, tokens(candNorm)),
      tokenOverlapScore(looseToks, tokens(candLoose))
    );

    // Partial ratio rewards the verse appearing as a substring of the transcript
    // (singer is on this line). Cap its weight so very short verses don't get
    // free 100s and lock the cursor in place.
    const partial = fuzz.partial_ratio(norm, candNorm);
    const candTokLen = tokens(candNorm).length;
    // partial_ratio is unreliable when the verse is much shorter than the
    // transcript window — discount it proportionally.
    const partialWeight = Math.min(1, candTokLen / Math.max(3, transcriptLen));
    const partialEff = partial * partialWeight;

    let final = Math.round(score * 0.45 + partialEff * 0.25 + overlap * 0.30);

    // Nearby-line bias: still prefer the current line / its neighbours when
    // scores are close, but with a SMALL boost so a clear move to the next
    // line wins after just one or two words. The earlier large boost was
    // making the cursor lag 3-4 words behind the singer.
    if (currentLine >= 0) {
      // Anchor to the current line. Forward progression keeps its original
      // bias; backward moves are penalised harder. In a repetitive bani (many
      // lines share words) the common false match is a pull BACK to an earlier
      // identical line, while genuine movement is forward. A real return to an
      // earlier line (e.g. the rahau, sung again) still wins because it lands a
      // clear score margin that overcomes the penalty.
      // KEEP IN SYNC with frontend/src/utils/matchLine.js.
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
      // Only pin to the current line for FORWARD/BACKWARD moves > 1 line
      // when the cue is very short and the current line still scores well.
      // A 1-line forward move (the common case in kirtan) is allowed once
      // the new line's score barely exceeds the current line's.
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

module.exports = { matchShabads, matchLine, firstLetters };
