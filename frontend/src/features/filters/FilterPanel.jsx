import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import './FilterPanel.css';

/**
 * Loads the static-ish lists of raags, writers and sources from the backend
 * and renders three dropdowns. Selections are persisted in the AppContext so
 * both the home page (suggest) and search page see the same filter state.
 */
export default function FilterPanel({ compact = false }) {
  const { filters, updateFilters } = useApp();
  const [opts, setOpts] = useState({ raags: [], writers: [], sources: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [raags, writers, sources] = await Promise.all([
          api.listRaags(),
          api.listWriters(),
          api.listSources(),
        ]);
        if (cancelled) return;
        setOpts({ raags, writers, sources });
      } catch (err) {
        if (cancelled) return;
        setLoadError(err?.message || 'Could not load filters');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleChange = (key) => (e) => {
    updateFilters({ [key]: e.target.value || '' });
  };

  const reset = () => updateFilters({ source: '', writer: '', raag: '' });

  const hasAny = filters.source || filters.writer || filters.raag;
  const showStatus = loading || loadError || hasAny;

  return (
    <section className={`filter-panel${compact ? ' filter-panel-compact' : ''}`} aria-label="Filters">
      <div className="filter-panel-grid" style={{ marginTop:1 }}>
        <label className="filter-field">
          <select
            className="select"
            value={filters.source}
            onChange={handleChange('source')}
            disabled={loading}
          >
            <option value="">All Granths</option>
            {opts.sources.map((s) => (
              <option key={s.sourceId} value={s.sourceId}>
                {s.nameGurmukhi || s.nameEnglish}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field">
          <select
            className="select"
            value={filters.writer}
            onChange={handleChange('writer')}
            disabled={loading}
          >
            <option value="">All Writers</option>
            {opts.writers.map((w) => (
              <option key={w.writerId} value={w.writerId}>
                {w.nameGurmukhi || w.nameEnglish}{w.type ? ` · ${w.type}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field">
          <select
            className="select"
            value={filters.raag}
            onChange={handleChange('raag')}
            disabled={loading}
          >
            <option value="">All Raags</option>
            {opts.raags.map((r) => (
              <option key={r.raagId} value={r.raagId}>
                {r.nameGurmukhi || r.nameEnglish}
              </option>
            ))}
          </select>
        </label>
      </div>

      {showStatus && (
        <div className="filter-panel-status">
        {!loading && loadError && (
          <span className="filter-status-error" role="alert">{loadError}</span>
        )}
        {false && (
          <span className="filter-status-counts">
            {opts.sources.length} Granths · {opts.writers.length} Writers · {opts.raags.length} Raags
          </span>
        )}
        {hasAny && (
          <button type="button" className="btn-ghost filter-reset" onClick={reset}>
            Clear filters
          </button>
        )}
        </div>
      )}
    </section>
  );
}
