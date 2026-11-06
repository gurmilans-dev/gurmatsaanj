import { EVENT_FIELDS, TRACE_CLOCK, TRACE_LIMITS, positionFor } from './recognitionTrace.js';

// Local, opt-in diagnostics. Never receives audio, credentials, or raw payloads.
let active = false;
let sessionId = '';
let startedAt = 0;
let origin = 0;
let durationMs = 0;
let events = [];
let shabads = Object.create(null);
let bytes = 1024;
let complete = true;
let reason = null;
let limits = TRACE_LIMITS;
let metadata = {};
let sequence = 0;
let markerSequence = 0;
const startListeners = new Set();
const publications = new Map();
const acknowledgements = new Set();
const navigationRequests = new Map();
const encoder = new TextEncoder();
const monotonic = () => performance.now();
const text = (value, max = 128) => String(value ?? '').slice(0, max);

function time() { return Math.max(durationMs, monotonic() - origin); }
function finish(cause) {
  active = false;
  if (cause) { complete = false; reason = cause; }
}
function fits(size) {
  if (events.length >= limits.maxEvents) { finish('event-limit'); return false; }
  if (bytes + size > limits.maxBytes) { finish('byte-limit'); return false; }
  if (time() > limits.maxDurationMs) { finish('duration-limit'); return false; }
  return true;
}

function position(value) {
  if (!value) return null;
  return {
    shabadId: text(value.shabadId), groupId: text(value.groupId || value.shabadId),
    verseId: value.verseId == null ? null : text(value.verseId),
    lineIndex: Number.isInteger(value.lineIndex) && value.lineIndex >= 0 ? value.lineIndex : null,
  };
}

function sanitize(type, value) {
  const out = {};
  for (const key of EVENT_FIELDS[type]) {
    const field = value[key];
    if (field === undefined) continue;
    if (key === 'position') out[key] = position(field);
    else if (key === 'competitors') out[key] = (Array.isArray(field) ? field : []).slice(0, 8).map((item) => ({ position: position(item.position), confidence: Number(item.confidence) || 0 }));
    else if (field === null || typeof field === 'boolean' || (typeof field === 'number' && Number.isFinite(field))) out[key] = field;
    else if (typeof field === 'string') {
      const max = ['append', 'interim', 'tail'].includes(key) ? 2048 : 128;
      if (field.length > max) { finish('oversized-field'); return null; }
      out[key] = field;
    }
  }
  return out;
}

export function startRecording(options = {}) {
  active = true;
  startedAt = Date.now(); // Human reference only; elapsed times use performance.now.
  origin = monotonic();
  durationMs = 0;
  sequence = 0;
  markerSequence = 0;
  sessionId = globalThis.crypto?.randomUUID?.() || `session-${startedAt}`;
  events = [];
  shabads = Object.create(null);
  publications.clear();
  acknowledgements.clear();
  navigationRequests.clear();
  bytes = 1024;
  complete = true;
  reason = null;
  limits = Object.fromEntries(Object.entries(TRACE_LIMITS).map(([key, cap]) => [key, Math.max(1, Math.min(cap, Number(options.limits?.[key]) || cap))]));
  metadata = { mode: text(options.mode || 'unknown'), synthetic: options.synthetic === true };
  recordEvent('session', { action: 'start' });
  for (const listener of startListeners) { try { listener(); } catch { /* Diagnostics must not affect the display. */ } }
}

export function subscribeRecordingStart(listener) {
  startListeners.add(listener);
  return () => startListeners.delete(listener);
}

export function stopRecording() {
  if (active) {
    recordEvent('session', { action: 'stop' });
    active = false;
  }
  return getTrace();
}
export function isRecording() { return active; }
export function eventCount() { return events.length; }
export function recordSyncMarker() {
  if (!active) return null;
  markerSequence += 1;
  return recordEvent('session', { action: 'sync-marker', reason: `marker-${markerSequence}` });
}
export function recordingStatus() {
  if (active && time() > limits.maxDurationMs) finish('duration-limit');
  return { active, reason, eventCount: events.length };
}

