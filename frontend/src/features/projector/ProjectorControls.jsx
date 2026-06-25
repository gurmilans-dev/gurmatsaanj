import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { PROJECTOR_EMERGENCY_ITEMS, PROJECTOR_PRESETS, useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { createQrMatrix, qrPath, QR_SIZE } from '../../utils/qrCode';
import './ProjectorControls.css';

const ProjectorIcon = () => (
  <svg viewBox="0 0 22 16" width="14" height="11" aria-hidden="true">
    <rect x="0.8" y="0.8" width="20.4" height="11.4" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="14.5" cy="6.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="14.5" cy="6.5" r="0.9" fill="currentColor" />
    <path d="M3.5 4.5h6M3.5 8.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M5.5 12.2v2.6M16.5 12.2v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const UploadIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M8 11V3M5 6l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 12v1.5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5V12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M3 4h10M6 4V2.8h4V4M5 6v7M8 6v7M11 6v7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M4.5 4.5 5 15h6l.5-10.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
const ShareIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <circle cx="4" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="3.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="12.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M5.7 7 10.2 4.5M5.7 9 10.2 11.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

function followUrl(code) {
  if (!code || typeof window === 'undefined') return '';
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL || import.meta.env.VITE_PUBLIC_REMOTE_URL || window.location.origin;
  const url = new URL(`/follow/${encodeURIComponent(code)}`, configuredBase);
  return url.toString();
}

function ShareQrCode({ value }) {
  const matrix = useMemo(() => {
    try { return value ? createQrMatrix(value) : null; } catch { return null; }
  }, [value]);
  if (!matrix) {
    return (
      <div className="projector-share-qr-fallback" role="img" aria-label="Sangat View QR unavailable">
        QR unavailable
      </div>
    );
  }
  const margin = 4;
  const size = QR_SIZE + margin * 2;
  return (
    <svg
      className="projector-share-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Scan to open Sangat View"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={qrPath(matrix, margin)} fill="#111" />
    </svg>
  );
}

/**
 * ProjectorControls — opens the projector window and lets the user upload an
 * image to display. State lives in AppContext (so the broadcast keeps working
 * across page navigations) — this component is just the visible controls.
 */
export default function ProjectorControls({ compact = false, showPreview = false, embedded = false }) {
  const navigate = useNavigate();
  const {
    selectedShabad,
    activeLine,
    display,
    projectorViewMode,
    setProjectorViewMode,
    projectorEmergency,
    setProjectorEmergencyMode,
    projectorImage,
    setProjectorImage,
    projectorBackground,
    setProjectorBackground,
    projectorDisplay,
    setProjectorDisplay,
    projectorPreset,
    applyProjectorPreset,
    openProjector: contextOpenProjector,
    focusProjector,
    projectorWindowOpen,
    remotePairing,
    sangatQrFullscreen,
    setSangatQrFullscreen,
    pushToast,
  } = useApp();

  const fileInputRef = useRef(null);
  const bgInputRef = useRef(null);
  const [quickLoading, setQuickLoading] = useState('');
  const [shareOpen, setShareOpen] = useState(false);

  // Escape key dismisses the share modal so it's never a trap.
  useEffect(() => {
    if (!shareOpen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setShareOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shareOpen]);

  const mode = projectorEmergency?.id === 'blank'
    ? 'blank'
    : projectorEmergency
      ? 'emergency'
      : projectorImage.dataUrl
        ? 'image'
        : projectorViewMode === 'waheguru'
          ? 'idle'
          : selectedShabad
            ? 'shabad'
            : 'idle';
  const previewVerse = selectedShabad?.verses?.[activeLine?.index >= 0 ? activeLine.index : 0];
  const previewTitle = mode === 'image'
    ? projectorImage.name || 'Custom image'
    : mode === 'blank'
      ? 'Blank screen'
      : mode === 'emergency'
        ? projectorEmergency?.gurmukhi || projectorEmergency?.title || 'Projector notice'
    : mode === 'shabad'
      ? previewVerse?.gurmukhi || selectedShabad?.verses?.[0]?.gurmukhi || 'Shabad selected'
      : 'ੴ ਵਾਹਿਗੁਰੂ';

  const windowOpen = projectorWindowOpen;
  const shareCode = remotePairing?.followCode || '';
  const shareUrl = useMemo(() => followUrl(shareCode), [shareCode]);
  const shareUrlUsesLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(shareUrl);

  const openOrFocusProjector = () => {
    // If the window is already open, the explicit button click means the
    // user wants to bring it forward — call focusProjector. Otherwise open
    // a new one (silently in the background, per the auto-open flow).
    if (windowOpen) {
      focusProjector?.();
      return;
    }
    const win = contextOpenProjector?.();
    if (!win) {
      pushToast({
        kind: 'error',
        title: 'Projector blocked',
        message: 'Allow popups for this site to open the projector.',
      });
    }
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      pushToast?.({ kind: 'success', title: 'Sangat link copied', message: 'Share it with devices on the same network.' });
    } catch {
      pushToast?.({ kind: 'info', title: 'Copy the Sangat link', message: shareUrl });
    }
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });

  const analyzeImage = (img) => {
    try {
      const SAMPLE = 32;
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE;
      canvas.height = SAMPLE;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { brightness: 0.35, tone: 'medium' };
      ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
      const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
      }
      const brightness = total / (data.length / 4);
      return {
        brightness: Number(brightness.toFixed(3)),
        tone: brightness > 0.62 ? 'light' : brightness < 0.28 ? 'dark' : 'medium',
      };
    } catch {
      return { brightness: 0.35, tone: 'medium' };
    }
  };

  // Re-encode the picked image so the data URL is small enough for
  // localStorage (~5 MB cap) and BroadcastChannel. FileReader works more
  // reliably across local file / browser combinations than object URLs here.
  const prepareImage = async (file) => {
    const TARGET_DATA_URL_BYTES = 2_100_000;
    const originalDataUrl = await readFileAsDataUrl(file);

    // SVG/GIF can fail or lose animation through canvas. Keep small ones as-is.
    if ((file.type === 'image/svg+xml' || file.type === 'image/gif') && originalDataUrl.length < TARGET_DATA_URL_BYTES) {
      return { dataUrl: originalDataUrl, analysis: { brightness: 0.35, tone: 'medium' } };
    }

    let img;
    try {
      img = await loadImage(originalDataUrl);
    } catch (err) {
      if (originalDataUrl.length < TARGET_DATA_URL_BYTES) {
        return { dataUrl: originalDataUrl, analysis: { brightness: 0.35, tone: 'medium' } };
      }
      throw err;
    }

    try {
      const analysis = analyzeImage(img);
      const MAX = 1600;
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (!width || !height) {
        if (originalDataUrl.length < 4_500_000) return { dataUrl: originalDataUrl, analysis };
        throw new Error('Image has invalid dimensions');
      }
      if (width > MAX || height > MAX) {
        const scale = MAX / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is unavailable');
      ctx.drawImage(img, 0, 0, width, height);

      // JPEG is much smaller and avoids localStorage quota failures.
      let quality = 0.82;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > TARGET_DATA_URL_BYTES && (canvas.width > 720 || canvas.height > 720)) {
        quality = Math.max(0.62, quality - 0.08);
        const scale = 0.82;
        const maxSide = Math.max(canvas.width, canvas.height);
        const safeScale = Math.max(720 / maxSide, scale);
        const nextCanvas = document.createElement('canvas');
        nextCanvas.width = Math.round(canvas.width * safeScale);
        nextCanvas.height = Math.round(canvas.height * safeScale);
        const nextCtx = nextCanvas.getContext('2d');
        if (!nextCtx) break;
        nextCtx.drawImage(canvas, 0, 0, nextCanvas.width, nextCanvas.height);
        canvas.width = nextCanvas.width;
        canvas.height = nextCanvas.height;
        const resizedCtx = canvas.getContext('2d');
        if (!resizedCtx) break;
        resizedCtx.drawImage(nextCanvas, 0, 0);
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      return { dataUrl, analysis };
    } catch (err) {
      if (originalDataUrl.length < TARGET_DATA_URL_BYTES) {
        return { dataUrl: originalDataUrl, analysis: analyzeImage(img) };
      }
      throw err;
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      pushToast({ kind: 'error', title: 'Unsupported file', message: 'Please upload an image (PNG, JPG, etc.).' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      pushToast({ kind: 'error', title: 'File too large', message: 'Image must be under 25 MB.' });
      return;
    }
    try {
      const { dataUrl } = await prepareImage(file);
      setProjectorImage({ dataUrl, name: file.name });
      pushToast({
        kind: 'success',
        title: 'Image set',
        message: `${file.name} is now on the projector.`,
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Could not read image',
        message: err?.message || 'Try a JPG or PNG under 25 MB.',
      });
    }
  };

  const handleBackgroundChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      pushToast({ kind: 'error', title: 'Unsupported file', message: 'Please upload an image (PNG, JPG, etc.).' });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      pushToast({ kind: 'error', title: 'File too large', message: 'Image must be under 25 MB.' });
      return;
    }
    try {
      const { dataUrl, analysis } = await prepareImage(file);
      setProjectorBackground({ dataUrl, name: file.name, ...analysis });
      pushToast({
        kind: 'success',
        title: 'Background set',
        message: `${file.name} is now behind the projector text.`,
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Could not read image',
        message: err?.message || 'Try a JPG or PNG under 25 MB.',
      });
    }
  };

  const clearImage = () => {
    setProjectorImage({ dataUrl: null, name: '' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const clearBackground = () => {
    setProjectorBackground({ dataUrl: null, name: '' });
    if (bgInputRef.current) bgInputRef.current.value = '';
  };
  const setBackgroundFit = (fit) => {
    setProjectorBackground({ ...projectorBackground, fit });
  };
  const updateProjectorDisplay = (patch) => {
    setProjectorDisplay?.({ ...projectorDisplay, ...patch });
  };

  const runQuickAction = async (item) => {
    if (!item) return;
    if (item.action === 'show-sangat-qr') {
      if (!shareUrl) {
        pushToast?.({
          kind: 'info',
          title: 'Sangat View not ready',
          message: 'Open the projector first so a share link is generated.',
        });
        return;
      }
      if (projectorEmergency) setProjectorEmergencyMode?.(null);
      setSangatQrFullscreen?.(true);
      return;
    }
    if (sangatQrFullscreen) setSangatQrFullscreen?.(false);
    if (item.action === 'open-shabad') {
      setQuickLoading(item.id);
      try {
        setProjectorViewMode('shabad');
        if (item.shabadId) {
          const qs = item.bundle ? `?bundle=${encodeURIComponent(item.bundle)}` : '';
          navigate(`/shabad/${encodeURIComponent(item.shabadId)}${qs}`);
          return;
        }
        const res = await api.searchShabads({
          q: item.initials || item.query,
          searchType: item.initials ? 0 : 2,
        });
        const result = res?.results?.find((entry) => entry?.shabadId);
        if (!result?.shabadId) {
          pushToast?.({
            kind: 'info',
            title: 'Could not open Anand Sahib',
            message: 'Try searching Anand Sahib manually.',
          });
          return;
        }
        navigate(`/shabad/${encodeURIComponent(result.shabadId)}`);
      } catch (err) {
        pushToast?.({
          kind: 'error',
          title: 'Could not open Anand Sahib',
          message: err?.response?.data?.error || err.message || 'Try searching manually.',
        });
      } finally {
        setQuickLoading('');
      }
      return;
    }
    setProjectorEmergencyMode?.(item.id);
  };

  return (
    <section
      className={`projector-controls${embedded ? ' projector-controls-embedded' : ' card'}${compact ? ' projector-controls-compact' : ''}`}
      aria-label="Projector"
    >
      {/* Row 1: title + open/focus button --------------------------------- */}
      <header className="projector-controls-head">
        <div className="projector-controls-title-wrap">
          <p className="section-eyebrow">Projector</p>
          <h3 className="projector-controls-title">Sangat display</h3>
        </div>
        <button
          type="button"
          className={`btn btn-sm ${windowOpen ? 'btn-secondary' : 'btn-primary'} projector-open-btn`}
          onClick={openOrFocusProjector}
        >
          <ProjectorIcon />
          {windowOpen ? 'Focus projector' : 'Open projector'}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary projector-share-btn"
          onClick={() => setShareOpen(true)}
          disabled={!shareUrl}
          title="Show a QR code for read-only Sangat View."
        >
          <ShareIcon />
          Share
        </button>
      </header>

      {shareOpen && typeof document !== 'undefined' && createPortal(
        // Portalled to <body> so the modal can never be trapped inside the
        // embedded ProjectorControls' details/transform/filter parent.
        // Backdrop click + Escape (effect above) both dismiss it.
        <div
          className="projector-share-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Share with sangat"
          onClick={() => setShareOpen(false)}
        >
          <div className="projector-share-card" onClick={(event) => event.stopPropagation()}>
            <div className="projector-share-head">
              <div>
                <p className="section-eyebrow">Sangat View</p>
                <h3>Share live display</h3>
              </div>
              <button
                type="button"
                className="projector-share-close"
                onClick={() => setShareOpen(false)}
                aria-label="Close Sangat View share"
              >
                ×
              </button>
            </div>

            <ShareQrCode value={shareUrl} />
            <p className="projector-share-copy">
              Scan to open a view-only page that follows the projector in real time. It cannot control the app.
            </p>
            <div className="projector-share-url">
              <span>{shareUrl || 'Waiting for main app connection...'}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={copyShareUrl} disabled={!shareUrl}>
                Copy
              </button>
            </div>
            {shareUrlUsesLocalhost && (
              <p className="projector-share-warning">
                This link uses localhost. For phones, open the app from your computer's network IP or set VITE_PUBLIC_APP_URL.
              </p>
            )}
            <label className="projector-share-projector-toggle">
              <span>
                <strong>Show fullscreen on projector</strong>
                <small>Large QR overlay so sangat at the back of the hall can scan from a distance. A small corner QR shows automatically whenever a share link is available.</small>
              </span>
              <input
                type="checkbox"
                checked={Boolean(sangatQrFullscreen)}
                onChange={(event) => setSangatQrFullscreen?.(event.target.checked)}
                disabled={!shareUrl}
              />
            </label>
          </div>
        </div>,
        document.body,
      )}

      {/* Row 2: now-showing pill (left) + view toggle (right) on one row -- */}
      <div className="projector-status-row">
        <div className="projector-status-now">
          <span className="projector-mode-label">Now showing:</span>
          <span className={`projector-mode-pill projector-mode-${mode}`}>
            {mode === 'image'  && (projectorImage.name || 'Custom image')}
            {mode === 'shabad' && (selectedShabad?.meta?.raag || 'Shabad selected')}
            {mode === 'blank'  && 'Blank screen'}
            {mode === 'emergency' && (projectorEmergency?.label || projectorEmergency?.title || 'Emergency')}
            {mode === 'idle'   && 'ੴ Waheguru (idle)'}
          </span>
          {projectorBackground.dataUrl && (
            <span className="projector-bg-pill" title={projectorBackground.name || 'Custom background'}>
              BG on
            </span>
          )}
        </div>

      </div>

      <div className="projector-emergency" aria-label="Emergency projector controls">
        <div className="projector-emergency-buttons">
          {selectedShabad && (
            <button
              type="button"
              className={`projector-emergency-btn${!projectorEmergency && projectorViewMode !== 'waheguru' && !sangatQrFullscreen ? ' projector-emergency-btn-on' : ''}`}
              onClick={() => {
                if (sangatQrFullscreen) setSangatQrFullscreen?.(false);
                setProjectorViewMode('shabad');
              }}
            >
              Shabad
            </button>
          )}
          {PROJECTOR_EMERGENCY_ITEMS.map((item) => {
            let active;
            if (item.id === 'sangat-qr') {
              active = Boolean(sangatQrFullscreen);
            } else if (item.id === 'waheguru') {
              active = !projectorEmergency && projectorViewMode === 'waheguru' && !sangatQrFullscreen;
            } else {
              active = projectorEmergency?.id === item.id && !sangatQrFullscreen;
            }
            const disabledForSangat = item.id === 'sangat-qr' && !shareUrl;
            return (
              <button
                key={item.id}
                type="button"
                className={`projector-emergency-btn${active ? ' projector-emergency-btn-on' : ''}`}
                onClick={() => runQuickAction(item)}
                disabled={quickLoading === item.id || disabledForSangat}
                title={disabledForSangat ? 'Open the projector first to generate a share link' : undefined}
              >
                {quickLoading === item.id ? 'Opening...' : item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="projector-presets" role="radiogroup" aria-label="Projector preset">
        {PROJECTOR_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={projectorPreset === preset.id}
            className={`projector-preset-btn${projectorPreset === preset.id ? ' projector-preset-btn-on' : ''}`}
            onClick={() => applyProjectorPreset?.(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Row 3: upload actions (left) + bg fit toggles when bg present (right) */}
      <div className="projector-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          hidden
        />
        <input
          ref={bgInputRef}
          type="file"
          accept="image/*"
          onChange={handleBackgroundChange}
          hidden
        />
        <button
          type="button"
          className="btn btn-sm btn-secondary projector-upload-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon />
          Upload image
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary projector-upload-btn"
          onClick={() => bgInputRef.current?.click()}
        >
          <UploadIcon />
          Set background
        </button>
        {projectorImage.dataUrl && (
          <button type="button" className="btn-ghost projector-clear" onClick={clearImage}>
            <TrashIcon />
            Clear image
          </button>
        )}
        {projectorBackground.dataUrl && (
          <button type="button" className="btn-ghost projector-clear" onClick={clearBackground}>
            <TrashIcon />
            Clear bg
          </button>
        )}

        {projectorBackground.dataUrl && (
          <div className="projector-bg-size-row" role="radiogroup" aria-label="Background size">
            {[
              { id: 'cover', label: 'Fill' },
              { id: 'contain', label: 'Fit' },
              { id: 'fill', label: 'Stretch' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={(projectorBackground.fit || 'cover') === opt.id}
                className={`projector-size-btn${(projectorBackground.fit || 'cover') === opt.id ? ' projector-size-btn-active' : ''}`}
                onClick={() => setBackgroundFit(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="projector-tuning" aria-label="Projector layout controls">
        <label className="projector-range">
          <span>Font</span>
          <input
            type="range"
            min="0.75"
            max="1.35"
            step="0.05"
            value={projectorDisplay.fontScale}
            onChange={(e) => updateProjectorDisplay({ fontScale: Number(e.target.value) })}
          />
          <output>{Math.round(projectorDisplay.fontScale * 100)}%</output>
        </label>
      </div>

      {(!compact || showPreview) && (
        <div className={`projector-preview projector-preview-${mode}`} aria-label="Projector preview">
          {mode === 'image' && projectorImage.dataUrl ? (
            <img src={projectorImage.dataUrl} alt={projectorImage.name || 'Projector preview'} />
          ) : (
            <>
              <span className="projector-preview-label">Preview</span>
              <p className="projector-preview-line gurmukhi">{previewTitle}</p>
              {mode === 'shabad' && display.showTransliteration && previewVerse?.transliteration && (
                <p className="projector-preview-sub translit">{previewVerse.transliteration}</p>
              )}
              {mode === 'shabad' && display.showEnglish && previewVerse?.translationEn && (
                <p className="projector-preview-sub">{previewVerse.translationEn}</p>
              )}
            </>
          )}
        </div>
      )}

      {!compact && <p className="projector-hint">
        While searching, the projector stays on <strong>ੴ ਵਾਹਿਗੁਰੂ</strong>.
        Once you select a Shabad it will follow the line being sung.
      </p>}
    </section>
  );
}
