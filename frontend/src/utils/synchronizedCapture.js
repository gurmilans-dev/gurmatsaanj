import { currentRecordingSessionId, getTrace, isRecording, recordEvent, recordSyncMarker, recordingIdentity, startRecording, stopRecording } from './sessionRecorder';
import { createBundle, digest } from './captureBundle';

export const CAPTURE_LIMITS = Object.freeze({ maxBytes: 16 * 1024 * 1024, maxDurationMs: 10 * 60 * 1000, permissionTimeoutMs: 20000 });
const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
const activePhases = new Set(['requesting', 'recording', 'stopping']);
// The track overload is absent on mobile Chrome and older desktop engines.
export function supportsCaptureTrack(userAgent = globalThis.navigator?.userAgent || '') {
  const version = userAgent.match(/(?:Chrome|Chromium)\/(\d+)/);
  return Boolean(version && Number(version[1]) >= 135 && !/Android|Mobile|iPhone|iPad/i.test(userAgent));
}

// Owns only its audio stream. The recognizer and live policies are never patched.
export function createSynchronizedCapture(dependencies = {}) {
  const env = {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    Recorder: globalThis.MediaRecorder, now: () => performance.now(),
    setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: (id) => globalThis.clearTimeout(id),
    setInterval: (...args) => globalThis.setInterval(...args), clearInterval: (id) => globalThis.clearInterval(id),
    ...dependencies,
  };
  let phase = 'idle'; let reason = null; let chunks = []; let bytes = 0;
  let stream; let recorder; let timer; let permissionTimer; let stopTimer; let startTimer;
  let traceId; let trace; let started = 0; let requestAt; let audioStart; let stopRequested;
  let markers = []; let chunkTimes = []; let generation = 0; let completion; let resolveCompletion;
  let consent; let build; let audioSettings; let mimeType = ''; let endedListeners = [];
  const listeners = new Set();
  const status = () => ({ phase, active: activePhases.has(phase), ready: phase === 'ready', reason, bytes, durationMs: started ? Math.max(0, env.now() - started) : 0 });
  const emit = () => { for (const listener of listeners) listener(status()); };
  const ownsTrace = () => currentRecordingSessionId() === traceId;
  const note = (action, detail) => ownsTrace() && isRecording() ? recordEvent('session', { action, reason: detail }) : null;
  function finish() {
    if (phase === 'ready' || phase === 'idle') return;
    env.clearInterval(timer); env.clearTimeout(permissionTimer); env.clearTimeout(stopTimer); env.clearTimeout(startTimer);
    for (const [track, listener] of endedListeners) track.removeEventListener?.('ended', listener);
    endedListeners = [];
    stream?.getTracks().forEach((track) => track.stop());
    if (ownsTrace()) trace = stopRecording();
    else { reason ||= 'trace-replaced'; trace.capture = { ...trace.capture, complete: false, reason: 'trace-replaced' }; }
    phase = 'ready'; emit(); resolveCompletion?.(status());
  }
  function stop(cause = null) {
    if (!activePhases.has(phase)) return completion || Promise.resolve(status());
    reason ||= cause;
    if (phase === 'stopping') return completion;
    stopRequested = note('audio-stop-request', reason || 'operator-stop')?.t ?? null;
    phase = 'stopping'; emit(); env.clearTimeout(permissionTimer);
    if (recorder && recorder.state !== 'inactive') {
      stopTimer = env.setTimeout(() => { reason ||= 'recorder-stop-timeout'; finish(); }, 3000);
      try { recorder.stop(); } catch { reason ||= 'recorder-stop-error'; finish(); }
    } else finish();
    return completion;
  }
  async function start(options = {}) {
    if (phase !== 'idle') throw new Error('Export and discard the previous test capture first');
    if (options.consent !== true) throw new Error('Explicit recording consent is required');
    if (isRecording()) throw new Error('Stop the standalone trace recording first');
    if (!env.Recorder || !globalThis.isSecureContext && !dependencies.getUserMedia) throw new Error('Audio capture requires a supported secure browser');
    const ownGeneration = ++generation;
    consent = { audioRecording: true, onlineRecognition: options.onlineRecognition === true };
    build = options.build || { revision: null, dirty: null };
    phase = 'requesting'; started = env.now(); audioStart = null; stopRequested = null; reason = null;
    startRecording({ mode: options.mode, synthetic: options.synthetic === true });
    traceId = recordingIdentity(); trace = getTrace();
    completion = new Promise((resolve) => { resolveCompletion = resolve; });
    requestAt = note('audio-permission-request')?.t ?? null; emit();
    permissionTimer = env.setTimeout(() => stop('permission-timeout'), CAPTURE_LIMITS.permissionTimeoutMs);
    try {
      const acquired = await env.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (ownGeneration !== generation || phase !== 'requesting') { acquired.getTracks().forEach((track) => track.stop()); return status(); }
      env.clearTimeout(permissionTimer); stream = acquired;
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('No live audio track');
      const settings = track.getSettings?.() || {};
      audioSettings = Object.fromEntries(['sampleRate', 'channelCount', 'echoCancellation', 'noiseSuppression', 'autoGainControl'].filter((key) => settings[key] != null).map((key) => [key, settings[key]]));
      const type = types.find((candidate) => env.Recorder.isTypeSupported?.(candidate));
      if (!type) throw new Error('No supported audio recording format');
      recorder = new env.Recorder(stream, { mimeType: type, audioBitsPerSecond: 64000 }); mimeType = recorder.mimeType || type;
      recorder.onstart = () => {
        if (ownGeneration !== generation || phase !== 'requesting') return;
        env.clearTimeout(startTimer); audioStart = note('audio-start')?.t ?? null; phase = 'recording'; emit();
        try { options.onReady?.(track); } catch { stop('recognition-start-failed'); }
      };
      recorder.ondataavailable = (event) => {
        if (ownGeneration !== generation || phase === 'ready' || phase === 'idle' || !event.data?.size) return;
        if (bytes + event.data.size > CAPTURE_LIMITS.maxBytes) { stop('audio-byte-limit'); return; }
        chunks.push(event.data); bytes += event.data.size;
        if (chunkTimes.length < 1024) chunkTimes.push({ timecodeMs: Number.isFinite(event.timecode) ? event.timecode : null, receivedTraceMs: note('audio-chunk')?.t ?? null, bytes: event.data.size });
        emit();
      };
      recorder.onerror = () => { if (ownGeneration === generation) { note('audio-error', 'media-recorder-error'); stop('media-recorder-error'); } };
      recorder.onstop = () => { if (ownGeneration === generation && phase !== 'ready') { reason ||= phase === 'stopping' ? null : 'recorder-interrupted'; finish(); } };
      for (const ownedTrack of stream.getTracks()) {
        const listener = () => { if (ownGeneration === generation) stop('audio-track-ended'); }; ownedTrack.addEventListener?.('ended', listener); endedListeners.push([ownedTrack, listener]);
      }
      startTimer = env.setTimeout(() => stop('audio-start-timeout'), 3000);
      recorder.start(1000);
      timer = env.setInterval(() => {
        if (!ownsTrace() || !isRecording()) stop('trace-interrupted');
        else if (env.now() - started >= CAPTURE_LIMITS.maxDurationMs) stop('audio-duration-limit');
      }, 1000);
      return status();
    } catch (error) {
      if (ownGeneration !== generation || phase !== 'requesting') return status();
      note('audio-error', error?.name || 'capture-start-failed'); reason = error?.name === 'NotAllowedError' ? 'permission-denied' : 'audio-start-failed'; finish(); return status();
    }
  }
  function marker() {
    if (phase !== 'recording' || !ownsTrace()) return null;
    const event = recordSyncMarker();
    if (event && markers.length < 1024) markers.push({ eventId: event.id, traceMs: event.t, estimatedMediaMs: audioStart == null ? null : event.t - audioStart, status: 'provisional-event-clock' });
    emit(); return event;
  }
  async function bundle() {
    if (phase !== 'ready') throw new Error('Stop test capture before exporting');
    const audio = new Blob(chunks, { type: mimeType }); const traceBlob = new Blob([JSON.stringify(trace)], { type: 'application/json' });
    const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    const audioName = audio.size ? `audio.${extension}` : null;
    const manifest = { version: 1, kind: 'synchronized-recognition-capture', sessionId: traceId, synthetic: trace.metadata.synthetic,
      consent, build, browser: typeof navigator === 'undefined' ? null : navigator.userAgent,
      complete: !reason && audio.size > 0 && trace.capture.complete, reason: reason || (audio.size ? trace.capture.reason : 'no-audio'),
      trace: { file: 'trace.json', sha256: await digest(await traceBlob.arrayBuffer()) },
      audio: { file: audioName, sha256: audio.size ? await digest(await audio.arrayBuffer()) : null, bytes: audio.size, mimeType, settings: audioSettings || null },
      limits: CAPTURE_LIMITS, synchronization: { status: 'provisional-lifecycle-only', requestTraceMs: requestAt, startEventTraceMs: audioStart ?? null, stopRequestTraceMs: stopRequested ?? null, markers, chunks: chunkTimes,
        uncertaintyMs: null, interpretation: 'Recorder events and chunk timecodes are not first-sample timestamps. Verify independent audible/visible cues before scoring.' },
      recognitionInput: consent.onlineRecognition ? 'Capture audio track requested via native start(track); browser support and actual recognition processing must be verified separately.' : 'Recognition was not started by this capture.',
      transfer: 'This capture does not upload audio. If separately enabled, browser speech recognition may send audio to its online provider.' };
    const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    return createBundle([{ name: 'manifest.json', blob: manifestBlob }, { name: 'trace.json', blob: traceBlob }, ...(audioName ? [{ name: audioName, blob: audio }] : [])]);
  }
  function discard() {
    if (activePhases.has(phase)) throw new Error('Stop capture before discarding');
    generation += 1; chunks = []; markers = []; chunkTimes = []; bytes = 0; trace = null; stream = null; recorder = null;
    phase = 'idle'; reason = null; started = 0; audioStart = null; audioSettings = null; mimeType = ''; emit();
  }
  return { start, stop, marker, bundle, discard, status, audioTrack: () => activePhases.has(phase) ? stream?.getAudioTracks()[0] || null : null,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}

export const synchronizedCapture = createSynchronizedCapture();
