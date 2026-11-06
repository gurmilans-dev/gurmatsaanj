import { samePosition, validatePosition, validateTrace } from '../../frontend/src/utils/recognitionTrace.js';

const ACTIVITIES = new Set(['kirtan', 'katha', 'silence', 'instrumental', 'explanation', 'ambiguous']);
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const unavailable = (reason, extra = {}) => ({ status: 'unavailable', reason, ...extra });
const percentage = (part, total) => total > 0 ? part * 100 / total : null;
function labelAt(segments, t) {
  let lo = 0; let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const segment = segments[mid];
    if (t < segment.startMs) hi = mid - 1;
    else if (t >= segment.endMs) lo = mid + 1;
    else return segment;
  }
  return undefined;
}
const eligible = (s) => s?.target && s.activity !== 'ambiguous';

export function alignAnnotations(labels) {
  if (labels?.timebase !== 'media-ms') return labels;
  const anchors = labels.alignment?.anchors;
  if (!Array.isArray(anchors) || anchors.length < 2) throw new Error('Media alignment requires at least two independent sync anchors');
  let previous = null;
  for (const anchor of anchors) {
    if (!finite(anchor.mediaMs) || !finite(anchor.traceMs) || anchor.mediaMs < 0 || anchor.traceMs < 0 ||
        previous && (anchor.mediaMs <= previous.mediaMs || anchor.traceMs <= previous.traceMs)) throw new Error('Invalid or out-of-order sync anchors');
    previous = anchor;
  }
  const convert = (time) => {
    if (!finite(time) || time < anchors[0].mediaMs || time > anchors.at(-1).mediaMs) throw new Error('Labels outside sync anchors cannot be extrapolated');
    const index = Math.max(0, anchors.findIndex((a) => a.mediaMs >= time) - 1);
    const a = anchors[index]; const b = anchors[index + 1];
    return a.traceMs + (time - a.mediaMs) * (b.traceMs - a.traceMs) / (b.mediaMs - a.mediaMs);
  };
  if (!Array.isArray(labels.segments)) throw new Error('Invalid annotation segments');
  return { ...labels, timebase: 'trace-relative-ms', sourceTimebase: 'media-ms', segments: labels.segments.map((s) => ({ ...s, startMs: convert(s.startMs), endMs: convert(s.endMs) })) };
}

export function validateAnnotations(labels, trace) {
  if (!labels || labels.version !== 1 || labels.sessionId !== (trace.sessionId || 'legacy')) throw new Error('Annotation version/sessionId mismatch');
  if (labels.provenance?.independent !== true) throw new Error('Annotations must declare independent ground truth');
  if (typeof labels.provenance.method !== 'string' || !labels.provenance.method) throw new Error('Annotation review method required');
  if (labels.timebase !== 'trace-relative-ms') throw new Error('Annotations must use trace-relative-ms; align media first');
  if (Boolean(labels.synthetic) !== Boolean(trace.metadata?.synthetic)) throw new Error('Synthetic trace/annotation flags disagree');
  if (!Array.isArray(labels.segments) || labels.segments.length > 60000) throw new Error('Invalid annotation segments');
  const uncertaintyMs = labels.timingUncertaintyMs ?? 0;
  if (!finite(uncertaintyMs) || uncertaintyMs < 0) throw new Error('Invalid annotation timing uncertainty');
  let end = 0;
  const ids = new Set();
  for (const segment of labels.segments) {
    if (!segment || typeof segment.id !== 'string' || !segment.id || ids.has(segment.id)) throw new Error('Missing/duplicate annotation occurrence id');
    ids.add(segment.id);
    if (!finite(segment.startMs) || !finite(segment.endMs) || segment.startMs < end || segment.endMs <= segment.startMs || segment.endMs > trace.durationMs) throw new Error('Invalid, overlapping, or out-of-order annotation interval');
    if (!ACTIVITIES.has(segment.activity)) throw new Error('Invalid annotation activity');
    if (!Object.hasOwn(segment, 'target')) throw new Error('Annotation target must be explicit (null for unknown)');
    if (segment.target != null) validatePosition(segment.target, `Annotation ${segment.id}`);
    end = segment.endMs;
  }
  return labels;
}

