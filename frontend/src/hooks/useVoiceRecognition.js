/**
 * useVoiceRecognition — a thin React hook around the Web Speech API.
 *
 * Browsers expose `webkitSpeechRecognition` (Chrome/Edge/Safari iOS 14.5+)
 * or the standardized `SpeechRecognition`. Normal microphone operation receives
 * transcripts; an isolated, opt-in test capture may supply an audio track.
 *
 * The hook returns:
 *   - isSupported : boolean
 *   - isListening : boolean
 *   - transcript  : final + interim transcript joined
 *   - lastFinal   : last finalized phrase (useful for triggering matches)
 *   - error       : last error string, if any
 *   - start()     : start recognition
 *   - stop()      : stop recognition
 *   - reset()     : clear transcript
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isRecording, recordEvent, subscribeRecordingStart } from '../utils/sessionRecorder';

let streamSequence = 0;

const getRecognitionCtor = () =>
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export default function useVoiceRecognition({ lang = 'pa-IN', wordLimit = 7, source = 'voice' } = {}) {
  const Ctor = getRecognitionCtor();
  const isSupported = !!Ctor;

  const recognitionRef = useRef(null);
  const testAudioTrackRef = useRef(null);
  const [streamId] = useState(() => `voice-${++streamSequence}`);
  const traceMetadataRef = useRef(null);
  traceMetadataRef.current = { streamId, language: lang, source: testAudioTrackRef.current ? `${source}/capture-track` : source };
  const epochRef = useRef(0);
  const inputEventIdRef = useRef(null);
  const finalRef = useRef('');
  const interimRef = useRef('');
  const wantsListeningRef = useRef(false);
  const autoStoppedRef = useRef(false);
  const startedAtRef = useRef(0);
  const ignoreResultsBeforeRef = useRef(0);
  // Word-limit is a ref so callers (e.g. ShabadPage) can disable auto-stop
  // at runtime without rebuilding the recognition instance.
  const wordLimitRef = useRef(wordLimit);

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lastFinal, setLastFinal] = useState('');
  const [error, setError] = useState(null);
  const [autoStopped, setAutoStopped] = useState(false);

  const updateTranscript = useCallback(() => {
    setTranscript((finalRef.current + ' ' + interimRef.current).trim());
  }, []);

  useEffect(() => subscribeRecordingStart(() => {
    inputEventIdRef.current = recordEvent('recognition', {
      action: 'baseline', ...traceMetadataRef.current, epoch: epochRef.current,
      append: finalRef.current.slice(-2048), interim: interimRef.current,
      baselineTruncated: finalRef.current.length > 2048,
    })?.id || null;
  }), [streamId, lang, source]);

  // Build the recognition instance once.
  useEffect(() => {
    if (!isSupported) return;

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      if (!wantsListeningRef.current) return;
      if (
        ignoreResultsBeforeRef.current > 0 &&
        typeof ev.timeStamp === 'number' &&
        ev.timeStamp > 0 &&
        ev.timeStamp < ignoreResultsBeforeRef.current
      ) {
        return;
      }

      let interim = '';
      let gotFinal = false;
      const fragments = isRecording() ? [] : null;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const txt = res[0]?.transcript || '';
        if (res.isFinal) {
          fragments?.push(txt);
          finalRef.current = (finalRef.current + ' ' + txt).trim();
          setLastFinal(txt.trim());
          gotFinal = true;
        } else {
          interim += txt;
        }
      }
      interimRef.current = interim;
      if (fragments) inputEventIdRef.current = recordEvent('recognition', {
        action: 'result', ...traceMetadataRef.current, epoch: epochRef.current,
        append: fragments.join(' '), interim, final: gotFinal, resultIndex: ev.resultIndex,
      })?.id || null;
      updateTranscript();

      // Auto-stop strategy (only when wordLimitRef.current > 0):
      //   - Only consider stopping when a *final* result just landed.
      //   - Require a minimum runtime (1.5s) so we never cut off speech early.
      //   - Require enough words AND that we haven't already initiated a stop.
      // Setting wordLimitRef.current to 0 disables auto-stop entirely (used
      // on ShabadPage so live line-tracking can run continuously).
      const limit = wordLimitRef.current;
      if (
        gotFinal &&
        limit > 0 &&
        wantsListeningRef.current &&
        Date.now() - startedAtRef.current > 1500
      ) {
        const finalWordCount = finalRef.current.split(/\s+/).filter(Boolean).length;
        if (finalWordCount >= limit) {
          wantsListeningRef.current = false;
          autoStoppedRef.current = true;
          recordEvent('recognition', { action: 'auto-stop', ...traceMetadataRef.current, epoch: epochRef.current });
          try { rec.stop(); } catch { /* noop */ }
        }
      }
    };

    rec.onerror = (ev) => {
      recordEvent('recognition', { action: 'error', ...traceMetadataRef.current, epoch: epochRef.current, error: ev.error || 'unknown' });
      // Recoverable errors — let the auto-restart kick in silently.
      // 'network' is included because Chrome's pa-IN engine briefly
      // disconnects from Google's STT server several times a minute; the
      // restart in onend reconnects within a few hundred ms and the user
      // doesn't need a toast about every blip.
      if (['no-speech', 'aborted', 'network'].includes(ev.error)) return;

      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(ev.error)) {
        wantsListeningRef.current = false;
        setIsListening(false);
      }
      setError(ev.error || 'speech-recognition-error');
    };

    rec.onend = () => {
      recordEvent('recognition', { action: 'end', ...traceMetadataRef.current, epoch: epochRef.current });
      if (wantsListeningRef.current) {
        if (testAudioTrackRef.current?.readyState === 'ended') { wantsListeningRef.current = false; setIsListening(false); return; }
        // Chrome stops every ~60s; if the user still wants to listen, restart.
        try {
          if (testAudioTrackRef.current) rec.start(testAudioTrackRef.current);
          else rec.start();
          epochRef.current += 1;
          recordEvent('recognition', { action: 'restart', ...traceMetadataRef.current, epoch: epochRef.current });
        } catch { /* already started */ }
      } else {
        setIsListening(false);
        if (autoStoppedRef.current) {
          setAutoStopped(true);
          autoStoppedRef.current = false;
        }
      }
    };

    recognitionRef.current = rec;

    return () => {
      recordEvent('recognition', { action: 'unmount', ...traceMetadataRef.current, epoch: epochRef.current });
      wantsListeningRef.current = false;
      try { rec.stop(); } catch { /* noop */ }
      recognitionRef.current = null;
    };
  }, [Ctor, isSupported, lang, updateTranscript]);

  const start = useCallback((testAudioTrack = null) => {
    if (!recognitionRef.current) return;
    if (testAudioTrack?.kind === 'audio' && testAudioTrack.readyState !== 'live') { setError('test-audio-track-ended'); return; }
    setError(null);
    setAutoStopped(false);
    autoStoppedRef.current = false;
    wantsListeningRef.current = true;
    startedAtRef.current = Date.now();
    ignoreResultsBeforeRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
    const runningTrack = testAudioTrackRef.current;
    testAudioTrackRef.current = testAudioTrack?.kind === 'audio' && testAudioTrack.readyState === 'live' ? testAudioTrack : null;
    traceMetadataRef.current.source = testAudioTrackRef.current ? `${source}/capture-track` : source;
    try {
      if (testAudioTrackRef.current) recognitionRef.current.start(testAudioTrackRef.current);
      else recognitionRef.current.start();
      epochRef.current += 1;
      recordEvent('recognition', { action: 'start', ...traceMetadataRef.current, epoch: epochRef.current });
      setIsListening(true);
    } catch (err) {
      recordEvent('recognition', { action: 'start-error', ...traceMetadataRef.current, epoch: epochRef.current, error: err?.name || 'unknown' });
      if (err?.name === 'InvalidStateError') {
        // The running session keeps its input; restarts must not switch it.
        testAudioTrackRef.current = runningTrack;
        traceMetadataRef.current.source = runningTrack ? `${source}/capture-track` : source;
        setIsListening(true);
        return;
      }
      wantsListeningRef.current = false;
      setIsListening(false);
      setError(err?.message || 'speech-recognition-start-failed');
    }
  }, [source]);

  const stop = useCallback(() => {
    recordEvent('recognition', { action: 'stop', ...traceMetadataRef.current, epoch: epochRef.current });
    wantsListeningRef.current = false;
    autoStoppedRef.current = false;
    testAudioTrackRef.current = null;
    ignoreResultsBeforeRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    setIsListening(false);
    setAutoStopped(false);
  }, []);

  const reset = useCallback(() => {
    recordEvent('recognition', { action: 'reset', ...traceMetadataRef.current, epoch: epochRef.current });
    ignoreResultsBeforeRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
    finalRef.current = '';
    interimRef.current = '';
    setTranscript('');
    setLastFinal('');
    setAutoStopped(false);
  }, []);

  const clearAutoStopped = useCallback(() => {
    setAutoStopped(false);
  }, []);

  // Runtime override for the auto-stop word limit. Pass 0 to disable.
  const setWordLimit = useCallback((n) => {
    wordLimitRef.current = Math.max(0, Number(n) || 0);
  }, []);

  // True only while the current session reads an opt-in test-capture track.
  const isUsingTestTrack = useCallback(() => Boolean(testAudioTrackRef.current), []);

  return {
    isSupported, isListening, transcript, lastFinal, error, autoStopped,
    inputEventId: inputEventIdRef.current,
    start, stop, reset, clearAutoStopped, setWordLimit, isUsingTestTrack,
  };
}
