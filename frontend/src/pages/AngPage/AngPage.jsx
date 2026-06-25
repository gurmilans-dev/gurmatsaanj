import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ShabadView from '../../features/shabadView/ShabadView';
import ProjectorControls from '../../features/projector/ProjectorControls';
import ProjectorMiniPreview from '../../features/projector/ProjectorMiniPreview';
import VoiceDebugPanel from '../../features/voiceRecognition/VoiceDebugPanel';
import Loader from '../../components/common/Loader/Loader';
import ConfidenceBadge from '../../components/common/ConfidenceBadge/ConfidenceBadge';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import usePageVoiceTracking from '../../hooks/usePageVoiceTracking';
import useKathaLineTracking from '../../hooks/useKathaLineTracking';
import useWakeLock from '../../hooks/useWakeLock';
import useAnandSahibWatch, { ANAND_SAHIB_BUNDLE_ID } from '../../hooks/useAnandSahibWatch';
import { trimToWords } from '../../utils/gurmukhi';
import '../ShabadPage/ShabadPage.css';
import './AngPage.css';

const ANG_MIN = 1;
const ANG_MAX = 1430;

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

function clampAng(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return ANG_MIN;
  return Math.min(ANG_MAX, Math.max(ANG_MIN, Math.floor(value)));
}

function withKatha(path, source) {
  const qs = new URLSearchParams({ katha: '1' });
  if (source) qs.set('source', source);
  return `${path}?${qs.toString()}`;
}

