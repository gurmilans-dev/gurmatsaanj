import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';

const RECOVERY_KEY = 'saanj-kirtan.crashRecovery.v1';
const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 700;

function readSnapshot() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage?.getItem(RECOVERY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed?.path || !parsed?.savedAt) return null;
    if (Date.now() - Number(parsed.savedAt) > RECOVERY_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot) {
  if (typeof window === 'undefined' || !snapshot?.path) return;
  try {
    window.localStorage?.setItem(RECOVERY_KEY, JSON.stringify(snapshot));
  } catch {
    // Recovery is helpful, never critical.
  }
}

function viewerKindForPath(pathname) {
  if (pathname.startsWith('/shabad/')) return 'shabad';
  if (pathname.startsWith('/ang/')) return 'ang';
  if (pathname.startsWith('/bani/')) return 'bani';
  return '';
}

function withLine(pathname, search, lineIndex) {
  const params = new URLSearchParams(search || '');
  if (Number.isFinite(Number(lineIndex)) && Number(lineIndex) >= 0) {
    params.set('line', String(Math.max(0, Number(lineIndex) || 0)));
  }
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ''}`;
}

function titleForSnapshot(selectedShabad, pathname) {
  const meta = selectedShabad?.meta || {};
  return (
    selectedShabad?.baniTitle ||
    selectedShabad?.baniSetTitle ||
    meta.title ||
    meta.raag ||
    pathname.split('/').filter(Boolean).join(' ') ||
    'last session'
  );
}

function describeSnapshot(snapshot) {
  const line = Number(snapshot?.lineIndex);
  const lineText = String(snapshot?.lineText || '').trim();
  const lineLabel = Number.isFinite(line) && line >= 0 ? `Line ${line + 1}` : '';
  if (lineLabel && lineText) return `${lineLabel}: ${lineText}`;
  return lineLabel || 'Open where you left off.';
}

function shouldOfferRestore(snapshot, location) {
  if (!snapshot?.path) return false;
  const currentPath = `${location.pathname}${location.search || ''}`;
  if (snapshot.restorePath && snapshot.restorePath === currentPath) return false;
  if (!viewerKindForPath(snapshot.pathname || snapshot.path)) return false;
  return true;
}

export default function CrashRecoveryManager() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    activeLine,
    selectedShabad,
    projectorViewMode,
    projectorEmergency,
    shabadQueue,
    voice,
    pushToast,
    setProjectorViewMode,
  } = useApp();

  const initialSnapshot = useMemo(() => readSnapshot(), []);
  const promptShownRef = useRef(false);
  const persistTimerRef = useRef(null);
  const [restoreSnapshot] = useState(initialSnapshot);

  useEffect(() => {
    if (promptShownRef.current || !restoreSnapshot) return;
    if (!shouldOfferRestore(restoreSnapshot, location)) return;
    const promptKey = `saanj-kirtan.recoveryPrompt.${restoreSnapshot.savedAt}`;
    try {
      if (window.sessionStorage?.getItem(promptKey) === '1') return;
      window.sessionStorage?.setItem(promptKey, '1');
    } catch {
      // sessionStorage can be blocked; the in-memory ref still prevents
      // duplicates during a normal mount.
    }
    promptShownRef.current = true;

    pushToast?.({
      kind: 'info',
      title: 'Restore last session?',
      message: `${restoreSnapshot.title || 'Last session'} - ${describeSnapshot(restoreSnapshot)}`,
      timeoutMs: 12000,
      actionLabel: 'Restore',
      onAction: () => {
        voice?.stop?.();
        voice?.reset?.();
        if (restoreSnapshot.projectorViewMode === 'waheguru' || restoreSnapshot.projectorViewMode === 'shabad') {
          setProjectorViewMode?.(restoreSnapshot.projectorViewMode);
        }
        navigate(restoreSnapshot.restorePath || restoreSnapshot.path);
      },
    });
  }, [location, navigate, pushToast, restoreSnapshot, setProjectorViewMode, voice]);

  useEffect(() => {
    const kind = viewerKindForPath(location.pathname);
    if (!kind) return undefined;

    const lineIndex = Number(activeLine?.index);
    const snapshot = {
      kind,
      pathname: location.pathname,
      search: location.search || '',
      path: `${location.pathname}${location.search || ''}`,
      restorePath: withLine(location.pathname, location.search, lineIndex),
      title: titleForSnapshot(selectedShabad, location.pathname),
      lineIndex: Number.isFinite(lineIndex) ? lineIndex : -1,
      lineText: activeLine?.text || '',
      projectorViewMode: projectorEmergency?.id || projectorViewMode || 'shabad',
      queueCount: Array.isArray(shabadQueue) ? shabadQueue.length : 0,
      savedAt: Date.now(),
    };

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => writeSnapshot(snapshot), PERSIST_DEBOUNCE_MS);

    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [
    activeLine?.index,
    activeLine?.text,
    location.pathname,
    location.search,
    projectorEmergency,
    projectorViewMode,
    selectedShabad,
    shabadQueue,
  ]);

  return null;
}
