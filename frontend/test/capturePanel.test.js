import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CapturePanel from '../src/features/voiceRecognition/CapturePanel';
import useVoiceRecognition from '../src/hooks/useVoiceRecognition';

// Controllable stand-in for the capture singleton; the voice hook is the real one.
const fake = vi.hoisted(() => {
  const listeners = new Set();
  const state = { status: { phase: 'idle', active: false, ready: false, reason: null, bytes: 0, durationMs: 0 }, options: null };
  const set = (patch) => { state.status = { ...state.status, ...patch }; for (const listener of listeners) listener(state.status); };
  const capture = {
    status: () => state.status,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    start: async (options) => { state.options = options; set({ phase: 'requesting', active: true, ready: false }); },
    stop: () => { set({ phase: 'ready', active: false, ready: true }); return Promise.resolve(state.status); },
    marker: () => null, bundle: async () => null,
    discard: () => set({ phase: 'idle', active: false, ready: false }),
  };
  return { state, set, capture, reset() { listeners.clear(); state.options = null; state.status = { phase: 'idle', active: false, ready: false, reason: null, bytes: 0, durationMs: 0 }; } };
});
vi.mock('../src/utils/synchronizedCapture', () => ({ synchronizedCapture: fake.capture, supportsCaptureTrack: () => true }));

let recognizer; let renderer; let voice;
const onBusyChange = () => {};
function Harness() {
  voice = useVoiceRecognition({ wordLimit: 0, source: 'viewer' });
  return createElement(CapturePanel, { mode: 'kirtan', voice, standaloneRecording: false, onBusyChange });
}
const button = (label) => renderer.root.findAllByType('button').find((b) => b.props.children === label);
async function startOnlineCapture() {
  const [consent, online] = renderer.root.findAllByType('input');
  act(() => consent.props.onChange({ target: { checked: true } }));
  act(() => online.props.onChange({ target: { checked: true } }));
  await act(async () => { await button('Record test session').props.onClick(); });
}
const grantPermission = (track) => act(() => { fake.set({ phase: 'recording' }); fake.state.options.onReady(track); });
const engineEnds = () => act(() => { recognizer.running = false; recognizer.onend(); });

describe('test capture never takes over or stops the operator microphone', () => {
  const track = { kind: 'audio', readyState: 'live' };
  beforeEach(() => {
    fake.reset();
    class Recognition {
      constructor() { recognizer = this; }
      // Native engines reject start() while a session is running.
      start = vi.fn(function start() { if (this.running) throw Object.assign(new Error('already started'), { name: 'InvalidStateError' }); this.running = true; });
      stop = vi.fn(function stop() { this.running = false; });
    }
    vi.stubGlobal('window', { SpeechRecognition: Recognition, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    act(() => { renderer = create(createElement(Harness)); });
  });
  afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals(); });

  it('ends recognition that still reads the capture track when the capture ends', async () => {
    await startOnlineCapture(); grantPermission(track);
    expect(recognizer.start).toHaveBeenLastCalledWith(track);
    engineEnds(); expect(recognizer.start).toHaveBeenLastCalledWith(track);
    act(() => { fake.capture.stop(); });
    expect(recognizer.stop).toHaveBeenCalledOnce(); expect(voice.isListening).toBe(false);
  });

  it('leaves an ordinary mic restarted during the capture running after the capture ends', async () => {
    await startOnlineCapture(); grantPermission(track);
    act(() => voice.stop()); act(() => voice.start());
    expect(recognizer.start).toHaveBeenLastCalledWith();
    const stops = recognizer.stop.mock.calls.length;
    act(() => { fake.capture.stop(); });
    expect(recognizer.stop).toHaveBeenCalledTimes(stops); expect(voice.isListening).toBe(true);
  });

  it('keeps an ordinary mic started during the permission prompt on the mic through restarts and capture end', async () => {
    await startOnlineCapture();
    act(() => voice.start()); grantPermission(track);
    expect(recognizer.start).toHaveBeenLastCalledWith(track); // rejected: already started
    expect(voice.isListening).toBe(true); expect(voice.isUsingTestTrack()).toBe(false);
    engineEnds(); expect(recognizer.start).toHaveBeenLastCalledWith();
    act(() => { fake.capture.stop(); });
    expect(recognizer.stop).not.toHaveBeenCalled(); expect(voice.isListening).toBe(true);
  });
});
