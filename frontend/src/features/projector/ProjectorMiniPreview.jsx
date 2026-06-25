import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { trimToWords } from '../../utils/gurmukhi';
import './ProjectorMiniPreview.css';

// On phones / standalone PWAs the mini-preview occupies a big chunk of the
// reading area when expanded. The user asked for it to start as the small
// collapsed bubble and only inflate when they tap to open it. Desktop keeps
// the existing expanded default since there's plenty of screen there.
function isCompactDevice() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (window.navigator?.standalone === true) return true;
    const touch = ('ontouchstart' in window) || (window.navigator?.maxTouchPoints || 0) > 0;
    const narrow = (window.innerWidth || 0) <= 768;
    if (touch && narrow) return true;
  } catch { /* assume desktop */ }
  return false;
}

/**
 * Tiny fixed-position preview of what the projector window is showing right
 * now. Stays visible while the user scrolls through the Shabad/Ang page so
 * they always know which line the sangat is seeing on the screen.
 *
 * Click to open or focus the projector window. Has a collapse / expand toggle
 * so the user can hide it without disabling the projector.
 */
export default function ProjectorMiniPreview() {
  const {
    selectedShabad,
    activeLine,
    projectorViewMode,
    projectorEmergency,
    projectorImage,
    projectorWindowOpen,
    openProjector,
    focusProjector,
  } = useApp();
  // Phones get the collapsed bubble by default — tap it to expand.
  const [collapsed, setCollapsed] = useState(() => isCompactDevice());

  // Don't render if there's no Shabad context — the floating widget is only
  // useful when there's something for the projector to display.
  if (!selectedShabad && !projectorEmergency && !projectorImage?.dataUrl) return null;

  const mode = projectorEmergency?.id === 'blank'
    ? 'blank'
    : projectorEmergency
      ? 'emergency'
      : projectorImage?.dataUrl
        ? 'image'
        : projectorViewMode === 'waheguru'
          ? 'waheguru'
          : 'shabad';

  const verses = selectedShabad?.verses || [];
  const idx = activeLine?.index >= 0 ? activeLine.index : 0;
  const verse = verses[idx];
  const text = mode === 'image'
    ? (projectorImage?.name || 'Custom image')
    : mode === 'blank'
      ? 'Blank screen'
      : mode === 'emergency'
        ? projectorEmergency?.gurmukhi || projectorEmergency?.title || 'Projector notice'
    : mode === 'waheguru'
      ? 'ੴ ਵਾਹਿਗੁਰੂ'
      : trimToWords(verse?.gurmukhi || verses[0]?.gurmukhi || 'Shabad selected', 10);

  const status = mode === 'waheguru'
    ? 'Waheguru'
    : mode === 'blank'
      ? 'Blank'
      : mode === 'emergency'
        ? projectorEmergency?.label || 'Quick'
    : mode === 'image'
      ? 'Image'
      : (activeLine?.tracked ? 'Tracking' : 'Live');

  const handleClick = () => {
    if (projectorWindowOpen) focusProjector?.();
    else openProjector?.();
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="proj-mini-bubble"
        onClick={() => setCollapsed(false)}
        title="Show projector preview"
        aria-label="Show projector preview"
      >
        <ProjectorGlyph />
        {projectorWindowOpen && <span className="proj-mini-bubble-dot" aria-hidden="true" />}
      </button>
    );
  }

  return (
    <div
      className={`proj-mini proj-mini-${mode}`}
      role="region"
      aria-label="Projector live preview"
    >
      <div className="proj-mini-head">
        <span className="proj-mini-status">
          <span className={`proj-mini-pulse${projectorWindowOpen ? ' proj-mini-pulse-on' : ''}`} aria-hidden="true" />
          <span className="proj-mini-status-text">{status}</span>
        </span>
        <button
          type="button"
          className="proj-mini-collapse"
          onClick={() => setCollapsed(true)}
          aria-label="Hide preview"
          title="Hide preview"
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path d="M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        className="proj-mini-stage"
        onClick={handleClick}
        aria-label={projectorWindowOpen ? 'Focus projector window' : 'Open projector window'}
        title={projectorWindowOpen ? 'Click to focus the projector' : 'Click to open the projector'}
      >
        {mode === 'image' && projectorImage?.dataUrl ? (
          <img className="proj-mini-img" src={projectorImage.dataUrl} alt="" />
        ) : (
          <span className="proj-mini-text gurmukhi">{text}</span>
        )}
      </button>

      <div className="proj-mini-foot">
        <span className="proj-mini-line">
          {mode === 'shabad' && verses.length > 0
            ? `Line ${idx + 1} / ${verses.length}`
            : 'Now showing'}
        </span>
        <ProjectorGlyph />
      </div>
    </div>
  );
}

function ProjectorGlyph() {
  return (
    <svg viewBox="0 0 22 16" width="14" height="11" aria-hidden="true" className="proj-mini-glyph">
      <rect x="0.8" y="0.8" width="20.4" height="11.4" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="14.5" cy="6.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="14.5" cy="6.5" r="0.9" fill="currentColor" />
      <path d="M3.5 4.5h6M3.5 8.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.5 12.2v2.6M16.5 12.2v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
