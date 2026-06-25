import { useEffect, useMemo, useRef, useState } from 'react';
import {
  startRecording, stopRecording, isRecording, eventCount, downloadTrace,
} from '../../utils/sessionRecorder';
import './VoiceDebugPanel.css';

function valueOrDash(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function tail(text, count = 14) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).slice(-count).join(' ');
}

function shortText(text, max = 120) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}...`;
}

function lineText(verse) {
  return String(verse?.gurmukhi || verse?.text || verse?.line || '').trim();
}

function groupIdFor(group, fallback) {
  return String(group?.id || group?.shabadId || (group?.ang ? `ang-${group.ang}` : '') || fallback || '');
}

function buildCandidateLines({ verses, groups, activeIndex, target, currentGroupId }) {
  const targetGroupId = String(target?.groupId || '');
  const targetIndex = Number(target?.localIndex ?? -1);
  const rows = [];

  if (Array.isArray(groups) && groups.length) {
    groups.forEach((group, groupIndex) => {
      const gid = groupIdFor(group, groupIndex);
      const labelBase = group?.type === 'ang'
        ? `Ang ${group.ang || gid.replace(/^ang-/, '')}`
        : group?.type === 'shabad'
          ? `Shabad ${group.shabadId || gid}`
          : gid || `Group ${groupIndex + 1}`;
      (group?.verses || []).forEach((verse, index) => {
        rows.push({
          key: `${gid}:${index}`,
          groupId: gid,
          index,
          label: `${labelBase} - line ${index + 1}`,
          text: lineText(verse),
          isTarget: targetGroupId && String(gid) === targetGroupId && index === targetIndex,
          isCurrent: currentGroupId && String(gid) === String(currentGroupId) && index === Number(activeIndex),
        });
      });
    });
  } else if (Array.isArray(verses) && verses.length) {
    const gid = String(currentGroupId || targetGroupId || 'current');
    verses.forEach((verse, index) => {
      rows.push({
        key: `${gid}:${index}`,
        groupId: gid,
        index,
        label: `Line ${index + 1}`,
        text: lineText(verse),
        isTarget: index === targetIndex || index === Number(target?.lineIndex ?? -1),
        isCurrent: index === Number(activeIndex),
      });
    });
  }

  const hasTarget = rows.some((row) => row.isTarget);
  const hasCurrent = rows.some((row) => row.isCurrent);
  const importantIndexes = new Set();
  rows.forEach((row, idx) => {
    if (row.isTarget || row.isCurrent) {
      for (let offset = -3; offset <= 3; offset += 1) importantIndexes.add(idx + offset);
    }
  });

  let visible = rows.filter((_, idx) => importantIndexes.has(idx));
  if (!visible.length) visible = rows.slice(0, 24);
  if (visible.length < 12 && rows.length > visible.length) {
    const existing = new Set(visible.map((row) => row.key));
    rows.slice(0, 24).forEach((row) => {
      if (visible.length < 24 && !existing.has(row.key)) visible.push(row);
    });
  }

  return {
    rows,
    visible,
    hasTarget,
    hasCurrent,
  };
}

export default function VoiceDebugPanel({
  title = 'Voice debug',
  mode = 'viewer',
  voice,
  tracking,
  transcript,
  activeIndex = -1,
  verseCount = 0,
  groupLabel = '',
  verses = [],
  groups = [],
  currentGroupId = '',
  onOpenChange,
}) {
  const [copied, setCopied] = useState(false);
  const [recording, setRecording] = useState(isRecording());
  const [recCount, setRecCount] = useState(eventCount());
  const copyTimerRef = useRef(null);
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  // While recording, refresh the live event count once a second so the Stop
  // button shows progress without re-rendering on every poll.
  useEffect(() => {
    if (!recording) return undefined;
    const id = setInterval(() => setRecCount(eventCount()), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const toggleRecording = () => {
    if (recording) {
      stopRecording();
      setRecording(false);
      setRecCount(eventCount());
    } else {
      startRecording();
      setRecording(true);
      setRecCount(0);
    }
  };

  const debug = tracking?.debug || {};
  const target = debug.target || {};
  const transcriptTail = debug.transcript || debug.transcriptTail || tail(transcript);
  const confidence = Math.round(Number(tracking?.confidence ?? debug.confidence ?? 0));
  const status = tracking?.status || debug.status || (voice?.isListening ? 'listening' : 'idle');
  const currentLine = activeIndex >= 0 ? `${activeIndex + 1} / ${verseCount || '-'}` : `- / ${verseCount || '-'}`;
  const candidateInfo = useMemo(() => buildCandidateLines({
    verses,
    groups,
    activeIndex,
    target,
    currentGroupId,
  }), [activeIndex, currentGroupId, groups, target, verses]);
  const bestTargetLine = useMemo(() => {
    const direct = debug.targetText || debug.bestText || debug.gurmukhi || '';
    if (direct) return direct;
    const targetRow = candidateInfo.rows.find((row) => row.isTarget);
    if (targetRow?.text) return targetRow.text;
    const idx = Number(debug.lineIndex ?? target.localIndex ?? -1);
    if (idx >= 0 && Array.isArray(verses) && verses[idx]) return lineText(verses[idx]);
    return '';
  }, [candidateInfo.rows, debug.bestText, debug.gurmukhi, debug.lineIndex, debug.targetText, target.localIndex, verses]);
  const currentLineText = useMemo(() => {
    const row = candidateInfo.rows.find((item) => item.isCurrent);
    if (row?.text) return row.text;
    if (activeIndex >= 0 && Array.isArray(verses) && verses[activeIndex]) return lineText(verses[activeIndex]);
    return '';
  }, [activeIndex, candidateInfo.rows, verses]);
  const payload = useMemo(() => ({
    mode,
    groupLabel,
    listening: Boolean(voice?.isListening),
    supported: Boolean(voice?.isSupported),
    voiceError: voice?.error || '',
    status,
    activeIndex,
    verseCount,
    tracked: Boolean(tracking?.tracked),
    confidence,
    transcriptTail,
    lastFinal: voice?.lastFinal || '',
    bestTargetLine,
    currentLineText,
    candidates: candidateInfo.visible,
    debug,
  }), [
    activeIndex,
    confidence,
    debug,
    groupLabel,
    mode,
    status,
    tracking?.tracked,
    transcriptTail,
    verseCount,
    bestTargetLine,
    currentLineText,
    candidateInfo.visible,
    voice?.error,
    voice?.isListening,
    voice?.isSupported,
    voice?.lastFinal,
  ]);

  const copyDebug = async () => {
    try {
      await navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => { setCopied(false); copyTimerRef.current = null; }, 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <details
      className="voice-debug-panel"
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary>
        <span>{title}</span>
        <span>{status} - {confidence}%</span>
      </summary>

      <div className="voice-debug-toolbar">
        <span>{mode}</span>
        <button type="button" className="btn-ghost voice-debug-copy" onClick={copyDebug}>
          {copied ? 'Copied' : 'Copy debug'}
        </button>
        <button
          type="button"
          className="btn-ghost voice-debug-copy"
          onClick={toggleRecording}
          title="Record the live tracking stream for offline replay"
        >
          {recording ? `■ Stop (${recCount})` : '● Record'}
        </button>
        {!recording && recCount > 0 && (
          <button
            type="button"
            className="btn-ghost voice-debug-copy"
            onClick={() => downloadTrace()}
            title="Download the recorded session as JSON"
          >
            Download ({recCount})
          </button>
        )}
      </div>

      <div className="voice-debug-grid">
        <span>Mic</span>
        <strong>
          {voice?.isSupported ? (voice?.isListening ? 'listening' : 'off') : 'not supported'}
          {voice?.error ? ` - ${voice.error}` : ''}
        </strong>

        <span>Current line</span>
        <strong>
          {groupLabel ? `${groupLabel} - ${currentLine}` : currentLine}
          {currentLineText ? <em className="voice-debug-line-text">{currentLineText}</em> : null}
        </strong>

        <span>Transcript tail</span>
        <strong>{shortText(transcriptTail) || '-'}</strong>

        <span>Last final</span>
        <strong>{shortText(voice?.lastFinal) || '-'}</strong>

        <span>Tracking</span>
        <strong>
          {tracking?.tracked ? 'tracked' : 'not tracked'}
          {' - '}
          {valueOrDash(debug.state || debug.reason || status)}
        </strong>

        <span>Best target</span>
        <strong>
          {valueOrDash(target.type || debug.targetType)}
          {' '}
          {valueOrDash(target.groupId || debug.targetGroupId)}
          {' - line '}
          {target.localIndex !== undefined
            ? Number(target.localIndex) + 1
            : debug.lineIndex !== undefined
              ? Number(debug.lineIndex) + 1
              : '-'}
          {bestTargetLine ? <em className="voice-debug-line-text">{bestTargetLine}</em> : null}
        </strong>

        <span>Score</span>
        <strong>
          best {valueOrDash(debug.gateScore ?? debug.score ?? confidence)}
          {' - second '}
          {valueOrDash(debug.secondGateScore ?? debug.secondScore)}
          {' - gap '}
          {valueOrDash(debug.gap)}
        </strong>

        <span>Distance</span>
        <strong>
          {valueOrDash(debug.distance)}
          {debug.isExpectedNearby !== undefined ? ` - ${debug.isExpectedNearby ? 'nearby' : 'wide'}` : ''}
          {debug.isBoundaryImmediate || debug.isBoundaryWindow ? ' - boundary' : ''}
        </strong>

        <span>Candidates</span>
        <strong>
          {valueOrDash(debug.candidates ?? candidateInfo.rows.length ?? verseCount)}
          {' searched'}
          {candidateInfo.visible.length < candidateInfo.rows.length
            ? ` - showing ${candidateInfo.visible.length} nearby/important`
            : ''}
        </strong>
      </div>

      <div className="voice-debug-candidates">
        <div className="voice-debug-section-head">
          <strong>Candidate lines</strong>
          <span>{candidateInfo.rows.length || verseCount} total</span>
        </div>
        {candidateInfo.visible.length > 0 ? (
          <ol>
            {candidateInfo.visible.map((candidate) => (
              <li
                key={candidate.key}
                className={[
                  candidate.isTarget ? 'voice-debug-candidate-target' : '',
                  candidate.isCurrent ? 'voice-debug-candidate-current' : '',
                ].filter(Boolean).join(' ')}
              >
                <span>{candidate.label}</span>
                <p className="gurmukhi">{candidate.text || '-'}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="voice-debug-empty">No candidate lines available yet.</p>
        )}
      </div>

      <details className="voice-debug-help">
        <summary>What do these mean?</summary>
        <dl>
          <dt>Mic</dt>
          <dd>Whether browser speech recognition is supported and currently listening.</dd>
          <dt>Current line</dt>
          <dd>The line the viewer is currently highlighting before the next match is committed.</dd>
          <dt>Transcript tail</dt>
          <dd>The most recent words sent into the matcher. Usually only the last few words matter.</dd>
          <dt>Last final</dt>
          <dd>The last stable/final phrase from browser speech recognition.</dd>
          <dt>Tracking</dt>
          <dd>Whether the matcher accepted a line, rejected it, or is waiting for better audio.</dd>
          <dt>Best target</dt>
          <dd>The line the matcher currently thinks is best. This is not always committed if confidence is weak.</dd>
          <dt>Score</dt>
          <dd>Best score, second-best score, and their gap. A small gap means the app should avoid guessing.</dd>
          <dt>Distance</dt>
          <dd>How far the best target is from the current line. Nearby is safer than wide/far.</dd>
          <dt>Candidates</dt>
          <dd>The lines currently available to the matcher, usually the opened Shabad/Ang/Bani or preloaded Katha context.</dd>
        </dl>
      </details>
    </details>
  );
}
