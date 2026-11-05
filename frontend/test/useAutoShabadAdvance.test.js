import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import useAutoShabadAdvance from '../src/hooks/useAutoShabadAdvance';
import { api } from '../src/services/api';
import { deferred, flushPromises, renderHook } from './helpers/renderHook';

vi.mock('../src/services/api', () => ({
  api: { suggestShabads: vi.fn(), getShabad: vi.fn(), trackLine: vi.fn() },
}));

const FIRST_MISS = 'alpha bravo charlie delta echo';
const SECOND_MISS = 'bravo charlie delta echo foxtrot';
const THIRD_MISS = 'charlie delta echo foxtrot golf';
const FOURTH_MISS = 'delta echo foxtrot golf hotel';
const NEXT = { shabadId: 'next', confidence: 90 };
const QUEUED = {
  meta: { shabadId: 'queued' },
  verses: [{ gurmukhi: 'ਰਾਮ ਨਾਮੁ ਜਪਹੁ ਜੀਅ ਸਦਾ' }],
};

describe('asynchronous Shabad navigation lifetime (V5)', () => {
  let hook;
  let onAdvance;

  beforeEach(() => {
    vi.useFakeTimers();
    onAdvance = vi.fn();
    api.suggestShabads.mockResolvedValue({ suggestions: [NEXT] });
    api.getShabad.mockResolvedValue(QUEUED);
    api.trackLine.mockResolvedValue({ tracked: true, confidence: 90 });
  });

  afterEach(() => {
    hook?.unmount();
    vi.useRealTimers();
  });

  async function mount(queueEntries = []) {
    hook = renderHook(useAutoShabadAdvance, {
      active: true,
      transcript: FIRST_MISS,
      currentShabadId: 'current',
      shabadVerses: [{ gurmukhi: 'ਕ ਖ ਗ ਘ ਚ' }],
      queueEntries,
      onAdvance,
    });
    await flushPromises();
    hook.rerender({ transcript: SECOND_MISS });
    await flushPromises();
  }

  async function confirm(transcript = THIRD_MISS) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    hook.rerender({ transcript });
    await flushPromises();
  }

  function invalidate(reason) {
    if (reason === 'unmounted') {
      hook.unmount();
      hook = null;
    } else if (reason === 'inactive') {
      hook.rerender({ active: false });
    } else {
      hook.rerender({ currentShabadId: 'manually-selected' });
    }
  }

  it.each(['inactive', 'changed Shabad', 'unmounted'])(
    'ignores a global result after the reader becomes %s',
    async (reason) => {
      const pending = deferred();
      api.suggestShabads.mockResolvedValueOnce({ suggestions: [NEXT] }).mockReturnValueOnce(pending.promise);
      await mount();
      await confirm();
      expect(api.suggestShabads).toHaveBeenCalledTimes(2);
      invalidate(reason);
      pending.resolve({ suggestions: [NEXT] });
      await flushPromises();
      expect(onAdvance).not.toHaveBeenCalled();
    },
  );

  it.each(['inactive', 'changed Shabad', 'unmounted'])(
    'ignores a queued result after the reader becomes %s',
    async (reason) => {
      const pending = deferred();
      api.trackLine.mockResolvedValueOnce({ tracked: true, confidence: 90 }).mockReturnValueOnce(pending.promise);
      await mount([{ shabadId: 'queued' }]);
      await confirm();
      expect(api.trackLine).toHaveBeenCalledTimes(2);
      invalidate(reason);
      pending.resolve({ tracked: true, confidence: 90 });
      await flushPromises();
      expect(onAdvance).not.toHaveBeenCalled();
      expect(api.suggestShabads).not.toHaveBeenCalled();
    },
  );

  it('does not start global fallback when an invalidated queue request fails', async () => {
    const pending = deferred();
    api.trackLine.mockResolvedValueOnce({ tracked: true, confidence: 90 }).mockReturnValueOnce(pending.promise);
    await mount([{ shabadId: 'queued' }]);
    await confirm();
    invalidate('inactive');
    pending.reject(new Error('fixture timeout'));
    await flushPromises();
    expect(api.suggestShabads).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('still advances on a valid global result as the transcript continues changing', async () => {
    const pending = deferred();
    api.suggestShabads.mockResolvedValueOnce({ suggestions: [NEXT] }).mockReturnValueOnce(pending.promise);
    await mount();
    await confirm();
    hook.rerender({ transcript: FOURTH_MISS });
    pending.resolve({ suggestions: [NEXT] });
    await flushPromises();
    expect(onAdvance).toHaveBeenCalledExactlyOnceWith(NEXT);
  });

  it('preserves queue-first navigation for a valid request', async () => {
    await mount([{ shabadId: 'queued' }]);
    expect(onAdvance).not.toHaveBeenCalled();
    await confirm();
    expect(onAdvance).toHaveBeenCalledOnce();
    expect(onAdvance.mock.calls[0][0]).toMatchObject({ shabadId: 'queued', queued: true });
    expect(api.suggestShabads).not.toHaveBeenCalled();
  });

  it('does not let old completion release a newer request or consume its cooldown', async () => {
    const old = deferred();
    const current = deferred();
    const fresh = { shabadId: 'fresh', confidence: 90 };
    api.suggestShabads
      .mockResolvedValueOnce({ suggestions: [NEXT] }).mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ suggestions: [fresh] }).mockReturnValueOnce(current.promise);
    await mount();
    await confirm();
    hook.rerender({ currentShabadId: 'manually-selected', transcript: FIRST_MISS });
    hook.rerender({ transcript: SECOND_MISS });
    await flushPromises();
    await confirm();
    expect(api.suggestShabads).toHaveBeenCalledTimes(4);

    old.resolve({ suggestions: [NEXT] });
    await flushPromises();
    expect(onAdvance).not.toHaveBeenCalled();
    hook.rerender({ transcript: FOURTH_MISS });
    await flushPromises();
    expect(api.suggestShabads).toHaveBeenCalledTimes(4);

    current.resolve({ suggestions: [fresh] });
    await flushPromises();
    expect(onAdvance).toHaveBeenCalledExactlyOnceWith({ shabadId: 'fresh', confidence: 90 });
  });

  it('preserves the existing five-second cooldown after a valid advance', async () => {
    await mount();
    await confirm();
    expect(onAdvance).toHaveBeenCalledOnce();
    api.suggestShabads.mockResolvedValue({ suggestions: [{ shabadId: 'later', confidence: 90 }] });
    hook.rerender({ currentShabadId: 'next', transcript: FIRST_MISS });
    hook.rerender({ transcript: SECOND_MISS });
    expect(api.suggestShabads).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    hook.rerender({ transcript: THIRD_MISS });
    hook.rerender({ transcript: 'delta echo foxtrot golf hotel' });
    await flushPromises();
    expect(api.suggestShabads).toHaveBeenCalledTimes(3);
    expect(onAdvance).toHaveBeenCalledOnce();
    await confirm('echo foxtrot golf hotel india');
    expect(onAdvance).toHaveBeenCalledTimes(2);
  });
});
