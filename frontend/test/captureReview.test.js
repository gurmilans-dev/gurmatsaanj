import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { createBundle, digest } from '../src/utils/captureBundle';
import { canonicalChoices, inspectCapture } from '../../tools/lib/capture-review.mjs';
import { envelope, compareEnvelopes, speechObserved } from '../../tools/lib/audio-routing.mjs';
const cache = fileURLToPath(new URL('../.cache/', import.meta.url)); fs.mkdirSync(cache, { recursive: true });
const scratch = fs.mkdtempSync(path.join(cache, 'capture-review-test-'));
afterAll(() => { for (const file of fs.readdirSync(scratch)) fs.unlinkSync(path.join(scratch, file)); fs.rmdirSync(scratch); });
async function fixture(mutate = () => {}) {
  const trace = { version: 2, sessionId: 'constructed-capture-control', clock: 'relative-monotonic-ms', durationMs: 1000, metadata: { synthetic: true }, capture: { complete: true }, eventCount: 0, events: [], shabads: {} };
  const traceBlob = new Blob([JSON.stringify(trace)]); const audio = new Blob(['unit audio bytes']);
  const manifest = { version: 1, kind: 'synchronized-recognition-capture', synthetic: true, sessionId: trace.sessionId, consent: { audioRecording: true }, complete: true,
    trace: { file: 'trace.json', sha256: await digest(await traceBlob.arrayBuffer()) }, audio: { file: 'audio.webm', bytes: audio.size, sha256: await digest(await audio.arrayBuffer()) } };
  mutate(manifest);
  return new Uint8Array(await (await createBundle([{ name: 'manifest.json', blob: new Blob([JSON.stringify(manifest)]) }, { name: 'trace.json', blob: traceBlob }, { name: 'audio.webm', blob: audio }])).arrayBuffer());
}
describe('capture import and independent review', () => {
  it('validates binary identity without inventing ground truth or audio quality', async () => {
    const c = inspectCapture(await fixture()); expect(c.report.groundTruth.status).toBe('unavailable'); expect(c.report.synthetic).toBe(true); expect(c.report.audioBytes).toBe(16);
  });
  it.each(['session', 'synthetic', 'trace-hash', 'audio-hash', 'bytes', 'consent', 'path'])('rejects a mismatched manifest: %s', async (issue) => {
    const bytes = await fixture((m) => {
      if (issue === 'session') m.sessionId = 'other'; if (issue === 'synthetic') m.synthetic = false;
      if (issue === 'trace-hash') m.trace.sha256 = '0'.repeat(64); if (issue === 'audio-hash') m.audio.sha256 = '0'.repeat(64);
      if (issue === 'bytes') m.audio.bytes++; if (issue === 'consent') m.consent.audioRecording = false; if (issue === 'path') m.audio.file = '../audio.webm';
    }); expect(() => inspectCapture(bytes)).toThrow();
  });
  it('takes candidate IDs only from independently supplied canonical responses', () => {
    expect(canonicalChoices({ verses: [{ shabadId: 101, verseId: 201, verse: { unicode: 'ਅ' } }] })[0]).toMatchObject({ target: { shabadId: '101', verseId: '201', lineIndex: 0 } });
    expect(() => canonicalChoices({ verses: [{ shabadId: '../bad', verseId: 1 }] })).toThrow();
  });
  it('runs the real review CLI without exporting predictions or making network calls', async () => {
    const input = path.join(scratch, 'capture.zip'); fs.writeFileSync(input, await fixture()); const output = path.join(scratch, 'review');
    const cli = fileURLToPath(new URL('../../tools/prepare-capture-review.mjs', import.meta.url));
    try {
      const result = spawnSync(process.execPath, [cli, input, '--out', output], { encoding: 'utf8', timeout: 10000, windowsHide: true }); expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(fs.readFileSync(path.join(output, 'review-report.json'))); expect(report.labelsVerified).toBe(0); expect(report.candidateStatus).toBe('provisional');
      const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8'); expect(html).toContain("connect-src 'none'"); expect(html).not.toContain('__CAPTURE_DATA__');
      const again = spawnSync(process.execPath, [cli, input, '--out', output], { encoding: 'utf8', timeout: 10000, windowsHide: true }); expect(again.status).toBe(2);
    } finally { if (fs.existsSync(output)) { for (const file of fs.readdirSync(output)) fs.unlinkSync(path.join(output, file)); fs.rmdirSync(output); } }
  });
});
describe('sample-derived routing evidence', () => {
  it('finds a known offset in constructed envelopes without transcript-based alignment', () => {
    const reference = Array.from({ length: 2000 }, (_, i) => Math.sin(i * 0.12) * Math.sin(i * 0.051) + 1);
    expect(compareEnvelopes(reference.slice(37, 1400), reference)).toMatchObject({ offsetMs: 74, correlation: 1 });
  });
  it('does not verify silence or empty input as file identity', () => {
    expect(compareEnvelopes(Array(100).fill(0), Array(300).fill(0)).correlation).toBe(-1);
    expect(envelope([], 0)).toEqual([]);
  });
  it('does not count blank recognizer results as processed speech', () => {
    expect(speechObserved([{ type: 'result', text: '   ' }, { type: 'result', text: ' ' }, { type: 'result', text: null }])).toBe(false);
    expect(speechObserved([{ type: 'audiostart', text: 'x' }])).toBe(false);
    expect(speechObserved([{ type: 'result', text: ' ' }, { type: 'result', text: 'one two three' }])).toBe(true);
  });
});
