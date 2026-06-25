/**
 * BaniDB service — thin, cached HTTP client over https://api.banidb.com/v2
 *
 * BaniDB responses contain BOTH a legacy AnmolLipi/GurbaniAkhar ASCII-font
 * encoding (in fields named `gurmukhi`) AND proper Unicode Gurmukhi (in
 * fields named `unicode`, sometimes `gurmukhiUni`). We always pick the
 * Unicode form via `pickUnicode()` so the UI never displays garbled glyphs.
 */
const axios = require('axios');
const config = require('../config');
const { pickUnicode, isUnicodeGurmukhi } = require('../utils/gurmukhi');
const fallback = require('./banidb.fallback');

const http = axios.create({
  baseURL: config.banidb.baseUrl,
  timeout: config.banidb.timeoutMs,
  headers: { 'Accept': 'application/json' },
});

// --- Cheap in-memory cache for slow-changing endpoints --------------------
const cache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.t > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.v;
}
function setCached(key, value) {
  cache.set(key, { v: value, t: Date.now() });
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableUpstreamError(err) {
  const status = Number(err?.response?.status || 0);
  return !err?.response || err.code === 'ECONNABORTED' || status === 429 || status >= 500;
}

async function getWithRetry(path, options = {}, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await http.get(path, options);
    } catch (err) {
      lastErr = err;
      if (!isRetryableUpstreamError(err) || i === attempts - 1) break;
      await sleep(250 * (i + 1));
    }
  }
  throw lastErr;
}

function upstreamError(err, message) {
  const status = Number(err?.response?.status || 0);
  const out = new Error(status === 404 ? 'Shabad not found.' : message);
  out.status = status === 404 ? 404 : 502;
  out.expose = true;
  return out;
}

// --- Shape helpers --------------------------------------------------------

/**
 * Coerce a BaniDB translation/transliteration field into a string.
 * The API sometimes returns a string, sometimes a nested object like
 * { gurmukhi, unicode, text, ... }. We normalize to a single string,
 * preferring real Unicode Gurmukhi for Punjabi translations.
 */
function asString(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object') {
    if (typeof field.unicode === 'string' && field.unicode) return field.unicode;
    if (typeof field.gurmukhi === 'string' && field.gurmukhi) return field.gurmukhi;
    if (typeof field.text === 'string' && field.text) return field.text;
    if (typeof field.default === 'string' && field.default) return field.default;
    if (typeof field.english === 'string' && field.english) return field.english;
    // Some BaniDB endpoints nest a level deeper (e.g. { en: { text: ... } }).
    if (field.en && typeof field.en === 'object') {
      if (typeof field.en.text === 'string' && field.en.text) return field.en.text;
      if (typeof field.en === 'string' && field.en) return field.en;
    }
    if (field.english && typeof field.english === 'object') {
      if (typeof field.english.text === 'string' && field.english.text) return field.english.text;
    }
  }
  return '';
}

/**
 * Pull the transliteration string out of a verse/shabad object across the
 * several shapes BaniDB returns:
 *   { transliteration: "..." }                      // plain string
 *   { transliteration: { english: { text: "..." } } } // nested object
 *   { transliteration: { en: { text: "..." } } }
 *   { transliteration: { english: "..." } }
 *   { translit: "..." }                              // legacy
 *   { transliteration: { unicode: "..." } }          // very old
 */
function pickTransliteration(obj) {
  if (!obj) return '';
  const t = obj.transliteration;
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') {
    return asString(t.english?.text)
        || asString(t.en?.text)
        || asString(t.english)
        || asString(t.en)
        || asString(t.text)
        || asString(t.unicode)
        || asString(t);
  }
  return asString(obj.translit);
}

/**
 * Extract vishraam (mid-line pause) word indices from a BaniDB verse.
 * BaniDB exposes curated pause annotations under `visraam.<source>` where
 * each entry is `{ p: wordIndex, t: 'v' | 'y' }`:
 *   - 'v' = full vishraam (the strong pause word, painted in kesari)
 *   - 'y' = yamki / lighter pause (painted in a softer tint)
 *
 * Multiple annotation sources are available (sttm, igurbani, sttm2).
 * We prefer SikhiToTheMax (most commonly used in kirtan), then fall back.
 */
