import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { matchLine } from '../../frontend/src/utils/matchLine.js';
import { matcherCalls, validateTrace } from '../../frontend/src/utils/recognitionTrace.js';
import { alignAnnotations, evaluateRecognition, summarizeDurations, validateAnnotations } from './recognition-evaluation.mjs';

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const unavailable = (reason) => ({ status: 'unavailable', reason });
export function readJson(file) {
  if (fs.statSync(file).size > 40 * 1024 * 1024) throw new Error('JSON exceeds 40 MiB');
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

export function inspectTrace(raw) {
  const trace = validateTrace(raw);
  const types = Object.create(null);
  const discovery = Object.create(null);
  const recognition = Object.create(null);
  const scriptObservations = { gurmukhi: 0, devanagari: 0, latin: 0 };
  const publications = new Map();
  const ackKeys = new Set();
  const committed = [];
  let invalidAcks = 0;
  let receivedAcks = 0;
  const committedPublications = new Set();
  const pageChanges = [];
  const states = [];
  let previousPosition = null;
  let manualEvents = 0;
  for (const event of trace.version === 2 ? trace.events : []) {
    const d = event.data;
    types[event.type] = (types[event.type] || 0) + 1;
    if (event.type === 'discovery') discovery[d.action] = (discovery[d.action] || 0) + 1;
    if (event.type === 'recognition') {
      recognition[d.action] = (recognition[d.action] || 0) + 1;
      if (d.action === 'result') {
        const found = new Set();
        for (const character of `${d.append} ${d.interim}`) {
          const code = character.codePointAt(0);
          if (code >= 0x0a00 && code <= 0x0a7f) found.add('gurmukhi');
          if (code >= 0x0900 && code <= 0x097f) found.add('devanagari');
          if (code >= 65 && code <= 90 || code >= 97 && code <= 122) found.add('latin');
        }
        for (const name of found) scriptObservations[name] += 1;
      }
    }
    if (event.type === 'manual') manualEvents += 1;
    if (event.type === 'projector.publish') publications.set(event.id, event.t);
    if (event.type === 'projector.ack') {
      const key = `${d.publicationId}:${d.receiverId}:${d.phase}`;
      const sentAt = publications.get(d.publicationId);
      if (ackKeys.has(key) || sentAt == null || typeof d.receiverId !== 'string' ||
          !Number.isFinite(d.roundTripUpperBoundMs) || d.roundTripUpperBoundMs < 0 || d.roundTripUpperBoundMs > event.t - sentAt + 0.001) {
        invalidAcks += 1;
      } else {
        ackKeys.add(key);
        if (d.phase === 'received') receivedAcks += 1;
        if (d.phase === 'committed') { committed.push(d.roundTripUpperBoundMs); committedPublications.add(d.publicationId); }
      }
    }
    if (event.type === 'page') {
      const p = d.position;
      const key = p ? `${p.shabadId}:${p.verseId ?? p.lineIndex}` : null;
      if (key !== previousPosition) pageChanges.push({ t: event.t, lineIndex: p?.lineIndex ?? null, shabadId: p?.shabadId ?? null });
      previousPosition = key;
      states.push({ t: event.t, lineIndex: p?.lineIndex ?? null, held: d.held === true, manual: d.manual === true, tracked: d.tracked === true });
    }
  }
  const calls = matcherCalls(trace);
  let mismatches = 0;
  for (const call of calls) {
    const result = matchLine(trace.shabads[call.shabadId], call.tail, { currentLine: call.currentLine });
    if (result.lineIndex !== call.lineIndex || result.confidence !== call.confidence || result.tracked !== call.tracked) mismatches += 1;
  }
  const stateTime = { observedMs: 0, heldMs: 0, manualMs: 0, followingMs: 0, uncertainMs: 0 };
  states.forEach((s, i) => {
    const ms = (states[i + 1]?.t ?? trace.durationMs) - s.t;
    stateTime.observedMs += ms;
    if (s.manual) stateTime.manualMs += ms;
    else if (s.held) stateTime.heldMs += ms;
    else if (s.tracked) stateTime.followingMs += ms;
    else stateTime.uncertainMs += ms;
  });
  return {
    durationMs: trace.durationMs, eventCount: trace.events.length, traceVersion: trace.version,
    synthetic: trace.metadata?.synthetic === true, capture: trace.capture || null,
    eventTypes: types, recognition, scriptObservations, discovery,
    matcherParity: { comparedCalls: calls.length, mismatches, status: calls.length ? mismatches ? 'mismatch' : 'exact' : 'unavailable' },
    trackedMatcherCalls: calls.filter((c) => c.tracked).length,
    farMatcherProposals: calls.filter((c) => Math.abs(c.lineIndex - c.currentLine) > 1).length,
    capturedGroups: Object.keys(trace.shabads), selectedPositionChanges: Math.max(0, pageChanges.length - 1),
    manualEventsObserved: manualEvents, stateTime,
    projector: { publications: publications.size, receivedAcks, committedAcks: committed.length,
      publicationsWithoutCommitAck: publications.size - committedPublications.size, rejectedAcks: invalidAcks,
      commitUpperBounds: summarizeDurations(committed),
      physicalDisplayLatency: unavailable('No physical display observation or correlated paint timestamps') },
    accuracy: unavailable('No verified independent labels and recording synchronization supplied'),
    timeline: states,
    interpretation: 'Operational counts and sender-clock bounds only. Tracked flags, cursor changes, holds, and parity do not establish correctness.',
  };
}

export function validateCanonicalReference(reference, canonicalByShabad) {
  if (!reference || typeof reference.video_id !== 'string' || !Array.isArray(reference.segments) || !Array.isArray(reference.lines)) throw new Error('Invalid external reference format');
  if (!Number.isFinite(reference.total_duration) || reference.total_duration <= 0 ||
      !Number.isFinite(reference.uem?.start) || !Number.isFinite(reference.uem?.end) || reference.uem.start < 0 || reference.uem.end > reference.total_duration || reference.uem.end <= reference.uem.start) throw new Error('Invalid external reference timebase');
  const failures = [];
  let previous = 0;
  const occurrences = reference.segments.map((s, i) => {
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < previous || s.end <= s.start || s.start < 0 || s.end > reference.total_duration || !Number.isInteger(s.line_idx) || s.line_idx < 0 ||
        !/^[1-9][0-9]{0,11}$/.test(String(s.shabad_id)) || !/^[1-9][0-9]{0,11}$/.test(String(s.verse_id))) throw new Error('Invalid/overlapping external segment');
    previous = s.end;
    const shabadId = String(s.shabad_id ?? '');
    const verses = canonicalByShabad[shabadId]?.verses;
    const verse = Number.isInteger(s.line_idx) && s.line_idx >= 0 ? verses?.[s.line_idx] : null;
    const line = reference.lines.find((l) => l.line_idx === s.line_idx && String(l.shabad_id) === shabadId);
    const verified = Boolean(verse && line && String(verse.shabadId) === shabadId && String(verse.verseId) === String(s.verse_id));
    if (!verified) failures.push({ occurrence: i + 1, reason: 'Canonical Shabad/verse/index mismatch' });
    return { id: `${reference.video_id}-${i + 1}`, startMs: Math.max(s.start, reference.uem.start) * 1000, endMs: Math.min(s.end, reference.uem.end) * 1000,
      activity: 'kirtan', status: verified ? 'verified-external' : 'provisional',
      target: { shabadId, groupId: shabadId, verseId: String(s.verse_id), lineIndex: s.line_idx } };
  }).filter((s) => s.endMs > s.startMs);
  return { recordingId: reference.video_id, durationMs: reference.total_duration * 1000,
    scoredWindowMs: { start: reference.uem.start * 1000, end: reference.uem.end * 1000 },
    occurrences, canonicalFailures: failures,
    verifiedTargetMs: occurrences.filter((s) => s.status === 'verified-external').reduce((sum, s) => sum + s.endMs - s.startMs, 0),
    provenanceReliability: 'Publisher-declared human review; canonical IDs independently checked. Audio has not been personally re-annotated.' };
}

