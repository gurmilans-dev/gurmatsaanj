// Constructed offline test data only; no genuine annotated recording is fabricated.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { evaluateVerifiedCase, fetchBounded, inspectTrace, prepareAnnotations, sha256, timelineSvg, validateCanonicalReference, wavMetadata, writeNewOrSame } from '../../tools/lib/recognition-validation.mjs';

const cache = fileURLToPath(new URL('../.cache/', import.meta.url));
fs.mkdirSync(cache, { recursive: true });
const scratch = fs.mkdtempSync(path.join(cache, 'validation-test-'));
afterAll(() => { for (const name of fs.readdirSync(scratch)) fs.unlinkSync(path.join(scratch, name)); fs.rmdirSync(scratch); });
const json = (value) => Buffer.from(JSON.stringify(value));
function wave(seconds = 2) {
  const data = 16000 * seconds * 2;
  const bytes = Buffer.alloc(44 + data);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(data, 40); return bytes;
}
function testCase() {
  const position = { shabadId: '101', groupId: '101', verseId: '201', lineIndex: 0 };
  const trace = { version: 2, clock: 'relative-monotonic-ms', sessionId: 'constructed-unit-case', durationMs: 2000, eventCount: 1,
    metadata: { synthetic: false }, capture: { complete: true }, shabads: { '101': [{ gurmukhi: 'ਅ', verseId: '201' }] },
    events: [{ id: 'e1', t: 0, type: 'page', data: { mode: 'kirtan', position } }] };
  const raw = { video_id: 'constructed-unit-case', total_duration: 2, uem: { start: 0, end: 2 },
    lines: [{ line_idx: 0, shabad_id: 101 }], segments: [{ start: 0, end: 2, line_idx: 0, shabad_id: 101, verse_id: 201 }] };
  const canonicalByShabad = { '101': { verses: [{ shabadId: 101, verseId: 201 }] } };
  const traceBytes = json(trace); const referenceBytes = json(raw); const mediaBytes = wave();
  const evidence = { traceSha256: sha256(traceBytes), referenceSha256: sha256(referenceBytes), mediaSha256: sha256(mediaBytes), recordingId: raw.video_id,
    status: 'verified-external', independent: true, sourceUrl: 'https://reference.example.test/labels', license: 'test-only', timingUncertaintyMs: 0,
    anchors: [{ mediaMs: 0, traceMs: 0 }, { mediaMs: 2000, traceMs: 2000 }] };
  return { trace, traceBytes, referenceBytes, mediaBytes, canonicalByShabad, evidence, raw };
}

describe('independent evidence and canonical validation gates', () => {
  it('validates canonical identities and keeps every repeated occurrence', () => {
    const c = testCase(); c.raw.segments = [{ ...c.raw.segments[0], end: 1 }, { ...c.raw.segments[0], start: 1 }];
    const r = validateCanonicalReference(c.raw, c.canonicalByShabad);
    expect(r.occurrences).toHaveLength(2); expect(r.canonicalFailures).toEqual([]); expect(r.verifiedTargetMs).toBe(2000);
  });
  it('keeps canonical mismatches provisional and excludes them from verified time', () => {
    const c = testCase(); c.raw.segments[0].verse_id = 999;
    const r = validateCanonicalReference(c.raw, c.canonicalByShabad);
    expect(r.occurrences[0].status).toBe('provisional'); expect(r.verifiedTargetMs).toBe(0);
  });
  it('rejects malformed, overlapping, and out-of-range source intervals', () => {
    for (const mutation of [(c) => { c.raw.segments[0].end = 3; }, (c) => { c.raw.segments.push(c.raw.segments[0]); }, (c) => { c.raw.segments[0].shabad_id = '../outside'; }]) {
      const c = testCase(); mutation(c); expect(() => validateCanonicalReference(c.raw, c.canonicalByShabad)).toThrow();
    }
  });
  it('clips the reference to its declared scored region without inventing gap labels', () => {
    const c = testCase(); c.raw.uem = { start: 0.2, end: 1.8 };
    const r = validateCanonicalReference(c.raw, c.canonicalByShabad);
    expect(r.verifiedTargetMs).toBe(1600); expect(r.occurrences[0]).toMatchObject({ startMs: 200, endMs: 1800 });
  });
  it.each(['traceSha256', 'mediaSha256', 'referenceSha256', 'recordingId', 'sourceUrl', 'license', 'anchors', 'independent', 'status'])(
    'refuses promotion without %s', (key) => {
      const c = testCase(); delete c.evidence[key];
      expect(() => prepareAnnotations(c.trace, sha256(c.traceBytes), validateCanonicalReference(c.raw, c.canonicalByShabad), c.evidence)).toThrow();
    },
  );
  it('evaluates the fully evidenced constructed case without using predicted positions as labels', () => {
    const c = testCase(); const result = evaluateVerifiedCase(c);
    expect(result.report.page.displayAccuracy.percent).toBe(100);
    expect(result.labels.segments[0].target.verseId).toBe('201');
  });
  it('rejects a different media file and an audio-duration mismatch', () => {
    const c = testCase(); c.mediaBytes = wave(1);
    expect(() => evaluateVerifiedCase(c)).toThrow(/hashes/);
    c.evidence.mediaSha256 = sha256(c.mediaBytes);
    expect(() => evaluateVerifiedCase(c)).toThrow(/duration mismatch/);
  });
  it('does not promote synthetic captures to a real-world case', () => {
    const c = testCase(); c.trace.metadata.synthetic = true;
    c.traceBytes = json(c.trace);
    expect(() => evaluateVerifiedCase(c)).toThrow(/Synthetic/);
  });
  it('uses the hashed file contents rather than a different supplied trace object', () => {
    const c = testCase(); c.trace = { ...c.trace, metadata: { synthetic: true } };
    expect(evaluateVerifiedCase(c).report.page.displayAccuracy.percent).toBe(100);
  });
  it('refuses unsupported synchronization and excludes provisional targets', () => {
    const c = testCase(); const reference = validateCanonicalReference(c.raw, c.canonicalByShabad);
    c.evidence.anchors = [{ mediaMs: 0, traceMs: 0 }, { mediaMs: 1000, traceMs: 1000 }];
    expect(() => prepareAnnotations(c.trace, sha256(c.traceBytes), reference, c.evidence)).toThrow(/extrapolated/);
    c.evidence.anchors = [{ mediaMs: 0, traceMs: 0 }, { mediaMs: 2000, traceMs: 2000 }];
    reference.occurrences[0].status = 'provisional';
    expect(prepareAnnotations(c.trace, sha256(c.traceBytes), reference, c.evidence).segments[0]).toMatchObject({ activity: 'ambiguous', target: null });
  });
  it('validates actual PCM metadata and rejects truncated or inconsistent WAV', () => {
    expect(wavMetadata(wave()).durationMs).toBe(2000);
    expect(() => wavMetadata(wave().subarray(0, 50))).toThrow(/Truncated/);
    const bad = wave(); bad.writeUInt32LE(1, 28);
    expect(() => wavMetadata(bad)).toThrow(/inconsistent/);
  });
});

