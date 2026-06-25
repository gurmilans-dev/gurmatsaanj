import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import './RemoteControlPage.css';

const COMMANDS = {
  linePrev: 'line-prev',
  lineNext: 'line-next',
  lineFirst: 'line-first',
  lineLast: 'line-last',
  lineSelect: 'line-select',
  loadMore: 'load-more-lines',
  shabadPrev: 'shabad-prev',
  shabadNext: 'shabad-next',
  angPrev: 'ang-prev',
  angNext: 'ang-next',
  openShabad: 'open-shabad',
  openAng: 'open-ang',
  shabad: 'projector-shabad',
  waheguru: 'projector-waheguru',
  blank: 'projector-blank',
  mool: 'projector-mool-mantar',
  presetWarm: 'preset-warm',
  presetContrast: 'preset-contrast',
  presetSimple: 'preset-simple',
  fontUp: 'font-up',
  fontDown: 'font-down',
  micStart: 'mic-start',
  micStop: 'mic-stop',
  queueAdd: 'queue-add',
  queueOpen: 'queue-open',
  queueRemove: 'queue-remove',
  queueClear: 'queue-clear',
  undoOpen: 'undo-open',
};

const REMOTE_CLIENT_KEY = 'saanj-kirtan.remoteClientId';
const REMOTE_CODE_KEY = 'saanj-kirtan.remotePairCode';
const REMOTE_NAME_KEY = 'saanj-kirtan.remoteName';

