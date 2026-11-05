/**
 * Remote-control client authentication.
 *
 * S2: a paired viewer can see every device's clientId in the session roster
 *     and already knows the pair code, so clientId + code must not be enough
 *     to act as another device.
 * S3: /api/remote/leave must not let anyone disconnect another device.
 *
 * Also guards the legitimate flows: pairing, controller assignment and
 * handoff, kick/reset, and Sangat View.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, makeClient } = require('./helpers/server');

const TOKEN_HEADER = 'X-Remote-Client-Token';

let server;
let call;
let hostSeq = 0;

test.before(async () => {
  server = await startTestServer();
  call = makeClient(server.baseUrl);
});

test.after(() => server.close());

async function newHost() {
  hostSeq += 1;
  const hostId = `host-test-${hostSeq}`;
  const res = await call('POST', '/api/remote/state', {
    body: {
      remoteHostId: hostId,
      selectedTitle: 'Test Shabad',
      activeLineIndex: 0,
      activeLineTotal: 2,
      surroundingLines: [{ index: 0, gurmukhi: 'ਸਤਿ ਨਾਮੁ' }, { index: 1, gurmukhi: 'ਕਰਤਾ ਪੁਰਖੁ' }],
    },
  });
  assert.equal(res.status, 200);
  const { code, followCode, hostToken } = res.data.session;
  return { hostId, hostToken, code, followCode };
}

function join(host, clientId, extra = {}) {
  return call('POST', '/api/remote/join', { body: { code: host.code, clientId, name: clientId, ...extra } });
}

async function pairTwo() {
  const host = await newHost();
  const a = await join(host, `phone-a-${hostSeq}`);
  const b = await join(host, `phone-b-${hostSeq}`);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  return {
    host,
    a: { clientId: `phone-a-${hostSeq}`, token: a.data.clientToken, res: a },
    b: { clientId: `phone-b-${hostSeq}`, token: b.data.clientToken, res: b },
  };
}

function auth(host, device, extra = {}) {
  return { code: host.code, clientId: device.clientId, clientToken: device.token, ...extra };
}

async function hostView(host) {
  const res = await call('POST', '/api/remote/state', {
    body: { remoteHostId: host.hostId, hostToken: host.hostToken, selectedTitle: 'Test Shabad' },
  });
  assert.equal(res.status, 200);
  return res.data.session;
}

async function hostCommands(host) {
  const res = await call('GET', '/api/remote/commands', {
    query: { after: 0 },
    headers: { 'X-Remote-Host-Id': host.hostId, 'X-Remote-Host-Token': host.hostToken },
  });
  assert.equal(res.status, 200);
  return res.data.commands;
}

function controllerIdOf(session) {
  return session.clients.find((c) => c.isController)?.clientId || '';
}

// ── S2: impersonating the controller ──────────────────────────────────────

test('S2: viewer cannot send commands using the controller clientId', async () => {
  const { host, a, b } = await pairTwo();
  // Precondition of the attack: the viewer can see the controller's id.
  assert.ok(b.res.data.session.clients.some((c) => c.clientId === a.clientId && c.isController));

  const forgedWithOwnToken = await call('POST', '/api/remote/command', {
    body: { type: 'line-next', code: host.code, clientId: a.clientId, clientToken: b.token },
  });
  assert.equal(forgedWithOwnToken.status, 403);

  const forgedNoToken = await call('POST', '/api/remote/command', {
    body: { type: 'line-next', code: host.code, clientId: a.clientId },
  });
  assert.equal(forgedNoToken.status, 403);

  assert.deepEqual(await hostCommands(host), []);
});

test('S2: viewer cannot re-join with the controller clientId to take over its identity', async () => {
  const { host, a } = await pairTwo();
  const takeover = await join(host, a.clientId);
  assert.equal(takeover.status, 409);
  assert.equal(takeover.data.clientToken, undefined);

  const beat = await call('POST', '/api/remote/heartbeat', { body: auth(host, a) });
  assert.equal(beat.status, 200);
  assert.equal(beat.data.session.role, 'controller');
});

test('S2: viewer cannot heartbeat, release or read state as the controller', async () => {
  const { host, a, b } = await pairTwo();

  const beat = await call('POST', '/api/remote/heartbeat', {
    body: { code: host.code, clientId: a.clientId, clientToken: b.token },
  });
  assert.equal(beat.status, 403);

  const release = await call('POST', '/api/remote/release', {
    body: { code: host.code, clientId: a.clientId, clientToken: b.token },
  });
  assert.equal(release.status, 403);
  assert.equal(controllerIdOf(await hostView(host)), a.clientId);

  const state = await call('GET', '/api/remote/state', {
    query: { clientId: a.clientId, pairCode: host.code },
    headers: { [TOKEN_HEADER]: b.token },
  });
  assert.equal(state.status, 200);
  assert.notEqual(state.data.remoteSession?.role, 'controller');
  assert.equal(state.data.remoteSession?.paired, false);
});

test('S2: viewer cannot approve its own control request by posing as the controller', async () => {
  const { host, a, b } = await pairTwo();
  const request = await call('POST', '/api/remote/command', { body: auth(host, b, { type: 'line-next' }) });
  assert.equal(request.status, 423);

  const grant = await call('POST', '/api/remote/grant', {
    body: { code: host.code, clientId: a.clientId, clientToken: b.token, targetClientId: b.clientId },
  });
  assert.equal(grant.status, 403);
  assert.equal(controllerIdOf(await hostView(host)), a.clientId);
});

// ── S3: unauthenticated /leave ────────────────────────────────────────────

test('S3: /leave without the device credential cannot disconnect another device', async () => {
  const { host, a, b } = await pairTwo();

  const anonymous = await call('POST', '/api/remote/leave', { body: { clientId: a.clientId } });
  assert.equal(anonymous.status, 403);

  const byViewer = await call('POST', '/api/remote/leave', {
    body: { clientId: a.clientId, code: host.code, clientToken: b.token },
  });
  assert.equal(byViewer.status, 403);

  const beat = await call('POST', '/api/remote/heartbeat', { body: auth(host, a) });
  assert.equal(beat.status, 200);
  assert.equal(beat.data.session.role, 'controller');
});

test('S3: a device can leave with its own credential', async () => {
  const { host, a } = await pairTwo();
  const leave = await call('POST', '/api/remote/leave', { body: auth(host, a) });
  assert.equal(leave.status, 200);

  const view = await hostView(host);
  assert.ok(!view.clients.some((c) => c.clientId === a.clientId));
  assert.equal(view.locked, false);

  const beat = await call('POST', '/api/remote/heartbeat', { body: auth(host, a) });
  assert.equal(beat.status, 403);
});

// ── Legitimate flows ──────────────────────────────────────────────────────

test('pairing: first device controls, later devices view, each gets its own secret', async () => {
  const { host, a, b } = await pairTwo();
  assert.equal(a.res.data.session.role, 'controller');
  assert.equal(b.res.data.session.role, 'viewer');
  assert.equal(typeof a.token, 'string');
  assert.ok(a.token.length >= 32);
  assert.notEqual(a.token, b.token);

  // Secrets never appear in roster payloads seen by the host or other devices.
  const hostPayload = JSON.stringify(await hostView(host));
  const viewerPayload = JSON.stringify(b.res.data.session);
  for (const token of [a.token, b.token]) {
    assert.ok(!hostPayload.includes(token));
    assert.ok(!viewerPayload.includes(token));
  }
});

test('controller commands reach the host command queue', async () => {
  const { host, a } = await pairTwo();
  const sent = await call('POST', '/api/remote/command', { body: auth(host, a, { type: 'line-next' }) });
  assert.equal(sent.status, 200);
  const commands = await hostCommands(host);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'line-next');
});

test('re-joining with the same clientId and its token keeps the identity (reload / second tab)', async () => {
  const { host, a } = await pairTwo();
  const rejoin = await join(host, a.clientId, { clientToken: a.token });
  assert.equal(rejoin.status, 200);
  assert.equal(rejoin.data.clientToken, a.token);
  assert.equal(rejoin.data.session.role, 'controller');
});

test('GET /state reports the paired role when the client token header is sent', async () => {
  const { host, a, b } = await pairTwo();
  const asA = await call('GET', '/api/remote/state', {
    query: { clientId: a.clientId, pairCode: host.code },
    headers: { [TOKEN_HEADER]: a.token },
  });
  assert.equal(asA.data.remoteSession.role, 'controller');
  assert.equal(asA.data.selectedTitle, 'Test Shabad');

  // Without pairCode the server falls back to the device's own binding.
  const asB = await call('GET', '/api/remote/state', {
    query: { clientId: b.clientId },
    headers: { [TOKEN_HEADER]: b.token },
  });
  assert.equal(asB.data.remoteSession.role, 'viewer');
});

test('control handoff: request, host approval, controller approval, release and claim', async () => {
  const { host, a, b } = await pairTwo();

  assert.equal((await call('POST', '/api/remote/command', { body: auth(host, b, { type: 'line-next' }) })).status, 423);
  const hostGrant = await call('POST', '/api/remote/grant', {
    body: { hostId: host.hostId, hostToken: host.hostToken, targetClientId: b.clientId },
  });
  assert.equal(hostGrant.status, 200);
  assert.equal(controllerIdOf(await hostView(host)), b.clientId);

  assert.equal((await call('POST', '/api/remote/command', { body: auth(host, a, { type: 'line-next' }) })).status, 423);
  const controllerGrant = await call('POST', '/api/remote/grant', {
    body: auth(host, b, { targetClientId: a.clientId }),
  });
  assert.equal(controllerGrant.status, 200);
  assert.equal(controllerIdOf(await hostView(host)), a.clientId);

  assert.equal((await call('POST', '/api/remote/release', { body: auth(host, a) })).status, 200);
  const claim = await call('POST', '/api/remote/claim', { body: auth(host, b) });
  assert.equal(claim.status, 200);
  assert.equal(claim.data.session.role, 'controller');
});

test('kick and code reset invalidate device credentials', async () => {
  const { host, a, b } = await pairTwo();

  const kick = await call('POST', '/api/remote/kick', {
    body: { hostId: host.hostId, hostToken: host.hostToken, targetClientId: a.clientId },
  });
  assert.equal(kick.status, 200);
  assert.equal((await call('POST', '/api/remote/heartbeat', { body: auth(host, a) })).status, 403);
  assert.equal((await join(host, a.clientId, { clientToken: a.token })).status, 403);

  const reset = await call('POST', '/api/remote/reset', { body: { hostId: host.hostId, hostToken: host.hostToken } });
  assert.equal(reset.status, 200);
  const nextCode = reset.data.session.code;
  assert.equal((await call('POST', '/api/remote/heartbeat', { body: auth(host, b) })).status, 403);

  const rejoin = await call('POST', '/api/remote/join', {
    body: { code: nextCode, clientId: b.clientId, clientToken: b.token },
  });
  assert.equal(rejoin.status, 200);
  assert.notEqual(rejoin.data.clientToken, b.token);
  assert.equal(rejoin.data.session.role, 'controller');
});

test('Sangat View follow state and stream need no device credentials', async () => {
  const host = await newHost();
  const state = await call('GET', `/api/remote/follow/${host.followCode}/state`);
  assert.equal(state.status, 200);
  assert.equal(state.data.selectedTitle, 'Test Shabad');
  assert.equal(state.data.remoteSession, undefined);

  const controller = new AbortController();
  const res = await fetch(`${server.baseUrl}/api/remote/follow/stream?code=${host.followCode}`, { signal: controller.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  controller.abort();
  const text = Buffer.from(value).toString('utf8');
  assert.match(text, /event: state/);
  assert.match(text, /Test Shabad/);
});

test('CORS preflight from a LAN origin allows the client token header', async () => {
  const res = await fetch(`${server.baseUrl}/api/remote/state`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://192.168.1.20:5173',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-remote-client-token',
    },
  });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('access-control-allow-headers') || '', /x-remote-client-token/i);
});
