import { createHash } from 'node:crypto';
import { readBundle } from '../../frontend/src/utils/captureBundle.js';
import { validateTrace } from '../../frontend/src/utils/recognitionTrace.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function inspectCapture(bytes) {
  const entries = readBundle(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
  const trace = validateTrace(JSON.parse(new TextDecoder().decode(entries['trace.json'])));
  if (manifest.version !== 1 || trace.version !== 2 || typeof manifest.complete !== 'boolean' || manifest.consent?.audioRecording !== true || manifest.kind !== 'synchronized-recognition-capture' || manifest.trace?.file !== 'trace.json' ||
      manifest.sessionId !== trace.sessionId || manifest.synthetic !== trace.metadata.synthetic || manifest.trace.sha256 !== hash(entries['trace.json'])) throw new Error('Capture manifest/trace identity or hash mismatch');
  const audio = manifest.audio?.file;
  if (!audio && (manifest.complete || manifest.audio?.bytes !== 0 || manifest.audio?.sha256 !== null)) throw new Error('Invalid partial audio manifest');
  if (audio) {
    if (!['audio.webm', 'audio.mp4', 'audio.ogg'].includes(audio) || !entries[audio] || entries[audio].length !== manifest.audio.bytes || hash(entries[audio]) !== manifest.audio.sha256) throw new Error('Capture audio identity or hash mismatch');
  }
  if (Object.keys(entries).some((name) => !['manifest.json', 'trace.json', audio].includes(name))) throw new Error('Unexpected capture payload');
  return { entries, manifest, trace, report: { version: 1, synthetic: manifest.synthetic, complete: manifest.complete,
    reason: manifest.reason, sessionId: trace.sessionId, audioBytes: audio ? entries[audio].length : 0,
    traceEvents: trace.events.length, durationMs: trace.durationMs, build: manifest.build,
    synchronization: manifest.synchronization?.status || 'unavailable',
    groundTruth: { status: 'unavailable', reason: 'Capture identity does not establish independent performance annotations or sample synchronization' },
    accuracy: { status: 'unavailable' }, recognitionInput: manifest.recognitionInput } };
}

// Choices come from a separately supplied canonical response, never page outputs.
export function canonicalChoices(canonical) {
  if (!Array.isArray(canonical?.verses) || canonical.verses.length > 2000) throw new Error('Independent canonical response required');
  return canonical.verses.map((verse, lineIndex) => {
    const shabadId = String(verse.shabadId); const verseId = String(verse.verseId);
    if (!/^[1-9][0-9]{0,11}$/.test(shabadId) || !/^[1-9][0-9]{0,11}$/.test(verseId)) throw new Error('Invalid canonical IDs');
    const raw = verse.verse?.unicode || verse.verse?.gurmukhi || '';
    return { target: { shabadId, groupId: shabadId, verseId, lineIndex }, text: typeof raw === 'string' ? raw : '' };
  });
}
