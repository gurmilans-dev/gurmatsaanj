import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useAudioMeter — a preflight input-level meter for the Audio Setup page.
 *
 * Opens a getUserMedia stream for the chosen device, runs a Web Audio analyser
 * loop, and reports a smoothed level plus operator-facing status (Good / Too
 * quiet / Clipping) and a noise-floor estimate. It is a *preflight* tool — it
 * never feeds recognition, and it tears the stream down on stop/unmount so the
 * mic isn't left open.
 *
 * Design notes (from the plan):
 *  - Clipping is SUSTAINED, not instantaneous: a near-full-scale level must
 *    persist ~CLIP_HOLD_MS before we call it clipping, so a single transient
 *    doesn't trip it.
 *  - Noise floor uses a low percentile of recent RMS (not min), which is far
 *    less misleading than a single dip.
 *  - The live MediaStreamTrack is kept reachable (getTrack) for a possible
 *    Phase-2 recognition-routing feature, but nothing here routes recognition.
 *
 * getUserMedia requires a secure context (HTTPS or localhost). Callers should
 * check `isAudioMeterSupported()` before offering the meter.
 */

const NEAR_FULL_SCALE = 0.98; // |sample| at/above this counts toward clipping
const CLIP_HOLD_MS = 400;     // sustained near-full-scale before "Clipping"
const QUIET_LEVEL = 0.03;     // held peak below this → "Too quiet" (basically silent)
// Lower edge of the on-screen green "target band" (= -12 dBFS = 10^(-12/20)).
// Held peak below this but above QUIET_LEVEL → "low" (audible but under target);
// reaching it → "good". KEEP IN SYNC with the band left:25% in AudioCheckPanel.css.
const TARGET_LOW = 0.25;
const PEAK_DECAY_PER_SEC = 0.6; // peak-hold decay so the bar/status are stable
const RMS_WINDOW = 90;        // ~4.5s of samples at the ~20fps state cadence
const STATE_FPS = 20;         // throttle React updates (the rAF loop is 60fps)

export function isAudioMeterSupported() {
  return Boolean(
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function',
  );
}

function lowPercentile(values, p = 0.1) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function noiseFloorLabel(floorRms) {
  if (floorRms < 0.015) return 'low';
  if (floorRms < 0.04) return 'medium';
  return 'high';
}

