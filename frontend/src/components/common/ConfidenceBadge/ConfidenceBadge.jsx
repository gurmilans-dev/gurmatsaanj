import { confidenceLabel } from '../../../utils/gurmukhi';
import './ConfidenceBadge.css';

/**
 * Confidence indicator. Uses an SVG bar (NOT an HTML element with inline width)
 * to keep the codebase free of inline CSS — the bar's "width" is just the SVG
 * <rect>'s `width` attribute, which is structural, not a style override.
 */
export default function ConfidenceBadge({ value = 0, compact = false }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));

  let level = 'weak';
  if (v >= 85) level = 'strong';
  else if (v >= 70) level = 'good';
  else if (v >= 55) level = 'fair';

  return (
    <span
      className={`confidence-badge confidence-${level}${compact ? ' confidence-compact' : ''}`}
      title={`${confidenceLabel(v)} (${v}%)`}
    >
      <svg
        className="confidence-bar"
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect className="confidence-bar-track" x="0" y="0" width="100" height="8" rx="4" />
        <rect className="confidence-bar-fill"  x="0" y="0" width={v} height="8" rx="4" />
      </svg>
      <span className="confidence-text">{v}%</span>
      {!compact && <span className="confidence-label">{confidenceLabel(v)}</span>}
    </span>
  );
}
