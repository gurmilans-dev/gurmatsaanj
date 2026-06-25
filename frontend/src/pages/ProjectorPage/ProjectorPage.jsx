import { useEffect, useMemo, useState } from 'react';
import { projectorPost, projectorSubscribe, projectorReadLatest } from '../../services/projector';
import useWakeLock from '../../hooks/useWakeLock';
import renderGurmukhiLine from '../../utils/renderGurmukhiLine';
import { createQrMatrix, qrPath, QR_SIZE } from '../../utils/qrCode';
import './ProjectorPage.css';

/**
 * Projector view — opened in a separate window via /projector. Listens to
 * the main window over BroadcastChannel and renders one of three modes:
 *   - "idle": shows ੴ Waheguru (fullscreen, calm)
 *   - "image": shows an uploaded image/photo (file from the user's PC)
 *   - "shabad": shows the active line of the selected Shabad, with the
 *     current sung line large and centred.
 */
// On phones (especially iOS PWAs in standalone mode) the projector view
// has no native "close window" affordance. If the user somehow lands here
// — direct URL, older build, mistake — they'd be stuck. Detect that case
// and render a small "Back to app" button so they can always escape.
function isStuckOnProjector() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (window.navigator?.standalone === true) return true;
    const touch = ('ontouchstart' in window) || (window.navigator?.maxTouchPoints || 0) > 0;
    const narrow = (window.innerWidth || 0) <= 768;
    if (touch && narrow) return true;
  } catch { /* fall through */ }
  return false;
}

function ProjectorEscapeButton() {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(isStuckOnProjector()); }, []);
  if (!show) return null;
  return (
    <a
      href="/kirtan"
      className="projector-escape-btn"
      aria-label="Back to the main app"
      title="Back to the main app"
    >
      ← Back to app
    </a>
  );
}

export default function ProjectorPage() {
  const [state, setState] = useState(() => projectorReadLatest() || { mode: 'idle' });

  // The projector is a live display for the whole diwan — never let it sleep.
  useWakeLock(true);

  useEffect(() => {
    const off = projectorSubscribe((msg) => {
      if (msg?.type === 'state') setState(msg.payload || { mode: 'idle' });
    });
    // Ask the main window to push the freshest state on open
    projectorPost({ type: 'request-state' });
    return off;
  }, []);

  // Apply the projector theme to the document
  useEffect(() => {
    document.body.classList.add('projector-body');
    return () => document.body.classList.remove('projector-body');
  }, []);

  let content;
  if (state.mode === 'image' && state.imageDataUrl) {
    content = (
      <div className={`projector projector-image projector-theme-${state.projectorPreset || 'warm'}`} style={projectorVars(state)}>
        <ProjectorBackground state={state} />
        <img src={state.imageDataUrl} alt={state.imageName || 'Projector image'} />
      </div>
    );
  } else if (state.mode === 'blank') {
    content = (
      <div className="projector projector-blank" style={projectorVars(state)} aria-label="Blank projector screen" />
    );
  } else if (state.mode === 'emergency' && state.emergency) {
    content = <EmergencyProjection state={state} />;
  } else if (state.mode === 'shabad' && state.shabad) {
    content = <ShabadProjection state={state} />;
  } else {
    // Idle mode — Waheguru
    content = (
      <div className={`projector projector-idle projector-theme-${state.projectorPreset || 'warm'}`} style={projectorVars(state)}>
        <ProjectorBackground state={state} />
        <div className="projector-idle-onkar gurmukhi">ੴ</div>
        <div className="projector-idle-word gurmukhi">ਵਾਹਿਗੁਰੂ</div>
        <div className="projector-idle-translit">Waheguru</div>
      </div>
    );
  }

  return (
    <>
      {content}
      <SangatQrOverlay
        url={state.sangatShareUrl}
        fullscreen={Boolean(state.sangatQrFullscreen)}
      />
      <ProjectorEscapeButton />
    </>
  );
}

function SangatQrOverlay({ url, fullscreen }) {
  const matrix = useMemo(() => {
    if (!url) return null;
    try { return createQrMatrix(url); } catch { return null; }
  }, [url]);

  if (!url || !matrix) return null;

  const margin = 4;
  const size = QR_SIZE + margin * 2;

  if (fullscreen) {
    return (
      <div className="projector-sangat-qr-full" role="dialog" aria-label="Sangat View QR">
        <span className="projector-sangat-qr-eyebrow">Sangat View - scan to follow</span>
        <svg
          className="projector-sangat-qr-full-svg"
          viewBox={`0 0 ${size} ${size}`}
          shapeRendering="crispEdges"
          aria-label="QR code for Sangat View follow link"
        >
          <rect width={size} height={size} fill="#fff" />
          <path d={qrPath(matrix, margin)} fill="#111" />
        </svg>
        <small className="projector-sangat-qr-url">{url}</small>
      </div>
    );
  }

  return (
    <div className="projector-sangat-qr-corner" aria-label="Sangat View QR">
      <span className="projector-sangat-qr-label">Sangat View</span>
      <svg
        className="projector-sangat-qr-corner-svg"
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <rect width={size} height={size} fill="#fff" />
        <path d={qrPath(matrix, margin)} fill="#111" />
      </svg>
    </div>
  );
}

