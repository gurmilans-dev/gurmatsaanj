import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import useVoiceRecognition from '../src/hooks/useVoiceRecognition';
import useLineTracking from '../src/hooks/useLineTracking';
import useFollowHold from '../src/hooks/useFollowHold';
import useTraceOutput from '../src/hooks/useTraceOutput';
import useAutoShabadAdvance from '../src/hooks/useAutoShabadAdvance';
import useKathaLineTracking from '../src/hooks/useKathaLineTracking';
import { getTrace, startRecording, stopRecording } from '../src/utils/sessionRecorder';
import { validateTrace } from '../src/utils/recognitionTrace';
import { matchLine } from '../src/utils/matchLine';
import { api } from '../src/services/api';
import { replayTimeline } from '../../tools/lib/recognition-evaluation.mjs';
import { deferred, flushPromises, renderHook } from './helpers/renderHook';

vi.mock('../src/utils/matchLine', () => ({ matchLine: vi.fn() }));
vi.mock('../src/services/api', () => ({ api: { suggestShabads: vi.fn(), getShabad: vi.fn(), trackLine: vi.fn() } }));

describe('recognition instrumentation and deterministic hook state', () => {
  let hook;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')); });
  afterEach(() => { hook?.unmount(); hook = null; stopRecording(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('records incremental final/interim revisions, errors, restarts, resets, and stops without audio', () => {
    let recognizer;
    class FixtureRecognition {
      constructor() { recognizer = this; }
      start = vi.fn();
      stop = vi.fn();
    }
    vi.stubGlobal('window', { SpeechRecognition: FixtureRecognition });
    hook = renderHook(useVoiceRecognition, { wordLimit: 0, source: 'synthetic-viewer' });
    startRecording({ synthetic: true });
    act(() => { hook.result.start(); });
    const observe = (text, final) => act(() => {
      const result = [{ transcript: text }]; result.isFinal = final;
      recognizer.onresult({ resultIndex: 0, results: [result] });
    });
    observe('ਮਨ', false); observe('ਮਨ ਤੂੰ', false); observe('ਮਨ ਤੂੰ', true);
    expect(hook.result.transcript).toBe('ਮਨ ਤੂੰ');
    const reconstructed = replayTimeline(getTrace()).state.streams;
    expect(Object.values(reconstructed)[0]).toMatchObject({ final: 'ਮਨ ਤੂੰ', interim: '' });
    act(() => { recognizer.onerror({ error: 'network' }); recognizer.onend(); });
    expect(recognizer.start).toHaveBeenCalledTimes(2);
    act(() => { hook.result.reset(); hook.result.stop(); });
    const trace = getTrace();
    const observations = trace.events.filter((e) => e.type === 'recognition' && e.data.action === 'result');
    expect(observations.map((e) => [e.data.append, e.data.interim, e.data.final])).toEqual([['', 'ਮਨ', false], ['', 'ਮਨ ਤੂੰ', false], ['ਮਨ ਤੂੰ', '', true]]);
    expect(trace.events.filter((e) => e.type === 'recognition').map((e) => e.data.action)).toEqual(expect.arrayContaining(['baseline', 'start', 'error', 'restart', 'reset', 'stop']));
    expect(validateTrace(trace)).toBe(trace);
  });

  it('uses the opt-in captured track for starts/restarts and keeps ordinary mic starts unchanged', () => {
    let recognizer;
    class Recognition { constructor() { recognizer = this; } start = vi.fn(); stop = vi.fn(); }
    vi.stubGlobal('window', { SpeechRecognition: Recognition });
    hook = renderHook(useVoiceRecognition, { wordLimit: 0, source: 'viewer' });
    startRecording({ synthetic: true }); const track = { kind: 'audio', readyState: 'live' };
    act(() => hook.result.start(track)); expect(recognizer.start).toHaveBeenLastCalledWith(track);
    act(() => recognizer.onend()); expect(recognizer.start).toHaveBeenLastCalledWith(track);
    expect(getTrace().events.find((e) => e.type === 'recognition' && e.data.action === 'start').data.source).toBe('viewer/capture-track');
    act(() => { hook.result.stop(); hook.result.start(); }); expect(recognizer.start).toHaveBeenLastCalledWith();
  });

  it('never falls back to a live microphone when an opted-in track ends', () => {
    let recognizer;
    class Recognition { constructor() { recognizer = this; } start = vi.fn(); stop = vi.fn(); }
    vi.stubGlobal('window', { SpeechRecognition: Recognition });
    hook = renderHook(useVoiceRecognition, { wordLimit: 0 }); const track = { kind: 'audio', readyState: 'live' };
    act(() => hook.result.start(track)); track.readyState = 'ended'; act(() => recognizer.onend());
    expect(recognizer.start).toHaveBeenCalledOnce(); expect(hook.result.isListening).toBe(false);
    act(() => hook.result.start(track)); expect(recognizer.start).toHaveBeenCalledOnce(); expect(hook.result.error).toBe('test-audio-track-ended');
  });

  it('replays fresh observations through actual tracker state, separating proposals, commits, and page output', async () => {
    const verses = ['ਕ ਖ ਗ ਘ ਚ', 'ਰਾਮ ਨਾਮੁ ਜਪਹੁ ਜੀਅ ਸਦਾ', 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ'].map((gurmukhi, i) => ({ gurmukhi, verseId: String(i) }));
    const run = async (enabled) => {
      startRecording({ synthetic: true }); if (!enabled) stopRecording();
      matchLine.mockReturnValue({ lineIndex: 0, confidence: 90, tracked: true });
      hook = renderHook((props) => {
        const tracking = useLineTracking(props);
        const follow = useFollowHold({ active: true, ...tracking });
        useTraceOutput({ groupId: props.shabadId, verses, lineIndex: tracking.lineIndex, mode: 'kirtan', ready: true, held: follow.held, tracked: tracking.tracked });
        return tracking;
      }, { shabadId: 'fixture', verses, transcript: 'first controlled observation', active: true });
      const committed = [hook.result.lineIndex];
      matchLine.mockReturnValue({ lineIndex: 2, confidence: 90, tracked: true });
      for (const transcript of ['second controlled observation', 'third controlled observation']) {
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        hook.rerender({ transcript }); committed.push(hook.result.lineIndex);
      }
      const trace = getTrace(); hook.unmount(); hook = null;
      return { committed, trace };
    };
    const disabled = await run(false);
    const enabled = await run(true);
    expect(disabled.committed).toEqual([0, 0, 2]);
    expect(enabled.committed).toEqual(disabled.committed);
    expect(enabled.trace.events.filter((e) => e.type === 'matcher').map((e) => e.data.lineIndex)).toEqual([0, 2, 2]);
    expect(enabled.trace.events.filter((e) => e.type === 'tracker' && e.data.accepted).map((e) => e.data.position.lineIndex)).toEqual([null, 0, 2]);
    expect(replayTimeline(enabled.trace).state.page.lineIndex).toBe(2);
    expect(validateTrace(enabled.trace)).toBe(enabled.trace);
  });

  it('records invalidated asynchronous confirmation without allowing navigation', async () => {
    const pending = deferred();
    api.suggestShabads.mockResolvedValueOnce({ suggestions: [{ shabadId: 'next', confidence: 90 }] }).mockReturnValueOnce(pending.promise);
    const onAdvance = vi.fn();
    startRecording({ synthetic: true });
    hook = renderHook(useAutoShabadAdvance, { active: true, currentShabadId: 'current', shabadVerses: [{ gurmukhi: 'ਕ ਖ ਗ ਘ ਚ' }], queueEntries: [], transcript: 'alpha bravo charlie delta echo', onAdvance });
    hook.rerender({ transcript: 'bravo charlie delta echo foxtrot' }); await flushPromises();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    hook.rerender({ transcript: 'charlie delta echo foxtrot golf' }); await flushPromises();
    hook.rerender({ navigationBlocked: true });
    pending.resolve({ suggestions: [{ shabadId: 'next', confidence: 90 }] }); await flushPromises();
    expect(onAdvance).not.toHaveBeenCalled();
    const trace = getTrace();
    expect(trace.events.some((e) => e.type === 'discovery' && e.data.action === 'pending')).toBe(true);
    expect(trace.events.some((e) => e.type === 'discovery' && e.data.reason === 'context-invalidated')).toBe(true);
    expect(replayTimeline(trace).state.pending).toBeNull();
    expect(validateTrace(trace)).toBe(trace);
  });

  it('captures real Katha proposal and internal commitment separately from navigation', async () => {
    const verses = [{ gurmukhi: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ ਆਪਣਾ ਮੂਲੁ ਪਛਾਣੁ', verseId: '101' }, { gurmukhi: 'ਸਤਿਗੁਰ ਕੀ ਬਾਣੀ ਸਤਿ ਸਰੂਪੁ ਹੈ', verseId: '102' }];
    startRecording({ synthetic: true });
    hook = renderHook(useKathaLineTracking, { active: true, transcript: verses[1].gurmukhi, groups: [{ id: 'fixture', type: 'shabad', verses }], currentGroupId: 'fixture', currentLineIndex: 0, onNavigate: vi.fn() });
    await flushPromises();
    const trace = getTrace();
    expect(trace.events.find((e) => e.type === 'matcher' && e.data.engine === 'katha').data).toMatchObject({ tracked: true, position: { verseId: '102' } });
    expect(trace.events.some((e) => e.type === 'tracker' && e.data.accepted)).toBe(true);
    expect(validateTrace(trace)).toBe(trace);
  });

  it('records explicit empty page state while loading instead of silently carrying old selection', () => {
    startRecording({ synthetic: true });
    hook = renderHook(useTraceOutput, { groupId: 'fixture', verses: [{ gurmukhi: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ' }], lineIndex: 0, mode: 'kirtan', ready: true });
    hook.rerender({ ready: false });
    expect(getTrace().events.filter((e) => e.type === 'page').at(-1).data).toMatchObject({ position: null, mode: 'empty' });
    hook.rerender({ ready: true });
    expect(getTrace().events.filter((e) => e.type === 'page').at(-1).data.position.lineIndex).toBe(0);
  });
});
