import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import useAutoShabadAdvance from '../src/hooks/useAutoShabadAdvance';
import { api } from '../src/services/api';
import { deferred, flushPromises, renderHook } from './helpers/renderHook';

vi.mock('../src/services/api', () => ({
  api: { suggestShabads: vi.fn(), getShabad: vi.fn(), trackLine: vi.fn() },
}));

const VERSES = [
  { gurmukhi: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ ਆਪਣਾ ਮੂਲੁ ਪਛਾਣੁ' },
  { gurmukhi: 'ਹਰਿ ਜਨ ਬੋਲਤ ਸ੍ਰੀ ਰਾਮ ਨਾਮਾ ॥ ਰਹਾਉ ॥', isRahao: true },
];
const WORDS = [
  'ਗੋਬਿੰਦ ਗੋਬਿੰਦ ਗੋਬਿੰਦ ਸੰਗਿ ਨਾਮਦੇਉ',
  'ਗੋਬਿੰਦ ਗੋਬਿੰਦ ਸੰਗਿ ਨਾਮਦੇਉ ਮਨੁ',
  'ਗੋਬਿੰਦ ਸੰਗਿ ਨਾਮਦੇਉ ਮਨੁ ਲੀਣਾ',
  'ਸੰਗਿ ਨਾਮਦੇਉ ਮਨੁ ਲੀਣਾ ਸੋ',
  'ਨਾਮਦੇਉ ਮਨੁ ਲੀਣਾ ਸੋ ਪਰਮਾਤਮਾ',
  'ਮਨੁ ਲੀਣਾ ਸੋ ਪਰਮਾਤਮਾ ਹੋਇਓ',
];
const NEXT = { shabadId: 'next', confidence: 90 };

describe('conservative Shabad transition policy (V2/V3)', () => {
  let hook;
  let onAdvance;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    onAdvance = vi.fn();
    api.suggestShabads.mockResolvedValue({ suggestions: [NEXT] });
    api.getShabad.mockImplementation(async (shabadId) => ({ meta: { shabadId }, verses: [{ gurmukhi: WORDS[0] }] }));
    api.trackLine.mockResolvedValue({ tracked: true, confidence: 90 });
  });

  afterEach(() => {
    hook?.unmount();
    vi.useRealTimers();
  });

  function mount(extra = {}) {
    hook = renderHook(useAutoShabadAdvance, {
      active: true, transcript: '', currentShabadId: 'current', shabadVerses: VERSES,
      queueEntries: [], onAdvance, ...extra,
    });
  }

  async function observe(transcript, elapsed = 1500) {
    await act(async () => { await vi.advanceTimersByTimeAsync(elapsed); });
    hook.rerender({ transcript });
    await flushPromises();
  }

  async function discover() {
    await observe(WORDS[0]);
    await observe(WORDS[1]);
  }

  it('discovers despite a moderate local line match, then confirms the new Shabad over time', async () => {
    mount({ currentLineTracked: true, currentLineConfidence: 45 });
    await discover();
    expect(api.suggestShabads).toHaveBeenCalledOnce();
    expect(onAdvance).not.toHaveBeenCalled();
    await observe(WORDS[2]);
    expect(onAdvance).toHaveBeenCalledExactlyOnceWith(NEXT);
  });

  it('does not navigate on a single candidate observation or timer ticks alone', async () => {
    mount();
    await discover();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    hook.rerender({ transcript: WORDS[1] });
    expect(onAdvance).not.toHaveBeenCalled();
    expect(api.suggestShabads).toHaveBeenCalledOnce();
  });

  it('does not treat rapid interim revisions as temporal confirmation', async () => {
    mount();
    await discover();
    await observe(WORDS[2], 100);
    expect(onAdvance).not.toHaveBeenCalled();
    await observe(WORDS[3], 1400);
    expect(onAdvance).toHaveBeenCalledOnce();
  });

  it.each([
    ['a weaker alternative', [{ shabadId: 'current', confidence: 69 }, { ...NEXT, confidence: 60 }]],
    ['a narrow lead over current', [{ ...NEXT, confidence: 75 }, { shabadId: 'current', confidence: 69 }]],
    ['two ambiguous alternatives', [NEXT, { shabadId: 'another', confidence: 86 }]],
    ['a weak alternative', [{ ...NEXT, confidence: 59 }]],
  ])('keeps the current Shabad for %s', async (_, suggestions) => {
    api.suggestShabads.mockResolvedValue({ suggestions });
    mount();
    for (const text of WORDS.slice(0, 4)) await observe(text);
    expect(api.suggestShabads).toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('accepts a consistently clear lead even when current scores below 70', async () => {
    api.suggestShabads.mockResolvedValue({ suggestions: [{ shabadId: 'current', confidence: 69 }, { ...NEXT, confidence: 80 }] });
    mount();
    await discover();
    await observe(WORDS[2]);
    expect(onAdvance).toHaveBeenCalledExactlyOnceWith({ ...NEXT, confidence: 80 });
  });

  it.each([
    ['Pangti', ['ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ', 'ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ ਆਪਣਾ', 'ਜੋਤਿ ਸਰੂਪੁ ਹੈ ਆਪਣਾ ਮੂਲੁ', 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ']],
    ['Rahao', ['ਹਰਿ ਜਨ ਬੋਲਤ ਸ੍ਰੀ ਰਾਮ', 'ਜਨ ਬੋਲਤ ਸ੍ਰੀ ਰਾਮ ਨਾਮਾ ॥ ਰਹਾਉ ॥', 'ਹਰਿ ਜਨ ਬੋਲਤ ਸ੍ਰੀ ਰਾਮ']],
  ])('preserves repeated %s within the current Shabad', async (_, phrases) => {
    mount();
    for (const text of phrases) await observe(text);
    expect(api.suggestShabads).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('does not accumulate transition evidence through silence or instrumental gaps', async () => {
    mount();
    await discover();
    await observe(WORDS[2], 10000);
    expect(onAdvance).not.toHaveBeenCalled();
    await observe(WORDS[3]);
    expect(onAdvance).not.toHaveBeenCalled();
    await observe(WORDS[4]);
    expect(onAdvance).toHaveBeenCalledOnce();
  });

  it.each(['current Pangti', 'weak result', 'different candidate'])(
    'discards candidate confirmation after an intervening %s', async (interruption) => {
      mount();
      await discover();
      if (interruption === 'current Pangti') {
        await observe('ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ');
        await observe(WORDS[2]);
      } else {
        api.suggestShabads.mockResolvedValueOnce({ suggestions: interruption === 'weak result' ? [] : [{ shabadId: 'different', confidence: 90 }] });
        await observe(WORDS[2]);
      }
      await observe(WORDS[3]);
      expect(onAdvance).not.toHaveBeenCalled();
      await observe(WORDS[4]);
      expect(onAdvance).toHaveBeenCalledExactlyOnceWith(NEXT);
    },
  );

  it('keeps queue priority but requires repeated unambiguous queue evidence', async () => {
    mount({ queueEntries: [{ shabadId: 'queued' }] });
    await discover();
    expect(onAdvance).not.toHaveBeenCalled();
    await observe(WORDS[2]);
    expect(onAdvance.mock.calls[0][0]).toMatchObject({ shabadId: 'queued', queued: true });
    expect(api.suggestShabads).not.toHaveBeenCalled();
  });

  it('does not use queue-order bonuses to resolve equally strong candidates', async () => {
    api.suggestShabads.mockResolvedValue({ suggestions: [] });
    mount({ queueEntries: [{ shabadId: 'queued' }, { shabadId: 'also-queued' }] });
    await discover();
    await observe(WORDS[2]);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('does not replace stronger current text with a weaker queued match', async () => {
    api.suggestShabads.mockResolvedValue({ suggestions: [{ shabadId: 'current', confidence: 100 }] });
    mount({ queueEntries: [{ shabadId: 'queued' }] });
    // The local matcher normalizes these Devanagari words into current text;
    // the initials-only discovery gate deliberately does not establish that.
    for (const text of ['मन तूं जोति सरूपु है', 'तूं जोति सरूपु है आपणा', 'जोति सरूपु है आपणा मूलु']) {
      await observe(text);
    }
    expect(api.trackLine).toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it.each(['global', 'queue'])('ignores a %s response that arrives after an audio gap', async (source) => {
    const pending = deferred();
    if (source === 'global') api.suggestShabads.mockResolvedValueOnce({ suggestions: [NEXT] }).mockReturnValueOnce(pending.promise);
    else api.trackLine.mockResolvedValueOnce({ tracked: true, confidence: 90 }).mockReturnValueOnce(pending.promise);
    mount({ queueEntries: source === 'queue' ? [{ shabadId: 'queued' }] : [] });
    await discover();
    await observe(WORDS[2]);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    pending.resolve(source === 'global' ? { suggestions: [NEXT] } : { tracked: true, confidence: 90 });
    await flushPromises();
    expect(onAdvance).not.toHaveBeenCalled();
    if (source === 'queue') expect(api.suggestShabads).not.toHaveBeenCalled();
  });

  it.each(['current Pangti', 'manual correction', 'manual lock'])(
    'cancels in-flight discovery on %s without blocking later recovery', async (reason) => {
      const pending = deferred();
      api.suggestShabads.mockResolvedValueOnce({ suggestions: [NEXT] }).mockReturnValueOnce(pending.promise);
      mount();
      await discover();
      await observe(WORDS[2]);
      if (reason === 'current Pangti') await observe('ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ', 100);
      else hook.rerender(reason === 'manual correction' ? { anchorVersion: 1 } : { navigationBlocked: true });
      pending.resolve({ suggestions: [NEXT] });
      await flushPromises();
      expect(onAdvance).not.toHaveBeenCalled();
      hook.rerender({ navigationBlocked: false });
      await observe(WORDS[0], 5500);
      await observe(WORDS[3]);
      expect(onAdvance).not.toHaveBeenCalled();
      await observe(WORDS[4]);
      expect(onAdvance).toHaveBeenCalledOnce();
    },
  );

  it('recovers from a stalled request while fresh recognition continues', async () => {
    const stalled = deferred();
    api.suggestShabads.mockReturnValueOnce(stalled.promise);
    mount();
    await discover();
    await observe(WORDS[2]);
    await observe(WORDS[3]);
    await observe(WORDS[4]);
    await observe(WORDS[5]);
    expect(api.suggestShabads).toHaveBeenCalledTimes(2);
    expect(onAdvance).not.toHaveBeenCalled();
    stalled.resolve({ suggestions: [{ shabadId: 'stale', confidence: 100 }] });
    await flushPromises();
    await observe(WORDS[0]);
    expect(onAdvance).toHaveBeenCalledExactlyOnceWith(NEXT);
  });

  it('blocks navigation and discards existing evidence throughout a manual lock', async () => {
    mount();
    await discover();
    hook.rerender({ navigationBlocked: true });
    for (const text of WORDS.slice(2)) await observe(text);
    expect(api.suggestShabads).toHaveBeenCalledOnce();
    expect(onAdvance).not.toHaveBeenCalled();
    hook.rerender({ navigationBlocked: false });
    await observe(WORDS[0]);
    expect(onAdvance).not.toHaveBeenCalled();
    await observe(WORDS[1]);
    expect(onAdvance).toHaveBeenCalledOnce();
  });
});
