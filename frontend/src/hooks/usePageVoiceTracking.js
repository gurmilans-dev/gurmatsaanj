/**
 * usePageVoiceTracking — shared viewer-mic + manual-line plumbing for the
 * Shabad and Ang pages.
 *
 * Both pages need the same handful of things to drive line tracking:
 *
 *   • A continuous viewer mic (no auto-stop word limit) separate from the
 *     global search-page mic. Started/stopped via wrappedStart/wrappedStop
 *     so the caller can also know it was the user who stopped it (via
 *     userStoppedMicRef.current) rather than the speech engine timing out.
 *   • Registration of that mic with the remote-control system so the phone's
 *     Start/Stop Mic buttons drive THIS mic — not the global one.
 *   • Mirroring of the viewer transcript to the projector window for the
 *     Waheguru auto-detector and other projector consumers.
 *   • Manual-line state (the user can click a verse to pin the cursor) plus
 *     an "anchor version" that the line-tracker hooks use to know when a
 *     pin has happened, and a timer ref so callers can pin-and-release after
 *     a short delay.
 *
 * The hook does NOT know about line tracking itself — that's still owned by
 * the page (useLineTracking for kirtan, useKathaLineTracking for katha)
 * because the inputs differ between the two flows.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import useVoiceRecognition from './useVoiceRecognition';

export default function usePageVoiceTracking({
  setRemoteMicTargetGetter,
  observeProjectorTranscript,
} = {}) {
  const pageVoice = useVoiceRecognition({ lang: 'pa-IN', wordLimit: 0 });

  // The voice object identity changes every render; mirror it through a ref
  // so we can register a stable getter with the remote system and read the
  // latest reference inside callbacks without re-registering.
  const pageVoiceRef = useRef(pageVoice);
  useEffect(() => { pageVoiceRef.current = pageVoice; }, [pageVoice]);

  // Register THIS mic as the target of remote mic-start / mic-stop while
  // this page is mounted. Unregister on unmount so the next page (or the
  // global search-page mic) becomes the target again.
  useEffect(() => {
    if (!setRemoteMicTargetGetter) return undefined;
    setRemoteMicTargetGetter(() => pageVoiceRef.current);
    return () => setRemoteMicTargetGetter(null);
  }, [setRemoteMicTargetGetter]);

  // Mount-once setup + unmount cleanup. We explicitly enforce wordLimit 0
  // because the user might navigate here from the search page where the
  // word limit was 7. Cleanup also stops the mic and clears the manual-line
  // timer to avoid late state updates after navigation.
  const userStoppedMicRef = useRef(false);
  const manualLineTimerRef = useRef(null);
  useEffect(() => {
    pageVoice.setWordLimit?.(0);
    return () => {
      pageVoice.stop?.();
      pageVoice.reset?.();
      if (manualLineTimerRef.current) {
        clearTimeout(manualLineTimerRef.current);
        manualLineTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wrapped start / stop — record whether the most recent stop was a user
  // action so callers can suppress auto-restart on intentional pauses.
  const wrappedStop = useCallback(() => {
    userStoppedMicRef.current = true;
    pageVoiceRef.current?.stop?.();
  }, []);
  const wrappedStart = useCallback(() => {
    userStoppedMicRef.current = false;
    pageVoiceRef.current?.reset?.();
    pageVoiceRef.current?.start?.();
  }, []);

  // Mirror the viewer transcript to the projector window so the Waheguru
  // auto-detector (and any other projector-side consumers) sees it. Two
  // effects: one to push the latest text on every change, and a separate
  // unmount effect to clear it.
  useEffect(() => {
    observeProjectorTranscript?.(pageVoice.isListening ? pageVoice.transcript : '');
  }, [observeProjectorTranscript, pageVoice.isListening, pageVoice.transcript]);
  useEffect(() => () => {
    observeProjectorTranscript?.('');
  }, [observeProjectorTranscript]);

  // Manual line state — the user clicks a verse to pin the cursor there.
  // anchorVersion bumps each time the user makes a NEW manual selection so
  // downstream line-tracker hooks can detect "user just pinned a new line"
  // even when the line index didn't change (re-pinning the same line).
  const [manualLine, setManualLine] = useState(null);
  const [manualAnchorVersion, setManualAnchorVersion] = useState(0);
  const bumpManualAnchor = useCallback(() => {
    setManualAnchorVersion((v) => v + 1);
  }, []);

  return {
    pageVoice,
    pageVoiceRef,
    wrappedStart,
    wrappedStop,
    userStoppedMicRef,
    manualLine,
    setManualLine,
    manualAnchorVersion,
    bumpManualAnchor,
    manualLineTimerRef,
  };
}
