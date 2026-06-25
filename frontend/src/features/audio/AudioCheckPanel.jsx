import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import useAudioMeter, {
  isAudioMeterSupported, listAudioInputs, getDefaultInputDevice,
} from '../../hooks/useAudioMeter';
import useVoiceRecognition from '../../hooks/useVoiceRecognition';
import { saveAudioVerified } from '../../utils/audioVerification';
import './AudioCheckPanel.css';

const DEVICE_KEY = 'saanj-kirtan.audioInputDeviceId';

function readSavedDevice() {
  try { return localStorage.getItem(DEVICE_KEY) || ''; } catch { return ''; }
}
function saveDevice(id) {
  try {
    if (id) localStorage.setItem(DEVICE_KEY, id);
    else localStorage.removeItem(DEVICE_KEY);
  } catch { /* noop */ }
}

function deviceLabel(devices, deviceId, fallback) {
  const d = devices.find((x) => x.deviceId === deviceId);
  return d?.label || fallback || '';
}

const GURMUKHI_RE = /[\u0A00-\u0A7F]/;
const GURMUKHI_CHAR_RE = /[\u0A00-\u0A7F]/g;
const CALIBRATION_SILENCE_MS = 5000;
const CALIBRATION_SIGNAL_MS = 10000;

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function percent(value) {
  return Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 100);
}

function buildCalibrationResult(samples) {
  const silenceRms = samples.silence.map((s) => s.rms);
  const signalRms = samples.signal.map((s) => s.rms);
  const signalPeak = samples.signal.map((s) => s.peak);
  const noiseAvg = average(silenceRms);
  const signalAvg = average(signalRms);
  const peak50 = percentile(signalPeak, 0.5);   // typical (median) peak — the level you sit at
  const peak90 = percentile(signalPeak, 0.9);   // robust loud level — used for the verdict
  const peakMax = signalPeak.length ? Math.max(...signalPeak) : 0; // loudest moment — headroom
  const clipped = samples.signal.some((s) => s.clipping || s.peak >= 0.98);
  const noisy = noiseAvg >= 0.04;
  const weakSeparation = signalAvg > 0 && noiseAvg > 0 && signalAvg < noiseAvg * 3;
  const metrics = { noiseAvg, signalAvg, peak50, peak90, peakMax };

  if (clipped || peak90 >= 0.92) {
    return { tone: 'danger', code: 'clipping', ...metrics };
  }
  if (peak90 < 0.25 || signalAvg < 0.035) {
    return { tone: 'warn', code: 'quiet', ...metrics };
  }
  if (noisy || weakSeparation) {
    return { tone: 'warn', code: 'noisy', ...metrics };
  }
  return { tone: 'ready', code: 'good', ...metrics };
}

