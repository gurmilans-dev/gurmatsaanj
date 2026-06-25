/**
 * Projector channel — main window broadcasts state, projector window listens.
 *
 * Uses BroadcastChannel where supported (modern browsers, including Chrome
 * & Edge), with a localStorage event fallback for older browsers.
 *
 * Message shapes:
 *   { type: 'state', payload: {...} }
 *   { type: 'request-state' }   — projector asks main for fresh state on open
 */
const CHANNEL = 'saanj-kirtan-projector';
const LS_KEY = `${CHANNEL}.signal`;

let bc = null;
function getChannel() {
  if (bc) return bc;
  if (typeof window === 'undefined') return null;
  if ('BroadcastChannel' in window) {
    try { bc = new BroadcastChannel(CHANNEL); } catch { /* noop */ }
  }
  return bc;
}

export function projectorPost(msg) {
  const ch = getChannel();
  if (ch) {
    try { ch.postMessage(msg); return; } catch { /* fall through */ }
  }
  // Fallback: localStorage write triggers `storage` event in OTHER windows
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...msg, _t: Date.now() }));
  } catch { /* noop */ }
}

export function projectorSubscribe(handler) {
  const ch = getChannel();
  let bcListener;
  let lsListener;

  if (ch) {
    bcListener = (ev) => handler(ev.data);
    ch.addEventListener('message', bcListener);
  }

  // Always also listen for localStorage events for cross-window fallback.
  lsListener = (ev) => {
    if (ev.key !== LS_KEY || !ev.newValue) return;
    try { handler(JSON.parse(ev.newValue)); } catch { /* noop */ }
  };
  window.addEventListener('storage', lsListener);

  return () => {
    if (ch && bcListener) ch.removeEventListener('message', bcListener);
    window.removeEventListener('storage', lsListener);
  };
}

/**
 * Persist the latest projector payload so a freshly-opened projector window
 * can pick it up immediately (BroadcastChannel doesn't replay messages).
 */
const LATEST_KEY = `${CHANNEL}.latest`;

export function projectorPersist(payload) {
  try { localStorage.setItem(LATEST_KEY, JSON.stringify(payload)); } catch { /* noop */ }
}

export function projectorReadLatest() {
  try {
    const raw = localStorage.getItem(LATEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