// This reconstructs recorded decisions, not a second implementation of the
// recognition policy. No matcher is seeded with a recorded current position.
export function replayTimeline(raw) {
  const trace = validateTrace(raw);
  const state = { streams: Object.create(null), tracker: null, trackerPending: null, page: null, held: null, pending: null, request: null, cooldownUntil: null };
  const checkpoints = [];
  if (trace.version === 1) return { state, checkpoints, limitation: 'Legacy traces contain matcher proposals only.' };
  for (const event of trace.events) {
    const d = event.data;
    if (event.type === 'recognition') {
      const stream = state.streams[d.streamId] ||= { final: '', interim: '', epoch: 0 };
      stream.epoch = d.epoch ?? stream.epoch;
      if (d.action === 'reset') { stream.final = ''; stream.interim = ''; }
      if (d.action === 'baseline') { stream.final = d.append || ''; stream.interim = d.interim || ''; stream.baselineTruncated = Boolean(d.baselineTruncated); }
      if (d.action === 'result') {
        stream.final = `${stream.final} ${d.append}`.trim();
        stream.interim = d.interim;
      }
    }
    if (event.type === 'tracker') {
      if (d.accepted) { state.tracker = d.position; state.trackerPending = null; }
      else if (d.pendingLine != null) state.trackerPending = { lineIndex: d.pendingLine, count: d.pendingCount ?? null };
    }
    if (event.type === 'page') { state.page = d.position; state.held = d.held ?? null; }
    if (event.type === 'hold') state.held = ['held', 'locked'].includes(d.state);
    if (event.type === 'manual') { state.pending = null; state.request = null; state.trackerPending = null; }
    if (event.type === 'discovery') {
      if (d.action === 'request') state.request = { requestId: d.requestId || event.id, generation: d.generation };
      if (d.action === 'pending') state.pending = { requestId: d.requestId, shabadId: d.shabadId, generation: d.generation };
      if (['invalidate', 'committed'].includes(d.action) ||
          ['rejected', 'expired'].includes(d.action) && d.requestId != null && d.requestId === state.request?.requestId) {
        state.pending = null; state.request = null;
      }
      if (finite(d.cooldownMs)) state.cooldownUntil = event.t + d.cooldownMs;
    }
    if (['tracker', 'page', 'hold', 'discovery', 'manual', 'navigation'].includes(event.type)) checkpoints.push({
      eventId: event.id, t: event.t, tracker: state.tracker, trackerPending: state.trackerPending, page: state.page,
      held: state.held, pending: state.pending, request: state.request, cooldownUntil: state.cooldownUntil,
      cooldownActive: state.cooldownUntil != null && event.t < state.cooldownUntil,
    });
  }
  return { state, checkpoints, limitation: 'Observed-state replay only: pending/hold/cooldown events are reconstructed, not recomputed. It does not simulate a changed policy or network.' };
}

function intervals(trace, type) {
  const output = trace.version === 2 ? trace.events.filter((e) => e.type === type) : [];
  const rows = [];
  let previous = null;
  let start = 0;
  for (const event of output) {
    if (event.t > start) rows.push({ start, end: event.t, data: previous });
    previous = event.data;
    start = event.t;
  }
  if (start < trace.durationMs) rows.push({ start, end: trace.durationMs, data: previous });
  return rows;
}

function comparable(a, b) {
  if (!a || !b || a.shabadId !== b.shabadId) return true;
  return (a.verseId != null && b.verseId != null) ||
    (a.lineIndex != null && b.lineIndex != null && (a.groupId || a.shabadId) === (b.groupId || b.shabadId));
}

function splitSegments(segments, rows, uncertaintyMs) {
  let cursor = 0;
  return segments.filter(eligible).map((segment) => {
    const start = segment.startMs + uncertaintyMs;
    const end = segment.endMs - uncertaintyMs;
    const pieces = [];
    while (cursor < rows.length && rows[cursor].end <= start) cursor += 1;
    for (let i = cursor; i < rows.length && rows[i].start < end; i += 1) {
      const row = rows[i];
      const from = Math.max(start, row.start);
      const to = Math.min(end, row.end);
      if (to <= from) continue;
      const known = row.data !== null && !(row.data.position === null && ['shabad', 'kirtan', 'katha'].includes(row.data.mode));
      const lineKnown = known && comparable(row.data.position, segment.target);
      const correct = lineKnown ? samePosition(row.data.position, segment.target) : null;
      pieces.push({ start: from, end: to, data: row.data, known, lineKnown, correct });
    }
    return { segment, start, end: Math.max(start, end), pieces };
  });
}

export function summarizeDurations(values) {
  if (!values.length) return unavailable('No detected samples', { n: 0, medianMs: null, p90Ms: null, p95Ms: null });
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return {
    status: 'available', n: sorted.length,
    medianMs: sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    p90Ms: sorted.length >= 10 ? quantile(0.9) : null,
    p95Ms: sorted.length >= 20 ? quantile(0.95) : null,
    percentileRule: 'Median for n>=1; nearest-rank p90 for n>=10, p95 for n>=20.',
  };
}