function extractVishraams(v) {
  const sources = [v.visraam?.sttm, v.visraam?.igurbani, v.visraam?.sttm2];
  for (const list of sources) {
    if (Array.isArray(list) && list.length > 0) {
      return list
        .filter((it) => it && Number.isInteger(Number(it.p)))
        .map((it) => ({ p: Number(it.p), t: it.t === 'y' ? 'y' : 'v' }));
    }
  }
  return [];
}

function pickId(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    if (obj[key] != null) return obj[key];
  }
  return null;
}

function pickEntityLabel(field) {
  if (!field) return null;
  if (typeof field === 'string') return field;
  return pickUnicode(field) || pickUnicode(field.name) || field.nameEnglish || field.english || field.name || null;
}

function pickEntityId(container, key, idKeys) {
  return pickId(container?.[key], idKeys) ?? pickId(container, idKeys) ?? null;
}

function pickShabadId(v) {
  return pickId(v, ['shabadId', 'shabadid', 'shabad_id', 'shabad']) ??
    pickId(v.shabad, ['shabadId', 'shabadid', 'id']) ??
    pickId(v.verse, ['shabadId', 'shabadid', 'shabad_id']) ??
    pickId(v.meta, ['shabadId', 'shabadid', 'shabad_id']) ??
    null;
}

function pickPageNo(v) {
  return pickId(v, ['pageNo', 'pageno', 'page_no', 'ang', 'page']) ??
    pickId(v.page, ['pageNo', 'pageno', 'ang', 'no', 'number']) ??
    pickId(v.verse, ['pageNo', 'pageno', 'page_no', 'ang']) ??
    pickId(v.meta, ['pageNo', 'pageno', 'page_no', 'ang']) ??
    null;
}

function pickLineNo(v) {
  return pickId(v, ['lineNo', 'lineno', 'line_no', 'verseNo', 'verseno']) ??
    pickId(v.line, ['lineNo', 'lineno', 'no', 'number']) ??
    pickId(v.verse, ['lineNo', 'lineno', 'line_no', 'verseNo', 'verseno']) ??
    pickId(v.meta, ['lineNo', 'lineno', 'line_no']) ??
    null;
}

// "Rahao" is the central-theme verse of a SGGS shabad, marked inline by the
// literal Gurmukhi token ਰਹਾਉ (sometimes ਰਹਾਉ ਦੂਜਾ for a second one). BaniDB
// doesn't expose a structural field for this — we detect it from the text.
const RAHAO_MARKER_RE = /ਰਹਾਉ/;

function shapeVerse(v) {
  const verseGurmukhi =
    isUnicodeGurmukhi(v.verse?.unicode) ? v.verse.unicode :
    isUnicodeGurmukhi(v.verse?.gurmukhi) ? v.verse.gurmukhi :
    isUnicodeGurmukhi(v.unicode) ? v.unicode :
    isUnicodeGurmukhi(v.gurmukhi) ? v.gurmukhi : '';

  return {
    isRahao: RAHAO_MARKER_RE.test(verseGurmukhi),
    shabadId: pickShabadId(v),
    verseId: v.verseId ?? v.verseid ?? null,
    lineNo: pickLineNo(v),
    pageNo: pickPageNo(v),
    gurmukhi: verseGurmukhi,
    vishraams: extractVishraams(v),
    transliteration: pickTransliteration(v),
    translationEn:
      asString(v.translation?.en?.bdb) ||
      asString(v.translation?.english?.default) ||
      asString(v.translation?.en?.ssk) ||
      '',
    translationPa:
      asString(v.translation?.pu?.ss) ||
      asString(v.translation?.punjabi?.default) ||
      asString(v.translation?.pu?.ss?.unicode) ||
      '',
    // Per-steek Punjabi translations. The selector in the reader picks one
    // of these via display.punjabiSteek; the renderer falls back through
    // ss → bdb → ms → ft when the chosen channel is empty for a verse.
    //   ss  — Prof. Sahib Singh (Sri Guru Granth Sahib Darpan)
    //   ft  — Faridkot Teeka (archaic Brij-Punjabi, scholarly)
    //   ms  — Bhai Manmohan Singh (concise modern Punjabi)
    //   bdb — BaniDB default (mirrors `ss` for SGGS, sometimes the only
    //         channel for Dasam Granth content)
    translationPaChannels: {
      ss:  asString(v.translation?.pu?.ss),
      ft:  asString(v.translation?.pu?.ft),
      ms:  asString(v.translation?.pu?.ms),
      bdb: asString(v.translation?.pu?.bdb),
    },
    raag: pickEntityLabel(v.raag),
    writer: pickEntityLabel(v.writer),
    source: pickEntityLabel(v.source),
    sourceId: pickEntityId(v, 'source', ['sourceId', 'sourceid', 'source_id', 'id']),
    writerId: pickEntityId(v, 'writer', ['writerId', 'writerid', 'writer_id', 'id']),
    raagId: pickEntityId(v, 'raag', ['raagId', 'raagid', 'raag_id', 'id']),
  };
}

