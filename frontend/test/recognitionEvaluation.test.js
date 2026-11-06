import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { matcherCalls, validateTrace } from '../src/utils/recognitionTrace';
import { alignAnnotations, evaluateRecognition, replayTimeline, summarizeDurations, validateAnnotations } from '../../tools/lib/recognition-evaluation.mjs';

const fixtureDir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const read = (file) => JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8'));
const fixture = () => read('recognition-synthetic.json');
const annotations = () => read('recognition-synthetic.labels.json');
const cli = fileURLToPath(new URL('../../tools/evaluate-recognition.mjs', import.meta.url));
const replayCli = fileURLToPath(new URL('../../tools/replay-session.mjs', import.meta.url));
const cache = fileURLToPath(new URL('../.cache/', import.meta.url));
fs.mkdirSync(cache, { recursive: true });
const scratch = fs.mkdtempSync(path.join(cache, 'evaluation-test-'));
let sequence = 0;
function save(value) { const file = path.join(scratch, `${++sequence}.json`); fs.writeFileSync(file, JSON.stringify(value)); return file; }
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  expect(result.error).toBeUndefined();
  return result;
}
afterAll(() => {
  for (const file of fs.readdirSync(scratch)) fs.unlinkSync(path.join(scratch, file));
  fs.rmdirSync(scratch);
});

describe('trace and independent annotation validation', () => {
  it('accepts v2 and retains legacy matcher inputs without inventing display evidence', () => {
    expect(validateTrace(fixture()).version).toBe(2);
    const legacy = read('replay-exact.json');
    expect(matcherCalls(legacy)).toEqual(legacy.events);
    const labels = { ...annotations(), sessionId: 'legacy', synthetic: false, segments: [{ id: 'legacy', startMs: 0, endMs: 190, activity: 'kirtan', target: { shabadId: 'fixture', lineIndex: 0 } }] };
    const report = evaluateRecognition(legacy, labels);
    expect(report.page.displayAccuracy.status).toBe('unavailable');
    expect(report.falseShabadSwitches.status).toBe('unavailable');
  });

  it.each(['missing-data', 'bad-time', 'duplicate-id', 'out-of-order', 'unknown-field', 'missing-verses'])(
    'rejects malformed trace: %s', (issue) => {
      const trace = fixture();
      if (issue === 'missing-data') delete trace.events[0].data;
      if (issue === 'bad-time') trace.events[0].t = -1;
      if (issue === 'duplicate-id') trace.events[1].id = trace.events[0].id;
      if (issue === 'out-of-order') trace.events[1].t = 4000;
      if (issue === 'unknown-field') trace.events[1].data.clientToken = 'must-not-be-recorded';
      if (issue === 'missing-verses') delete trace.shabads['synthetic-a'];
      expect(() => validateTrace(trace)).toThrow();
    },
  );

  it('rejects overlapping labels, mismatched sessions, invalid targets, and non-independent labels', () => {
    for (const mutate of [
      (l) => { l.segments[1].startMs = 1; }, (l) => { l.sessionId = 'wrong'; },
      (l) => { l.segments[0].target.lineIndex = -2; }, (l) => { l.provenance.independent = false; },
    ]) {
      const labels = annotations(); mutate(labels);
      expect(() => validateAnnotations(labels, fixture())).toThrow();
    }
  });

  it('requires explicit abstention for unknown segments', () => {
    const labels = annotations(); delete labels.segments[2].target;
    expect(() => validateAnnotations(labels, fixture())).toThrow(/explicit/);
  });
  it('detects a missing event when the exported count no longer matches', () => {
    const trace = fixture(); trace.events.pop();
    expect(() => validateTrace(trace)).toThrow(/eventCount/);
  });

  it('maps media labels through independent drift anchors without subtracting browser clocks', () => {
    const labels = annotations(); labels.timebase = 'media-ms';
    labels.alignment = { anchors: [{ mediaMs: 1000, traceMs: 0 }, { mediaMs: 61000, traceMs: 60000 }] };
    labels.segments = labels.segments.map((s) => ({ ...s, startMs: s.startMs + 1000, endMs: s.endMs + 1000 }));
    expect(alignAnnotations(labels).segments).toEqual(annotations().segments);
    expect(evaluateRecognition(fixture(), labels).page.displayAccuracy.percent).toBe(60);
    labels.alignment.anchors.pop();
    expect(() => alignAnnotations(labels)).toThrow(/two/);
  });

  it('rejects extrapolated or out-of-order media alignment', () => {
    const labels = annotations(); labels.timebase = 'media-ms';
    labels.alignment = { anchors: [{ mediaMs: 1000, traceMs: 0 }, { mediaMs: 61000, traceMs: 60000 }] };
    expect(() => alignAnnotations(labels)).toThrow(/extrapolated/);
    labels.alignment.anchors.reverse();
    expect(() => alignAnnotations(labels)).toThrow(/out-of-order/);
  });
});

