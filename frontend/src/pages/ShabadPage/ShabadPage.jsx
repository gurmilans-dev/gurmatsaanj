import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ShabadView from '../../features/shabadView/ShabadView';
import ShabadProse from '../../features/hukam/ShabadProse';
import ShabadViewToggle from '../../features/hukam/ShabadViewToggle';
import ProjectorControls from '../../features/projector/ProjectorControls';
import ProjectorMiniPreview from '../../features/projector/ProjectorMiniPreview';
import VoiceDebugPanel from '../../features/voiceRecognition/VoiceDebugPanel';
import Loader from '../../components/common/Loader/Loader';
import ConfidenceBadge from '../../components/common/ConfidenceBadge/ConfidenceBadge';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import usePageVoiceTracking from '../../hooks/usePageVoiceTracking';
import useLineTracking from '../../hooks/useLineTracking';
import useKathaLineTracking from '../../hooks/useKathaLineTracking';
import useAutoShabadAdvance from '../../hooks/useAutoShabadAdvance';
import useFollowHold from '../../hooks/useFollowHold';
import useAnandSahibWatch from '../../hooks/useAnandSahibWatch';
import useWakeLock from '../../hooks/useWakeLock';
import { displayLineForEntry, getMainVerse, getMainVerseIndex, trimToWords } from '../../utils/gurmukhi';
import './ShabadPage.css';

