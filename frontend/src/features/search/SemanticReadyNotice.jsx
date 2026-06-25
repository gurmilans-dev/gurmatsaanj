import './SemanticReadyNotice.css';

/**
 * First-time loading state for the "By meaning" search mode. The semantic
 * pipeline downloads ~40 MB (the multilingual-e5-small model + embeddings)
 * the first time it runs; this notice keeps the user informed.
 *
 * Phases (from semanticSearch.js):
 *   - 'data'  → fetching embeddings.bin / index.json / shabad-meta.json (~11 MB)
 *   - 'model' → downloading the transformer model (~30 MB)
 *   - 'ready' → done
 *
 * Failure: parent passes an `error` string to show a retry / fallback CTA.
 */
export default function SemanticReadyNotice({ progress, error, onRetry, onUseKeyword }) {
  if (error) {
    return (
      <div className="semantic-notice semantic-notice-error" role="alert">
        <p className="semantic-notice-title">Smart search couldn't load</p>
        <p className="semantic-notice-body">{error}</p>
        <div className="semantic-notice-actions">
          {onRetry && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
              Retry
            </button>
          )}
          {onUseKeyword && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onUseKeyword}>
              Use keyword search instead
            </button>
          )}
        </div>
      </div>
    );
  }

  const phase = progress?.phase || 'data';
  const ratio = Math.max(0, Math.min(1, progress?.total ? progress.loaded / progress.total : 0));
  const pct = Math.round(ratio * 100);

  const heading = phase === 'model'
    ? 'Downloading the language model…'
    : phase === 'ready'
      ? 'Ready'
      : 'Loading shabad index…';

  const subline = phase === 'model'
    ? 'First-time only (~30 MB). Future searches are instant.'
    : 'Fetching local meaning embeddings.';

  return (
    <div className="semantic-notice" role="status" aria-live="polite">
      <p className="semantic-notice-eyebrow">Setting up smart search</p>
      <p className="semantic-notice-title">{heading}</p>
      <div className="semantic-notice-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="semantic-notice-body">{subline}</p>
    </div>
  );
}