describe('synthetic benchmark arithmetic and observed-state replay', () => {
  it('computes time weighting, false commits, returns, latency, recovery, and interventions independently of scores', () => {
    const report = evaluateRecognition(fixture(), annotations());
    expect(report.synthetic).toBe(true);
    expect(report.page.displayAccuracy.percent).toBe(60);
    expect(report.page.shabadAccuracy.percent).toBe(92);
    expect(report.page.totals.labeledMs).toBe(50000);
    expect(report.falseLineJumps).toMatchObject({ count: 1, perLabeledHour: 72 });
    expect(report.falseShabadSwitches).toMatchObject({ count: 1, perLabeledHour: 72 });
    expect(report.manualInterventions.observedCount).toBe(2);
    expect(report.page.transitionLatency).toMatchObject({ n: 3, medianMs: 2000, p90Ms: null, p95Ms: null, undetected: 1 });
    expect(report.page.transitionLatency.samples.find((s) => s.occurrenceId === 'a-rahao-return').latencyMs).toBe(2000);
    expect(report.page.recovery).toMatchObject({ n: 1, medianMs: 2000, censored: 0 });
    expect(report.page.coverage).toMatchObject({ heldPercent: 4, manualPercent: 2, followingPercent: 94 });
  });

  it('excludes ambiguous and instrumental intervals instead of treating them as correct', () => {
    const labels = annotations();
    for (const segment of labels.segments) { segment.activity = 'ambiguous'; segment.target = null; }
    const result = evaluateRecognition(fixture(), labels);
    expect(result.page.totals.labeledMs).toBe(0);
    expect(result.page.displayAccuracy.status).toBe('unavailable');
    expect(result.falseLineJumps.status).toBe('unavailable');
  });

  it('does not score proposals or projector publication as actual display', () => {
    const trace = fixture();
    trace.events = trace.events.filter((e) => ['session', 'matcher'].includes(e.type)); trace.eventCount = trace.events.length;
    const result = evaluateRecognition(trace, annotations());
    expect(result.page.displayAccuracy.status).toBe('unavailable');
    expect(result.falseLineJumps.status).toBe('unavailable');
    expect(result.falseShabadSwitches.status).toBe('unavailable');
  });

  it('reports unknown leading output time without estimating accuracy', () => {
    const trace = fixture(); trace.events = trace.events.filter((e) => e.type !== 'page' || e.t !== 0); trace.eventCount = trace.events.length;
    const result = evaluateRecognition(trace, annotations());
    expect(result.page.displayAccuracy).toMatchObject({ status: 'unavailable', unknownMs: 4000 });
  });

  it('retains recognition revisions, pending evidence, cooldowns, and manual changes in order', () => {
    const replay = replayTimeline(fixture());
    expect(replay.state.streams['synthetic-viewer']).toMatchObject({ final: 'alpha beta', interim: '' });
    expect(replay.checkpoints.find((p) => p.t === 35020).pending.shabadId).toBe('synthetic-c');
    expect(replay.checkpoints.find((p) => p.t === 37000 && p.cooldownUntil != null).cooldownUntil).toBe(42000);
    expect(replay.state.pending).toBeNull();
    expect(replay.state.page.shabadId).toBe('synthetic-b');
    expect(replay.limitation).toContain('not recomputed');
  });

  it.each(['old', null])('does not let an expired older response (%s) clear a newer pending request', (oldRequestId) => {
    const trace = fixture(); trace.events = [
      { id: 'old', t: 0, type: 'discovery', data: { action: 'request', requestId: 'old' } },
      { id: 'cancel', t: 1, type: 'discovery', data: { action: 'invalidate' } },
      { id: 'new', t: 2, type: 'discovery', data: { action: 'request', requestId: 'new' } },
      { id: 'pending', t: 3, type: 'discovery', data: { action: 'pending', requestId: 'new', shabadId: 'next' } },
      { id: 'late', t: 4, type: 'discovery', data: { action: 'expired', requestId: oldRequestId } },
    ]; trace.eventCount = trace.events.length;
    expect(replayTimeline(trace).state.pending.shabadId).toBe('next');
  });

  it('uses half-open label intervals at an exact canonical transition', () => {
    const trace = fixture();
    const a0 = trace.events[1].data.position;
    const a1 = { ...a0, lineIndex: 1, verseId: 'synthetic-a-1' };
    trace.durationMs = 20000;
    trace.events = [{ id: 'a', t: 0, type: 'page', data: { position: a0, mode: 'kirtan' } }, { id: 'b', t: 10000, type: 'page', data: { position: a1, mode: 'kirtan' } }]; trace.eventCount = 2;
    const labels = annotations(); labels.segments = labels.segments.slice(0, 2);
    const result = evaluateRecognition(trace, labels);
    expect(result.page.displayAccuracy.percent).toBe(100);
    expect(result.falseLineJumps.count).toBe(0);
    expect(result.page.transitionLatency.samples[0].latencyMs).toBe(0);
  });

  it('does not invent exact transition latency for uncertain boundary timing', () => {
    const labels = annotations(); labels.timingUncertaintyMs = 100;
    const result = evaluateRecognition(fixture(), labels);
    expect(result.page.transitionLatency.samples.every((s) => s.status === 'unavailable')).toBe(true);
    expect(result.annotation.evaluableTargetMs).toBe(49000);
  });

  it('withholds percentiles until enough detected samples exist', () => {
    expect(summarizeDurations([2000, 1000])).toMatchObject({ medianMs: 1500, p90Ms: null, p95Ms: null });
    expect(summarizeDurations(Array.from({ length: 20 }, (_, i) => i + 1))).toMatchObject({ medianMs: 10.5, p90Ms: 18, p95Ms: 19 });
  });

  it('keeps an unrecovered error as a censored episode', () => {
    const trace = fixture(); trace.durationMs = 10000;
    trace.events = trace.events.filter((e) => e.t <= 4000); trace.eventCount = trace.events.length;
    const labels = annotations(); labels.segments = labels.segments.slice(0, 1);
    const report = evaluateRecognition(trace, labels);
    expect(report.page.recovery).toMatchObject({ status: 'unavailable', n: 0, censored: 1 });
  });

  it('does not classify a Shabad switch as automatic when provenance is missing', () => {
    const trace = fixture(); trace.events = trace.events.filter((e) => e.type !== 'navigation'); trace.eventCount = trace.events.length;
    expect(evaluateRecognition(trace, annotations()).falseShabadSwitches.status).toBe('unavailable');
  });

  it('handles an empty recording as unavailable, not a perfect score', () => {
    const trace = fixture(); trace.durationMs = 0; trace.events = []; trace.eventCount = 0;
    const labels = annotations(); labels.segments = [];
    expect(evaluateRecognition(trace, labels).page.displayAccuracy.status).toBe('unavailable');
  });
});

