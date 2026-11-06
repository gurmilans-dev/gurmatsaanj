#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { eventCount, getTrace, isRecording, recordDecision, recordEvent, startRecording, stopRecording } from '../frontend/src/utils/sessionRecorder.js';
import { validateTrace } from '../frontend/src/utils/recognitionTrace.js';

// A CPU/serialization microbenchmark, not an audio or UI latency benchmark.
const verses = [{ gurmukhi: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ', verseId: 'synthetic-1' }];
const entry = { shabadId: 'synthetic', verses, tail: verses[0].gurmukhi, currentLine: 0, lineIndex: 0, confidence: 100, tracked: true };
const iterations = 10000;
for (let i = 0; i < 1000; i += 1) recordDecision(entry);
const measure = (enabled) => {
  if (enabled) startRecording({ synthetic: true, mode: 'overhead-probe' });
  else stopRecording();
  const beforeHeap = process.memoryUsage().heapUsed;
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) recordDecision(entry);
  const elapsedMs = performance.now() - start;
  const activeBeforeStop = isRecording();
  const count = eventCount();
  const trace = enabled ? stopRecording() : null;
  return { enabled, iterations, elapsedMs, microsecondsPerCall: elapsedMs * 1000 / iterations,
    heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap, events: enabled ? count : 0,
    recordingStayedActive: enabled ? activeBeforeStop : null,
    exportBytes: trace ? Buffer.byteLength(JSON.stringify(trace)) : 0 };
};
const disabled = measure(false);
const enabled = measure(true);
let stress = null;
if (process.argv.includes('--stress')) {
  globalThis.gc?.();
  const beforeHeap = process.memoryUsage().heapUsed;
  startRecording({ synthetic: true, mode: 'resource-limit-probe' });
  const start = performance.now();
  for (let i = 0; i < 130000; i += 1) recordEvent('session', { action: 'resource-probe' });
  const trace = stopRecording();
  validateTrace(trace);
  const retainedEvents = eventCount();
  let disabledPayloadCalls = 0;
  for (let i = 0; i < 10000; i += 1) recordEvent('session', () => { disabledPayloadCalls += 1; return {}; });
  globalThis.gc?.();
  stress = { attemptedEvents: 130000, retainedEvents, elapsedMs: performance.now() - start,
    complete: trace.capture.complete, stopReason: trace.capture.reason, exportBytes: Buffer.byteLength(JSON.stringify(trace)),
    heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap, garbageCollectionRequested: Boolean(globalThis.gc),
    inactiveEventGrowth: eventCount() - retainedEvents, disabledPayloadCalls };
  if (isRecording() || stress.stopReason !== 'event-limit' || retainedEvents !== trace.capture.limits.maxEvents ||
      stress.inactiveEventGrowth || disabledPayloadCalls) process.exitCode = 1;
}
console.log(JSON.stringify({ kind: 'synthetic-recorder-microbenchmark', runtime: process.version,
  disabled, enabled, stress, limits: getTrace().capture.limits,
  caveats: ['Single-process Node CPU/serialization only.', 'Heap deltas include allocation/GC noise.', 'Not browser hot-path, microphone, network, or render latency.'],
}, null, 2));
