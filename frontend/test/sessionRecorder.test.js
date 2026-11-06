import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventCount, getTrace, isRecording, recordDecision, recordEvent, recordProjectorAck, recordingIdentity, recordSyncMarker, recordVerses, startRecording, stopRecording } from '../src/utils/sessionRecorder';
import { validateTrace } from '../src/utils/recognitionTrace';

describe('opt-in bounded versioned session recorder', () => {
  let now;
  beforeEach(() => { stopRecording(); now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now); });
  afterEach(() => { stopRecording(); vi.restoreAllMocks(); });

  it('does no serialization or payload work while disabled', () => {
    const payload = vi.fn(() => { throw new Error('must not run'); });
    expect(recordEvent('page', payload)).toBeNull();
    expect(payload).not.toHaveBeenCalled();
  });
  it('uses monotonic relative timing even if wall time moves backward', () => {
    startRecording(); now = 500;
    vi.spyOn(Date, 'now').mockReturnValue(-1000);
    recordEvent('hold', { state: 'held', freshnessMs: 2500 });
    now = 1000;
    const trace = stopRecording();
    expect(trace.events[1].t).toBe(500); expect(trace.durationMs).toBe(1000);
    expect(validateTrace(trace)).toBe(trace);
  });
  it('retains matcher parity fields and verse IDs without cumulative transcripts', () => {
    startRecording();
    recordDecision({ shabadId: 'fixture', verses: [{ gurmukhi: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ', verseId: '42' }], transcript: 'large cumulative transcript', tail: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ', currentLine: -1, lineIndex: 0, confidence: 100, tracked: true });
    const trace = stopRecording();
    expect(trace.events[1].data).not.toHaveProperty('transcript');
    expect(trace.shabads.fixture[0].verseId).toBe('42');
    expect(validateTrace(trace)).toBe(trace);
  });
  it('omits unknown fields, credentials, image data, QR links, and environment values', () => {
    startRecording();
    recordEvent('projector.publish', { mode: 'blank', position: null, clientToken: 'secret', backgroundDataUrl: 'private-image', sangatShareUrl: 'private-qr', environment: 'local-value' });
    const json = JSON.stringify(stopRecording());
    expect(json).not.toMatch(/secret|private-image|private-qr|local-value/);
  });
  it('returns independent snapshots', () => {
    startRecording(); const snapshot = getTrace(); snapshot.events[0].data.action = 'changed';
    expect(getTrace().events[0].data.action).toBe('start');
  });
  it('numbers synchronization markers across page lifetimes within a session', () => {
    startRecording();
    expect(recordSyncMarker().data.reason).toBe('marker-1');
    expect(recordSyncMarker().data.reason).toBe('marker-2');
    startRecording(); expect(recordSyncMarker().data.reason).toBe('marker-1');
  });
  it('stops at the event bound without evicting the beginning of the timeline', () => {
    startRecording({ limits: { maxEvents: 4 } });
    for (let i = 0; i < 100000; i += 1) recordEvent('hold', { state: 'held' });
    expect(eventCount()).toBe(4); expect(isRecording()).toBe(false);
    const trace = getTrace();
    expect(trace.capture).toMatchObject({ complete: false, reason: 'event-limit' });
    expect(trace.events[0].data.action).toBe('start'); expect(validateTrace(trace)).toBe(trace);
  });
  it('stops at the byte bound and limits canonical storage as well as events', () => {
    startRecording({ limits: { maxBytes: 2048 } });
    recordVerses('large', [{ gurmukhi: 'ਕ'.repeat(1500) }]);
    const trace = getTrace();
    expect(trace.capture.reason).toBe('byte-limit');
    expect(JSON.stringify(trace).length).toBeLessThan(2048);
    expect(trace.shabads.large).toBeUndefined();
  });
  it('budgets Unicode observations by UTF-8 bytes rather than character count', () => {
    startRecording({ limits: { maxBytes: 4096 } });
    const observation = { action: 'result', streamId: 'voice', append: 'ਕ'.repeat(500), interim: '', final: true };
    recordEvent('recognition', observation); recordEvent('recognition', observation);
    const trace = getTrace();
    expect(trace.capture.reason).toBe('byte-limit');
    expect(Buffer.byteLength(JSON.stringify(trace))).toBeLessThan(4096);
  });
  it('stops on a duration limit or oversized observation without silently clipping it', () => {
    startRecording({ limits: { maxDurationMs: 1000 } }); now = 2000;
    recordEvent('hold', { state: 'held' }); expect(getTrace().capture.reason).toBe('duration-limit');
    startRecording();
    recordEvent('recognition', { action: 'result', streamId: 'voice', append: 'a'.repeat(3000), interim: '', final: true });
    expect(getTrace().capture.reason).toBe('oversized-field'); expect(isRecording()).toBe(false);
  });
  it('correlates acknowledgements by session/publication using only sender time', () => {
    startRecording(); const sessionId = recordingIdentity();
    now = 20; const publication = recordEvent('projector.publish', { position: null, mode: 'blank' });
    now = 50; recordProjectorAck({ sessionId, publicationId: publication.id, phase: 'committed', receiverId: 'projector-1', position: null, mode: 'blank', remoteTimestamp: -99999 });
    recordProjectorAck({ sessionId, publicationId: publication.id, phase: 'committed', receiverId: 'projector-1', position: null, mode: 'blank' });
    recordProjectorAck({ sessionId: 'wrong', publicationId: publication.id, phase: 'committed' });
    recordProjectorAck({ sessionId, publicationId: 'unknown', phase: 'committed' });
    const ack = getTrace().events.filter((e) => e.type === 'projector.ack');
    expect(ack).toHaveLength(1); expect(ack[0].data.roundTripUpperBoundMs).toBe(30);
    expect(ack[0].data).not.toHaveProperty('remoteTimestamp');
  });
});
