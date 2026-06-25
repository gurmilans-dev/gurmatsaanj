import { useApp } from '../../../context/AppContext';
import './Toasts.css';

/**
 * Floating toast container — surfaces errors, warnings and progress
 * announcements in the bottom-right corner. Pushed via `pushToast` in
 * AppContext: pushToast({ kind: 'error'|'success'|'info', title, message }).
 */
export default function Toasts() {
  const { toasts, dismissToast } = useApp();

  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toasts" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind || 'info'}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <div className="toast-body">
            {t.title && <p className="toast-title">{t.title}</p>}
            {t.message && <p className="toast-message">{t.message}</p>}
          </div>
          {t.actionLabel && typeof t.onAction === 'function' && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                try { t.onAction(); } catch { /* swallow — action shouldn't crash the UI */ }
                dismissToast(t.id);
              }}
            >
              {t.actionLabel}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
