/**
 * useVoiceRecognition — a thin React hook around the Web Speech API.
 *
 * Browsers expose `webkitSpeechRecognition` (Chrome/Edge/Safari iOS 14.5+)
 * or the standardized `SpeechRecognition`. We never receive raw audio —
 * the OS-level engine returns a transcript directly.
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

const getRecognitionCtor = () =>
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export default function useVoiceRecognition({ lang = 'pa-IN', wordLimit = 7 } = {}) {
  const Ctor = getRecognitionCtor();
  const isSupported = !!Ctor;

  const recognitionRef = useRef(null);
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
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const txt = res[0]?.transcript || '';
        if (res.isFinal) {
          finalRef.current = (finalRef.current + ' ' + txt).trim();
          setLastFinal(txt.trim());
          gotFinal = true;
        } else {
          interim += txt;
        }
      }
      interimRef.current = interim;
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
          try { rec.stop(); } catch { /* noop */ }
        }
      }
    };

    rec.onerror = (ev) => {
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
      if (wantsListeningRef.current) {
        // Chrome stops every ~60s; if the user still wants to listen, restart.
        try { rec.start(); } catch { /* already started */ }
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
      wantsListeningRef.current = false;
      try { rec.stop(); } catch { /* noop */ }
      recognitionRef.current = null;
    };
  }, [Ctor, isSupported, lang, updateTranscript]);

  const start = useCallback(() => {
    if (!recognitionRef.current) return;
    setError(null);
    setAutoStopped(false);
    autoStoppedRef.current = false;
    wantsListeningRef.current = true;
    startedAtRef.current = Date.now();
    ignoreResultsBeforeRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (err) {
      if (err?.name === 'InvalidStateError') {
        setIsListening(true);
        return;
      }
      wantsListeningRef.current = false;
      setIsListening(false);
      setError(err?.message || 'speech-recognition-start-failed');
    }
  }, []);

  const stop = useCallback(() => {
    wantsListeningRef.current = false;
    autoStoppedRef.current = false;
    ignoreResultsBeforeRef.current = typeof performance !== 'undefined' ? performance.now() : 0;
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
    setIsListening(false);
    setAutoStopped(false);
  }, []);

  const reset = useCallback(() => {
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

  return {
    isSupported, isListening, transcript, lastFinal, error, autoStopped,
    start, stop, reset, clearAutoStopped, setWordLimit,
  };
}
