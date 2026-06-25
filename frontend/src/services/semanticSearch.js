/**
 * Semantic shabad search — runs entirely in the browser.
 *
 * Loads three artifacts produced by tools/build-semantic-index.js:
 *   - /semantic/embeddings.bin   — packed Float32Array (N rows × DIM cols)
 *   - /semantic/index.json       — [shabadId, ...] in row order
 *   - /semantic/shabad-meta.json — per-shabad display fields for SearchResults
 *
 * Plus the transformer model (Xenova/multilingual-e5-small) downloaded by
 * @xenova/transformers on first use and cached in IndexedDB by the library.
 *
 * Cosine similarity is computed in pure JS over the packed Float32Array.
 * For ~5K shabads × 384 dims this is ~5 ms per query on a 2020 phone.
 */

import ortWasmMjsUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';

const EMBEDDING_DIM = 384;
const TOP_K = 30;
const ARTIFACT_BASE = '/semantic';
const DATA_FETCH_TIMEOUT_MS = 20_000;
const MODEL_LOAD_TIMEOUT_MS = 120_000;
let artifactManifestPromise = null;

// Module-scoped singletons. The load promise is shared so callers that
// arrive while loading just await the in-flight promise instead of
// starting a second load.
let loadPromise = null;
let state = {
  ready: false,
  embedder: null,         // sentence-transformer pipeline (lazy import)
  embeddings: null,       // Float32Array, length = count * EMBEDDING_DIM
  embeddingCount: 0,
  ids: null,              // string[] — shabadIds in row order
  meta: null,             // Map<shabadId, metaObject>
};

function l2Normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vec.length; i += 1) vec[i] /= norm;
  return vec;
}

