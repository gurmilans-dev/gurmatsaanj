/**
 * S4: Sangat View stream revocation.
 *
 * A Sangat View link (/follow/<followCode>) is a shared read-only capability.
 * When the host generates new codes (POST /remote/reset) or the session ends,
 * every stream opened with the old follow code must stop receiving state, be
 * closed by the server, and stay closed on reconnect. Viewers on the new link
 * keep working.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, makeClient } = require('./helpers/server');
const { openEventStream } = require('./helpers/sse');
const { remoteActors } = require('./helpers/remote');

const SESSION_GRACE_MS = 60_000;

let server;
let call;
let actors;

test.before(async () => {
  server = await startTestServer();
  call = makeClient(server.baseUrl);
  actors = remoteActors(call, 's4');
});

test.after(() => server.close());

function followStream(code) {
  return openEventStream(`${server.baseUrl}/api/remote/follow/stream?code=${encodeURIComponent(code)}`);
}

function statesWith(stream, text) {
  return stream.events.filter((e) => e.event === 'state' && e.data.includes(text));
}

test('S4: code reset closes Sangat View streams opened with the old link', async () => {
  const host = await actors.newHost('Before reset');
  const oldStream = await followStream(host.followCode);
  assert.equal(oldStream.status, 200);
  assert.ok(await oldStream.waitForEvent('state'), 'old link received the initial state');

  await actors.resetHost(host);
  await actors.publish(host, 'After reset private');

  const ended = await oldStream.waitForEnd(1500);
  oldStream.close();
  assert.deepEqual(statesWith(oldStream, 'After reset private'), [], 'revoked stream received post-reset state');
  assert.ok(ended, 'server did not close the revoked stream');
  const revoked = oldStream.events.find((e) => e.event === 'revoked');
  assert.ok(revoked, 'revoked stream was not told why it closed');
  assert.match(JSON.parse(revoked.data).error, /expired/i);
});

test('S4: reconnecting with a revoked follow code does not restore access', async () => {
  const host = await actors.newHost('Reconnect probe');
  const oldCode = host.followCode;
  await actors.resetHost(host);
  await actors.publish(host, 'Reconnect probe');

  // What a browser EventSource does after the server closed the stream.
  const retry = await followStream(oldCode);
  assert.equal(retry.status, 200);
  assert.ok(await retry.waitForEnd(1500), 'reconnect with a revoked code was held open');
  assert.deepEqual(retry.events.filter((e) => e.event === 'state'), []);
  const revoked = retry.events.find((e) => e.event === 'revoked');
  assert.ok(revoked, 'reconnect was not told the link is revoked');
  // Stops the auto-reconnect loop of pages that predate the `revoked` event.
  assert.ok(revoked.retry >= 60_000, `retry hint too short: ${revoked.retry}`);

  const rest = await call('GET', `/api/remote/follow/${oldCode}/state`);
  assert.equal(rest.status, 404);
  const generic = await call('GET', '/api/remote/state', { query: { code: oldCode } });
  assert.equal(generic.data.selectedTitle, '');
});

test('S4: viewers on the new link connect and keep receiving updates after a reset', async () => {
  const host = await actors.newHost('First');
  const old1 = await followStream(host.followCode);
  const old2 = await followStream(host.followCode);
  await Promise.all([old1.waitForEvent('state'), old2.waitForEvent('state')]);

  await actors.resetHost(host);
  const fresh = await followStream(host.followCode);
  assert.equal(fresh.status, 200);
  assert.ok(await fresh.waitForEvent('state'), 'new link received the initial state');

  await actors.publish(host, 'Second');
  assert.ok(
    await fresh.waitForEvent('state', { where: (e) => e.data.includes('Second') }),
    'new link did not receive the live update',
  );
  for (const old of [old1, old2]) {
    assert.ok(await old.waitForEnd(1500), 'an old-link viewer stayed connected');
    assert.deepEqual(statesWith(old, 'Second'), []);
    old.close();
  }
  assert.equal(fresh.ended, false, 'reset closed a stream on the new link');
  fresh.close();
});

test('S4: host page reload keeps the current Sangat View link working', async () => {
  const host = await actors.newHost('Before reload');
  const stream = await followStream(host.followCode);
  await stream.waitForEvent('state');

  // Reload: same hostId and stored hostToken, no reset.
  const session = await actors.publish(host, 'After reload');
  assert.equal(session.followCode, host.followCode);
  assert.ok(await stream.waitForEvent('state', { where: (e) => e.data.includes('After reload') }));
  assert.equal(stream.ended, false);
  stream.close();
});

test('S4: session expiry revokes open streams and the returning host gets a new link', async (t) => {
  const host = await actors.newHost('Expiring');
  const oldCode = host.followCode;
  const stream = await followStream(oldCode);
  await stream.waitForEvent('state');

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.mock.timers.tick(SESSION_GRACE_MS + 1000);
  // Any request runs the session sweep.
  await call('GET', '/api/remote/follow/none/state');

  assert.ok(await stream.waitForEnd(1500), 'expired session left its Sangat stream open');
  assert.ok(stream.events.some((e) => e.event === 'revoked'));
  stream.close();

  await actors.publish(host, 'Host is back');
  assert.notEqual(host.followCode, oldCode);
  const retry = await followStream(oldCode);
  await retry.waitForEnd(1500);
  assert.deepEqual(retry.events.filter((e) => e.event === 'state'), []);
});
