#!/usr/bin/env node
/**
 * Evaluation harness for the semantic search index.
 *
 * Runs a fixture of ~30 natural-language queries against the built
 * embeddings.bin and reports recall@K (default K=5). Used to validate
 * doc-construction tweaks in tools/build-semantic-index.js without
 * shipping regressions to users.
 *
 * Usage (after build-semantic-index has produced the artifacts):
 *
 *   node tools/semantic-eval.js
 *
 * Options:
 *   EVAL_K=5             → recall@K threshold
 *   EVAL_VERBOSE=1       → print per-query top-K with scores
 */

const fs = require('fs');
const path = require('path');

const EMBEDDING_DIM = 384;
const MODEL_NAME = 'Xenova/multilingual-e5-small';
const OUT_DIR = path.join(__dirname, '..', 'frontend', 'public', 'semantic');
const K = Math.max(1, Number(process.env.EVAL_K) || 5);
const VERBOSE = process.env.EVAL_VERBOSE === '1';

/**
 * Fixture: each row is { query, expected: [shabadId, ...] }.
 *
 * The expected ids are written defensively as STRINGS (BaniDB shabad IDs
 * are integers but normalised to strings throughout the app). Multiple
 * expected ids per row → ANY of them in top-K counts as a hit.
 *
 * The list is intentionally seed-only — extend over time as you find
 * regressions.
 */
const FIXTURE = [
  { query: 'shabad about fear and protection',
    expected: ['2367', '3085'] }, // Gur Ka Shabad Rakhvaare, Tati Vao Na Lagai
  { query: 'protection from harm',
    expected: ['3085', '2367'] },
  { query: 'morning prayer japji',
    expected: ['1'] },
  { query: 'happiness and bliss anand',
    expected: ['333375', '3375'] }, // Anand Sahib openings
  { query: 'sukhmani peace of mind',
    expected: ['871'] }, // Sukhmani opening
  { query: 'aarti cosmic worship',
    expected: ['2533'] }, // Gagan Mai Thaal
  { query: 'wedding lavaan',
    expected: [] }, // BaniDB shabad id for lavaan to be filled
  { query: 'remembrance of naam',
    expected: [] },
  { query: 'humility before guru',
    expected: [] },
  { query: 'tati vao na lagai',
    expected: ['3085'] },
  { query: 'fear of death',
    expected: ['5534', '5535'] }, // Salok Mahalla 9
  { query: 'gratitude thanks waheguru',
    expected: [] },
  { query: 'forgiveness for ego',
    expected: [] },
  { query: 'asking for healing',
    expected: [] },
  { query: 'ardaas standing prayer',
    expected: ['7738'] }, // Chandi Di Vaar opening (Pritham Bhagauti)
  { query: 'one universal god ik onkar',
    expected: ['1'] },
  { query: 'guru ka shabad rakhvaare',
    expected: ['2367'] },
  { query: 'satgur kirpa',
    expected: [] },
  { query: 'naam tero aarti',
    expected: ['2638'] },
  { query: 'sain ji aarti',
    expected: ['2640'] },
  { query: 'naam ki kamai',
    expected: [] },
  { query: 'evening prayer rehras',
    expected: [] },
  { query: 'night prayer kirtan sohila',
    expected: [] },
  { query: 'aas pyaas hope thirst',
    expected: [] },
  { query: 'humble service seva',
    expected: [] },
  { query: 'ਡਰ ਤੋਂ ਰੱਖਿਆ',
    expected: ['2367', '3085'] },
  { query: 'ਨਾਮ ਜਪਣਾ',
    expected: [] },
  { query: 'ਸ਼ਾਂਤੀ',
    expected: ['871'] },
  { query: 'ਜਨਮ ਅਨੰਦ ਖੁਸ਼ੀ',
    expected: [] },
  { query: 'ਮੌਤ ਯਾਦ',
    expected: ['5534', '5535'] },
];

function l2Normalize(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i += 1) s += vec[i] * vec[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < vec.length; i += 1) vec[i] /= n;
}

function topKDot(qvec, embeddings, count, dim, k) {
  const scores = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    let s = 0;
    const base = i * dim;
    for (let j = 0; j < dim; j += 1) s += qvec[j] * embeddings[base + j];
    scores[i] = s;
  }
  const idx = new Array(count);
  for (let i = 0; i < count; i += 1) idx[i] = i;
  idx.sort((a, b) => scores[b] - scores[a]);
  return idx.slice(0, k).map((i) => ({ index: i, score: scores[i] }));
}

async function main() {
  const embPath = path.join(OUT_DIR, 'embeddings.bin');
  const idxPath = path.join(OUT_DIR, 'index.json');
  if (!fs.existsSync(embPath) || !fs.existsSync(idxPath)) {
    console.error('Artifacts missing. Run "node tools/build-semantic-index.js" first.');
    process.exit(1);
  }
  const buf = fs.readFileSync(embPath);
  const embeddings = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const ids = JSON.parse(fs.readFileSync(idxPath, 'utf8')).map(String);
  const count = embeddings.length / EMBEDDING_DIM;
  console.log(`Loaded ${count} shabads (${(buf.byteLength / 1024 / 1024).toFixed(2)} MB)`);

  const transformers = require(
    path.join(__dirname, '..', 'frontend', 'node_modules', '@huggingface', 'transformers'),
  );
  const { pipeline, env } = transformers;
  env.cacheDir = path.join(__dirname, '.cache', 'transformers');
  console.log('Loading model…');
  // transformers.js v3 uses `dtype` instead of `quantized: true`.
  const embedder = await pipeline('feature-extraction', MODEL_NAME, { dtype: 'q8' });

  let evaluated = 0;
  let hits = 0;
  for (const row of FIXTURE) {
    if (!row.expected?.length) continue; // unscored — placeholder, skip
    evaluated += 1;
    const out = await embedder(`query: ${row.query}`, { pooling: 'mean', normalize: false });
    const qvec = new Float32Array(out.data);
    l2Normalize(qvec);
    const top = topKDot(qvec, embeddings, count, EMBEDDING_DIM, K);
    const topIds = top.map((t) => ids[t.index]);
    const hit = row.expected.some((id) => topIds.includes(String(id)));
    if (hit) hits += 1;
    if (VERBOSE || !hit) {
      const marker = hit ? '✓' : '✗';
      console.log(`${marker} ${row.query}`);
      console.log(`  expected: ${row.expected.join(', ')}`);
      console.log(`  top-${K}:  ${top.map((t) => `${ids[t.index]}(${t.score.toFixed(2)})`).join(', ')}`);
    }
  }

  const recall = evaluated ? hits / evaluated : 0;
  console.log(`\nrecall@${K} = ${hits}/${evaluated} = ${(recall * 100).toFixed(1)}%`);
  if (recall < 0.7) {
    console.warn('  ⚠ below 0.7 — consider tweaking doc construction.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('semantic-eval failed:', err);
  process.exitCode = 1;
});
