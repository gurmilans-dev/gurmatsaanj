#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectCapture, canonicalChoices } from './lib/capture-review.mjs';
import { BUNDLE_LIMIT } from '../frontend/src/utils/captureBundle.js';
import { readJson, sha256, writeNewOrSame, validateCanonicalReference } from './lib/recognition-validation.mjs';

try {
  const args = process.argv.slice(2); const input = args.shift(); const options = {};
  if (!input) throw new Error('Usage: node tools/prepare-capture-review.mjs capture.zip --out new-directory [--canonical shabad.json --source-url https://... --reference reviewed.json]');
  while (args.length) { const key = args.shift(); const value = args.shift(); if (!['--out', '--canonical', '--source-url', '--reference'].includes(key) || !value) throw new Error('Invalid option'); options[key.slice(2)] = value; }
  if (!options.out || fs.statSync(input).size > BUNDLE_LIMIT) throw new Error('New output directory and bounded bundle required');
  const output = path.resolve(options.out); if (fs.existsSync(output)) throw new Error('Use a new review directory; existing evidence is never overwritten');
  const capture = inspectCapture(fs.readFileSync(input));
  const canonical = options.canonical ? readJson(options.canonical) : null;
  const choices = canonical ? canonicalChoices(canonical) : [];
  if (choices.length && !options['source-url']?.startsWith('https://')) throw new Error('Independent canonical source URL required');
  let reference = null; let referenceEvidence = null;
  if (options.reference) {
    if (!canonical) throw new Error('Reference import requires a separate canonical response');
    const dictionary = Object.fromEntries(choices.map((c) => [c.target.shabadId, canonical]));
    reference = validateCanonicalReference(readJson(options.reference), dictionary);
    const hash = sha256(fs.readFileSync(options.reference));
    const source = readJson(fileURLToPath(new URL('../docs/recognition-sources.json', import.meta.url))).sources.find((s) => s.referenceSha256 === hash);
    if (!source) throw new Error('External reference must match a licensed pinned source in docs/recognition-sources.json');
    referenceEvidence = { sourceUrl: source.url, sha256: hash, license: source.license, attribution: source.attribution };
  }
  const data = { sessionId: capture.trace.sessionId, synthetic: capture.manifest.synthetic, durationMs: capture.trace.durationMs,
    audio: capture.manifest.audio.file, synchronization: capture.manifest.synchronization, choices,
    canonicalSource: options['source-url'] || null, canonicalSha256: canonical ? sha256(fs.readFileSync(options.canonical)) : null,
    referenceEvidence, referenceCandidates: reference?.occurrences.map((s) => ({ ...s, status: 'provisional-audio-review-required' })) || [] };
  const template = fs.readFileSync(fileURLToPath(new URL('./templates/capture-review.html', import.meta.url)), 'utf8');
  const html = template.replace('__CAPTURE_DATA__', JSON.stringify(data).replace(/</g, '\\u003c'));
  for (const [name, bytes] of Object.entries(capture.entries)) writeNewOrSame(path.join(output, name), bytes);
  writeNewOrSame(path.join(output, 'index.html'), html);
  writeNewOrSame(path.join(output, 'review-report.json'), JSON.stringify({ ...capture.report, bundleSha256: sha256(fs.readFileSync(input)), canonicalSource: data.canonicalSource, canonicalSha256: data.canonicalSha256,
    referenceEvidence, candidates: data.referenceCandidates.length, candidateStatus: 'provisional', labelsVerified: 0 }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'review-ready-unscored', output, ...capture.report }, null, 2));
} catch (error) { console.error(`Capture review failed: ${error.message}`); process.exitCode = 2; }
