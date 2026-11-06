import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSynchronizedCapture, CAPTURE_LIMITS, supportsCaptureTrack } from '../src/utils/synchronizedCapture';
import { createBundle, digest, readBundle } from '../src/utils/captureBundle';
import { currentRecordingSessionId, getTrace, isRecording, startRecording, stopRecording } from '../src/utils/sessionRecorder';
import { validateTrace } from '../src/utils/recognitionTrace';

const parse = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
let now; let track; let stream; let Recorder; let getUserMedia; let capture;
beforeEach(() => {
  stopRecording(); vi.useFakeTimers(); now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const events = new Map();
  track = { readyState: 'live', stop: vi.fn(), getSettings: () => ({ sampleRate: 48000, deviceId: 'private-device', groupId: 'private-group' }),
    addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name) => events.delete(name), end: () => events.get('ended')?.() };
  stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Recorder = class {
    static isTypeSupported = () => true;
    constructor(_, options) { this.mimeType = options.mimeType; this.state = 'inactive'; Recorder.instance = this; }
    start() { this.state = 'recording'; this.onstart?.(); }
    stop() { this.state = 'inactive'; this.onstop?.(); }
    chunk(value = 'audio') { this.ondataavailable?.({ data: new Blob([value]), timecode: 0 }); }
  };
  getUserMedia = vi.fn(async () => stream);
  capture = createSynchronizedCapture({ Recorder, getUserMedia, now: () => now });
});
afterEach(async () => { await capture.stop(); stopRecording(); vi.useRealTimers(); vi.restoreAllMocks(); });
const start = () => capture.start({ consent: true, mode: 'test', synthetic: true });
async function exported() { return readBundle(new Uint8Array(await (await capture.bundle()).arrayBuffer())); }

