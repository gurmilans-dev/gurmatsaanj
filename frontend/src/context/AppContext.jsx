/**
 * AppContext — global state shared between the home and shabad pages:
 *  - the live transcript, listening state and start/stop controls
 *  - the currently selected shabad (so a click on a suggestion navigates)
 *  - the user's display preferences (show transliteration, English, etc.)
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useVoiceRecognition from '../hooks/useVoiceRecognition';
import { api } from '../services/api';
import { projectorPost, projectorPersist, projectorSubscribe } from '../services/projector';
import { shabadIdsForBaniSet } from '../data/baniSets';
import { displayLineForEntry, getMainVerse, isLikelyIntroLine } from '../utils/gurmukhi';

const AppContext = createContext(null);

// localStorage keys. We renamed the prefix from "kirtan-sathi.*" to
// "saanj-kirtan.*"; the migration helper below copies any old values
// across once and deletes the originals so existing users don't lose
// their saved theme / history / favourites.
const THEME_KEY = 'saanj-kirtan.theme';
const QUEUE_KEY = 'saanj-kirtan.queue';
const PROJECTOR_PRESET_KEY = 'saanj-kirtan.projectorPreset';
const KATHA_STAY_KEY = 'saanj-kirtan.kathaStayInCurrent';
const REMOTE_HOST_KEY = 'saanj-kirtan.remoteHostId';
const REMOTE_HOST_TOKEN_KEY = 'saanj-kirtan.remoteHostToken';

export const PROJECTOR_PRESETS = [
  { id: 'contrast', label: 'High Contrast', fontScale: 1.12, tone: 'dark' },
  { id: 'warm', label: 'Warm Darbar', fontScale: 1, tone: 'medium' },
  { id: 'simple', label: 'Simple White', fontScale: 0.95, tone: 'light' },
];

export const PROJECTOR_EMERGENCY_ITEMS = [
  { id: 'blank', label: 'Blank', title: 'Blank Screen', gurmukhi: '', transliteration: '' },
  { id: 'waheguru', label: 'Waheguru', title: 'Waheguru', gurmukhi: 'ੴ ਵਾਹਿਗੁਰੂ', transliteration: 'Waheguru' },
  {
    id: 'mool-mantar',
    label: 'Mool Mantar',
    title: 'ਮੂਲ ਮੰਤਰ',
    gurmukhi: 'ੴ ਸਤਿ ਨਾਮੁ ਕਰਤਾ ਪੁਰਖੁ ਨਿਰਭਉ ਨਿਰਵੈਰੁ ਅਕਾਲ ਮੂਰਤਿ ਅਜੂਨੀ ਸੈਭੰ ਗੁਰ ਪ੍ਰਸਾਦਿ ॥',
    transliteration: 'Ik Oankar Sat Naam Karta Purakh Nirbhau Nirvair',
  },
  {
    id: 'anand-sahib',
    label: 'Anand Sahib',
    action: 'open-shabad',
    shabadId: '333375',
    bundle: 'anand-sahib',
    query: 'ਅਨੰਦੁ ਭਇਆ ਮੇਰੀ ਮਾਏ',
    title: 'ਅਨੰਦੁ ਸਾਹਿਬ',
    gurmukhi: 'ਅਨੰਦੁ ਭਇਆ ਮੇਰੀ ਮਾਏ ਸਤਿਗੁਰੂ ਮੈ ਪਾਇਆ ॥',
    transliteration: 'Anand bhaia meri maae satiguru mai paiaa',
  },
  {
    id: 'sangat-qr',
    label: 'Sangat View',
    action: 'show-sangat-qr',
  },
];

export const QUEUE_SESSIONS = [
  { id: 'kirtan', label: 'Kirtan session' },
  { id: 'katha', label: 'Katha session' },
];

const DEFAULT_QUEUE_SESSION_ID = 'kirtan';
const OFFLINE_PACK_CACHE = 'saanj-kirtan-session-pack-v1';
const OFFLINE_PACK_BANI_SETS = [
  'japji-sahib',
  'jaap-sahib',
  'tav-prasad-savaiye',
  'chaupai-sahib',
  'anand-sahib',
  'rehras-sahib',
  'rehras-sahib-with-dohre',
  'rehras-sahib-sggs',
  'rakhia-de-shabad',
  'aarti',
  'kirtan-sohila',
];
const OFFLINE_PACK_STATIC_ASSETS = [
  '/',
  '/kirtan',
  '/katha',
  '/bani',
  '/calendar',
  '/remote',
  '/credits',
  '/setup',
  '/projector',
  '/manifest.webmanifest',
  '/icons/favicon-32.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/brand/gurmat-saanj-mark-light.png',
  '/brand/gurmat-saanj-mark-dark.png',
  '/brand/gurmat-saanj-logo.png',
  '/splash/splash-1170x2532.png',
  '/splash/splash-1179x2556.png',
  '/splash/splash-1290x2796.png',
  '/splash/splash-1125x2436.png',
  '/splash/splash-828x1792.png',
  '/splash/splash-2048x2732.png',
  // Semantic-search artifacts — produced by tools/build-semantic-index.js.
  // Cached proactively so "By meaning" search works offline once the model
  // has been downloaded (the model itself is cached by transformers.js in
  // IndexedDB). If these files are missing in dev (haven't run the script
  // yet), the SW just gets 404s here and skips them — no app crash.
  '/semantic/embeddings.bin',
  '/semantic/index.json',
  '/semantic/shabad-meta.json',
];

function queueSessionIdFor(sessionId) {
  const id = String(sessionId || '').trim();
  return QUEUE_SESSIONS.some((session) => session.id === id) ? id : DEFAULT_QUEUE_SESSION_ID;
}

function queueSessionLabelFor(sessionId) {
  return QUEUE_SESSIONS.find((session) => session.id === queueSessionIdFor(sessionId))?.label || 'Kirtan session';
}

function nearbyNumericIds(id, radius) {
  const value = Number(id);
  if (!Number.isFinite(value)) return [];
  const ids = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const next = value + offset;
    if (next > 0) ids.push(String(next));
  }
  return ids;
}

function nearbyAngs(pageNo, radius = 1) {
  const value = Number(pageNo);
  if (!Number.isFinite(value)) return [];
  const pages = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const next = value + offset;
    if (next >= 1 && next <= 1430) pages.push(next);
  }
  return pages;
}

async function cacheOfflineStaticAssets() {
  if (typeof window === 'undefined' || !('caches' in window)) return { loaded: 0, failed: 0 };
  const cache = await caches.open(OFFLINE_PACK_CACHE);
  let loaded = 0;
  let failed = 0;
  for (const asset of OFFLINE_PACK_STATIC_ASSETS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await cache.add(asset);
      loaded += 1;
    } catch {
      failed += 1;
    }
  }
  return { loaded, failed };
}

async function preloadOfflineRouteChunks() {
  const imports = [
    () => import('../pages/SearchPage/SearchPage'),
    () => import('../pages/ShabadPage/ShabadPage'),
    () => import('../pages/AngPage/AngPage'),
    () => import('../pages/BaniPage/BaniPage'),
    () => import('../pages/CalendarPage/CalendarPage'),
    () => import('../pages/RemoteControlPage/RemoteControlPage'),
    () => import('../pages/CreditsPage/CreditsPage'),
    () => import('../pages/SetupPage/SetupPage'),
    () => import('../pages/ProjectorPage/ProjectorPage'),
  ];
  const results = await Promise.allSettled(imports.map((load) => load()));
  return {
    loaded: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
  };
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
}

function randomId(prefix) {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `${prefix}-${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function buildSangatShareUrl(followCode) {
  if (!followCode || typeof window === 'undefined') return '';
  const env = import.meta.env || {};
  const base = env.VITE_PUBLIC_APP_URL || env.VITE_PUBLIC_REMOTE_URL || window.location.origin;
  try {
    return new URL(`/follow/${encodeURIComponent(followCode)}`, base).toString();
  } catch {
    return '';
  }
}

function getOrCreateRemoteHostId() {
  try {
    const existing = localStorage.getItem(REMOTE_HOST_KEY);
    if (existing) return existing;
    const next = randomId('host');
    localStorage.setItem(REMOTE_HOST_KEY, next);
    return next;
  } catch {
    return randomId('host');
  }
}

function getOrCreateRemoteHostToken() {
  try {
    const existing = localStorage.getItem(REMOTE_HOST_TOKEN_KEY);
    if (existing) return existing;
    const next = randomId('host-token');
    localStorage.setItem(REMOTE_HOST_TOKEN_KEY, next);
    return next;
  } catch {
    return randomId('host-token');
  }
}

function saveRemoteHostToken(token) {
  if (!token) return;
  try { localStorage.setItem(REMOTE_HOST_TOKEN_KEY, token); } catch { /* noop */ }
}

function remotePairingFromSession(session) {
  if (!session || typeof session !== 'object') return session;
  const { hostToken, ...safeSession } = session;
  return safeSession;
}

function historyKeyFor(entry) {
  if (!entry) return '';
  if (entry.historyId) return entry.historyId;
  if (entry.kind === 'ang' && entry.pageNo) return `ang:${entry.pageNo}:${entry.source || ''}`;
  return `shabad:${entry.shabadId}`;
}

function normalizeQueueEntry(entry) {
  const kind = entry?.kind === 'ang' ? 'ang' : 'shabad';
  const pageNo = Number(entry?.pageNo || entry?.ang);
  if (kind === 'ang') {
    if (!Number.isFinite(pageNo) || pageNo < 1 || pageNo > 1430) return null;
    const queueSessionId = queueSessionIdFor(
      entry.queueSessionId || entry.sessionId || entry.mode || entry.groupId || 'katha'
    );
    return {
      id: entry.id || `ang:${Math.floor(pageNo)}:${entry.source || ''}`,
      kind: 'ang',
      shabadId: entry.shabadId || `ang:${Math.floor(pageNo)}:${entry.source || ''}`,
      gurmukhi: entry.gurmukhi || entry.title || `Ang ${Math.floor(pageNo)}`,
      mainGurmukhi: '',
      firstGurmukhi: entry.firstGurmukhi || '',
      displayGurmukhi: entry.displayGurmukhi || entry.gurmukhi || entry.title || `Ang ${Math.floor(pageNo)}`,
      queueSessionId,
      sessionId: queueSessionId,
      queueSessionLabel: queueSessionLabelFor(queueSessionId),
      raag: '',
      writer: '',
      source: entry.source || '',
      pageNo: Math.floor(pageNo),
      addedAt: entry.addedAt || Date.now(),
    };
  }
  if (!entry?.shabadId) return null;
  const displayLine = displayLineForEntry(entry);
  const firstLine = entry.firstGurmukhi || entry.gurmukhi || displayLine;
  const queueSessionId = queueSessionIdFor(
    entry.queueSessionId || entry.sessionId || entry.mode || entry.groupId
  );
  return {
    id: entry.id || `shabad:${entry.shabadId}`,
    kind: 'shabad',
    shabadId: entry.shabadId,
    gurmukhi: displayLine,
    mainGurmukhi: entry.mainGurmukhi || '',
    firstGurmukhi: firstLine || '',
    displayGurmukhi: displayLine,
    queueSessionId,
    sessionId: queueSessionId,
    queueSessionLabel: queueSessionLabelFor(queueSessionId),
    raag: entry.raag || '',
    writer: entry.writer || '',
    source: entry.source || '',
    pageNo: entry.pageNo || null,
    addedAt: entry.addedAt || Date.now(),
  };
}