export function prepareAnnotations(trace, traceHash, reference, evidence) {
  if (!evidence || evidence.traceSha256 !== traceHash || !/^[a-f0-9]{64}$/.test(evidence.mediaSha256 || '') ||
      evidence.recordingId !== reference.recordingId || evidence.independent !== true || evidence.status !== 'verified-external' ||
      !evidence.sourceUrl || !evidence.license || !/^[a-f0-9]{64}$/.test(evidence.referenceSha256 || '')) throw new Error('Verified source, trace/media identity, and independent evidence are required');
  if (!Array.isArray(evidence.anchors) || evidence.anchors.length < 2 || !Number.isFinite(evidence.timingUncertaintyMs) || evidence.timingUncertaintyMs < 0) throw new Error('Independent synchronization evidence is required');
  const segments = reference.occurrences.map((s) => ({ id: s.id, startMs: s.startMs, endMs: s.endMs,
    activity: s.status === 'verified-external' ? s.activity : 'ambiguous', target: s.status === 'verified-external' ? s.target : null }));
  const labels = alignAnnotations({ version: 1, sessionId: trace.sessionId || 'legacy', synthetic: false,
    timebase: 'media-ms', timingUncertaintyMs: evidence.timingUncertaintyMs,
    provenance: { independent: true, method: `External reviewed reference: ${evidence.sourceUrl}` },
    alignment: { anchors: evidence.anchors }, segments });
  validateAnnotations(labels, trace);
  return labels;
}

