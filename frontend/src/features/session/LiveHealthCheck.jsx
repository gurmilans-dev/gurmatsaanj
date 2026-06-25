import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import './LiveHealthCheck.css';

function sessionIdForPath(pathname) {
  if (String(pathname || '').startsWith('/katha')) return 'katha';
  return 'kirtan';
}

function queueSessionId(item) {
  return item?.queueSessionId || item?.sessionId || item?.mode || 'kirtan';
}

function statusRank(status) {
  if (status === 'fail') return 3;
  if (status === 'warn') return 2;
  if (status === 'checking') return 1;
  return 0;
}

function StatusDot({ status }) {
  return <span className={`live-health-dot live-health-dot-${status || 'warn'}`} aria-hidden="true" />;
}

function CheckRow({ item }) {
  return (
    <li className={`live-health-row live-health-row-${item.status}`}>
      <div className="live-health-row-main">
        <StatusDot status={item.status} />
        <div>
          <strong>{item.label}</strong>
          <p>{item.message}</p>
        </div>
      </div>
      {item.action && (
        <button type="button" className="btn-ghost live-health-row-action" onClick={item.action} disabled={item.busy}>
          {item.busy ? 'Working...' : item.actionLabel}
        </button>
      )}
    </li>
  );
}

export default function LiveHealthCheck() {
  const {
    voice,
    projectorWindowOpen,
    openProjector,
    focusProjector,
    remotePairing,
    shabadQueue,
    queuePreloadStatus,
    preloadQueueSession,
    offlinePackStatus,
    preloadOfflineSessionPack,
    pushToast,
  } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [backend, setBackend] = useState({ status: 'checking', message: 'Checking backend...' });
  const [checkingBackend, setCheckingBackend] = useState(false);
  const [preparingAll, setPreparingAll] = useState(false);

  const activeSessionId = sessionIdForPath(location.pathname);
  const sessionQueue = useMemo(() => (
    (Array.isArray(shabadQueue) ? shabadQueue : []).filter((item) => queueSessionId(item) === activeSessionId)
  ), [activeSessionId, shabadQueue]);
  const remoteClients = Array.isArray(remotePairing?.clients) ? remotePairing.clients : [];
  const remoteClientCount = remoteClients.length || Number(remotePairing?.clientCount || 0);

  const checkBackend = useCallback(async (showToast = false) => {
    setCheckingBackend(true);
    setBackend({ status: 'checking', message: 'Checking backend...' });
    try {
      const res = await api.health();
      setBackend({
        status: 'ok',
        message: res?.uptime ? `Connected. Uptime ${Math.floor(Number(res.uptime))}s.` : 'Backend connected.',
      });
      if (showToast) {
        pushToast?.({ kind: 'success', title: 'Backend connected', message: 'API health check passed.', timeoutMs: 2200 });
      }
    } catch (err) {
      setBackend({
        status: 'fail',
        message: err?.response?.data?.error || err?.message || 'Backend is not reachable.',
      });
      if (showToast) {
        pushToast?.({ kind: 'error', title: 'Backend unavailable', message: 'Check that the backend server is running.' });
      }
    } finally {
      setCheckingBackend(false);
    }
  }, [pushToast]);

  useEffect(() => {
    checkBackend(false);
    const timer = setInterval(() => checkBackend(false), 45_000);
    return () => clearInterval(timer);
  }, [checkBackend]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const queueReady = sessionQueue.length === 0 || (
    queuePreloadStatus?.sessionId === activeSessionId &&
    Number(queuePreloadStatus?.loaded || 0) >= sessionQueue.length &&
    Number(queuePreloadStatus?.failed || 0) === 0 &&
    !queuePreloadStatus?.active
  );
  const offlineReady = Boolean(offlinePackStatus?.lastRunAt) &&
    Number(offlinePackStatus?.failed || 0) === 0 &&
    !offlinePackStatus?.active;

  const prepareAll = useCallback(async () => {
    if (preparingAll) return;
    setPreparingAll(true);
    try {
      await checkBackend(false);
      if (!projectorWindowOpen) openProjector?.();
      else focusProjector?.();
      if (sessionQueue.length > 0) {
        await preloadQueueSession?.(activeSessionId);
      }
      await preloadOfflineSessionPack?.(activeSessionId);
      await checkBackend(false);
      pushToast?.({
        kind: 'success',
        title: 'Live preparation complete',
        message: 'Backend checked, projector handled, queue/offline pack prepared.',
        timeoutMs: 3200,
      });
    } catch (err) {
      pushToast?.({
        kind: 'error',
        title: 'Prepare all stopped',
        message: err?.response?.data?.error || err?.message || 'One preparation step failed. Review Live Readiness.',
      });
    } finally {
      setPreparingAll(false);
    }
  }, [
    activeSessionId,
    checkBackend,
    focusProjector,
    openProjector,
    preloadOfflineSessionPack,
    preloadQueueSession,
    preparingAll,
    projectorWindowOpen,
    pushToast,
    sessionQueue.length,
  ]);

  const openSetup = useCallback(() => {
    setOpen(false);
    navigate('/setup');
  }, [navigate]);

  const items = useMemo(() => {
    const micOk = Boolean(voice?.isSupported) && !voice?.error;
    const remoteHostOk = Boolean(remotePairing?.hostConnected || remotePairing?.code);

    return [
      {
        id: 'backend',
        label: 'Backend',
        status: backend.status,
        message: backend.message,
        actionLabel: 'Check again',
        action: () => checkBackend(true),
        busy: checkingBackend,
      },
      {
        id: 'mic',
        label: 'Mic',
        status: micOk ? 'ok' : 'fail',
        message: voice?.isSupported
          ? voice?.error
            ? `Mic error: ${voice.error}`
            : voice?.isListening
              ? 'Listening now.'
              : 'Speech recognition is available.'
          : 'Speech recognition is not supported in this browser.',
      },
      {
        id: 'projector',
        label: 'Projector',
        status: projectorWindowOpen ? 'ok' : 'warn',
        message: projectorWindowOpen ? 'Projector window is open.' : 'Projector is not open yet.',
        actionLabel: projectorWindowOpen ? 'Focus' : 'Open',
        action: () => (projectorWindowOpen ? focusProjector?.() : openProjector?.()),
      },
      {
        id: 'remote',
        label: 'Remote (optional)',
        status: 'ok',
        message: remoteHostOk
          ? remoteClientCount > 0
            ? `${remoteClientCount} remote device${remoteClientCount === 1 ? '' : 's'} paired.`
            : 'No remote paired. This is optional for live use.'
          : 'Remote is not connected. This is optional for live use.',
      },
      {
        id: 'queue',
        label: 'Queue preload',
        status: queueReady ? 'ok' : queuePreloadStatus?.active ? 'checking' : 'warn',
        message: sessionQueue.length === 0
          ? `No ${activeSessionId} queue set.`
          : queueReady
            ? `${sessionQueue.length} queued item${sessionQueue.length === 1 ? '' : 's'} ready.`
            : queuePreloadStatus?.active
              ? `Preloading ${queuePreloadStatus.loaded || 0}/${queuePreloadStatus.total || sessionQueue.length}.`
              : `${sessionQueue.length} queued item${sessionQueue.length === 1 ? '' : 's'} should be preloaded.`,
        actionLabel: 'Preload',
        action: sessionQueue.length > 0 ? () => preloadQueueSession?.(activeSessionId) : null,
        busy: queuePreloadStatus?.active,
      },
      {
        id: 'offline',
        label: 'Offline pack',
        status: offlineReady ? 'ok' : offlinePackStatus?.active ? 'checking' : 'warn',
        message: offlineReady
          ? 'Offline session pack prepared.'
          : offlinePackStatus?.active
            ? `Preparing ${offlinePackStatus.loaded || 0}/${offlinePackStatus.total || 0}.`
            : 'Prepare before going live on weak Wi-Fi.',
        actionLabel: 'Prepare',
        action: () => preloadOfflineSessionPack?.(activeSessionId),
        busy: offlinePackStatus?.active,
      },
    ];
  }, [
    activeSessionId,
    backend.message,
    backend.status,
    checkBackend,
    checkingBackend,
    focusProjector,
    offlinePackStatus,
    offlineReady,
    openProjector,
    preloadOfflineSessionPack,
    preloadQueueSession,
    projectorWindowOpen,
    queuePreloadStatus,
    queueReady,
    remoteClientCount,
    remotePairing?.code,
    remotePairing?.hostConnected,
    sessionQueue.length,
    voice?.error,
    voice?.isListening,
    voice?.isSupported,
  ]);

  const okCount = items.filter((item) => item.status === 'ok').length;
  const worst = items.reduce((acc, item) => (statusRank(item.status) > statusRank(acc) ? item.status : acc), 'ok');
  const summary = worst === 'ok'
    ? 'Ready for live use.'
    : worst === 'fail'
      ? 'Some checks need attention.'
      : 'Almost ready.';

  return (
    <>
      <button
        type="button"
        className={`live-health-button live-health-button-${worst}`}
        onClick={() => setOpen(true)}
        aria-label={`Live readiness ${okCount} of ${items.length}`}
      >
        <StatusDot status={worst} />
        <span>Ready {okCount}/{items.length}</span>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="live-health-modal" role="dialog" aria-modal="true" aria-label="Live readiness check">
          <button type="button" className="live-health-scrim" aria-label="Close live readiness" onClick={() => setOpen(false)} />
          <aside className="live-health-panel">
            <div className="live-health-head">
              <div>
                <p className="section-eyebrow">Live Readiness</p>
                <h2>{okCount}/{items.length} checks ready</h2>
                <p>{summary}</p>
              </div>
              <button type="button" className="live-health-close" onClick={() => setOpen(false)} aria-label="Close">
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                  <path d="M3 3l10 10M13 3 3 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <ul className="live-health-list">
              {items.map((item) => <CheckRow key={item.id} item={item} />)}
            </ul>

            <div className="live-health-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={prepareAll}
                disabled={preparingAll || checkingBackend || queuePreloadStatus?.active || offlinePackStatus?.active}
              >
                {preparingAll ? 'Preparing...' : 'Prepare all'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => checkBackend(true)} disabled={checkingBackend || preparingAll}>
                Run check again
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={openSetup}>
                Audio setup
              </button>
            </div>
          </aside>
        </div>,
        document.body
      )}
    </>
  );
}
