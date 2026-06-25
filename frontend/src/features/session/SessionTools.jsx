import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { QUEUE_SESSIONS, useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { displayLineForEntry, getMainVerse, trimToWords } from '../../utils/gurmukhi';
import './SessionTools.css';

const GURMUKHI_RE = /[\u0a00-\u0a7f]/;

const ClearIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M3 4h10M6 4V2.8h4V4M5 6v7M8 6v7M11 6v7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M4.5 4.5 5 15h6l.5-10.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const PreloadIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M3 10.5a4.5 4.5 0 0 1 8.8-1.4A2.6 2.6 0 1 1 12.4 14H5.2A3.2 3.2 0 0 1 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 5.5v5M5.8 8.2 8 10.5l2.2-2.3" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DragHandleIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <path d="M5 4h.01M5 8h.01M5 12h.01M11 4h.01M11 8h.01M11 12h.01" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

function itemText(item) {
  return [
    displayLineForEntry(item),
    item?.firstGurmukhi,
    item?.raag,
    item?.writer,
    item?.source,
    item?.pageNo ? `ang ${item.pageNo}` : '',
  ].filter(Boolean).join(' ').toLowerCase();
}

function titleFor(item) {
  if (item?.kind === 'ang') return item.title || `Ang ${item.pageNo}`;
  return trimToWords(displayLineForEntry(item) || item?.shabadId || 'Shabad', 8);
}

function metaFor(item) {
  return [item.raag, item.writer, item.pageNo ? `Ang ${item.pageNo}` : '']
    .filter(Boolean)
    .join(' - ') || 'Open Shabad';
}

function sessionLabel(sessionId) {
  return QUEUE_SESSIONS.find((session) => session.id === sessionId)?.label || QUEUE_SESSIONS[0].label;
}

function searchTypeFor(mode, query) {
  const q = String(query || '').trim();
  if (mode === 'ang' || /^[0-9]+$/.test(q)) return 5;
  if (mode === 'initials') return 0;
  if (mode === 'words') return GURMUKHI_RE.test(q) ? 2 : 4;
  return undefined;
}

function uniqueShabadResults(results) {
  const seen = new Set();
  const out = [];
  for (const item of results || []) {
    if (!item?.shabadId) continue;
    const key = String(item.shabadId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function baseQueueEntry(item, queueSessionId) {
  return {
    shabadId: item?.shabadId,
    gurmukhi: item?.mainGurmukhi || item?.displayGurmukhi || item?.gurmukhi || '',
    mainGurmukhi: item?.mainGurmukhi || '',
    firstGurmukhi: item?.firstGurmukhi || item?.gurmukhi || '',
    raag: item?.raag || '',
    writer: item?.writer || '',
    source: item?.source || '',
    pageNo: item?.pageNo || null,
    queueSessionId,
  };
}

async function enrichedQueueEntry(item, queueSessionId) {
  const fallback = baseQueueEntry(item, queueSessionId);
  if (!item?.shabadId) return fallback;
  try {
    const data = await api.getShabad(item.shabadId);
    const mainVerse = getMainVerse(data?.verses, data?.meta);
    const firstVerse = data?.verses?.[0] || null;
    return {
      ...fallback,
      shabadId: data?.meta?.shabadId || item.shabadId,
      gurmukhi: mainVerse?.gurmukhi || firstVerse?.gurmukhi || fallback.gurmukhi,
      mainGurmukhi: mainVerse?.gurmukhi || '',
      firstGurmukhi: firstVerse?.gurmukhi || fallback.firstGurmukhi,
      raag: data?.meta?.raag || fallback.raag,
      writer: data?.meta?.writer || fallback.writer,
      source: data?.meta?.source || fallback.source,
      pageNo: data?.meta?.pageNo || fallback.pageNo,
      queueSessionId,
    };
  } catch {
    return fallback;
  }
}

export default function SessionTools({ isKatha = false, openAs = 'shabad', onOpen }) {
  const {
    shabadQueue,
    removeFromQueue,
    clearQueue,
    moveQueueItem,
    reorderQueueItem,
    updateQueueItemSession,
    addToQueue,
    preloadQueueSession,
    queuePreloadStatus,
    pushToast,
    selectedShabad,
    shabadHistory,
    shabadFavourites,
    removeShabadHistory,
    removeShabadFavourite,
  } = useApp();
  const [activeQueueSession, setActiveQueueSession] = useState(isKatha ? 'katha' : 'kirtan');
  const [historyTab, setHistoryTab] = useState('kirtan');
  const [historyQuery, setHistoryQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState('auto');
  const [dialogQuery, setDialogQuery] = useState('');
  const [dialogResults, setDialogResults] = useState([]);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [draggingShabadId, setDraggingShabadId] = useState('');
  const [dragOverShabadId, setDragOverShabadId] = useState('');

  const targetFor = (item) => {
    if (!item?.shabadId) return '/kirtan';
    const shouldOpenAng = item.kind === 'ang' || (isKatha && openAs === 'ang' && item.pageNo);
    if (shouldOpenAng && item.pageNo) {
      const qs = new URLSearchParams({ katha: '1' });
      if (item.source) qs.set('source', item.source);
      return `/ang/${encodeURIComponent(item.pageNo)}?${qs.toString()}`;
    }
    const qs = isKatha ? '?katha=1' : '';
    return `/shabad/${encodeURIComponent(item.shabadId)}${qs}`;
  };

  const queueItems = useMemo(() => {
    const items = Array.isArray(shabadQueue) ? shabadQueue : [];
    return items.filter((item) => (item.queueSessionId || item.sessionId || 'kirtan') === activeQueueSession);
  }, [activeQueueSession, shabadQueue]);
  const currentSelectedId = selectedShabad?.meta?.shabadId ? String(selectedShabad.meta.shabadId) : '';
  const currentQueueIndex = useMemo(() => {
    if (!currentSelectedId) return -1;
    return queueItems.findIndex((item) => String(item?.shabadId) === currentSelectedId);
  }, [currentSelectedId, queueItems]);
  const nextQueueIndex = currentQueueIndex >= 0 && currentQueueIndex < queueItems.length - 1
    ? currentQueueIndex + 1
    : -1;

  const queueCounts = useMemo(() => {
    const items = Array.isArray(shabadQueue) ? shabadQueue : [];
    return QUEUE_SESSIONS.reduce((acc, session) => {
      acc[session.id] = items.filter((item) => (item.queueSessionId || item.sessionId || 'kirtan') === session.id).length;
      return acc;
    }, {});
  }, [shabadQueue]);

  const historyPools = useMemo(() => ({
    kirtan: (shabadHistory || []).filter((item) => (item.mode || 'kirtan') !== 'katha' && item.kind !== 'ang'),
    katha: (shabadHistory || []).filter((item) => item.mode === 'katha' && item.kind !== 'ang'),
    angs: (shabadHistory || []).filter((item) => item.kind === 'ang'),
    favourites: shabadFavourites || [],
  }), [shabadHistory, shabadFavourites]);

  const visibleHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    const list = historyPools[historyTab] || [];
    if (!q) return list.slice(0, 8);
    return list.filter((item) => itemText(item).includes(q)).slice(0, 12);
  }, [historyPools, historyQuery, historyTab]);

  const openDialog = () => {
    setDialogOpen(true);
    setDialogError('');
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setDialogError('');
  };

  const runDialogSearch = async (event) => {
    event?.preventDefault?.();
    const q = dialogQuery.trim();
    const isAng = dialogMode === 'ang' || /^[0-9]+$/.test(q);
    if (!q || (!isAng && q.length < 2)) {
      setDialogResults([]);
      setDialogError(isAng ? 'Enter an Ang number.' : 'Type at least 2 characters.');
      return;
    }
    setDialogLoading(true);
    setDialogError('');
    try {
      const res = await api.searchShabads({
        q,
        searchType: searchTypeFor(dialogMode, q),
      });
      setDialogResults(uniqueShabadResults(res?.results || []));
    } catch (err) {
      setDialogError(err?.response?.data?.error || err.message || 'Search failed.');
    } finally {
      setDialogLoading(false);
    }
  };

  const addDialogResult = async (item) => {
    const entry = await enrichedQueueEntry(item, activeQueueSession);
    addToQueue?.(entry);
    pushToast?.({
      kind: 'success',
      title: `Added to ${sessionLabel(activeQueueSession)}`,
      message: 'This Shabad is ready in your queue.',
      timeoutMs: 2200,
    });
  };

  const preloadActiveQueue = async () => {
    const summary = await preloadQueueSession?.(activeQueueSession);
    const loaded = Number(summary?.loaded || 0);
    const failed = Number(summary?.failed || 0);
    const total = Number(summary?.total || 0);
    pushToast?.({
      kind: failed ? 'info' : 'success',
      title: failed ? 'Session partly preloaded' : 'Session preloaded',
      message: failed
        ? `${loaded} of ${total} Shabads are ready. ${failed} could not be loaded now.`
        : `${loaded} Shabad${loaded === 1 ? '' : 's'} ready for smoother opening.`,
      timeoutMs: 3200,
    });
  };

  const removeHistoryItem = (item) => {
    if (historyTab === 'favourites') removeShabadFavourite?.(item.shabadId);
    else removeShabadHistory?.(item.historyId || item.shabadId);
  };

  const startQueueDrag = (event, item) => {
    if (!item?.shabadId || queueItems.length < 2) return;
    const id = String(item.shabadId);
    setDraggingShabadId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const overQueueItem = (event, item) => {
    if (!draggingShabadId || !item?.shabadId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverShabadId(String(item.shabadId));
  };

  const dropQueueItem = (event, targetIndex) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData('text/plain') || draggingShabadId;
    if (draggedId) reorderQueueItem?.(draggedId, activeQueueSession, targetIndex);
    setDraggingShabadId('');
    setDragOverShabadId('');
  };

  const endQueueDrag = () => {
    setDraggingShabadId('');
    setDragOverShabadId('');
  };

  return (
    <div className="session-tools">
      <section className="session-panel" aria-label="Shabad queue">
        <header className="session-panel-head">
          <div>
            <p className="section-eyebrow">Queue timeline</p>
            <h3>{sessionLabel(activeQueueSession)}</h3>
          </div>
          <div className="session-panel-actions">
            <button type="button" className="btn-ghost session-add" onClick={openDialog}>
              <PlusIcon />
              Add
            </button>
            {queueItems.length > 0 && (
              <button
                type="button"
                className="btn-ghost session-preload"
                onClick={preloadActiveQueue}
                disabled={queuePreloadStatus?.active && queuePreloadStatus?.sessionId === activeQueueSession}
                title="Preload this queue for faster/offline fallback opening"
              >
                <PreloadIcon />
                {queuePreloadStatus?.active && queuePreloadStatus?.sessionId === activeQueueSession
                  ? `${queuePreloadStatus.loaded}/${queuePreloadStatus.total}`
                  : 'Preload'}
              </button>
            )}
            {queueItems.length > 0 && (
              <button type="button" className="btn-ghost session-clear" onClick={() => clearQueue?.(activeQueueSession)}>
                <ClearIcon />
                Clear
              </button>
            )}
          </div>
        </header>

        <div className="session-tabs session-queue-tabs" role="tablist" aria-label="Queue session">
          {QUEUE_SESSIONS.map((session) => (
            <button
              key={session.id}
              type="button"
              role="tab"
              aria-selected={activeQueueSession === session.id}
              className={activeQueueSession === session.id ? 'session-tab session-tab-on' : 'session-tab'}
              onClick={() => setActiveQueueSession(session.id)}
            >
              {session.label.replace(' session', '')}
              <span className="session-tab-count">{queueCounts[session.id] || 0}</span>
            </button>
          ))}
        </div>

        {!queueItems.length ? (
          <p className="session-empty">Add Shabads from search results or press Add to build this session.</p>
        ) : (
          <>
            <div className="session-timeline-summary" aria-live="polite">
              <span>{queueItems.length} item{queueItems.length === 1 ? '' : 's'} in running order</span>
              {currentQueueIndex >= 0 && (
                <span>Now: {currentQueueIndex + 1}{nextQueueIndex >= 0 ? `, next: ${nextQueueIndex + 1}` : ''}</span>
              )}
            </div>
            <ol className="session-list session-queue-list session-timeline-list">
              {queueItems.map((item, index) => {
                const isCurrent = currentQueueIndex === index;
                const isNext = nextQueueIndex === index;
                const itemId = String(item.shabadId);
                const isDragging = draggingShabadId === itemId;
                const isDragTarget = dragOverShabadId === itemId && draggingShabadId !== itemId;
                return (
              <li
                key={`${item.shabadId}-${item.queueSessionId || item.sessionId}-${item.addedAt || index}`}
                className={[
                  isCurrent ? 'session-queue-current' : '',
                  isNext ? 'session-queue-next' : '',
                  isDragging ? 'session-queue-dragging' : '',
                  isDragTarget ? 'session-queue-drop-target' : '',
                ].filter(Boolean).join(' ')}
                draggable={queueItems.length > 1}
                onDragStart={(event) => startQueueDrag(event, item)}
                onDragOver={(event) => overQueueItem(event, item)}
                onDrop={(event) => dropQueueItem(event, index)}
                onDragEnd={endQueueDrag}
              >
                <span className="session-num">
                  <span className="session-timeline-dot">{index + 1}</span>
                </span>
                <Link className="session-link" to={targetFor(item)} onClick={onOpen}>
                  <span className="session-title-row">
                    <span className="session-title gurmukhi">{titleFor(item)}</span>
                    {isCurrent && <span className="session-status session-status-now">Now</span>}
                    {isNext && <span className="session-status">Next</span>}
                  </span>
                  <span className="session-meta">{metaFor(item)}</span>
                </Link>
                <div className="session-row-actions">
                  <span className="session-drag-handle" title="Drag to reorder">
                    <DragHandleIcon />
                  </span>
                  <select
                    className="session-group-select"
                    value={item.queueSessionId || item.sessionId || activeQueueSession}
                    onChange={(event) => updateQueueItemSession?.(item.shabadId, activeQueueSession, event.target.value)}
                    aria-label="Move to session"
                  >
                    {QUEUE_SESSIONS.map((session) => (
                      <option key={session.id} value={session.id}>{session.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => moveQueueItem?.(item.shabadId, 'up', activeQueueSession)} disabled={index === 0} aria-label="Move up">Up</button>
                  <button type="button" onClick={() => moveQueueItem?.(item.shabadId, 'down', activeQueueSession)} disabled={index === queueItems.length - 1} aria-label="Move down">Down</button>
                  <button type="button" onClick={() => removeFromQueue?.(item.shabadId, activeQueueSession)} aria-label="Remove">Remove</button>
                </div>
              </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      <section className="session-panel" aria-label="History explorer">
        <header className="session-panel-head">
          <div>
            <p className="section-eyebrow">History</p>
            <h3>Find again</h3>
          </div>
        </header>
        <div className="session-tabs" role="tablist" aria-label="History type">
          {[
            ['kirtan', 'Kirtan'],
            ['katha', 'Katha'],
            ['angs', 'Angs'],
            ['favourites', 'Saved'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={historyTab === id}
              className={historyTab === id ? 'session-tab session-tab-on' : 'session-tab'}
              onClick={() => setHistoryTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="session-search"
          value={historyQuery}
          onChange={(e) => setHistoryQuery(e.target.value)}
          placeholder="Search history"
          aria-label="Search history"
        />
        {!visibleHistory.length ? (
          <p className="session-empty">No matching items here yet.</p>
        ) : (
          <ul className="session-list">
            {visibleHistory.map((item, index) => (
              <li key={`${item.historyId || item.shabadId}-${item.openedAt || item.addedAt || index}`}>
                <Link className="session-link" to={targetFor(item)} onClick={onOpen}>
                  <span className="session-title gurmukhi">{titleFor(item)}</span>
                  <span className="session-meta">{[item.raag, item.writer, item.source, item.pageNo ? `Ang ${item.pageNo}` : ''].filter(Boolean).join(' - ') || 'Open'}</span>
                </Link>
                <button type="button" className="session-remove" onClick={() => removeHistoryItem(item)} aria-label="Remove">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialogOpen && (
        <div className="session-dialog-backdrop" role="presentation" onMouseDown={closeDialog}>
          <section
            className="session-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Add Shabad to queue"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="session-dialog-head">
              <div>
                <p className="section-eyebrow">Add to queue</p>
                <h3>{sessionLabel(activeQueueSession)}</h3>
              </div>
              <button type="button" className="session-remove" onClick={closeDialog} aria-label="Close">Close</button>
            </header>

            <div className="session-tabs session-dialog-session-tabs" role="tablist" aria-label="Add to session">
              {QUEUE_SESSIONS.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  role="tab"
                  aria-selected={activeQueueSession === session.id}
                  className={activeQueueSession === session.id ? 'session-tab session-tab-on' : 'session-tab'}
                  onClick={() => setActiveQueueSession(session.id)}
                >
                  {session.label.replace(' session', '')}
                </button>
              ))}
            </div>

            <form className="session-dialog-search" onSubmit={runDialogSearch}>
              <div className="session-tabs session-dialog-mode-tabs" role="tablist" aria-label="Search type">
                {[
                  ['auto', 'Auto'],
                  ['words', 'Words'],
                  ['initials', 'Initials'],
                  ['ang', 'Ang'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={dialogMode === id}
                    className={dialogMode === id ? 'session-tab session-tab-on' : 'session-tab'}
                    onClick={() => setDialogMode(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="session-dialog-input-row">
                <input
                  className="session-search"
                  value={dialogQuery}
                  onChange={(event) => setDialogQuery(event.target.value)}
                  placeholder={dialogMode === 'ang' ? 'Ang number' : 'Search by words or initials'}
                  inputMode={dialogMode === 'ang' ? 'numeric' : undefined}
                  autoFocus
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={dialogLoading}>
                  {dialogLoading ? 'Searching' : 'Search'}
                </button>
              </div>
            </form>

            {dialogError && <p className="session-dialog-error" role="alert">{dialogError}</p>}

            <ul className="session-dialog-results">
              {dialogResults.map((item, index) => (
                <li key={`${item.shabadId}-${item.verseId || item.lineNo || index}`}>
                  <div className="session-dialog-result-text">
                    <span className="session-title gurmukhi">{trimToWords(item.gurmukhi || item.shabadId, 10)}</span>
                    <span className="session-meta">{metaFor(item)}</span>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm session-dialog-add" onClick={() => addDialogResult(item)}>
                    <PlusIcon />
                    Add
                  </button>
                </li>
              ))}
            </ul>

            {!dialogLoading && !dialogError && dialogQuery && dialogResults.length === 0 && (
              <p className="session-empty">No queue matches yet. Try fewer words or initials.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