function shapeShabadHeader(s) {
  const gurmukhi =
    isUnicodeGurmukhi(s.verse?.unicode) ? s.verse.unicode :
    isUnicodeGurmukhi(s.verse?.gurmukhi) ? s.verse.gurmukhi :
    isUnicodeGurmukhi(s.unicode) ? s.unicode :
    isUnicodeGurmukhi(s.gurmukhi) ? s.gurmukhi : '';

  return {
    shabadId: s.shabadId ?? s.shabadid ?? s.shabad?.shabadId ?? s.shabad?.shabadid ?? null,
    verseId: s.verseId ?? s.verseid ?? null,
    lineNo: pickLineNo(s),
    pageNo: pickPageNo(s),
    gurmukhi,
    vishraams: extractVishraams(s),
    transliteration: pickTransliteration(s),
    translationEn:
      asString(s.translation?.en?.bdb) ||
      asString(s.translation?.english?.default) ||
      asString(s.translation?.en?.ssk) ||
      '',
    translationPa:
      asString(s.translation?.pu?.ss) ||
      asString(s.translation?.punjabi?.default) ||
      asString(s.translation?.pu?.ss?.unicode) ||
      '',
    raag: pickEntityLabel(s.raag),
    writer: pickEntityLabel(s.writer),
    source: pickEntityLabel(s.source),
    sourceId: pickEntityId(s, 'source', ['sourceId', 'sourceid', 'source_id', 'id']),
    writerId: pickEntityId(s, 'writer', ['writerId', 'writerid', 'writer_id', 'id']),
    raagId: pickEntityId(s, 'raag', ['raagId', 'raagid', 'raag_id', 'id']),
  };
}

function dedupeVerses(verses) {
  const seen = new Set();
  const out = [];
  for (const verse of verses || []) {
    if (!verse?.gurmukhi) continue;
    const key = [
      verse.verseId || '',
      verse.shabadId || '',
      verse.lineNo || '',
      verse.gurmukhi,
    ].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(verse);
  }
  return out;
}

function extractVerseArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const candidates = [
    data.verses,
    data.lines,
    data.results,
    data.page?.verses,
    data.page?.lines,
    data.ang?.verses,
    data.ang?.lines,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

async function tryDirectAng(pageNo, opts = {}) {
  const params = {};
  if (opts.source) params.source = opts.source;
  const paths = [
    `/angs/${encodeURIComponent(pageNo)}`,
    `/ang/${encodeURIComponent(pageNo)}`,
    `/pages/${encodeURIComponent(pageNo)}`,
    `/page/${encodeURIComponent(pageNo)}`,
  ];

  for (const path of paths) {
    try {
      const { data } = await getWithRetry(path, { params }, 1);
      const verses = extractVerseArray(data).map(shapeVerse).filter((v) => v.gurmukhi);
      if (verses.length > 0) return verses;
    } catch {
      // BaniDB has changed Ang endpoint names over time; try the next shape.
    }
  }
  return [];
}

function orderAngVerses(verses, pageRows, pageNo) {
  const orderByShabad = new Map();
  (pageRows || []).forEach((row, index) => {
    const key = String(row?.shabadId || '');
    if (key && !orderByShabad.has(key)) orderByShabad.set(key, index);
  });

  return dedupeVerses(verses)
    .filter((v) => Number(v.pageNo) === pageNo || v.pageNo == null)
    .sort((a, b) => {
      const aOrder = orderByShabad.has(String(a.shabadId || ''))
        ? orderByShabad.get(String(a.shabadId || ''))
        : 9999;
      const bOrder = orderByShabad.has(String(b.shabadId || ''))
        ? orderByShabad.get(String(b.shabadId || ''))
        : 9999;
      if (aOrder !== bOrder) return aOrder - bOrder;

      const lineA = Number(a.lineNo || 0);
      const lineB = Number(b.lineNo || 0);
      if (lineA !== lineB) return lineA - lineB;
      return String(a.shabadId || '').localeCompare(String(b.shabadId || ''));
    });
}

// --- Search type detection ------------------------------------------------
/**
 * BaniDB v2 search types we care about:
 *   0 → first-letter from start
 *   2 → full-word Gurmukhi
 *   4 → romanized full-word
 *   7 → romanized first-letter anywhere
 *
 * Important: searchtype 5 is Ang/page search, so never include it in generic
 * fallbacks. Letting a text query cascade to 5 can return an entire Ang.
 */
function detectSearchType(query) {
  const q = String(query || '').trim();
  if (!q) return 0;

  // Pure Gurmukhi text → full-word Gurmukhi
  if (isUnicodeGurmukhi(q)) return 2;

  // Single spaceless Roman token: distinguish first-letter shorthand from a
  // real word. Shorthand is consonant-dominant ("mjjj", "mpnhmd", "tvnl");
  // a real word ("waheguru", "nanak", "satnaam") has vowels interspersed.
  // Vowel-rich tokens → romanized word (4); otherwise first-letter (0). The
  // search() cascade still falls back to the other type if this finds nothing,
  // so a wrong guess self-corrects — but the leading type (and the "interpreted
  // as" label the user sees) is now right far more often.
  if (!q.includes(' ')) {
    const cleaned = q.toLowerCase().replace(/[^a-z]/g, '');
    if (cleaned.length < 2 || cleaned.length > 12) return 0;
    const vowels = (cleaned.match(/[aeiou]/g) || []).length;
    const looksLikeWord = vowels >= 2 && cleaned.length >= 4;
    return looksLikeWord ? 4 : 0;
  }

  // Multi-word Roman → romanized full-word
  if (q.split(/\s+/).length >= 2) return 4;
  return 0;
}

// --- Public methods -------------------------------------------------------
async function rawSearch(query, opts = {}) {
  const params = { q: query };
  if (opts.source) params.source = opts.source;
  if (opts.writer) params.writer = opts.writer;
  if (opts.raag)   params.raag   = opts.raag;
  if (opts.searchType !== undefined && opts.searchType !== null) {
    params.searchtype = opts.searchType;
  }
  const cacheKey = `search:${JSON.stringify(params)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const { data } = await getWithRetry(`/search/${encodeURIComponent(query)}`, { params });
  const list = Array.isArray(data?.verses) ? data.verses : [];
  return setCached(cacheKey, list.map(shapeShabadHeader));
}

/**
 * Search with smart fallbacks: if the detected search type returns nothing,
 * cascade through other types so the user rarely sees an empty page.
 *
 * Special case: type 5 is Ang/page lookup. We never cascade away from it —
 * "138" can't sensibly fall back to first-letter or word search.
 */
async function search(query, opts = {}) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];

  const detected = opts.searchType !== undefined && opts.searchType !== null
    ? Number(opts.searchType)
    : detectSearchType(trimmed);

  if (detected === 5) {
    try {
      return await rawSearch(trimmed, { ...opts, searchType: 5 });
    } catch {
      return [];
    }
  }

  const cascade = Array.from(new Set([detected, 0, 7, 4, 2]));
  const runCascade = async (q) => {
    for (const t of cascade) {
      try {
        const res = await rawSearch(q, { ...opts, searchType: t });
        if (res.length > 0) return res;
      } catch { /* try next type */ }
    }
    return [];
  };

  // Primary attempt on the full query.
  const primary = await runCascade(trimmed);
  if (primary.length > 0) return primary;

  // Roman spelling normalization. BaniDB romanizes ਵ as 'v' (e.g. ਵਾਹਿਗੁਰੂ →
  // "vaahiguroo"), but users overwhelmingly type 'w' ("waheguru"). Gurmukhi ਵ
  // has no v/w distinction, so mapping w→v is always safe and recovers the
  // entire class of w-spelled roman queries that otherwise return nothing.
  if (!isUnicodeGurmukhi(trimmed) && /w/i.test(trimmed)) {
    const vForm = trimmed.replace(/w/gi, 'v');
    if (vForm !== trimmed) {
      const res = await runCascade(vForm);
      if (res.length > 0) return res;
    }
  }

  // Word-subset fallback. BaniDB full-word search is a strict AND across the
  // query words, so an exact multi-word phrase can return NOTHING even when
  // each word exists and the shabad exists (e.g. "ਮਿਤ੍ਰ ਪਿਆਰੇ ਨੂੰ" returns 0,
  // though "ਮਿਤ੍ਰ" and "ਮੁਰੀਦਾਂ" each match it). Retry with the phrase trimmed
  // down so we still surface the shabad; the controller's fuzzy re-rank then
  // floats the closest full-phrase match back to the top. Only runs when the
  // full query came up empty, and rawSearch is cached, so the extra calls are
  // cheap and bounded.
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const variants = [];
    const addVariant = (slice) => {
      const v = slice.join(' ').trim();
      if (v && v !== trimmed && !variants.includes(v)) variants.push(v);
    };
    addVariant(words.slice(0, -1));   // drop the last word
    addVariant(words.slice(1));       // drop the first word
    if (words.length >= 3) {
      addVariant(words.slice(-2));    // last two words (often most distinctive)
      addVariant(words.slice(0, 2));  // first two words
    }
    for (const v of variants) {
      const res = await runCascade(v);
      if (res.length > 0) return res;
    }
  }

  return [];
}

async function getShabad(shabadId) {
  const cacheKey = `shabad:${shabadId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let data;
  try {
    ({ data } = await getWithRetry(`/shabads/${encodeURIComponent(shabadId)}`));
  } catch (err) {
    throw upstreamError(err, 'BaniDB is temporarily unavailable while loading this Shabad.');
  }
  const shapedVerses = Array.isArray(data?.verses) ? data.verses.map(shapeVerse) : [];
  const exactVerses = shapedVerses.filter(
    (v) => v.shabadId != null && String(v.shabadId) === String(shabadId)
  );
  const hasVerseIds = shapedVerses.some((v) => v.shabadId != null);
  const verses = exactVerses.length > 0 ? exactVerses : (hasVerseIds ? [] : shapedVerses);

  // Some BaniDB shabads don't have raag / writer / source filled in
  // `shabadinfo` — but the values DO exist on each individual verse.
  // Fall back to the first verse for any missing field so the meta bar
  // can show Granth/Writer/Raag for every shabad.
  const info = data?.shabadinfo || {};
  const v0 = verses[0] || {};
  const meta = {
    shabadId: info.shabadid || shabadId,
    raag:   pickEntityLabel(info.raag)   || v0.raag   || null,
    writer: pickEntityLabel(info.writer) || v0.writer || null,
    source: pickEntityLabel(info.source) || v0.source || null,
    sourceId: pickEntityId(info, 'source', ['sourceId', 'sourceid', 'source_id', 'id']) || v0.sourceId || null,
    writerId: pickEntityId(info, 'writer', ['writerId', 'writerid', 'writer_id', 'id']) || v0.writerId || null,
    raagId:   pickEntityId(info, 'raag',   ['raagId', 'raagid', 'raag_id', 'id'])       || v0.raagId   || null,
    pageNo: info.pageno              || v0.pageNo || null,
  };

  // Expose Prev/Next shabad navigation if BaniDB returned it. Field shapes
  // vary across endpoints — accept several keys defensively.
  const nav = data?.navigation || data?.shabadlinks || {};
  const navigation = {
    previous: nav.previous?.shabadId || nav.previous?.shabadid || nav.previous || null,
    next:     nav.next?.shabadId     || nav.next?.shabadid     || nav.next     || null,
  };

  return setCached(cacheKey, { meta, verses, navigation });
}

/**
 * Today's Hukamnama from Sri Harmandir Sahib (via BaniDB).
 *
 * The /v2/hukamnamas/today endpoint returns a date plus one or more shabad
 * objects in the same shape as /v2/shabads/:id. We summarise each to a
 * tiny card-shaped record (shabadId + writer/raag/source + first-line
 * gurmukhi/transliteration/translation) so the frontend can render without
 * a second round-trip. Cache is keyed by Gregorian date so we always pull
 * a fresh Hukam after midnight rather than serving yesterday's for 12h.
 */
async function getDailyHukam() {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `hukam:today:${today}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let data;
  try {
    ({ data } = await getWithRetry('/hukamnamas/today'));
  } catch (err) {
    throw upstreamError(err, 'BaniDB is temporarily unavailable while loading the daily Hukam.');
  }

  const date = data?.date?.gregorian || null;
  const shabadIds = Array.isArray(data?.shabadIds) ? data.shabadIds.map(String) : [];
  const shabads = Array.isArray(data?.shabads)
    ? data.shabads.map((entry) => {
        const info = entry?.shabadInfo || {};
        const rawVerses = Array.isArray(entry?.verses) ? entry.verses : [];
        const firstShaped = rawVerses.length > 0 ? shapeVerse(rawVerses[0]) : null;
        return {
          shabadId: String(info.shabadId || ''),
          pageNo: info.pageNo || null,
          raag:   pickUnicode(info.raag)   || null,
          writer: pickUnicode(info.writer) || null,
          source: pickUnicode(info.source) || null,
          firstLineGurmukhi:        firstShaped?.gurmukhi        || '',
          firstLineTransliteration: firstShaped?.transliteration || '',
          firstLineTranslationEn:   firstShaped?.translationEn   || '',
        };
      })
    : [];

  return setCached(cacheKey, { date, shabadIds, shabads });
}

async function getBaniById(baniId) {
  const id = String(baniId).replace(/[^0-9]/g, '');
  if (!id) {
    return { meta: { baniId: null, title: null }, verses: [] };
  }
  const cacheKey = `bani:${id}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let data;
  try {
    ({ data } = await getWithRetry(`/banis/${encodeURIComponent(id)}`));
  } catch (err) {
    throw upstreamError(err, 'BaniDB is temporarily unavailable while loading this Bani.');
  }

  const rawVerses = Array.isArray(data?.verses) ? data.verses : [];
  // BaniDB nests almost everything under `row.verse` on the /banis endpoint:
  //   row.verse.{verseId, verse{gurmukhi,unicode}, larivaar, translation,
  //              transliteration, pageNo, lineNo, visraam, …}
  // shapeVerse() expects the shape /shabads returns, so lift those fields
  // up to the top level and replace `verse` with the inner {gurmukhi,unicode}
  // blob.
  const flattened = rawVerses.map((row) => {
    const inner = (row && typeof row === 'object' && row.verse && typeof row.verse === 'object') ? row.verse : {};
    return {
      ...row,
      ...inner,
      verseId: inner.verseId ?? row?.verseId ?? null,
      verse: inner.verse ?? row?.verse ?? null,
      larivaar: inner.larivaar ?? row?.larivaar ?? null,
    };
  });
  const verses = flattened.map(shapeVerse);

  const info = data?.baniInfo || {};
  const meta = {
    shabadId: `bani-${id}`,
    baniId: Number(id),
    title: pickUnicode(info.gurmukhi) || info.transliteration || info.transliterationEnglish || null,
    source: pickUnicode(info.source) || 'BaniDB Bani',
    raag: null,
    writer: null,
    pageNo: null,
  };

  return setCached(cacheKey, { meta, verses, navigation: {} });
}

async function getAng(pageNo, opts = {}) {
  const n = Number(pageNo);
  if (!Number.isFinite(n) || n < 1) {
    return { meta: { pageNo: null }, verses: [], navigation: {} };
  }
  const angNo = Math.floor(n);
  const seedShabadId = opts.seedShabadId ? String(opts.seedShabadId).replace(/[^0-9A-Za-z_-]/g, '') : '';
  const cacheKey = `ang:${angNo}:${opts.source || ''}:${seedShabadId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const directVerses = await tryDirectAng(angNo, opts);
  const pageRows = await search(String(angNo), {
    ...opts,
    searchType: 5,
  });

  const shabadIds = Array.from(new Set([
    seedShabadId,
    ...pageRows.map((v) => v.shabadId).filter(Boolean).map(String),
  ].filter(Boolean)));
  const expandedFromShabads = (
    await Promise.all(
      shabadIds.slice(0, 24).map((shabadId) =>
        getShabad(shabadId).then((data) => data?.verses || []).catch(() => [])
      )
    )
  ).flat();

  const expanded = orderAngVerses([...directVerses, ...expandedFromShabads], pageRows, angNo);
  const fallbackRows = orderAngVerses(pageRows, pageRows, angNo);
  let ordered = expanded.length > fallbackRows.length
    ? expanded
    : orderAngVerses([...expanded, ...fallbackRows], pageRows, angNo);
  let seedFallbackUsed = false;
  if (!ordered.length && seedShabadId) {
    const seedData = await getShabad(seedShabadId).catch(() => null);
    const seedVerses = Array.isArray(seedData?.verses) ? seedData.verses : [];
    ordered = seedVerses.filter((v) => Number(v.pageNo) === angNo);
    if (!ordered.length) {
      ordered = seedVerses;
      seedFallbackUsed = ordered.length > 0;
    }
  }

  const v0 = ordered[0] || {};
  return setCached(cacheKey, {
    meta: {
      shabadId: `ang-${angNo}${opts.source ? `-${opts.source}` : ''}`,
      pageNo: angNo,
      source: v0.source || 'Ang Viewer',
      sourceId: v0.sourceId || opts.source || null,
      raag: v0.raag || null,
      writer: v0.writer || null,
      isPartial: seedFallbackUsed || (ordered.length > 0 && ordered.length <= fallbackRows.length && fallbackRows.length >= 20),
      searchedLineCount: fallbackRows.length,
      seedFallbackUsed,
    },
    verses: ordered.map((v, index) => ({
      ...v,
      verseId: v.verseId ?? `${v.shabadId || 'line'}-${v.lineNo || index}`,
      lineNo: v.lineNo || index + 1,
    })),
    navigation: {
      previous: angNo > 1 ? angNo - 1 : null,
      next: angNo + 1,
    },
  });
}

/**
 * BaniDB sometimes returns a bare array, sometimes wraps it inside an
 * envelope (e.g. { raags: [...] } or { results: [...] }). Coerce both shapes
 * into an array so the dropdowns always populate.
 */
function asArray(data, ...keys) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of keys) {
      if (Array.isArray(data[k])) return data[k];
    }
    // Fallback: take first array-valued property
    for (const v of Object.values(data)) {
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/**
 * Try a list of upstream paths until one returns usable rows. BaniDB v2 has
 * historically renamed/moved these — we accept any of the known shapes.
 * If none work (network down, blocked, etc.) we fall back to the curated
 * list so the dropdowns are never empty.
 */
async function tryUpstream(paths, mapFn, label) {
  for (const path of paths) {
    try {
      const { data } = await http.get(path);
      const list = asArray(data, 'raags', 'writers', 'sources', 'results');
      const items = list.map(mapFn).filter(Boolean);
      if (items.length > 0) return items;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[banidb] ${label} via ${path} failed: ${err.code || err.message}`);
    }
  }
  return null;
}