describe('safe acquisition, diagnostics, and process status', () => {
  it('checks response status, redirects, and streamed byte limits without network access', async () => {
    const fetcher = async (_, options) => { expect(options.redirect).toBe('error'); return new Response('12345'); };
    await expect(fetchBounded('https://example.test/data', { fetcher, maxBytes: 4 })).rejects.toThrow(/bound/);
    await expect(fetchBounded('http://example.test/data', { fetcher })).rejects.toThrow(/HTTPS/);
    await expect(fetchBounded('https://example.test/data', { fetcher: async () => new Response('', { status: 401 }) })).rejects.toThrow(/401/);
  });
  it('never overwrites differing existing evidence', () => {
    const file = path.join(scratch, 'evidence'); writeNewOrSame(file, 'original'); writeNewOrSame(file, 'original');
    expect(() => writeNewOrSame(file, 'different')).toThrow(/overwrite/);
    expect(fs.readFileSync(file, 'utf8')).toBe('original');
  });
  it('emits operational diagnostics without retaining transcript fragments', () => {
    const c = testCase();
    c.trace.events.push({ id: 'e2', t: 1, type: 'recognition', data: { streamId: 'unit-stream', action: 'result', append: 'private transcript sentinel', interim: '', final: true } });
    c.trace.eventCount = c.trace.events.length;
    const s = inspectTrace(c.trace);
    expect(s.accuracy.status).toBe('unavailable'); expect(s.manualEventsObserved).toBe(0);
    expect(JSON.stringify(s)).not.toContain('private transcript sentinel');
    expect(timelineSvg(s)).toContain('Ground truth unavailable');
  });
  it('returns a report with unavailable metrics and fails only when scored evidence is required', () => {
    const cli = fileURLToPath(new URL('../../tools/validate-recognition.mjs', import.meta.url));
    const traceFile = path.join(scratch, 'trace.json'); fs.writeFileSync(traceFile, json(testCase().trace));
    const output = path.join(scratch, 'output');
    const result = spawnSync(process.execPath, [cli, '--trace', traceFile, '--out', output, '--require-scored'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    try {
      expect(result.status).toBe(2);
      const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json')));
      expect(report.recordingsScored).toBe(0);
    } finally {
      if (fs.existsSync(output)) {
        for (const file of fs.readdirSync(output)) fs.unlinkSync(path.join(output, file));
        fs.rmdirSync(output);
      }
    }
  });
  it('exports evaluated metrics and their evidence chain through the real CLI', () => {
    const c = testCase();
    const cli = fileURLToPath(new URL('../../tools/validate-recognition.mjs', import.meta.url));
    const files = { 'case-trace.json': c.traceBytes, 'case.wav': c.mediaBytes, 'reference.json': c.referenceBytes,
      'canonical.json': json(c.canonicalByShabad['101']), 'case.json': json({ trace: 'case-trace.json', media: 'case.wav', reference: 'reference.json', canonical: { '101': 'canonical.json' }, evidence: c.evidence }) };
    for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(scratch, name), bytes);
    const output = path.join(scratch, 'verified-output');
    try {
      const result = spawnSync(process.execPath, [cli, '--case', path.join(scratch, 'case.json'), '--out', output, '--require-scored'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json')));
      expect(report.recordingsScored).toBe(1);
      expect(report.verifiedCaseEvidence.mediaSha256).toBe(c.evidence.mediaSha256);
      expect(fs.readFileSync(path.join(output, 'report.md'), 'utf8')).toContain('Page Shabad + Pangti accuracy');
    } finally {
      if (fs.existsSync(output)) {
        for (const file of fs.readdirSync(output)) fs.unlinkSync(path.join(output, file));
        fs.rmdirSync(output);
      }
    }
  });
});
