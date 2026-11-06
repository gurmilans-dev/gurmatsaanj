import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectorPage from '../src/pages/ProjectorPage/ProjectorPage';
import { projectorAcknowledge, projectorPost, projectorSubscribe } from '../src/services/projector';
import { getTrace, startRecording, stopRecording } from '../src/utils/sessionRecorder';
import { validateTrace } from '../src/utils/recognitionTrace';

vi.mock('../src/hooks/useWakeLock', () => ({ default: () => {} }));
const messages = [];
const listeners = new Set();
class FixtureChannel {
  postMessage(message) { messages.push(message); }
  addEventListener(_, listener) { listeners.add(listener); }
  removeEventListener(_, listener) { listeners.delete(listener); }
}
const emit = (message) => { for (const listener of [...listeners]) listener({ data: message }); };

describe('optional projector observability without cross-clock subtraction', () => {
  let renderer;
  let unsubscribe;
  const payload = {
    mode: 'shabad', shabad: { meta: { shabadId: 'fixture' }, verses: [{ gurmukhi: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ', verseId: 'fixture-0' }] },
    activeLine: { index: -1, tracked: false },
  };
  beforeEach(() => {
    stopRecording(); messages.length = 0; listeners.clear();
    vi.stubGlobal('BroadcastChannel', FixtureChannel);
    vi.stubGlobal('window', { BroadcastChannel: FixtureChannel, addEventListener: vi.fn(), removeEventListener: vi.fn(), innerWidth: 1200, navigator: {} });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    vi.stubGlobal('document', { body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  });
  afterEach(() => {
    if (renderer) act(() => { renderer.unmount(); }); renderer = null;
    unsubscribe?.(); unsubscribe = null;
    stopRecording(); vi.unstubAllGlobals();
  });
  it('sends the exact existing state message and no acknowledgements when disabled', () => {
    const original = { type: 'state', payload };
    projectorPost(original);
    expect(messages).toEqual([original]);
    expect(messages[0]).toBe(original);
    projectorAcknowledge(original, 'committed', payload);
    expect(messages).toHaveLength(1);
  });
  it('separates publication, receipt, and actual React commit acknowledgement', () => {
    unsubscribe = projectorSubscribe(() => {});
    act(() => { renderer = create(createElement(ProjectorPage)); });
    startRecording({ synthetic: true });
    projectorPost({ type: 'state', payload: { ...payload, backgroundDataUrl: 'private-image', sangatShareUrl: '' } });
    const publication = messages.at(-1);
    expect(publication.diagnostics.publicationId).toBeTruthy();
    act(() => { emit(publication); });
    const acks = messages.filter((m) => m.type === 'trace-ack');
    expect(acks.map((m) => m.payload.phase)).toEqual(['received', 'committed']);
    const opening = renderer.root.findByProps({ className: 'projector-line projector-line-opening gurmukhi' });
    expect(opening.findAllByType('span').map((word) => word.children.join('')).join(' ')).toBe('ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ');
    for (const ack of acks) emit(ack);
    const trace = getTrace();
    expect(trace.events.filter((e) => e.type === 'projector.ack')).toHaveLength(2);
    expect(trace.events.find((e) => e.type === 'projector.publish').data.position).toMatchObject({ verseId: 'fixture-0', lineIndex: 0 });
    expect(JSON.stringify(trace)).not.toContain('private-image');
    expect(validateTrace(trace)).toBe(trace);
  });
});
