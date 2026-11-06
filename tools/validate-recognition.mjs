#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateRecognition, reportMarkdown } from './lib/recognition-evaluation.mjs';
import { evaluateVerifiedCase, fetchBounded, inspectTrace, readJson, sha256, timelineSvg, validateCanonicalReference, wavMetadata, writeNewOrSame } from './lib/recognition-validation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = {};
const inputs = [];
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (['--discover', '--fetch-public', '--fetch-audio', '--require-scored'].includes(arg)) option[arg.slice(2)] = true;
    else if (['--trace', '--out', '--case', '--sources', '--ffmpeg', '--media-dir'].includes(arg)) {
      const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing ${arg} value`);
      if (arg === '--trace') inputs.push(path.resolve(value)); else option[arg.slice(2)] = value;
    } else if (arg === '--help') {
      console.log('Usage: node tools/validate-recognition.mjs [--discover | --trace trace.json] [--fetch-public] [--case verified-case.json] --out new-report-directory [--require-scored]');
      process.exit(0);
    } else throw new Error(`Unknown option ${arg}`);
  }
  if (!option.out) throw new Error('--out is required; existing differing reports are never overwritten');
  if (option['fetch-audio'] && !option['fetch-public']) throw new Error('--fetch-audio also requires --fetch-public');
  const output = path.resolve(option.out);
  const sourcesFile = path.resolve(option.sources || path.join(root, 'docs', 'recognition-sources.json'));
  const sources = readJson(sourcesFile);
  if (option.discover) {
    for (const directory of [path.join(root, '.cache', 'recordings'), path.join(os.homedir(), 'Downloads')]) {
      if (!fs.existsSync(directory)) continue;
      for (const file of fs.readdirSync(directory)) if (/^kirtan-session-.*\.json$/i.test(file)) inputs.push(path.join(directory, file));
    }
  }
  const report = { version: 1, status: 'completed-with-unavailable-accuracy',
    recordingsScored: 0, localTraces: [], publicReferences: [], sourceInventory: sources.sources,
    syntheticValidation: evaluateRecognition(readJson(path.join(root, 'frontend/test/fixtures/recognition-synthetic.json')), readJson(path.join(root, 'frontend/test/fixtures/recognition-synthetic.labels.json'))),
    limitations: ['A trace does not contain its original audio.', 'Recognition outputs and page selections are not independent ground truth.', 'Public labels cannot be attached to a different recording by Shabad identity alone.'] };
  for (const [i, file] of [...new Set(inputs)].entries()) {
    const summary = inspectTrace(readJson(file));
    const bytes = fs.readFileSync(file);
    report.localTraces.push({ id: `local-trace-${i + 1}`, sha256: sha256(bytes), ...summary });
    writeNewOrSame(path.join(output, `local-trace-${i + 1}.svg`), timelineSvg(summary));
  }
  const cache = path.join(root, '.cache', 'real-validation', 'acquired');
  const acquire = async (url, file, maxBytes) => {
    if (fs.existsSync(file)) {
      if (fs.statSync(file).size > (maxBytes ?? 1024 * 1024)) throw new Error('Cached evidence exceeds byte bound');
      return fs.readFileSync(file);
    }
    const bytes = await fetchBounded(url, { maxBytes }); writeNewOrSame(file, bytes); return bytes;
  };
  if (option['fetch-public']) {
    for (const source of sources.sources.filter((s) => s.kind === 'reviewed-reference')) {
      try {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(source.recordingId)) throw new Error('Invalid source recording ID');
        const bytes = await acquire(source.url, path.join(cache, `${source.recordingId}.json`));
        if (source.referenceSha256 && sha256(bytes) !== source.referenceSha256) throw new Error('Pinned reference hash mismatch');
        const raw = JSON.parse(bytes);
        if (raw.video_id !== source.recordingId) throw new Error('Reference recording identity mismatch');
        const canonical = {};
        const canonicalEvidence = {};
        for (const id of new Set(raw.segments.map((s) => String(s.shabad_id)))) {
          if (!/^[1-9][0-9]{0,11}$/.test(id)) throw new Error('Invalid canonical ID');
          const url = `https://api.banidb.com/v2/shabads/${id}`;
          const canonicalBytes = await acquire(url, path.join(cache, `canonical-${id}.json`));
          canonical[id] = JSON.parse(canonicalBytes);
          canonicalEvidence[id] = { url, sha256: sha256(canonicalBytes) };
        }
        const reference = validateCanonicalReference(raw, canonical);
        let media = { status: 'not-collected' };
        const mediaDirectory = path.resolve(option['media-dir'] || path.join(cache, 'audio'));
        const wavFile = path.join(mediaDirectory, `${source.recordingId}.wav`);
        if (option['fetch-audio']) {
          if (!option.ffmpeg) throw new Error('--fetch-audio requires an explicit local --ffmpeg executable');
          const webmFile = path.join(mediaDirectory, `${source.recordingId}.webm`);
          const mediaBytes = await acquire(source.mediaUrl, webmFile, 8 * 1024 * 1024);
          if (source.mediaSha256 && sha256(mediaBytes) !== source.mediaSha256) throw new Error('Pinned audio hash mismatch');
          if (!fs.existsSync(wavFile)) {
            const decoded = spawnSync(path.resolve(option.ffmpeg), ['-hide_banner', '-nostdin', '-n', '-i', webmFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavFile], { encoding: 'utf8', timeout: 60000, windowsHide: true });
            if (decoded.status !== 0) throw new Error('Public audio decode failed');
          }
          media = { originalSha256: sha256(mediaBytes), sourceUrl: source.mediaUrl };
        }
        if (fs.existsSync(wavFile)) {
          if (fs.statSync(wavFile).size > 128 * 1024 * 1024) throw new Error('Decoded media exceeds bound');
          const decoded = fs.readFileSync(wavFile);
          const metadata = wavMetadata(decoded);
          media = { ...media, ...metadata, sha256: sha256(decoded), durationDeltaMs: metadata.durationMs - reference.durationMs,
            status: Math.abs(metadata.durationMs - reference.durationMs) <= 100 ? 'duration-consistent-sync-still-required' : 'duration-mismatch-sync-required' };
        }
        report.publicReferences.push({ sourceId: source.id, sourceUrl: source.url, referenceSha256: sha256(bytes), ...reference,
          canonicalEvidence, media, readiness: 'reference-ready-no-associated-application-capture', audioRedistributionLicense: 'not established; no audio committed' });
        writeNewOrSame(path.join(output, `${source.recordingId}.candidates.json`), JSON.stringify({ ...reference, sourceUrl: source.url, license: source.license, attribution: source.attribution }, null, 2) + '\n');
      } catch (error) { report.publicReferences.push({ sourceId: source.id, readiness: 'blocked', reason: error.message }); }
    }
  }
  if (option.case) {
    const caseFile = path.resolve(option.case); const base = path.dirname(caseFile); const descriptor = readJson(caseFile);
    const traceFile = path.resolve(base, descriptor.trace);
    readJson(traceFile); // Apply the trace size bound before loading evidence bytes.
    const traceBytes = fs.readFileSync(traceFile);
    const mediaPath = path.resolve(base, descriptor.media);
    if (fs.statSync(mediaPath).size > 128 * 1024 * 1024) throw new Error('Decode/split audio to at most 128 MiB before verified-case evaluation');
    const referenceFile = path.resolve(base, descriptor.reference);
    if (fs.statSync(referenceFile).size > 1024 * 1024) throw new Error('Reference exceeds byte bound');
    const referenceBytes = fs.readFileSync(referenceFile);
    const canonical = {};
    for (const [id, file] of Object.entries(descriptor.canonical || {})) canonical[id] = readJson(path.resolve(base, file));
    const result = evaluateVerifiedCase({ traceBytes, mediaBytes: fs.readFileSync(mediaPath), referenceBytes, canonicalByShabad: canonical, evidence: descriptor.evidence });
    writeNewOrSame(path.join(output, 'verified-labels.json'), JSON.stringify(result.labels, null, 2) + '\n');
    report.verifiedEvaluation = result.report;
    report.verifiedCaseEvidence = {
      ...descriptor.evidence,
      canonical: Object.fromEntries(Object.entries(descriptor.canonical || {}).map(([id, file]) => [id, {
        sha256: sha256(fs.readFileSync(path.resolve(base, file))),
      }])),
      interpretation: 'Hashes and declared review/synchronization provenance are auditable evidence, not automatic proof of annotation truth.',
    };
    report.recordingsScored = result.report.page.displayAccuracy.status === 'available' || result.report.page.shabadAccuracy.status === 'available' ? 1 : 0;
    report.status = report.recordingsScored ? 'evaluated-verified-case' : 'verified-case-output-insufficient';
  }
  const lines = ['# Recognition validation run', '',
    `Status: ${report.status}. Real application recordings scored against verified independent labels: ${report.recordingsScored}.`, '',
    '## Local operational evidence', '',
    ...report.localTraces.flatMap((s) => [
      `- ${s.id}: ${(s.durationMs / 1000).toFixed(3)} s; ${s.eventCount} events; matcher parity ${s.matcherParity.status} (${s.matcherParity.comparedCalls} calls, ${s.matcherParity.mismatches} mismatches).`,
      `- Projector commit acknowledgement upper bound: n=${s.projector.commitUpperBounds.n}, median=${s.projector.commitUpperBounds.medianMs ?? 'unavailable'} ms, p90=${s.projector.commitUpperBounds.p90Ms ?? 'unavailable'} ms, p95=${s.projector.commitUpperBounds.p95Ms ?? 'unavailable'} ms. Physical display timing unavailable.`,
      `- Accuracy unavailable: ${s.accuracy.reason}.`, `![Observed state](${s.id}.svg)`, '',
    ]),
    '## Independent references', '',
    ...report.publicReferences.map((r) => `- ${r.sourceId}: ${r.readiness}; ${r.occurrences?.length ?? 0} occurrences, ${r.canonicalFailures?.length ?? 0} canonical failures; audio ${r.media?.status || 'not-collected'}${r.reason ? `; ${r.reason}` : ''}.`), '',
    ...(report.verifiedEvaluation ? [reportMarkdown(report.verifiedEvaluation), ''] : []),
    '## Synthetic evaluator validation', '',
    `The synthetic fixture gives ${report.syntheticValidation.page.displayAccuracy.percent}% page accuracy and ${report.syntheticValidation.page.shabadAccuracy.percent}% Shabad accuracy. These are fabricated-output arithmetic checks, never real-world recognition scores.`, '',
    ...report.limitations.map((s) => `- ${s}`), '',
  ];
  writeNewOrSame(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeNewOrSame(path.join(output, 'report.md'), lines.join('\n'));
  console.log(JSON.stringify({ status: report.status, tracesInspected: report.localTraces.length, publicReferences: report.publicReferences.length, realRecordingsScored: report.recordingsScored, output }, null, 2));
  if (report.localTraces.some((s) => s.matcherParity.mismatches)) process.exitCode = 1;
  if (option['require-scored'] && report.recordingsScored === 0) process.exitCode = 2;
} catch (error) { console.error(`Recognition validation failed: ${error.message}`); process.exitCode = 2; }
