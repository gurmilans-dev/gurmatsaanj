import { createRequire } from 'node:module';
import Module from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const controllerPath = require.resolve('../../backend/src/controllers/voice.controller.js');
const matchingPath = require.resolve('../../backend/src/services/matching.service.js');
const banidbPath = require.resolve('../../backend/src/services/banidb.service.js');
const matching = { matchShabads: vi.fn(), matchLine: vi.fn() };
const banidb = { getShabad: vi.fn() };
const savedModules = new Map();
let controller;

beforeAll(() => {
  // The controller uses CommonJS require; replace only its external service
  // modules so these tests never load an HTTP client or require backend installs.
  for (const [id, exports] of [[matchingPath, matching], [banidbPath, banidb]]) {
    savedModules.set(id, require.cache[id]);
    const stub = new Module(id);
    stub.exports = exports;
    stub.loaded = true;
    require.cache[id] = stub;
  }
  savedModules.set(controllerPath, require.cache[controllerPath]);
  delete require.cache[controllerPath];
  controller = require(controllerPath);
});

afterAll(() => {
  for (const [id, previous] of savedModules) {
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  }
});

beforeEach(() => {
  matching.matchShabads.mockResolvedValue([]);
  matching.matchLine.mockReturnValue({ lineIndex: 0, confidence: 100, tracked: true });
});

describe.each(['suggestShabads', 'trackLine'])('%s transcript freshness (V1)', (method) => {
  async function invoke(transcript) {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await controller[method]({ body: { transcript, shabadId: 'fixture', verses: [{ gurmukhi: 'ਨਵੀਂ ਪੰਗਤੀ' }] } }, response, next);
    expect(next).not.toHaveBeenCalled();
    return response;
  }

  it('keeps the newest words when a transcript exceeds the 300-character limit', async () => {
    const recent = 'ਨਵੀਂ ਪੰਗਤੀ ਹੁਣ ਗਾਈ ਜਾ ਰਹੀ ਹੈ';
    await invoke(`BEGIN_OLD_CONTEXT ${'ਪੁਰਾਣੀ ਪੰਗਤੀ '.repeat(60)} ${recent}`);
    const passed = method === 'suggestShabads'
      ? matching.matchShabads.mock.calls[0][0]
      : matching.matchLine.mock.calls[0][1];
    expect(passed).toHaveLength(300);
    expect(passed.endsWith(recent)).toBe(true);
    expect(passed).not.toContain('BEGIN_OLD_CONTEXT');
    expect(banidb.getShabad).not.toHaveBeenCalled();
  });

  it('preserves a short transcript and rejects whitespace-only input', async () => {
    await invoke('  ਨਵੀਂ ਪੰਗਤੀ  ');
    const passed = method === 'suggestShabads'
      ? matching.matchShabads.mock.calls[0][0]
      : matching.matchLine.mock.calls[0][1];
    expect(passed).toBe('ਨਵੀਂ ਪੰਗਤੀ');
    const response = await invoke('   ');
    expect(response.status).toHaveBeenCalledWith(400);
  });
});
