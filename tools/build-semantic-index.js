#!/usr/bin/env node
/**
 * Pre-compute the semantic-search index for Gurmat Saanj.
 *
 * Walks every shabad across all BaniDB-hosted granths (SGGS, Sri Dasam
 * Granth Sahib Ji, Vaaran Bhai Gurdas Ji, Bhai Nand Lal Ji) via the existing
 * backend banidb.service, embeds the resulting "doc" (Gurmukhi + Sahib
 * Singh Punjabi + English BDB) with Xenova/multilingual-e5-small, and
 * writes three artifacts to frontend/public/semantic/:
 *
 *   embeddings.bin      — packed Float32Array (N rows × 384 cols)
 *   index.json          — [shabadId, ...] in row order
 *   shabad-meta.json    — per-shabad display fields used by SearchResults
 *
 * Usage (from repo root):
 *
 *   cd frontend && npm install         # one-time; pulls @xenova/transformers
 *   node tools/build-semantic-index.js
 *
 * Options (via env vars):
 *   SEMANTIC_MAX=200          → limit to first N shabads for quick iteration
 *   SEMANTIC_CONCURRENCY=4    → parallel BaniDB fetches (default 4)
 *   SEMANTIC_RESUME=1         → skip ids already present in shabad-meta.json
 *
 * Expected runtime on a laptop:
 *   - First time:   ~45-90 min for ~9K shabads across all granths
 *                   (BaniDB fetch dominates; gaps between granth ID ranges
 *                    contribute fast 404s but add up over 50k IDs)
 *   - With resume:  ~2-5 min per drift refresh
 *
 * NOTE: this script depends on @huggingface/transformers installed in
 * frontend/node_modules. It loads from that path so we don't duplicate
 * the dep in a separate package.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Reach into the backend's existing banidb service so we use the same
// search-type cascade, Unicode pickers, and 12 h cache the live app uses.
const banidb = require('../backend/src/services/banidb.service');

const EMBEDDING_DIM = 384;
const MODEL_NAME = 'Xenova/multilingual-e5-small';
const OUT_DIR = path.join(__dirname, '..', 'frontend', 'public', 'semantic');
const MAX_SHABADS = Number(process.env.SEMANTIC_MAX) || Infinity;
const CONCURRENCY = Math.max(1, Number(process.env.SEMANTIC_CONCURRENCY) || 4);
const RESUME = process.env.SEMANTIC_RESUME === '1';
// Range to walk. BaniDB shabad IDs are layered roughly:
//   SGGS                    ~1..5800
//   Sri Dasam Granth Sahib  higher
//   Vaaran Bhai Gurdas Ji   higher still
//   Bhai Nand Lal Ji        higher again
// We default to a wide upper bound that covers all four granths — gaps and
// non-existent IDs cost one cheap 404 each and are silently skipped via the
// `if (!data?.verses?.length) return` guard below.
const SHABAD_ID_START = Number(process.env.SEMANTIC_ID_START) || 1;
const SHABAD_ID_END   = Number(process.env.SEMANTIC_ID_END)   || 80000;

// Section-header pankti BaniDB sometimes returns as the first verse of a
// shabad (Salok / Pauri / Chant sections). Picking the literal first verse
// makes the search-result card show "ਮਃ ੧ ॥" or "ਸਲੋਕੁ ਮਃ ੨ ॥" instead of the
// actual identifying pankti, which is useless to the reader.
const HEADER_RE = /^(?:ੴ\s*)?(?:ਮਃ|ਮਹਲਾ|ਸਲੋਕੁ?|ਪਉੜੀ|ਅਸਟਪਦੀ|ਛੰਤੁ?|ਰਹਾਉ|ਜਪੁ?|ਸੋਰਠਿ|ਆਸਾ|ਗਉੜੀ|ਬਿਲਾਵਲੁ?|ਰਾਮਕਲੀ|ਮਾਰੂ|ਤੁਖਾਰੀ|ਕੇਦਾਰਾ|ਭੈਰਉ|ਬਸੰਤੁ?|ਸਾਰਗ|ਮਲਾਰ|ਕਾਨੜਾ|ਕਲਿਆਨੁ?|ਪ੍ਰਭਾਤੀ|ਜੈਜਾਵੰਤੀ|ਸ਼ਬਦੁ?)(?:[\s੧੨੩੪੫੬੭੮੯੦॥।]+(?:ਮਃ|ਮਹਲਾ)?[\s੧੨੩੪੫੬੭੮੯੦॥।]*)?$/;

function isLikelyHeader(line) {
  const text = String(line || '').trim();
  if (!text) return true;
  // Strip the gurmukhi punctuation/digits and check the meaningful glyph
  // count — true headers are very short ("ਮਃ ੧ ॥") while real panktis are
  // usually 20+ glyphs.
  const stripped = text.replace(/[੦-੯॥।\s]+/g, '');
  if (stripped.length < 8) return true;
  return HEADER_RE.test(text);
}

// Pick the most-identifying verse to show on the result card.
// Preference order:
//   1. Rahau (mainLine) — the central thematic refrain of the shabad. In
//      Sikh tradition this is what a granthi reads to "name" a shabad, and
//      BaniDB flags it via shapeVerse → isRahao.
//   2. First substantive pankti — skipping section/raag headers like
//      "ਸਲੋਕੁ ਮਃ ੧ ॥" or "ਪਉੜੀ ॥" which are useless to a reader.
//   3. Literally verses[0] as a last-resort fallback so the card never blanks.
// TODO (out of scope for v1): swap to a per-query best-matching pankti once
// we ship per-verse embeddings. Storing per-verse vectors would 30× the
// bundle (~330 MB for full SGGS), so we keep the static pick for now.
function pickDisplayVerseIndex(verses) {
  if (!Array.isArray(verses)) return -1;
  // 1. Rahau (main line)
  for (let i = 0; i < verses.length; i += 1) {
    if (verses[i]?.isRahao && verses[i]?.gurmukhi) return i;
  }
  // 2. First substantive
  for (let i = 0; i < verses.length; i += 1) {
    const text = verses[i]?.gurmukhi;
    if (text && !isLikelyHeader(text)) return i;
  }
  // 3. Anything non-empty
  for (let i = 0; i < verses.length; i += 1) {
    if (verses[i]?.gurmukhi) return i;
  }
  return -1;
}

function joinText(verses, field) {
  if (!Array.isArray(verses)) return '';
  return verses
    .map((v) => String(v?.[field] || '').trim())
    .filter(Boolean)
    .join(' ');
}

function buildDoc(verses) {
  // Multilingual-e5 likes "passage: " for indexed text; mirrors the
  // "query: " prefix we apply at query time.
  const gurmukhi   = joinText(verses, 'gurmukhi');
  const englishBdb = joinText(verses, 'translationEn');
  const punjabiSs  = joinText(verses, 'translationPa');
  // Order: Punjabi steek first (richest meaning signal), then English, then
  // the raw Gurmukhi so the model still anchors on actual words.
  const combined = [punjabiSs, englishBdb, gurmukhi].filter(Boolean).join('\n');
  // Token-bound by character length; e5-small's tokenizer caps at 512 tokens
  // — ~2000 characters is a safe headroom that fits long shabads.
  return `passage: ${combined.slice(0, 2000)}`;
}

function l2Normalize(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i += 1) s += vec[i] * vec[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < vec.length; i += 1) vec[i] /= n;
}

function inferSourceMeta(shabadId, pageNo) {
  const id = Number(shabadId);
  if (Number.isFinite(id) && id >= 1 && id < 6000) {
    return { sourceId: 'G', source: 'ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ' };
  }
  if (Number.isFinite(id) && id >= 6000 && id < 30000) {
    return { sourceId: 'D', source: 'ਸ੍ਰੀ ਦਸਮ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ' };
  }
  if (Number.isFinite(id) && id >= 30000 && id < 40000) {
    return { sourceId: 'B', source: 'ਵਾਰਾਂ ਭਾਈ ਗੁਰਦਾਸ ਜੀ' };
  }
  if (Number.isFinite(id) && id >= 40000 && id < 43000) {
    return { sourceId: 'K', source: 'ਕਬਿੱਤ ਸਵੱਯੇ ਭਾਈ ਗੁਰਦਾਸ ਜੀ' };
  }
  if (Number.isFinite(id) && id >= 43000 && id < 50000) {
    return { sourceId: 'N', source: 'ਭਾਈ ਨੰਦ ਲਾਲ ਜੀ' };
  }
  if (!Number.isFinite(id) && Number(pageNo) >= 1 && Number(pageNo) <= 1430) {
    return { sourceId: 'G', source: 'ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ' };
  }
  return { sourceId: '', source: '' };
}

async function fetchShabad(id) {
  try {
    return await banidb.getShabad(String(id));
  } catch {
    return null;
  }
}

async function fetchSearchMeta(shabadId, verse) {
  const queries = [
    verse?.gurmukhi,
    verse?.transliteration,
  ].map((q) => String(q || '').trim()).filter(Boolean);

  for (const query of queries) {
    try {
      const rows = await banidb.rawSearch(query, {
        searchType: banidb.detectSearchType(query),
      });
      const hit = (rows || []).find((row) => String(row?.shabadId) === String(shabadId));
      if (hit) return hit;
    } catch {
      // Metadata enrichment is best-effort. The semantic document itself is
      // already built from the full shabad verses.
    }
  }
  return null;
}

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').slice(0, 16);
}

function writeSemanticManifest() {
  const names = ['embeddings.bin', 'index.json', 'shabad-meta.json'];
  const files = {};

  for (const name of names) {
    const filePath = path.join(OUT_DIR, name);
    const stat = fs.statSync(filePath);
    files[name] = {
      hash: hashFile(filePath),
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  }

  const version = crypto
    .createHash('sha256')
    .update(names.map((name) => files[name].hash).join('|'))
    .digest('hex')
    .slice(0, 16);

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({
      version,
      generatedAt: new Date().toISOString(),
      files,
    }, null, 2)
  );
}

function readExistingMeta() {
  if (!RESUME) return new Map();
  try {
    const raw = fs.readFileSync(path.join(OUT_DIR, 'shabad-meta.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const map = new Map();
    if (Array.isArray(parsed)) {
      for (const entry of parsed) if (entry?.shabadId) map.set(String(entry.shabadId), entry);
    } else if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) map.set(String(k), v);
    }
    return map;
  } catch {
    return new Map();
  }
}

function hasSemanticFilterMeta(entry) {
  const hasSource = Boolean(entry?.source || entry?.sourceId);
  const hasWriter = Boolean(entry?.writer || entry?.writerId);
  const hasRaag = Boolean(entry?.raag || entry?.raagId);
  // Older semantic indexes only had source metadata. That is enough for
  // Granth filtering, but writer/raag filters need a refetch on resume.
  return hasSource && (hasWriter || hasRaag);
}

async function loadEmbedder() {
  // We load from frontend/node_modules so we share the dep with the runtime.
  const transformers = require(
    path.join(__dirname, '..', 'frontend', 'node_modules', '@huggingface', 'transformers'),
  );
  const { pipeline, env } = transformers;
  // Cache models locally to skip re-download on subsequent runs.
  env.cacheDir = path.join(__dirname, '.cache', 'transformers');
  // transformers.js v3 uses `dtype` instead of `quantized: true`.
  // 'q8' = INT8 quantised; matches the runtime config in semanticSearch.js.
  return pipeline('feature-extraction', MODEL_NAME, { dtype: 'q8' });
}

async function mapWithConcurrency(items, limit, mapper) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      out[idx] = await mapper(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  console.log('► Pre-computing semantic index');
  console.log(`  Model:       ${MODEL_NAME}`);
  console.log(`  Range:       ${SHABAD_ID_START}..${SHABAD_ID_END}`);
  console.log(`  Limit:       ${MAX_SHABADS === Infinity ? 'no limit' : MAX_SHABADS}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Resume:      ${RESUME ? 'yes' : 'no'}`);
  console.log(`  Out dir:     ${OUT_DIR}`);
  ensureOutDir();

  const existingMeta = readExistingMeta();
  const existingIds  = new Set(existingMeta.keys());
  console.log(`  Existing:    ${existingIds.size} shabads in cache`);

  console.log('► Loading embedding model…');
  const embedder = await loadEmbedder();

  // 1) Fetch shabads via BaniDB (parallelised) — gives us the raw verses.
  console.log('► Fetching shabads from BaniDB…');
  const idsToFetch = [];
  for (let id = SHABAD_ID_START; id <= SHABAD_ID_END; id += 1) {
    const cached = existingMeta.get(String(id));
    if (RESUME && cached && hasSemanticFilterMeta(cached)) continue;
    idsToFetch.push(id);
    if (idsToFetch.length >= MAX_SHABADS) break;
  }

  const docs = [];
  let fetched = 0;
  await mapWithConcurrency(idsToFetch, CONCURRENCY, async (id) => {
    const data = await fetchShabad(id);
    fetched += 1;
    if (fetched % 50 === 0) {
      process.stdout.write(`\r  fetched ${fetched}/${idsToFetch.length}`);
    }
    if (!data?.verses?.length) return;
    const sId = String(data.meta?.shabadId || id);
    const firstIdx = pickDisplayVerseIndex(data.verses);
    const firstVerse = firstIdx >= 0 ? data.verses[firstIdx] : null;
    const first = firstVerse?.gurmukhi || '';
    if (!first) return;
    const inferredSource = inferSourceMeta(sId, data.meta?.pageNo || firstVerse?.pageNo);
    const needsSearchMeta = !(
      data.meta?.source || data.meta?.sourceId || firstVerse?.source || firstVerse?.sourceId ||
      data.meta?.writer || data.meta?.writerId || firstVerse?.writer || firstVerse?.writerId ||
      data.meta?.raag || data.meta?.raagId || firstVerse?.raag || firstVerse?.raagId
    );
    const searchMeta = needsSearchMeta ? await fetchSearchMeta(sId, firstVerse) : null;
    docs.push({
      shabadId: sId,
      text: buildDoc(data.verses),
      meta: {
        shabadId: sId,
        gurmukhi: first,
        // Use the picked verse for these fields too — otherwise the card
        // shows the section-header transliteration ("salok mahalla 2")
        // even when the displayed Gurmukhi is the substantive opener.
        transliteration: firstVerse?.transliteration || '',
        translationEn: firstVerse?.translationEn || '',
        translationPa: firstVerse?.translationPa || '',
        raag: data.meta?.raag || firstVerse?.raag || searchMeta?.raag || '',
        writer: data.meta?.writer || firstVerse?.writer || searchMeta?.writer || '',
        source: inferredSource.source || data.meta?.source || firstVerse?.source || searchMeta?.source || '',
        sourceId: inferredSource.sourceId || data.meta?.sourceId || firstVerse?.sourceId || searchMeta?.sourceId || '',
        writerId: data.meta?.writerId || firstVerse?.writerId || searchMeta?.writerId || '',
        raagId: data.meta?.raagId || firstVerse?.raagId || searchMeta?.raagId || '',
        pageNo: data.meta?.pageNo || null,
      },
    });
  });
  process.stdout.write(`\r  fetched ${fetched}/${idsToFetch.length}\n`);
  console.log(`  ${docs.length} shabads with content; skipped ${fetched - docs.length} empty`);

  // 2) Embed (sequential — the model is internally batched but ONNX in
  //    transformers.js works one prompt at a time).
  console.log('► Embedding…');
  const newVecs = new Float32Array(docs.length * EMBEDDING_DIM);
  const newIds = new Array(docs.length);
  for (let i = 0; i < docs.length; i += 1) {
    const { shabadId, text } = docs[i];
    const output = await embedder(text, { pooling: 'mean', normalize: false });
    const vec = new Float32Array(output.data);
    l2Normalize(vec);
    newVecs.set(vec, i * EMBEDDING_DIM);
    newIds[i] = shabadId;
    if ((i + 1) % 25 === 0 || i === docs.length - 1) {
      process.stdout.write(`\r  embedded ${i + 1}/${docs.length}`);
    }
  }
  process.stdout.write('\n');

  // 3) Merge with existing artifacts on resume so we don't lose prior work.
  let finalVecs = newVecs;
  let finalIds = newIds;
  const finalMeta = new Map(existingMeta);
  for (const doc of docs) finalMeta.set(doc.shabadId, doc.meta);

  if (RESUME && existingIds.size > 0) {
    try {
      const prevBuf = fs.readFileSync(path.join(OUT_DIR, 'embeddings.bin'));
      const prevIds = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'index.json'), 'utf8'));
      const prevVecs = new Float32Array(
        prevBuf.buffer, prevBuf.byteOffset, prevBuf.byteLength / 4,
      );
      const updatedIds = new Set(newIds.map(String));
      const keptRows = [];
      const keptSeen = new Set();
      prevIds.map(String).forEach((id, index) => {
        if (updatedIds.has(id) || keptSeen.has(id)) return;
        keptSeen.add(id);
        keptRows.push({ id, index });
      });
      const merged = new Float32Array((keptRows.length + newIds.length) * EMBEDDING_DIM);
      keptRows.forEach((row, outIndex) => {
        const start = row.index * EMBEDDING_DIM;
        merged.set(prevVecs.subarray(start, start + EMBEDDING_DIM), outIndex * EMBEDDING_DIM);
      });
      merged.set(newVecs, keptRows.length * EMBEDDING_DIM);
      finalVecs = merged;
      finalIds = [...keptRows.map((row) => row.id), ...newIds];
    } catch (err) {
      console.warn('  resume merge failed; using new data only:', err.message);
    }
  }

  // 4) Write artifacts.
  console.log('► Writing artifacts…');
  fs.writeFileSync(path.join(OUT_DIR, 'embeddings.bin'), Buffer.from(finalVecs.buffer));
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(finalIds));
  const metaOut = [...finalMeta.values()];
  fs.writeFileSync(path.join(OUT_DIR, 'shabad-meta.json'), JSON.stringify(metaOut));
  writeSemanticManifest();
  console.log(`  embeddings.bin   ${(finalVecs.byteLength / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  index.json       ${finalIds.length} shabads`);
  console.log(`  shabad-meta.json ${metaOut.length} entries`);
  console.log('  manifest.json    versioned cache manifest');
  console.log('✓ done');
}

main().catch((err) => {
  console.error('\n✗ build-semantic-index failed:', err);
  process.exitCode = 1;
});
