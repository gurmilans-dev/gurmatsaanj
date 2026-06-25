/**
 * Frontend Gurmukhi helpers — minimal mirror of the backend ones, used only
 * for client-side display/sorting niceties.
 */
export function trimToWords(text, maxWords) {
  if (!text) return '';
  const words = String(text).trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + ' …';
}

const RAHAO_TEXT_RE = /\u0a30\u0a39\u0a3e\u0a09/;
const GURMUKHI_TEXT_RE = /[\u0a00-\u0a7f]/;
const GURMUKHI_WORD_RE = /[\u0a00-\u0a7f]+/g;
const TITLE_WORD_RE = /(?:\u0a30\u0a3e\u0a17|\u0a2e\u0a39\u0a32\u0a3e|\u0a18\u0a30|\u0a2a\u0a3e\u0a24\u0a3f\u0a38\u0a3e\u0a39\u0a40|\u0a2a\u0a3e\u0a24\u0a38\u0a3c\u0a3e\u0a39\u0a40|\u0a2a\u0a3e\u0a24\u0a3f\u0a38\u0a3c\u0a3e\u0a39\u0a40|\u0a2e[\u0a03:]|\u0a2e\u0a03|\u0a38\u0a32\u0a4b\u0a15|\u0a38\u0a32\u0a4b\u0a15\u0a41|\u0a16\u0a3f\u0a06\u0a32|\u0a16\u0a3f\u0a06\u0a32\u0a41|\u0a1a\u0a09\u0a2a\u0a08|\u0a1a\u0a4c\u0a2a\u0a08|\u0a26\u0a4b\u0a39\u0a30\u0a3e|\u0a38\u0a35\u0a48\u0a2f\u0a3e|\u0a38\u0a35\u0a08\u0a2f\u0a3e|\u0a05\u0a25|\u0a38\u0a4d\u0a30\u0a40\s+\u0a2d\u0a17\u0a09\u0a24\u0a40)/;
const TITLE_START_RE = /^(?:\u0a74|\u0a30\u0a3e\u0a17|\u0a30\u0a3e\u0a17\u0a41|\u0a38\u0a32\u0a4b\u0a15|\u0a38\u0a32\u0a4b\u0a15\u0a41|\u0a16\u0a3f\u0a06\u0a32|\u0a16\u0a3f\u0a06\u0a32\u0a41|\u0a1a\u0a09\u0a2a\u0a08|\u0a1a\u0a4c\u0a2a\u0a08|\u0a26\u0a4b\u0a39\u0a30\u0a3e|\u0a38\u0a35\u0a48\u0a2f\u0a3e|\u0a38\u0a35\u0a08\u0a2f\u0a3e|\u0a2a\u0a09\u0a5c\u0a40|\u0a05\u0a25|\u0a38\u0a4d\u0a30\u0a40\s+\u0a2d\u0a17\u0a09\u0a24\u0a40)/;

function gurmukhiWords(text) {
  return String(text || '').match(GURMUKHI_WORD_RE) || [];
}

export function isRahaoLine(text) {
  return RAHAO_TEXT_RE.test(String(text || ''));
}

