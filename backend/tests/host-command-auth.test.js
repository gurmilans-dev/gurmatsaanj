/**
 * S5: host command retrieval authorization.
 *
 * GET /remote/commands (polling) and GET /remote/stream (SSE) carry the phone
 * commands for one main app, e.g. `open-shabad` payloads. The host id is an
 * identifier, not a secret: it used to travel in every poll/stream URL. Access
 * needs the session's hostToken: in a header for polling, and through a
 * short-lived single-use ticket for EventSource, which cannot send headers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');

const { startTestServer, makeClient } = require('./helpers/server');
const { openEventStream } = require('./helpers/sse');
const { remoteActors, HOST_ID_HEADER } = require('./helpers/remote');

const TICKET_TTL_MS = 30_000;
const SESSION_GRACE_MS = 60_000;

let server;
let call;
let actors;

test.before(async () => {
  server = await startTestServer();
  call = makeClient(server.baseUrl);
  actors = remoteActors(call, 's5');
});

test.after(() => server.close());

function streamUrl(baseUrl, params) {
  return `${baseUrl}/api/remote/stream?${new URLSearchParams(params).toString()}`;
}

async function hostWithCommand() {
  const host = await actors.newHost();
  const phone = await actors.pairPhone(host);
  const command = await actors.sendCommand(phone, 'open-shabad', { shabadId: '1234' });
  return { host, phone, command };
}

async function ticketFor(host) {
  const res = await actors.requestStreamTicket(host);
  assert.equal(res.status, 200, `ticket refused: ${JSON.stringify(res.data)}`);
  assert.equal(typeof res.data.ticket, 'string');
  return res.data.ticket;
}

// ── Reproduction: host id alone ──────────────────────────────────────────

test('S5: /commands rejects a request that carries only the host id', async () => {
  const { host } = await hostWithCommand();

  const byQuery = await call('GET', '/api/remote/commands', { query: { hostId: host.hostId, after: 0 } });
  assert.equal(byQuery.status, 403);
  assert.equal(byQuery.data.commands, undefined);

  const byHeader = await actors.pollCommands(host, { token: '' });
  assert.equal(byHeader.status, 403);
  assert.equal(byHeader.data.commands, undefined);
});

test('S5: /stream rejects a connection that carries only the host id', async () => {
  const { host } = await hostWithCommand();
  const stream = await openEventStream(streamUrl(server.baseUrl, { hostId: host.hostId, after: 0 }));
  stream.close();
  assert.equal(stream.status, 403);
  assert.doesNotMatch(stream.body || '', /open-shabad/);
  assert.deepEqual(stream.events, []);
});

test('S5: the host token is not accepted from the query string', async () => {
  const { host } = await hostWithCommand();
  const res = await call('GET', '/api/remote/commands', {
    query: { after: 0, hostToken: host.hostToken },
    headers: { [HOST_ID_HEADER]: host.hostId },
  });
  assert.equal(res.status, 403);
});

test('S5: credentials from another session are rejected', async () => {
  const { host: victim } = await hostWithCommand();
  const other = await actors.newHost();

  const poll = await actors.pollCommands(victim, { token: other.hostToken });
  assert.equal(poll.status, 403);

  const ticket = await actors.requestStreamTicket(victim, { token: other.hostToken });
  assert.equal(ticket.status, 403);
  assert.equal(ticket.data.ticket, undefined);

  // A valid ticket is bound to its own session; a hostId in the URL cannot
  // point it at someone else's commands.
  const otherTicket = await ticketFor(other);
  const stream = await openEventStream(streamUrl(server.baseUrl, { ticket: otherTicket, hostId: victim.hostId, after: 0 }));
  assert.equal(stream.status, 200);
  assert.ok(await stream.waitForEvent('cursor'));
  stream.close();
  assert.deepEqual(stream.events.filter((e) => e.event === 'command'), []);
});

test('S5: ticket requests for unknown sessions or with no token are rejected', async () => {
  const unknown = await actors.requestStreamTicket({ hostId: 's5-no-such-host', hostToken: 'x'.repeat(32) });
  assert.equal(unknown.status, 403);
  const { host } = await hostWithCommand();
  const noToken = await actors.requestStreamTicket(host, { token: '' });
  assert.equal(noToken.status, 403);
});

// ── Legitimate host flows ────────────────────────────────────────────────

test('host polling with the token header gets the backlog, then only newer commands', async () => {
  const { host, phone, command } = await hostWithCommand();

  const first = await actors.pollCommands(host, { after: 0 });
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.commands.map((c) => c.type), ['open-shabad']);
  assert.equal(first.data.commands[0].payload.shabadId, '1234');
  assert.equal(first.data.latestId, command.id);

  const idle = await actors.pollCommands(host, { after: first.data.latestId });
  assert.deepEqual(idle.data.commands, []);

  await actors.sendCommand(phone, 'line-next');
  const next = await actors.pollCommands(host, { after: first.data.latestId });
  assert.deepEqual(next.data.commands.map((c) => c.type), ['line-next']);
});

test('host SSE with a ticket gets the backlog, the cursor, then live commands', async () => {
  const { host, phone } = await hostWithCommand();
  const ticket = await ticketFor(host);

  const stream = await openEventStream(streamUrl(server.baseUrl, { ticket, after: 0 }));
  assert.equal(stream.status, 200);
  const cursor = await stream.waitForEvent('cursor');
  assert.ok(cursor, 'no cursor event');
  const beforeCursor = stream.events.slice(0, stream.events.indexOf(cursor));
  assert.deepEqual(beforeCursor.map((e) => JSON.parse(e.data).type), ['open-shabad']);

  await actors.sendCommand(phone, 'line-next');
  const live = await stream.waitForEvent('command', { where: (e) => e.data.includes('line-next') });
  assert.ok(live, 'live command did not arrive over SSE');
  stream.close();
});

test('a stream ticket is single use: replaying it (EventSource auto-reconnect) is refused', async () => {
  const { host } = await hostWithCommand();
  const ticket = await ticketFor(host);
  const first = await openEventStream(streamUrl(server.baseUrl, { ticket }));
  assert.equal(first.status, 200);
  await first.waitForEvent('cursor');
  first.close();

  const replay = await openEventStream(streamUrl(server.baseUrl, { ticket }));
  assert.equal(replay.status, 403);

  // Reconnecting the legitimate way: a fresh ticket.
  const again = await openEventStream(streamUrl(server.baseUrl, { ticket: await ticketFor(host) }));
  assert.equal(again.status, 200);
  assert.ok(await again.waitForEvent('cursor'));
  again.close();
});

test('a stream ticket expires after its TTL', async (t) => {
  const { host } = await hostWithCommand();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const ticket = await ticketFor(host);
  const issued = await actors.requestStreamTicket(host);
  assert.ok(issued.data.expiresInMs <= TICKET_TTL_MS);

  t.mock.timers.tick(TICKET_TTL_MS + 1);
  const late = await openEventStream(streamUrl(server.baseUrl, { ticket }));
  assert.equal(late.status, 403);
});

test('stream tickets do not survive session expiry, even when the host re-creates its session', async (t) => {
  const { host } = await hostWithCommand();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const ticket = await ticketFor(host);

  // The open host stream is closed when the session expires.
  const open = await openEventStream(streamUrl(server.baseUrl, { ticket: await ticketFor(host) }));
  await open.waitForEvent('cursor');

  t.mock.timers.tick(SESSION_GRACE_MS + 1000);
  await actors.publish(host); // host comes back with the same id and token
  assert.ok(await open.waitForEnd(1500), 'expired session left the host command stream open');
  open.close();

  const stale = await openEventStream(streamUrl(server.baseUrl, { ticket }));
  assert.equal(stale.status, 403);

  // The re-created session works with fresh credentials-derived tickets.
  const fresh = await openEventStream(streamUrl(server.baseUrl, { ticket: await ticketFor(host) }));
  assert.equal(fresh.status, 200);
  assert.ok(await fresh.waitForEvent('cursor'));
  fresh.close();
});

test('code reset revokes unused tickets; the open host stream keeps receiving commands', async () => {
  const { host } = await hostWithCommand();
  const stream = await openEventStream(streamUrl(server.baseUrl, { ticket: await ticketFor(host), after: 0 }));
  await stream.waitForEvent('cursor');
  const unused = await ticketFor(host);

  await actors.resetHost(host);
  const replay = await openEventStream(streamUrl(server.baseUrl, { ticket: unused }));
  assert.equal(replay.status, 403);

  // Polling and the existing stream still work for the host after a reset.
  const poll = await actors.pollCommands(host, { after: 0 });
  assert.equal(poll.status, 200);
  assert.deepEqual(poll.data.commands, []);

  const phone = await actors.pairPhone(host, 'after-reset');
  await actors.sendCommand(phone, 'projector-blank');
  assert.ok(await stream.waitForEvent('command', { where: (e) => e.data.includes('projector-blank') }));
  assert.equal(stream.ended, false);
  stream.close();
});

test('outstanding tickets per session are capped; the newest stay valid', async () => {
  const { host } = await hostWithCommand();
  const tickets = [];
  for (let i = 0; i < 6; i += 1) tickets.push(await ticketFor(host));
  const statuses = [];
  for (const ticket of tickets) {
    const stream = await openEventStream(streamUrl(server.baseUrl, { ticket }));
    statuses.push(stream.status);
    stream.close();
  }
  assert.deepEqual(statuses, [403, 403, 200, 200, 200, 200]);
});

test('CORS preflight from a LAN origin allows the host credential headers', async () => {
  const res = await fetch(`${server.baseUrl}/api/remote/commands`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://192.168.1.20:5173',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-remote-host-id,x-remote-host-token',
    },
  });
  assert.equal(res.status, 204);
  const allowed = res.headers.get('access-control-allow-headers') || '';
  assert.match(allowed, /x-remote-host-id/i);
  assert.match(allowed, /x-remote-host-token/i);
});

test('backend restart: old tickets and follow links are dead, the host recovers with its stored token', async (t) => {
  async function boot() {
    const child = fork(path.join(__dirname, 'fixtures', 'app-process.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    const [{ port }] = await once(child, 'message');
    const baseUrl = `http://127.0.0.1:${port}`;
    return { child, baseUrl, actors: remoteActors(makeClient(baseUrl), 's5-restart') };
  }

  const first = await boot();
  const host = await first.actors.newHost('Before restart');
  const storedToken = host.hostToken;
  const oldFollowCode = host.followCode;
  const oldTicket = (await first.actors.requestStreamTicket(host)).data.ticket;
  first.child.kill();
  await once(first.child, 'exit');

  const second = await boot();
  // Main app publish loop: same hostId and the hostToken from localStorage.
  await second.actors.publish(host, 'After restart');
  assert.equal(host.hostToken, storedToken);

  const stale = await openEventStream(streamUrl(second.baseUrl, { ticket: oldTicket }));
  assert.equal(stale.status, 403);
  const oldFollow = await openEventStream(`${second.baseUrl}/api/remote/follow/stream?code=${oldFollowCode}`);
  await oldFollow.waitForEnd(1500);
  assert.ok(oldFollow.events.some((e) => e.event === 'revoked'));
  assert.deepEqual(oldFollow.events.filter((e) => e.event === 'state'), []);

  const ticket = (await second.actors.requestStreamTicket(host)).data.ticket;
  const stream = await openEventStream(streamUrl(second.baseUrl, { ticket }));
  assert.equal(stream.status, 200);
  await stream.waitForEvent('cursor');
  const phone = await second.actors.pairPhone(host);
  await second.actors.sendCommand(phone, 'line-next');
  assert.ok(await stream.waitForEvent('command', { where: (e) => e.data.includes('line-next') }));
  stream.close();
});
