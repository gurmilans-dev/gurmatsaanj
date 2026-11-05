import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import useLineTracking from '../src/hooks/useLineTracking';
import useFollowHold from '../src/hooks/useFollowHold';
import { matchLine } from '../src/utils/matchLine';
import { renderHook } from './helpers/renderHook';

vi.mock('../src/utils/matchLine', () => ({ matchLine: vi.fn() }));

describe('line evidence freshness and display hold (V3)', () => {
  let hook;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    matchLine.mockReturnValue({ tracked: true, confidence: 80, lineIndex: 0 });
    hook = renderHook((props) => {
      const tracking = useLineTracking(props);
      const follow = useFollowHold({ active: props.active, ...tracking });
      return { tracking, follow };
    }, {
      active: true, shabadId: 'current', transcript: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ',
      verses: [{ gurmukhi: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ' }, { gurmukhi: 'ਆਪਣਾ ਮੂਲੁ ਪਛਾਣੁ' }],
    });
  });

  afterEach(() => {
    hook.unmount();
    vi.useRealTimers();
  });

  async function tick(ms) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }

  it('refreshes freshness for new observations with unchanged confidence and line', async () => {
    for (const text of ['ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ ਆਪਣਾ', 'ਜੋਤਿ ਸਰੂਪੁ ਹੈ ਆਪਣਾ ਮੂਲੁ', 'ਸਰੂਪੁ ਹੈ ਆਪਣਾ ਮੂਲੁ ਪਛਾਣੁ']) {
      await tick(1000);
      hook.rerender({ transcript: text });
    }
    expect(hook.result.follow.state).toBe('following');
  });

  it('recognizes a fresh repeated Pangti even when the five-word tail is unchanged', async () => {
    let transcript = 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ';
    for (let i = 0; i < 3; i += 1) {
      await tick(1000);
      transcript += ' ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ';
      hook.rerender({ transcript });
    }
    expect(hook.result.follow.state).toBe('following');
  });

  it('holds through silence, then resumes on a fresh match with the same score', async () => {
    await tick(2800);
    expect(hook.result.follow.state).toBe('held');
    hook.rerender({ transcript: 'ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ ਆਪਣਾ' });
    expect(hook.result.follow.state).toBe('following');
  });

  it('keeps the last accepted Pangti on weak observations and instrumental gaps', async () => {
    matchLine.mockReturnValue({ tracked: false, confidence: 30, lineIndex: 1 });
    await tick(1000);
    hook.rerender({ transcript: 'unrelated instrumental recognition noise words' });
    await tick(2000);
    expect(hook.result.tracking.lineIndex).toBe(0);
    expect(hook.result.follow.state).toBe('held');
  });

  it('keeps a manual lock through fresh confident observations', async () => {
    act(() => { hook.result.follow.setLocked(true); });
    await tick(1000);
    hook.rerender({ transcript: 'ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ ਆਪਣਾ' });
    expect(hook.result.follow.state).toBe('locked');
    act(() => { hook.result.follow.setLocked(false); });
    expect(hook.result.follow.state).toBe('following');
  });
});
