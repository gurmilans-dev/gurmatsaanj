import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SearchBar from '../../features/search/SearchBar';
import SearchResults from '../../features/search/SearchResults';
import ShabadSuggestions from '../../features/voiceRecognition/ShabadSuggestions';
import FilterPanel from '../../features/filters/FilterPanel';
import ProjectorControls from '../../features/projector/ProjectorControls';
import CalendarTodayBanner from '../../features/calendar/CalendarTodayBanner';
import KirtanGuidancePanel from '../../features/kirtan/KirtanGuidancePanel';
import DailyHukamCard from '../../features/hukam/DailyHukamCard';
import SemanticReadyNotice from '../../features/search/SemanticReadyNotice';
import SemanticThemeChips from '../../features/search/SemanticThemeChips';
import AudioVerifiedChip from '../../features/audio/AudioVerifiedChip';
import { isSemanticReady, loadSemanticSearch, semanticSearch } from '../../services/semanticSearch';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import useShabadMatching from '../../hooks/useShabadMatching';
import useWakeLock from '../../hooks/useWakeLock';
import { displayLineForEntry, trimToWords } from '../../utils/gurmukhi';
import { addRecentSearch, clearRecentSearches, loadRecentSearches, removeRecentSearch } from '../../utils/recentSearches';
import './SearchPage.css';

// Search modes (UI) — translated to BaniDB searchType numbers in the request.
//   auto     → let the backend auto-detect (default).
//   words    → entire words. Picks type 2 (Gurmukhi) or 4 (Roman) based on
//              the script of the query, never first-letter (0).
//   initials → first-letter shorthand like "mjjj" (always type 0).
//   ang      → Ang / page lookup. Query must be a number; sends searchType=5.
const GURMUKHI_RE = /[਀-੿]/;
function searchTypeFor(mode, query) {
  if (mode === 'initials') return 0;
  if (mode === 'words')    return GURMUKHI_RE.test(query) ? 2 : 4;
  if (mode === 'ang')      return 5;
  return undefined; // auto
}

function searchTypeForKatha(mode, query) {
  const q = String(query || '').trim();
  if (/^[0-9]+$/.test(q) || mode === 'ang') return 5;
  return searchTypeFor(mode, q);
}

// Ang ranges per Granth (sanity-check the user's input).
const ANG_MIN = 1;
const ANG_MAX_SAFE = 1430;

const FORCE_MODES = [
  { id: 'auto',     label: 'Auto',         hint: 'Detect from what you type' },
  { id: 'words',    label: 'Entire words', hint: 'Match full Gurmukhi or Roman words' },
  { id: 'initials', label: 'Initials',     hint: 'First-letter shorthand, e.g. mjjj' },
  { id: 'ang',      label: 'Ang',          hint: 'Open by Ang / page number' },
  { id: 'meaning',  label: 'By meaning ✦', hint: 'Find shabads by theme — English, Punjabi, or Gurmukhi' },
];

const SEMANTIC_READY_KEY = 'saanj-kirtan.semanticReady';

// ─── Sub-components ────────────────────────────────────────────────────────