export function recordEvent(type, entry) {
  if (!active) return null;
  try {
    if (!Object.hasOwn(EVENT_FIELDS, type)) return null;
    const data = sanitize(type, typeof entry === 'function' ? entry() : entry);
    if (!data || !active) return null;
    const event = { id: `e${sequence + 1}`, t: time(), type, data };
    const size = encoder.encode(JSON.stringify(event)).length + 1;
    if (!fits(size)) return null;
    sequence += 1;
    bytes += size;
    durationMs = event.t;
    events.push(event);
    if (type === 'projector.publish') {
      publications.set(event.id, event.t);
      if (publications.size > 1024) publications.delete(publications.keys().next().value);
    }
    return event;
  } catch { return null; }
}

export function recordVerses(groupId, verses) {
  if (!active || !groupId || Object.hasOwn(shabads, String(groupId))) return;
  try {
    if (!Array.isArray(verses) || verses.length > 2000 || String(groupId).length > 128) { finish('oversized-canonical-group'); return; }
    if (verses.some((v) => String(v?.gurmukhi || '').length > 2048)) { finish('oversized-canonical-verse'); return; }
    const canonical = verses.map((v) => ({
      gurmukhi: text(v?.gurmukhi, 2048),
      verseId: v?.verseId == null ? null : text(v.verseId),
      shabadId: v?.shabadId == null ? null : text(v.shabadId),
    }));
    const size = encoder.encode(JSON.stringify({ [groupId]: canonical })).length + 1;
    if (!fits(size)) return;
    bytes += size;
    shabads[String(groupId)] = canonical;
  } catch { /* No effect on recognition. */ }
}

// Retain the original public API; v2 stores only the bounded matcher tail.
export function recordDecision(entry) {
  if (!active) return null;
  recordVerses(entry.shabadId, entry.verses);
  return recordEvent('matcher', {
    engine: entry.engine || 'kirtan', shabadId: String(entry.shabadId), tail: entry.tail,
    currentLine: entry.currentLine, lineIndex: entry.lineIndex, confidence: entry.confidence,
    tracked: entry.tracked, reason: entry.reason, inputEventId: entry.inputEventId,
    position: entry.position || positionFor(entry.shabadId, entry.verses, entry.lineIndex), competitors: entry.competitors,
  });
}

export function recordingIdentity() { return active ? sessionId : null; }
export function recordNavigation(action, source, target, cause) {
  if (!active) return;
  const key = target?.shabadId;
  const pending = action === 'committed' ? navigationRequests.get(key) : null;
  const event = recordEvent('navigation', { action, source: pending?.source || source, position: target, reason: cause, requestId: pending?.id });
  if (event && action === 'requested') {
    navigationRequests.set(key, { id: event.id, source });
    if (navigationRequests.size > 64) navigationRequests.delete(navigationRequests.keys().next().value);
  }
  if (action === 'committed') navigationRequests.delete(key);
}
export function recordProjectorAck(ack) {
  if (!active || ack?.sessionId !== sessionId || !publications.has(ack.publicationId)) return;
  if (!['received', 'committed'].includes(ack.phase) || typeof ack.receiverId !== 'string' || !ack.receiverId || ack.receiverId.length > 128) return;
  const key = `${ack.publicationId}:${ack.receiverId}:${ack.phase}`;
  if (acknowledgements.has(key)) return;
  const event = recordEvent('projector.ack', {
    publicationId: ack.publicationId, phase: ack.phase, receiverId: ack.receiverId,
    position: ack.position, mode: ack.mode,
    roundTripUpperBoundMs: time() - publications.get(ack.publicationId),
  });
  if (event) {
    acknowledgements.add(key);
    if (acknowledgements.size > 8192) acknowledgements.delete(acknowledgements.values().next().value);
  }
}

export function getTrace() {
  if (active && time() > limits.maxDurationMs) finish('duration-limit');
  return {
    version: 2, app: 'saanj-kirtan', sessionId, clock: TRACE_CLOCK, startedAt,
    durationMs: active ? time() : durationMs, eventCount: events.length,
    metadata: { ...metadata }, capture: { complete, reason, limits: { ...limits }, bytes },
    shabads: structuredClone(shabads), events: structuredClone(events),
  };
}

export function downloadTrace(filename) {
  const blob = new Blob([JSON.stringify(getTrace())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `kirtan-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
