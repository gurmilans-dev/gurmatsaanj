import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../services/api';
import renderGurmukhiLine from '../../utils/renderGurmukhiLine';
import './FollowPage.css';

// ── Per-device sangat display preferences ────────────────────────────────
// Saved in localStorage so each phone's settings stick across sessions
// without needing accounts. Sangat's local pref wins over the host's
// broadcast flag so a follower can keep Punjabi off (or English on) even
// if the kirtani has the opposite.
const FOLLOW_PREFS_KEY = 'saanj-kirtan.follow.prefs.v1';
const FONT_MIN = 0.85;
const FONT_MAX = 1.5;
const FONT_STEP = 0.05;

const DEFAULT_FOLLOW_PREFS = {
  showTransliteration: true,
  showEnglish: true,
  showPunjabi: false,
  fontScale: 1,
  // 'dark' = warm-darbar (default; easier on the eyes in a dim hall);
  // 'light' = warm cream for outdoor diwans / daylight reading.
  theme: 'dark',
};

function loadFollowPrefs() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage?.getItem(FOLLOW_PREFS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveFollowPrefs(prefs) {
  if (typeof window === 'undefined') return;
  try { window.localStorage?.setItem(FOLLOW_PREFS_KEY, JSON.stringify(prefs)); } catch { /* noop */ }
}

function useFollowPrefs() {
  const [prefs, setPrefs] = useState(() => ({
    ...DEFAULT_FOLLOW_PREFS,
    ...(loadFollowPrefs() || {}),
  }));
  const update = useCallback((patch) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      saveFollowPrefs(next);
      return next;
    });
  }, []);
  return [prefs, update];
}

// ── Stream wiring ────────────────────────────────────────────────────────

function streamUrl(code) {
  const base = import.meta.env.VITE_API_URL || '/api';
  const params = new URLSearchParams({ code });
  return `${base}/remote/follow/stream?${params.toString()}`;
}

function lineByIndex(state, index) {
  if (!Array.isArray(state?.surroundingLines)) return null;
  return state.surroundingLines.find((item) => Number(item?.index) === index) || null;
}

function currentLineFromState(state) {
  const index = Number(state?.activeLineIndex);
  if (!Number.isFinite(index) || index < 0) return null;
  const line = lineByIndex(state, index);
  return line || {
    index,
    gurmukhi: state?.activeLineText || '',
    transliteration: state?.activeLineTransliteration || '',
    translationEn: state?.activeLineTranslationEn || '',
    translationPa: state?.activeLineTranslationPa || '',
    vishraams: state?.activeLineVishraams || [],
  };
}

// ── Component ────────────────────────────────────────────────────────────