function stableRun(pieces, from, stableMs) {
  let start = null;
  for (const p of pieces) {
    if (p.end <= from) continue;
    if (p.correct === true) {
      start ??= Math.max(from, p.start);
      if (p.end - start >= stableMs) return { start, confirmedAt: start + stableMs };
    } else start = null;
  }
  return null;
}

function evaluateLayer(trace, labels, type, stableMs) {
  const rows = intervals(trace, type);
  const spans = splitSegments(labels.segments, rows, labels.timingUncertaintyMs || 0);
  const totals = { labeledMs: 0, knownMs: 0, lineKnownMs: 0, correctLineMs: 0, correctShabadMs: 0, heldMs: 0, followingMs: 0, manualMs: 0, uncertainMs: 0, flagsKnownMs: 0 };
  const transitions = [];
  const recoveries = [];
  let previousSegment = null;
  for (const { segment, start, end, pieces } of spans) {
    totals.labeledMs += end - start;
    for (const p of pieces) {
      const duration = p.end - p.start;
      if (p.known) {
        totals.knownMs += duration;
        if (samePosition(p.data.position, segment.target, true)) totals.correctShabadMs += duration;
      }
      if (p.lineKnown) totals.lineKnownMs += duration;
      if (p.correct) totals.correctLineMs += duration;
      if (typeof p.data?.held === 'boolean' && typeof p.data?.tracked === 'boolean' && typeof p.data?.manual === 'boolean') {
        totals.flagsKnownMs += duration;
        if (p.data.manual) totals.manualMs += duration;
        else if (p.data.held) totals.heldMs += duration;
        else if (p.data.tracked) totals.followingMs += duration;
        else totals.uncertainMs += duration;
      }
    }
    const isTransition = previousSegment &&
      (previousSegment.endMs !== segment.startMs || !samePosition(previousSegment.target, segment.target));
    if (isTransition) {
      const run = stableRun(pieces, start, stableMs);
      const unknownBefore = pieces.some((p) => !p.lineKnown && (!run || p.start < run.confirmedAt));
      transitions.push({
        occurrenceId: segment.id, activity: segment.activity,
        kind: previousSegment.target.shabadId === segment.target.shabadId ? 'line-or-return' : 'shabad',
        status: labels.timingUncertaintyMs > 0 || unknownBefore ? 'unavailable' : end - start < stableMs ? 'insufficient-window' : run ? 'detected' : 'undetected',
        latencyMs: run && !unknownBefore && !labels.timingUncertaintyMs ? run.start - segment.startMs : null,
        confirmedAtMs: run?.confirmedAt ?? null,
      });
    }
    previousSegment = segment;
    // Recovery starts only after a previously correct output becomes wrong
    // within the same independently labeled occurrence.
    let seenCorrect = false;
    let lossAt = null;
    let stableStart = null;
    for (const p of pieces) {
      if (p.correct === null) {
        if (lossAt != null) recoveries.push({ occurrenceId: segment.id, lossAtMs: lossAt, status: 'unavailable', recoveryMs: null });
        seenCorrect = false; lossAt = null; stableStart = null;
      } else if (p.correct) {
        seenCorrect = true;
        if (lossAt != null) {
          stableStart ??= p.start;
          if (p.end - stableStart >= stableMs) {
            recoveries.push({ occurrenceId: segment.id, lossAtMs: lossAt, status: 'recovered', recoveryMs: stableStart - lossAt });
            lossAt = null;
          }
        }
      } else {
        stableStart = null;
        if (seenCorrect && lossAt == null) lossAt = p.start;
      }
    }
    if (lossAt != null) recoveries.push({ occurrenceId: segment.id, lossAtMs: lossAt, status: 'censored', recoveryMs: null });
  }
  const accuracy = (known, correct) => totals.labeledMs === 0 ? unavailable('No independently labeled target time') : known < totals.labeledMs
    ? unavailable('Output evidence does not cover all labeled target time', { knownMs: known, unknownMs: totals.labeledMs - known, correctMs: correct })
    : { status: 'available', percent: percentage(correct, totals.labeledMs), correctMs: correct, denominatorMs: totals.labeledMs };
  return {
    totals,
    displayAccuracy: accuracy(totals.lineKnownMs, totals.correctLineMs),
    shabadAccuracy: accuracy(totals.knownMs, totals.correctShabadMs),
    coverage: totals.labeledMs > 0 && totals.flagsKnownMs === totals.labeledMs ? {
      status: 'available', followingPercent: percentage(totals.followingMs, totals.labeledMs), heldPercent: percentage(totals.heldMs, totals.labeledMs), manualPercent: percentage(totals.manualMs, totals.labeledMs),
      uncertainPercent: percentage(totals.uncertainMs, totals.labeledMs),
    } : unavailable('Explicit following/hold/manual flags do not cover labeled time'),
    transitionLatency: { ...summarizeDurations(transitions.filter((x) => x.status === 'detected').map((x) => x.latencyMs)), stableMs, samples: transitions,
      undetected: transitions.filter((x) => x.status === 'undetected').length, unavailable: transitions.filter((x) => x.status === 'unavailable').length,
      insufficientWindow: transitions.filter((x) => x.status === 'insufficient-window').length },
    recovery: { ...summarizeDurations(recoveries.filter((x) => x.status === 'recovered').map((x) => x.recoveryMs)), episodes: recoveries,
      censored: recoveries.filter((x) => x.status === 'censored').length },
  };
}

