import './KathaDebugPanel.css';

function valueOrDash(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

export default function KathaDebugPanel({
  tracking,
  transcript,
  activeIndex,
  groupLabel,
}) {
  const debug = tracking?.debug || {};
  const target = debug.target || {};
  const tail = String(transcript || '').trim().split(/\s+/).slice(-10).join(' ');

  return (
    <details className="katha-debug-panel">
      <summary>
        <span>Katha match debug</span>
        <span>{tracking?.status || 'idle'} · {Math.round(Number(tracking?.confidence || 0))}%</span>
      </summary>
      <div className="katha-debug-grid">
        <span>Current</span>
        <strong>{groupLabel || 'Opened view'} · line {activeIndex >= 0 ? activeIndex + 1 : '-'}</strong>
        <span>Transcript</span>
        <strong>{tail || '-'}</strong>
        <span>Result</span>
        <strong>{valueOrDash(debug.state)} · {valueOrDash(debug.reason)}</strong>
        <span>Best target</span>
        <strong>
          {target.type || '-'} {target.groupId || ''} · line {target.localIndex !== undefined ? Number(target.localIndex) + 1 : '-'}
        </strong>
        <span>Score</span>
        <strong>
          best {valueOrDash(debug.gateScore ?? debug.score)} · second {valueOrDash(debug.secondGateScore ?? debug.secondScore)} · gap {valueOrDash(debug.gap)}
        </strong>
        <span>Distance</span>
        <strong>
          {valueOrDash(debug.distance)} · {debug.isExpectedNearby ? 'nearby' : 'wide'}{debug.isBoundaryImmediate || debug.isBoundaryWindow ? ' · boundary' : ''}
        </strong>
        <span>Candidates</span>
        <strong>{valueOrDash(debug.candidates)}</strong>
      </div>
    </details>
  );
}
