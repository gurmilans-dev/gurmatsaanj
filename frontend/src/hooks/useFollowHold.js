import { useEffect, useRef, useState } from 'react';

/**
 * useFollowHold — the "Lock / Follow" trust layer for live line tracking.
 *
 * During a diwan the granthi pauses singing to do vyakhya (spoken
 * explanation) or there's an instrumental interlude. In those gaps the
 * transcript stops matching the shabad's verses, so the line tracker's
 * `tracked` goes false. This hook turns that signal into an explicit,
 * visible state so the display freezes calmly ("paused — waiting for kirtan")
 * instead of looking broken, and — crucially — so the caller can suppress
 * shabad auto-advance while held (vyakhya must not drag the screen to another
 * shabad).
 *
 * States:
 *   'following' — confident tracking; cursor follows the singer.
 *   'held'      — auto-paused: no confident track for HOLD_AFTER_MS.
 *   'locked'    — manual override: held until the operator unlocks.
 *   'idle'      — not active (mic off).
 *
 * Asymmetric by design: slow to pause (HOLD_AFTER_MS) but resumes the instant
 * a confident verse match returns — a granthi who starts singing again should
 * not wait. `locked` always wins.
 *
 * The thresholds are PROVISIONAL. Record a real diwan (Voice debug panel →
 * Record) and replay it (tools/replay-session.mjs) to see the actual
 * confidence trace through vyakhya, then tune these two numbers.
 */
const HOLD_AFTER_MS = 2500;   // continuous "not tracked" before auto-holding
const RESUME_MIN_CONF = 50;   // a current-shabad match this strong resumes follow

export default function useFollowHold({ active, tracked, confidence }) {
  const [locked, setLocked] = useState(false);
  const [autoHeld, setAutoHeld] = useState(false);
  const lastTrackedAtRef = useRef(Date.now());

  // When the mic turns on, start from a clean "following" state so a stale
  // timestamp from a previous session doesn't trip an instant hold.
  useEffect(() => {
    if (active) {
      lastTrackedAtRef.current = Date.now();
      setAutoHeld(false);
    }
  }, [active]);

  // Refresh the "last confident track" timestamp and resume immediately when
  // a strong match arrives.
  useEffect(() => {
    if (!active) return;
    if (tracked && Number(confidence) >= RESUME_MIN_CONF) {
      lastTrackedAtRef.current = Date.now();
      setAutoHeld((h) => (h ? false : h));
    }
  }, [active, tracked, confidence]);

  // Enter auto-hold once we've gone HOLD_AFTER_MS without a confident track.
  useEffect(() => {
    if (!active) {
      setAutoHeld(false);
      return undefined;
    }
    const id = setInterval(() => {
      if (Date.now() - lastTrackedAtRef.current >= HOLD_AFTER_MS) {
        setAutoHeld((h) => (h ? h : true));
      }
    }, 400);
    return () => clearInterval(id);
  }, [active]);

  const held = locked || (active && autoHeld);
  const state = !active
    ? 'idle'
    : locked
      ? 'locked'
      : autoHeld
        ? 'held'
        : 'following';

  return {
    state,
    held,
    locked,
    autoHeld: active && autoHeld,
    setLocked,
    toggleLock: () => setLocked((v) => !v),
  };
}
