// Shared by the opt-in recorder and the offline tools; no recognition policy.
export const TRACE_VERSION = 2;
export const TRACE_CLOCK = 'relative-monotonic-ms';
export const TRACE_LIMITS = Object.freeze({ maxEvents: 120000, maxBytes: 32 * 1024 * 1024, maxDurationMs: 12 * 60 * 60 * 1000 });
export const EVENT_FIELDS = Object.freeze({
  session: ['action', 'reason'],
  recognition: ['action', 'streamId', 'epoch', 'language', 'source', 'append', 'interim', 'final', 'resultIndex', 'error', 'baselineTruncated'],
  matcher: ['engine', 'shabadId', 'tail', 'currentLine', 'lineIndex', 'confidence', 'tracked', 'reason', 'inputEventId', 'position', 'competitors'],
  tracker: ['engine', 'position', 'accepted', 'reason', 'pendingLine', 'pendingCount', 'requestId'],
  discovery: ['action', 'reason', 'requestId', 'generation', 'shabadId', 'tail', 'signature', 'absentCount', 'confidence', 'currentConfidence', 'competitors', 'evidenceAgeMs', 'confirmationAgeMs', 'cooldownMs'],
  hold: ['state', 'freshnessMs'],
  navigation: ['action', 'source', 'reason', 'position', 'requestId'],
  manual: ['action', 'position', 'source'],
  page: ['position', 'mode', 'held', 'tracked', 'manual', 'evidenceAgeMs'],
  'projector.publish': ['position', 'mode'],
  'projector.ack': ['publicationId', 'phase', 'receiverId', 'position', 'mode', 'roundTripUpperBoundMs'],
  'projector.render': ['position', 'mode', 'timingEvidence'],
});

export function positionFor(groupId, verses, index) {
  const lineIndex = Number.isInteger(index) && index >= 0 ? index : null;
  const verse = lineIndex == null ? null : verses?.[lineIndex];
  return {
    shabadId: String(verse?.shabadId || groupId || ''), groupId: String(groupId || ''),
    verseId: verse?.verseId == null ? null : String(verse.verseId), lineIndex,
  };
}

export function projectorPosition(payload) {
  if (payload?.mode !== 'shabad' || !payload.shabad) return null;
  const verses = payload.shabad.verses || [];
  if (!verses.length) return null;
  const selected = payload.activeLine?.index;
  // ProjectorPage explicitly renders the opening verse when no current exists.
  const index = Number.isInteger(selected) && verses[selected] ? selected : 0;
  return positionFor(payload.shabad.meta?.shabadId || payload.shabad.shabadId, verses, index);
}

export function samePosition(a, b, shabadOnly = false) {
  if (!a || !b || a.shabadId !== b.shabadId) return false;
  if (shabadOnly) return true;
  if (a.verseId != null && b.verseId != null) return a.verseId === b.verseId;
  return a.lineIndex != null && b.lineIndex != null && a.lineIndex === b.lineIndex &&
    (a.groupId || a.shabadId) === (b.groupId || b.shabadId);
}

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const id = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const line = (value) => Number.isInteger(value) && value >= -1;
function requireValue(ok, message) { if (!ok) throw new Error(message); }

export function validatePosition(value, label = 'position') {
  requireValue(object(value) && id(value.shabadId), `${label}: shabadId required`);
  requireValue(value.verseId == null || id(value.verseId), `${label}: invalid verseId`);
  requireValue(value.groupId == null || id(value.groupId), `${label}: invalid groupId`);
  requireValue(value.lineIndex == null || (line(value.lineIndex) && value.lineIndex >= 0), `${label}: invalid lineIndex`);
  return value;
}