export function wavMetadata(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Verified scoring requires decoded PCM WAV metadata');
  let format; let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) throw new Error('Truncated WAV chunk');
    if (name === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format');
      format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8), blockAlign: bytes.readUInt16LE(start + 12), bitsPerSample: bytes.readUInt16LE(start + 14) };
    }
    if (name === 'data') dataBytes += size;
    offset = start + size + (size % 2);
  }
  if (!format || ![1, 3].includes(format.encoding) || !format.channels || !format.sampleRate || !format.byteRate || !dataBytes ||
      format.blockAlign !== format.channels * format.bitsPerSample / 8 || format.byteRate !== format.sampleRate * format.blockAlign || dataBytes % format.blockAlign) throw new Error('Unsupported/inconsistent PCM WAV metadata');
  return { ...format, dataBytes, durationMs: dataBytes * 1000 / format.byteRate };
}

export function evaluateVerifiedCase({ traceBytes, canonicalByShabad, evidence, mediaBytes, referenceBytes }) {
  const trace = validateTrace(JSON.parse(traceBytes.toString('utf8').replace(/^\uFEFF/, '')));
  if (trace.metadata?.synthetic) throw new Error('Synthetic captures cannot be promoted to real-world evaluations');
  if (!mediaBytes || sha256(mediaBytes) !== evidence?.mediaSha256 || !referenceBytes || sha256(referenceBytes) !== evidence.referenceSha256) throw new Error('Media/reference hashes do not match evidence');
  const reference = validateCanonicalReference(JSON.parse(referenceBytes), canonicalByShabad);
  if (!reference.verifiedTargetMs) throw new Error('No canonically verified target time');
  const media = wavMetadata(mediaBytes);
  if (Math.abs(media.durationMs - reference.durationMs) > 100) throw new Error('Audio/reference duration mismatch exceeds 100 ms');
  const labels = prepareAnnotations(trace, sha256(traceBytes), reference, evidence);
  return { labels, media, report: evaluateRecognition(trace, labels) };
}

export async function fetchBounded(url, { maxBytes = 1024 * 1024, fetcher = fetch } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('External evidence must use HTTPS');
  const response = await fetcher(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Source exceeds byte bound');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Source exceeds byte bound');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

export function writeNewOrSame(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (sha256(fs.readFileSync(file)) !== sha256(contents)) throw new Error(`Refusing to overwrite existing evidence: ${path.basename(file)}`);
    return;
  }
  fs.writeFileSync(file, contents, { flag: 'wx' });
}

export function timelineSvg(summary) {
  const width = 1000; const height = 230; const left = 50; const plotWidth = 920;
  const duration = summary.durationMs || 1;
  const maxLine = summary.timeline.reduce((maximum, s) => Math.max(maximum, s.lineIndex ?? 0), 1);
  const x = (t) => left + t * plotWidth / duration;
  const y = (line) => 170 - line * 130 / maxLine;
  const points = [];
  const holds = [];
  summary.timeline.forEach((s, i) => {
    const end = summary.timeline[i + 1]?.t ?? duration;
    if (s.held) holds.push(`<rect x="${x(s.t)}" y="30" width="${x(end) - x(s.t)}" height="145" fill="#f5d087"/>`);
    if (s.lineIndex != null) points.push(`${x(s.t)},${y(s.lineIndex)} ${x(end)},${y(s.lineIndex)}`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Observed selected Pangti index and hold intervals">
<rect width="100%" height="100%" fill="white"/><text x="50" y="20" font-family="sans-serif" font-size="14">Observed selected Pangti index; amber intervals show hold state</text>
${holds.join('\n')}<path d="M50 30V175H970" fill="none" stroke="#555"/><polyline points="${points.join(' ')}" fill="none" stroke="#245b94" stroke-width="2"/>
<text x="25" y="${y(0) + 4}" font-family="sans-serif" font-size="12">0</text><text x="25" y="${y(maxLine) + 4}" font-family="sans-serif" font-size="12">${maxLine}</text>
<text x="50" y="200" font-family="sans-serif" font-size="12">0 s</text><text x="900" y="200" font-family="sans-serif" font-size="12">${(duration / 1000).toFixed(1)} s</text>
<text x="50" y="222" font-family="sans-serif" font-size="12">Ground truth unavailable; these states do not establish correctness.</text></svg>\n`;
}
