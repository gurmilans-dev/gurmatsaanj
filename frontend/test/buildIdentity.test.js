import { describe, expect, it } from 'vitest';
import { buildInfo } from '../vite.config.js';

const git = (status) => (_, args) => (args[0] === 'rev-parse' ? 'a1b2c3\n' : status);

describe('capture build identity', () => {
  it('ignores the bundled config file Vite writes while loading this config', () => {
    expect(buildInfo(git('?? frontend/vite.config.js.timestamp-1793976009433-2a113afd7023.mjs\n')))
      .toEqual({ revision: 'a1b2c3', dirty: false });
    expect(buildInfo(git(''))).toEqual({ revision: 'a1b2c3', dirty: false });
  });
  it('still reports modified and untracked source files', () => {
    expect(buildInfo(git(' M frontend/src/hooks/useVoiceRecognition.js\n')).dirty).toBe(true);
    expect(buildInfo(git('?? frontend/vite.config.js.timestamp-1-a.mjs\n?? frontend/src/New.jsx\n')).dirty).toBe(true);
    expect(buildInfo(git('?? frontend/src/vite.config.js.timestamp.notes\n')).dirty).toBe(true);
  });
  it('reports unknown identity without git', () => {
    expect(buildInfo(() => { throw new Error('git unavailable'); })).toEqual({ revision: null, dirty: null });
  });
});
