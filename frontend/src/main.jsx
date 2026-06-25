import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Global styles (variables, reset, base styles) — every component below relies
// on the CSS custom properties defined in styles/variables.css.
import './styles/global.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Register the service worker so the app is installable and works offline
// after the first online visit. Only in production builds — Vite's dev HMR
// would fight a SW that caches the shell.
//
// Update flow (no forced mid-session refresh):
//   1. Browser fetches /sw.js on load.
//   2. If its bytes differ from the running SW, a new SW installs and waits.
//   3. We dispatch `saanj-kirtan:update-available` so the app can show a
//      sticky toast ("New version available. Refresh when ready.") with a
//      Refresh button. The detail.activate() handler posts SKIP_WAITING to
//      the waiting SW.
//   4. When the waiting SW activates, `controllerchange` fires and we
//      reload the page exactly once.
//   5. If the user ignores the toast, nothing breaks — they're still on the
//      old version until they choose to refresh.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  const dispatchUpdate = (registration) => {
    window.dispatchEvent(new CustomEvent('saanj-kirtan:update-available', {
      detail: {
        activate: () => {
          if (registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        },
      },
    }));
  };

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      // If the page loaded with an already-waiting SW (user closed and
      // reopened the tab between deploy and refresh), surface it now.
      if (registration.waiting && navigator.serviceWorker.controller) {
        dispatchUpdate(registration);
      }
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // "installed" + a controller already exists means an UPDATE
          // (not the very first install on a fresh browser).
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            dispatchUpdate(registration);
          }
        });
      });
    }).catch(() => { /* offline-safe */ });
  });
}
