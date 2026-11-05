/**
 * S1: dependency floor for body-parser (pulled in by express.json()).
 *
 * body-parser < 1.20.9 is affected by:
 *   - GHSA-27r3-jxmh-p828: trailing bytes after a compressed body crash the
 *     process (fixed in 1.20.9)
 *   - GHSA-v422-hmwv-36x6: invalid `limit` silently disables size checks
 *     (fixed in 1.20.6)
 * Express 4 needs the 1.x line, so the floor is >=1.20.9 <2.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PATCHED_FLOOR = [1, 20, 9];

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || ''));
  assert.ok(match, `unparseable version: ${version}`);
  return match.slice(1).map(Number);
}

function isAtLeast(version, floor) {
  const parts = parseVersion(version);
  for (let i = 0; i < 3; i += 1) {
    if (parts[i] !== floor[i]) return parts[i] > floor[i];
  }
  return true;
}

test('every body-parser in package-lock.json is patched 1.x (>=1.20.9 <2)', () => {
  const lock = require('../package-lock.json');
  const entries = Object.entries(lock.packages || {})
    .filter(([key]) => key === 'node_modules/body-parser' || key.endsWith('/node_modules/body-parser'));
  assert.ok(entries.length > 0, 'body-parser should be present in the lockfile');
  for (const [key, entry] of entries) {
    assert.ok(isAtLeast(entry.version, PATCHED_FLOOR), `${key} is ${entry.version}, needs >=1.20.9`);
    assert.equal(parseVersion(entry.version)[0], 1, `${key} must stay on the 1.x line for express 4`);
  }
});

test('the body-parser express actually loads is patched', () => {
  const expressDir = path.dirname(require.resolve('express/package.json'));
  const pkgPath = require.resolve('body-parser/package.json', { paths: [expressDir] });
  const { version } = require(pkgPath);
  assert.ok(isAtLeast(version, PATCHED_FLOOR), `installed body-parser ${version} needs >=1.20.9`);
});

test('lockfile has no version-less package entries (keeps `npm ci` working)', () => {
  const lock = require('../package-lock.json');
  const broken = Object.entries(lock.packages || {})
    .filter(([key, entry]) => key && !entry.link && !entry.version)
    .map(([key]) => key);
  assert.deepEqual(broken, []);
});