function enrichEntryWithShabad(entry, data) {
  if (entry?.kind === 'ang' || !entry?.shabadId || !data?.verses?.length) return entry;
  const mainVerse = getMainVerse(data.verses, data.meta);
  const firstVerse = data.verses[0] || null;
  const displayLine = mainVerse?.gurmukhi || firstVerse?.gurmukhi || displayLineForEntry(entry);
  return {
    ...entry,
    kind: 'shabad',
    shabadId: data?.meta?.shabadId || entry.shabadId,
    gurmukhi: displayLine,
    mainGurmukhi: mainVerse?.gurmukhi || '',
    firstGurmukhi: firstVerse?.gurmukhi || entry.firstGurmukhi || entry.gurmukhi || '',
    displayGurmukhi: displayLine,
    queueSessionId: queueSessionIdFor(entry.queueSessionId || entry.sessionId || entry.mode || entry.groupId),
    sessionId: queueSessionIdFor(entry.queueSessionId || entry.sessionId || entry.mode || entry.groupId),
    queueSessionLabel: queueSessionLabelFor(entry.queueSessionId || entry.sessionId || entry.mode || entry.groupId),
    raag: data?.meta?.raag || entry.raag || '',
    writer: data?.meta?.writer || entry.writer || '',
    source: data?.meta?.source || entry.source || '',
    pageNo: data?.meta?.pageNo || entry.pageNo || null,
  };
}

(function migrateLegacyStorage() {
  if (typeof localStorage === 'undefined') return;
  const pairs = [
    ['kirtan-sathi.theme',      'saanj-kirtan.theme'],
    ['kirtan-sathi.history',    'saanj-kirtan.history'],
    ['kirtan-sathi.favourites', 'saanj-kirtan.favourites'],
  ];
  for (const [oldKey, newKey] of pairs) {
    try {
      const v = localStorage.getItem(oldKey);
      if (v != null && localStorage.getItem(newKey) == null) {
        localStorage.setItem(newKey, v);
      }
      if (v != null) localStorage.removeItem(oldKey);
    } catch { /* noop */ }
  }
})();

function loadTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_KEY) || 'null');
    // Accent is always kesari now — ignore any persisted value.
    if (saved && (saved.variant === 'light' || saved.variant === 'dark')) {
      return { variant: saved.variant, accent: 'kesari' };
    }
  } catch { /* noop */ }
  return { variant: 'light', accent: 'kesari' };
}

function saveTheme(t) {
  try { localStorage.setItem(THEME_KEY, JSON.stringify(t)); } catch { /* noop */ }
}

// ── Global UI language (EN ⇄ ਪੰ) ───────────────────────────────────────
//
// Lifted out of BaniPage so any page can read/write the same preference.
// Storage key migrates once from the bani-only key that existed before.
const LANG_STORAGE_KEY = 'gurmat-saanj.lang';
const OLD_BANI_LANG_KEY = 'gurmat-saanj.bani.lang';

function readInitialLang() {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = window.localStorage?.getItem(LANG_STORAGE_KEY);
    if (saved === 'pa' || saved === 'en') return saved;
    const legacy = window.localStorage?.getItem(OLD_BANI_LANG_KEY);
    if (legacy === 'pa' || legacy === 'en') {
      window.localStorage?.setItem(LANG_STORAGE_KEY, legacy);
      return legacy;
    }
  } catch { /* ignore */ }
  const browser = String(navigator?.language || '').toLowerCase();
  return browser.startsWith('pa') ? 'pa' : 'en';
}


