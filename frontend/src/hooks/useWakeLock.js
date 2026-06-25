import { useEffect, useRef } from 'react';

/**
 * useWakeLock(active)
 *
 * Holds a Screen Wake Lock while `active` is true so the device screen does
 * not dim or sleep — essential for a tablet running a 1–3 hour diwan, where a
 * screen that blanks mid-shabad is a hard failure.
 *
 * The browser automatically releases a wake lock whenever the page is hidden
 * (tab switch, screen off, app backgrounded), so we re-acquire on
 * visibilitychange. Gracefully no-ops where the API is unavailable (older
 * browsers, non-secure contexts) — it's a progressive enhancement, never a
 * hard dependency.
 */
export default function useWakeLock(active) {
  const lockRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return undefined;

    let cancelled = false;

    const acquire = async () => {
      if (cancelled || lockRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) {
          try { await lock.release(); } catch { /* noop */ }
          return;
        }
        lockRef.current = lock;
        // The system can release the lock on its own (e.g. low battery); clear
        // our ref so the next visibilitychange can re-acquire.
        lock.addEventListener?.('release', () => {
          if (lockRef.current === lock) lockRef.current = null;
        });
      } catch {
        // request() rejects if the page isn't visible or the UA declines.
        // We retry on the next visibilitychange.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const lock = lockRef.current;
      lockRef.current = null;
      if (lock) { try { lock.release(); } catch { /* noop */ } }
    };
  }, [active]);
}