export function validateTrace(raw) {
  requireValue(object(raw), 'Trace must be an object');
  requireValue(raw.version === 1 || raw.version === TRACE_VERSION, 'Unsupported trace version');
  requireValue(finite(raw.durationMs) && raw.durationMs >= 0, 'Invalid trace durationMs');
  requireValue(Array.isArray(raw.events) && raw.events.length <= TRACE_LIMITS.maxEvents, 'Invalid or oversized events array');
  requireValue(object(raw.shabads), 'Trace shabads dictionary required');
  if (raw.version === 2) {
    requireValue(id(raw.sessionId) && raw.clock === TRACE_CLOCK, 'Trace sessionId/monotonic clock required');
    requireValue(object(raw.capture) && typeof raw.capture.complete === 'boolean', 'Trace capture status required');
    requireValue(raw.eventCount === raw.events.length, 'Trace eventCount mismatch');
    requireValue(object(raw.metadata) && typeof raw.metadata.synthetic === 'boolean', 'Trace synthetic metadata required');
  }
  for (const [key, verses] of Object.entries(raw.shabads)) {
    requireValue(id(key) && Array.isArray(verses) && verses.length <= 2000, 'Invalid canonical verse dictionary');
    for (const verse of verses) requireValue(object(verse) && typeof verse.gurmukhi === 'string', 'Invalid canonical verse');
  }
  const seen = new Set();
  let previous = -1;
  for (const [i, event] of raw.events.entries()) {
    requireValue(object(event) && finite(event.t) && event.t >= 0 && event.t <= raw.durationMs, `Event ${i}: invalid timestamp`);
    requireValue(event.t >= previous, `Event ${i}: out-of-order timestamp`);
    previous = event.t;
    const data = raw.version === 1 ? event : event.data;
    const type = raw.version === 1 ? 'matcher' : event.type;
    if (raw.version === 2) {
      requireValue(id(event.id) && !seen.has(event.id), `Event ${i}: missing/duplicate id`);
      seen.add(event.id);
      requireValue(Object.hasOwn(EVENT_FIELDS, type) && object(data), `Event ${i}: invalid type/data`);
      for (const key of Object.keys(data)) requireValue(EVENT_FIELDS[type].includes(key), `Event ${i}: unknown ${type} field ${key}`);
    }
    requireValue(object(data), `Event ${i}: invalid data`);
    if (raw.version === 2) {
      for (const key of ['accepted', 'tracked', 'held', 'manual', 'final', 'baselineTruncated']) {
        if (Object.hasOwn(data, key)) requireValue(typeof data[key] === 'boolean', `Event ${i}: invalid ${key}`);
      }
      for (const key of ['confidence', 'currentConfidence', 'generation', 'absentCount', 'evidenceAgeMs', 'confirmationAgeMs', 'cooldownMs', 'freshnessMs', 'roundTripUpperBoundMs']) {
        if (Object.hasOwn(data, key)) requireValue(finite(data[key]), `Event ${i}: invalid ${key}`);
      }
      if (['session', 'discovery', 'navigation', 'manual'].includes(type)) requireValue(id(data.action), `Event ${i}: missing action`);
      if (type === 'hold') requireValue(['following', 'held', 'locked', 'idle'].includes(data.state), `Event ${i}: invalid hold state`);
      if (type === 'tracker') requireValue(typeof data.accepted === 'boolean' && typeof data.engine === 'string', `Event ${i}: invalid tracker commitment`);
      if (data.competitors != null) {
        requireValue(Array.isArray(data.competitors) && data.competitors.length <= 8, `Event ${i}: invalid competitors`);
        for (const candidate of data.competitors) { validatePosition(candidate.position, `Event ${i} competitor`); requireValue(finite(candidate.confidence), `Event ${i}: invalid competitor score`); }
      }
    }
    if (type === 'matcher') {
      requireValue(id(data.shabadId) && typeof data.tail === 'string' && line(data.currentLine) && line(data.lineIndex) &&
        finite(data.confidence) && typeof data.tracked === 'boolean', `Event ${i}: invalid matcher call`);
      requireValue(Array.isArray(raw.shabads[data.shabadId]), `Event ${i}: missing matcher verses`);
    }
    if (data.position != null) validatePosition(data.position, `Event ${i}`);
    if (['page', 'projector.publish', 'projector.render'].includes(type)) {
      requireValue(typeof data.mode === 'string' && Object.hasOwn(data, 'position'), `Event ${i}: output mode/position required`);
    }
    if (type === 'recognition') {
      requireValue(id(data.streamId) && typeof data.action === 'string', `Event ${i}: recognition action/stream required`);
      if (data.action === 'result') requireValue(typeof data.append === 'string' && typeof data.interim === 'string' && typeof data.final === 'boolean', `Event ${i}: invalid transcript revision`);
    }
    if (type === 'projector.ack') requireValue(id(data.publicationId) && ['received', 'committed'].includes(data.phase), `Event ${i}: invalid acknowledgement`);
    if (type === 'projector.render') requireValue(data.timingEvidence === 'trace-clock', `Event ${i}: projector timestamp is not correlated`);
  }
  return raw;
}

export function matcherCalls(raw) {
  validateTrace(raw);
  return raw.version === 1 ? raw.events : raw.events.filter((e) => e.type === 'matcher' && e.data.engine === 'kirtan').map((e) => ({ ...e.data, t: e.t }));
}