export default function useAudioMeter() {
  const [state, setState] = useState({
    running: false,
    level: 0,          // 0..1, peak-held — drives the bar
    peak: 0,           // 0..1, instantaneous peak
    rms: 0,            // 0..1, instantaneous RMS loudness
    clipping: false,
    noiseFloor: 'low', // 'low' | 'medium' | 'high'
    status: 'idle',    // 'idle' | 'good' | 'quiet' | 'clipping'
    activeDeviceId: '',
    activeLabel: '',
    error: '',
  });

  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(0);
  const dataRef = useRef(null);
  const heldPeakRef = useRef(0);
  const clipMsRef = useRef(0);
  const rmsWindowRef = useRef([]);
  const lastFrameRef = useRef(0);
  const lastStateAtRef = useRef(0);
  // Generation id so only the LATEST start() can attach its stream/analyser/rAF.
  // A single boolean isn't enough: if the operator switches device mid-prompt, a
  // second start() would un-cancel the first, and both late getUserMedia()
  // resolutions would attach — orphaning the first stream + AudioContext and
  // running two rAF loops. Each start() claims a new id; teardown bumps it too,
  // so unmount/stop also invalidate any in-flight start().
  const runIdRef = useRef(0);

  const teardown = useCallback(() => {
    runIdRef.current += 1;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
      streamRef.current = null;
    }
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch { /* noop */ }
      ctxRef.current = null;
    }
    analyserRef.current = null;
    dataRef.current = null;
    heldPeakRef.current = 0;
    clipMsRef.current = 0;
    rmsWindowRef.current = [];
  }, []);

  const stop = useCallback(() => {
    teardown();
    setState((s) => ({ ...s, running: false, level: 0, peak: 0, rms: 0, clipping: false, status: 'idle' }));
  }, [teardown]);

  const tick = useCallback((now) => {
    const analyser = analyserRef.current;
    const data = dataRef.current;
    if (!analyser || !data) return;

    const dtMs = lastFrameRef.current ? now - lastFrameRef.current : 16;
    lastFrameRef.current = now;

    analyser.getByteTimeDomainData(data);
    let sumSq = 0;
    let peak = 0;
    let nearFull = false;
    for (let i = 0; i < data.length; i += 1) {
      const v = (data[i] - 128) / 128; // -1..1
      const abs = Math.abs(v);
      sumSq += v * v;
      if (abs > peak) peak = abs;
      if (abs >= NEAR_FULL_SCALE) nearFull = true;
    }
    const rms = Math.sqrt(sumSq / data.length);

    // Peak-hold with decay → stable bar + status.
    const decay = PEAK_DECAY_PER_SEC * (dtMs / 1000);
    heldPeakRef.current = Math.max(peak, heldPeakRef.current - decay);

    // Sustained clipping accumulation.
    if (nearFull) clipMsRef.current += dtMs;
    else clipMsRef.current = Math.max(0, clipMsRef.current - dtMs * 1.5); // decay faster than it builds
    const clipping = clipMsRef.current >= CLIP_HOLD_MS;

    // Rolling RMS window for the noise floor (low percentile).
    const win = rmsWindowRef.current;
    win.push(rms);
    if (win.length > RMS_WINDOW) win.shift();

    // Throttle React state updates.
    if (now - lastStateAtRef.current >= 1000 / STATE_FPS) {
      lastStateAtRef.current = now;
      const held = heldPeakRef.current;
      const floor = lowPercentile(win, 0.1);
      const status = clipping
        ? 'clipping'
        : held < QUIET_LEVEL
          ? 'quiet'
          : held < TARGET_LOW
            ? 'low'
            : 'good';
      setState((s) => ({
        ...s,
        level: held,
        peak,
        rms,
        clipping,
        noiseFloor: noiseFloorLabel(floor),
        status,
      }));
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async (deviceId) => {
    if (!isAudioMeterSupported()) {
      setState((s) => ({ ...s, error: 'insecure-context' }));
      return false;
    }
    teardown();
    const myId = ++runIdRef.current; // claim this run (teardown bumped the id)
    try {
      const constraints = {
        audio: deviceId
          ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
          : { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      // Superseded by a newer start(), or torn down/unmounted while the prompt
      // was open → release the just-granted stream instead of wiring it up.
      if (myId !== runIdRef.current) {
        stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
        return false;
      }
      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      const settings = track?.getSettings?.() || {};

      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.fftSize);

      heldPeakRef.current = 0;
      clipMsRef.current = 0;
      rmsWindowRef.current = [];
      lastFrameRef.current = 0;
      lastStateAtRef.current = 0;

      setState((s) => ({
        ...s,
        running: true,
        error: '',
        activeDeviceId: settings.deviceId || '',
        activeLabel: track?.label || '',
        status: 'good',
      }));
      rafRef.current = requestAnimationFrame(tick);
      return true;
    } catch (err) {
      // A superseded run failing must not clobber the latest run's state.
      if (myId !== runIdRef.current) return false;
      teardown();
      const name = err?.name || '';
      const code = name === 'NotAllowedError' || name === 'SecurityError'
        ? 'permission-denied'
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? 'no-device'
          : 'start-failed';
      setState((s) => ({ ...s, running: false, error: code }));
      return false;
    }
  }, [teardown, tick]);

  // Keep the live track reachable for a possible Phase-2 recognition-routing
  // feature. Nothing in v1 calls this.
  const getTrack = useCallback(() => streamRef.current?.getAudioTracks?.()[0] || null, []);

  useEffect(() => () => teardown(), [teardown]);

  return { ...state, start, stop, getTrack };
}

/**
 * List audioinput devices. Labels are only populated after mic permission has
 * been granted, so call this *after* a successful getUserMedia.
 */
export async function listAudioInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

/**
 * Resolve the SYSTEM DEFAULT input — what Web Speech recognition will actually
 * use. Opens an unconstrained stream, reads the resolved deviceId/label, then
 * releases it immediately. Returns null if unavailable.
 */
export async function getDefaultInputDevice() {
  if (!isAudioMeterSupported()) return null;
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings?.() || {};
    return { deviceId: settings.deviceId || '', label: track?.label || '' };
  } catch {
    return null;
  } finally {
    if (stream) stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
  }
}