export default function AudioCheckPanel() {
  const { lang, tLang, voice } = useApp();
  const meter = useAudioMeter();
  const supported = isAudioMeterSupported();
  // Separate recognition instance for the preflight transcript. wordLimit 0 =
  // no auto-stop (listen continuously). This reads the SYSTEM DEFAULT mic —
  // what live recognition actually uses — independent of the meter's device.
  const recog = useVoiceRecognition({ lang: 'pa-IN', wordLimit: 0 });

  // Guards so a slow async test (device switch / leaving the page) can't apply
  // stale results over newer ones, or set state after unmount.
  const mountedRef = useRef(true);
  const beginIdRef = useRef(0);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Two SpeechRecognition instances competing for the mic can error, so the
  // preflight recognition test is gated when the app's live mic is running.
  const liveMicBusy = Boolean(voice?.isListening);
  const [recogStartedAt, setRecogStartedAt] = useState(0);
  const [recogClock, setRecogClock] = useState(0);

  const [devices, setDevices] = useState([]);
  const [selectedId, setSelectedId] = useState(readSavedDevice);
  const [defaultDevice, setDefaultDevice] = useState(null);
  const calibrationSamplesRef = useRef({ silence: [], signal: [] });
  const [calibration, setCalibration] = useState({
    step: 'idle',
    startedAt: 0,
    result: null,
  });
  const [calibrationClock, setCalibrationClock] = useState(0);

  useEffect(() => {
    if (!recog.isListening) return undefined;
    setRecogClock(Date.now());
    const id = window.setInterval(() => setRecogClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [recog.isListening]);

  // Re-enumerate when devices are plugged/unplugged (labels stay if permission
  // was already granted).
  useEffect(() => {
    if (!supported || !navigator.mediaDevices) return undefined;
    const onChange = () => { listAudioInputs().then(setDevices).catch(() => {}); };
    navigator.mediaDevices.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', onChange);
  }, [supported]);

  const beginTest = useCallback(async (deviceId) => {
    const myId = ++beginIdRef.current;
    const ok = await meter.start(deviceId || undefined);
    // Bail if superseded by a newer test (device switch) or the panel unmounted.
    if (!ok || myId !== beginIdRef.current || !mountedRef.current) return false;
    // Labels are available only after permission — (re)load the list + default.
    const [inputs, def] = await Promise.all([listAudioInputs(), getDefaultInputDevice()]);
    if (myId !== beginIdRef.current || !mountedRef.current) return false;
    setDevices(inputs);
    setDefaultDevice(def);
    return true;
  }, [meter]);

  const resetCalibration = useCallback(() => {
    calibrationSamplesRef.current = { silence: [], signal: [] };
    setCalibration({ step: 'idle', startedAt: 0, result: null });
  }, []);

  const handleTest = () => {
    resetCalibration();
    beginTest(selectedId);
  };

  const handleDeviceChange = (e) => {
    const id = e.target.value;
    setSelectedId(id);
    saveDevice(id);
    resetCalibration();
    if (meter.running) beginTest(id); // restart on the new device
  };

  const stopMeter = () => {
    if (calibrationActive) resetCalibration();
    meter.stop();
  };

  const calibrationActive = calibration.step === 'silence' || calibration.step === 'signal';

  const startCalibration = useCallback(async () => {
    const ok = meter.running ? true : await beginTest(selectedId);
    if (!ok) return;
    calibrationSamplesRef.current = { silence: [], signal: [] };
    const now = Date.now();
    setCalibrationClock(now);
    setCalibration({ step: 'silence', startedAt: now, result: null });
  }, [beginTest, meter.running, selectedId]);

  useEffect(() => {
    if (!calibrationActive || !meter.running) return;
    const bucket = calibration.step === 'silence' ? 'silence' : 'signal';
    calibrationSamplesRef.current[bucket].push({
      rms: meter.rms || 0,
      peak: meter.peak || 0,
      clipping: Boolean(meter.clipping),
    });
  }, [calibration.step, calibrationActive, meter.clipping, meter.peak, meter.rms, meter.running]);

  useEffect(() => {
    if (!calibrationActive || !meter.running) return undefined;
    const id = window.setInterval(() => {
      const now = Date.now();
      setCalibrationClock(now);
      setCalibration((prev) => {
        if (prev.step === 'silence' && now - prev.startedAt >= CALIBRATION_SILENCE_MS) {
          return { step: 'signal', startedAt: now, result: null };
        }
        if (prev.step === 'signal' && now - prev.startedAt >= CALIBRATION_SIGNAL_MS) {
          return { step: 'done', startedAt: 0, result: buildCalibrationResult(calibrationSamplesRef.current) };
        }
        return prev;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [calibrationActive, meter.running]);

  useEffect(() => {
    if (!meter.running && calibrationActive) resetCalibration();
  }, [calibrationActive, meter.running, resetCalibration]);

  // Mismatch is decided by the RESOLVED device the meter is actually capturing
  // vs. the resolved system default — robust against 'default'/'communications'
  // pseudo-ids and duplicate labels.
  const activeId = meter.activeDeviceId;
  const defaultId = defaultDevice?.deviceId || '';
  const hasMismatch = Boolean(meter.running && activeId && defaultId && activeId !== defaultId);

  // Persist a "verified" marker when the full path checks out — clean signal,
  // device matches the system default, and recognition is producing Gurmukhi.
  // The live Kirtan/Katha screen reads this (AudioVerifiedChip). Placed before
  // any early return to keep hook order stable; hasGurmukhi is computed inline
  // because its const is defined later in the render.
  useEffect(() => {
    const sawGurmukhi = GURMUKHI_RE.test(recog.transcript || '');
    const ready = meter.running && !hasMismatch && meter.status === 'good' && recog.isSupported && sawGurmukhi;
    if (ready) {
      saveAudioVerified({
        deviceId: defaultDevice?.deviceId || meter.activeDeviceId,
        deviceLabel: defaultDevice?.label || meter.activeLabel,
      });
    }
  }, [meter.running, hasMismatch, meter.status, recog.isSupported, recog.transcript,
    defaultDevice, meter.activeDeviceId, meter.activeLabel]);

  const statusText = meter.status === 'clipping'
    ? tLang('Too loud — reduce mixer send', 'ਬਹੁਤ ਉੱਚੀ — ਮਿਕਸਰ ਸੈਂਡ ਘਟਾਓ')
    : meter.status === 'quiet'
      ? tLang('Too quiet', 'ਬਹੁਤ ਮੱਠੀ')
      : meter.status === 'low'
        ? tLang('Low — raise to the green band', 'ਮੱਠੀ — ਹਰੇ ਬੈਂਡ ਤੱਕ ਵਧਾਓ')
        : tLang('Good', 'ਠੀਕ');
  const statusClass = meter.status === 'clipping'
    ? 'audio-status-clip'
    : meter.status === 'quiet'
      ? 'audio-status-quiet'
      : meter.status === 'low'
        ? 'audio-status-low'
        : 'audio-status-good';

  const noiseText = meter.noiseFloor === 'high'
    ? tLang('High', 'ਜ਼ਿਆਦਾ')
    : meter.noiseFloor === 'medium'
      ? tLang('Medium', 'ਦਰਮਿਆਨਾ')
      : tLang('Low', 'ਘੱਟ');

  const calibrationPhaseMs = calibration.step === 'silence'
    ? CALIBRATION_SILENCE_MS
    : calibration.step === 'signal'
      ? CALIBRATION_SIGNAL_MS
      : 0;
  const calibrationElapsedMs = calibrationActive
    ? Math.max(0, (calibrationClock || Date.now()) - calibration.startedAt)
    : 0;
  const calibrationRemainingSec = calibrationActive
    ? Math.max(0, Math.ceil((calibrationPhaseMs - calibrationElapsedMs) / 1000))
    : 0;
  const calibrationProgressPct = calibrationActive && calibrationPhaseMs
    ? Math.min(100, Math.round((calibrationElapsedMs / calibrationPhaseMs) * 100))
    : 0;
  const calibrationResult = calibration.result;
  const calibrationResultTitle = calibrationResult?.code === 'good'
    ? tLang('Calibration good', 'ਕੈਲੀਬ੍ਰੇਸ਼ਨ ਠੀਕ ਹੈ')
    : calibrationResult?.code === 'clipping'
      ? tLang('Calibration found clipping', 'ਕੈਲੀਬ੍ਰੇਸ਼ਨ ਵਿੱਚ ਕਲਿੱਪਿੰਗ ਮਿਲੀ')
      : calibrationResult?.code === 'quiet'
        ? tLang('Calibration found low level', 'ਕੈਲੀਬ੍ਰੇਸ਼ਨ ਵਿੱਚ ਲੈਵਲ ਮੱਠਾ ਮਿਲਿਆ')
        : calibrationResult?.code === 'noisy'
          ? tLang('Calibration found background noise', 'ਕੈਲੀਬ੍ਰੇਸ਼ਨ ਵਿੱਚ ਪਿਛੋਕੜ ਸ਼ੋਰ ਮਿਲਿਆ')
          : '';
  const calibrationResultDetail = calibrationResult?.code === 'good'
    ? tLang('Background is low and normal voice is in the target range.', 'ਪਿਛੋਕੜ ਘੱਟ ਹੈ ਅਤੇ ਆਮ ਆਵਾਜ਼ ਟੀਚਾ ਰੇਂਜ ਵਿੱਚ ਹੈ।')
    : calibrationResult?.code === 'clipping'
      ? tLang('Lower the mixer send, then run calibration again.', 'ਮਿਕਸਰ ਸੈਂਡ ਘਟਾਓ, ਫਿਰ ਕੈਲੀਬ੍ਰੇਸ਼ਨ ਮੁੜ ਚਲਾਓ।')
      : calibrationResult?.code === 'quiet'
        ? tLang('Raise the mixer send or input gain until normal voice reaches the green band.', 'ਮਿਕਸਰ ਸੈਂਡ ਜਾਂ ਇਨਪੁੱਟ ਗੇਨ ਵਧਾਓ ਜਦ ਤੱਕ ਆਮ ਆਵਾਜ਼ ਹਰੇ ਬੈਂਡ ਤੱਕ ਪਹੁੰਚੇ।')
        : calibrationResult?.code === 'noisy'
          ? tLang('Reduce hall/background noise or isolate the mixer feed from the laptop mic.', 'ਹਾਲ/ਪਿਛੋਕੜ ਸ਼ੋਰ ਘਟਾਓ ਜਾਂ ਮਿਕਸਰ ਫੀਡ ਨੂੰ ਲੈਪਟਾਪ ਮਾਈਕ ਤੋਂ ਅਲੱਗ ਰੱਖੋ।')
          : '';
  const calibrationMetrics = calibrationResult ? [
    {
      label: tLang('Background noise', 'ਪਿਛੋਕੜ ਸ਼ੋਰ'),
      value: calibrationResult.noiseAvg,
      barPct: Math.min(100, Math.round((calibrationResult.noiseAvg / 0.08) * 100)),
      tone: calibrationResult.noiseAvg >= 0.04 ? 'danger' : calibrationResult.noiseAvg >= 0.02 ? 'warn' : 'ready',
      status: calibrationResult.noiseAvg >= 0.04
        ? tLang('High', 'ਜ਼ਿਆਦਾ')
        : calibrationResult.noiseAvg >= 0.02
          ? tLang('Some noise', 'ਥੋੜ੍ਹਾ ਸ਼ੋਰ')
          : tLang('Low', 'ਘੱਟ'),
      hint: calibrationResult.noiseAvg >= 0.04
        ? tLang('Reduce room noise or avoid the laptop mic.', 'ਕਮਰੇ ਦਾ ਸ਼ੋਰ ਘਟਾਓ ਜਾਂ ਲੈਪਟਾਪ ਮਾਈਕ ਤੋਂ ਬਚੋ।')
        : tLang('Quiet background.', 'ਪਿਛੋਕੜ ਸ਼ਾਂਤ ਹੈ।'),
    },
    {
      label: tLang('Normal voice', 'ਆਮ ਆਵਾਜ਼'),
      value: calibrationResult.peak50,
      barPct: Math.min(100, Math.round((calibrationResult.peak50 / 0.75) * 100)),
      tone: calibrationResult.peak50 < 0.25 ? 'warn' : calibrationResult.peak50 > 0.9 ? 'danger' : 'ready',
      status: calibrationResult.peak50 < 0.25
        ? tLang('Too low', 'ਬਹੁਤ ਮੱਠੀ')
        : calibrationResult.peak50 > 0.9
          ? tLang('Too hot', 'ਬਹੁਤ ਉੱਚੀ')
          : tLang('In range', 'ਰੇਂਜ ਵਿੱਚ'),
      hint: calibrationResult.peak50 < 0.25
        ? tLang('Raise the mixer send.', 'ਮਿਕਸਰ ਸੈਂਡ ਵਧਾਓ।')
        : calibrationResult.peak50 > 0.9
          ? tLang('Lower the mixer send.', 'ਮਿਕਸਰ ਸੈਂਡ ਘਟਾਓ।')
          : tLang('Good live speaking/singing level.', 'ਲਾਈਵ ਬੋਲਣ/ਗਾਉਣ ਲਈ ਵਧੀਆ ਲੈਵਲ।'),
    },
    {
      label: tLang('Loud peaks', 'ਉੱਚੇ ਸਿਖਰ'),
      value: calibrationResult.peakMax,
      barPct: Math.min(100, percent(calibrationResult.peakMax)),
      tone: calibrationResult.peakMax >= 0.92 ? 'danger' : calibrationResult.peakMax >= 0.8 ? 'warn' : 'ready',
      status: calibrationResult.peakMax >= 0.92
        ? tLang('Clipping risk', 'ਕਲਿੱਪਿੰਗ ਦਾ ਖਤਰਾ')
        : calibrationResult.peakMax >= 0.8
          ? tLang('Close to limit', 'ਹੱਦ ਦੇ ਨੇੜੇ')
          : tLang('Safe', 'ਸੁਰੱਖਿਅਤ'),
      hint: calibrationResult.peakMax >= 0.92
        ? tLang('Leave more headroom for louder parts.', 'ਉੱਚੇ ਹਿੱਸਿਆਂ ਲਈ ਹੋਰ ਜਗ੍ਹਾ ਛੱਡੋ।')
        : tLang('Enough headroom for louder parts.', 'ਉੱਚੇ ਹਿੱਸਿਆਂ ਲਈ ਕਾਫੀ ਜਗ੍ਹਾ ਹੈ।'),
    },
  ] : [];

  if (!supported) {
    return (
      <section className="card audio-check" aria-label="Audio check">
        <p className="section-eyebrow">{tLang('Audio check', 'ਆਡੀਓ ਜਾਂਚ')}</p>
        <p className="audio-check-notice">
          {tLang(
            'Audio check needs a secure connection (HTTPS or localhost). On a LAN IP address (http://…) the browser blocks microphone access.',
            'ਆਡੀਓ ਜਾਂਚ ਲਈ ਸੁਰੱਖਿਅਤ ਕਨੈਕਸ਼ਨ (HTTPS ਜਾਂ localhost) ਚਾਹੀਦਾ ਹੈ। LAN IP (http://…) ਉੱਤੇ ਬ੍ਰਾਊਜ਼ਰ ਮਾਈਕ ਨੂੰ ਰੋਕ ਦਿੰਦਾ ਹੈ।',
          )}
        </p>
      </section>
    );
  }

  const errorText = meter.error === 'permission-denied'
    ? tLang('Microphone permission was denied. Allow mic access in the browser, then try again.', 'ਮਾਈਕ ਦੀ ਇਜਾਜ਼ਤ ਨਹੀਂ ਮਿਲੀ। ਬ੍ਰਾਊਜ਼ਰ ਵਿੱਚ ਮਾਈਕ ਚਾਲੂ ਕਰੋ ਤੇ ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।')
    : meter.error === 'no-device'
      ? tLang('No microphone / input device was found.', 'ਕੋਈ ਮਾਈਕ / ਇਨਪੁਟ ਡਿਵਾਈਸ ਨਹੀਂ ਮਿਲੀ।')
      : meter.error === 'start-failed'
        ? tLang('Could not start the audio check. Try again.', 'ਆਡੀਓ ਜਾਂਚ ਸ਼ੁਰੂ ਨਹੀਂ ਹੋ ਸਕੀ। ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।')
        : '';

  const instantPct = Math.round(Math.min(1, meter.peak) * 100);
  const peakHoldPct = Math.round(Math.min(1, meter.level) * 100);
  const peakPct = instantPct;

  const transcriptText = recog.transcript || '';
  const hasTranscript = transcriptText.trim().length > 0;
  const gurmukhiCount = (transcriptText.match(GURMUKHI_CHAR_RE) || []).length;
  const hasGurmukhi = GURMUKHI_RE.test(transcriptText);
  const recogElapsedSec = recogStartedAt
    ? Math.max(1, ((recogClock || Date.now()) - recogStartedAt) / 1000)
    : 0;
  const transcriptWordsPerSec = recogElapsedSec ? countWords(transcriptText) / recogElapsedSec : 0;
  const waitingForGurmukhi = Boolean(recog.isListening && recogElapsedSec >= 4 && !hasGurmukhi);

  const startRecog = () => {
    setRecogStartedAt(Date.now());
    setRecogClock(Date.now());
    recog.reset?.();
    recog.start?.();
  };
  const stopRecog = () => { recog.stop?.(); };
  const recogErrorText = (recog.error === 'not-allowed' || recog.error === 'service-not-allowed')
    ? tLang('Microphone permission was denied for recognition.', 'ਪਛਾਣ ਲਈ ਮਾਈਕ ਦੀ ਇਜਾਜ਼ਤ ਨਹੀਂ ਮਿਲੀ।')
    : recog.error === 'audio-capture'
      ? tLang('No microphone available for recognition.', 'ਪਛਾਣ ਲਈ ਕੋਈ ਮਾਈਕ ਨਹੀਂ ਮਿਲੀ।')
      : recog.error
        ? tLang('Recognition error — try again.', 'ਪਛਾਣ ਵਿੱਚ ਗ਼ਲਤੀ — ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।')
        : '';

  const recogStatusText = hasGurmukhi
    ? tLang('Recognizing Gurmukhi', 'ਗੁਰਮੁਖੀ ਪਛਾਣ ਰਹੀ ਹੈ')
    : waitingForGurmukhi
      ? tLang('Hearing audio, waiting for Gurmukhi', 'ਆਡੀਓ ਆ ਰਹੀ ਹੈ, ਗੁਰਮੁਖੀ ਦੀ ਉਡੀਕ ਹੈ')
      : recog.isListening
        ? tLang('Listening for Gurmukhi', 'ਗੁਰਮੁਖੀ ਲਈ ਸੁਣ ਰਿਹਾ ਹੈ')
        : hasTranscript
          ? tLang('Transcript received, no Gurmukhi yet', 'ਲਿਖਤ ਆਈ ਹੈ, ਹਾਲੇ ਗੁਰਮੁਖੀ ਨਹੀਂ')
          : tLang('Not tested yet', 'ਹਾਲੇ ਜਾਂਚ ਨਹੀਂ ਹੋਈ');
  const recogStatusClass = hasGurmukhi
    ? 'audio-recog-ok'
    : waitingForGurmukhi
      ? 'audio-recog-caution'
      : 'audio-recog-neutral';

  const verdict = (() => {
    if (!meter.running) {
      return {
        tone: 'neutral',
        title: tLang('Start the audio check', 'ਆਡੀਓ ਜਾਂਚ ਸ਼ੁਰੂ ਕਰੋ'),
        detail: tLang('Test the mixer or microphone before starting live mode.', 'ਲਾਈਵ ਮੋਡ ਤੋਂ ਪਹਿਲਾਂ ਮਿਕਸਰ ਜਾਂ ਮਾਈਕ ਦੀ ਜਾਂਚ ਕਰੋ।'),
      };
    }
    // While calibrating, the banner tracks the calibration step — otherwise the
    // live "too quiet" warning would contradict the "stay silent" instruction.
    if (calibrationActive) {
      return calibration.step === 'silence'
        ? {
            tone: 'neutral',
            title: tLang(`Calibrating — stay silent (${calibrationRemainingSec}s)`, `ਕੈਲੀਬ੍ਰੇਸ਼ਨ — ਚੁੱਪ ਰਹੋ (${calibrationRemainingSec}ਸ)`),
            detail: tLang('Measuring background noise — please do not speak.', 'ਪਿਛੋਕੜ ਸ਼ੋਰ ਮਾਪ ਰਹੇ ਹਾਂ — ਕਿਰਪਾ ਕਰਕੇ ਨਾ ਬੋਲੋ।'),
          }
        : {
            tone: 'neutral',
            title: tLang(`Calibrating — speak or sing normally (${calibrationRemainingSec}s)`, `ਕੈਲੀਬ੍ਰੇਸ਼ਨ — ਆਮ ਤਰ੍ਹਾਂ ਬੋਲੋ ਜਾਂ ਗਾਓ (${calibrationRemainingSec}ਸ)`),
            detail: tLang('Measuring your normal speaking / singing level.', 'ਤੁਹਾਡਾ ਆਮ ਬੋਲਣ / ਗਾਉਣ ਦਾ ਲੈਵਲ ਮਾਪ ਰਹੇ ਹਾਂ।'),
          };
    }
    if (hasMismatch) {
      return {
        tone: 'warn',
        title: tLang('Fix: recognition is on a different mic', 'ਠੀਕ ਕਰੋ: ਪਛਾਣ ਕਿਸੇ ਹੋਰ ਮਾਈਕ ਉੱਤੇ ਹੈ'),
        detail: tLang('Set the tested device as the system default input before going live.', 'ਲਾਈਵ ਜਾਣ ਤੋਂ ਪਹਿਲਾਂ ਜਾਂਚੀ ਡਿਵਾਈਸ ਨੂੰ ਸਿਸਟਮ ਡਿਫਾਲਟ ਇਨਪੁੱਟ ਬਣਾਓ।'),
      };
    }
    if (meter.status === 'clipping') {
      return {
        tone: 'danger',
        title: tLang('Fix: signal is clipping', 'ਠੀਕ ਕਰੋ: ਸਿਗਨਲ ਕਲਿੱਪ ਹੋ ਰਿਹਾ ਹੈ'),
        detail: tLang('Lower the mixer send until loud parts stay out of the red zone.', 'ਮਿਕਸਰ ਸੈਂਡ ਘਟਾਓ ਤਾਂ ਜੋ ਉੱਚੇ ਹਿੱਸੇ ਲਾਲ ਜ਼ੋਨ ਤੋਂ ਬਾਹਰ ਰਹਿਣ।'),
      };
    }
    if (meter.status === 'quiet') {
      return {
        tone: 'warn',
        title: tLang('Fix: signal is too quiet', 'ਠੀਕ ਕਰੋ: ਸਿਗਨਲ ਬਹੁਤ ਮੱਠਾ ਹੈ'),
        detail: tLang('Raise the mixer send or input level until speech reaches the green band.', 'ਮਿਕਸਰ ਸੈਂਡ ਜਾਂ ਇਨਪੁੱਟ ਲੈਵਲ ਵਧਾਓ ਤਾਂ ਜੋ ਆਵਾਜ਼ ਹਰੇ ਬੈਂਡ ਤੱਕ ਪਹੁੰਚੇ।'),
      };
    }
    if (meter.status === 'low') {
      return {
        tone: 'warn',
        title: tLang('Fix: level is below the target band', 'ਠੀਕ ਕਰੋ: ਲੈਵਲ ਟੀਚਾ ਬੈਂਡ ਤੋਂ ਹੇਠਾਂ ਹੈ'),
        detail: tLang('Raise the mixer send until the peak marker sits in the green band.', 'ਮਿਕਸਰ ਸੈਂਡ ਵਧਾਓ ਤਾਂ ਜੋ ਸਿਖਰ ਮਾਰਕਰ ਹਰੇ ਬੈਂਡ ਵਿੱਚ ਆ ਜਾਵੇ।'),
      };
    }
    if (!recog.isSupported) {
      return {
        tone: 'warn',
        title: tLang('Fix: speech recognition unavailable', 'ਠੀਕ ਕਰੋ: ਸਪੀਚ ਪਛਾਣ ਉਪਲਬਧ ਨਹੀਂ'),
        detail: tLang('Use Chrome or Edge for the live mic tracking.', 'ਲਾਈਵ ਮਾਈਕ ਟ੍ਰੈਕਿੰਗ ਲਈ Chrome ਜਾਂ Edge ਵਰਤੋ।'),
      };
    }
    if (hasGurmukhi) {
      return {
        tone: 'ready',
        title: tLang('Ready for Kirtan/Katha', 'ਕੀਰਤਨ/ਕਥਾ ਲਈ ਤਿਆਰ'),
        detail: tLang('Signal is good, recognition sees Gurmukhi, and the mic device matches.', 'ਸਿਗਨਲ ਠੀਕ ਹੈ, ਪਛਾਣ ਗੁਰਮੁਖੀ ਵੇਖ ਰਹੀ ਹੈ, ਅਤੇ ਮਾਈਕ ਡਿਵਾਈਸ ਮਿਲਦੀ ਹੈ।'),
      };
    }
    if (waitingForGurmukhi) {
      return {
        tone: 'warn',
        title: tLang('Fix: not hearing Gurmukhi yet', 'ਠੀਕ ਕਰੋ: ਹਾਲੇ ਗੁਰਮੁਖੀ ਨਹੀਂ ਆ ਰਹੀ'),
        detail: tLang('The signal is good, but recognition has not produced Gurmukhi. Check mic language and default input.', 'ਸਿਗਨਲ ਠੀਕ ਹੈ, ਪਰ ਪਛਾਣ ਨੇ ਗੁਰਮੁਖੀ ਨਹੀਂ ਦਿੱਤੀ। ਮਾਈਕ ਭਾਸ਼ਾ ਅਤੇ ਡਿਫਾਲਟ ਇਨਪੁੱਟ ਜਾਂਚੋ।'),
      };
    }
    return {
      tone: 'neutral',
      title: tLang('Almost ready: test recognition', 'ਲਗਭਗ ਤਿਆਰ: ਪਛਾਣ ਜਾਂਚੋ'),
      detail: tLang('Start the recognition test and speak or sing a short line.', 'ਪਛਾਣ ਟੈਸਟ ਸ਼ੁਰੂ ਕਰੋ ਅਤੇ ਇੱਕ ਛੋਟੀ ਲਾਈਨ ਬੋਲੋ ਜਾਂ ਗਾਓ।'),
    };
  })();

  return (
    <section className="card audio-check" aria-label="Audio check">
      <div className="audio-check-head">
        <p className="section-eyebrow" lang={lang}>{tLang('Audio check', 'ਆਡੀਓ ਜਾਂਚ')}</p>
        <p className="audio-check-sub" lang={lang}>
          {tLang('Check your mic signal before starting a session.', 'ਸੈਸ਼ਨ ਸ਼ੁਰੂ ਕਰਨ ਤੋਂ ਪਹਿਲਾਂ ਆਪਣੇ ਮਾਈਕ ਦਾ ਸਿਗਨਲ ਜਾਂਚੋ।')}
        </p>
      </div>

      <div className={`audio-verdict audio-verdict-${verdict.tone}`} role="status" aria-live="polite">
        <strong lang={lang}>{verdict.title}</strong>
        <span lang={lang}>{verdict.detail}</span>
      </div>

      <label className="audio-field">
        <span className="audio-field-label" lang={lang}>{tLang('Audio input', 'ਆਡੀਓ ਇਨਪੁਟ')}</span>
        <select className="select" value={selectedId} onChange={handleDeviceChange}>
          <option value="">{tLang('System default', 'ਸਿਸਟਮ ਡਿਫ਼ਾਲਟ')}</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || tLang(`Microphone ${i + 1}`, `ਮਾਈਕ ${i + 1}`)}
            </option>
          ))}
        </select>
      </label>

      <div className="audio-check-actions">
        {!meter.running ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={handleTest}>
            {tLang('Test mic', 'ਮਾਈਕ ਜਾਂਚੋ')}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={stopMeter}>
            {tLang('Stop', 'ਰੋਕੋ')}
          </button>
        )}
        {devices.length === 0 && (
          <span className="audio-hint" lang={lang}>
            {tLang('Tap “Test mic” and allow microphone access to list devices.', '“ਮਾਈਕ ਜਾਂਚੋ” ਦਬਾਓ ਤੇ ਡਿਵਾਈਸਾਂ ਵੇਖਣ ਲਈ ਮਾਈਕ ਦੀ ਇਜਾਜ਼ਤ ਦਿਓ।')}
          </span>
        )}
      </div>

      {errorText && <p className="audio-check-error" role="alert">{errorText}</p>}

      {meter.running && (
        <div className="audio-meter" aria-label="Input level">
          <div className={`audio-meter-bar ${statusClass}`}>
            <span className="audio-meter-target" aria-hidden="true" />
            <span className="audio-meter-fill" style={{ width: `${instantPct}%` }} />
            <span className="audio-meter-peak-hold" style={{ left: `${peakHoldPct}%` }} aria-hidden="true" />
            <span className="audio-meter-clipzone" aria-hidden="true" />
          </div>
          <div className="audio-meter-row">
            <span className={`meta-pill audio-status-pill ${statusClass}`}>{statusText}</span>
            <span className="audio-meta">{tLang('Peak', 'ਸਿਖਰ')}: {peakPct}%</span>
            <span className="audio-meta">{tLang('Noise floor', 'ਪਿਛੋਕੜ ਸ਼ੋਰ')}: {noiseText}</span>
          </div>
        </div>
      )}

      <div className="audio-calibration">
        <div className="audio-calibration-head">
          <div>
            <span className="audio-field-label" lang={lang}>{tLang('Calibration mode', 'ਕੈਲੀਬ੍ਰੇਸ਼ਨ ਮੋਡ')}</span>
            <p className="audio-calibration-copy" lang={lang}>
              {tLang(
                'First stay silent, then speak or sing normally. The app checks noise, level, and clipping. For a true result, run this during soundcheck — with the instruments playing and the actual mic / mixer feed.',
                'ਪਹਿਲਾਂ ਚੁੱਪ ਰਹੋ, ਫਿਰ ਆਮ ਤਰ੍ਹਾਂ ਬੋਲੋ ਜਾਂ ਗਾਓ। ਐਪ ਸ਼ੋਰ, ਲੈਵਲ ਅਤੇ ਕਲਿੱਪਿੰਗ ਜਾਂਚਦੀ ਹੈ। ਸਹੀ ਨਤੀਜੇ ਲਈ ਇਸਨੂੰ ਸਾਊਂਡਚੈੱਕ ਵੇਲੇ ਚਲਾਓ — ਸਾਜ਼ ਵੱਜਦੇ ਹੋਏ ਤੇ ਅਸਲ ਮਾਈਕ / ਮਿਕਸਰ ਫੀਡ ਨਾਲ।',
              )}
            </p>
          </div>
          {!calibrationActive ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={startCalibration}>
              {calibrationResult ? tLang('Run again', 'ਮੁੜ ਚਲਾਓ') : tLang('Calibrate', 'ਕੈਲੀਬ੍ਰੇਟ ਕਰੋ')}
            </button>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm" onClick={resetCalibration}>
              {tLang('Cancel', 'ਰੱਦ ਕਰੋ')}
            </button>
          )}
        </div>

        {calibrationActive && (
          <div className="audio-calibration-step" role="status" aria-live="polite">
            <div>
              <strong lang={lang}>
                {calibration.step === 'silence'
                  ? tLang('Stay silent', 'ਚੁੱਪ ਰਹੋ')
                  : tLang('Speak or sing normally', 'ਆਮ ਤਰ੍ਹਾਂ ਬੋਲੋ ਜਾਂ ਗਾਓ')}
              </strong>
              <span lang={lang}>
                {calibration.step === 'silence'
                  ? tLang('Measuring the hall/background noise.', 'ਹਾਲ/ਪਿਛੋਕੜ ਸ਼ੋਰ ਮਾਪ ਰਿਹਾ ਹੈ।')
                  : tLang('Measuring your normal live level.', 'ਤੁਹਾਡਾ ਆਮ ਲਾਈਵ ਲੈਵਲ ਮਾਪ ਰਿਹਾ ਹੈ।')}
              </span>
            </div>
            <span className="audio-calibration-time">{calibrationRemainingSec}s</span>
            <div className="audio-calibration-progress" aria-hidden="true">
              <span style={{ width: `${calibrationProgressPct}%` }} />
            </div>
          </div>
        )}

        {calibrationResult && !calibrationActive && (
          <div className={`audio-calibration-result audio-calibration-${calibrationResult.tone}`}>
            <strong lang={lang}>{calibrationResultTitle}</strong>
            <span lang={lang}>{calibrationResultDetail}</span>
            <div className="audio-calibration-metrics">
              {calibrationMetrics.map((metric) => (
                <div key={metric.label} className={`audio-calibration-metric audio-calibration-metric-${metric.tone}`}>
                  <div className="audio-calibration-metric-head">
                    <span>{metric.label}</span>
                    <strong>{metric.status}</strong>
                  </div>
                  <div className="audio-calibration-meter" aria-hidden="true">
                    <span style={{ width: `${metric.barPct}%` }} />
                  </div>
                  <small>
                    {metric.hint}
                    {' '}
                    <span className="audio-calibration-raw">({percent(metric.value)}%)</span>
                  </small>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {meter.running && defaultDevice && (
        <div className={`audio-recog ${hasMismatch ? 'audio-recog-warn' : ''}`}>
          <p className="audio-recog-line" lang={lang}>
            {tLang('Recognition will use:', 'ਪਛਾਣ ਇਹ ਵਰਤੇਗੀ:')}{' '}
            <strong>{defaultDevice.label || tLang('System default', 'ਸਿਸਟਮ ਡਿਫ਼ਾਲਟ')}</strong>
          </p>
          {hasMismatch && (
            <p className="audio-recog-warn-text" lang={lang}>
              ⚠ {tLang(
                `You're testing “${deviceLabel(devices, activeId, meter.activeLabel) || tLang('this device', 'ਇਹ ਡਿਵਾਈਸ')}”, but recognition uses the system default. Set it as the Windows default input (or in the browser's site mic setting) so recognition uses it.`,
                `ਤੁਸੀਂ “${deviceLabel(devices, activeId, meter.activeLabel) || 'ਇਹ ਡਿਵਾਈਸ'}” ਜਾਂਚ ਰਹੇ ਹੋ, ਪਰ ਪਛਾਣ ਸਿਸਟਮ ਡਿਫ਼ਾਲਟ ਵਰਤਦੀ ਹੈ। ਇਸਨੂੰ Windows ਡਿਫ਼ਾਲਟ ਇਨਪੁਟ ਬਣਾਓ ਤਾਂ ਜੋ ਪਛਾਣ ਇਹੀ ਵਰਤੇ।`,
              )}
            </p>
          )}
        </div>
      )}

      {/* Recognition test — confirms the speech engine actually produces
          usable Gurmukhi. Reads the SYSTEM DEFAULT mic (what live recognition
          uses), which may differ from the meter's test device above. */}
      <div className="audio-recog-test">
        <div className="audio-recog-test-head">
          <span className="audio-field-label" lang={lang}>{tLang('Recognition test', 'ਪਛਾਣ ਟੈਸਟ')}</span>
          {!recog.isSupported ? (
            <span className="audio-hint" lang={lang}>
              {tLang('Speech recognition needs Chrome or Edge.', 'ਪਛਾਣ ਲਈ Chrome ਜਾਂ Edge ਚਾਹੀਦਾ ਹੈ।')}
            </span>
          ) : liveMicBusy && !recog.isListening ? (
            <span className="audio-hint" lang={lang}>
              {tLang('Stop the live mic first to test recognition here.', 'ਇੱਥੇ ਪਛਾਣ ਜਾਂਚਣ ਲਈ ਪਹਿਲਾਂ ਲਾਈਵ ਮਾਈਕ ਬੰਦ ਕਰੋ।')}
            </span>
          ) : !recog.isListening ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={startRecog}>
              {tLang('Test recognition', 'ਪਛਾਣ ਜਾਂਚੋ')}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={stopRecog}>
              {tLang('Stop', 'ਰੋਕੋ')}
            </button>
          )}
        </div>
        <p className="audio-recog-test-note" lang={lang}>
          {tLang(
            'Speak or sing — this is what the speech engine hears from the system default mic. If the meter moves but no words appear here, recognition is on a different mic.',
            'ਬੋਲੋ ਜਾਂ ਗਾਓ — ਇਹ ਉਹ ਹੈ ਜੋ ਸਪੀਚ ਇੰਜਣ ਸਿਸਟਮ ਡਿਫ਼ਾਲਟ ਮਾਈਕ ਤੋਂ ਸੁਣਦਾ ਹੈ। ਜੇ ਮੀਟਰ ਹਿੱਲੇ ਪਰ ਇੱਥੇ ਸ਼ਬਦ ਨਾ ਆਉਣ, ਤਾਂ ਪਛਾਣ ਕਿਸੇ ਹੋਰ ਮਾਈਕ ਉੱਤੇ ਹੈ।',
          )}
        </p>
        {recog.isListening && (
          <div className="audio-transcript gurmukhi" lang="pa" aria-live="polite">
            {recog.transcript || tLang('Listening… speak or sing into the mic.', 'ਸੁਣ ਰਿਹਾ ਹੈ… ਮਾਈਕ ਵਿੱਚ ਬੋਲੋ ਜਾਂ ਗਾਓ।')}
          </div>
        )}
        <div className={`audio-recog-status ${recogStatusClass}`}>
          <span>{recogStatusText}</span>
          <span>
            {tLang('Gurmukhi chars', 'ਗੁਰਮੁਖੀ ਅੱਖਰ')}: {gurmukhiCount}
            {recogElapsedSec > 0 ? ` · ${transcriptWordsPerSec.toFixed(1)} ${tLang('words/sec', 'ਸ਼ਬਦ/ਸਕਿੰਟ')}` : ''}
          </span>
        </div>
        {recogErrorText && <p className="audio-check-error" role="alert">{recogErrorText}</p>}
      </div>

      <p className="audio-check-help" lang={lang}>
        {tLang('For a mixer feed, select your USB audio interface and aim for a “Good” level without clipping.', 'ਮਿਕਸਰ ਫੀਡ ਲਈ ਆਪਣਾ USB ਆਡੀਓ ਇੰਟਰਫੇਸ ਚੁਣੋ ਤੇ ਬਿਨਾਂ ਕਲਿੱਪਿੰਗ “ਠੀਕ” ਪੱਧਰ ਰੱਖੋ।')}
      </p>
    </section>
  );
}
