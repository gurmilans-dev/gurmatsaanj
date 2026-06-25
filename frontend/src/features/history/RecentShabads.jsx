import { Link } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { displayLineForEntry, trimToWords } from '../../utils/gurmukhi';
import './RecentShabads.css';

/**
 * Compact "Recently opened" list — driven by the history persisted in
 * AppContext (capped at 20). Used as a sidebar/section card on Home and
 * Search so users can jump back to a Shabad they were on earlier.
 */
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7)  return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function RecentShabads({ compact = false, limit = 8 }) {
  const { shabadHistory, clearShabadHistory, voice } = useApp();

  if (!shabadHistory || shabadHistory.length === 0) {
    return (
      <section className={`recent-card card${compact ? ' recent-card-compact' : ''}`} aria-label="Recent Shabads">
        <header className="recent-head">
          <p className="section-eyebrow">History</p>
          <h3 className="recent-title">Recently opened</h3>
        </header>
        <p className="recent-empty">No Shabads opened yet. Pick one from a suggestion or search result and it'll show up here.</p>
      </section>
    );
  }

  const items = shabadHistory.slice(0, limit);

  return (
    <section className={`recent-card card${compact ? ' recent-card-compact' : ''}`} aria-label="Recent Shabads">
      <header className="recent-head">
        <div>
          <p className="section-eyebrow">History</p>
          <h3 className="recent-title">Recently opened</h3>
        </div>
        <button type="button" className="btn-ghost recent-clear" onClick={clearShabadHistory}>
          Clear
        </button>
      </header>

      <ul className="recent-list">
        {items.map((h, index) => (
          <li key={`${h.shabadId}-${h.openedAt ?? index}`} className="recent-item">
            <Link
              to={`/shabad/${encodeURIComponent(h.shabadId)}`}
              className="recent-link"
              onClick={() => {
                voice.stop?.();
                voice.reset?.();
              }}
            >
              <p className="recent-gurmukhi gurmukhi">{trimToWords(displayLineForEntry(h) || h.shabadId, 12)}</p>
              <p className="recent-meta">
                {h.raag   && <span className="meta-pill meta-pill-muted">{h.raag}</span>}
                {h.writer && <span className="meta-pill meta-pill-muted">{h.writer}</span>}
                <span className="recent-when">{timeAgo(h.openedAt)}</span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