function projectorVars(state) {
  return {
    '--projector-font-scale': Number(state?.fontScale) || 1,
  };
}

function ProjectorBackground({ state }) {
  if (!state?.backgroundDataUrl) return null;
  const brightness = Number.isFinite(Number(state.backgroundBrightness))
    ? Number(state.backgroundBrightness)
    : 0.35;
  const scrim = Math.min(0.88, Math.max(0.45, brightness * 0.62 + 0.34));
  const edge = Math.min(0.94, scrim + 0.16);
  return (
    <>
      <img
        className={`projector-bg-image projector-bg-${state.backgroundTone || 'medium'} projector-bg-fit-${state.backgroundFit || 'cover'}`}
        src={state.backgroundDataUrl}
        alt={state.backgroundName || 'Projector background'}
        aria-hidden="true"
      />
      <div
        className="projector-bg-scrim"
        aria-hidden="true"
        style={{
          '--projector-scrim': scrim,
          '--projector-scrim-edge': edge,
        }}
      />
    </>
  );
}

function ProjectorGurmukhiLine({ verse, fallback, larivaar = false }) {
  return renderGurmukhiLine(verse?.gurmukhi || fallback, verse?.vishraams, larivaar);
}

function EmergencyProjection({ state }) {
  const item = state.emergency || {};
  return (
    <div className={`projector projector-emergency-screen projector-theme-${state.projectorPreset || 'warm'}`} style={projectorVars(state)}>
      <ProjectorBackground state={state} />
      {item.title && <div className="projector-emergency-title gurmukhi">{item.title}</div>}
      {item.gurmukhi && <div className="projector-emergency-line gurmukhi">{item.gurmukhi}</div>}
      {item.transliteration && <div className="projector-emergency-translit">{item.transliteration}</div>}
    </div>
  );
}

function ShabadProjection({ state }) {
  const { shabad, activeLine, showTransliteration, showEnglish, showPunjabi, larivaar, kathaBoundary } = state;
  const verses = shabad?.verses || [];
  const idx = activeLine?.index ?? -1;
  const tracked = activeLine?.tracked;
  const current = idx >= 0 ? verses[idx] : null;
  // Prev/next come from the open shabad; in katha mode, fall back to the
  // last verse of the previous shabad / first verse of the next shabad
  // so the user always sees what comes before and after a line, even at
  // a shabad boundary.
  const localPrev = idx > 0 ? verses[idx - 1] : null;
  const localNext = idx >= 0 && idx < verses.length - 1 ? verses[idx + 1] : null;
  const prev = localPrev || (idx === 0 ? kathaBoundary?.prevVerse || null : null);
  const next = localNext || (idx >= 0 && idx === verses.length - 1
    ? kathaBoundary?.nextVerse || null
    : null);

  // If no current line yet, show the opening line of the Shabad
  const opening = !current ? verses[0] : null;

  return (
    <div className={`projector projector-shabad projector-theme-${state.projectorPreset || 'warm'}`} style={projectorVars(state)}>
      <ProjectorBackground state={state} />
      <header className="projector-shabad-meta">
        {shabad.meta?.raag && <span>{shabad.meta.raag}</span>}
        {shabad.meta?.writer && <span>{shabad.meta.writer}</span>}
        {shabad.meta?.source && <span>{shabad.meta.source}</span>}
        {shabad.meta?.pageNo && <span>Ang {shabad.meta.pageNo}</span>}
      </header>

      <div className="projector-stage">
        {prev && (
          <p className="projector-line projector-line-prev gurmukhi">
            <ProjectorGurmukhiLine verse={prev} larivaar={larivaar} />
          </p>
        )}

        {current ? (
          <div className="projector-line-active-wrap">
            <p className="projector-line projector-line-active gurmukhi">
              <ProjectorGurmukhiLine verse={current} larivaar={larivaar} />
            </p>
            {showTransliteration && current.transliteration && (
              <p className="projector-translit">{current.transliteration}</p>
            )}
            {showEnglish && current.translationEn && (
              <p className="projector-translation">{current.translationEn}</p>
            )}
            {showPunjabi && current.translationPa && (
              <p className="projector-translation projector-translation-pa gurmukhi">{current.translationPa}</p>
            )}
          </div>
        ) : (
          <div className="projector-line-active-wrap">
            <p className="projector-line projector-line-opening gurmukhi">
              <ProjectorGurmukhiLine verse={opening} fallback="ਵਾਹਿਗੁਰੂ" larivaar={larivaar} />
            </p>
            {showTransliteration && opening?.transliteration && (
              <p className="projector-translit">{opening.transliteration}</p>
            )}
            {showEnglish && opening?.translationEn && (
              <p className="projector-translation">{opening.translationEn}</p>
            )}
            {showPunjabi && opening?.translationPa && (
              <p className="projector-translation projector-translation-pa gurmukhi">{opening.translationPa}</p>
            )}
          </div>
        )}

        {next && (
          <p className="projector-line projector-line-next gurmukhi">
            <ProjectorGurmukhiLine verse={next} larivaar={larivaar} />
          </p>
        )}
      </div>

      <footer className="projector-shabad-footer">
        <span className={`projector-tracker${tracked ? ' projector-tracker-on' : ''}`}>
          {tracked ? 'Live · tracking' : 'Manual'}
        </span>
       
      </footer>
    </div>
  );
}