const MicIcon = () => (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <path d="M10 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor" />
    <path d="M5 9v1a5 5 0 0 0 10 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M10 15v3M7 18h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const MicOffIcon = () => (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <path d="M10 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" fill="currentColor" />
    <path d="M5 9v1a5 5 0 0 0 10 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M10 15v3M7 18h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="3.5" y1="3.5" x2="16.5" y2="16.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const QueueRemoveIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M3 4h7M3 8h7M3 12h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 12h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const QueueAddIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M3 4h7M3 8h7M3 12h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 10v4M10 12h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const QUEUE_AUTO_ADVANCE_KEY = 'saanj-kirtan.queueAutoAdvance';
const QUEUE_AUTO_ADVANCE_SECONDS = 5;
const SHABAD_VIEW_MODE_KEY = 'saanj-kirtan.shabadViewMode';
const ANAND_SAHIB_FIRST_ID = '333375';
const ANAND_SAHIB_FINAL_ID = '333376';

function buildKathaGroup(data, fallbackId) {
  const shabadId = data?.meta?.shabadId || fallbackId;
  return {
    id: String(shabadId),
    type: 'shabad',
    shabadId,
    verses: data?.verses || [],
  };
}

function buildAnandSahibBundle(first, final) {
  const firstVerses = Array.isArray(first?.verses) ? first.verses : [];
  const finalVerses = Array.isArray(final?.verses) ? final.verses : [];
  return {
    meta: {
      ...(first?.meta || {}),
      shabadId: ANAND_SAHIB_FIRST_ID,
      title: 'ਅਨੰਦੁ ਸਾਹਿਬ',
      raag: first?.meta?.raag || 'ਰਾਗੁ ਰਾਮਕਲੀ',
      writer: first?.meta?.writer || 'Guru Amar Daas Ji',
      source: first?.meta?.source || 'ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ ਜੀ',
      pageNo: first?.meta?.pageNo || 917,
    },
    verses: [...firstVerses, ...finalVerses],
    navigation: {},
    bundle: 'anand-sahib',
    __offline: Boolean(first?.__offline || final?.__offline),
  };
}

export default function ShabadPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isKatha = searchParams.get('katha') === '1';
  const bundle = searchParams.get('bundle') || '';
  const isAnandSahibBundle = bundle === 'anand-sahib';
  const hasRouteLine = searchParams.has('line');
  const routeLineIndex = Math.max(0, Number(searchParams.get('line') || 0) || 0);
  const {
    voice,
    setEditableTranscript,
    display,
    updateDisplay,
    setSelectedShabad,
    setActiveLine,
    remoteLineCommand,
    setKathaBoundary,
    observeProjectorTranscript,
    openProjector,
    focusProjector,
    projectorWindowOpen,
    projectorDisplay,
    setProjectorDisplay,
    kathaStayInCurrent,
    setKathaStayInCurrent,
    shabadQueue,
    pushToast,
    pushShabadHistory,
    isShabadFavourite,
    toggleShabadFavourite,
    addToQueue,
    removeFromQueue,
    getCachedShabad,
    setRemoteMicTargetGetter,
    lang,
    tLang,
  } = useApp();

  // Viewer-mic + manual-line + remote-mic registration + projector-transcript
  // observation are shared with AngPage; lives in a single hook now.
  const {
    pageVoice,
    wrappedStart,
    wrappedStop,
    manualLine,
    setManualLine,
    manualAnchorVersion,
    bumpManualAnchor,
    manualLineTimerRef,
  } = usePageVoiceTracking({
    setRemoteMicTargetGetter,
    observeProjectorTranscript,
  });

  const [shabad, setShabad] = useState(null);
  const [nearbyGroups, setNearbyGroups] = useState([]);
  const [lineHint, setLineHint] = useState(routeLineIndex);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [voiceDebugOpen, setVoiceDebugOpen] = useState(false);

  // Keep the screen awake while a Shabad is open — a diwan can dwell on one
  // Shabad for many minutes between line moves, long enough for a tablet to
  // sleep otherwise.
  useWakeLock(Boolean(shabad) && !error);
  const [queueAutoAdvance, setQueueAutoAdvance] = useState(() => {
    try { return localStorage.getItem(QUEUE_AUTO_ADVANCE_KEY) === '1'; } catch { return false; }
  });
  const [queueAdvanceCountdown, setQueueAdvanceCountdown] = useState(0);
  // Reader (line-by-line) vs prose (full shabad + meaning paragraphs).
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem(SHABAD_VIEW_MODE_KEY) === 'prose' ? 'prose' : 'reader'; }
    catch { return 'reader'; }
  });
  useEffect(() => {
    try { localStorage.setItem(SHABAD_VIEW_MODE_KEY, viewMode); } catch { /* noop */ }
  }, [viewMode]);

  // Stop the global search-page mic on mount so this page's viewer mic (the
  // one started/stopped from the toolbar) can take over cleanly. The viewer
  // mic itself is owned by usePageVoiceTracking.
  useEffect(() => {
    voice.stop?.();
    voice.reset?.();
    setEditableTranscript?.('');
    voice.setWordLimit?.(7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setShabad(null);
    setNearbyGroups([]);
    setLineHint(routeLineIndex);
    setManualLine(null);
    pageVoice.reset?.();

    const loadShabad = getCachedShabad || api.getShabad;
    const loadCurrentShabad = async () => {
      if (!isAnandSahibBundle) return loadShabad(id);
      const [first, final] = await Promise.all([
        loadShabad(ANAND_SAHIB_FIRST_ID),
        loadShabad(ANAND_SAHIB_FINAL_ID),
      ]);
      return buildAnandSahibBundle(first, final);
    };

    loadCurrentShabad()
      .then((data) => {
        if (cancelled) return;
        const smartInitialLine = hasRouteLine
          ? routeLineIndex
          : Math.max(0, getMainVerseIndex(data?.verses, data?.meta));
        setShabad(data);
        setLineHint(smartInitialLine);
        if (data?.__offline) {
          pushToast({
            kind: 'info',
            title: 'Opened from cache',
            message: 'Network failed, so this Shabad was restored from saved data.',
            timeoutMs: 3500,
          });
        }
        setSelectedShabad({
          ...data,
          meta: {
            ...(data?.meta || {}),
            remoteKind: 'shabad',
            remoteMode: isKatha ? 'katha' : 'kirtan',
            isKatha,
          },
        });

        const mainVerse = getMainVerse(data?.verses, data?.meta);
        const firstVerse = data?.verses?.[0] || null;
        pushShabadHistory?.({
          shabadId: data?.meta?.shabadId || id,
          gurmukhi: mainVerse?.gurmukhi || firstVerse?.gurmukhi || '',
          mainGurmukhi: mainVerse?.gurmukhi || '',
          firstGurmukhi: firstVerse?.gurmukhi || '',
          raag: data?.meta?.raag || '',
          writer: data?.meta?.writer || '',
          source: data?.meta?.source || '',
          pageNo: data?.meta?.pageNo || null,
          kind: 'shabad',
          mode: isKatha ? 'katha' : 'kirtan',
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.response?.data?.error || err.message || 'Could not load Shabad';
        setError(msg);
        pushToast({ kind: 'error', title: 'Could not open Shabad', message: msg });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isKatha, isAnandSahibBundle, hasRouteLine, routeLineIndex, setSelectedShabad, pushToast, pushShabadHistory, getCachedShabad]);

  useEffect(() => {
    if (!isKatha || !shabad) {
      setNearbyGroups([]);
      return undefined;
    }

    let cancelled = false;

    const loadDirection = async (start, direction, count) => {
      const out = [];
      let current = start;
      for (let i = 0; i < count; i += 1) {
        const nextId = current?.navigation?.[direction];
        if (!nextId) break;
        try {
          const loadShabad = getCachedShabad || api.getShabad;
          const next = await loadShabad(nextId);
          out.push(next);
          current = next;
        } catch {
          break;
        }
      }
      return out;
    };

    Promise.all([
      loadDirection(shabad, 'previous', 2),
      loadDirection(shabad, 'next', 2),
    ]).then(([previous, next]) => {
      if (cancelled) return;
      const currentId = shabad?.meta?.shabadId || id;
      const groups = [
        ...previous.reverse().map((item) => buildKathaGroup(item, item?.meta?.shabadId)),
        buildKathaGroup(shabad, currentId),
        ...next.map((item) => buildKathaGroup(item, item?.meta?.shabadId)),
      ].filter((group, index, all) =>
        group.id &&
        group.verses.length > 0 &&
        all.findIndex((item) => String(item.id) === String(group.id)) === index
      );
      setNearbyGroups(groups);
    });

    return () => {
      cancelled = true;
    };
  }, [isKatha, shabad, id, getCachedShabad]);

  const currentShabadId = shabad?.meta?.shabadId || id;
  const verses = shabad?.verses || [];
  const verseCount = verses.length;
  const currentLineForTracking = manualLine !== null ? manualLine : lineHint;

  const kirtanTracking = useLineTracking({
    shabadId: id,
    verses,
    transcript: pageVoice.transcript,
    active: !isKatha && pageVoice.isListening,
    anchorLineIndex: manualLine,
    anchorVersion: manualAnchorVersion,
  });

  // Lock / Follow auto-hold (kirtan mode). Freezes the display during vyakhya
  // / instrumental gaps (no confident track) and lets the operator pin a
  // shabad manually. `held` suppresses shabad auto-advance below.
  const follow = useFollowHold({
    active: !isKatha && pageVoice.isListening,
    tracked: kirtanTracking.tracked,
    confidence: kirtanTracking.confidence,
  });

  const handleNearbyNavigate = useCallback((group, lineIndex = 0) => {
    if (!group?.shabadId) return;
    pushToast({
      kind: 'info',
      title: 'Nearby Shabad detected',
      message: 'Opening the Shabad from nearby Katha audio.',
      timeoutMs: 3000,
    });
    navigate(`/shabad/${encodeURIComponent(group.shabadId)}?katha=1&line=${Math.max(0, Number(lineIndex) || 0)}`);
  }, [navigate, pushToast]);

  const kathaTracking = useKathaLineTracking({
    active: isKatha && pageVoice.isListening && !loading && !error && nearbyGroups.length > 0,
    transcript: pageVoice.transcript,
    groups: nearbyGroups,
    currentGroupId: currentShabadId,
    currentLineIndex: currentLineForTracking,
    onNavigate: handleNearbyNavigate,
    stayInCurrentGroup: kathaStayInCurrent,
    anchorLineIndex: manualLine,
    anchorVersion: manualAnchorVersion,
  });

  useEffect(() => {
    if (isKatha && kathaTracking.tracked && kathaTracking.lineIndex >= 0) {
      setLineHint(kathaTracking.lineIndex);
    }
  }, [isKatha, kathaTracking.tracked, kathaTracking.lineIndex]);

  useEffect(() => {
    if (!isKatha && kirtanTracking.tracked && kirtanTracking.lineIndex >= 0) {
      setLineHint(kirtanTracking.lineIndex);
    }
  }, [isKatha, kirtanTracking.tracked, kirtanTracking.lineIndex]);

  useEffect(() => {
    if (isKatha && manualLine !== null) setLineHint(manualLine);
  }, [isKatha, manualLine]);

  const trackedIndex = isKatha
    ? (kathaTracking.lineIndex >= 0 ? kathaTracking.lineIndex : lineHint)
    : (kirtanTracking.lineIndex >= 0 ? kirtanTracking.lineIndex : lineHint);
  const confidence = isKatha ? kathaTracking.confidence : kirtanTracking.confidence;
  const tracked = isKatha ? kathaTracking.tracked : kirtanTracking.tracked;
  const activeIndex = manualLine !== null ? manualLine : trackedIndex;
  const isManual = manualLine !== null;

  const handleAutoAdvance = useCallback((candidate) => {
    if (!candidate?.shabadId) return;
    const fromQueue = Boolean(candidate.queued || candidate.queueMatch);
    pushToast({
      kind: fromQueue ? 'success' : 'info',
      title: fromQueue ? 'Looks like next queued Shabad started' : 'New Shabad detected',
      message: fromQueue
        ? 'Opening it from the Kirtan queue before searching all Shabads.'
        : 'Opening the next Shabad from the live audio.',
      timeoutMs: fromQueue ? 4200 : 3500,
    });
    navigate(`/shabad/${encodeURIComponent(candidate.shabadId)}`);
  }, [navigate, pushToast]);

  const kirtanQueue = useMemo(
    () => (shabadQueue || []).filter((item) => (item.queueSessionId || item.sessionId || 'kirtan') === 'kirtan'),
    [shabadQueue]
  );
  const currentQueueSessionId = isKatha ? 'katha' : 'kirtan';
  const currentQueueLabel = isKatha ? 'Katha' : 'Kirtan';
  const currentSessionQueue = useMemo(
    () => (shabadQueue || []).filter((item) => (item.queueSessionId || item.sessionId || 'kirtan') === currentQueueSessionId),
    [currentQueueSessionId, shabadQueue]
  );
  const currentQueueIndex = useMemo(
    () => currentSessionQueue.findIndex((item) => String(item?.shabadId) === String(currentShabadId)),
    [currentSessionQueue, currentShabadId]
  );
  const nextQueueItem = currentQueueIndex >= 0
    ? currentSessionQueue[currentQueueIndex + 1] || null
    : currentSessionQueue.find((item) => String(item?.shabadId) !== String(currentShabadId)) || null;
  const isCurrentQueued = useMemo(() => (
    Boolean(currentShabadId) &&
    (shabadQueue || []).some((item) =>
      String(item?.shabadId) === String(currentShabadId) &&
      (item?.queueSessionId || item?.sessionId || 'kirtan') === currentQueueSessionId
    )
  ), [currentQueueSessionId, currentShabadId, shabadQueue]);

  useAutoShabadAdvance({
    // Suppressed while held/locked — vyakhya or a manual lock must not let the
    // display wander to another shabad.
    active: !isKatha && pageVoice.isListening && !loading && !error && shabad && !follow.held,
    transcript: pageVoice.transcript,
    currentShabadId,
    shabadVerses: verses,
    queueEntries: kirtanQueue,
    currentLineTracked: kirtanTracking.tracked,
    currentLineConfidence: kirtanTracking.confidence,
    onAdvance: handleAutoAdvance,
  });

  // Always-on Anand Sahib (6-pauri) watch — fires in BOTH kirtan and katha,
  // independent of the queue / nearby-shabad detectors, since Anand Sahib at
  // Bhog can start while any other shabad is open.
  useAnandSahibWatch({
    active: pageVoice.isListening && !loading && !error,
    transcript: pageVoice.transcript,
    currentShabadId,
    onDetect: () => {
      pushToast({
        kind: 'info',
        title: 'Anand Sahib detected',
        message: 'Opening Anand Sahib (6 pauris).',
        timeoutMs: 3500,
      });
      navigate(`/shabad/${ANAND_SAHIB_FIRST_ID}?bundle=anand-sahib${isKatha ? '&katha=1' : ''}`);
    },
  });

  useEffect(() => {
    if (!verses.length) return;
    if (activeIndex < 0 || activeIndex >= verses.length) {
      setActiveLine({ index: -1, text: '', tracked: false });
      return;
    }
    const verse = verses[activeIndex];
    setActiveLine({
      index: activeIndex,
      text: verse?.gurmukhi || '',
      tracked: !isManual && tracked,
    });
  }, [activeIndex, verses, isManual, tracked, setActiveLine]);

  useEffect(() => {
    if (!setKathaBoundary) return;
    if (!isKatha || nearbyGroups.length === 0) {
      setKathaBoundary({ prevVerse: null, nextVerse: null });
      return;
    }
    const currentIndex = nearbyGroups.findIndex((group) => String(group.shabadId) === String(currentShabadId));
    if (currentIndex < 0) {
      setKathaBoundary({ prevVerse: null, nextVerse: null });
      return;
    }
    const prevGroup = currentIndex > 0 ? nearbyGroups[currentIndex - 1] : null;
    const nextGroup = currentIndex < nearbyGroups.length - 1 ? nearbyGroups[currentIndex + 1] : null;
    setKathaBoundary({
      prevVerse: prevGroup?.verses?.length ? prevGroup.verses[prevGroup.verses.length - 1] : null,
      nextVerse: nextGroup?.verses?.length ? nextGroup.verses[0] : null,
    });
  }, [isKatha, nearbyGroups, currentShabadId, setKathaBoundary]);

  useEffect(() => () => {
    setKathaBoundary?.({ prevVerse: null, nextVerse: null });
  }, [setKathaBoundary]);

  const mainVerse = getMainVerse(verses, shabad?.meta);
  const firstVerse = verses[0] || null;
  const favouriteEntry = shabad ? {
    shabadId: shabad?.meta?.shabadId || id,
    gurmukhi: mainVerse?.gurmukhi || firstVerse?.gurmukhi || '',
    mainGurmukhi: mainVerse?.gurmukhi || '',
    firstGurmukhi: firstVerse?.gurmukhi || '',
    raag: shabad?.meta?.raag || '',
    writer: shabad?.meta?.writer || '',
    source: shabad?.meta?.source || '',
    pageNo: shabad?.meta?.pageNo || null,
  } : null;
  const isFavourite = favouriteEntry ? isShabadFavourite?.(favouriteEntry.shabadId) : false;

  const toggleFavourite = () => {
    if (!favouriteEntry) return;
    toggleShabadFavourite?.(favouriteEntry);
    pushToast({
      kind: isFavourite ? 'info' : 'success',
      title: isFavourite ? 'Removed from favourites' : 'Added to favourites',
      message: isFavourite ? 'This Shabad was removed from your favourites.' : 'This Shabad is saved in your favourites.',
      timeoutMs: 2500,
    });
  };

  const addCurrentToQueue = () => {
    if (!favouriteEntry) return;
    if (isCurrentQueued) {
      removeFromQueue?.(favouriteEntry.shabadId, currentQueueSessionId);
      pushToast({
        kind: 'success',
        title: `Removed from ${currentQueueLabel} queue`,
        message: 'This Shabad was removed from this section queue.',
        timeoutMs: 1800,
      });
      return;
    }
    addToQueue?.({
      ...favouriteEntry,
      queueSessionId: currentQueueSessionId,
    });
    pushToast({
      kind: 'success',
      title: `Added to ${currentQueueLabel} session`,
      message: 'This Shabad is ready in your queue.',
      timeoutMs: 2200,
    });
  };

  const correctToLine = useCallback((index) => {
    if (!verseCount) return;
    const next = Math.min(verseCount - 1, Math.max(0, Number(index) || 0));
    setManualLine(next);
    setLineHint(next);
    bumpManualAnchor();
    if (manualLineTimerRef.current) clearTimeout(manualLineTimerRef.current);
    manualLineTimerRef.current = setTimeout(() => {
      setManualLine(null);
    }, 900);
  }, [isKatha, verseCount]);

  const goPrev = useCallback(() => {
    const cur = manualLine !== null ? manualLine : Math.max(0, activeIndex >= 0 ? activeIndex : trackedIndex);
    correctToLine(Math.max(0, cur - 1));
  }, [manualLine, activeIndex, trackedIndex, correctToLine]);

  const goNext = useCallback(() => {
    const cur = manualLine !== null ? manualLine : Math.max(0, activeIndex >= 0 ? activeIndex : trackedIndex);
    correctToLine(Math.min(verseCount - 1, cur + 1));
  }, [manualLine, activeIndex, trackedIndex, verseCount, correctToLine]);

  const resumeLive = () => setManualLine(null);

  useEffect(() => {
    if (!remoteLineCommand?.id || loading || error || !shabad) return;
    if (remoteLineCommand.type === 'line-prev') goPrev();
    else if (remoteLineCommand.type === 'line-next') goNext();
    else if (remoteLineCommand.type === 'line-first') correctToLine(0);
    else if (remoteLineCommand.type === 'line-last') correctToLine(verseCount - 1);
    else if (remoteLineCommand.type === 'line-select') correctToLine(remoteLineCommand.index);
    else if (remoteLineCommand.type === 'resume-live') resumeLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteLineCommand?.id]);

  useEffect(() => {
    try { localStorage.setItem(QUEUE_AUTO_ADVANCE_KEY, queueAutoAdvance ? '1' : '0'); } catch { /* noop */ }
  }, [queueAutoAdvance]);

  const queueLineIndex = activeIndex >= 0 ? activeIndex : lineHint;
  const queueAdvanceReady = Boolean(
    nextQueueItem?.shabadId &&
    currentQueueIndex >= 0 &&
    verseCount > 0 &&
    queueLineIndex >= verseCount - 1
  );
  const nextQueueTitle = nextQueueItem
    ? trimToWords(displayLineForEntry(nextQueueItem) || nextQueueItem.shabadId, 10)
    : '';
  const openNextQueueItem = useCallback(() => {
    if (!nextQueueItem?.shabadId) return;
    setQueueAdvanceCountdown(0);
    const qs = isKatha ? '?katha=1' : '';
    navigate(`/shabad/${encodeURIComponent(nextQueueItem.shabadId)}${qs}`);
  }, [isKatha, navigate, nextQueueItem]);

  useEffect(() => {
    if (!queueAutoAdvance || !queueAdvanceReady) {
      setQueueAdvanceCountdown(0);
      return undefined;
    }

    setQueueAdvanceCountdown(QUEUE_AUTO_ADVANCE_SECONDS);
    const interval = setInterval(() => {
      setQueueAdvanceCountdown((value) => Math.max(0, value - 1));
    }, 1000);
    const timer = setTimeout(() => {
      openNextQueueItem();
    }, QUEUE_AUTO_ADVANCE_SECONDS * 1000);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [openNextQueueItem, queueAutoAdvance, queueAdvanceReady]);

  useEffect(() => {
    if (loading || error || !shabad) return undefined;
    const isInput = (target) => {
      const tag = target?.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || tag === 'a' || target?.isContentEditable;
    };
    const handleKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented || isInput(event.target)) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        goNext();
      } else if ((event.key === ' ' || event.code === 'Space') && !event.repeat && pageVoice?.isSupported !== false) {
        event.preventDefault();
        if (pageVoice.isListening) wrappedStop?.();
        else wrappedStart?.();
      } else if (event.key === 'Escape' && manualLine !== null) {
        event.preventDefault();
        resumeLive();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loading, error, shabad, manualLine, goPrev, goNext, pageVoice?.isSupported, pageVoice.isListening, wrappedStart, wrappedStop]);

  const goPrevShabad = () => {
    if (shabad?.navigation?.previous) {
      navigate(`/shabad/${encodeURIComponent(shabad.navigation.previous)}${isKatha ? '?katha=1' : ''}`);
    } else {
      pushToast({ kind: 'info', title: 'No previous Shabad', message: 'You are at the start of this section.' });
    }
  };

  const goNextShabad = () => {
    if (shabad?.navigation?.next) {
      navigate(`/shabad/${encodeURIComponent(shabad.navigation.next)}${isKatha ? '?katha=1' : ''}`);
    } else {
      pushToast({ kind: 'info', title: 'No next Shabad', message: 'You are at the end of this section.' });
    }
  };

  const openOrFocusProjector = () => {
    if (projectorWindowOpen) {
      focusProjector?.();
      return;
    }
    openProjector?.();
  };

  const updateProjectorFont = (value) => {
    setProjectorDisplay?.({ ...projectorDisplay, fontScale: value });
  };

  const meta = shabad?.meta;
  const hasRecentTranscript = (pageVoice.transcript || '').trim().length >= 2;
  const showHoldStatus = !isKatha && pageVoice.isListening && !isManual;
  const trackingStatusText = isManual
    ? (pageVoice.isListening ? 'Line corrected - listening' : 'Line selected manually')
    : showHoldStatus && follow.locked
      ? 'Locked - manual hold'
      : showHoldStatus && follow.autoHeld
        ? 'Paused - waiting for kirtan'
        : tracked && activeIndex >= 0
          ? `Following mic - line ${activeIndex + 1}`
          : isKatha && kathaTracking.status === 'matching'
            ? 'Listening - finding nearby line'
            : isKatha && kathaTracking.status === 'no-match'
              ? 'Listening - no confident nearby match'
              : isKatha && kathaTracking.status === 'listening'
                ? 'Listening'
                : hasRecentTranscript
                  ? (isKatha ? 'Listening - finding nearby line' : 'Listening - finding line')
                  : pageVoice.isListening
                    ? 'Mic on - waiting for audio'
                    : 'Mic off';
  const statusClassName = [
    'meta-pill',
    'meta-pill-status',
    tracked && !isManual && !(showHoldStatus && follow.held) ? 'meta-pill-status-on' : '',
    isManual ? 'meta-pill-status-manual' : '',
    showHoldStatus && follow.held ? 'meta-pill-status-held' : '',
  ].filter(Boolean).join(' ');
  const voiceDebugTracking = isKatha ? kathaTracking : kirtanTracking;
  const boundaryPreview = useMemo(() => {
    if (!isKatha || activeIndex < 0 || verseCount < 1 || nearbyGroups.length === 0) return null;
    const currentIndex = nearbyGroups.findIndex((group) => String(group.shabadId) === String(currentShabadId));
    if (currentIndex < 0) return null;
    const nearEnd = activeIndex >= Math.max(0, verseCount - 2);
    const nearStart = activeIndex <= 1;
    const nextGroup = nearbyGroups[currentIndex + 1];
    const prevGroup = nearbyGroups[currentIndex - 1];
    if (nearEnd && nextGroup?.verses?.[0]) {
      return {
        type: 'next',
        label: 'Next Shabad',
        detail: 'First line',
        text: nextGroup.verses[0].gurmukhi || '',
        group: nextGroup,
        lineIndex: 0,
      };
    }
    if (nearStart && prevGroup?.verses?.length) {
      return {
        type: 'previous',
        label: 'Previous Shabad',
        detail: 'Last line',
        text: prevGroup.verses[prevGroup.verses.length - 1]?.gurmukhi || '',
        group: prevGroup,
        lineIndex: prevGroup.verses.length - 1,
      };
    }
    return null;
  }, [activeIndex, currentShabadId, isKatha, nearbyGroups, verseCount]);

  return (
    <div className="app-container shabad-page">
      <div className="shabad-page-sticky">
        <div className="shabad-page-primary">
          <button
            type="button"
            className="btn btn-secondary btn-sm shabad-page-back"
            onClick={() => {
              if (window.history.length > 1) navigate(-1);
              else navigate('/');
            }}
          >
            <span aria-hidden="true">&lt;</span> <span lang={lang}>{tLang('Back', 'ਵਾਪਸ')}</span>
          </button>

          <div className="shabad-page-title-block">
            <p className="shabad-page-title gurmukhi">
              {loading ? 'Opening Shabad' : error ? 'Shabad unavailable' : verses[0]?.gurmukhi || 'Shabad'}
            </p>
            {!loading && !error && shabad && (
              <div className="shabad-meta-pills shabad-page-title-meta">
                {meta?.raag && (
                  <span className="meta-pill" title="Raag">
                    <span className="meta-pill-label">Raag</span>
                    {meta.raag}
                  </span>
                )}
                {meta?.writer && (
                  <span className="meta-pill" title="Writer">
                    <span className="meta-pill-label">Writer</span>
                    {meta.writer}
                  </span>
                )}
                {meta?.source && (
                  <span className="meta-pill meta-pill-muted" title="Granth">
                    <span className="meta-pill-label">Granth</span>
                    {meta.source}
                  </span>
                )}
                {meta?.pageNo && (
                  <span className="meta-pill meta-pill-muted" title="Ang">
                    <span className="meta-pill-label">Ang</span>
                    {meta.pageNo}
                  </span>
                )}
                {pageVoice.isListening && (
                  <span className={statusClassName} aria-live="polite">
                    <span className="meta-pill-dot" aria-hidden="true" />
                    <span>{trackingStatusText}</span>
                    {tracked && !isManual && <ConfidenceBadge value={confidence} compact />}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="shabad-page-mic">
            {!loading && !error && shabad && (
              <button
                type="button"
                className={`shabad-favourite-btn${isFavourite ? ' shabad-favourite-btn-on' : ''}`}
                onClick={toggleFavourite}
                aria-pressed={isFavourite}
                title={isFavourite ? 'Remove from favourites' : 'Save to favourites'}
              >
                <span aria-hidden="true">{isFavourite ? '♥' : '♡'}</span>
              </button>
            )}
            {!loading && !error && shabad && (
              <button
                type="button"
                className={`btn btn-secondary btn-sm shabad-queue-btn${isCurrentQueued ? ' shabad-queue-btn-on' : ''}`}
                onClick={addCurrentToQueue}
                aria-pressed={isCurrentQueued}
                title={isCurrentQueued
                  ? `Remove from ${currentQueueLabel} session queue`
                  : `Add to ${currentQueueLabel} session queue`}
              >
                {isCurrentQueued ? <QueueRemoveIcon /> : <QueueAddIcon />}
                {isCurrentQueued ? `Queued in ${currentQueueLabel}` : 'Queue'}
              </button>
            )}
            {pageVoice.isSupported && (
              <button
                type="button"
                className={`btn btn-sm ${pageVoice.isListening ? 'btn-primary' : 'btn-secondary'}`}
                onClick={pageVoice.isListening ? wrappedStop : wrappedStart}
              >
                {pageVoice.isListening ? <MicOffIcon /> : <MicIcon />}
                <span lang={lang}>{pageVoice.isListening ? tLang('Stop mic', 'ਮਾਈਕ ਬੰਦ') : tLang('Start mic', 'ਮਾਈਕ ਚਾਲੂ')}</span>
              </button>
            )}
          </div>
        </div>

        {!loading && !error && shabad && (
          <div className="shabad-control-groups" aria-label="Live Shabad controls">
            <section className="shabad-control-group shabad-live-group">
              <p className="shabad-control-label" lang={lang}>{tLang('Live controls', 'ਲਾਈਵ ਕੰਟਰੋਲ')}</p>
              {pageVoice.isSupported && (
                <button
                  type="button"
                  className={`btn btn-sm ${pageVoice.isListening ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={pageVoice.isListening ? wrappedStop : wrappedStart}
                >
                  {pageVoice.isListening ? <MicOffIcon /> : <MicIcon />}
                  <span lang={lang}>{pageVoice.isListening ? tLang('Stop mic', 'ਮਾਈਕ ਬੰਦ') : tLang('Start mic', 'ਮਾਈਕ ਚਾਲੂ')}</span>
                </button>
              )}
              <div className="shabad-nav-line">
                <button type="button" className="btn btn-secondary btn-sm shabad-nav-btn" onClick={goPrev} disabled={activeIndex <= 0} aria-label="Previous line">&lt;</button>
                <span className="shabad-nav-indicator">
                  {activeIndex >= 0 ? `${activeIndex + 1} / ${verseCount}` : `${verseCount} lines`}
                  {isManual && <span className="shabad-nav-mode"> - manual</span>}
                </span>
                <button type="button" className="btn btn-secondary btn-sm shabad-nav-btn" onClick={goNext} disabled={activeIndex >= verseCount - 1} aria-label="Next line">&gt;</button>
              </div>
              {isManual && (
                <button type="button" className="btn-ghost shabad-nav-resume" onClick={resumeLive} lang={lang}>
                  {tLang('Resume live', 'ਲਾਈਵ ਮੁੜ ਚਾਲੂ ਕਰੋ')}
                </button>
              )}
              {nextQueueItem?.shabadId && (
                <button type="button" className="btn btn-secondary btn-sm shabad-nav-queue-next" onClick={openNextQueueItem}>
                  <span lang={lang}>{tLang('Next queued', 'ਅਗਲਾ ਕਤਾਰ ਵਿੱਚ')}</span>
                </button>
              )}
              <div className="shabad-nav-shabad">
                <button type="button" className="btn-ghost shabad-nav-btn" onClick={goPrevShabad} aria-label="Previous Shabad">
                  &lt; Shabad
                </button>
                <button type="button" className="btn-ghost shabad-nav-btn" onClick={goNextShabad} aria-label="Next Shabad">
                  Shabad &gt;
                </button>
              </div>
              {boundaryPreview && (
                <button
                  type="button"
                  className={`shabad-boundary-preview shabad-boundary-preview-${boundaryPreview.type}`}
                  onClick={() => handleNearbyNavigate(boundaryPreview.group, boundaryPreview.lineIndex)}
                >
                  <span className="shabad-boundary-kicker">
                    {boundaryPreview.label} - {boundaryPreview.detail}
                  </span>
                  <span className="shabad-boundary-text gurmukhi">
                    {trimToWords(boundaryPreview.text, 14)}
                  </span>
                </button>
              )}
            </section>

            <section className="shabad-control-group shabad-display-group">
              <p className="shabad-control-label">Display controls</p>
              <div className="shabad-view-toggle-row">
                <span className="shabad-steek-label" lang={lang}>{tLang('View', 'ਦ੍ਰਿਸ਼')}</span>
                <ShabadViewToggle mode={viewMode} onChange={setViewMode} lang={lang} tLang={tLang} />
              </div>
              <div className="shabad-page-toggles" role="group" aria-label="Visible text layers">
                <button
                  type="button"
                  className={`display-toggle${display.showTransliteration ? ' display-toggle-on' : ''}`}
                  aria-pressed={display.showTransliteration}
                  onClick={() => updateDisplay({ showTransliteration: !display.showTransliteration })}
                >
                  Transliteration
                </button>
                <button
                  type="button"
                  className={`display-toggle${display.showEnglish ? ' display-toggle-on' : ''}`}
                  aria-pressed={display.showEnglish}
                  onClick={() => updateDisplay({ showEnglish: !display.showEnglish })}
                >
                  English
                </button>
                <button
                  type="button"
                  className={`display-toggle${display.showPunjabi ? ' display-toggle-on' : ''}`}
                  aria-pressed={display.showPunjabi}
                  onClick={() => updateDisplay({ showPunjabi: !display.showPunjabi })}
                >
                  Punjabi
                </button>
                <button
                  type="button"
                  className={`display-toggle${display.larivaar ? ' display-toggle-on' : ''}`}
                  aria-pressed={!!display.larivaar}
                  onClick={() => updateDisplay({ larivaar: !display.larivaar })}
                  title="Render Gurmukhi continuously (no word spaces), the traditional SGGS form"
                >
                  Larivaar
                </button>
              </div>
              {display.showPunjabi && (
                <div className="shabad-steek-row" role="group" aria-label="Punjabi steek">
                  <span className="shabad-steek-label" lang={lang}>
                    {tLang('Steek', 'ਟੀਕਾ')}
                  </span>
                  <button
                    type="button"
                    className={`display-toggle${display.punjabiSteek === 'ss' ? ' display-toggle-on' : ''}`}
                    aria-pressed={display.punjabiSteek === 'ss'}
                    onClick={() => updateDisplay({ punjabiSteek: 'ss' })}
                    lang={lang}
                  >
                    {tLang('Sahib Singh', 'ਸਾਹਿਬ ਸਿੰਘ')}
                  </button>
                  <button
                    type="button"
                    className={`display-toggle${display.punjabiSteek === 'ft' ? ' display-toggle-on' : ''}`}
                    aria-pressed={display.punjabiSteek === 'ft'}
                    onClick={() => updateDisplay({ punjabiSteek: 'ft' })}
                    lang={lang}
                  >
                    {tLang('Faridkot', 'ਫਰੀਦਕੋਟ')}
                  </button>
                  <button
                    type="button"
                    className={`display-toggle${display.punjabiSteek === 'ms' ? ' display-toggle-on' : ''}`}
                    aria-pressed={display.punjabiSteek === 'ms'}
                    onClick={() => updateDisplay({ punjabiSteek: 'ms' })}
                    lang={lang}
                  >
                    {tLang('Manmohan Singh', 'ਮਨਮੋਹਨ ਸਿੰਘ')}
                  </button>
                </div>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={openOrFocusProjector}>
                <span lang={lang}>{projectorWindowOpen ? tLang('Focus projector', 'ਪ੍ਰੋਜੈਕਟਰ ਫੋਕਸ') : tLang('Open projector', 'ਪ੍ਰੋਜੈਕਟਰ ਖੋਲ੍ਹੋ')}</span>
              </button>
              <label className="shabad-font-control">
                <span>Font</span>
                <input
                  type="range"
                  min="0.75"
                  max="1.35"
                  step="0.05"
                  value={projectorDisplay.fontScale}
                  onChange={(event) => updateProjectorFont(Number(event.target.value))}
                />
              </label>
              <details className="shabad-advanced-projector">
                <summary>Advanced projector</summary>
                <ProjectorControls compact embedded />
              </details>
            </section>

            <section className="shabad-control-group shabad-library-group">
              <p className="shabad-control-label">Library controls</p>
              <button
                type="button"
                className={`shabad-favourite-btn${isFavourite ? ' shabad-favourite-btn-on' : ''}`}
                onClick={toggleFavourite}
                aria-pressed={isFavourite}
                title={isFavourite ? 'Remove from favourites' : 'Save to favourites'}
              >
                <span aria-hidden="true">{isFavourite ? '♥' : '♡'}</span>
                {isFavourite ? 'Saved' : 'Save'}
              </button>
              <button
                type="button"
                className={`btn btn-secondary btn-sm shabad-queue-btn${isCurrentQueued ? ' shabad-queue-btn-on' : ''}`}
                onClick={addCurrentToQueue}
                aria-pressed={isCurrentQueued}
                title={isCurrentQueued
                  ? `Remove from ${currentQueueLabel} session queue`
                  : `Add to ${currentQueueLabel} session queue`}
              >
                {isCurrentQueued ? <QueueRemoveIcon /> : <QueueAddIcon />}
                {isCurrentQueued ? `Queued in ${currentQueueLabel}` : 'Queue'}
              </button>
              {isKatha && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={!kathaStayInCurrent}
                  onClick={() => setKathaStayInCurrent?.(!kathaStayInCurrent)}
                  className={`katha-stay-toggle${!kathaStayInCurrent ? ' katha-stay-toggle-on' : ''}`}
                  title={!kathaStayInCurrent
                    ? 'Auto-open nearby Shabads is on'
                    : 'Auto-open nearby Shabads is off'}
                >
                  <svg className="katha-stay-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <circle cx="8" cy="3" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8 4.6v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M5.5 7h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 10c0 2 2.2 3.5 5 3.5s5-1.5 5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                  </svg>
                  <span className="katha-stay-label">Auto-open nearby</span>
                  <span className="katha-stay-track" aria-hidden="true">
                    <span className="katha-stay-thumb" />
                  </span>
                </button>
              )}
            </section>
          </div>
        )}

        {false && !loading && !error && shabad && (
          <div className="shabad-page-secondary" role="navigation" aria-label="Reading controls">
            <div className="shabad-page-toggles" role="group" aria-label="Visible text layers">
              <button
                type="button"
                className={`display-toggle${display.showTransliteration ? ' display-toggle-on' : ''}`}
                aria-pressed={display.showTransliteration}
                onClick={() => updateDisplay({ showTransliteration: !display.showTransliteration })}
              >
                Transliteration
              </button>
              <button
                type="button"
                className={`display-toggle${display.showEnglish ? ' display-toggle-on' : ''}`}
                aria-pressed={display.showEnglish}
                onClick={() => updateDisplay({ showEnglish: !display.showEnglish })}
              >
                English
              </button>
              <button
                type="button"
                className={`display-toggle${display.showPunjabi ? ' display-toggle-on' : ''}`}
                aria-pressed={display.showPunjabi}
                onClick={() => updateDisplay({ showPunjabi: !display.showPunjabi })}
              >
                Punjabi
              </button>
            </div>

            <div className="shabad-nav-controls">
              <div className="shabad-nav-line">
                <button type="button" className="btn btn-secondary btn-sm shabad-nav-btn" onClick={goPrev} disabled={activeIndex <= 0} aria-label="Previous line">&lt;</button>
                <span className="shabad-nav-indicator">
                  {activeIndex >= 0 ? `${activeIndex + 1} / ${verseCount}` : `${verseCount} lines`}
                  {isManual && <span className="shabad-nav-mode"> - manual</span>}
                </span>
                <button type="button" className="btn btn-secondary btn-sm shabad-nav-btn" onClick={goNext} disabled={activeIndex >= verseCount - 1} aria-label="Next line">&gt;</button>
              </div>

              <span className="shabad-nav-divider" aria-hidden="true" />

              <div className="shabad-nav-shabad">
                {isKatha && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!kathaStayInCurrent}
                    onClick={() => setKathaStayInCurrent?.(!kathaStayInCurrent)}
                    className={`katha-stay-toggle${!kathaStayInCurrent ? ' katha-stay-toggle-on' : ''}`}
                    title={!kathaStayInCurrent
                      ? 'Auto-open nearby Shabads is on'
                      : 'Auto-open nearby Shabads is off'}
                  >
                    <svg className="katha-stay-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                      <circle cx="8" cy="3" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M8 4.6v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M5.5 7h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M3 10c0 2 2.2 3.5 5 3.5s5-1.5 5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    </svg>
                    <span className="katha-stay-label">Auto-open nearby Shabads</span>
                    <span className="katha-stay-track" aria-hidden="true">
                      <span className="katha-stay-thumb" />
                    </span>
                  </button>
                )}
                <button type="button" className="btn-ghost shabad-nav-btn" onClick={goPrevShabad} aria-label="Previous Shabad">
                  &lt; Shabad
                </button>
                {isManual && (
                  <button type="button" className="btn-ghost shabad-nav-resume" onClick={resumeLive}>
                    Resume live
                  </button>
                )}
                {nextQueueItem?.shabadId && (
                  <button type="button" className="btn btn-secondary btn-sm shabad-nav-queue-next" onClick={openNextQueueItem}>
                    Next queued
                  </button>
                )}
                <button type="button" className="btn-ghost shabad-nav-btn" onClick={goNextShabad} aria-label="Next Shabad">
                  Shabad &gt;
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {!loading && !error && shabad && (
        <VoiceDebugPanel
          title={isKatha ? 'Katha voice debug' : 'Kirtan voice debug'}
          mode={isKatha ? 'katha-shabad' : 'kirtan-shabad'}
          voice={pageVoice}
          tracking={voiceDebugTracking}
          transcript={pageVoice.transcript}
          activeIndex={activeIndex}
          verseCount={verseCount}
          groupLabel={isKatha ? 'Katha Shabad' : 'Shabad'}
          verses={verses}
          groups={isKatha ? nearbyGroups : []}
          currentGroupId={isKatha ? String(currentShabadId) : String(currentShabadId)}
          onOpenChange={setVoiceDebugOpen}
        />
      )}

      {!loading && !error && shabad && queueAdvanceReady && (
        <section className="queue-advance-card" aria-label="Next Shabad in queue">
          <div className="queue-advance-copy">
            <p className="section-eyebrow">Next in {currentQueueLabel} queue</p>
            <h3 className="gurmukhi">{nextQueueTitle}</h3>
            <p>
              {queueAutoAdvance
                ? `Auto-opening in ${queueAdvanceCountdown || QUEUE_AUTO_ADVANCE_SECONDS}s.`
                : 'This Shabad is complete. Open the next queued Shabad when ready.'}
            </p>
          </div>
          <div className="queue-advance-actions">
            <label className="queue-advance-toggle">
              <input
                type="checkbox"
                checked={queueAutoAdvance}
                onChange={(event) => setQueueAutoAdvance(event.target.checked)}
              />
              <span>Auto-open next</span>
            </label>
            <button type="button" className="btn btn-primary btn-sm" onClick={openNextQueueItem}>
              Next in queue
            </button>
          </div>
        </section>
      )}

      {!loading && !error && shabad && <ProjectorMiniPreview />}

      {loading && (
        <div className="shabad-page-state">
          <Loader label="Opening Shabad..." size="lg" />
        </div>
      )}

      {error && (
        <div className="shabad-page-state shabad-page-error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && shabad && (
        viewMode === 'prose' ? (
          <ShabadProse
            meta={shabad.meta}
            verses={verses}
            lang={lang}
            tLang={tLang}
            larivaar={!!display.larivaar}
            punjabiSteek={display.punjabiSteek}
          />
        ) : (
          <ShabadView
            meta={shabad.meta}
            verses={verses}
            activeIndex={activeIndex}
            confidence={confidence}
            tracked={isManual ? false : tracked}
            isListening={pageVoice.isListening}
            onLineClick={correctToLine}
            showTransliteration={display.showTransliteration}
            disableAutoScroll={voiceDebugOpen}
          />
        )
      )}
    </div>
  );
}