export default function AngPage() {
  const { ang } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    voice,
    setEditableTranscript,
    display,
    updateDisplay,
    setSelectedShabad,
    setActiveLine,
    setKathaBoundary,
    remoteLineCommand,
    observeProjectorTranscript,
    kathaStayInCurrent,
    setKathaStayInCurrent,
    pushToast,
    pushShabadHistory,
    openProjector,
    focusProjector,
    projectorWindowOpen,
    projectorDisplay,
    setProjectorDisplay,
    setRemoteMicTargetGetter,
  } = useApp();

  const source = searchParams.get('source') || '';
  const isKatha = searchParams.get('katha') === '1';
  const seedShabadId = String(searchParams.get('seed') || '').replace(/[^0-9A-Za-z_-]/g, '');
  const angNo = clampAng(ang);
  const routeLineIndex = Math.max(0, Number(searchParams.get('line') || 0) || 0);
  // Viewer-mic + manual-line + remote-mic registration + projector-transcript
  // observation are shared with ShabadPage; lives in a single hook now.
  const {
    pageVoice,
    wrappedStart,
    wrappedStop,
    userStoppedMicRef,
    manualLine,
    setManualLine,
    manualAnchorVersion,
    bumpManualAnchor,
    manualLineTimerRef,
  } = usePageVoiceTracking({
    setRemoteMicTargetGetter,
    observeProjectorTranscript,
  });

  const [page, setPage] = useState(null);
  const [nearby, setNearby] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lineHint, setLineHint] = useState(0);
  const [voiceDebugOpen, setVoiceDebugOpen] = useState(false);

  // Keep the screen awake while an Ang is open (katha full-ang reading).
  useWakeLock(Boolean(page) && !error);

  // Always-on Anand Sahib (6-pauri) watch — opens the bundle if Bhog's Anand
  // Sahib starts while a full Ang is open.
  useAnandSahibWatch({
    active: pageVoice.isListening && !loading && !error,
    transcript: pageVoice.transcript,
    currentShabadId: '',
    onDetect: () => {
      pushToast({
        kind: 'info',
        title: 'Anand Sahib detected',
        message: 'Opening Anand Sahib (6 pauris).',
        timeoutMs: 3500,
      });
      navigate(`/shabad/${ANAND_SAHIB_BUNDLE_ID}?bundle=anand-sahib${isKatha ? '&katha=1' : ''}`);
    },
  });

  // Stop the global search-page mic on mount so this page's viewer mic can
  // take over cleanly. The viewer mic is owned by usePageVoiceTracking.
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
    setPage(null);
    setNearby([]);
    setManualLine(null);
    setLineHint(routeLineIndex);
    pageVoice.reset?.();

    const loadOne = (n) => api.getAng(n, {
      source: source || undefined,
      seedShabadId: n === angNo && seedShabadId ? seedShabadId : undefined,
    })
      .then((data) => ({ ...data, meta: { ...data.meta, pageNo: n } }));

    Promise.all([
      isKatha && angNo > ANG_MIN ? loadOne(angNo - 1).catch(() => null) : Promise.resolve(null),
      loadOne(angNo),
      isKatha && angNo < ANG_MAX ? loadOne(angNo + 1).catch(() => null) : Promise.resolve(null),
    ])
      .then(([prev, current, next]) => {
        if (cancelled) return;
        setPage(current);
        if (current?.__offline) {
          pushToast({
            kind: 'info',
            title: 'Opened from cache',
            message: `Network failed, so Ang ${angNo} was restored from saved data.`,
            timeoutMs: 3500,
          });
        }
        if (current?.meta?.seedFallbackUsed) {
          pushToast({
            kind: 'info',
            title: 'Full Ang partially loaded',
            message: 'The full Ang endpoint returned no lines, so related Shabad lines are shown instead.',
            timeoutMs: 4500,
          });
        }
        if (current?.verses?.[0]?.shabadId) {
          pushShabadHistory?.({
            shabadId: current.verses[0].shabadId,
            gurmukhi: current.verses[0].gurmukhi || `Ang ${angNo}`,
            raag: current?.meta?.raag || '',
            writer: current?.meta?.writer || '',
            source: current?.meta?.source || '',
            pageNo: angNo,
            title: `Ang ${angNo}`,
            kind: 'ang',
            mode: 'katha',
          });
        }
        const groups = [prev, current, next]
          .filter(Boolean)
          .map((item) => ({
            id: `ang-${item.meta.pageNo}`,
            type: 'ang',
            ang: item.meta.pageNo,
            verses: item.verses || [],
          }));
        setNearby(groups);
        setSelectedShabad({
          ...current,
          meta: {
            ...(current?.meta || {}),
            pageNo: angNo,
            source: current?.meta?.source || source || '',
            remoteKind: 'ang',
            remoteMode: isKatha ? 'katha-ang' : 'ang',
            isKatha,
          },
        });
        openProjector?.();
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.response?.data?.error || err.message || 'Could not load Ang';
        setError(msg);
        pushToast({ kind: 'error', title: 'Could not open Ang', message: msg });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angNo, source, seedShabadId, isKatha, routeLineIndex, setSelectedShabad, pushToast, pushShabadHistory, openProjector]);

  const verses = page?.verses || [];
  const verseCount = verses.length;
  const currentLineForTracking = manualLine !== null ? manualLine : lineHint;

  const handleNearbyNavigate = useCallback((group, lineIndex = 0) => {
    if (!group?.ang) return;
    pushToast({
      kind: 'info',
      title: 'Nearby Ang detected',
      message: `Opening Ang ${group.ang}.`,
      timeoutMs: 3000,
    });
    const qs = new URLSearchParams({ katha: '1', line: String(Math.max(0, Number(lineIndex) || 0)) });
    if (source) qs.set('source', source);
    navigate(`/ang/${encodeURIComponent(group.ang)}?${qs.toString()}`);
  }, [navigate, pushToast, source]);

  const kathaTracking = useKathaLineTracking({
    active: isKatha && pageVoice.isListening && !loading && !error && nearby.length > 0,
    transcript: pageVoice.transcript,
    groups: nearby,
    currentGroupId: `ang-${angNo}`,
    currentLineIndex: currentLineForTracking,
    onNavigate: handleNearbyNavigate,
    stayInCurrentGroup: kathaStayInCurrent,
    anchorLineIndex: manualLine,
    anchorVersion: manualAnchorVersion,
  });

  const activeIndex = manualLine !== null
    ? manualLine
    : (kathaTracking.lineIndex >= 0 ? kathaTracking.lineIndex : lineHint);
  const isManual = manualLine !== null;

  useEffect(() => {
    if (kathaTracking.tracked && kathaTracking.lineIndex >= 0) {
      setLineHint(kathaTracking.lineIndex);
    }
  }, [kathaTracking.tracked, kathaTracking.lineIndex]);
  useEffect(() => {
    if (manualLine !== null) setLineHint(manualLine);
  }, [manualLine]);

  useEffect(() => {
    if (!verses.length) return;
    if (activeIndex < 0 || activeIndex >= verses.length) {
      setActiveLine({ index: -1, text: '', tracked: false });
      return;
    }
    const v = verses[activeIndex];
    setActiveLine({
      index: activeIndex,
      text: v?.gurmukhi || '',
      tracked: !isManual && kathaTracking.tracked,
    });
  }, [activeIndex, verses, isManual, kathaTracking.tracked, setActiveLine]);

  useEffect(() => {
    if (!setKathaBoundary) return;
    if (!isKatha || nearby.length === 0) {
      setKathaBoundary({ prevVerse: null, nextVerse: null });
      return;
    }

    const currentIndex = nearby.findIndex((group) => Number(group.ang) === angNo);
    if (currentIndex < 0) {
      setKathaBoundary({ prevVerse: null, nextVerse: null });
      return;
    }

    const prevGroup = currentIndex > 0 ? nearby[currentIndex - 1] : null;
    const nextGroup = currentIndex < nearby.length - 1 ? nearby[currentIndex + 1] : null;
    setKathaBoundary({
      prevVerse: prevGroup?.verses?.length ? prevGroup.verses[prevGroup.verses.length - 1] : null,
      nextVerse: nextGroup?.verses?.length ? nextGroup.verses[0] : null,
    });
  }, [isKatha, nearby, angNo, setKathaBoundary]);

  useEffect(() => () => {
    setKathaBoundary?.({ prevVerse: null, nextVerse: null });
  }, [setKathaBoundary]);

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
  }, [verseCount]);

  const goPrev = () => {
    const cur = manualLine !== null ? manualLine : Math.max(0, activeIndex);
    correctToLine(Math.max(0, cur - 1));
  };
  const goNext = () => {
    const cur = manualLine !== null ? manualLine : Math.max(0, activeIndex);
    correctToLine(Math.min(verseCount - 1, cur + 1));
  };
  const resumeLive = () => setManualLine(null);

  useEffect(() => {
    if (!remoteLineCommand?.id || loading || error || !page) return;
    if (remoteLineCommand.type === 'line-prev') goPrev();
    else if (remoteLineCommand.type === 'line-next') goNext();
    else if (remoteLineCommand.type === 'line-first') correctToLine(0);
    else if (remoteLineCommand.type === 'line-last') correctToLine(verseCount - 1);
    else if (remoteLineCommand.type === 'line-select') correctToLine(remoteLineCommand.index);
    else if (remoteLineCommand.type === 'resume-live') resumeLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteLineCommand?.id]);

  useEffect(() => {
    if (loading || error || !page) return undefined;
    const handleKeyDown = (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || tag === 'a' || event.target?.isContentEditable) return;
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
  }, [loading, error, page, manualLine, activeIndex, verseCount, pageVoice?.isSupported, pageVoice.isListening, wrappedStart, wrappedStop]);

  const goPrevAng = () => {
    if (angNo <= ANG_MIN) {
      pushToast({ kind: 'info', title: 'No previous Ang', message: 'You are at the first Ang.' });
      return;
    }
    navigate(withKatha(`/ang/${angNo - 1}`, source));
  };
  const goNextAng = () => {
    if (angNo >= ANG_MAX) {
      pushToast({ kind: 'info', title: 'No next Ang', message: 'You are at the last Ang.' });
      return;
    }
    navigate(withKatha(`/ang/${angNo + 1}`, source));
  };

  const openOrFocusProjector = () => {
    if (projectorWindowOpen) {
      focusProjector?.();
      return;
    }
    openProjector?.();
  };

  const updateProjectorFont = (value) => {
    setProjectorDisplay?.({ ...(projectorDisplay || {}), fontScale: value });
  };

  const trackingStatusText = useMemo(() => {
    if (isManual) return pageVoice.isListening ? 'Line corrected - listening' : 'Line selected manually';
    if (kathaTracking.tracked && activeIndex >= 0) return `Following mic - line ${activeIndex + 1}`;
    if (!pageVoice.isListening) return 'Mic off';
    if (kathaTracking.status === 'matching') return 'Listening - finding nearby line';
    if (kathaTracking.status === 'no-match') return 'Listening - no confident nearby match';
    return 'Listening';
  }, [isManual, kathaTracking.status, kathaTracking.tracked, activeIndex, pageVoice.isListening]);
  const boundaryPreview = useMemo(() => {
    if (!isKatha || activeIndex < 0 || verseCount < 1 || nearby.length === 0) return null;
    const currentIndex = nearby.findIndex((group) => Number(group.ang) === angNo);
    if (currentIndex < 0) return null;
    const nearEnd = activeIndex >= Math.max(0, verseCount - 2);
    const nearStart = activeIndex <= 1;
    const nextGroup = nearby[currentIndex + 1];
    const prevGroup = nearby[currentIndex - 1];
    if (nearEnd && nextGroup?.verses?.[0]) {
      return {
        type: 'next',
        label: `Next Ang ${nextGroup.ang}`,
        detail: 'First line',
        text: nextGroup.verses[0].gurmukhi || '',
        group: nextGroup,
        lineIndex: 0,
      };
    }
    if (nearStart && prevGroup?.verses?.length) {
      return {
        type: 'previous',
        label: `Previous Ang ${prevGroup.ang}`,
        detail: 'Last line',
        text: prevGroup.verses[prevGroup.verses.length - 1]?.gurmukhi || '',
        group: prevGroup,
        lineIndex: prevGroup.verses.length - 1,
      };
    }
    return null;
  }, [activeIndex, angNo, isKatha, nearby, verseCount]);

  return (
    <div className="app-container shabad-page ang-page">
      <div className="shabad-page-sticky">
        <div className="shabad-page-primary">
          <button
            type="button"
            className="btn btn-secondary btn-sm shabad-page-back"
            onClick={() => navigate('/katha')}
          >
            Back
          </button>

          <div className="shabad-page-title-block">
            <p className="shabad-page-title">Ang {angNo}</p>
            {!loading && !error && page && (
              <div className="shabad-meta-pills shabad-page-title-meta">
                <span className="meta-pill meta-pill-muted">Full Ang</span>
                {page.meta?.source && <span className="meta-pill meta-pill-muted">{page.meta.source}</span>}
                <span className="meta-pill meta-pill-status meta-pill-status-on" aria-live="polite">
                  <span className="meta-pill-dot" aria-hidden="true" />
                  <span>{trackingStatusText}</span>
                  {kathaTracking.tracked && !isManual && <ConfidenceBadge value={kathaTracking.confidence} compact />}
                </span>
              </div>
            )}
          </div>

          <div className="shabad-page-mic">
            {pageVoice.isSupported && (
              <button
                type="button"
                className={`btn btn-sm ${pageVoice.isListening ? 'btn-primary' : 'btn-secondary'}`}
                onClick={pageVoice.isListening ? wrappedStop : wrappedStart}
              >
                {pageVoice.isListening ? <MicOffIcon /> : <MicIcon />}
                {pageVoice.isListening ? 'Stop mic' : 'Start mic'}
              </button>
            )}
          </div>
        </div>

        {!loading && !error && page && (
          <div className="shabad-control-groups" aria-label="Katha Ang controls">
            <section className="shabad-control-group shabad-display-group">
              <p className="shabad-control-label">Display controls</p>
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
              <button type="button" className="btn btn-secondary btn-sm" onClick={openOrFocusProjector}>
                {projectorWindowOpen ? 'Focus projector' : 'Open projector'}
              </button>
              <label className="shabad-font-control">
                <span>Font</span>
                <input
                  type="range"
                  min="0.75"
                  max="1.35"
                  step="0.05"
                  value={projectorDisplay?.fontScale || 1}
                  onChange={(event) => updateProjectorFont(Number(event.target.value))}
                />
              </label>
              <details className="shabad-advanced-projector">
                <summary>Advanced projector</summary>
                <ProjectorControls compact embedded />
              </details>
            </section>

            <section className="shabad-control-group shabad-live-group">
              <p className="shabad-control-label">Live controls</p>
              {pageVoice.isSupported && (
                <button
                  type="button"
                  className={`btn btn-sm ${pageVoice.isListening ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={pageVoice.isListening ? wrappedStop : wrappedStart}
                >
                  {pageVoice.isListening ? <MicOffIcon /> : <MicIcon />}
                  {pageVoice.isListening ? 'Stop mic' : 'Start mic'}
                </button>
              )}

            <div className="shabad-nav-controls">
              <div className="shabad-nav-line">
                <button type="button" className="btn btn-secondary btn-sm shabad-nav-btn" onClick={goPrev} disabled={activeIndex <= 0} aria-label="Previous line">&lt;</button>
                <span className="shabad-nav-indicator">
                  {activeIndex >= 0 ? `${activeIndex + 1} / ${verseCount}` : `${verseCount} lines`}
                  {isManual && <span className="shabad-nav-mode"> - selected</span>}
                </span>
                <button type="button" className="btn btn-secondary btn-sm shabad-nav-btn" onClick={goNext} disabled={activeIndex >= verseCount - 1} aria-label="Next line">&gt;</button>
              </div>
              {isManual && (
                <button type="button" className="btn-ghost shabad-nav-resume" onClick={resumeLive}>
                  Resume live
                </button>
              )}

              <div className="shabad-nav-shabad">
                <button
                  type="button"
                  role="switch"
                  aria-checked={!kathaStayInCurrent}
                  onClick={() => setKathaStayInCurrent?.(!kathaStayInCurrent)}
                  className={`katha-stay-toggle${!kathaStayInCurrent ? ' katha-stay-toggle-on' : ''}`}
                  title={!kathaStayInCurrent
                    ? 'Auto-open nearby Angs is on'
                    : 'Auto-open nearby Angs is off'}
                >
                  <svg className="katha-stay-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <circle cx="8" cy="3" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8 4.6v9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M5.5 7h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 10c0 2 2.2 3.5 5 3.5s5-1.5 5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                  </svg>
                  <span className="katha-stay-label">Auto-open nearby Angs</span>
                  <span className="katha-stay-track" aria-hidden="true">
                    <span className="katha-stay-thumb" />
                  </span>
                </button>
                <button type="button" className="btn-ghost shabad-nav-btn" onClick={goPrevAng}>
                  &lt; Ang
                </button>
                <button type="button" className="btn-ghost shabad-nav-btn" onClick={goNextAng}>
                  Ang &gt;
                </button>
              </div>
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
          </div>
        )}
      </div>


      {/* Floating mini-preview — sticks in the bottom-right corner so the
          user can always see what the sangat is being shown. */}
      {!loading && !error && page && (
        <VoiceDebugPanel
          title="Katha Ang voice debug"
          mode="katha-ang"
          voice={pageVoice}
          tracking={kathaTracking}
          transcript={pageVoice.transcript}
          activeIndex={activeIndex}
          verseCount={verseCount}
          groupLabel={`Ang ${angNo}`}
          verses={verses}
          groups={nearby}
          currentGroupId={`ang-${angNo}`}
          onOpenChange={setVoiceDebugOpen}
        />
      )}

      {!loading && !error && page && <ProjectorMiniPreview />}

      {loading && (
        <div className="shabad-page-state">
          <Loader label="Opening Ang..." size="lg" />
        </div>
      )}

      {error && (
        <div className="shabad-page-state shabad-page-error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && page && (
        <ShabadView
          meta={page.meta}
          verses={verses}
          activeIndex={activeIndex}
          confidence={kathaTracking.confidence}
          tracked={isManual ? false : kathaTracking.tracked}
          isListening={pageVoice.isListening}
          onLineClick={correctToLine}
          disableAutoScroll={voiceDebugOpen}
        />
      )}
    </div>
  );
}
