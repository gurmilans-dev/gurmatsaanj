import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import useShabadMatching from '../src/hooks/useShabadMatching';
import { api } from '../src/services/api';
import { deferred, flushPromises, renderHook } from './helpers/renderHook';

vi.mock('../src/services/api', () => ({ api: { suggestShabads: vi.fn() } }));

describe('live Shabad query freshness (V1)', () => {
  let hook;

  beforeEach(() => {
    vi.useFakeTimers();
    api.suggestShabads.mockResolvedValue({ suggestions: [] });
  });

  afterEach(() => {
    hook?.unmount();
    vi.useRealTimers();
  });

  function mount(transcript, filters = {}) {
    hook = renderHook(
      (props) => useShabadMatching(props.transcript, props.filters, { active: props.active }),
      { transcript, filters, active: true },
    );
    return hook;
  }

  async function tick() {
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
  }

  it('searches changed content even when its character count is unchanged', async () => {
    mount('alpha bravo');
    await flushPromises();
    hook.rerender({ transcript: 'delta gamma' });
    await tick();

    expect(api.suggestShabads).toHaveBeenCalledTimes(2);
    expect(api.suggestShabads).toHaveBeenLastCalledWith('delta gamma', {});
  });

  it('keeps refreshing after the rolling query fills its 180-character window', async () => {
    const transcripts = ['alpha bravo ', 'delta gamma ', 'theta kappa '].map((s) => s.repeat(30));
    mount(transcripts[0]);
    await flushPromises();
    for (const transcript of transcripts.slice(1)) {
      hook.rerender({ transcript });
      await tick();
    }

    expect(api.suggestShabads.mock.calls.map(([text]) => text)).toEqual(transcripts.map((s) => s.trim()));
  });

  it('refreshes equal-length filter changes', async () => {
    mount('alpha bravo', { source: 'G' });
    await flushPromises();
    hook.rerender({ filters: { source: 'D' } });
    await tick();

    expect(api.suggestShabads).toHaveBeenLastCalledWith('alpha bravo', { source: 'D' });
    expect(api.suggestShabads).toHaveBeenCalledTimes(2);
  });

  it('does not repeat identical queries or search fewer than two words', async () => {
    mount('alpha');
    await tick();
    expect(api.suggestShabads).not.toHaveBeenCalled();
    hook.rerender({ transcript: 'alpha bravo' });
    await tick();
    await tick();
    expect(api.suggestShabads).toHaveBeenCalledTimes(1);
  });

  it('retains the one-request limit and uses the latest text when the request completes', async () => {
    const pending = deferred();
    api.suggestShabads.mockReturnValueOnce(pending.promise);
    mount('alpha bravo');
    hook.rerender({ transcript: 'delta gamma' });
    await tick();
    expect(api.suggestShabads).toHaveBeenCalledTimes(1);

    pending.resolve({ suggestions: [] });
    await flushPromises();
    await tick();
    expect(api.suggestShabads).toHaveBeenCalledTimes(2);
    expect(api.suggestShabads).toHaveBeenLastCalledWith('delta gamma', {});
  });
});