describe('opt-in synchronized local capture', () => {
  it.each([
    ['Chrome/156.0.0.0', true], ['Chrome/134.0.0.0', false], ['Android Chrome/156.0.0.0 Mobile', false],
    ['Version/26.0 Safari/605.1.15', false], ['Chrome/156.0.0.0 Edg/156.0.0.0', true],
  ])('uses a conservative desktop track-input compatibility gate: %s', (agent, expected) => {
    expect(supportsCaptureTrack(agent)).toBe(expected);
  });
  it('does not acquire a device, record a trace, or request permission while idle', () => {
    expect(capture.status().active).toBe(false); expect(getUserMedia).not.toHaveBeenCalled(); expect(isRecording()).toBe(false);
  });
  it('requires consent before any device access', async () => {
    await expect(capture.start()).rejects.toThrow(/consent/); expect(getUserMedia).not.toHaveBeenCalled();
  });
  it('does not overwrite an active standalone trace', async () => {
    startRecording(); const id = currentRecordingSessionId();
    await expect(start()).rejects.toThrow(/standalone/); expect(currentRecordingSessionId()).toBe(id); expect(getUserMedia).not.toHaveBeenCalled();
  });
  it('exports audio, exact trace identity, hashes, markers and provisional timing in one ZIP', async () => {
    await start(); now += 200; Recorder.instance.chunk(); capture.marker(); now += 1000; await capture.stop();
    const entries = await exported(); const manifest = parse(entries['manifest.json']); const trace = parse(entries['trace.json']);
    expect(validateTrace(trace)).toBe(trace); expect(manifest.sessionId).toBe(trace.sessionId);
    expect(manifest.trace.sha256).toBe(await digest(entries['trace.json'])); expect(manifest.audio.sha256).toBe(await digest(entries['audio.webm']));
    expect(manifest.complete).toBe(true); expect(manifest.synchronization.status).toBe('provisional-lifecycle-only');
    expect(manifest.synchronization.uncertaintyMs).toBeNull(); expect(manifest.synchronization.markers).toHaveLength(1);
    expect(JSON.stringify(manifest)).not.toMatch(/private-device|private-group/); expect(manifest.consent.onlineRecognition).toBe(false);
    expect(track.stop).toHaveBeenCalledOnce(); expect(isRecording()).toBe(false);
  });
  it('preserves standalone trace export after bundle capture', async () => {
    await start(); Recorder.instance.chunk(); await capture.stop();
    expect(validateTrace(getTrace()).sessionId).toBe(parse((await exported())['manifest.json']).sessionId);
  });
  it('exports a trace-only partial bundle after permission denial', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); await start();
    const entries = await exported(); expect(entries['audio.webm']).toBeUndefined();
    expect(parse(entries['manifest.json'])).toMatchObject({ complete: false, reason: 'permission-denied', audio: { file: null } });
  });
  it('releases a stream delivered after a cancelled permission prompt', async () => {
    let resolve; getUserMedia.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = start(); await capture.stop('operator-cancel'); resolve(stream); await pending;
    expect(track.stop).toHaveBeenCalledOnce(); expect(capture.status()).toMatchObject({ ready: true, reason: 'operator-cancel' });
  });
  it('times out permission without leaving a late microphone running', async () => {
    let resolve; getUserMedia.mockImplementation(() => new Promise((done) => { resolve = done; })); const pending = start();
    await vi.advanceTimersByTimeAsync(CAPTURE_LIMITS.permissionTimeoutMs); resolve(stream); await pending;
    expect(capture.status().reason).toBe('permission-timeout'); expect(track.stop).toHaveBeenCalledOnce();
  });
  it('ignores a late permission rejection after cancellation/discard', async () => {
    let reject; getUserMedia.mockImplementation(() => new Promise((_, fail) => { reject = fail; })); const pending = start();
    await capture.stop(); capture.discard(); reject(new Error('late')); await pending;
    expect(capture.status().phase).toBe('idle');
  });
  it('does not start a cancelled online observation when its permission resolves during a new audio-only capture', async () => {
    let resolve; const onlineStart = vi.fn(); const staleTrack = { stop: vi.fn() };
    getUserMedia.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = capture.start({ consent: true, onlineRecognition: true, onReady: onlineStart });
    await capture.stop(); capture.discard(); await start();
    resolve({ getTracks: () => [staleTrack] }); await pending;
    expect(onlineStart).not.toHaveBeenCalled(); expect(staleTrack.stop).toHaveBeenCalledOnce(); expect(track.stop).not.toHaveBeenCalled();
  });
  it('isolates delayed recorder callbacks from a subsequent capture generation', async () => {
    await start(); const stale = Recorder.instance; await capture.stop(); capture.discard();
    await start(); Recorder.instance.chunk('new');
    stale.onstart(); stale.chunk('stale'); stale.onerror(); stale.onstop();
    expect(capture.status()).toMatchObject({ phase: 'recording', bytes: 3 });
    await capture.stop(); expect(new TextDecoder().decode((await exported())['audio.webm'])).toBe('new');
  });
  it('stops at the audio byte limit without retaining the overflowing chunk', async () => {
    await start(); Recorder.instance.chunk(); Recorder.instance.chunk(new Uint8Array(CAPTURE_LIMITS.maxBytes));
    expect(capture.status()).toMatchObject({ ready: true, bytes: 5, reason: 'audio-byte-limit' });
    expect(parse((await exported())['manifest.json']).complete).toBe(false);
  });
  it('exports the full bounded audio prefix at capacity and discards retained state explicitly', async () => {
    await start(); const chunk = new Uint8Array(1024 * 1024);
    for (let i = 0; i < 16; i++) Recorder.instance.chunk(chunk);
    expect(capture.status().bytes).toBe(CAPTURE_LIMITS.maxBytes);
    Recorder.instance.chunk('overflow');
    const entries = await exported(); expect(entries['audio.webm'].length).toBe(CAPTURE_LIMITS.maxBytes);
    expect(parse(entries['manifest.json'])).toMatchObject({ complete: false, reason: 'audio-byte-limit' });
    capture.discard(); expect(capture.status().bytes).toBe(0);
  });
  it('stops at the duration limit and releases only its own microphone', async () => {
    await start(); Recorder.instance.chunk(); now += CAPTURE_LIMITS.maxDurationMs; await vi.advanceTimersByTimeAsync(1000);
    expect(capture.status()).toMatchObject({ ready: true, reason: 'audio-duration-limit' }); expect(track.stop).toHaveBeenCalledOnce();
  });
  it.each(['audio-track-ended', 'media-recorder-error', 'recorder-interrupted'])('retains partial evidence on %s', async (reason) => {
    await start(); Recorder.instance.chunk();
    if (reason === 'audio-track-ended') track.end();
    if (reason === 'media-recorder-error') Recorder.instance.onerror();
    if (reason === 'recorder-interrupted') { Recorder.instance.state = 'inactive'; Recorder.instance.onstop(); }
    expect(capture.status()).toMatchObject({ ready: true, reason }); expect(parse((await exported())['manifest.json']).complete).toBe(false);
  });
  it('does not stop a replacement trace and explicitly marks its retained prefix partial', async () => {
    await start(); startRecording({ synthetic: true }); const id = currentRecordingSessionId(); await vi.advanceTimersByTimeAsync(1000);
    expect(isRecording()).toBe(true); expect(currentRecordingSessionId()).toBe(id);
    expect(parse((await exported())['manifest.json']).complete).toBe(false);
  });
  it('handles a recorder that never emits stop', async () => {
    await start(); Recorder.instance.stop = () => {}; const stopping = capture.stop(); await vi.advanceTimersByTimeAsync(3000); await stopping;
    expect(capture.status()).toMatchObject({ ready: true, reason: 'recorder-stop-timeout' }); expect(track.stop).toHaveBeenCalledOnce();
  });
  it('handles a recorder that never starts without falling back to any other microphone', async () => {
    Recorder.prototype.start = function () { this.state = 'recording'; };
    await start(); await vi.advanceTimersByTimeAsync(3000);
    expect(capture.status()).toMatchObject({ ready: true, reason: 'audio-start-timeout' }); expect(track.stop).toHaveBeenCalledOnce();
  });
  it('retains the final recorder chunk before taking the stopped trace snapshot', async () => {
    await start(); expect(capture.audioTrack()).toBe(track);
    Recorder.instance.stop = function () { this.chunk('final audio'); this.state = 'inactive'; this.onstop(); };
    await capture.stop(); const entries = await exported();
    expect(new TextDecoder().decode(entries['audio.webm'])).toBe('final audio'); expect(capture.audioTrack()).toBeNull();
  });
  it('handles unsupported formats and recorder constructor errors as partial capture', async () => {
    Recorder.isTypeSupported = () => false; await start();
    expect(capture.status().reason).toBe('audio-start-failed'); expect(track.stop).toHaveBeenCalledOnce();
  });
  it('requires stop before export/discard and releases retained chunks after discard', async () => {
    await start(); await expect(capture.bundle()).rejects.toThrow(/Stop/); expect(() => capture.discard()).toThrow(/Stop/);
    Recorder.instance.chunk(); await capture.stop(); capture.discard(); expect(capture.status()).toMatchObject({ phase: 'idle', bytes: 0 });
  });
});

describe('bounded binary bundle validation', () => {
  const entries = () => [{ name: 'manifest.json', blob: new Blob(['{}']) }, { name: 'trace.json', blob: new Blob(['{}']) }];
  it('round-trips binary data and rejects corrupted payloads', async () => {
    const bytes = new Uint8Array(await (await createBundle(entries())).arrayBuffer());
    expect(parse(readBundle(bytes)['trace.json'])).toEqual({}); bytes[45] ^= 1; expect(() => readBundle(bytes)).toThrow();
  });
  it('rejects duplicate and unsafe filenames before export', async () => {
    await expect(createBundle([entries()[0], entries()[0]])).rejects.toThrow();
    await expect(createBundle([{ name: '../audio.webm', blob: new Blob() }])).rejects.toThrow();
  });
  it('rejects truncated, unknown and compressed archive layouts', async () => {
    const bytes = new Uint8Array(await (await createBundle(entries())).arrayBuffer());
    expect(() => readBundle(bytes.subarray(0, -1))).toThrow(); bytes[8] = 8; expect(() => readBundle(bytes)).toThrow(/mismatch/);
  });
});