export function AppProvider({ children }) {
  const navigate = useNavigate();

  // Single editable transcript. While the mic is on, the voice hook mirrors
  // its live output into this state; when it's off, the user is free to
  // edit (with the Gurmukhi keyboard) before re-running the match.
  const [editableTranscript, setEditableTranscript] = useState('');

  // Global UI language preference. Persisted to localStorage; any component
  // can read/write it via useApp().lang / setLang(). tLang(en, pa) is a tiny
  // inline helper for components that only need a single translated string.
  const [lang, setLangState] = useState(readInitialLang);
  const setLang = useCallback((next) => {
    setLangState(next);
    try { window.localStorage?.setItem(LANG_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);
  const tLang = useCallback((en, pa) => (lang === 'pa' ? (pa ?? en) : en), [lang]);
  const voice = useVoiceRecognition({ lang: 'pa-IN' });

  const [filters, setFilters] = useState({ source: '', writer: '', raag: '' });
  const [display, setDisplay] = useState({
    showTransliteration: true,
    showEnglish: true,
    showPunjabi: false,
    // Larivaar: render Gurmukhi continuously (no word spaces), the
    // traditional way the text appears in Sri Guru Granth Sahib Ji. Word
    // colouring (vishraam, rahao, yamki) is preserved but words touch.
    larivaar: false,
    // Which Punjabi steek (commentary) to render when showPunjabi is true.
    //   ss  → Prof. Sahib Singh (default — most complete and accessible)
    //   ft  → Faridkot Teeka (scholarly, archaic; sparse on Dasam Bani)
    //   ms  → Bhai Manmohan Singh (concise, modern)
    punjabiSteek: 'ss',
  });
  const [theme, setThemeState] = useState(loadTheme);
  const [toasts, setToasts] = useState([]);
  // Library drawer (queue + history + saved). Lives at the top level so any
  // page can open it, and the body class set in <Layout> can lock scroll.
  const [libraryOpen, setLibraryOpen] = useState(false);
  const openLibrary  = useCallback(() => setLibraryOpen(true), []);
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const toggleLibrary = useCallback(() => setLibraryOpen((v) => !v), []);

  // Selected shabad — broadcast to projector window
  const [selectedShabad, setSelectedShabad] = useState(null);
  const [activeLine, setActiveLine] = useState({ index: -1, text: '', tracked: false });
  const [remoteLineCommand, setRemoteLineCommand] = useState(null);
  const [remoteLinesExpanded, setRemoteLinesExpanded] = useState(false);
  const remoteHostIdRef = useRef(getOrCreateRemoteHostId());
  const remoteHostTokenRef = useRef(getOrCreateRemoteHostToken());
  const remoteOpenHistoryRef = useRef([]);
  const [remoteOpenHistoryVersion, setRemoteOpenHistoryVersion] = useState(0);
  const [remotePairing, setRemotePairing] = useState(null);
  const [sangatQrFullscreen, setSangatQrFullscreen] = useState(false);
  // In katha mode, the projector shows neighbour-shabad boundary verses so
  // the user can see what comes before line 0 and after the last line of the
  // open shabad. Either field may be null when there is no neighbour
  // (very first / last shabad of the book).
  const [kathaBoundary, setKathaBoundary] = useState({ prevVerse: null, nextVerse: null });
  const [projectorTranscript, setProjectorTranscript] = useState('');
  const [projectorViewMode, setProjectorViewModeState] = useState('shabad'); // 'shabad' | 'waheguru'
  const [projectorEmergency, setProjectorEmergency] = useState(null);
  // Manual override is time-limited so a one-off click doesn't permanently
  // disable the auto-detector. After ~30 seconds the detector resumes.
  const manualProjectorViewRef = useRef({ active: false, ts: 0 });
  const MANUAL_OVERRIDE_TTL_MS = 30_000;
  const setProjectorViewMode = useCallback((mode) => {
    manualProjectorViewRef.current = { active: true, ts: Date.now() };
    setProjectorEmergency(null);
    setProjectorViewModeState(mode === 'waheguru' ? 'waheguru' : 'shabad');
  }, []);
  const setProjectorViewModeAuto = useCallback((mode) => {
    setProjectorViewModeState(mode === 'waheguru' ? 'waheguru' : 'shabad');
  }, []);
  const setProjectorEmergencyMode = useCallback((modeId) => {
    const item = PROJECTOR_EMERGENCY_ITEMS.find((entry) => entry.id === modeId);
    manualProjectorViewRef.current = { active: true, ts: Date.now() };
    if (!item || item.id === 'waheguru') {
      setProjectorEmergency(null);
      setProjectorViewModeState('waheguru');
      return;
    }
    if (item.action === 'open-shabad') {
      setProjectorEmergency(null);
      setProjectorViewModeState('shabad');
      return;
    }
    setProjectorEmergency(item);
  }, []);
  const clearProjectorEmergency = useCallback(() => {
    manualProjectorViewRef.current = { active: true, ts: Date.now() };
    setProjectorEmergency(null);
    setProjectorViewModeState('shabad');
  }, []);
  const observeProjectorTranscript = useCallback((text) => {
    setProjectorTranscript(String(text || ''));
  }, []);

  // Projector image state lives in context so it survives page navigation —
  // user uploads on Listen page, navigates to Shabad, comes back: image is still set.
  const [projectorImage, setProjectorImage] = useState({ dataUrl: null, name: '' });
  const [projectorBackground, setProjectorBackground] = useState({ dataUrl: null, name: '' });
  const [projectorDisplay, setProjectorDisplay] = useState({
    fontScale: 1,
  });
  const [projectorPreset, setProjectorPreset] = useState(() => {
    try { return localStorage.getItem(PROJECTOR_PRESET_KEY) || 'warm'; } catch { return 'warm'; }
  });
  const [kathaStayInCurrent, setKathaStayInCurrentState] = useState(() => {
    try { return localStorage.getItem(KATHA_STAY_KEY) === '1'; } catch { return false; }
  });
  const [shabadQueue, setShabadQueue] = useState(() => {
    const arr = loadJson(QUEUE_KEY, []);
    return Array.isArray(arr)
      ? arr.map((item) => normalizeQueueEntry(item)).filter(Boolean).slice(0, 50)
      : [];
  });
  const shabadDataCacheRef = useRef(new Map());
  const [queuePreloadStatus, setQueuePreloadStatus] = useState({
    active: false,
    sessionId: '',
    loaded: 0,
    total: 0,
    failed: 0,
    lastRunAt: 0,
  });
  const [offlinePackStatus, setOfflinePackStatus] = useState({
    active: false,
    sessionId: '',
    step: '',
    loaded: 0,
    total: 0,
    failed: 0,
    lastRunAt: 0,
  });

  const getCachedShabad = useCallback(async (shabadId) => {
    const key = String(shabadId || '');
    if (!key) throw new Error('Missing Shabad id');
    const cached = shabadDataCacheRef.current.get(key);
    if (cached) return cached;
    const data = await api.getShabad(key);
    shabadDataCacheRef.current.set(key, data);
    const resolvedId = data?.meta?.shabadId;
    if (resolvedId) shabadDataCacheRef.current.set(String(resolvedId), data);
    return data;
  }, []);

  const setKathaStayInCurrent = useCallback((value) => {
    const next = Boolean(value);
    setKathaStayInCurrentState(next);
    try { localStorage.setItem(KATHA_STAY_KEY, next ? '1' : '0'); } catch { /* noop */ }
  }, []);

  const addToQueue = useCallback((entry) => {
    const nextEntry = normalizeQueueEntry(entry);
    if (!nextEntry) return false;
    setShabadQueue((prev) => {
      const next = [
        nextEntry,
        ...prev.filter((item) =>
          String(item.shabadId) !== String(nextEntry.shabadId) ||
          queueSessionIdFor(item.queueSessionId || item.sessionId) !== nextEntry.queueSessionId
        ),
      ].slice(0, 50);
      saveJson(QUEUE_KEY, next);
      return next;
    });
    return true;
  }, []);
  const removeFromQueue = useCallback((shabadId, sessionId) => {
    setShabadQueue((prev) => {
      const scopedSessionId = sessionId ? queueSessionIdFor(sessionId) : null;
      const next = prev.filter((item) =>
        String(item.shabadId) !== String(shabadId) ||
        (scopedSessionId && queueSessionIdFor(item.queueSessionId || item.sessionId) !== scopedSessionId)
      );
      saveJson(QUEUE_KEY, next);
      return next;
    });
  }, []);
  const clearQueue = useCallback((sessionId) => {
    if (!sessionId) {
      setShabadQueue([]);
      try { localStorage.removeItem(QUEUE_KEY); } catch { /* noop */ }
      return;
    }
    const scopedSessionId = queueSessionIdFor(sessionId);
    setShabadQueue((prev) => {
      const next = prev.filter((item) =>
        queueSessionIdFor(item.queueSessionId || item.sessionId) !== scopedSessionId
      );
      saveJson(QUEUE_KEY, next);
      return next;
    });
  }, []);
  const moveQueueItem = useCallback((shabadId, direction, sessionId) => {
    setShabadQueue((prev) => {
      const scopedSessionId = queueSessionIdFor(sessionId);
      const index = prev.findIndex((item) =>
        String(item.shabadId) === String(shabadId) &&
        queueSessionIdFor(item.queueSessionId || item.sessionId) === scopedSessionId
      );
      const groupItems = prev
        .map((item, originalIndex) => ({ item, originalIndex }))
        .filter(({ item }) => queueSessionIdFor(item.queueSessionId || item.sessionId) === scopedSessionId);
      const groupIndex = groupItems.findIndex(({ item }) => String(item.shabadId) === String(shabadId));
      const targetGroupIndex = direction === 'up' ? groupIndex - 1 : groupIndex + 1;
      const target = groupItems[targetGroupIndex]?.originalIndex;
      if (index < 0 || !Number.isInteger(target) || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      saveJson(QUEUE_KEY, next);
      return next;
    });
  }, []);
  const reorderQueueItem = useCallback((shabadId, sessionId, targetIndex) => {
    setShabadQueue((prev) => {
      const scopedSessionId = queueSessionIdFor(sessionId);
      const scopedItems = prev.filter((item) =>
        queueSessionIdFor(item.queueSessionId || item.sessionId) === scopedSessionId
      );
      const fromIndex = scopedItems.findIndex((item) => String(item.shabadId) === String(shabadId));
      if (fromIndex < 0) return prev;

      const nextScopedItems = [...scopedItems];
      const [moving] = nextScopedItems.splice(fromIndex, 1);
      const boundedTarget = Math.min(nextScopedItems.length, Math.max(0, Number(targetIndex) || 0));
      nextScopedItems.splice(boundedTarget, 0, moving);

      let scopedCursor = 0;
      const next = prev.map((item) => (
        queueSessionIdFor(item.queueSessionId || item.sessionId) === scopedSessionId
          ? nextScopedItems[scopedCursor++]
          : item
      ));
      saveJson(QUEUE_KEY, next);
      return next;
    });
  }, []);
  const updateQueueItemSession = useCallback((shabadId, fromSessionId, toSessionId) => {
    const sourceSessionId = queueSessionIdFor(fromSessionId);
    const nextSessionId = queueSessionIdFor(toSessionId);
    setShabadQueue((prev) => {
      const next = prev.map((item) =>
        String(item.shabadId) === String(shabadId) &&
        queueSessionIdFor(item.queueSessionId || item.sessionId) === sourceSessionId
          ? {
              ...item,
              queueSessionId: nextSessionId,
              sessionId: nextSessionId,
              queueSessionLabel: queueSessionLabelFor(nextSessionId),
            }
          : item
      ).filter((item, index, list) =>
        list.findIndex((candidate) =>
          String(candidate.shabadId) === String(item.shabadId) &&
          queueSessionIdFor(candidate.queueSessionId || candidate.sessionId) === queueSessionIdFor(item.queueSessionId || item.sessionId)
        ) === index
      );
      saveJson(QUEUE_KEY, next);
      return next;
    });
  }, []);

  const resetRemotePairing = useCallback(async () => {
    const result = await api.resetRemoteSession(remoteHostIdRef.current, remoteHostTokenRef.current);
    if (result?.session?.hostToken) {
      remoteHostTokenRef.current = result.session.hostToken;
      saveRemoteHostToken(result.session.hostToken);
    }
    if (result?.session) setRemotePairing(remotePairingFromSession(result.session));
    return result?.session || null;
  }, []);

  const approveRemoteControlRequest = useCallback(async (targetClientId) => {
    const result = await api.grantRemoteControl({
      hostId: remoteHostIdRef.current,
      hostToken: remoteHostTokenRef.current,
      targetClientId,
    });
    if (result?.session?.hostToken) {
      remoteHostTokenRef.current = result.session.hostToken;
      saveRemoteHostToken(result.session.hostToken);
    }
    if (result?.session) setRemotePairing(remotePairingFromSession(result.session));
    return result;
  }, []);

  const kickRemoteClient = useCallback(async (targetClientId) => {
    const result = await api.kickRemoteClient({
      hostId: remoteHostIdRef.current,
      hostToken: remoteHostTokenRef.current,
      targetClientId,
    });
    if (result?.session?.hostToken) {
      remoteHostTokenRef.current = result.session.hostToken;
      saveRemoteHostToken(result.session.hostToken);
    }
    if (result?.session) setRemotePairing(remotePairingFromSession(result.session));
    return result;
  }, []);

  const applyProjectorPreset = useCallback((presetId) => {
    const preset = PROJECTOR_PRESETS.find((p) => p.id === presetId) || PROJECTOR_PRESETS[1];
    setProjectorPreset(preset.id);
    try { localStorage.setItem(PROJECTOR_PRESET_KEY, preset.id); } catch { /* noop */ }
    setProjectorDisplay((prev) => ({ ...prev, fontScale: preset.fontScale }));
    setProjectorBackground((prev) => ({
      ...prev,
      brightness: preset.tone === 'light' ? 0.76 : preset.tone === 'dark' ? 0.18 : 0.42,
      tone: preset.tone,
      fit: prev.fit || 'cover',
    }));
  }, []);

  // Centralised projector window opener. Lives here so any component (e.g.
  // a "Start session" button on Home, or the inline Projector card) can
  // open / focus the projector window from within its own click handler —
  // browser popup blockers require the call to trace synchronously through
  // a user gesture, which a context callback invoked from onClick satisfies.
  const projectorWinRef = useRef(null);
  const [projectorWindowOpen, setProjectorWindowOpen] = useState(false);

  // Mobile + iOS-standalone-PWA guard. The projector is a separate browser
  // window — that concept only works on desktop. On iOS PWAs in standalone
  // mode, window.open() doesn't open a new window; it navigates the current
  // PWA view to /projector and the user gets stuck there with no way back.
  // On Android Chrome PWAs the popup is silently blocked. Either way, the
  // right behavior on a phone is to NOT auto-open it.
  const isProjectorIncompatibleDevice = () => {
    if (typeof window === 'undefined') return false;
    try {
      if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
      if (window.navigator?.standalone === true) return true; // iOS Safari standalone
      const touch = ('ontouchstart' in window) || (window.navigator?.maxTouchPoints || 0) > 0;
      const narrow = (window.innerWidth || 0) <= 768;
      if (touch && narrow) return true;
    } catch { /* fall through, assume desktop */ }
    return false;
  };

  const openProjector = useCallback(() => {
    // On phones / iOS PWAs the projector window concept doesn't exist —
    // window.open() either gets blocked (Android) or navigates the current
    // PWA view (iOS standalone), trapping the user on /projector. So we
    // simply no-op here. Desktop users still get the new-window flow.
    if (isProjectorIncompatibleDevice()) return null;
    const existing = projectorWinRef.current;
    if (existing && !existing.closed) {
      // Already open — DON'T pull it to the foreground, the user is working
      // in the main window. Just return the handle.
      return existing;
    }
    // Open the projector at a generous size — capped by the user's screen so
    // it never spawns off-display. Most modern monitors fit 1600×900 easily;
    // smaller laptops fall back to ~85% of available pixels.
    const availW = (typeof screen !== 'undefined' && screen.availWidth)  ? screen.availWidth  : 1600;
    const availH = (typeof screen !== 'undefined' && screen.availHeight) ? screen.availHeight : 900;
    const winW = Math.min(1600, Math.round(availW * 0.92));
    const winH = Math.min(900,  Math.round(availH * 0.92));
    const left = Math.max(0, Math.round((availW - winW) / 2));
    const top  = Math.max(0, Math.round((availH - winH) / 2));
    const win = window.open(
      '/projector',
      'saanj-kirtan-projector',
      `width=${winW},height=${winH},left=${left},top=${top},menubar=no,toolbar=no,location=no`
    );
    if (!win) return null;
    projectorWinRef.current = win;
    setProjectorWindowOpen(true);

    // Open the projector window IN THE BACKGROUND. Browsers focus the new
    // window by default; we immediately push focus back to the main window
    // (and ask the projector window to blur itself) so the user keeps
    // typing/clicking without losing context.
    try { win.blur(); } catch { /* noop */ }
    try { window.focus(); } catch { /* noop */ }
    // Some browsers schedule the focus change for the next tick — fire one
    // more on the next frame to be safe.
    requestAnimationFrame(() => {
      try { window.focus(); } catch { /* noop */ }
    });

    const interval = setInterval(() => {
      if (win.closed) {
        setProjectorWindowOpen(false);
        clearInterval(interval);
      }
    }, 1000);
    return win;
  }, []);

  // Explicit "bring projector to front" action. Only call from a click
  // handler (browsers ignore programmatic focus outside a user gesture).
  const focusProjector = useCallback(() => {
    const win = projectorWinRef.current;
    if (!win || win.closed) return null;
    try { win.focus(); } catch { /* noop */ }
    return win;
  }, []);

  // Search state — kept in context so navigating Search → Shabad → Back
  // restores the user's query, mode, and last results without a fresh fetch.
  const [searchState, setSearchState] = useState({
    query: '',
    mode: 'auto',          // 'auto' | 'words' | 'initials'
    results: [],
    detectedType: null,
  });
  const updateSearchState = useCallback((patch) => {
    setSearchState((s) => ({ ...s, ...patch }));
  }, []);
  const [kathaSearchState, setKathaSearchState] = useState({
    query: '',
    mode: 'auto',
    openAs: 'shabad',
    results: [],
    detectedType: null,
  });
  const updateKathaSearchState = useCallback((patch) => {
    setKathaSearchState((s) => ({ ...s, ...patch }));
  }, []);

  // Recently-opened Shabads — persisted to localStorage so it survives
  // reloads. Capped at 20 entries, newest first, deduped by shabadId.
  const HISTORY_KEY = 'saanj-kirtan.history';
  const HISTORY_MAX = 60;
  const [shabadHistory, setShabadHistory] = useState(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : [];
    } catch { return []; }
  });
  const pushShabadHistory = useCallback((entry) => {
    if (!entry || !entry.shabadId) return;
    setShabadHistory((prev) => {
      const displayLine = displayLineForEntry(entry);
      const firstLine = entry.firstGurmukhi || entry.gurmukhi || displayLine;
      const nextEntry = {
        historyId: entry.historyId || (entry.kind === 'ang' && entry.pageNo
          ? `ang:${entry.pageNo}:${entry.source || ''}`
          : `shabad:${entry.shabadId}`),
        kind: entry.kind || 'shabad',
        mode: entry.mode || 'kirtan',
        shabadId: entry.shabadId,
        gurmukhi: displayLine,
        mainGurmukhi: entry.mainGurmukhi || '',
        firstGurmukhi: firstLine || '',
        displayGurmukhi: displayLine,
        raag: entry.raag || '',
        writer: entry.writer || '',
        source: entry.source || '',
        pageNo: entry.pageNo || null,
        title: entry.title || '',
        openedAt: Date.now(),
      };
      const key = historyKeyFor(nextEntry);
      const next = [nextEntry, ...prev.filter((x) => historyKeyFor(x) !== key)].slice(0, HISTORY_MAX);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);
  const clearShabadHistory = useCallback(() => {
    setShabadHistory([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* noop */ }
  }, []);
  const removeShabadHistory = useCallback((target) => {
    if (!target) return;
    setShabadHistory((prev) => {
      const next = prev.filter((x) =>
        String(x.shabadId) !== String(target) &&
        String(historyKeyFor(x)) !== String(target)
      );
      try {
        if (next.length > 0) localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        else localStorage.removeItem(HISTORY_KEY);
      } catch { /* noop */ }
      return next;
    });
  }, []);

  // Favourites — user-curated, persisted to localStorage. Capped at 50
  // entries, newest first, deduped by shabadId. Same shape as history but
  // an explicit user action (a click on the heart) is required to add.
  const FAV_KEY = 'saanj-kirtan.favourites';
  const FAV_MAX = 50;
  const [shabadFavourites, setShabadFavourites] = useState(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, FAV_MAX) : [];
    } catch { return []; }
  });

  useEffect(() => {
    const candidates = [
      ...(shabadQueue || []),
      ...(shabadHistory || []).slice(0, 16),
      ...(shabadFavourites || []).slice(0, 16),
    ];
    const ids = Array.from(new Set(candidates
      .filter((item) => (
        item?.shabadId &&
        item.kind !== 'ang' &&
        (!item.mainGurmukhi || isLikelyIntroLine(item.mainGurmukhi))
      ))
      .map((item) => String(item.shabadId))))
      .slice(0, 24);
    if (!ids.length) return undefined;

    let cancelled = false;
    Promise.all(ids.map((shabadId) =>
      api.getShabad(shabadId)
        .then((data) => [shabadId, data])
        .catch(() => null)
    )).then((rows) => {
      if (cancelled) return;
      const fetched = new Map(rows.filter(Boolean));
      if (!fetched.size) return;
      const upgrade = (list) => (list || []).map((item) => {
        if (!item?.shabadId || item.kind === 'ang') return item;
        const data = fetched.get(String(item.shabadId));
        return data ? enrichEntryWithShabad(item, data) : item;
      });

      setShabadQueue((prev) => {
        const next = upgrade(prev);
        saveJson(QUEUE_KEY, next);
        return next;
      });
      setShabadHistory((prev) => {
        const next = upgrade(prev);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* noop */ }
        return next;
      });
      setShabadFavourites((prev) => {
        const next = upgrade(prev);
        try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* noop */ }
        return next;
      });
    });

    return () => { cancelled = true; };
    // Run once on startup to upgrade old localStorage entries that only had
    // the first line saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isShabadFavourite = useCallback((shabadId) => {
    if (!shabadId) return false;
    return shabadFavourites.some((x) => String(x.shabadId) === String(shabadId));
  }, [shabadFavourites]);
  const addShabadFavourite = useCallback((entry) => {
    if (!entry || !entry.shabadId) return;
    setShabadFavourites((prev) => {
      const displayLine = displayLineForEntry(entry);
      const firstLine = entry.firstGurmukhi || entry.gurmukhi || displayLine;
      const next = [{
        shabadId: entry.shabadId,
        gurmukhi: displayLine,
        mainGurmukhi: entry.mainGurmukhi || '',
        firstGurmukhi: firstLine || '',
        displayGurmukhi: displayLine,
        raag: entry.raag || '',
        writer: entry.writer || '',
        source: entry.source || '',
        pageNo: entry.pageNo || null,
        addedAt: Date.now(),
      }, ...prev.filter((x) => String(x.shabadId) !== String(entry.shabadId))].slice(0, FAV_MAX);
      try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);
  const removeShabadFavourite = useCallback((shabadId) => {
    if (!shabadId) return;
    setShabadFavourites((prev) => {
      const next = prev.filter((x) => String(x.shabadId) !== String(shabadId));
      try {
        if (next.length > 0) localStorage.setItem(FAV_KEY, JSON.stringify(next));
        else localStorage.removeItem(FAV_KEY);
      } catch { /* noop */ }
      return next;
    });
  }, []);
  const toggleShabadFavourite = useCallback((entry) => {
    if (!entry || !entry.shabadId) return;
    setShabadFavourites((prev) => {
      const exists = prev.some((x) => String(x.shabadId) === String(entry.shabadId));
      const displayLine = displayLineForEntry(entry);
      const firstLine = entry.firstGurmukhi || entry.gurmukhi || displayLine;
      const next = exists
        ? prev.filter((x) => String(x.shabadId) !== String(entry.shabadId))
        : [{
            shabadId: entry.shabadId,
            gurmukhi: displayLine,
            mainGurmukhi: entry.mainGurmukhi || '',
            firstGurmukhi: firstLine || '',
            displayGurmukhi: displayLine,
            raag: entry.raag || '',
            writer: entry.writer || '',
            source: entry.source || '',
            pageNo: entry.pageNo || null,
            addedAt: Date.now(),
          }, ...prev].slice(0, FAV_MAX);
      try {
        if (next.length > 0) localStorage.setItem(FAV_KEY, JSON.stringify(next));
        else localStorage.removeItem(FAV_KEY);
      } catch { /* noop */ }
      return next;
    });
  }, []);
  const clearShabadFavourites = useCallback(() => {
    setShabadFavourites([]);
    try { localStorage.removeItem(FAV_KEY); } catch { /* noop */ }
  }, []);

  // Toasts (errors / loading announcements)
  const pushToast = useCallback((toast) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const t = { id, kind: 'info', timeoutMs: 4500, ...toast };
    setToasts((list) => [...list, t]);
    if (t.timeoutMs > 0) {
      setTimeout(() => {
        setToasts((list) => list.filter((x) => x.id !== id));
      }, t.timeoutMs);
    }
    return id;
  }, []);
  // Service-worker-driven app-update prompt. main.jsx fires this event when
  // a new SW is installed and waiting. We surface a sticky toast with a
  // Refresh button; clicking it activates the waiting SW and reloads. If
  // the user ignores it, the app keeps working on the old version.
  const updateToastShownRef = useRef(false);
  useEffect(() => {
    const onUpdate = (event) => {
      if (updateToastShownRef.current) return;
      updateToastShownRef.current = true;
      pushToast({
        kind: 'info',
        title: 'New version available',
        message: 'Refresh when ready to get the latest version.',
        timeoutMs: 0,
        actionLabel: 'Refresh',
        onAction: () => {
          try { event?.detail?.activate?.(); } catch { /* noop */ }
        },
      });
    };
    window.addEventListener('saanj-kirtan:update-available', onUpdate);
    return () => window.removeEventListener('saanj-kirtan:update-available', onUpdate);
  }, [pushToast]);

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const preloadQueueSession = useCallback(async (sessionId = DEFAULT_QUEUE_SESSION_ID) => {
    const scopedSessionId = queueSessionIdFor(sessionId);
    const entries = (shabadQueue || []).filter((item) =>
      item?.shabadId &&
      item.kind !== 'ang' &&
      queueSessionIdFor(item.queueSessionId || item.sessionId) === scopedSessionId
    );
    const ids = Array.from(new Set(entries.map((item) => String(item.shabadId))));
    if (!ids.length) {
      setQueuePreloadStatus({
        active: false,
        sessionId: scopedSessionId,
        loaded: 0,
        total: 0,
        failed: 0,
        lastRunAt: Date.now(),
      });
      return { loaded: 0, failed: 0, total: 0 };
    }

    setQueuePreloadStatus({
      active: true,
      sessionId: scopedSessionId,
      loaded: 0,
      total: ids.length,
      failed: 0,
      lastRunAt: 0,
    });

    const fetched = new Map();
    let loaded = 0;
    let failed = 0;
    for (const shabadId of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await getCachedShabad(shabadId);
        fetched.set(shabadId, data);
        loaded += 1;
      } catch {
        failed += 1;
      }
      setQueuePreloadStatus({
        active: true,
        sessionId: scopedSessionId,
        loaded,
        total: ids.length,
        failed,
        lastRunAt: 0,
      });
    }

    if (fetched.size) {
      setShabadQueue((prev) => {
        const next = (prev || []).map((item) => {
          const data = item?.shabadId ? fetched.get(String(item.shabadId)) : null;
          return data ? enrichEntryWithShabad(item, data) : item;
        });
        saveJson(QUEUE_KEY, next);
        return next;
      });
    }

    const summary = { loaded, failed, total: ids.length };
    setQueuePreloadStatus({
      active: false,
      sessionId: scopedSessionId,
      loaded,
      total: ids.length,
      failed,
      lastRunAt: Date.now(),
    });
    return summary;
  }, [getCachedShabad, shabadQueue]);

  const preloadOfflineSessionPack = useCallback(async (sessionId = DEFAULT_QUEUE_SESSION_ID) => {
    const scopedSessionId = queueSessionIdFor(sessionId);
    const taskMap = new Map();
    const fetchedShabads = new Map();

    const addTask = (key, label, run) => {
      if (!key || taskMap.has(key)) return;
      taskMap.set(key, { label, run });
    };
    const addShabadTask = (shabadId, labelPrefix = 'Shabad') => {
      const id = String(shabadId || '').trim();
      if (!id) return;
      addTask(`shabad:${id}`, `${labelPrefix} ${id}`, async () => {
        const data = await getCachedShabad(id);
        fetchedShabads.set(id, data);
        const resolvedId = data?.meta?.shabadId;
        if (resolvedId) fetchedShabads.set(String(resolvedId), data);
      });
    };
    const addAngTask = (ang, source = '') => {
      const page = Number(ang);
      if (!Number.isFinite(page) || page < 1 || page > 1430) return;
      addTask(`ang:${page}:${source || ''}`, `Ang ${page}`, () =>
        api.getAng(page, source ? { source } : {})
      );
    };

    addTask('app:screens', 'App screens', preloadOfflineRouteChunks);
    addTask('app:assets', 'Brand and projector assets', cacheOfflineStaticAssets);

    const queueItems = (shabadQueue || []).filter((item) =>
      queueSessionIdFor(item.queueSessionId || item.sessionId) === scopedSessionId
    );
    queueItems.forEach((item) => {
      if (item?.kind === 'ang') {
        nearbyAngs(item.pageNo, scopedSessionId === 'katha' ? 1 : 0)
          .forEach((page) => addAngTask(page, item.source || ''));
        return;
      }
      addShabadTask(item?.shabadId, 'Queue Shabad');
      if (scopedSessionId === 'katha') {
        nearbyNumericIds(item?.shabadId, 2).forEach((id) => addShabadTask(id, 'Katha context'));
        nearbyAngs(item?.pageNo, 1).forEach((page) => addAngTask(page, item.source || ''));
      }
    });

    const selectedMeta = selectedShabad?.meta || {};
    if (selectedMeta?.shabadId) addShabadTask(selectedMeta.shabadId, 'Open Shabad');
    if (scopedSessionId === 'katha') {
      nearbyNumericIds(selectedMeta?.shabadId, 2).forEach((id) => addShabadTask(id, 'Open context'));
      nearbyAngs(selectedMeta?.pageNo, 1).forEach((page) => addAngTask(page, selectedMeta.source || ''));
    }

    OFFLINE_PACK_BANI_SETS
      .flatMap((setId) => shabadIdsForBaniSet(setId))
      .forEach((id) => addShabadTask(id, 'Daily Bani'));

    const tasks = Array.from(taskMap.values());
    setOfflinePackStatus({
      active: true,
      sessionId: scopedSessionId,
      step: 'Preparing session',
      loaded: 0,
      total: tasks.length,
      failed: 0,
      lastRunAt: 0,
    });

    let loaded = 0;
    let failed = 0;
    for (const task of tasks) {
      setOfflinePackStatus({
        active: true,
        sessionId: scopedSessionId,
        step: task.label,
        loaded,
        total: tasks.length,
        failed,
        lastRunAt: 0,
      });
      try {
        // eslint-disable-next-line no-await-in-loop
        await task.run();
        loaded += 1;
      } catch {
        failed += 1;
      }
      setOfflinePackStatus({
        active: true,
        sessionId: scopedSessionId,
        step: task.label,
        loaded,
        total: tasks.length,
        failed,
        lastRunAt: 0,
      });
    }

    if (fetchedShabads.size) {
      setShabadQueue((prev) => {
        const next = (prev || []).map((item) => {
          const data = item?.shabadId ? fetchedShabads.get(String(item.shabadId)) : null;
          return data ? enrichEntryWithShabad(item, data) : item;
        });
        saveJson(QUEUE_KEY, next);
        return next;
      });
    }

    const summary = {
      loaded,
      failed,
      total: tasks.length,
      sessionId: scopedSessionId,
      dailyBaniSets: OFFLINE_PACK_BANI_SETS.length,
      queueCount: queueItems.length,
    };
    setOfflinePackStatus({
      active: false,
      sessionId: scopedSessionId,
      step: failed ? 'Prepared with warnings' : 'Ready offline',
      loaded,
      total: tasks.length,
      failed,
      lastRunAt: Date.now(),
    });
    return summary;
  }, [getCachedShabad, selectedShabad, shabadQueue]);

  // Cooldown shared by the manual nav reset AND the auto Waheguru detector.
  // After ANY mode change, block further automatic flips for 3 seconds so
  // transient mistranscriptions don't bounce the projector between modes.
  // 3s is the sweet spot — long enough to avoid jitter, short enough that
  // the cursor lands on the new mode before the user notices a delay.
  const wgModeCooldownRef = useRef(0);
  const MODE_CHANGE_COOLDOWN_MS = 1200;

  // Broadcast projector state on every change. Lives at the top level so it
  // continues to fire even when the user navigates between pages.
  useEffect(() => {
    if (selectedShabad) {
      manualProjectorViewRef.current = { active: false, ts: 0 };
      setProjectorViewModeAuto('shabad');
      // Stamp the auto-detector cooldown so stale "waheguru" tokens from
      // before navigation don't immediately flip the projector back.
      wgModeCooldownRef.current = Date.now();
    }
  }, [selectedShabad?.shabadId, setProjectorViewModeAuto]);

  // Auto-switch projector to Waheguru mode when the sangat / kirtaniya is
  // calling "Waheguru" repeatedly, and back to shabad mode when normal
  // singing resumes. Detection runs on the live transcript using a sliding
  // window of the last ~14 words so it tracks the rhythm of the room.
  //
  //   - Enter Waheguru mode: ≥3 "waheguru" tokens in window AND non-waheguru
  //     content is minimal (≤2 other words, mostly fillers).
  //   - Leave Waheguru mode: ≥3 non-waheguru words appear after we entered
  //     (the kirtaniya has resumed the shabad).
  //
  // Only active while a shabad is selected — there's no point switching
  // to "Waheguru" when the projector is already idle.
  useEffect(() => {
    if (!selectedShabad) return;
    if (projectorEmergency) return;
    // Honor the manual override only while it's still fresh — after
    // MANUAL_OVERRIDE_TTL_MS the auto-detector resumes so the projector
    // doesn't stay stuck after a one-off click.
    {
      const m = manualProjectorViewRef.current;
      if (m?.active && (Date.now() - (m.ts || 0)) < MANUAL_OVERRIDE_TTL_MS) return;
      if (m?.active) manualProjectorViewRef.current = { active: false, ts: 0 };
    }
    const text = projectorTranscript || editableTranscript || '';
    if (!text.trim()) return;

    const tokens = text.split(/\s+/).filter(Boolean).slice(-10);
    if (tokens.length < 2) return; // need a little signal before deciding

    // Cooldown — block any auto-flip for a few seconds after the last one.
    const now = Date.now();
    if (now - wgModeCooldownRef.current < MODE_CHANGE_COOLDOWN_MS) return;

    // Count Waheguru occurrences. Unicode escapes avoid editor/terminal
    // encoding issues with Gurmukhi and Devanagari text.
    const WG_RE = /(\u0a35\u0a3e\u0a39[\u0a3f\u0a47\u0a3e]?\u0a17\u0a41\u0a30|\u0935\u093e\u0939[\u093f\u0947\u093e]?\u0917\u0941\u0930|waheguru|vaheguru|wahiguru|vahiguru|wahaguru|vahaguru)/gi;
    // Exit signal looks at JUST the most recent 6 tokens. As soon as the
    // kirtaniya sings ~4 normal words in a row, return to Shabad view.
    const recent6     = tokens.slice(-6);
    const recent6Text = recent6.join(' ');
    const recent6Wg   = (recent6Text.match(WG_RE) || []).length;
    const recent6Other = Math.max(0, recent6.length - recent6Wg);
    const recent4Text = tokens.slice(-4).join(' ');
    const recent4Wg = (recent4Text.match(WG_RE) || []).length;
    WG_RE.lastIndex = 0;
    const lastTokenIsWg = WG_RE.test(tokens[tokens.length - 1] || '');
    WG_RE.lastIndex = 0;

    if (projectorViewMode !== 'waheguru' && recent4Wg >= 2 && lastTokenIsWg) {
      setProjectorViewModeAuto('waheguru');
      wgModeCooldownRef.current = now;
      pushToast({
        kind: 'info',
        title: 'Waheguru jaap detected',
        message: 'Projector switched to Waheguru — will return to the Shabad when kirtan resumes.',
        timeoutMs: 3500,
      });
    } else if (projectorViewMode === 'waheguru' && recent6Other >= 3 && recent6Wg === 0) {
      setProjectorViewModeAuto('shabad');
      wgModeCooldownRef.current = now;
      pushToast({
        kind: 'success',
        title: 'Shabad resumed',
        message: 'Projector is back on the current line.',
        timeoutMs: 3000,
      });
    }
  }, [editableTranscript, projectorTranscript, projectorViewMode, projectorEmergency, selectedShabad, setProjectorViewModeAuto, pushToast]);

  const buildPayload = () => {
    const emergencyMode = projectorEmergency?.id === 'blank'
      ? 'blank'
      : projectorEmergency
        ? 'emergency'
        : '';
    const mode = emergencyMode || (projectorImage.dataUrl
      ? 'image'
      : projectorViewMode === 'waheguru'
        ? 'idle'
        : selectedShabad
        ? 'shabad'
        : 'idle');
    return {
      mode,
      emergency: projectorEmergency,
      imageDataUrl: projectorImage.dataUrl,
      imageName: projectorImage.name,
      backgroundDataUrl: projectorBackground.dataUrl,
      backgroundName: projectorBackground.name,
      backgroundBrightness: projectorBackground.brightness,
      backgroundTone: projectorBackground.tone,
      backgroundFit: projectorBackground.fit || 'cover',
      projectorPreset,
      fontScale: projectorDisplay.fontScale,
      shabad: selectedShabad,
      activeLine,
      kathaBoundary,
      showTransliteration: display.showTransliteration,
      showEnglish: display.showEnglish,
      showPunjabi: display.showPunjabi,
      larivaar: display.larivaar,
      sangatShareUrl: buildSangatShareUrl(remotePairing?.followCode),
      sangatQrFullscreen,
    };
  };

  // Cheap broadcast on every change (incl. activeLine).
  useEffect(() => {
    projectorPost({ type: 'state', payload: buildPayload() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectorEmergency, projectorImage, projectorBackground, projectorDisplay, projectorPreset, projectorViewMode, selectedShabad, activeLine, kathaBoundary, display.showTransliteration, display.showEnglish, display.showPunjabi, display.larivaar, remotePairing?.followCode, sangatQrFullscreen]);

  useEffect(() => {
    return projectorSubscribe((msg) => {
      if (msg?.type === 'request-state') {
        projectorPost({ type: 'state', payload: buildPayload() });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectorEmergency, projectorImage, projectorBackground, projectorDisplay, projectorPreset, projectorViewMode, selectedShabad, activeLine, kathaBoundary, display.showTransliteration, display.showEnglish, display.showPunjabi, display.larivaar, remotePairing?.followCode, sangatQrFullscreen]);

  // Heavy persist only on the "stable" changes — gives a freshly-opened
  // projector window something to read; the live line gets there via the
  // broadcast above within a frame.
  useEffect(() => {
    projectorPersist(buildPayload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectorEmergency, projectorImage, projectorBackground, projectorDisplay, projectorPreset, projectorViewMode, selectedShabad, display.showTransliteration, display.showEnglish, display.showPunjabi, display.larivaar, remotePairing?.followCode, sangatQrFullscreen]);

  const lastRemoteCommandRef = useRef(0);
  const processedRemoteCommandIdsRef = useRef(new Set());
  const remoteSessionGenerationRef = useRef(0);

  // The voice object from useVoiceRecognition is recreated on every render.
  // We don't want to put it in the polling effect's deps (that would tear
  // down the interval each render), so we mirror it through a ref and read
  // the latest reference inside the command handler.
  const voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  const selectedShabadRef = useRef(selectedShabad);
  useEffect(() => { selectedShabadRef.current = selectedShabad; }, [selectedShabad]);
  const activeLineRef = useRef(activeLine);
  useEffect(() => { activeLineRef.current = activeLine; }, [activeLine]);
  const shabadQueueRef = useRef(shabadQueue);
  useEffect(() => { shabadQueueRef.current = shabadQueue; }, [shabadQueue]);
  useEffect(() => {
    setRemoteLinesExpanded(false);
  }, [selectedShabad?.meta?.shabadId, selectedShabad?.meta?.pageNo, selectedShabad?.meta?.remoteKind]);

  // Pages that own their own viewer-mic (ShabadPage, AngPage) register a
  // getter here so that remote mic-start/stop commands target *that* mic
  // instead of the global one. The getter pattern lets the page mount/
  // unmount without re-running the polling effect.
  const remoteMicTargetGetterRef = useRef(null);
  const setRemoteMicTargetGetter = useCallback((getter) => {
    remoteMicTargetGetterRef.current = typeof getter === 'function' ? getter : null;
  }, []);
  const resolveRemoteMicTarget = () => {
    const getter = remoteMicTargetGetterRef.current;
    if (getter) {
      try {
        const candidate = getter();
        if (candidate) return candidate;
      } catch { /* fall through to global voice */ }
    }
    return voiceRef.current;
  };

  const currentRemoteOpenSnapshot = useCallback(() => {
    const current = selectedShabadRef.current;
    if (!current) return null;
    const meta = current.meta || {};
    const active = activeLineRef.current || {};
    const pageNo = Number(meta.pageNo);
    const shabadId = meta.shabadId || current.shabadId;
    const kind = meta.remoteKind || (meta.pageNo && !current?.navigation?.next ? 'ang' : 'shabad');
    const mainVerse = getMainVerse(current.verses, meta);
    const firstVerse = current.verses?.[0] || null;
    const label = mainVerse?.gurmukhi
      || firstVerse?.gurmukhi
      || meta.title
      || (kind === 'ang' && Number.isFinite(pageNo) ? `Ang ${pageNo}` : 'Previous item');

    if (kind === 'ang' && Number.isFinite(pageNo)) {
      return {
        kind: 'ang',
        pageNo: Math.floor(pageNo),
        source: meta.source || '',
        isKatha: meta.isKatha !== false,
        seedShabadId: meta.seedShabadId || shabadId || '',
        lineIndex: Number.isFinite(Number(active.index)) ? Number(active.index) : null,
        label,
      };
    }
    if (kind === 'bani') {
      const baniId = current.baniSetId || String(shabadId || '').replace(/^bani-/, '');
      if (!baniId) return null;
      return {
        kind: 'bani',
        baniId,
        lineIndex: Number.isFinite(Number(active.index)) ? Number(active.index) : null,
        label,
      };
    }
    if (!shabadId) return null;
    return {
      kind: 'shabad',
      shabadId,
      isKatha: Boolean(meta.isKatha || meta.remoteMode === 'katha'),
      lineIndex: Number.isFinite(Number(active.index)) ? Number(active.index) : null,
      label,
    };
  }, []);

  const pushRemoteOpenSnapshot = useCallback(() => {
    const snapshot = currentRemoteOpenSnapshot();
    if (!snapshot) return;
    const key = snapshot.kind === 'ang'
      ? `ang:${snapshot.pageNo}:${snapshot.source || ''}`
      : `shabad:${snapshot.shabadId}`;
    const latest = remoteOpenHistoryRef.current[0];
    const latestKey = latest?.kind === 'ang'
      ? `ang:${latest.pageNo}:${latest.source || ''}`
      : latest?.shabadId ? `shabad:${latest.shabadId}` : '';
    if (key === latestKey) return;
    remoteOpenHistoryRef.current = [snapshot, ...remoteOpenHistoryRef.current].slice(0, 10);
    setRemoteOpenHistoryVersion((version) => version + 1);
  }, [currentRemoteOpenSnapshot]);

  const popRemoteOpenSnapshot = useCallback(() => {
    const [snapshot, ...rest] = remoteOpenHistoryRef.current;
    remoteOpenHistoryRef.current = rest;
    setRemoteOpenHistoryVersion((version) => version + 1);
    return snapshot || null;
  }, []);

  const navigateToAngFromRemote = useCallback((pageNo, source, isKatha = true, seedShabadId = '', lineIndex = null) => {
    const angNo = Number(pageNo);
    if (!Number.isFinite(angNo) || angNo < 1 || angNo > 1430) return;
    const params = new URLSearchParams();
    if (isKatha) params.set('katha', '1');
    if (source) params.set('source', source);
    const seed = String(seedShabadId || '').replace(/[^0-9A-Za-z_-]/g, '');
    if (seed) params.set('seed', seed);
    const numericLine = Number(lineIndex);
    if (Number.isFinite(numericLine) && numericLine > 0) params.set('line', String(Math.floor(numericLine)));
    const qs = params.toString();
    voiceRef.current?.stop?.();
    navigate(`/ang/${Math.floor(angNo)}${qs ? `?${qs}` : ''}`);
  }, [navigate]);

  const navigateToShabadFromRemote = useCallback((shabadId, isKatha = false, lineIndex = null) => {
    const cleanId = String(shabadId || '').replace(/[^0-9A-Za-z_-]/g, '');
    if (!cleanId) return;
    const params = new URLSearchParams();
    if (isKatha) params.set('katha', '1');
    const numericLine = Number(lineIndex);
    if (Number.isFinite(numericLine) && numericLine > 0) params.set('line', String(Math.floor(numericLine)));
    const qs = params.toString();
    voiceRef.current?.stop?.();
    navigate(`/shabad/${encodeURIComponent(cleanId)}${qs ? `?${qs}` : ''}`);
  }, [navigate]);

  const navigateToBaniFromRemote = useCallback((baniId) => {
    const cleanId = String(baniId || '').replace(/[^0-9A-Za-z_-]/g, '');
    if (!cleanId) return;
    voiceRef.current?.stop?.();
    navigate(`/bani/${encodeURIComponent(cleanId)}`);
  }, [navigate]);

  useEffect(() => {
    const isRemotePage = typeof window !== 'undefined' && window.location.pathname.startsWith('/remote');
    if (isRemotePage) return undefined;

    let cancelled = false;
    // First poll just syncs the cursor — never executes queued commands.
    // Without this, reloading the main app re-runs every command sitting in
    // the in-memory queue (queue-open, line-select, etc.), which caused the
    // page to auto-navigate to whichever shabad was last opened from the
    // phone, sometimes minutes or days ago.
    let firstPollDone = false;
    const runCommand = (command) => {
      const commandId = Number(command?.id);
      if (!Number.isFinite(commandId)) return;
      const processedIds = processedRemoteCommandIdsRef.current;
      if (processedIds.has(commandId)) return;
      processedIds.add(commandId);
      if (processedIds.size > 120) {
        processedRemoteCommandIdsRef.current = new Set(Array.from(processedIds).slice(-80));
      }
      // Second line of defense — even fresh commands older than 10 s are
      // probably stale enough that the user doesn't want them replayed
      // (e.g. they pushed a button on the phone, then reloaded the laptop).
      if (Date.now() - Number(command.createdAt || 0) > 10_000) return;
      const fail = () => {};
      const sessionId = queueSessionIdFor(command.payload?.sessionId || command.payload?.queueSessionId || command.payload?.mode);
      switch (command.type) {
        case 'line-prev':
        case 'line-next':
        case 'line-first':
        case 'line-last':
        case 'resume-live':
          setRemoteLineCommand({
            id: command.id,
            type: command.type,
            createdAt: command.createdAt,
          });
          break;
        case 'line-select': {
          const index = Number(command.payload?.index);
          if (!Number.isFinite(index)) {
            fail('Line number was missing.');
            break;
          }
          setRemoteLineCommand({
            id: command.id,
            type: command.type,
            index: Math.max(0, Math.floor(index)),
            createdAt: command.createdAt,
          });
          break;
        }
        case 'load-more-lines':
          setRemoteLinesExpanded(true);
          break;
        case 'queue-add': {
          const item = command.payload?.item || command.payload || {};
          const kind = item.kind === 'ang' ? 'ang' : 'shabad';
          const pageNo = Number(item.pageNo || item.ang);
          addToQueue?.({
            ...item,
            kind,
            pageNo: Number.isFinite(pageNo) ? Math.floor(pageNo) : item.pageNo,
            queueSessionId: sessionId,
            sessionId,
          });
          break;
        }
        case 'queue-remove': {
          const target = command.payload?.shabadId || command.payload?.id;
          if (target) removeFromQueue?.(target, sessionId);
          break;
        }
        case 'queue-clear':
          clearQueue?.(sessionId);
          break;
        case 'queue-open': {
          const payload = command.payload || {};
          const target = String(payload.shabadId || payload.id || '');
          const item = (shabadQueueRef.current || []).find((entry) =>
            (String(entry.shabadId) === target || String(entry.id || '') === target) &&
            queueSessionIdFor(entry.queueSessionId || entry.sessionId) === sessionId
          ) || payload;
          if (item?.kind === 'ang') {
            const pageNo = Number(item.pageNo || item.ang);
            if (Number.isFinite(pageNo)) {
              pushRemoteOpenSnapshot();
              navigateToAngFromRemote(Math.floor(pageNo), item.source || '', sessionId === 'katha');
            }
            break;
          }
          if (item?.shabadId) {
            pushRemoteOpenSnapshot();
            navigateToShabadFromRemote(item.shabadId, sessionId === 'katha');
          }
          break;
        }
        case 'undo-open': {
          const snapshot = popRemoteOpenSnapshot();
          if (!snapshot) break;
          if (snapshot.kind === 'ang') {
            navigateToAngFromRemote(
              snapshot.pageNo,
              snapshot.source || '',
              snapshot.isKatha !== false,
              snapshot.seedShabadId || '',
              snapshot.lineIndex
            );
          } else if (snapshot.kind === 'bani') {
            navigateToBaniFromRemote(snapshot.baniId);
          } else {
            navigateToShabadFromRemote(snapshot.shabadId, snapshot.isKatha, snapshot.lineIndex);
          }
          break;
        }
        case 'shabad-prev':
        case 'shabad-next': {
          const current = selectedShabadRef.current;
          const targetId = command.type === 'shabad-prev'
            ? current?.navigation?.previous
            : current?.navigation?.next;
          if (!targetId) {
            fail(command.type === 'shabad-prev' ? 'No previous Shabad available.' : 'No next Shabad available.');
            break;
          }
          pushRemoteOpenSnapshot();
          navigateToShabadFromRemote(
            targetId,
            current?.meta?.isKatha || current?.meta?.remoteMode === 'katha'
          );
          break;
        }
        case 'ang-prev':
        case 'ang-next': {
          const current = selectedShabadRef.current;
          const currentAng = Number(current?.meta?.pageNo);
          if (!Number.isFinite(currentAng)) {
            fail('No current Ang is available.');
            break;
          }
          const nextAng = command.type === 'ang-prev' ? currentAng - 1 : currentAng + 1;
          if (nextAng < 1 || nextAng > 1430) {
            fail(command.type === 'ang-prev' ? 'No previous Ang available.' : 'No next Ang available.');
            break;
          }
          pushRemoteOpenSnapshot();
          navigateToAngFromRemote(
            nextAng,
            current?.meta?.source || '',
            current?.meta?.isKatha !== false
          );
          break;
        }
        case 'projector-shabad':
          clearProjectorEmergency();
          setProjectorViewMode('shabad');
          break;
        case 'projector-waheguru':
          setProjectorEmergencyMode('waheguru');
          break;
        case 'projector-blank':
          setProjectorEmergencyMode('blank');
          break;
        case 'projector-mool-mantar':
          setProjectorEmergencyMode('mool-mantar');
          break;
        // 'projector-focus' was removed from the remote UI — browsers block
        // programmatic window.focus() outside of a user gesture in the same
        // window, so it didn't reliably bring the projector forward. Kept
        // in the allowlist on the backend for backward compatibility but
        // ignored here.
        case 'preset-warm':
          applyProjectorPreset?.('warm');
          break;
        case 'preset-contrast':
          applyProjectorPreset?.('contrast');
          break;
        case 'preset-simple':
          applyProjectorPreset?.('simple');
          break;
        case 'font-up':
          setProjectorDisplay((prev) => ({
            ...prev,
            fontScale: Math.min(1.6, Math.round((Number(prev?.fontScale || 1) + 0.05) * 100) / 100),
          }));
          break;
        case 'font-down':
          setProjectorDisplay((prev) => ({
            ...prev,
            fontScale: Math.max(0.7, Math.round((Number(prev?.fontScale || 1) - 0.05) * 100) / 100),
          }));
          break;
        case 'mic-start': {
          const v = resolveRemoteMicTarget();
          if (v && !v.isListening) { v.reset?.(); v.start?.(); }
          break;
        }
        case 'mic-stop': {
          const v = resolveRemoteMicTarget();
          if (v && v.isListening) v.stop?.();
          break;
        }
        case 'mic-toggle': {
          const v = resolveRemoteMicTarget();
          if (!v) break;
          if (v.isListening) v.stop?.();
          else { v.reset?.(); v.start?.(); }
          break;
        }
        case 'open-shabad': {
          const raw = command.payload?.shabadId;
          const isKatha = !!command.payload?.isKatha;
          const lineIndex = Number(command.payload?.lineIndex);
          // Stop the global mic so the new page's viewer mic can take over
          // cleanly — the page's own mount effect resets the global voice
          // already, but doing it here also avoids a flash of stale state.
          if (!raw) {
            fail('Shabad id was missing.');
            break;
          }
          pushRemoteOpenSnapshot();
          navigateToShabadFromRemote(raw, isKatha, lineIndex);
          break;
        }
        case 'open-ang': {
          const angNo = Number(command.payload?.ang || command.payload?.pageNo);
          if (!Number.isFinite(angNo)) {
            fail('Ang number was missing.');
            break;
          }
          pushRemoteOpenSnapshot();
          navigateToAngFromRemote(
            angNo,
            command.payload?.source || '',
            command.payload?.isKatha !== false,
            command.payload?.seedShabadId || command.payload?.shabadId || ''
          );
          break;
        }
        default:
          fail('This remote command is not supported by the main app yet.');
          break;
      }
    };

    let timer = null;
    let delay = 300;
    const poll = async () => {
      try {
        const res = await api.getRemoteCommands(
          lastRemoteCommandRef.current,
          remoteHostIdRef.current,
        );
        const incoming = Array.isArray(res?.commands) ? res.commands : [];
        // On the very first poll, just snap the cursor forward to the
        // latest id without running anything. Otherwise reloading the
        // laptop replays every command still in the in-memory queue —
        // the previous `queue-open` would teleport us back into a Shabad
        // we'd already finished with.
        if (firstPollDone) {
          for (const command of incoming) runCommand(command);
        }
        if (Number(res?.latestId) > lastRemoteCommandRef.current) {
          lastRemoteCommandRef.current = Number(res.latestId);
        }
        firstPollDone = true;
        delay = 300;
      } catch {
        // Remote control is optional; keep the main app quiet if unavailable.
        delay = Math.min(5000, Math.round(delay * 1.6));
      }
    };

    const tick = async () => {
      await poll();
      if (!cancelled) timer = setTimeout(tick, delay);
    };

    // Try Server-Sent Events first — it pushes commands within ~50ms, way
    // faster than the 300ms polling cycle. We still seed a single poll() to
    // sync the cursor (so the first-poll skip behaviour above also applies
    // here), then keep the polling tick disabled while SSE is connected.
    // If SSE fails or the browser doesn't support EventSource, fall back to
    // the polling loop transparently.
    let sse = null;
    const startPolling = () => {
      if (timer || cancelled) return;
      tick();
    };
    const stopPolling = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };

    const trySse = () => {
      if (typeof window === 'undefined' || typeof window.EventSource !== 'function') {
        startPolling();
        return;
      }
      try {
        const base = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
        const params = new URLSearchParams({
          after: String(lastRemoteCommandRef.current),
          hostId: remoteHostIdRef.current || '',
        });
        sse = new EventSource(`${base}/remote/stream?${params.toString()}`);
        sse.addEventListener('command', (ev) => {
          let command = null;
          try { command = JSON.parse(ev.data); } catch { return; }
          if (!command?.id) return;
          if (firstPollDone) runCommand(command);
          if (Number(command.id) > lastRemoteCommandRef.current) {
            lastRemoteCommandRef.current = Number(command.id);
          }
          // Do not mark the stream primed from a command event. The server
          // sends any existing backlog before the cursor event; waiting for
          // that cursor makes SSE skip the whole initial backlog, matching
          // the polling path's first-poll behavior.
        });
        sse.addEventListener('cursor', (ev) => {
          try {
            const { latestId } = JSON.parse(ev.data);
            if (Number(latestId) > lastRemoteCommandRef.current) {
              lastRemoteCommandRef.current = Number(latestId);
            }
            firstPollDone = true;
          } catch { /* ignore */ }
        });
        sse.onerror = () => {
          // EventSource auto-retries, but if the endpoint is unreachable we
          // close it and fall back to polling so the remote still works.
          if (sse) { sse.close(); sse = null; }
          if (!cancelled) startPolling();
        };
      } catch {
        startPolling();
      }
    };

    trySse();
    return () => {
      cancelled = true;
      stopPolling();
      if (sse) { sse.close(); sse = null; }
    };
  }, [
    clearProjectorEmergency, setProjectorEmergencyMode, setProjectorViewMode,
    applyProjectorPreset, setProjectorDisplay, navigateToAngFromRemote, navigateToShabadFromRemote,
    navigateToBaniFromRemote,
    addToQueue, removeFromQueue, clearQueue, pushRemoteOpenSnapshot, popRemoteOpenSnapshot,
  ]);

  // The most recent state we want to publish. Built fresh on every relevant
  // change but never causes a publish by itself — the actual API call runs
  // on a fixed 1s interval below, reading whatever's currently in the ref.
  //
  // Before this, the effect that *did* the publish included `activeLine` in
  // its deps. During live kirtan the line tracker updates activeLine ~5–10×
  // per second, which tore down and re-fired the publish loop each time and
  // immediately exhausted Chrome's per-origin connection slots
  // (ERR_INSUFFICIENT_RESOURCES).
  const remoteStateRef = useRef(null);

  useEffect(() => {
    const isRemotePage = typeof window !== 'undefined' && window.location.pathname.startsWith('/remote');
    if (isRemotePage) return undefined;
    const mainVerse = getMainVerse(selectedShabad?.verses, selectedShabad?.meta);
    const firstVerse = selectedShabad?.verses?.[0] || null;
    const selectedTitle = selectedShabad
      ? (mainVerse?.gurmukhi || firstVerse?.gurmukhi || selectedShabad?.meta?.title || 'Shabad selected')
      : '';
    const selectedMeta = selectedShabad
      ? [selectedShabad?.meta?.raag, selectedShabad?.meta?.writer, selectedShabad?.meta?.source]
        .filter(Boolean)
        .join(' · ')
      : '';
    // Surrounding panktis — current line ± 2 — so the phone shows a small
    // read-along view, not just the headline. Each line is trimmed to keep
    // the publish payload small.
    const verses = Array.isArray(selectedShabad?.verses) ? selectedShabad.verses : [];
    const activeIdx = Number(activeLine?.index ?? -1);
    const cursor = activeIdx >= 0 ? activeIdx : 0;
    const activeVerse = activeIdx >= 0 ? verses[activeIdx] || null : null;
    const meta = selectedShabad?.meta || {};
    const viewerKind = meta.remoteKind || (selectedShabad?.baniSetId ? 'bani' : (meta.pageNo && !selectedShabad?.navigation?.next ? 'ang' : 'shabad'));
    const viewerMode = meta.remoteMode || (meta.isKatha ? 'katha' : 'kirtan');
    const viewerTitle = meta.title || selectedShabad?.baniTitle || selectedShabad?.baniSetTitle || selectedTitle;
    const currentAng = Number(meta.pageNo);
    const hasPreviousShabad = Boolean(selectedShabad?.navigation?.previous);
    const hasNextShabad = Boolean(selectedShabad?.navigation?.next);
    const hasPreviousAng = Number.isFinite(currentAng) && currentAng > 1;
    const hasNextAng = Number.isFinite(currentAng) && currentAng < 1430;
    const windowSize = remoteLinesExpanded ? verses.length : (verses.length < 13 ? verses.length : 10);
    let start = 0;
    let end = verses.length;
    if (verses.length > windowSize) {
      start = Math.max(0, cursor - Math.floor(windowSize / 2));
      end = Math.min(verses.length, start + windowSize);
      start = Math.max(0, end - windowSize);
    }
    const surroundingLines = verses.slice(start, end).map((v, j) => ({
      index: start + j,
      gurmukhi: String(v?.gurmukhi || '').slice(0, 240),
      transliteration: String(v?.transliteration || '').slice(0, 420),
      translationEn: String(v?.translationEn || '').slice(0, 420),
      translationPa: String(v?.translationPa || '').slice(0, 420),
      vishraams: Array.isArray(v?.vishraams) ? v.vishraams : [],
    }));
    const queueItems = (Array.isArray(shabadQueue) ? shabadQueue : []).slice(0, 50).map((item) => ({
      id: item.id || item.shabadId,
      kind: item.kind || 'shabad',
      shabadId: item.shabadId || '',
      pageNo: item.pageNo || null,
      source: item.source || '',
      sessionId: item.queueSessionId || item.sessionId || 'kirtan',
      queueSessionId: item.queueSessionId || item.sessionId || 'kirtan',
      gurmukhi: item.displayGurmukhi || item.gurmukhi || item.firstGurmukhi || item.title || '',
      title: item.title || '',
      raag: item.raag || '',
      writer: item.writer || '',
    }));
    const nextUndoSnapshot = remoteOpenHistoryRef.current[0] || null;
    const projectorView = projectorEmergency?.id === 'blank'
      ? 'blank'
      : projectorEmergency
        ? 'emergency'
        : projectorImage.dataUrl
          ? 'image'
          : projectorViewMode === 'waheguru'
            ? 'waheguru'
            : selectedShabad
              ? 'shabad'
              : 'idle';
    const state = {
      selectedTitle,
      selectedMeta,
      viewerTitle,
      activeLineIndex: activeIdx,
      activeLineText: activeLine?.text || '',
      activeLineTransliteration: activeVerse?.transliteration || '',
      activeLineTranslationEn: activeVerse?.translationEn || '',
      activeLineTranslationPa: activeVerse?.translationPa || '',
      activeLineVishraams: Array.isArray(activeVerse?.vishraams) ? activeVerse.vishraams : [],
      activeLineTotal: verses.length,
      viewerKind,
      viewerMode,
      currentAng: Number.isFinite(currentAng) ? currentAng : null,
      canLoadMore: surroundingLines.length < verses.length,
      shownLineCount: surroundingLines.length,
      hasPreviousShabad,
      hasNextShabad,
      hasPreviousAng,
      hasNextAng,
      projectorMode: projectorEmergency?.label || projectorEmergency?.title || projectorViewMode,
      projectorView,
      emergencyTitle: projectorEmergency?.title || projectorEmergency?.label || '',
      emergencyGurmukhi: projectorEmergency?.gurmukhi || '',
      emergencyTransliteration: projectorEmergency?.transliteration || '',
      projectorPreset,
      fontScale: projectorDisplay.fontScale,
      showTransliteration: display.showTransliteration,
      showEnglish: display.showEnglish,
      showPunjabi: display.showPunjabi,
      larivaar: display.larivaar,
      micListening: Boolean(resolveRemoteMicTarget()?.isListening),
      queueCount: Array.isArray(shabadQueue) ? shabadQueue.length : 0,
      queueItems,
      canUndoOpen: Boolean(nextUndoSnapshot),
      undoOpenLabel: nextUndoSnapshot?.label || '',
      surroundingLines,
    };
    // Stash the freshest state. The publishing loop below reads from this
    // ref on its own cadence, so updating it here is cheap and idempotent.
    remoteStateRef.current = state;
    return undefined;
  }, [activeLine, display.larivaar, display.showEnglish, display.showPunjabi, display.showTransliteration, projectorDisplay.fontScale, projectorEmergency, projectorImage.dataUrl, projectorPreset, projectorViewMode, remoteLinesExpanded, remoteOpenHistoryVersion, selectedShabad, shabadQueue]);

  // Single, steady publish loop — runs every 1s regardless of how often the
  // upstream state changes, with exponential backoff on failure (max 6s).
  // Mounts once per AppProvider lifetime so we never thrash connection slots.
  useEffect(() => {
    const isRemotePage = typeof window !== 'undefined' && window.location.pathname.startsWith('/remote');
    if (isRemotePage) return undefined;

    let cancelled = false;
    let timer = null;
    let delay = 1000;
    const publish = async () => {
      const state = remoteStateRef.current;
      if (!state) return;
      try {
        const result = await api.publishRemoteState({
          ...state,
          remoteHostId: remoteHostIdRef.current,
          hostToken: remoteHostTokenRef.current,
          micListening: Boolean(resolveRemoteMicTarget()?.isListening),
        });
        if (!cancelled && result?.session) {
          if (result.session.hostToken) {
            remoteHostTokenRef.current = result.session.hostToken;
            saveRemoteHostToken(result.session.hostToken);
          }
          const generation = Number(result.session.generatedAt || 0);
          if (generation && generation !== remoteSessionGenerationRef.current) {
            remoteSessionGenerationRef.current = generation;
            lastRemoteCommandRef.current = 0;
            processedRemoteCommandIdsRef.current = new Set();
          }
          setRemotePairing(remotePairingFromSession(result.session));
        }
        delay = 1000;
      } catch {
        delay = Math.min(6000, Math.round(delay * 1.6));
      }
    };
    const tick = async () => {
      await publish();
      if (!cancelled) timer = setTimeout(tick, delay);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply theme to document root so CSS variables can switch
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme.variant;
    root.dataset.accent = theme.accent;
    saveTheme(theme);
  }, [theme]);

  const setTheme = useCallback((patch) => {
    setThemeState((t) => ({ ...t, ...patch }));
  }, []);

  const updateFilters = useCallback((patch) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);

  const updateDisplay = useCallback((patch) => {
    setDisplay((d) => ({ ...d, ...patch }));
  }, []);

  // Mirror the live voice transcript into the editable state, but ONLY while
  // listening — once the user stops, their edits are preserved.
  useEffect(() => {
    if (voice.isListening) {
      setEditableTranscript(voice.transcript);
    }
  }, [voice.transcript, voice.isListening]);

  const activeTranscript = editableTranscript;

  const value = useMemo(
    () => ({
      voice,
      editableTranscript, setEditableTranscript,
      activeTranscript,
      filters, updateFilters, display, updateDisplay,
      lang, setLang, tLang,
      theme, setTheme,
      toasts, pushToast, dismissToast,
      selectedShabad, setSelectedShabad,
      activeLine, setActiveLine,
      remoteLineCommand,
      remotePairing, resetRemotePairing, approveRemoteControlRequest, kickRemoteClient,
      sangatQrFullscreen, setSangatQrFullscreen,
      kathaBoundary, setKathaBoundary,
      observeProjectorTranscript,
      projectorViewMode, setProjectorViewMode,
      projectorEmergency, setProjectorEmergencyMode, clearProjectorEmergency,
      projectorImage, setProjectorImage,
      projectorBackground, setProjectorBackground,
      projectorDisplay, setProjectorDisplay,
      projectorPreset, applyProjectorPreset,
      openProjector, focusProjector, projectorWindowOpen,
      kathaStayInCurrent, setKathaStayInCurrent,
      searchState, updateSearchState,
      kathaSearchState, updateKathaSearchState,
      shabadQueue, addToQueue, removeFromQueue, clearQueue, moveQueueItem, reorderQueueItem, updateQueueItemSession,
      queuePreloadStatus, preloadQueueSession, offlinePackStatus, preloadOfflineSessionPack, getCachedShabad,
      shabadHistory, pushShabadHistory, clearShabadHistory, removeShabadHistory,
      shabadFavourites,
      isShabadFavourite,
      addShabadFavourite,
      removeShabadFavourite,
      toggleShabadFavourite,
      clearShabadFavourites,
      libraryOpen, openLibrary, closeLibrary, toggleLibrary,
      setRemoteMicTargetGetter,
    }),
    [voice, editableTranscript, activeTranscript, filters, updateFilters,
     display, updateDisplay,
     lang, setLang, tLang,
     theme, setTheme,
     toasts, pushToast, dismissToast,
     selectedShabad, activeLine, remoteLineCommand, remotePairing, resetRemotePairing, approveRemoteControlRequest, kickRemoteClient, sangatQrFullscreen, setSangatQrFullscreen, kathaBoundary, observeProjectorTranscript, projectorViewMode, projectorEmergency, setProjectorEmergencyMode, clearProjectorEmergency, projectorImage, projectorBackground, projectorDisplay, projectorPreset, applyProjectorPreset,
     openProjector, focusProjector, projectorWindowOpen,
     kathaStayInCurrent, setKathaStayInCurrent,
     searchState, updateSearchState, kathaSearchState, updateKathaSearchState,
     shabadQueue, addToQueue, removeFromQueue, clearQueue, moveQueueItem, reorderQueueItem, updateQueueItemSession,
     queuePreloadStatus, preloadQueueSession, offlinePackStatus, preloadOfflineSessionPack, getCachedShabad,
     shabadHistory, pushShabadHistory, clearShabadHistory, removeShabadHistory,
     shabadFavourites, isShabadFavourite, addShabadFavourite, removeShabadFavourite,
     toggleShabadFavourite, clearShabadFavourites,
     libraryOpen, openLibrary, closeLibrary, toggleLibrary,
     setRemoteMicTargetGetter]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