export function isLikelyIntroLine(text) {
  const raw = String(text || '').trim();
  if (!raw || !GURMUKHI_TEXT_RE.test(raw)) return false;
  if (isRahaoLine(raw)) return false;

  const normalized = raw
    .replace(/[\u0964\u0965]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = gurmukhiWords(normalized);
  const wordCount = words.length;
  if (wordCount === 0) return true;

  const firstPauseIndex = raw.search(/[\u0964\u0965]/);
  if (firstPauseIndex >= 0) {
    const afterPauseWords = gurmukhiWords(raw.slice(firstPauseIndex + 1));
    if (afterPauseWords.length >= 4) return false;
  }

  const shortLine = wordCount <= 8;
  if (TITLE_START_RE.test(normalized) && shortLine) return true;
  if (TITLE_WORD_RE.test(normalized) && shortLine) return true;
  if (/^[\u0a66-\u0a6f0-9\s]+$/.test(normalized)) return true;
  return false;
}

export function getBestMainVerse(verses, meta = {}) {
  const list = Array.isArray(verses) ? verses.filter(Boolean) : [];
  if (!list.length) return null;

  const rahaoVerse = list.find((verse) => isRahaoLine(verse?.gurmukhi));
  if (rahaoVerse) return rahaoVerse;

  const metaMainText = typeof meta?.mainVerse === 'string'
    ? meta.mainVerse
    : meta?.mainVerse?.gurmukhi || meta?.mainGurmukhi || meta?.mainLine || '';
  if (metaMainText && !isLikelyIntroLine(metaMainText)) {
    const matching = list.find((verse) => String(verse?.gurmukhi || '').trim() === String(metaMainText).trim());
    return matching || { gurmukhi: metaMainText };
  }

  return list.find((verse) => {
    const text = verse?.gurmukhi || '';
    return text && !isLikelyIntroLine(text);
  }) || list.find((verse) => verse?.gurmukhi) || list[0] || null;
}

export function getMainVerse(verses, meta) {
  return getBestMainVerse(verses, meta);
}

export function getMainVerseIndex(verses, meta) {
  const list = Array.isArray(verses) ? verses : [];
  const mainVerse = getBestMainVerse(list, meta);
  if (!mainVerse) return -1;

  const identityIndex = list.indexOf(mainVerse);
  if (identityIndex >= 0) return identityIndex;

  const mainText = String(mainVerse.gurmukhi || '').trim();
  if (!mainText) return -1;
  return list.findIndex((verse) => String(verse?.gurmukhi || '').trim() === mainText);
}

export function displayLineForEntry(item) {
  return item?.mainGurmukhi || item?.displayGurmukhi || item?.gurmukhi || item?.firstGurmukhi || '';
}

export function confidenceLabel(c) {
  if (c >= 85) return 'Very likely';
  if (c >= 70) return 'Likely';
  if (c >= 55) return 'Possible';
  return 'Weak match';
}

// === Search-match highlighting ==========================================

const GURMUKHI_RE = /[਀-੿]/;

function stripGurmukhiMatra(s) {
  // Remove matras / nukta / addak / tippi for loose matching
  return s.replace(/[਼਻਽ਾਿੀੁੂੇੈੋੌ੍ੰੱ॥।]/g, '');
}

function normalizeRomanToken(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}
function normalizeGurmukhiToken(s) {
  return stripGurmukhiMatra(String(s));
}

function isInitialsQuery(q, mode) {
  if (mode === 'initials') return true;
  if (mode === 'words') return false;
  if (!q) return false;
  if (GURMUKHI_RE.test(q)) return false;
  const stripped = q.trim().replace(/\s+/g, '');
  if (stripped.length < 2 || stripped.length > 8) return false;
  return /^[a-z]+$/i.test(stripped) && !q.trim().includes(' ');
}

/**
 * Compute the indices of words in `align` (a candidate Gurmukhi or
 * transliteration string) that match the user's query. The returned Set can
 * then be used to highlight the same positions in a parallel string —
 * BaniDB returns Gurmukhi and transliteration with the same word ordering.
 */
export function matchedWordPositions(align, query, mode = 'auto') {
  const out = new Set();
  if (!align || !query) return out;
  const alignWords = String(align).split(/\s+/).filter(Boolean);
  const alignIsGurmukhi = GURMUKHI_RE.test(align);
  const norm = alignIsGurmukhi ? normalizeGurmukhiToken : normalizeRomanToken;

  // Initials mode (e.g. "mjjj") — works against transliteration only.
  if (isInitialsQuery(query, mode)) {
    if (alignIsGurmukhi) return out; // no Gurmukhi initials matching here
    const letters = query.toLowerCase().replace(/\s+/g, '').split('');
    let li = 0;
    for (let i = 0; i < alignWords.length && li < letters.length; i++) {
      const w = norm(alignWords[i]);
      if (!w) continue;
      if (w[0] === letters[li]) { out.add(i); li += 1; }
    }
    return out;
  }

  // Word mode — exact / prefix / contains.
  const qWords = String(query).split(/\s+/).map(norm).filter(Boolean);
  if (qWords.length === 0) return out;
  for (let i = 0; i < alignWords.length; i++) {
    const cw = norm(alignWords[i]);
    if (!cw) continue;
    for (const qw of qWords) {
      if (cw === qw || (qw.length >= 2 && cw.startsWith(qw)) || (qw.length >= 3 && cw.includes(qw))) {
        out.add(i);
        break;
      }
    }
  }
  return out;
}

/**
 * Walk `text` and return [{ text, match }] segments. Whitespace is preserved
 * verbatim and never marked as a match.
 */
export function highlightSegments(text, matchedSet) {
  if (!text) return [];
  if (!matchedSet || matchedSet.size === 0) return [{ text, match: false }];
  const tokens = String(text).split(/(\s+)/);
  const out = [];
  let idx = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    if (!tok.trim()) {
      out.push({ text: tok, match: false });
      continue;
    }
    out.push({ text: tok, match: matchedSet.has(idx++) });
  }
  return out;
}
