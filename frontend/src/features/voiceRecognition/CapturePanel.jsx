import { useEffect, useRef, useState } from 'react';
import { synchronizedCapture as capture, supportsCaptureTrack } from '../../utils/synchronizedCapture';

export default function CapturePanel({ mode, voice, standaloneRecording, onBusyChange }) {
  const [status, setStatus] = useState(capture.status);
  const [consent, setConsent] = useState(false);
  const [online, setOnline] = useState(false);
  const [synthetic, setSynthetic] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const ownedVoice = useRef(null);
  const trackSupported = supportsCaptureTrack();
  useEffect(() => capture.subscribe(setStatus), []);
  useEffect(() => () => { if (capture.status().active) capture.stop('capture-view-unmounted'); }, []);
  useEffect(() => { onBusyChange(status.active || status.ready); }, [status.active, status.ready, onBusyChange]);
  useEffect(() => {
    if (!status.active && ownedVoice.current) { ownedVoice.current.stop?.(); ownedVoice.current = null; }
  }, [status.active]);
  useEffect(() => {
    if (!status.active) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    const interrupt = () => { capture.stop('page-hidden-or-unloaded'); };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('pagehide', interrupt);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('pagehide', interrupt); };
  }, [status.active]);
  const start = async () => {
    setError('');
    try {
      await capture.start({ consent, onlineRecognition: online, synthetic, mode,
        build: typeof __BUILD_INFO__ === 'undefined' ? { revision: null, dirty: null } : __BUILD_INFO__,
        onReady: (track) => { if (online) { ownedVoice.current = voice; voice.start?.(track); } } });
    } catch (failure) { setError(failure.message); }
  };
  const exportBundle = async () => {
    setExporting(true); setError('');
    try {
      const blob = await capture.bundle(); const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `recognition-capture-${Date.now()}.zip`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (failure) { setError(failure.message); }
    finally { setExporting(false); }
  };
  return (
    <details className="voice-debug-help capture-panel">
      <summary>Audio + trace test capture</summary>
      <p>Use a separate test session. Audio stays in memory until you export it. Stop any live mic first.
        Capture stops at 10 minutes or 16 MiB of audio; export each segment before continuing.</p>
      <label><input type="checkbox" checked={consent} disabled={status.active || status.ready}
        onChange={(event) => setConsent(event.target.checked)} /> I have permission to record this audio and everyone audible.</label>
      <label><input type="checkbox" checked={online} disabled={status.active || status.ready || !trackSupported}
        onChange={(event) => setOnline(event.target.checked)} /> Also start browser recognition for this test. I permit its online provider to process the audio.</label>
      <label><input type="checkbox" checked={synthetic} disabled={status.active || status.ready}
        onChange={(event) => setSynthetic(event.target.checked)} /> Calibration audio (exclude from real accuracy reports).</label>
      <p>This test requests recognition from the captured audio track. Combined capture is experimental and requires
        a compatible browser; processing is not established by a successful recording. Leave recognition off for audio-only capture.</p>
      {!trackSupported && <p>Shared-track recognition is available in desktop Chrome/Edge 135 or newer. Audio-only capture remains available here.</p>}
      <div className="voice-debug-toolbar">
        {!status.active && !status.ready && <button type="button" disabled={!consent || standaloneRecording || voice?.isListening || (online && !voice?.isSupported)} onClick={start}>Record test session</button>}
        {status.active && <><button type="button" onClick={() => capture.stop()}>Stop test capture</button>
          <button type="button" disabled={status.phase !== 'recording'} onClick={capture.marker}>Capture sync marker</button></>}
        {status.ready && <><button type="button" disabled={exporting} onClick={exportBundle}>{exporting ? 'Preparing export…' : 'Export capture bundle'}</button>
          <button type="button" disabled={exporting} onClick={() => capture.discard()}>Discard exported capture</button></>}
        <span role="status">{status.phase} · {(status.bytes / 1024).toFixed(0)} KiB {status.reason ? `· ${status.reason}; partial export available` : ''}</span>
      </div>
      {error && <p role="alert">{error}</p>}
      <p>Downloads may contain personal speech. Store them privately and delete them when no longer needed.
        Reloading or closing the app can lose unexported data. Existing trace-only export remains separate.</p>
    </details>
  );
}