function eventMetrics(trace, labels, denominatorMs, outputComplete) {
  let previousPage = null;
  let falseLineJumps = 0;
  let falseShabadSwitches = 0;
  let unscoredChanges = 0;
  let automaticSwitches = 0;
  let unclassifiedSwitches = 0;
  let latestCommit = null;
  const interventions = Object.create(null);
  const stages = { matcher: { labeled: 0, correct: 0 }, retrieval: { labeled: 0, correctTop1: 0, correctInCapturedCandidates: 0 } };
  for (const event of trace.version === 2 ? trace.events : []) {
    const d = event.data;
    const label = labelAt(labels.segments, event.t);
    const target = eligible(label) ? label.target : null;
    if (event.type === 'navigation' && d.action === 'committed') latestCommit = d;
    if (event.type === 'manual') interventions[d.action] = (interventions[d.action] || 0) + 1;
    if (event.type === 'page') {
      if (previousPage && d.position && previousPage.shabadId !== d.position.shabadId) {
        if (latestCommit?.position?.shabadId !== d.position.shabadId || !['automatic', 'operator'].includes(latestCommit.source)) unclassifiedSwitches += 1;
        else if (latestCommit.source === 'automatic') {
          automaticSwitches += 1;
          if (!target) unscoredChanges += 1;
          else if (!samePosition(d.position, target, true)) falseShabadSwitches += 1;
        }
        latestCommit = null;
      }
      if (previousPage && d.position && previousPage.shabadId === d.position.shabadId && !samePosition(previousPage, d.position)) {
        if (!target || !comparable(d.position, target)) unscoredChanges += 1;
        else if (samePosition(d.position, target, true) && !samePosition(d.position, target)) falseLineJumps += 1;
      }
      if (d.position) previousPage = d.position;
    }
    if (event.type === 'matcher' && target) { stages.matcher.labeled += 1; if (samePosition(d.position, target)) stages.matcher.correct += 1; }
    if (event.type === 'discovery' && d.action === 'results' && d.competitors?.length) {
      const atQuery = labelAt(labels.segments, event.t - (d.evidenceAgeMs || 0));
      if (eligible(atQuery)) {
        stages.retrieval.labeled += 1;
        if (samePosition(d.competitors[0].position, atQuery.target, true)) stages.retrieval.correctTop1 += 1;
        if (d.competitors.some((c) => samePosition(c.position, atQuery.target, true))) stages.retrieval.correctInCapturedCandidates += 1;
      }
    }
  }
  const rate = (count) => denominatorMs > 0 && trace.version === 2 && outputComplete
    ? { status: 'available', count, perLabeledHour: count * 3600000 / denominatorMs, denominatorMs }
    : unavailable('No committed v2 output / labeled target time', { count: null });
  const count = Object.values(interventions).reduce((a, b) => a + b, 0);
  return {
    falseLineJumps: rate(falseLineJumps),
    falseShabadSwitches: unclassifiedSwitches ? unavailable('Some committed Shabad changes have no operator/automatic provenance', { unclassifiedSwitches }) : rate(falseShabadSwitches), automaticSwitches, unscoredChanges,
    manualInterventions: trace.version === 2 ? { status: 'available', observedCount: count, byType: interventions, perRecordedHour: trace.durationMs > 0 ? count * 3600000 / trace.durationMs : null,
      scope: 'Explicit operator events only; other routes/devices may not be instrumented.' } : unavailable('Legacy trace has no operator events'),
    stageDiagnostics: { ...stages, speechRecognition: unavailable('Independent verbatim speech transcription/audio alignment is not supplied'),
      interpretation: 'Proposal/retrieval counts are diagnostic evidence, not calibrated probabilities or causal error attribution.' },
  };
}