export default function FollowPage() {
  const { code = '' } = useParams();
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('Connecting...');
  const [connected, setConnected] = useState(false);

  const [prefs, updatePrefs] = useFollowPrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);
  const settingsButtonRef = useRef(null);

  // The global body styles use min-height: 100vh, which on mobile is the
  // *large* viewport (browser chrome hidden). That makes the body taller
  // than the visible area while the address bar is showing → the page
  // becomes very-slightly scrollable even when no content overflows. The
  // body-scope class below overrides that for follower pages only.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.body.classList.add('follow-body');
    return () => document.body.classList.remove('follow-body');
  }, []);

  // Settings popover dismissal (outside-click + Escape).
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onPointer = (event) => {
      if (settingsRef.current?.contains(event.target)) return;
      if (settingsButtonRef.current?.contains(event.target)) return;
      setSettingsOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

  // SSE subscription (with REST fallback for browsers without EventSource).
  useEffect(() => {
    let cancelled = false;
    let pollTimer = null;
    let es = null;

    const loadOnce = async () => {
      try {
        const next = await api.getFollowState(code);
        if (cancelled) return;
        setState(next);
        setConnected(Boolean(next?.connected));
        setStatus(next?.connected ? 'Live' : 'Waiting');
      } catch {
        if (cancelled) return;
        setConnected(false);
        setStatus('Reconnecting...');
      }
    };

    loadOnce();

    if (typeof EventSource !== 'undefined') {
      es = new EventSource(streamUrl(code));
      es.addEventListener('state', (event) => {
        try {
          const next = JSON.parse(event.data);
          if (cancelled) return;
          setState(next);
          setConnected(Boolean(next?.connected));
          setStatus(next?.connected ? 'Live' : 'Waiting');
        } catch {
          // Ignore one malformed packet; the next state event will repair it.
        }
      });
      es.addEventListener('error', () => {
        if (cancelled) return;
        setConnected(false);
        setStatus('Reconnecting...');
      });
    } else {
      pollTimer = setInterval(loadOnce, 2000);
    }

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (es) es.close();
    };
  }, [code]);

  const currentLine = useMemo(() => currentLineFromState(state), [state]);
  const prevLine = useMemo(() => {
    const idx = Number(state?.activeLineIndex);
    return Number.isFinite(idx) && idx > 0 ? lineByIndex(state, idx - 1) : null;
  }, [state]);
  const nextLine = useMemo(() => {
    const idx = Number(state?.activeLineIndex);
    return Number.isFinite(idx) ? lineByIndex(state, idx + 1) : null;
  }, [state]);

  const showTranslit = prefs.showTransliteration;
  const showEnglish  = prefs.showEnglish;
  const showPunjabi  = prefs.showPunjabi;
  const fontScale    = Number(prefs.fontScale) || 1;
  const theme        = prefs.theme === 'light' ? 'light' : 'dark';

  const adjustFont = (delta) => {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, Number((fontScale + delta).toFixed(2))));
    updatePrefs({ fontScale: next });
  };

  // Render order matters — projectorView is the canonical "what is the
  // host showing right now" flag. We MUST honour 'waheguru' / 'idle' before
  // falling through to the shabad branch, otherwise the follower keeps
  // rendering the previously-cached active line after the host clicked
  // "Waheguru" or navigated away from a shabad.
  const view = state?.projectorView;
  const mode = state?.projectorMode;
  const isBlank     = view === 'blank' || mode === 'blank';
  const isEmergency = view === 'emergency' || (mode !== 'waheguru' && mode !== 'idle' && state?.emergencyGurmukhi);
  const isIdle      = view === 'waheguru' || view === 'idle' || !view;

  let content;
  if (isBlank) {
    content = <div className="follow-blank" aria-label="Blank projector screen" />;
  } else if (isEmergency) {
    content = (
      <main className="follow-stage">
        {state.emergencyTitle && <p className="follow-title gurmukhi">{state.emergencyTitle}</p>}
        <h1 className="follow-line gurmukhi">{state.emergencyGurmukhi}</h1>
        {showTranslit && state.emergencyTransliteration && (
          <p className="follow-translit">{state.emergencyTransliteration}</p>
        )}
      </main>
    );
  } else if (!isIdle && currentLine?.gurmukhi) {
    content = (
      <main className="follow-stage">
        <p className="follow-title gurmukhi">{state?.viewerTitle || state?.selectedTitle || 'Gurbani'}</p>
        {state?.selectedMeta && <p className="follow-meta">{state.selectedMeta}</p>}
        {prevLine?.gurmukhi && (
          <p className="follow-line follow-line-context follow-line-prev gurmukhi">
            {renderGurmukhiLine(prevLine.gurmukhi, prevLine.vishraams, state?.larivaar)}
          </p>
        )}
        <h1 className="follow-line follow-line-active gurmukhi">
          {renderGurmukhiLine(currentLine.gurmukhi, currentLine.vishraams, state?.larivaar)}
        </h1>
        {showTranslit && currentLine.transliteration && (
          <p className="follow-translit">{currentLine.transliteration}</p>
        )}
        {showEnglish && currentLine.translationEn && (
          <p className="follow-translation">{currentLine.translationEn}</p>
        )}
        {showPunjabi && currentLine.translationPa && (
          <p className="follow-translation follow-translation-pa gurmukhi">{currentLine.translationPa}</p>
        )}
        {nextLine?.gurmukhi && (
          <p className="follow-line follow-line-context follow-line-next gurmukhi">
            {renderGurmukhiLine(nextLine.gurmukhi, nextLine.vishraams, state?.larivaar)}
          </p>
        )}
        <p className="follow-count">
          {Number(currentLine.index) + 1}
          {state?.activeLineTotal ? ` / ${state.activeLineTotal}` : ''}
        </p>
      </main>
    );
  } else {
    content = (
      <main className="follow-stage follow-idle">
        <h1 className="follow-onkar gurmukhi">ੴ</h1>
        <p className="follow-waheguru gurmukhi">ਵਾਹਿਗੁਰੂ</p>
        {showTranslit && <p className="follow-translit">Waheguru</p>}
        <p className="follow-translit">Waiting for the projector</p>
      </main>
    );
  }

  return (
    <div
      className={`follow-page follow-theme-${theme}${connected ? ' follow-page-live' : ''}`}
      style={{ '--follow-font-scale': fontScale }}
    >
      <header className="follow-header">
        <div>
          <p className="follow-eyebrow">Sangat View</p>
          <strong>Gurmat Saanj</strong>
        </div>
        <div className="follow-header-right">
          <div className="follow-theme-group" role="radiogroup" aria-label="Theme">
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'light'}
              className={`follow-theme-btn${theme === 'light' ? ' follow-theme-btn-on' : ''}`}
              onClick={() => updatePrefs({ theme: 'light' })}
              title="Light mode"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <circle cx="8" cy="8" r="3" fill="currentColor" />
                <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <line x1="8" y1="1.5" x2="8" y2="3" />
                  <line x1="8" y1="13" x2="8" y2="14.5" />
                  <line x1="1.5" y1="8" x2="3" y2="8" />
                  <line x1="13" y1="8" x2="14.5" y2="8" />
                  <line x1="3.2" y1="3.2" x2="4.3" y2="4.3" />
                  <line x1="11.7" y1="11.7" x2="12.8" y2="12.8" />
                  <line x1="3.2" y1="12.8" x2="4.3" y2="11.7" />
                  <line x1="11.7" y1="4.3" x2="12.8" y2="3.2" />
                </g>
              </svg>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={theme === 'dark'}
              className={`follow-theme-btn${theme === 'dark' ? ' follow-theme-btn-on' : ''}`}
              onClick={() => updatePrefs({ theme: 'dark' })}
              title="Dark mode"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M11 2.5a6 6 0 1 0 2.5 9.5A5 5 0 0 1 11 2.5Z" fill="currentColor" />
              </svg>
            </button>
          </div>
          <span className={`follow-status${connected ? ' follow-status-live' : ''}`}>{status}</span>
          <button
            ref={settingsButtonRef}
            type="button"
            className={`follow-settings-btn${settingsOpen ? ' follow-settings-btn-on' : ''}`}
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            aria-controls="follow-settings"
            title="Display options"
            aria-label="Display options"
          >
            Aa
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div
          ref={settingsRef}
          id="follow-settings"
          className="follow-settings"
          role="dialog"
          aria-label="Display options"
        >
          <p className="follow-settings-eyebrow">Your view</p>
          <div className="follow-settings-toggles" role="group" aria-label="Visible text layers">
            <button
              type="button"
              className={`follow-toggle${showTranslit ? ' follow-toggle-on' : ''}`}
              onClick={() => updatePrefs({ showTransliteration: !showTranslit })}
              aria-pressed={showTranslit}
            >
              Translit
            </button>
            <button
              type="button"
              className={`follow-toggle${showEnglish ? ' follow-toggle-on' : ''}`}
              onClick={() => updatePrefs({ showEnglish: !showEnglish })}
              aria-pressed={showEnglish}
            >
              English
            </button>
            <button
              type="button"
              className={`follow-toggle${showPunjabi ? ' follow-toggle-on' : ''}`}
              onClick={() => updatePrefs({ showPunjabi: !showPunjabi })}
              aria-pressed={showPunjabi}
            >
              Punjabi
            </button>
          </div>
          <div className="follow-settings-font" role="group" aria-label="Font size">
            <button type="button" onClick={() => adjustFont(-FONT_STEP)} disabled={fontScale <= FONT_MIN + 0.01}>A-</button>
            <span>{Math.round(fontScale * 100)}%</span>
            <button type="button" onClick={() => adjustFont(FONT_STEP)} disabled={fontScale >= FONT_MAX - 0.01}>A+</button>
          </div>
          <p className="follow-settings-hint">Saved to this device. Kirtani's settings are not affected.</p>
        </div>
      )}

      {content}

      <footer className="follow-footer">
        <span>View-only live display</span>
        <Link to="/remote">Open remote</Link>
      </footer>
    </div>
  );
}
