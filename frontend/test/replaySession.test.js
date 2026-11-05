import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../tools/replay-session.mjs', import.meta.url));

function replay(name, ...options) {
  const fixture = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  const result = spawnSync(process.execPath, [script, fixture, ...options], {
    encoding: 'utf8', timeout: 10_000, windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  return result;
}

describe('session replay CLI exit status (V13)', () => {
  it('succeeds on exact matcher parity', () => {
    const result = replay('replay-exact.json', '--verbose');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('EXACT');
    expect(result.stdout).toContain('events:        1');
  });

  it.each([{ options: [] }, { options: ['--verbose'] }])('fails on a mismatch while retaining its report ($options)', ({ options }) => {
    const result = replay('replay-mismatch.json', ...options);
    expect(result.stdout).toContain('1 mismatch(es)');
    expect(result.stdout).toContain('Session replay');
    expect(result.status).toBe(1);
  });

  it('continues to fail when a trace cannot be read', () => {
    const result = replay('missing-trace.json');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Could not read trace');
  });
});