export function evaluateRecognition(raw, rawLabels, { stableMs = 1000 } = {}) {
  const trace = validateTrace(raw);
  const labels = alignAnnotations(rawLabels);
  validateAnnotations(labels, trace);
  if (!finite(stableMs) || stableMs <= 0) throw new Error('stableMs must be positive');
  const page = evaluateLayer(trace, labels, 'page', stableMs);
  const projector = evaluateLayer(trace, labels, 'projector.render', stableMs);
  const acknowledgements = trace.version === 2 ? trace.events.filter((e) => e.type === 'projector.ack') : [];
  const committedAcks = acknowledgements.filter((e) => e.data.phase === 'committed');
  return {
    version: 1, sessionId: trace.sessionId || 'legacy', synthetic: labels.synthetic === true,
    traceVersion: trace.version, durationMs: trace.durationMs, capture: trace.capture || { complete: null, reason: 'Legacy capture bounds unknown' },
    annotation: { method: labels.provenance.method, occurrences: labels.segments.length, timingUncertaintyMs: labels.timingUncertaintyMs || 0,
      annotatedMs: labels.segments.reduce((sum, s) => sum + s.endMs - s.startMs, 0), evaluableTargetMs: page.totals.labeledMs },
    page, projector, ...eventMetrics(trace, labels, page.totals.labeledMs, page.totals.knownMs === page.totals.labeledMs),
    projectorAcknowledgements: { received: acknowledgements.filter((e) => e.data.phase === 'received').length, committed: committedAcks.length,
      commitRoundTripUpperBounds: summarizeDurations(committedAcks.map((e) => e.data.roundTripUpperBoundMs).filter(finite)),
      interpretation: 'Sender-clock acknowledgement times bound delivery/React commit from above; they are not exact projector render/paint times.' },
    replay: { mode: 'observed-state', limitation: replayTimeline(trace).limitation },
    limitations: ['No real-world accuracy claim follows from synthetic fixtures.', 'Matcher confidence is not a calibrated probability.',
      'Display accuracy includes operator assistance; compare interventions and control operator actions across runs.',
      'Legacy matcher calls cannot establish tracker/page/projector output.', 'Projector acknowledgements alone cannot establish exact time-weighted render accuracy.'],
  };
}

function metric(value, field = 'percent') {
  return value.status === 'available' ? String(value[field] ?? 'unavailable') : `unavailable (${value.reason})`;
}

export function reportMarkdown(report) {
  return [
    report.synthetic ? '# SYNTHETIC recognition benchmark — not real performance accuracy' : '# Recognition benchmark',
    '', `Session: ${report.sessionId}. Duration: ${report.durationMs} ms. Trace version: ${report.traceVersion}.`,
    `Independent annotation method: ${report.annotation.method}. Evaluable target time: ${report.annotation.evaluableTargetMs} ms.`, '',
    '| Metric | Result |', '|---|---|',
    `| Page Shabad + Pangti accuracy (%) | ${metric(report.page.displayAccuracy)} |`,
    `| Page Shabad accuracy (%) | ${metric(report.page.shabadAccuracy)} |`,
    `| False line jumps / labeled hour | ${metric(report.falseLineJumps, 'perLabeledHour')} |`,
    `| False automatic Shabad switches / labeled hour | ${metric(report.falseShabadSwitches, 'perLabeledHour')} |`,
    `| Transition median / p90 / p95 (ms) | ${metric(report.page.transitionLatency, 'medianMs')} / ${report.page.transitionLatency.p90Ms ?? 'unavailable'} / ${report.page.transitionLatency.p95Ms ?? 'unavailable'} |`,
    `| Undetected / unavailable / short transitions | ${report.page.transitionLatency.undetected} / ${report.page.transitionLatency.unavailable} / ${report.page.transitionLatency.insufficientWindow} |`,
    `| Recovery median (ms) / censored episodes | ${metric(report.page.recovery, 'medianMs')} / ${report.page.recovery.censored} |`,
    `| Explicit manual interventions | ${metric(report.manualInterventions, 'observedCount')} |`,
    `| Projector Shabad + Pangti accuracy (%) | ${metric(report.projector.displayAccuracy)} |`, '',
    'Following/held/manual fractions describe recorded state, not calibrated correctness. See the JSON report for denominators, unknown time, individual transitions, recovery episodes, and diagnostic counts.', '',
    report.projectorAcknowledgements.interpretation, '',
    `Capture complete: ${report.capture.complete ?? 'unknown'}${report.capture.reason ? ` (${report.capture.reason})` : ''}.`,
    report.replay.limitation, '', ...report.limitations.map((line) => `- ${line}`), '',
  ].join('\n');
}