function randomClientId() {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `remote-${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return `remote-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function storedValue(key, fallback = '') {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function rememberValue(key, value) {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
}

function forgetValue(key) {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

function codeFromUrl() {
  if (typeof window === 'undefined') return '';
  try {
    return (new URLSearchParams(window.location.search).get('code') || '')
      .replace(/\D/g, '')
      .slice(0, 4);
  } catch {
    return '';
  }
}

function defaultRemoteName() {
  if (typeof navigator === 'undefined') return 'Remote device';
  const ua = navigator.userAgent || '';
  if (/ipad/i.test(ua)) return 'iPad remote';
  if (/iphone/i.test(ua)) return 'iPhone remote';
  if (/android/i.test(ua) && /mobile/i.test(ua)) return 'Android phone';
  if (/android/i.test(ua)) return 'Android tablet';
  if (/macintosh|windows|linux/i.test(ua)) return 'Laptop remote';
  return 'Remote device';
}

const LEGACY_COMMANDS = new Set([
  'line-prev',
  'line-next',
  'line-first',
  'line-last',
  'projector-shabad',
  'projector-waheguru',
  'projector-blank',
  'projector-mool-mantar',
  'preset-warm',
  'preset-contrast',
  'preset-simple',
  'font-up',
  'font-down',
  'mic-start',
  'mic-stop',
  'mic-toggle',
  'open-shabad',
  'queue-add',
  'queue-open',
  'queue-remove',
  'queue-clear',
  'undo-open',
]);

const COMMAND_LABELS = {
  [COMMANDS.linePrev]: 'Previous line',
  [COMMANDS.lineNext]: 'Next line',
  [COMMANDS.lineFirst]: 'First line',
  [COMMANDS.lineLast]: 'Last line',
  [COMMANDS.lineSelect]: 'Select line',
  [COMMANDS.loadMore]: 'Load more lines',
  [COMMANDS.shabadPrev]: 'Previous Shabad',
  [COMMANDS.shabadNext]: 'Next Shabad',
  [COMMANDS.angPrev]: 'Previous Ang',
  [COMMANDS.angNext]: 'Next Ang',
  [COMMANDS.openShabad]: 'Open Shabad',
  [COMMANDS.openAng]: 'Open Ang',
  [COMMANDS.micStart]: 'Start Mic',
  [COMMANDS.micStop]: 'Stop Mic',
  [COMMANDS.queueAdd]: 'Add to queue',
  [COMMANDS.queueOpen]: 'Open queued item',
  [COMMANDS.queueRemove]: 'Remove queued item',
  [COMMANDS.queueClear]: 'Clear queue',
  [COMMANDS.undoOpen]: 'Go back',
};

const ICONS = {
  search: 'M8.5 4a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm3.2 7.7L16 16',
  book: 'M4 4.8c1.8-.8 3.5-.8 5 0v10.4c-1.5-.8-3.2-.8-5 0V4.8Zm5 .2c1.5-.9 3.2-.9 5-.1v10.3c-1.8-.8-3.5-.8-5 0V5Z',
  ang: 'M5 3.8h7l3 3V16H5V3.8Zm7 0V7h3',
  mic: 'M10 2.8a2.8 2.8 0 0 0-2.8 2.8v4.2a2.8 2.8 0 0 0 5.6 0V5.6A2.8 2.8 0 0 0 10 2.8ZM5 9.4v.5a5 5 0 0 0 10 0v-.5M10 15v2.5M7.2 17.5h5.6',
  micOff: 'M4 4l12 12M10 2.8a2.8 2.8 0 0 1 2.8 2.8v3.2M7.2 7.2v2.6a2.8 2.8 0 0 0 4.9 1.8M5 9.4v.5a5 5 0 0 0 7.8 4.1M15 9.4v.5c0 .8-.2 1.5-.5 2.1M10 15v2.5M7.2 17.5h5.6',
  prev: 'M12.8 4.5 7.2 10l5.6 5.5M5 4.8v10.4',
  next: 'M7.2 4.5 12.8 10l-5.6 5.5M15 4.8v10.4',
  left: 'M12.8 4.5 7.2 10l5.6 5.5',
  right: 'M7.2 4.5 12.8 10l-5.6 5.5',
  first: 'M14.5 4.5 9 10l5.5 5.5M5.5 4.8v10.4',
  last: 'M5.5 4.5 11 10l-5.5 5.5M14.5 4.8v10.4',
  more: 'M10 4v12M4 10h12',
  projector: 'M3.5 4.5h13v8.5h-13V4.5Zm4 11h5M10 13v2.5',
  type: 'M5 5h10M10 5v10M7.5 15h5',
  palette: 'M10 3.5a6.2 6.2 0 0 0 0 12.4h1.2a1.4 1.4 0 0 0 .8-2.6 1.2 1.2 0 0 1 .7-2.2H14a3.2 3.2 0 0 0 3-3.4c-.3-2.4-2.9-4.2-7-4.2ZM7 8h.1M9.2 6.4h.1M12 6.5h.1M14 8.4h.1',
  queue: 'M5 5h9M5 9h9M5 13h6M14 12v5M11.5 14.5h5',
  trash: 'M5.5 6.5h9M8 6.5V5h4v1.5M7 8v7.5h6V8M9 10v3.5M11 10v3.5',
  undo: 'M8 6H4v4M4.5 9.5A5.8 5.8 0 1 0 7 5.1',
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" className="remote-icon">
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RemoteButton({
  command,
  payload,
  children,
  icon,
  className = '',
  disabled = false,
  onSend,
}) {
  const [busy, setBusy] = useState(false);
  const busyTimerRef = useRef(null);
  useEffect(() => () => { if (busyTimerRef.current) clearTimeout(busyTimerRef.current); }, []);
  const send = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onSend(command, payload);
    } finally {
      if (busyTimerRef.current) clearTimeout(busyTimerRef.current);
      busyTimerRef.current = setTimeout(() => { setBusy(false); busyTimerRef.current = null; }, 180);
    }
  };
  return (
    <button type="button" className={`remote-btn ${className}`} onClick={send} disabled={busy || disabled}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </button>
  );
}

function RemoteSearch({
  experience,
  openAs,
  canControl = false,
  onExperienceChange,
  onOpenAsChange,
  onOpenShabad,
  onOpenAng,
  onError,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [angFallbackNote, setAngFallbackNote] = useState('');
  const searchSeqRef = useRef(0);
  const busyIdTimerRef = useRef(null);
  useEffect(() => () => { if (busyIdTimerRef.current) clearTimeout(busyIdTimerRef.current); }, []);
  const trimmed = query.trim();
  const angNumber = /^[0-9]+$/.test(trimmed) ? Number(trimmed) : null;
  const canOpenAng = Number.isFinite(angNumber) && angNumber >= 1 && angNumber <= 1430;
  const isKatha = experience === 'katha';
  const shouldOpenFullAng = isKatha && openAs === 'ang';

  useEffect(() => {
    if (trimmed.length < 2 && !canOpenAng) {
      searchSeqRef.current += 1;
      setResults([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    const seq = searchSeqRef.current + 1;
    searchSeqRef.current = seq;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchShabads({
          q: trimmed,
          searchType: canOpenAng ? 5 : undefined,
        });
        if (!cancelled && seq === searchSeqRef.current) {
          setResults((res?.results || []).slice(0, canOpenAng ? 60 : 12));
        }
      } catch (err) {
        if (!cancelled && seq === searchSeqRef.current) onError?.(err, 'Search failed');
      } finally {
        if (!cancelled && seq === searchSeqRef.current) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [trimmed, canOpenAng, onError]);

  const openShabad = async (item) => {
    if (!item?.shabadId || busyId) return;
    setBusyId(String(item.shabadId));
    try {
      if (shouldOpenFullAng) {
        let pageNo = item?.pageNo;
        if (!pageNo) {
          const shabad = await api.getShabad(item.shabadId);
          pageNo = shabad?.meta?.pageNo;
        }
        if (pageNo) {
          await onOpenAng(pageNo, { isKatha: true, seedShabadId: item.shabadId });
        } else {
          setAngFallbackNote('This result has no Ang number. Opening it as a Shabad instead.');
          await onOpenShabad(item, { isKatha });
        }
      } else {
        await onOpenShabad(item, { isKatha });
      }
    } finally {
      if (busyIdTimerRef.current) clearTimeout(busyIdTimerRef.current);
      busyIdTimerRef.current = setTimeout(() => { setBusyId(''); busyIdTimerRef.current = null; }, 250);
    }
  };
  const openFullAng = async () => {
    if (!canOpenAng) return;
    setAngFallbackNote('');
    const ok = await onOpenAng(angNumber, { isKatha: true });
    if (!ok) {
      setAngFallbackNote(`Could not open full Ang ${angNumber}. Choose a Shabad from this Ang below.`);
    }
  };
  const shownResults = canOpenAng
    ? results.filter((item, index, list) =>
        item?.shabadId &&
        list.findIndex((candidate) => String(candidate.shabadId) === String(item.shabadId)) === index
      )
    : results;

  return (
    <section className="remote-search" aria-label="Search Shabad or Ang">
      <div className="remote-section-head">
        <div>
          <p className="section-eyebrow">Search</p>
          <h2>{isKatha ? 'Katha search' : 'Kirtan search'}</h2>
        </div>
        <Icon name="search" />
      </div>

      <div className="remote-search-mode-row">
        <div className="remote-segmented" role="radiogroup" aria-label="Remote search mode">
          <button
            type="button"
            role="radio"
            aria-checked={!isKatha}
            className={`remote-seg${!isKatha ? ' remote-seg-on' : ''}`}
            onClick={() => onExperienceChange('kirtan')}
          >
            Kirtan
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={isKatha}
            className={`remote-seg${isKatha ? ' remote-seg-on' : ''}`}
            onClick={() => onExperienceChange('katha')}
          >
            Katha
          </button>
        </div>

        {isKatha && (
          <div className="remote-segmented" role="radiogroup" aria-label="Open Katha results as">
            <button
              type="button"
              role="radio"
              aria-checked={openAs === 'shabad'}
              className={`remote-seg${openAs === 'shabad' ? ' remote-seg-on' : ''}`}
              onClick={() => onOpenAsChange('shabad')}
            >
              Shabad
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={openAs === 'ang'}
              className={`remote-seg${openAs === 'ang' ? ' remote-seg-on' : ''}`}
              onClick={() => onOpenAsChange('ang')}
            >
              Full Ang
            </button>
          </div>
        )}
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={isKatha ? 'Katha: words, initials, or Ang number' : 'Kirtan: Shabad words, initials, or Ang'}
        className="remote-search-input"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck="false"
      />

      {canOpenAng && shouldOpenFullAng && (
        <div className="remote-search-actions">
          <button type="button" className="remote-open-ang" onClick={openFullAng} disabled={!canControl}>
            <Icon name="ang" />
            <span>Open Full Ang {angNumber}</span>
          </button>
        </div>
      )}
      {angFallbackNote && <p className="remote-search-status remote-search-warning">{angFallbackNote}</p>}

      {loading && results.length === 0 && <p className="remote-search-status">Searching...</p>}
      {loading && results.length > 0 && <p className="remote-search-status">Updating results...</p>}
      {!loading && trimmed.length >= 2 && results.length === 0 && !canOpenAng && (
        <p className="remote-search-status">No matches.</p>
      )}
      {canOpenAng && shownResults.length > 0 && (
        <p className="remote-search-status">
          {shouldOpenFullAng ? 'Fallback: ' : ''}Shabads found on Ang {angNumber}
        </p>
      )}
      {shownResults.length > 0 && (
        <ul className="remote-search-list">
          {shownResults.map((item) => {
            const isBusy = busyId === String(item.shabadId);
            return (
              <li key={`${item.shabadId}-${item.lineNo ?? ''}`}>
                <button
                  type="button"
                  className="remote-search-item"
                  onClick={() => openShabad(item)}
                  disabled={isBusy || !canControl}
                >
                  <span className="remote-search-pa gurmukhi">{item.gurmukhi}</span>
                  {canOpenAng && <span className="remote-search-meta">Ang {angNumber}</span>}
                  {shouldOpenFullAng && item?.pageNo && (
                    <span className="remote-search-meta">Opens full Ang {item.pageNo}</span>
                  )}
                  <span className="remote-search-meta">
                    {[item.raag, item.writer, item.source].filter(Boolean).join(' · ')}
                    {isBusy && ' · opening...'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RemoteQueuePanel({ state, canControl, defaultSession = 'kirtan', onSend }) {
  const [sessionId, setSessionId] = useState(defaultSession === 'katha' ? 'katha' : 'kirtan');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);
  const q = query.trim();
  const angNumber = /^[0-9]+$/.test(q) ? Number(q) : null;
  const canQueueAng = Number.isFinite(angNumber) && angNumber >= 1 && angNumber <= 1430;
  const queueItems = useMemo(() => (
    Array.isArray(state?.queueItems)
      ? state.queueItems.filter((item) => (item.sessionId || item.queueSessionId || 'kirtan') === sessionId)
      : []
  ), [sessionId, state?.queueItems]);

  useEffect(() => {
    setSessionId(defaultSession === 'katha' ? 'katha' : 'kirtan');
  }, [defaultSession]);

  useEffect(() => {
    if (q.length < 2 && !canQueueAng) {
      seqRef.current += 1;
      setResults([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchShabads({ q, searchType: canQueueAng ? 5 : undefined });
        if (!cancelled && seq === seqRef.current) {
          const seen = new Set();
          const nextResults = (res?.results || []).filter((item) => {
            if (!item?.shabadId || seen.has(String(item.shabadId))) return false;
            seen.add(String(item.shabadId));
            return true;
          });
          setResults(nextResults.slice(0, 6));
        }
      } catch {
        if (!cancelled && seq === seqRef.current) setResults([]);
      } finally {
        if (!cancelled && seq === seqRef.current) setLoading(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canQueueAng, q]);

  const queueShabad = (item) => onSend(COMMANDS.queueAdd, {
    sessionId,
    item: {
      kind: 'shabad',
      shabadId: item.shabadId,
      gurmukhi: item.gurmukhi || item.mainGurmukhi || '',
      raag: item.raag || '',
      writer: item.writer || '',
      source: item.source || '',
      pageNo: item.pageNo || null,
    },
  });

  const queueAng = () => onSend(COMMANDS.queueAdd, {
    sessionId,
    item: {
      kind: 'ang',
      pageNo: angNumber,
      title: `Ang ${angNumber}`,
      gurmukhi: `Ang ${angNumber}`,
    },
  });

  return (
    <section className="remote-queue-card" aria-label="Remote queue">
      <div className="remote-section-head">
        <div>
          <p className="section-eyebrow">Queue</p>
          <h2>{sessionId === 'katha' ? 'Katha session' : 'Kirtan session'}</h2>
        </div>
        <Icon name="queue" />
      </div>

      <div className="remote-segmented remote-queue-tabs" role="radiogroup" aria-label="Queue session">
        <button
          type="button"
          role="radio"
          aria-checked={sessionId === 'kirtan'}
          className={`remote-seg${sessionId === 'kirtan' ? ' remote-seg-on' : ''}`}
          onClick={() => setSessionId('kirtan')}
        >
          Kirtan
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={sessionId === 'katha'}
          className={`remote-seg${sessionId === 'katha' ? ' remote-seg-on' : ''}`}
          onClick={() => setSessionId('katha')}
        >
          Katha
        </button>
      </div>

      <div className="remote-queue-add">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Add by words, initials, or Ang"
          className="remote-search-input"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
        />
        {canQueueAng && (
          <button type="button" className="remote-open-ang remote-open-secondary" onClick={queueAng} disabled={!canControl}>
            <Icon name="ang" />
            <span>Add Ang {angNumber}</span>
          </button>
        )}
      </div>

      {loading && <p className="remote-search-status">Searching...</p>}
      {results.length > 0 && (
        <ul className="remote-queue-add-list">
          {results.map((item) => (
            <li key={`queue-add-${item.shabadId}`}>
              <button type="button" className="remote-queue-add-result" onClick={() => queueShabad(item)} disabled={!canControl}>
                <span className="gurmukhi">{item.gurmukhi}</span>
                <small>{[item.raag, item.writer, item.source].filter(Boolean).join(' · ')}</small>
                <strong>Add</strong>
              </button>
            </li>
          ))}
        </ul>
      )}

      {queueItems.length > 0 ? (
        <>
          <ol className="remote-queue-list">
            {queueItems.map((item, index) => (
              <li key={`${item.id || item.shabadId}-${item.sessionId || sessionId}-${index}`}>
                <button
                  type="button"
                  className="remote-queue-item"
                  onClick={() => onSend(COMMANDS.queueOpen, {
                    id: item.id || item.shabadId,
                    shabadId: item.shabadId,
                    kind: item.kind || 'shabad',
                    pageNo: item.pageNo,
                    source: item.source || '',
                    sessionId,
                  })}
                  disabled={!canControl}
                >
                  <span>{index + 1}</span>
                  <strong className={item.kind === 'ang' ? '' : 'gurmukhi'}>
                    {item.kind === 'ang' ? `Ang ${item.pageNo}` : item.gurmukhi || item.title || 'Queued Shabad'}
                  </strong>
                  <small>{item.kind === 'ang' ? 'Full Ang' : [item.raag, item.writer].filter(Boolean).join(' · ')}</small>
                </button>
                <button
                  type="button"
                  className="remote-queue-remove"
                  onClick={() => onSend(COMMANDS.queueRemove, {
                    id: item.id || item.shabadId,
                    shabadId: item.shabadId,
                    sessionId,
                  })}
                  disabled={!canControl}
                  aria-label="Remove queue item"
                >
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="remote-link-button remote-queue-clear"
            onClick={() => onSend(COMMANDS.queueClear, { sessionId })}
            disabled={!canControl}
          >
            Clear {sessionId === 'katha' ? 'Katha' : 'Kirtan'} queue
          </button>
        </>
      ) : (
        <p className="remote-search-status">No items in this queue.</p>
      )}
    </section>
  );
}

function RemotePairingPanel({
  code,
  name,
  session,
  connected,
  pairing,
  clientId,
  lang = 'en',
  tLang = (en) => en,
  onCodeChange,
  onNameChange,
  onJoin,
  onClaim,
  onRelease,
  onGrant,
  onForget,
}) {
  const role = session?.role || 'unpaired';
  const paired = Boolean(session?.paired);
  const isController = role === 'controller';
  const pendingRequests = Array.isArray(session?.pendingRequests)
    ? session.pendingRequests.filter((request) => request?.clientId)
    : [];
  const ownPendingRequest = pendingRequests.find((request) => request.clientId === clientId);
  const otherPendingRequests = pendingRequests.filter((request) => request.clientId !== clientId);
  const pendingRequestNames = otherPendingRequests
    .map((request) => request.name || 'Remote device')
    .slice(0, 2)
    .join(', ');
  return (
    <section className={`remote-pairing remote-pairing-${role}`} aria-label="Remote pairing">
      <div className="remote-section-head">
        <div>
          <p className="section-eyebrow" lang={lang}>{tLang('Pairing', 'ਜੋੜੀ ਬਣਾਉਣਾ')}</p>
          <h2 lang={lang}>{paired
            ? (isController
                ? tLang('Controller connected', 'ਕੰਟਰੋਲਰ ਜੁੜ ਗਿਆ')
                : tLang('View only', 'ਸਿਰਫ਼ ਦੇਖਣ ਲਈ'))
            : tLang('Enter main app code', 'ਮੁੱਖ ਐਪ ਦਾ ਕੋਡ ਦਾਖਲ ਕਰੋ')}</h2>
        </div>
        <span className={`remote-role-pill ${isController ? 'remote-role-controller' : ''}`}>
          {isController ? 'Controller' : paired ? 'Viewer' : connected ? 'Unpaired' : 'Offline'}
        </span>
      </div>

      {!paired ? (
        <form className="remote-pair-form" onSubmit={onJoin}>
          <input
            value={code}
            onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 4))}
            className="remote-code-input"
            placeholder="4 digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Remote pairing code"
          />
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            className="remote-name-input"
            placeholder="Device name"
            aria-label="Device name"
          />
          <button type="submit" className="remote-open-ang" disabled={pairing || code.length !== 4}>
            <Icon name="projector" />
            <span>{pairing ? 'Pairing...' : 'Pair Remote'}</span>
          </button>
        </form>
      ) : (
        <div className="remote-pair-status">
          <p>
            {isController
              ? 'This device can control the main app.'
              : `${session?.controllerName || 'Another device'} is controlling. This device can watch but not send commands.`}
          </p>
          {isController && otherPendingRequests.length > 0 && (
            <div className="remote-control-request" role="status">
              <Icon name="projector" />
              <span>
                {pendingRequestNames} requested control.
              </span>
              <button
                type="button"
                className="remote-control-request-btn"
                onClick={() => onGrant?.(otherPendingRequests[0].clientId)}
                disabled={pairing}
              >
                Allow
              </button>
            </div>
          )}
          {!isController && ownPendingRequest && (
            <div className="remote-control-request remote-control-request-soft" role="status">
              <Icon name="projector" />
              <span>Control request sent. The current controller can keep going safely.</span>
            </div>
          )}
          <div className="remote-pair-actions">
            {!isController && (
              <button type="button" className="remote-open-ang" onClick={onClaim} disabled={pairing}>
                <Icon name="projector" />
                <span>{pairing ? 'Checking...' : 'Take Control'}</span>
              </button>
            )}
            {isController && (
              <button type="button" className="remote-open-ang" onClick={onRelease} disabled={pairing}>
                <Icon name="projector" />
                <span>Release Control</span>
              </button>
            )}
            <button type="button" className="remote-link-button" onClick={onForget}>
              Pair another code
            </button>
          </div>
          <small>
            {session?.viewerCount || 0} viewer{Number(session?.viewerCount || 0) === 1 ? '' : 's'}
            {session?.controllerName ? ` · Controller: ${session.controllerName}` : ''}
          </small>
        </div>
      )}
    </section>
  );
}

function friendlyRemoteError(err, fallback = 'Could not complete that remote action.') {
  const status = err?.response?.status;
  const serverMsg = String(err?.response?.data?.error || '').trim();
  const message = String(err?.message || '').trim();

  if (status === 400 && /unsupported/i.test(serverMsg)) {
    return 'That remote action is not available yet. Restart the backend dev server, then refresh this remote page.';
  }
  if (status === 403 && /wrong remote code/i.test(serverMsg)) {
    return 'Wrong remote code. Check the code on the main app and try again.';
  }
  if (status === 403 && /not paired|expired/i.test(serverMsg)) {
    return 'Remote pairing expired. Enter the current code from the main app again.';
  }
  if (status === 423 || status === 409) {
    return serverMsg || 'Another device is controlling this session. Take control before sending commands.';
  }
  if (status >= 500) {
    if (/connection to backend lost|reconnecting/i.test(serverMsg)) return serverMsg;
    return 'Backend had a problem. Check that the backend dev server is running, then try again.';
  }
  if (err?.code === 'ERR_NETWORK' || /network|econnrefused|econnreset|failed to fetch/i.test(message)) {
    return 'Connection to backend lost. Check the laptop/server and Wi-Fi, then try again.';
  }
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(message)) {
    return 'Backend took too long to respond. Try again in a moment.';
  }
  if (serverMsg && !/^HTTP\s+\d+/i.test(serverMsg)) return serverMsg;
  return fallback;
}

export default function RemoteControlPage() {
  const { lang, tLang } = useApp();
  const [state, setState] = useState(null);
  const [lastSent, setLastSent] = useState('');
  const [error, setError] = useState('');
  // Auto-clear timer for the transient "last sent" status line.
  const lastSentTimerRef = useRef(null);
  const flashLastSent = useCallback((text, ms) => {
    setLastSent(text);
    if (lastSentTimerRef.current) clearTimeout(lastSentTimerRef.current);
    lastSentTimerRef.current = setTimeout(() => { setLastSent(''); lastSentTimerRef.current = null; }, ms);
  }, []);
  useEffect(() => () => { if (lastSentTimerRef.current) clearTimeout(lastSentTimerRef.current); }, []);
  const [remoteSearchMode, setRemoteSearchMode] = useState('kirtan');
  const [remoteOpenAs, setRemoteOpenAs] = useState('shabad');
  const [clientId] = useState(() => {
    const existing = storedValue(REMOTE_CLIENT_KEY);
    if (existing) return existing;
    const next = randomClientId();
    rememberValue(REMOTE_CLIENT_KEY, next);
    return next;
  });
  const [pairCode, setPairCode] = useState(() => codeFromUrl() || storedValue(REMOTE_CODE_KEY));
  const [clientName, setClientName] = useState(() =>
    storedValue(REMOTE_NAME_KEY, defaultRemoteName())
  );
  const [remoteSession, setRemoteSession] = useState(null);
  const [pairing, setPairing] = useState(false);
  const searchModeTouchedRef = useRef(false);
  // Mirror pairCode through a ref so the state-poll loop (which mounts once)
  // can read the latest value without restarting on every keystroke.
  const pairCodeRef = useRef(pairCode);
  useEffect(() => { pairCodeRef.current = pairCode; }, [pairCode]);

  const supportedCommands = useMemo(() => {
    if (Array.isArray(state?.supportedCommands)) return new Set(state.supportedCommands);
    return LEGACY_COMMANDS;
  }, [state?.supportedCommands]);

  const isAngContext = state?.viewerKind === 'ang';
  const isShabadContext = state?.viewerKind === 'shabad';
  const micOn = Boolean(state?.micListening);
  const canControl = remoteSession?.role === 'controller';
  const lineLabel = useMemo(() => {
    const index = Number(state?.activeLineIndex ?? -1);
    const total = Number(state?.activeLineTotal || 0);
    if (index < 0 || !total) return 'No line selected';
    return `Line ${index + 1} / ${total}`;
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let delay = 1000;
    const load = async () => {
      try {
        const next = await api.getRemoteState({ clientId });
        if (!cancelled) {
          setState(next);
          // If the user just clicked "Pair another code" (local pairCode is
          // empty), don't let the polled session overwrite us back into a
          // paired UI. The backend may still hold the binding for a moment
          // before /leave lands.
          if (next?.remoteSession && pairCodeRef.current && pairCodeRef.current.length === 4) {
            setRemoteSession(next.remoteSession);
          } else if (!pairCodeRef.current) {
            setRemoteSession(null);
          }
          setError((prev) => prev === 'Connection to backend lost. Reconnecting...' ? '' : prev);
          delay = 1000;
        }
      } catch (err) {
        if (!cancelled) {
          setError('Connection to backend lost. Reconnecting...');
          delay = Math.min(5000, Math.round(delay * 1.6));
        }
      } finally {
        if (!cancelled) timer = setTimeout(load, delay);
      }
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [clientId]);

  useEffect(() => {
    if (searchModeTouchedRef.current || !state?.connected) return;
    const inferredKatha = String(state?.viewerMode || '').startsWith('katha') || state?.viewerKind === 'ang';
    setRemoteSearchMode(inferredKatha ? 'katha' : 'kirtan');
    setRemoteOpenAs(state?.viewerKind === 'ang' ? 'ang' : 'shabad');
  }, [state?.connected, state?.viewerKind, state?.viewerMode]);

  const remoteAuth = useMemo(() => ({
    clientId,
    code: pairCode,
    name: clientName,
  }), [clientId, clientName, pairCode]);
  useEffect(() => {
    if (!remoteSession?.paired || pairCode.length !== 4) return undefined;
    let cancelled = false;
    let timer = null;
    const beat = async () => {
      try {
        const result = await api.heartbeatRemoteSession(remoteAuth);
        if (!cancelled && result?.session) setRemoteSession(result.session);
      } catch (err) {
        if (!cancelled) {
          setRemoteSession(null);
          setError(friendlyRemoteError(err, 'Remote session expired. Pair again.'));
          forgetValue(REMOTE_CODE_KEY);
        }
      } finally {
        if (!cancelled) timer = setTimeout(beat, 5000);
      }
    };
    timer = setTimeout(beat, 5000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pairCode.length, remoteAuth, remoteSession?.paired]);
  const joinRemote = useCallback(async (event) => {
    event?.preventDefault?.();
    if (pairCode.length !== 4) {
      setError('Enter the 4 digit code shown in the main app header.');
      return false;
    }
    setPairing(true);
    setError('');
    try {
      rememberValue(REMOTE_CODE_KEY, pairCode);
      rememberValue(REMOTE_NAME_KEY, clientName || 'Remote device');
      const result = await api.joinRemoteSession(remoteAuth);
      setRemoteSession(result?.session || null);
      return true;
    } catch (err) {
      forgetValue(REMOTE_CODE_KEY);
      setPairCode('');
      setError(friendlyRemoteError(err, 'Could not pair remote.'));
      return false;
    } finally {
      setPairing(false);
    }
  }, [clientName, pairCode, remoteAuth]);
  useEffect(() => {
    if (remoteSession?.paired || pairCode.length !== 4) return;
    const timer = setTimeout(() => {
      joinRemote();
    }, 300);
    return () => clearTimeout(timer);
  }, [joinRemote, pairCode.length, remoteSession?.paired]);

  const changeRemoteSearchMode = useCallback((nextMode) => {
    searchModeTouchedRef.current = true;
    const mode = nextMode === 'katha' ? 'katha' : 'kirtan';
    setRemoteSearchMode(mode);
    if (mode === 'kirtan') setRemoteOpenAs('shabad');
  }, []);

  const changeRemoteOpenAs = useCallback((nextOpenAs) => {
    searchModeTouchedRef.current = true;
    setRemoteOpenAs(nextOpenAs === 'ang' ? 'ang' : 'shabad');
  }, []);




  const claimControl = useCallback(async () => {
    setPairing(true);
    setError('');
    try {
      const result = await api.claimRemoteControl(remoteAuth);
      setRemoteSession(result?.session || null);
      return true;
    } catch (err) {
      setError(friendlyRemoteError(err, 'Could not take control.'));
      if (err?.response?.data?.session) setRemoteSession(err.response.data.session);
      return false;
    } finally {
      setPairing(false);
    }
  }, [remoteAuth]);

  const releaseControl = useCallback(async () => {
    setPairing(true);
    setError('');
    try {
      const result = await api.releaseRemoteControl(remoteAuth);
      setRemoteSession(result?.session || null);
      return true;
    } catch (err) {
      setError(friendlyRemoteError(err, 'Could not release control.'));
      return false;
    } finally {
      setPairing(false);
    }
  }, [remoteAuth]);

  const grantControl = useCallback(async (targetClientId) => {
    if (!targetClientId) return false;
    setPairing(true);
    setError('');
    try {
      const result = await api.grantRemoteControl({
        ...remoteAuth,
        targetClientId,
      });
      setRemoteSession(result?.session || null);
      flashLastSent(`Control given to ${result?.grantedTo?.name || 'remote device'}`, 1600);
      return true;
    } catch (err) {
      setError(friendlyRemoteError(err, 'Could not approve control.'));
      if (err?.response?.data?.session) setRemoteSession(err.response.data.session);
      return false;
    } finally {
      setPairing(false);
    }
  }, [remoteAuth]);

  const forgetPairing = useCallback(() => {
    // Tell the backend to drop our binding so the next /state poll really
    // returns "unpaired" — otherwise the binding lives in clientToHost and
    // the polling loop would immediately re-paint us as paired.
    if (clientId && api.leaveRemoteSession) {
      api.leaveRemoteSession({ clientId }).catch(() => { /* best-effort */ });
    }
    forgetValue(REMOTE_CODE_KEY);
    setRemoteSession(null);
    setPairCode('');
    setLastSent('');
    setError('');
  }, [clientId]);

  const commandAvailable = useCallback((command) => supportedCommands.has(command), [supportedCommands]);

  const reportError = useCallback((err, fallback = 'Could not send command') => {
    setError(friendlyRemoteError(err, fallback));
  }, []);

  const sendCommand = useCallback(async (command, payload = {}) => {
    if (!command) return false;
    if (!canControl) {
      setError(remoteSession?.paired
        ? 'This remote is view only. Take control before sending commands.'
        : 'Pair this remote with the main app before sending commands.');
      return false;
    }
    if (!commandAvailable(command)) {
      const label = COMMAND_LABELS[command] || command;
      setError(`${label} needs the updated backend remote commands. Restart the backend dev server, then refresh this page.`);
      return false;
    }
    setError('');
    const label = COMMAND_LABELS[command] || command;
    try {
      const result = await api.sendRemoteCommand(command, payload, remoteAuth);
      if (result?.session) setRemoteSession(result.session);
      flashLastSent(label, 1200);
      return true;
    } catch (err) {
      if (err?.response?.data?.session) setRemoteSession(err.response.data.session);
      reportError(err);
      return false;
    }
  }, [canControl, commandAvailable, remoteAuth, remoteSession?.paired, reportError]);

  const openShabad = useCallback(async (item, options = {}) => {
    if (!item?.shabadId) return false;
    return sendCommand(COMMANDS.openShabad, {
      shabadId: item.shabadId,
      isKatha: Boolean(options.isKatha),
    });
  }, [sendCommand]);

  const openAng = useCallback(async (ang, options = {}) => {
    return sendCommand(COMMANDS.openAng, {
      ang,
      isKatha: options.isKatha !== false,
      seedShabadId: options.seedShabadId || '',
    });
  }, [sendCommand]);

  const jumpToLine = useCallback(async (index) => {
    const target = Number(index);
    if (!Number.isFinite(target)) return;
    if (commandAvailable(COMMANDS.lineSelect)) {
      await sendCommand(COMMANDS.lineSelect, { index: target });
      return;
    }

    const current = Number(state?.activeLineIndex ?? -1);
    if (!Number.isFinite(current) || current < 0) {
      setError('Line tap needs the updated backend remote commands. Restart the backend dev server, then refresh this page.');
      return;
    }
    const diff = Math.floor(target) - Math.floor(current);
    if (diff === 0) return;
    const stepCommand = diff > 0 ? COMMANDS.lineNext : COMMANDS.linePrev;
    if (!commandAvailable(stepCommand)) {
      setError('Line navigation is not available from this remote connection.');
      return;
    }
    const count = Math.min(120, Math.abs(diff));
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await sendCommand(stepCommand);
      if (!ok) break;
    }
  }, [commandAvailable, sendCommand, state?.activeLineIndex]);

  return (
    <div className="app-container remote-page">
      <section className="remote-hero">
        <div>
          <p className="section-eyebrow" lang={lang}>{tLang('Live Controller', 'ਲਾਈਵ ਕੰਟਰੋਲਰ')}</p>
          <h1 lang={lang}>{tLang('Remote', 'ਰਿਮੋਟ')}</h1>
        </div>
        {(() => {
          // Three distinct connection states the user actually cares about:
          //  - Connected: backend reachable + the host we're paired to is
          //    publishing fresh state.
          //  - Waiting for main app: backend reachable, but the paired host
          //    hasn't published in a few seconds (host laptop idle/closed).
          //  - Backend unreachable: the request to /state itself failed.
          //    We tag this through the error state set by the poll loop.
          const networkDown = error === 'Connection to backend lost. Reconnecting...';
          const ok = !!state?.connected;
          const cls = `remote-connection ${ok ? 'remote-connection-on' : ''}${networkDown ? ' remote-connection-down' : ''}`;
          const title = networkDown
            ? 'Reconnecting…'
            : ok
              ? 'Connected'
              : (remoteSession?.paired ? 'Waiting for main app' : 'Not paired');
          const sub = networkDown
            ? 'Backend unreachable'
            : ok
              ? (canControl ? 'Controller' : remoteSession?.paired ? 'View only' : 'Main app')
              : (remoteSession?.paired
                  ? 'Main app idle — open it on the laptop'
                  : 'Enter the 4-digit code below');
          return (
            <span className={cls}>
              <strong>{title}</strong>
              <small>{sub}</small>
            </span>
          );
        })()}
      </section>

      <RemotePairingPanel
        code={pairCode}
        name={clientName}
        session={remoteSession || state?.remoteSession}
        connected={Boolean(state?.connected)}
        pairing={pairing}
        clientId={clientId}
        lang={lang}
        tLang={tLang}
        onCodeChange={setPairCode}
        onNameChange={(value) => {
          setClientName(value);
          rememberValue(REMOTE_NAME_KEY, value);
        }}
        onJoin={joinRemote}
        onClaim={claimControl}
        onRelease={releaseControl}
        onGrant={grantControl}
        onForget={forgetPairing}
      />

      <RemoteSearch
        experience={remoteSearchMode}
        openAs={remoteOpenAs}
        canControl={canControl}
        onExperienceChange={changeRemoteSearchMode}
        onOpenAsChange={changeRemoteOpenAs}
        onOpenShabad={openShabad}
        onOpenAng={openAng}
        onError={reportError}
      />

      <RemoteQueuePanel
        state={state}
        canControl={canControl}
        defaultSession={remoteSearchMode}
        onSend={sendCommand}
      />

      <section className="remote-now">
        <div className="remote-section-head">
          <div>
            <p className="section-eyebrow">Current Content</p>
            <h2 className="gurmukhi">{state?.selectedTitle || 'No Shabad or Ang selected'}</h2>
          </div>
          <span className="remote-mode-pill">
            {isAngContext ? 'Ang' : isShabadContext ? 'Shabad' : state?.viewerKind || 'Idle'}
          </span>
        </div>
        {state?.selectedMeta && <p>{state.selectedMeta}</p>}
        <div className="remote-line-card">
          <span>{lineLabel}</span>
          <strong className="gurmukhi">{state?.activeLineText || 'Projector is idle'}</strong>
        </div>

        {state?.canUndoOpen && (
          <RemoteButton
            command={COMMANDS.undoOpen}
            icon="undo"
            className="remote-btn-wide remote-undo-open"
            disabled={!canControl}
            onSend={sendCommand}
          >
            Go Back{state?.undoOpenLabel ? `: ${state.undoOpenLabel}` : ''}
          </RemoteButton>
        )}

        {Array.isArray(state?.surroundingLines) && state.surroundingLines.length > 0 && (
          <ol className="remote-pankti-list" aria-label="Shown panktis">
            {state.surroundingLines.map((line) => {
              const active = Number(line.index) === Number(state?.activeLineIndex ?? -1);
              return (
                <li
                  key={line.index}
                  className={`remote-pankti${active ? ' remote-pankti-active' : ''}`}
                >
                  <button
                    type="button"
                    className="remote-pankti-button"
                    onClick={() => jumpToLine(line.index)}
                    disabled={!canControl}
                    aria-current={active ? 'true' : undefined}
                  >
                    <span className="remote-pankti-num">{Number(line.index) + 1}</span>
                    <span className="remote-pankti-text gurmukhi">{line.gurmukhi}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        {state?.canLoadMore && (
          <RemoteButton
            command={COMMANDS.loadMore}
            icon="more"
            className="remote-btn-wide remote-load-more"
            disabled={!canControl}
            onSend={sendCommand}
          >
            Load More Lines
          </RemoteButton>
        )}
      </section>

      <section className="remote-control-card" aria-label="Remote controls">
        <div className="remote-section-head">
          <div>
            <p className="section-eyebrow">Mic</p>
            <h2>Listening control</h2>
          </div>
          <span className={`remote-mic-pill ${micOn ? 'remote-mic-pill-on' : ''}`}>
            {micOn ? 'Mic On' : 'Mic Off'}
          </span>
        </div>

        <div className="remote-mic-grid">
          <RemoteButton
            command={COMMANDS.micStart}
            icon="mic"
            className="remote-btn-primary"
            disabled={!canControl || micOn}
            onSend={sendCommand}
          >
            Start Mic
          </RemoteButton>
          <RemoteButton
            command={COMMANDS.micStop}
            icon="micOff"
            className="remote-btn-danger"
            disabled={!canControl || !micOn}
            onSend={sendCommand}
          >
            Stop Mic
          </RemoteButton>
        </div>

        <div className="remote-divider" />

        <p className="section-eyebrow">Line Navigation</p>
        <div className="remote-pad remote-pad-inside" aria-label="Line navigation">
          <RemoteButton command={COMMANDS.lineFirst} icon="first" disabled={!canControl} onSend={sendCommand}>First Line</RemoteButton>
          <RemoteButton command={COMMANDS.linePrev} icon="left" disabled={!canControl} onSend={sendCommand}>Previous Line</RemoteButton>
          <RemoteButton command={COMMANDS.lineNext} icon="right" className="remote-btn-primary" disabled={!canControl} onSend={sendCommand}>Next Line</RemoteButton>
          <RemoteButton command={COMMANDS.lineLast} icon="last" disabled={!canControl} onSend={sendCommand}>Last Line</RemoteButton>
        </div>

        <div className="remote-divider" />

        <p className="section-eyebrow">Shabad / Ang Navigation</p>
        <div className="remote-context-grid">
          <RemoteButton
            command={COMMANDS.shabadPrev}
            icon="prev"
            disabled={!canControl || !isShabadContext || !state?.hasPreviousShabad}
            onSend={sendCommand}
          >
            Previous Shabad
          </RemoteButton>
          <RemoteButton
            command={COMMANDS.shabadNext}
            icon="next"
            className={isShabadContext ? 'remote-btn-primary' : ''}
            disabled={!canControl || !isShabadContext || !state?.hasNextShabad}
            onSend={sendCommand}
          >
            Next Shabad
          </RemoteButton>
          <RemoteButton
            command={COMMANDS.angPrev}
            icon="prev"
            disabled={!canControl || !isAngContext || !state?.hasPreviousAng}
            onSend={sendCommand}
          >
            Previous Ang
          </RemoteButton>
          <RemoteButton
            command={COMMANDS.angNext}
            icon="next"
            className={isAngContext ? 'remote-btn-primary' : ''}
            disabled={!canControl || !isAngContext || !state?.hasNextAng}
            onSend={sendCommand}
          >
            Next Ang
          </RemoteButton>
        </div>

        <div className="remote-divider" />

        <div className="remote-section-head remote-section-head-compact">
          <div>
            <p className="section-eyebrow">Projector</p>
            <h2>Mode and display</h2>
          </div>
          <span className="remote-mode-pill">{state?.projectorMode || 'Idle'}</span>
        </div>

        <div className="remote-projector-grid">
          <RemoteButton command={COMMANDS.shabad} icon="book" className="remote-btn-soft" disabled={!canControl} onSend={sendCommand}>Shabad</RemoteButton>
          <RemoteButton command={COMMANDS.waheguru} icon="projector" className="remote-btn-soft" disabled={!canControl} onSend={sendCommand}>Waheguru</RemoteButton>
          <RemoteButton command={COMMANDS.blank} icon="projector" className="remote-btn-soft" disabled={!canControl} onSend={sendCommand}>Blank</RemoteButton>
          <RemoteButton command={COMMANDS.mool} icon="book" className="remote-btn-soft" disabled={!canControl} onSend={sendCommand}>Mool Mantar</RemoteButton>
        </div>

        <div className="remote-tool-row">
          <div>
            <p className="section-eyebrow">Font Size</p>
            <div className="remote-extras-pair">
              <RemoteButton command={COMMANDS.fontDown} icon="type" disabled={!canControl} onSend={sendCommand}>Smaller</RemoteButton>
              <RemoteButton command={COMMANDS.fontUp} icon="type" disabled={!canControl} onSend={sendCommand}>Larger</RemoteButton>
            </div>
          </div>
          <div>
            <p className="section-eyebrow">Look</p>
            <div className="remote-look-grid">
              <RemoteButton command={COMMANDS.presetWarm} icon="palette" disabled={!canControl} onSend={sendCommand}>Warm</RemoteButton>
              <RemoteButton command={COMMANDS.presetContrast} icon="palette" disabled={!canControl} onSend={sendCommand}>Contrast</RemoteButton>
              <RemoteButton command={COMMANDS.presetSimple} icon="palette" disabled={!canControl} onSend={sendCommand}>Simple</RemoteButton>
            </div>
          </div>
        </div>
      </section>

      <footer
        className={`remote-status ${error ? 'remote-status-error' : ''}`}
        aria-live="polite"
      >
        {error || (lastSent
          ? `Sent - ${lastSent}`
          : canControl
            ? 'Controller connected'
            : remoteSession?.paired
              ? 'View only · take control to send commands'
              : 'Pair with the main app to control live view')}
      </footer>
    </div>
  );
}