describe('evaluation and legacy replay process exit codes', () => {
  const files = [path.join(fixtureDir, 'recognition-synthetic.json'), path.join(fixtureDir, 'recognition-synthetic.labels.json')];
  it('succeeds on a valid report and marks it synthetic', () => {
    const result = run(cli, files);
    expect(result.status).toBe(0); expect(result.stdout).toContain('SYNTHETIC');
  });
  it.each([['--min-display-accuracy', '80'], ['--max-false-shabad-switches', '0']])('fails a requested quality gate: %s', (option, value) => {
    expect(run(cli, [...files, option, value]).status).toBe(1);
  });
  it('fails invalid input with status 2', () => {
    expect(run(cli, [files[0], save({})]).status).toBe(2);
    expect(run(cli, ['missing-trace.json', files[1]]).status).toBe(2);
  });
  it('fails a required unavailable metric instead of guessing', () => {
    const trace = fixture(); trace.events = []; trace.eventCount = 0;
    expect(run(cli, [save(trace), files[1], '--require-metrics']).status).toBe(2);
  });
  it('creates blank annotations without deriving truth from displayed positions', () => {
    const out = path.join(scratch, 'blank-labels.json');
    expect(run(cli, [files[0], '--init-labels', out]).status).toBe(0);
    const labels = JSON.parse(fs.readFileSync(out));
    expect(labels.provenance.independent).toBe(false);
    expect(labels.segments[0]).toMatchObject({ activity: 'ambiguous', target: null });
    expect(run(cli, [files[0], '--init-labels', out]).status).toBe(2);
  });
  it('preserves exact and mismatch replay exits for v2 matcher events', () => {
    const legacy = read('replay-exact.json');
    const trace = fixture(); trace.durationMs = legacy.durationMs; trace.shabads = legacy.shabads;
    const { t, ...data } = legacy.events[0];
    trace.events = [{ id: 'legacy-call', t, type: 'matcher', data: { ...data, engine: 'kirtan' } }]; trace.eventCount = 1;
    expect(run(replayCli, [save(trace)]).status).toBe(0);
    trace.events[0].data.lineIndex = 99;
    expect(run(replayCli, [save(trace)]).status).toBe(1);
  });
});
