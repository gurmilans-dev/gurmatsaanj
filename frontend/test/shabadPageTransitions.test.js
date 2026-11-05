import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShabadPage from '../src/pages/ShabadPage/ShabadPage';
import ShabadView from '../src/features/shabadView/ShabadView';
import { api } from '../src/services/api';
import { matchLine } from '../src/utils/matchLine';
import { deferred, flushPromises } from './helpers/renderHook';

const state = vi.hoisted(() => ({ voice: null, app: null, mode: '', navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => state.navigate,
  useParams: () => ({ id: 'current' }),
  useSearchParams: () => [new URLSearchParams(state.mode)],
}));
vi.mock('../src/context/AppContext', () => ({ useApp: () => state.app }));
vi.mock('../src/hooks/useVoiceRecognition', () => ({ default: () => state.voice }));
vi.mock('../src/hooks/useWakeLock', () => ({ default: () => {} }));
vi.mock('../src/hooks/useAnandSahibWatch', () => ({ default: () => {} }));
vi.mock('../src/hooks/useKathaLineTracking', () => ({ default: () => ({ lineIndex: -1, tracked: false, confidence: 0 }) }));
vi.mock('../src/utils/matchLine', () => ({ matchLine: vi.fn() }));
vi.mock('../src/services/api', () => ({ api: { getShabad: vi.fn(), suggestShabads: vi.fn(), trackLine: vi.fn() } }));
vi.mock('../src/features/shabadView/ShabadView', () => ({ default: () => null, renderGurmukhiLine: (text) => text }));
vi.mock('../src/features/hukam/ShabadProse', () => ({ default: () => null }));
vi.mock('../src/features/hukam/ShabadViewToggle', () => ({ default: () => null }));
vi.mock('../src/features/projector/ProjectorControls', () => ({ default: () => null }));
vi.mock('../src/features/projector/ProjectorMiniPreview', () => ({ default: () => null }));
vi.mock('../src/features/voiceRecognition/VoiceDebugPanel', () => ({ default: () => null }));
vi.mock('../src/components/common/Loader/Loader', () => ({ default: () => null }));
vi.mock('../src/components/common/ConfidenceBadge/ConfidenceBadge', () => ({ default: () => null }));

const PHRASES = [
  'ਗੋਬਿੰਦ ਗੋਬਿੰਦ ਗੋਬਿੰਦ ਸੰਗਿ ਨਾਮਦੇਉ',
  'ਗੋਬਿੰਦ ਗੋਬਿੰਦ ਸੰਗਿ ਨਾਮਦੇਉ ਮਨੁ',
  'ਗੋਬਿੰਦ ਸੰਗਿ ਨਾਮਦੇਉ ਮਨੁ ਲੀਣਾ',
];

describe('Shabad page hold and navigation integration', () => {
  let renderer;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    state.mode = '';
    state.voice = { transcript: '', isListening: true, isSupported: true, reset: vi.fn(), stop: vi.fn(), setWordLimit: vi.fn() };
    state.app = {
      voice: { stop: vi.fn(), reset: vi.fn(), setWordLimit: vi.fn() },
      display: {}, projectorDisplay: {}, shabadQueue: [], lang: 'en', tLang: (english) => english,
      setSelectedShabad: vi.fn(), setActiveLine: vi.fn(), pushToast: vi.fn(), pushShabadHistory: vi.fn(),
    };
    api.getShabad.mockResolvedValue({ meta: { shabadId: 'current' }, verses: [
      { gurmukhi: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ' }, { gurmukhi: 'ਆਪਣਾ ਮੂਲੁ ਪਛਾਣੁ' },
    ] });
    api.suggestShabads.mockResolvedValue({ suggestions: [{ shabadId: 'next', confidence: 90 }] });
    matchLine.mockReturnValue({ lineIndex: -1, confidence: 0, tracked: false });
  });

  afterEach(() => {
    if (renderer) act(() => { renderer.unmount(); });
    renderer = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function mount() {
    await act(async () => { renderer = create(createElement(ShabadPage)); });
  }

  async function observe(transcript, elapsed = 1500) {
    await act(async () => { await vi.advanceTimersByTimeAsync(elapsed); });
    state.voice = { ...state.voice, transcript };
    act(() => { renderer.update(createElement(ShabadPage)); });
    await flushPromises();
  }

  it('recovers from auto-hold through background discovery and confirmed navigation', async () => {
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(JSON.stringify(renderer.toJSON())).toContain('Paused - waiting for kirtan');
    matchLine.mockReturnValue({ lineIndex: 1, confidence: 45, tracked: true });
    await observe(PHRASES[0]);
    await observe(PHRASES[1]);
    expect(api.suggestShabads).toHaveBeenCalledOnce();
    expect(state.navigate).not.toHaveBeenCalled();
    await observe(PHRASES[2]);
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/shabad/next');
  });

  it('keeps the projected Pangti stable while held even if a moderate local guess moves', async () => {
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    const initialIndex = renderer.root.findByType(ShabadView).props.activeIndex;
    matchLine.mockReturnValue({ lineIndex: 1, confidence: 45, tracked: true });
    await observe('uncertain recent transcript with words');
    expect(renderer.root.findByType(ShabadView).props.activeIndex).toBe(initialIndex);
    expect(state.app.setActiveLine.mock.lastCall[0]).toMatchObject({ index: initialIndex, tracked: false });
  });

  it('honors a manual Pangti correction while a discovery request is pending', async () => {
    const pending = deferred();
    api.suggestShabads.mockResolvedValueOnce({ suggestions: [{ shabadId: 'next', confidence: 90 }] }).mockReturnValueOnce(pending.promise);
    await mount();
    await observe(PHRASES[0], 500);
    await observe(PHRASES[1], 500);
    await observe(PHRASES[2]);
    expect(api.suggestShabads).toHaveBeenCalledTimes(2);
    act(() => { renderer.root.findByType(ShabadView).props.onLineClick(1); });
    pending.resolve({ suggestions: [{ shabadId: 'next', confidence: 90 }] });
    await flushPromises();
    expect(renderer.root.findByType(ShabadView).props.activeIndex).toBe(1);
    expect(state.app.setActiveLine.mock.lastCall[0]).toMatchObject({ index: 1, tracked: false });
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('does not switch during explanation prose with weak evidence or one isolated quotation', async () => {
    api.suggestShabads.mockResolvedValue({ suggestions: [] });
    await mount();
    await observe('today we discuss the meaning of this verse');
    await observe('the explanation describes how we should remember');
    api.suggestShabads.mockResolvedValueOnce({ suggestions: [{ shabadId: 'quoted', confidence: 90 }] });
    await observe(PHRASES[0]);
    await observe('now let us return to explaining its meaning');
    expect(api.suggestShabads).toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(renderer.root.findByType(ShabadView).props.activeIndex).toBe(0);
  });

  it('keeps Katha mode outside Kirtan discovery', async () => {
    state.mode = 'katha=1';
    await mount();
    for (const phrase of PHRASES) await observe(phrase);
    expect(api.suggestShabads).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
