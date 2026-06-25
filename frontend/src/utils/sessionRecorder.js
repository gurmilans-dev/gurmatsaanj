/**
 * Session recorder — captures the live line-tracking stream so a real diwan
 * can be replayed and measured offline (see tools/replay-session.js).
 *
 * Because matchLine() now runs client-side and is deterministic, a recording
 * of its inputs is enough to reproduce every decision exactly: for each poll
 * we store the transcript tail, the current line, and the result. The shabad's
 * verses are captured once per shabadId (Gurmukhi only) so replay can re-run
 * matchLine without any network.
 *
 * It's a module singleton toggled from the Voice debug panel. The hot path
 * (recordDecision) is a cheap no-op while recording is off, so it can be
 * called unconditionally from useLineTracking.
 */

let active = false;
let startedAt = 0;
let events = [];
let shabadVerses = {}; // shabadId -> [{ gurmukhi }]

// Cap memory for a multi-hour session. At ~5 polls/sec a 3h diwan is ~54k
// events; we keep the most recent MAX_EVENTS and drop the oldest.
const MAX_EVENTS = 60000;

export function startRecording() {
  active = true;
  startedAt = Date.now();
  events = [];
  shabadVerses = {};
}

export function stopRecording() {
  active = false;
  return getTrace();
}

export function isRecording() {
  return active;
}

export function eventCount() {
  return events.length;
}

/**
 * Append one tracking decision. Safe to call every poll — no-ops when not
 * recording. Captures the shabad's verses the first time each shabadId is
 * seen (handles auto-advance across shabads in one session).
 */
export function recordDecision(entry) {
  if (!active) return;
  const id = String(entry?.shabadId ?? '');
  if (id && !shabadVerses[id] && Array.isArray(entry?.verses)) {
    shabadVerses[id] = entry.verses.map((v) => ({ gurmukhi: v?.gurmukhi || '' }));
  }
  if (events.length >= MAX_EVENTS) events.shift();
  events.push({
    t: Date.now() - startedAt,
    shabadId: id,
    transcript: String(entry?.transcript || ''),
    tail: String(entry?.tail || ''),
    currentLine: Number(entry?.currentLine),
    lineIndex: Number(entry?.lineIndex),
    confidence: Number(entry?.confidence),
    tracked: Boolean(entry?.tracked),
    reason: entry?.reason || '',
  });
}

export function getTrace() {
  return {
    version: 1,
    app: 'saanj-kirtan',
    startedAt,
    durationMs: events.length ? events[events.length - 1].t : 0,
    eventCount: events.length,
    shabads: { ...shabadVerses },
    events: [...events],
  };
}

/** Trigger a browser download of the current trace as JSON. */
export function downloadTrace(filename) {
  const trace = getTrace();
  const blob = new Blob([JSON.stringify(trace)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename
    || `kirtan-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
