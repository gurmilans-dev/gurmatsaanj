/**
 * Gurmukhi normalization helpers.
 *
 * Voice recognition (especially Web Speech API in pa-IN / hi-IN) returns
 * imperfect transcriptions: missing nukta marks, swapped vowels, occasional
 * Devanagari letters when the engine confuses Punjabi for Hindi, etc.
 *
 * To make fuzzy matching robust, we:
 *  1. strip vowel signs and diacritics that are commonly missed,
 *  2. transliterate Devanagari → Gurmukhi when possible,
 *  3. collapse whitespace.
 *
 * The same normalization is applied to the corpus side, so that comparisons
 * are apples-to-apples.
 */

// Devanagari → Gurmukhi mapping for the most common consonants/vowels that
// the speech engine sometimes returns instead of Punjabi script.
const DEVA_TO_GURMUKHI = {
  // vowels
  'अ': 'ਅ', 'आ': 'ਆ', 'इ': 'ਇ', 'ई': 'ਈ', 'उ': 'ਉ', 'ऊ': 'ਊ',
  'ए': 'ਏ', 'ऐ': 'ਐ', 'ओ': 'ਓ', 'औ': 'ਔ',
  // consonants
  'क': 'ਕ', 'ख': 'ਖ', 'ग': 'ਗ', 'घ': 'ਘ', 'ङ': 'ਙ',
  'च': 'ਚ', 'छ': 'ਛ', 'ज': 'ਜ', 'झ': 'ਝ', 'ञ': 'ਞ',
  'ट': 'ਟ', 'ठ': 'ਠ', 'ड': 'ਡ', 'ढ': 'ਢ', 'ण': 'ਣ',
  'त': 'ਤ', 'थ': 'ਥ', 'द': 'ਦ', 'ध': 'ਧ', 'न': 'ਨ',
  'प': 'ਪ', 'फ': 'ਫ', 'ब': 'ਬ', 'भ': 'ਭ', 'म': 'ਮ',
  'य': 'ਯ', 'र': 'ਰ', 'ल': 'ਲ', 'व': 'ਵ', 'श': 'ਸ਼',
  'ष': 'ਸ਼', 'स': 'ਸ', 'ह': 'ਹ',
  // matras
  'ा': 'ਾ', 'ि': 'ਿ', 'ी': 'ੀ', 'ु': 'ੁ', 'ू': 'ੂ',
  'े': 'ੇ', 'ै': 'ੈ', 'ो': 'ੋ', 'ौ': 'ੌ',
  // others
  'ं': 'ਂ', 'ः': 'ਃ', '्': '੍', '़': '਼',
};

// Diacritics / vowel signs in Gurmukhi block (U+0A00–U+0A7F) to strip when
// computing the loose form. Keeping the base consonants only gives a far more
// stable similarity score against speech transcripts.
const GURMUKHI_DIACRITIC_REGEX = /[\u0A01-\u0A03\u0A3C\u0A3E-\u0A4D\u0A51\u0A70\u0A71\u0A75]/g;

function transliterateDevanagari(text) {
  let out = '';
  for (const ch of text) {
    out += DEVA_TO_GURMUKHI[ch] || ch;
  }
  return out;
}

/**
 * Normalize a Gurmukhi (or near-Gurmukhi) string for fuzzy matching.
 */
function normalize(text) {
  if (!text) return '';
  let s = String(text);
  s = transliterateDevanagari(s);
  s = s.toLowerCase();
  // Strip ASCII punctuation
  s = s.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, ' ');
  // Strip Gurmukhi punctuation
  s = s.replace(/[।॥]/g, ' ');
  // Collapse repeated whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Loose normalization — strips vowel signs as well. Use this as a fallback
 * scoring channel; speech recognition often gets the consonants right but
 * misplaces vowels.
 */
function normalizeLoose(text) {
  return normalize(text).replace(GURMUKHI_DIACRITIC_REGEX, '');
}

/**
 * Tokenize a normalized Gurmukhi line into words.
 */
function tokens(text) {
  return normalize(text).split(' ').filter(Boolean);
}

/**
 * Returns true if a string contains at least one Unicode Gurmukhi codepoint
 * (block U+0A00 – U+0A7F). BaniDB sometimes returns the legacy AnmolLipi /
 * GurbaniAkhar ASCII-font encoding (looks like "rwgu gauVI") in fields named
 * `gurmukhi`, and the real Unicode in `unicode`. We use this to pick the
 * correct one without trusting field names blindly.
 */
function isUnicodeGurmukhi(s) {
  if (!s || typeof s !== 'string') return false;
  return /[\u0A00-\u0A7F]/.test(s);
}

/**
 * Resolve the best Gurmukhi-Unicode label out of a BaniDB sub-object that may
 * contain `unicode`, `gurmukhi`, `gurmukhiUni`, and `english` fields.
 * Falls back to English if no field is real Unicode Gurmukhi.
 */
function pickUnicode(obj) {
  if (!obj) return null;
  if (isUnicodeGurmukhi(obj.unicode))    return obj.unicode;
  if (isUnicodeGurmukhi(obj.gurmukhiUni)) return obj.gurmukhiUni;
  if (isUnicodeGurmukhi(obj.gurmukhi))   return obj.gurmukhi;
  return obj.english || obj.gurmukhi || null;
}

module.exports = {
  normalize,
  normalizeLoose,
  tokens,
  transliterateDevanagari,
  isUnicodeGurmukhi,
  pickUnicode,
};