const MicGlyph = () => (
  <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
    <path d="M16 4a4 4 0 0 0-4 4v8a4 4 0 0 0 8 0V8a4 4 0 0 0-4-4Z" fill="currentColor" />
    <path d="M8 14v2a8 8 0 0 0 16 0v-2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M16 24v4M11 28h10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

const OfflineIcon = () => (
  <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
    <path d="M3.6 5 9 2.4 14.4 5v4.7c0 3.4-2.2 5.5-5.4 6.8-3.2-1.3-5.4-3.4-5.4-6.8V5Z" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
    <path d="m6.4 9 1.8 1.8 3.5-4" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FilterGlyph = () => (
  <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
    <path d="M3.5 5h13M6 10h8M8.5 15h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/**
 * Compact one-row offline-pack strip. Three states:
 *  - prompt: "Prepare for offline use" + [Prepare] button (kesari-tinted, prominent)
 *  - preparing: same shape, button disabled with progress text
 *  - ready: slim status pill "✓ Ready offline · N items" + quiet Refresh link
 *
 * Lives directly below the hero so a first-time visitor sees it without
 * scrolling — preparing offline is the second thing they should do.
 */
function OfflineSessionPackStrip({ isKatha, queueCount, status, onPrepare }) {
  const active = Boolean(status?.active);
  const prepared = !active && status?.lastRunAt;

  if (prepared) {
    return (
      <div className="search-offline-strip search-offline-strip-ready" aria-label="Offline session pack ready">
        <span className="search-offline-strip-icon" aria-hidden="true"><OfflineIcon /></span>
        <span className="search-offline-strip-ready-text">
          <strong>Ready offline</strong>
          <small>{status.loaded} items cached for this session</small>
        </span>
        <button type="button" className="btn-ghost search-offline-strip-refresh" onClick={onPrepare} disabled={active}>
          Refresh
        </button>
      </div>
    );
  }

  const subtitle = active
    ? `Preparing… ${status.loaded || 0} / ${status.total || 0}`
    : queueCount > 0
      ? `Cache ${queueCount} ${isKatha ? 'Katha' : 'Kirtan'} queue item${queueCount === 1 ? '' : 's'}, banis, and main screens for offline use`
      : 'Cache banis, main screens, and projector assets so this session works without network';

  return (
    <div className="search-offline-strip search-offline-strip-prompt" aria-label="Offline session pack">
      <span className="search-offline-strip-icon" aria-hidden="true"><OfflineIcon /></span>
      <span className="search-offline-strip-body">
        <strong>{active ? 'Preparing offline pack' : 'Prepare for offline use'}</strong>
        <small>{subtitle}</small>
      </span>
      <button
        type="button"
        className="btn btn-primary btn-sm search-offline-strip-button"
        onClick={onPrepare}
        disabled={active}
      >
        {active ? '…' : 'Prepare'}
      </button>
    </div>
  );
}

/**
 * Empty state — Recent + Favourites only (no examples chips anymore).
 * Stacks vertically on mobile, 2-column on desktop.
 */
function SearchQuickAccess({ history, favourites, isKatha, onOpen, getItemTarget }) {
  const recent = history.slice(0, 4);
  const saved = favourites.slice(0, 4);

  return (
    <section className="search-quick" aria-label="Quick access">
      <div className="search-quick-grid">
        <QuickList
          title={isKatha ? 'Katha recent' : 'Kirtan recent'}
          empty={isKatha ? 'Katha Shabads and Angs will appear here.' : 'Kirtan Shabads will appear here.'}
          items={recent}
          onOpen={onOpen}
          getItemTarget={getItemTarget}
        />
        <QuickList
          title="Favourites"
          empty="Saved Shabads will appear here."
          items={saved}
          onOpen={onOpen}
          getItemTarget={getItemTarget}
        />
      </div>
    </section>
  );
}

function QuickList({ title, empty, items, onOpen, getItemTarget }) {
  return (
    <section className="search-quick-list" aria-label={title}>
      <div className="search-quick-head">
        <h2>{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="search-quick-empty">{empty}</p>
      ) : (
        <ul>
          {items.map((item, index) => (
            <li key={`${item.shabadId}-${item.openedAt ?? item.addedAt ?? index}`}>
              <Link
                className="search-quick-link"
                to={getItemTarget?.(item) || `/shabad/${encodeURIComponent(item.shabadId)}`}
                onClick={onOpen}
              >
                <span className="search-quick-gurmukhi gurmukhi">
                  {trimToWords(displayLineForEntry(item) || item.shabadId, 8)}
                </span>
                <span className="search-quick-meta">
                  {[item.raag, item.writer, item.source].filter(Boolean).join(' · ') || 'Open Shabad'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function SearchPage({ experience = 'kirtan' }) {
  const isKatha = experience === 'katha';
  const {
    filters, pushToast, setSelectedShabad,
    searchState, updateSearchState,
    kathaSearchState, updateKathaSearchState,
    shabadHistory, shabadFavourites, openProjector,
    shabadQueue, offlinePackStatus, preloadOfflineSessionPack,
    voice,
    lang, tLang,
  } = useApp();
  const activeSessionId = isKatha ? 'katha' : 'kirtan';
  const currentState = isKatha ? kathaSearchState : searchState;
  const updateCurrentSearchState = isKatha ? updateKathaSearchState : updateSearchState;
  const { query, mode: searchMode, results, detectedType, openAs = 'shabad' } = currentState;
  const setQuery      = (q) => updateCurrentSearchState({ query: q });
  const setSearchMode = (m) => updateCurrentSearchState({ mode: m });
  const setOpenAs     = (m) => updateCurrentSearchState({ openAs: m });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [lastVoiceSuggestions, setLastVoiceSuggestions] = useState([]);
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPopoverRef = useRef(null);

  // Semantic ("By meaning") search state. The model + embeddings download
  // is heavy (~40 MB) so we only kick it off the first time the user picks
  // the mode. semanticReady persists across visits via localStorage so we
  // skip the loading notice once it's been set up.
  //   phase: 'idle' (untouched) | 'loading' | 'ready' | 'error'
  const [semanticPhase, setSemanticPhase] = useState(() => {
    try { return localStorage.getItem(SEMANTIC_READY_KEY) === '1' ? 'ready' : 'idle'; }
    catch { return 'idle'; }
  });
  const [semanticProgress, setSemanticProgress] = useState({ phase: 'data', loaded: 0, total: 3 });
  const [semanticError, setSemanticError] = useState('');
  const [semanticRetryToken, setSemanticRetryToken] = useState(0);
  const isMeaning = searchMode === 'meaning';

  // Recent searches dropdown — shown when the search input has focus and is
  // empty. Saves only after the user stops typing for a moment (see the
  // RECENT_SAVE_DELAY_MS effect below) so intermediate keystrokes like
  // "j", "ja", "jap" don't all end up in the list.
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const showRecentSearches =
    searchInputFocused
    && !voice.isListening
    && (query || '').trim().length === 0
    && recentSearches.length > 0;
  const filterToggleRef = useRef(null);

  const activeFilterCount =
    (filters.source ? 1 : 0) + (filters.writer ? 1 : 0) + (filters.raag ? 1 : 0);

  // Close the popover on outside click or Escape.
  useEffect(() => {
    if (!filtersOpen) return undefined;
    const onPointer = (event) => {
      const pop = filterPopoverRef.current;
      const btn = filterToggleRef.current;
      if (pop && pop.contains(event.target)) return;
      if (btn && btn.contains(event.target)) return;
      setFiltersOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen]);

  const liveMatching = useShabadMatching(voice.transcript, filters, {
    active: voice.isListening,
    intervalMs: 450,
  });

  // Keep the screen awake while the mic is live (sing/listen sessions).
  useWakeLock(voice.isListening);
  const frozenVoiceActive =
    !voice.isListening &&
    lastVoiceSuggestions.length > 0 &&
    (query || '').trim() === (lastVoiceTranscript || '').trim();
  const showVoiceSuggestions = voice.isListening || frozenVoiceActive;
  const showQuickAccess = !loading && !error && !(query || '').trim() && !voice.isListening;

  const modeHistory = useMemo(() => {
    const items = Array.isArray(shabadHistory) ? shabadHistory : [];
    if (isKatha) return items.filter((item) => item.mode === 'katha');
    return items.filter((item) => (item.mode || 'kirtan') !== 'katha' && item.kind !== 'ang');
  }, [isKatha, shabadHistory]);

  const activeQueueCount = useMemo(() => {
    const items = Array.isArray(shabadQueue) ? shabadQueue : [];
    return items.filter((item) => (item.queueSessionId || item.sessionId || 'kirtan') === activeSessionId).length;
  }, [activeSessionId, shabadQueue]);

  const currentOfflinePackStatus = offlinePackStatus?.sessionId === activeSessionId
    ? offlinePackStatus
    : {
        active: false,
        sessionId: activeSessionId,
        step: '',
        loaded: 0,
        total: 0,
        failed: 0,
        lastRunAt: 0,
      };

  // Contextual "did you mean…" chip. Only renders when auto-detect probably
  // got the user's intent wrong, so the 4-mode picker stays out of the way.
  const modeFixChip = useMemo(() => {
    const q = (query || '').trim();
    if (voice.isListening || !q) return null;
    // Numeric-only in non-Ang mode → likely an Ang lookup
    if (searchMode !== 'ang' && /^[0-9]+$/.test(q)) {
      const n = Number(q);
      if (Number.isFinite(n) && n >= ANG_MIN && n <= ANG_MAX_SAFE) {
        return {
          label: tLang(`Open Ang ${n}`, `ਅੰਗ ${n} ਖੋਲ੍ਹੋ`),
          apply: () => setSearchMode('ang'),
        };
      }
    }
    // Short all-lowercase roman in auto → likely initials shorthand
    if (searchMode === 'auto' && /^[a-z]{3,5}$/.test(q) && !GURMUKHI_RE.test(q)) {
      return {
        label: tLang('Search by initials', 'ਆਦਿ-ਅੱਖਰਾਂ ਨਾਲ ਖੋਜੋ'),
        apply: () => setSearchMode('initials'),
      };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchMode, voice.isListening, tLang]);

  // Save to recent searches only after the user has paused typing for a
  // moment AND the current query produced results. Any keystroke resets
  // the timer, so "j", "ja", "jap" never get saved on the way to "japji".
  useEffect(() => {
    if (voice.isListening) return undefined;
    const q = (query || '').trim();
    if (!q) return undefined;
    const id = setTimeout(() => {
      if ((results?.length || 0) > 0) {
        setRecentSearches(addRecentSearch(q, { mode: searchMode }));
      }
    }, 1800);
    return () => clearTimeout(id);
  }, [query, results, searchMode, voice.isListening]);

  // While searching, projector stays idle (Waheguru) until a Shabad is opened.
  useEffect(() => {
    setSelectedShabad(null);
  }, [setSelectedShabad]);

  // The mic on this page is for *continuous* singing/listening, not the
  // 7-word "let me detect a Shabad" auto-stop used elsewhere. Disable the
  // word limit while the page is mounted; restore it on unmount.
  useEffect(() => {
    voice.setWordLimit?.(0);
    return () => {
      voice.stop?.();
      voice.reset?.();
      voice.setWordLimit?.(7);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!voice.isListening) return;
    setQuery(voice.transcript || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.isListening, voice.transcript]);

  useEffect(() => {
    if (!voice.isListening) return;
    if ((voice.transcript || '').trim()) {
      setLastVoiceTranscript(voice.transcript || '');
    }
    if (liveMatching.suggestions?.length > 0) {
      setLastVoiceSuggestions(liveMatching.suggestions);
    }
  }, [voice.isListening, voice.transcript, liveMatching.suggestions]);

  // Kick off the semantic load the FIRST time the user picks 'meaning' mode.
  // Idempotent — subsequent picks just no-op against the cached singleton.
  useEffect(() => {
    if (!isMeaning) return undefined;
    if (isSemanticReady()) {
      setSemanticPhase('ready');
      try { localStorage.setItem(SEMANTIC_READY_KEY, '1'); } catch { /* noop */ }
      return undefined;
    }
    let cancelled = false;
    setSemanticPhase('loading');
    setSemanticError('');
    loadSemanticSearch((info) => {
      if (cancelled) return;
      setSemanticProgress(info);
    })
      .then(() => {
        if (cancelled) return;
        setSemanticPhase('ready');
        try { localStorage.setItem(SEMANTIC_READY_KEY, '1'); } catch { /* noop */ }
      })
      .catch((err) => {
        if (cancelled) return;
        setSemanticPhase('error');
        setSemanticError(err?.message || 'Could not load smart search.');
      });
    return () => { cancelled = true; };
  }, [isMeaning, semanticRetryToken]);

  useEffect(() => {
    const q = (query || '').trim();
    if (voice.isListening) {
      setLoading(liveMatching.loading);
      setError(liveMatching.error);
      return undefined;
    }
    // 'meaning' mode routes through the in-browser semantic pipeline
    // instead of the BaniDB keyword search. We only fire once the runtime
    // is ready — until then the SemanticReadyNotice covers the results
    // area with a progress bar.
    if (isMeaning) {
      if (semanticPhase !== 'ready') {
        updateCurrentSearchState({ results: [], detectedType: null });
        setLoading(false);
        setError(null);
        return undefined;
      }
      if (q.length < 2) {
        updateCurrentSearchState({ results: [], detectedType: null });
        setError(null);
        setLoading(false);
        return undefined;
      }
      let cancelled = false;
      setLoading(true);
      setError(null);
      semanticSearch(q, {
        source: filters.source || undefined,
        writer: filters.writer || undefined,
        raag:   filters.raag   || undefined,
      })
        .then((rows) => {
          if (cancelled) return;
          updateCurrentSearchState({ results: rows || [], detectedType: 'meaning' });
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err?.message || 'Smart search failed');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => { cancelled = true; };
    }
    const isAngQuery = isKatha
      ? (searchMode === 'ang' || /^[0-9]+$/.test(q))
      : searchMode === 'ang';
    if (isAngQuery) {
      if (!q || !/^[0-9]+$/.test(q)) {
        updateCurrentSearchState({ results: [], detectedType: null });
        setError(null);
        setLoading(false);
        return undefined;
      }
      const n = Number(q);
      if (!Number.isFinite(n) || n < ANG_MIN || n > ANG_MAX_SAFE) {
        updateCurrentSearchState({ results: [], detectedType: null });
        setError(`Ang must be between ${ANG_MIN} and ${ANG_MAX_SAFE}.`);
        setLoading(false);
        return undefined;
      }
    } else if (q.length < 2) {
      updateCurrentSearchState({ results: [], detectedType: null });
      setError(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .searchShabads({
        q,
        source: filters.source || undefined,
        writer: filters.writer || undefined,
        raag: filters.raag || undefined,
        searchType: isKatha ? searchTypeForKatha(searchMode, q) : searchTypeFor(searchMode, q),
      })
      .then((res) => {
        if (cancelled) return;
        updateCurrentSearchState({
          results: res.results || [],
          detectedType: res.detectedType,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.response?.data?.error
          || (err?.code === 'ERR_NETWORK' ? 'Connection to backend lost. Reconnecting...' : null)
          || err.message
          || 'Search failed';
        setError(msg);
        pushToast({ kind: 'error', title: 'Search failed', message: msg });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [query, filters, searchMode, isKatha, voice.isListening, liveMatching.loading, liveMatching.error, pushToast, updateCurrentSearchState, isMeaning, semanticPhase]);

  const handleMicToggle = () => {
    if (!voice.isSupported) return;
    if (voice.isListening) {
      voice.stop?.();
      return;
    }
    voice.reset?.();
    setLastVoiceSuggestions([]);
    setLastVoiceTranscript('');
    voice.setWordLimit?.(0);
    setQuery('');
    voice.start?.();
  };
  const handleQueryChange = (nextQuery) => {
    setQuery(nextQuery);
    if ((nextQuery || '').trim() !== (lastVoiceTranscript || '').trim()) {
      setLastVoiceSuggestions([]);
    }
  };
  const handleGuideSuggestion = (suggestion) => {
    voice.stop?.();
    voice.reset?.();
    setLastVoiceSuggestions([]);
    setLastVoiceTranscript('');
    setSearchMode(suggestion.mode || 'words');
    setQuery(suggestion.query || '');
  };
  const quickItemTarget = (item) => {
    if (!item?.shabadId) return '/kirtan';
    if (!isKatha) return `/shabad/${encodeURIComponent(item.shabadId)}`;
    const qs = new URLSearchParams({ katha: '1' });
    if (openAs === 'ang' && item.pageNo) {
      return `/ang/${encodeURIComponent(item.pageNo)}?${qs.toString()}`;
    }
    return `/shabad/${encodeURIComponent(item.shabadId)}?${qs.toString()}`;
  };
  const stopMainMic = () => {
    voice.stop?.();
    voice.reset?.();
  };
  const prepareOfflinePack = async () => {
    const summary = await preloadOfflineSessionPack?.(activeSessionId);
    const loaded = Number(summary?.loaded || 0);
    const failed = Number(summary?.failed || 0);
    const total = Number(summary?.total || 0);
    pushToast?.({
      kind: failed ? 'info' : 'success',
      title: failed ? 'Offline pack partly ready' : 'Offline pack ready',
      message: failed
        ? `${loaded} of ${total} items prepared. ${failed} could not be cached now.`
        : `${loaded} items prepared for smoother offline use.`,
      timeoutMs: 4200,
    });
  };

  const micButton = voice.isSupported ? (
    <button
      type="button"
      className={`search-hero-mic${voice.isListening ? ' search-hero-mic-on' : ''}`}
      onClick={handleMicToggle}
      aria-pressed={voice.isListening}
      aria-label={voice.isListening ? 'Stop mic' : 'Start mic'}
      title={voice.isListening ? 'Stop mic' : 'Start mic · sing or speak'}
    >
      <span className="search-hero-mic-pulse" aria-hidden="true" />
      <span className="search-hero-mic-pulse search-hero-mic-pulse-2" aria-hidden="true" />
      <span className="search-hero-mic-glyph"><MicGlyph /></span>
    </button>
  ) : null;

  return (
    <div className="app-container search-page">
      <CalendarTodayBanner />

      <div className="search-page-grid">
        <div className="search-page-main">

          {/* ── HERO ───────────────────────────────────────────────────── */}
          <section className="search-hero" aria-label={`${isKatha ? 'Katha' : 'Kirtan'} search`}>
            <div className="search-hero-head">
              <div className="search-hero-head-titles">
                <p className="section-eyebrow" lang={lang}>
                  {isKatha
                    ? tLang('Live commentary', 'ਲਾਈਵ ਕਥਾ')
                    : tLang('Live kirtan', 'ਲਾਈਵ ਕੀਰਤਨ')}
                </p>
                <h1 className="search-hero-title" lang={lang}>
                  {voice.isListening
                    ? tLang('Listening…', 'ਸੁਣ ਰਿਹਾ ਹੈ…')
                    : tLang('Sing or search', 'ਗਾਓ ਜਾਂ ਖੋਜੋ')}
                </h1>
              </div>

              <button
                ref={filterToggleRef}
                type="button"
                className={`search-filter-toggle${filtersOpen ? ' search-filter-toggle-on' : ''}`}
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
                aria-controls="search-filter-popover"
                aria-label={
                  activeFilterCount
                    ? `Search filters (${activeFilterCount} active)`
                    : 'Search filters'
                }
                title="Filters and match options"
              >
                <FilterGlyph />
                {activeFilterCount > 0 && (
                  <span className="search-filter-badge" aria-hidden="true">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>

            {/* Live transcript above the input while the mic is on */}
            {voice.isListening && voice.transcript && (
              <p className="search-hero-transcript gurmukhi" aria-live="polite">
                {voice.transcript}
              </p>
            )}

            <div
              className="search-hero-input-wrap"
              // React's focus/blur are delegated so attaching here catches the
              // inner SearchBar input. relatedTarget lets us avoid closing the
              // dropdown when focus moves to a dropdown item (which is a child
              // of this wrapper).
              onFocus={() => setSearchInputFocused(true)}
              onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                setSearchInputFocused(false);
              }}
            >
              <SearchBar
                value={query}
                onSearch={handleQueryChange}
                onClear={() => {
                  voice.stop?.();
                  voice.reset?.();
                  setQuery('');
                  setLastVoiceSuggestions([]);
                  setLastVoiceTranscript('');
                }}
                inputMode={searchMode === 'ang' ? 'numeric' : undefined}
                placeholder={tLang(
                  'Type a pankti, mjjj initials, or an Ang number…',
                  'ਪੰਕਤੀ, mjjj ਆਦਿ-ਅੱਖਰ ਜਾਂ ਅੰਗ ਨੰਬਰ ਟਾਈਪ ਕਰੋ…',
                )}
                showHint={false}
                showSubmit={false}
                trailing={micButton}
              />

              {showRecentSearches && (
                <div className="search-recent" role="listbox" aria-label={tLang('Recent searches', 'ਹਾਲ ਦੀਆਂ ਖੋਜਾਂ')}>
                  <div className="search-recent-head">
                    <span className="search-recent-eyebrow" lang={lang}>
                      {tLang('Recent searches', 'ਹਾਲ ਦੀਆਂ ਖੋਜਾਂ')}
                    </span>
                    <button
                      type="button"
                      className="search-recent-clear"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setRecentSearches(clearRecentSearches())}
                      lang={lang}
                    >
                      {tLang('Clear', 'ਮਿਟਾਓ')}
                    </button>
                  </div>
                  <ul className="search-recent-list">
                    {recentSearches.map((entry) => (
                      <li key={entry.query}>
                        <button
                          type="button"
                          role="option"
                          className="search-recent-item"
                          // Prevent the input's blur from firing before our click
                          // handler runs and closes the dropdown.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            handleQueryChange(entry.query);
                            setSearchInputFocused(false);
                          }}
                          lang={lang}
                        >
                          <span className="search-recent-item-text">{entry.query}</span>
                          <span
                            className="search-recent-item-remove"
                            role="button"
                            tabIndex={-1}
                            aria-label={`Remove ${entry.query}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => {
                              event.stopPropagation();
                              setRecentSearches(removeRecentSearch(entry.query));
                            }}
                          >
                            ×
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {modeFixChip && (
              <div className="search-mode-fix-row">
                <button
                  type="button"
                  className="search-mode-fix-chip"
                  onClick={modeFixChip.apply}
                  title={modeFixChip.label}
                >
                  {modeFixChip.label}
                  <span aria-hidden="true">  →</span>
                </button>
              </div>
            )}

            {filtersOpen && (
              <div
                ref={filterPopoverRef}
                id="search-filter-popover"
                className="search-filter-popover"
                role="dialog"
                aria-label="Search filters"
              >
                <div className="search-filter-popover-head">
                  <div>
                    <p className="section-eyebrow">Search filters</p>
                    <small>Granth, writer, raag, and match type</small>
                  </div>
                  <button
                    type="button"
                    className="search-filter-popover-close"
                    onClick={() => setFiltersOpen(false)}
                    aria-label="Close filters"
                  >
                    ×
                  </button>
                </div>

                <FilterPanel compact />

                <div className="search-filter-options" aria-label="Search options">
                  {isKatha && (
                    <section className="search-filter-option">
                      <span className="search-filter-option-label">Open as</span>
                      <div className="search-mode-segs" role="radiogroup" aria-label="Open results as">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={openAs === 'shabad'}
                          className={`search-mode-seg${openAs === 'shabad' ? ' search-mode-seg-on' : ''}`}
                          onClick={() => setOpenAs('shabad')}
                        >
                          Shabad
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={openAs === 'ang'}
                          className={`search-mode-seg${openAs === 'ang' ? ' search-mode-seg-on' : ''}`}
                          onClick={() => setOpenAs('ang')}
                        >
                          Full Ang
                        </button>
                      </div>
                    </section>
                  )}

                  <section className="search-filter-option">
                    <span className="search-filter-option-label">Match by</span>
                    <div className="search-mode-segs" role="radiogroup" aria-label="Search mode">
                      {FORCE_MODES.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          role="radio"
                          aria-checked={searchMode === m.id}
                          className={`search-mode-seg${searchMode === m.id ? ' search-mode-seg-on' : ''}`}
                          onClick={() => setSearchMode(m.id)}
                          title={m.hint}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            )}
          </section>

          {/* ── FILTERS — sit right below the hero so they feel like a
              part of the search action, not a separate setting. ──────── */}
         

          {/* ── OFFLINE PACK STRIP — second-most-prominent slot ────────── */}
          <OfflineSessionPackStrip
            isKatha={isKatha}
            queueCount={activeQueueCount}
            status={currentOfflinePackStatus}
            onPrepare={prepareOfflinePack}
          />
          <div className="search-setup-link-row">
            <AudioVerifiedChip />
            <Link className="search-setup-link" to="/setup">
              <span aria-hidden="true">🎛</span>{' '}
              <span lang={lang}>{tLang('Audio & session setup', 'ਆਡੀਓ ਤੇ ਸੈਸ਼ਨ ਸੈੱਟਅੱਪ')}</span>
            </Link>
          </div>

          {/* ── CONTENT SLOT — voice suggestions / results / empty state ── */}
          {showVoiceSuggestions ? (
            <ShabadSuggestions
              suggestions={voice.isListening ? liveMatching.suggestions : lastVoiceSuggestions}
              loading={voice.isListening ? liveMatching.loading : false}
              error={voice.isListening ? liveMatching.error : null}
              transcript={voice.isListening ? voice.transcript : lastVoiceTranscript}
              sessionId={isKatha ? 'katha' : 'kirtan'}
            />

          ) : isMeaning && semanticPhase !== 'ready' ? (
            // Loading or error — covers the whole results area with a
            // progress bar (or retry / fallback CTAs on error).
            <SemanticReadyNotice
              progress={semanticProgress}
              error={semanticPhase === 'error' ? (semanticError || 'Could not load smart search.') : ''}
              onRetry={() => {
                setSemanticPhase('idle');
                setSemanticError('');
                setSemanticRetryToken((value) => value + 1);
              }}
              onUseKeyword={() => setSearchMode('auto')}
            />

          ) : isMeaning && !(query || '').trim() ? (
            // Ready + empty input → show the theme chips so the user has
            // a one-tap path to a useful query.
            <div className="search-empty-state">
              <SemanticThemeChips
                lang={lang}
                onPick={(chip) => {
                  setRecentSearches(addRecentSearch(chip.seed, { mode: 'meaning' }));
                  handleQueryChange(chip.seed);
                }}
              />
              <DailyHukamCard sessionId={isKatha ? 'katha' : 'kirtan'} />
            </div>

          ) : showQuickAccess ? (
            <div className="search-empty-state">
              <DailyHukamCard sessionId={isKatha ? 'katha' : 'kirtan'} />
              {!isKatha && (
                <KirtanGuidancePanel onSearchSuggestion={handleGuideSuggestion} />
              )}
              <SearchQuickAccess
                history={modeHistory}
                favourites={shabadFavourites}
                isKatha={isKatha}
                onOpen={() => {
                  stopMainMic();
                  openProjector?.();
                }}
                getItemTarget={quickItemTarget}
              />
            </div>
          ) : (
            <SearchResults
              results={results}
              loading={loading}
              error={error}
              query={query}
              detectedType={detectedType}
              mode={searchMode}
              variant={isKatha ? 'katha' : 'kirtan'}
              openAs={openAs}
              source={filters.source || undefined}
            />
          )}

          {/* ── MORE TOOLS — single bottom disclosure ────────────────────── */}
        </div>

        <aside className="search-page-side">
          <ProjectorControls />
        </aside>
      </div>

      <p className="search-page-sub">
        Search across Sri Guru Granth Sahib Ji, Dasam Granth, Vaaran &amp; Kabit Bhai Gurdas Ji, and Bhai Nand Lal Ji.
      </p>
    </div>
  );
}
