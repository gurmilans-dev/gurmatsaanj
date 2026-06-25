/**
 * Tiny persistence for "the audio path was verified" so the live Kirtan/Katha
 * screen can show a green check (or warn that it's stale / the mic changed).
 *
 * Written by the Audio Setup page when its aggregated verdict reaches "ready"
 * (clean signal + recognition producing Gurmukhi + the meter device matches the
 * system default). Read by AudioVerifiedChip on the search page.
 */
const KEY = 'saanj-kirtan.audioVerified';

export function saveAudioVerified({ deviceId = '', deviceLabel = '' } = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      verifiedAt: Date.now(),
      deviceId: String(deviceId || ''),
      deviceLabel: String(deviceLabel || ''),
    }));
  } catch { /* storage may be full / blocked */ }
}

export function readAudioVerified() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && v.verifiedAt ? v : null;
  } catch {
    return null;
  }
}

export function clearAudioVerified() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