async function listRaags() {
  const cached = getCached('raags');
  if (cached) return cached;
  const items = await tryUpstream(['/raags', '/raagindex'], (r) => {
    const raagId = r.raagId ?? r.raagid ?? r.id;
    if (raagId == null) return null;
    const nameGurmukhi = pickUnicode(r) || pickUnicode(r.name) || '';
    const nameEnglish = r.english || r.nameEnglish || (typeof r.name === 'string' ? r.name : '') || '';
    if (!nameGurmukhi && !nameEnglish) return null;
    return { raagId, nameGurmukhi, nameEnglish };
  }, 'raags');
  return setCached('raags', items || fallback.RAAGS);
}

async function listWriters() {
  const cached = getCached('writers');
  if (cached) return cached;
  const items = await tryUpstream(['/writers'], (w) => {
    const writerId = w.writerId ?? w.writerid ?? w.id;
    if (writerId == null) return null;
    const nameGurmukhi = pickUnicode(w) || pickUnicode(w.name) || '';
    const nameEnglish = w.english || w.nameEnglish || (typeof w.name === 'string' ? w.name : '') || '';
    if (!nameGurmukhi && !nameEnglish) return null;
    const type = (typeof w.type === 'object' ? (w.type.english || w.type.unicode) : w.type) || null;
    return { writerId, nameGurmukhi, nameEnglish, type };
  }, 'writers');
  return setCached('writers', items || fallback.WRITERS);
}

async function listSources() {
  const cached = getCached('sources');
  if (cached) return cached;
  const items = await tryUpstream(['/sources'], (s) => {
    const sourceId = s.sourceId ?? s.sourceid ?? s.id;
    if (sourceId == null) return null;
    const nameGurmukhi = pickUnicode(s) || pickUnicode(s.name) || '';
    const nameEnglish = s.english || s.nameEnglish || (typeof s.name === 'string' ? s.name : '') || '';
    if (!nameGurmukhi && !nameEnglish) return null;
    return { sourceId, nameGurmukhi, nameEnglish, pageName: s.pageNameEnglish || null };
  }, 'sources');
  return setCached('sources', items || fallback.SOURCES);
}

module.exports = {
  search,
  rawSearch,
  detectSearchType,
  getShabad,
  getBaniById,
  getDailyHukam,
  getAng,
  listRaags,
  listWriters,
  listSources,
};