function cosineTopK(queryVec, embeddings, count, dim, k, mask) {
  // Embeddings are L2-normalised at build time; query is normalised below.
  // That makes the dot product equivalent to cosine similarity.
  // If `mask` is provided (a Uint8Array per-row 1/0), rows where mask[i]===0
  // are skipped entirely — used by source/writer/raag filters so a narrow
  // filter still returns a full K of matching rows, not "top-K then prune".
  const scores = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    if (mask && !mask[i]) {
      scores[i] = -Infinity;
      continue;
    }
    let s = 0;
    const base = i * dim;
    for (let j = 0; j < dim; j += 1) {
      s += queryVec[j] * embeddings[base + j];
    }
    scores[i] = s;
  }
  // Heap-free top-k: track best k indices in a flat array.
  const idx = new Array(count);
  for (let i = 0; i < count; i += 1) idx[i] = i;
  idx.sort((a, b) => scores[b] - scores[a]);
  return idx
    .slice(0, k)
    .map((i) => ({ index: i, score: scores[i] }))
    .filter((row) => Number.isFinite(row.score));
}

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function fetchArtifact(path, label, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATA_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      signal: controller.signal,
      cache: options.revalidate ? 'no-cache' : 'default',
    });
    if (!response.ok) {
      throw new Error(`${label} returned HTTP ${response.status}`);
    }
    return response;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`${label} took too long to load. Check that the dev server is running and the semantic files exist.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function loadArtifactManifest() {
  if (artifactManifestPromise) return artifactManifestPromise;
  artifactManifestPromise = (async () => {
    try {
      const response = await fetch(`${ARTIFACT_BASE}/manifest.json`, { cache: 'no-cache' });
      if (!response.ok) return {};
      return await response.json();
    } catch {
      return {};
    }
  })();
  return artifactManifestPromise;
}

function artifactUrl(name, manifest) {
  const version = manifest?.files?.[name]?.hash || manifest?.version || '';
  const suffix = version ? `?v=${encodeURIComponent(version)}` : '';
  return `${ARTIFACT_BASE}/${name}${suffix}`;
}

/**
 * Kick off the model + embeddings download. Idempotent and shared across
 * callers. The optional `onProgress({ phase, loaded, total })` callback
 * fires for each major step so the UI can show a progress bar.
 *   phase: 'data' | 'model' | 'ready'
 */
export function loadSemanticSearch(onProgress) {
  if (state.ready) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // 1) Static data first — small, fast, doesn't block the user even if
    //    the model download stalls.
    onProgress?.({ phase: 'data', loaded: 0, total: 3 });

    const manifest = await loadArtifactManifest();
    const [embRes, idxRes, metaRes] = await Promise.all([
      fetchArtifact(artifactUrl('embeddings.bin', manifest), 'Semantic embeddings'),
      fetchArtifact(artifactUrl('index.json', manifest), 'Semantic index'),
      fetchArtifact(artifactUrl('shabad-meta.json', manifest), 'Semantic metadata'),
    ]);
    onProgress?.({ phase: 'data', loaded: 1, total: 3 });

    const embBuf = await embRes.arrayBuffer();
    state.embeddings = new Float32Array(embBuf);
    state.embeddingCount = state.embeddings.length / EMBEDDING_DIM;
    onProgress?.({ phase: 'data', loaded: 2, total: 3 });

    const idsJson = await idxRes.json();
    state.ids = Array.isArray(idsJson) ? idsJson.map(String) : [];

    const metaJson = await metaRes.json();
    state.meta = new Map();
    if (Array.isArray(metaJson)) {
      for (const entry of metaJson) {
        if (entry?.shabadId != null) state.meta.set(String(entry.shabadId), entry);
      }
    } else if (metaJson && typeof metaJson === 'object') {
      for (const [k, v] of Object.entries(metaJson)) state.meta.set(String(k), v);
    }
    if (!Number.isInteger(state.embeddingCount) || state.embeddingCount < 1) {
      throw new Error('Semantic embeddings file is invalid. Rebuild the semantic index.');
    }
    if (state.ids.length !== state.embeddingCount) {
      throw new Error(`Semantic index mismatch: ${state.ids.length} ids for ${state.embeddingCount} embedding rows.`);
    }
    onProgress?.({ phase: 'data', loaded: 3, total: 3 });

    // 2) Model — the big download. Transformers.js handles caching to IDB
    //    via the @huggingface/transformers cache layer, so this is slow
    //    only on first run.
    onProgress?.({ phase: 'model', loaded: 0, total: 1 });

    const { pipeline, env } = await withTimeout(
      import('@huggingface/transformers'),
      30_000,
      'Smart-search runtime took too long to load. Refresh and try again.',
    );
    // Prefer browser cache when the browser exposes the Cache API. Some
    // phones/browsers do not expose it on LAN http:// URLs or private tabs;
    // forcing it on makes Transformers.js fail with:
    // "Browser cache is not available in this environment."
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = Boolean(globalThis?.caches?.open);
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = {
        mjs: ortWasmMjsUrl,
        wasm: ortWasmUrl,
      };
    }

    state.embedder = await withTimeout(pipeline(
      'feature-extraction',
      'Xenova/multilingual-e5-small',
      {
        // transformers.js v3 replaced `quantized: true` with `dtype`.
        // 'q8' = INT8 quantised → ~30 MB download, fast WASM inference.
        dtype: 'q8',
        progress_callback: (info) => {
          if (info?.status === 'progress' && typeof info.progress === 'number') {
            onProgress?.({
              phase: 'model',
              loaded: info.progress,
              total: 100,
              file: info.file,
            });
          }
        },
      },
    ), MODEL_LOAD_TIMEOUT_MS, 'Smart-search model took too long to load. Check internet/model cache, then retry.');
    onProgress?.({ phase: 'model', loaded: 1, total: 1 });

    state.ready = true;
    onProgress?.({ phase: 'ready', loaded: 1, total: 1 });
  })().catch((err) => {
    // Reset so a future attempt can retry from scratch.
    loadPromise = null;
    state = {
      ready: false, embedder: null, embeddings: null,
      embeddingCount: 0, ids: null, meta: null,
    };
    throw err;
  });

  return loadPromise;
}

export function isSemanticReady() {
  return state.ready;
}

// Filter-option lookup: dropdowns send IDs (sourceId 'G', writerId, raagId),
// but shabad-meta.json stores the Unicode Gurmukhi *name* via pickUnicode().
// Resolve the lists once and cache them so we can translate ID → name when
// building the filter mask.
let filterLookupsPromise = null;
async function loadFilterLookups() {
  if (filterLookupsPromise) return filterLookupsPromise;
  filterLookupsPromise = (async () => {
    const [sourcesRes, writersRes, raagsRes] = await Promise.all([
      fetch('/api/filters/sources'),
      fetch('/api/filters/writers'),
      fetch('/api/filters/raags'),
    ]);
    const [sources, writers, raags] = await Promise.all([
      sourcesRes.ok ? sourcesRes.json() : [],
      writersRes.ok ? writersRes.json() : [],
      raagsRes.ok   ? raagsRes.json()   : [],
    ]);
    const toMap = (rows, idKey) => {
      const m = new Map();
      for (const row of rows || []) {
        const id = row?.[idKey];
        if (id == null) continue;
        const name = row.nameGurmukhi || row.nameEnglish || '';
        m.set(String(id), name);
      }
      return m;
    };
    return {
      source: toMap(sources, 'sourceId'),
      writer: toMap(writers, 'writerId'),
      raag:   toMap(raags,   'raagId'),
    };
  })().catch((err) => {
    // Don't permanently poison the cache — a later query may succeed.
    filterLookupsPromise = null;
    throw err;
  });
  return filterLookupsPromise;
}

function inferSourceMeta(meta, shabadId) {
  const id = Number(shabadId);
  const pageNo = Number(meta?.pageNo);
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
  if (!Number.isFinite(id) && Number.isFinite(pageNo) && pageNo >= 1 && pageNo <= 1430) {
    return { sourceId: 'G', source: 'ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ' };
  }
  return { sourceId: '', source: '' };
}

async function buildFilterMask(filters) {
  if (!filters) return null;
  const sourceId = filters.source || '';
  const writerId = filters.writer || '';
  const raagId   = filters.raag   || '';
  if (!sourceId && !writerId && !raagId) return null;

  let lookups;
  try {
    lookups = await loadFilterLookups();
  } catch {
    // Without the lookups we can't translate IDs to names, so we can't apply
    // the filter accurately. Returning null = "no filter" is safer than
    // filtering out everything.
    return null;
  }
  const sourceName = sourceId ? (lookups.source.get(sourceId) || '') : '';
  const writerName = writerId ? (lookups.writer.get(writerId) || '') : '';
  const raagName   = raagId   ? (lookups.raag.get(raagId)     || '') : '';

  const same = (a, b) => String(a || '').trim() === String(b || '').trim();
  const matchesField = (meta, wantedId, wantedName, idKey, nameKey) => {
    if (!wantedId && !wantedName) return true;
    if (wantedId && meta?.[idKey] != null && meta[idKey] !== '') {
      return same(meta[idKey], wantedId);
    }
    if (wantedName && meta?.[nameKey]) {
      return same(meta[nameKey], wantedName);
    }
    return false;
  };

  const mask = new Uint8Array(state.embeddingCount);
  let comparableRows = 0;
  let matchedRows = 0;
  for (let i = 0; i < state.embeddingCount; i += 1) {
    const id = state.ids[i];
    const storedMeta = state.meta.get(id);
    if (!storedMeta) continue;
    const inferredSource = inferSourceMeta(storedMeta, id);
    const meta = {
      ...storedMeta,
      // The shabad id range is more reliable than pageNo. Older semantic
      // artifacts mislabeled Dasam/Bhai Gurdas rows as SGGS because their
      // page numbers also sit between 1 and 1430.
      source: inferredSource.source || storedMeta.source,
      sourceId: inferredSource.sourceId || storedMeta.sourceId,
    };
    const comparable =
      (!sourceId || meta.sourceId || meta.source) &&
      (!writerId || meta.writerId || meta.writer) &&
      (!raagId || meta.raagId || meta.raag);
    if (comparable) comparableRows += 1;
    if (!matchesField(meta, sourceId, sourceName, 'sourceId', 'source')) continue;
    if (!matchesField(meta, writerId, writerName, 'writerId', 'writer')) continue;
    if (!matchesField(meta, raagId, raagName, 'raagId', 'raag')) continue;
    mask[i] = 1;
    matchedRows += 1;
  }
  // Old semantic indexes may not contain writer/raag metadata at all. Showing
  // unfiltered results is misleading, so tell the user to rebuild the index.
  if (matchedRows === 0 && comparableRows === 0) {
    throw new Error('These smart-search filters need rebuilt metadata. Run npm run build:semantic, then hard refresh.');
  }
  return mask;
}

/**
 * Run a semantic query. Returns rows shaped like the existing keyword
 * search results so SearchResults.jsx renders them with no changes.
 *
 * @param {string} query
 * @param {{ source?: string, writer?: string, raag?: string }} [filters]
 *   Same filter shape SearchPage uses for keyword search. When any field is
 *   set, only shabads whose stored meta matches are considered, with the
 *   ranking still ordered by cosine similarity to the query.
 */
export async function semanticSearch(query, filters) {
  if (!state.ready) await loadSemanticSearch();
  if (!state.ready) throw new Error('Semantic search is not ready.');

  const q = String(query || '').trim();
  if (!q) return [];

  // e5-small is a query/passage model — prefixing the query with "query:"
  // is recommended by the model card and improves recall noticeably.
  const prefixed = `query: ${q}`;

  const output = await state.embedder(prefixed, {
    pooling: 'mean',
    normalize: false, // we normalise ourselves to match the packed embeddings
  });
  // output.data is a Float32Array of length DIM (after mean-pooling).
  const qvec = new Float32Array(output.data);
  l2Normalize(qvec);

  const mask = await buildFilterMask(filters);
  const top = cosineTopK(qvec, state.embeddings, state.embeddingCount, EMBEDDING_DIM, TOP_K, mask);

  const rows = [];
  for (const { index, score } of top) {
    const id = state.ids[index];
    if (!id) continue;
    const meta = state.meta.get(id);
    if (!meta) continue;
    const inferredSource = inferSourceMeta(meta, id);
    rows.push({
      shabadId: id,
      gurmukhi: meta.gurmukhi || '',
      transliteration: meta.transliteration || '',
      translationEn: meta.translationEn || '',
      translationPa: meta.translationPa || '',
      raag: meta.raag || '',
      raagId: meta.raagId || '',
      writer: meta.writer || '',
      writerId: meta.writerId || '',
      source: inferredSource.source || meta.source,
      sourceId: inferredSource.sourceId || meta.sourceId,
      pageNo: meta.pageNo || null,
      score: Math.round(Math.max(0, Math.min(1, score)) * 100),
    });
  }
  return rows;
}
