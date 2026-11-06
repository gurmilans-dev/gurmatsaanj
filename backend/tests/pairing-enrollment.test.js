/**
 * Device enrollment and pairing.
 *
 * Enrollment capabilities, each in its own namespace:
 *   - pairing link token: in the QR (`/remote#pair=...`). High entropy,
 *     short-lived, multi-use. Enrolls a device with full remote rights.
 *   - pairing code: the 4-digit code people type. Crypto-random, expiring,
 *     throttled per device. Enrolls a view-only device; control needs host
 *     (or current controller) approval. The code is shown in the main app
 *     header, so it is treated as visible to anyone in the hall.
 * Device credential: clientId + clientToken, per phone. Survives screen
 * sleep; revoked by kick, leave, reset, session end and long idle.
 *
 * Host credentials, host stream tickets and Sangat View follow codes have
 * their own suites (remote-auth, host-command-auth, sangat-revocation); here
 * they only appear to prove they are not accepted as enrollment capabilities.
 *
 * Phones are simulated behind the local dev proxy: each "device" sends its
 * own X-Forwarded-For from the loopback peer, as Vite's proxy does.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork, spawnSync } = require('node:child_process');
const { once } = require('node:events');

const { startTestServer, makeClient } = require('./helpers/server');
const { remoteActors } = require('./helpers/remote');
const { createApp } = require('../src/app');

// Policy under test (mirrors remote.controller.js).
const PAIR_LINK_TTL_MS = 5 * 60_000;
const PAIR_LINK_REFRESH_MS = 2 * 60_000;
const PAIR_CODE_TTL_MS = 15 * 60_000;
const PAIR_CODE_REFRESH_MS = 10 * 60_000;
const FAILURE_BURST = 10;
const FAILURE_REFILL_MS = 30_000;
const MAX_CODE_DEVICES = 8;
const CONTROLLER_TTL_MS = 30_000;
const DEVICE_IDLE_TTL_MS = 12 * 60 * 60_000;
// Host publishes more often than the 60 s session grace while time advances.
const HOST_STEP_MS = 50_000;

let server;
let call;
let actors;
let sourceSeq = 0;
let deviceSeq = 0;

test.before(async () => {
  server = await startTestServer();
  call = makeClient(server.baseUrl);
  actors = remoteActors(call, 'pair');
});

test.after(() => server.close());

// ── Actors ────────────────────────────────────────────────────────────────

/** A distinct phone on the LAN, seen through the local proxy. */
function newSource() {
  sourceSeq += 1;
  return `10.77.${Math.floor(sourceSeq / 250)}.${(sourceSeq % 250) + 1}`;
}

function newDeviceId(label = 'phone') {
  deviceSeq += 1;
  return `pair-${label}-${deviceSeq}`;
}

/** Codes are issued in 1000-9999, so 0xxx is never a live code. */
function wrongCode(i) {
  return String(i % 1000).padStart(4, '0');
}

function join(body, source) {
  return call('POST', '/api/remote/join', { body, headers: source ? { 'X-Forwarded-For': source } : {} });
}

async function pairByLink(host, { name = 'link-phone', source = newSource(), clientId = newDeviceId(name) } = {}) {
  const res = await join({ pairToken: host.pairToken, clientId, name }, source);
  assert.equal(res.status, 200, `QR pairing failed: ${JSON.stringify(res.data)}`);
  return { clientId, token: res.data.clientToken, source, session: res.data.session };
}

async function pairByCode(host, { name = 'code-phone', source = newSource(), clientId = newDeviceId(name) } = {}) {
  const res = await join({ code: host.code, clientId, name }, source);
  assert.equal(res.status, 200, `code pairing failed: ${JSON.stringify(res.data)}`);
  return { clientId, token: res.data.clientToken, source, session: res.data.session };
}

function asDevice(device, extra = {}) {
  return { clientId: device.clientId, clientToken: device.token, ...extra };
}

const heartbeat = (d) => call('POST', '/api/remote/heartbeat', { body: asDevice(d) });
const claim = (d) => call('POST', '/api/remote/claim', { body: asDevice(d) });
const release = (d) => call('POST', '/api/remote/release', { body: asDevice(d) });
const command = (d, type = 'line-next') => call('POST', '/api/remote/command', { body: asDevice(d, { type }) });
const hostGrant = (host, d) => call('POST', '/api/remote/grant', {
  body: { hostId: host.hostId, hostToken: host.hostToken, targetClientId: d.clientId },
});
const hostView = (host) => actors.publish(host);
const controllerOf = (session) => session.clients.find((c) => c.isController)?.clientId || '';

async function hostCommandTypes(host) {
  const res = await actors.pollCommands(host);
  assert.equal(res.status, 200);
  return res.data.commands.map((c) => c.type);
}

function mockClock(t) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
}

/** Advance time while the host keeps publishing; phones stay silent. */
async function advance(t, host, ms) {
  let left = ms;
  while (left > 0) {
    const step = Math.min(HOST_STEP_MS, left);
    t.mock.timers.tick(step);
    left -= step;
    await actors.publish(host);
  }
}

// ── Capabilities ──────────────────────────────────────────────────────────

test('host view carries a high-entropy pairing link and a 4-digit code; phones see neither', async () => {
  const host = await actors.newHost();
  assert.match(host.pairToken || '', /^[A-Za-z0-9_-]{32,}$/, 'no high-entropy pairing link token');
  assert.match(host.code, /^\d{4}$/);
  assert.notEqual(host.pairToken, host.hostToken);

  const phone = await pairByLink(host);
  const beat = await heartbeat(phone);
  for (const view of [phone.session, beat.data.session]) {
    for (const key of ['code', 'pairToken', 'hostToken', 'followCode']) {
      assert.equal(view[key], undefined, `phone view exposes ${key}`);
    }
    assert.ok(!JSON.stringify(view).includes(host.pairToken));
  }
  const roster = JSON.stringify((await hostView(host)).clients);
  assert.ok(!roster.includes(phone.token), 'device list exposes a device credential');
});

test('pairing and follow codes come from a CSPRNG (unaffected by a constant Math.random)', async (t) => {
  t.mock.method(Math, 'random', () => 0.5);
  const hosts = [];
  for (let i = 0; i < 6; i += 1) hosts.push(await actors.newHost());
  const codes = hosts.map((h) => h.code);
  const follows = hosts.map((h) => h.followCode);
  for (const code of codes) assert.match(code, /^\d{4}$/);
  for (const follow of follows) assert.match(follow, /^[0-9A-Z]{6}$/);
  assert.equal(new Set(codes).size, codes.length, `pair codes repeat: ${codes}`);
  assert.equal(new Set(follows).size, follows.length, `follow codes repeat: ${follows}`);
});

test('credentials are not interchangeable with enrollment capabilities', async () => {
  const host = await actors.newHost();
  const phone = await pairByLink(host);
  const ticket = (await actors.requestStreamTicket(host)).data.ticket;
  const attempts = [
    ['follow code as pairing code', { code: host.followCode }],
    ['follow code as pairing link', { pairToken: host.followCode }],
    ['pairing code as pairing link', { pairToken: host.code }],
    ['host token as pairing link', { pairToken: host.hostToken }],
    ['stream ticket as pairing link', { pairToken: ticket }],
    ['device credential as pairing link', { pairToken: phone.token }],
  ];
  for (const [label, body] of attempts) {
    const res = await join({ ...body, clientId: newDeviceId('mixup') }, newSource());
    assert.equal(res.status, 403, label);
    assert.equal(res.data.clientToken, undefined, label);
  }

  // And enrollment capabilities are not credentials anywhere else.
  assert.equal((await heartbeat({ clientId: phone.clientId, token: host.pairToken })).status, 403);
  assert.equal((await call('GET', `/api/remote/follow/${host.pairToken}/state`)).status, 404);
  assert.equal((await call('GET', `/api/remote/follow/${host.code}/state`)).status, 404);
  assert.equal((await actors.pollCommands(host, { token: host.pairToken })).status, 403);
  const stream = await fetch(`${server.baseUrl}/api/remote/stream?ticket=${host.pairToken}`);
  assert.equal(stream.status, 403);
  await stream.body?.cancel();
});

// ── QR pairing ────────────────────────────────────────────────────────────

test('QR pairing: several phones enroll from one link; the first controls, the rest view', async () => {
  const host = await actors.newHost();
  const a = await pairByLink(host, { name: 'sevadar-a' });
  const b = await pairByLink(host, { name: 'sevadar-b' });
  const c = await pairByLink(host, { name: 'sevadar-c' });
  assert.equal(a.session.role, 'controller');
  assert.equal(b.session.role, 'viewer');
  assert.equal(c.session.role, 'viewer');
  assert.equal(new Set([a.token, b.token, c.token]).size, 3);
  assert.equal((await command(a)).status, 200);
  assert.equal((await command(b)).status, 423);
  assert.deepEqual(await hostCommandTypes(host), ['line-next']);
});

test('concurrent QR enrollments: all succeed, exactly one controller, distinct credentials', async () => {
  const host = await actors.newHost();
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    join({ pairToken: host.pairToken, clientId: newDeviceId('burst'), name: `burst-${i}` }, newSource())));
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
  assert.equal(new Set(results.map((r) => r.data.clientToken)).size, 6);
  assert.equal(results.filter((r) => r.data.session.role === 'controller').length, 1);
  const view = await hostView(host);
  assert.equal(view.clientCount, 6);
  assert.equal(view.clients.filter((c) => c.isController).length, 1);
});

// ── Typed code: view-only until approved ──────────────────────────────────

test('typed code pairs a view-only device: no self-service control even when control is free', async () => {
  const host = await actors.newHost();
  const phone = await pairByCode(host);
  assert.equal(phone.session.paired, true);
  assert.equal(phone.session.role, 'viewer', 'typed code alone granted control');
  assert.equal(phone.session.trusted, false);

  assert.equal((await command(phone)).status, 423);
  assert.equal((await claim(phone)).status, 409);
  const again = await join({ code: host.code, ...asDevice(phone), name: 'x', trusted: true }, phone.source);
  assert.equal(again.status, 200);
  assert.equal(again.data.clientToken, phone.token);
  assert.equal(again.data.session.role, 'viewer');

  const view = await hostView(host);
  assert.equal(controllerOf(view), '');
  assert.deepEqual(await hostCommandTypes(host), []);
  // The attempts surface to the host as a control request to allow or ignore.
  assert.ok(view.pendingRequests.some((r) => r.clientId === phone.clientId));
  assert.equal(view.clients.find((c) => c.clientId === phone.clientId)?.trusted, false);
});

test('host approval promotes a typed-code device; it keeps control rights after release', async () => {
  const host = await actors.newHost();
  const phone = await pairByCode(host);
  assert.equal((await claim(phone)).status, 409);
  const grant = await hostGrant(host, phone);
  assert.equal(grant.status, 200);
  assert.equal((await command(phone)).status, 200);
  assert.equal((await release(phone)).status, 200);
  const back = await claim(phone);
  assert.equal(back.status, 200);
  assert.equal(back.data.session.role, 'controller');
  assert.equal(back.data.session.trusted, true);
});

test('controller handoff: the current controller can approve a typed-code device', async () => {
  const host = await actors.newHost();
  const lead = await pairByLink(host, { name: 'lead' });
  const helper = await pairByCode(host, { name: 'helper' });
  assert.equal((await command(helper)).status, 423);
  const grant = await call('POST', '/api/remote/grant', { body: asDevice(lead, { targetClientId: helper.clientId }) });
  assert.equal(grant.status, 200);
  assert.equal((await command(helper)).status, 200);
  assert.equal((await command(lead)).status, 423);
});

test('privilege escalation by a typed-code viewer fails, including after the controller lapses', async (t) => {
  mockClock(t);
  const host = await actors.newHost();
  const lead = await pairByLink(host, { name: 'lead' });
  const intruder = await pairByCode(host, { name: 'intruder' });

  const forged = await call('POST', '/api/remote/command', {
    body: { type: 'line-next', clientId: lead.clientId, clientToken: intruder.token },
  });
  assert.equal(forged.status, 403, 'controller clientId + own token');
  await command(intruder); // files a control request
  const selfGrant = await call('POST', '/api/remote/grant', { body: asDevice(intruder, { targetClientId: intruder.clientId }) });
  assert.equal(selfGrant.status, 403, 'approved its own request');
  const tokenAsLink = await join({ pairToken: intruder.token, clientId: intruder.clientId }, intruder.source);
  assert.equal(tokenAsLink.status, 403, 'device credential accepted as QR capability');

  // The controller's phone sleeps; control becomes free.
  for (let elapsed = 0; elapsed <= CONTROLLER_TTL_MS; elapsed += 10_000) {
    t.mock.timers.tick(10_000);
    assert.equal((await heartbeat(intruder)).status, 200);
  }
  assert.equal(controllerOf(await hostView(host)), '');
  assert.equal((await claim(intruder)).status, 409, 'typed-code device claimed free control');
  assert.equal((await command(intruder)).status, 423, 'typed-code device took free control by commanding');
  assert.deepEqual(await hostCommandTypes(host), []);

  // The QR-paired lead wakes up and simply carries on.
  assert.equal((await command(lead)).status, 200);
});

test('revoked device credentials cannot be replayed: kick, leave and reset', async () => {
  const host = await actors.newHost();
  const kicked = await pairByLink(host, { name: 'kicked' });
  const leaver = await pairByLink(host, { name: 'leaver' });
  const typed = await pairByCode(host, { name: 'typed' });

  const kick = await call('POST', '/api/remote/kick', {
    body: { hostId: host.hostId, hostToken: host.hostToken, targetClientId: kicked.clientId },
  });
  assert.equal(kick.status, 200);
  const kickedBeat = await heartbeat(kicked);
  assert.equal(kickedBeat.status, 403);
  assert.match(kickedBeat.data.error, /removed/i);
  const kickedRejoin = await join({ pairToken: host.pairToken, ...asDevice(kicked) }, kicked.source);
  assert.equal(kickedRejoin.status, 403, 'kicked device re-enrolled before reset');

  assert.equal((await call('POST', '/api/remote/leave', { body: asDevice(leaver) })).status, 200);
  assert.equal((await heartbeat(leaver)).status, 403);
  assert.equal((await command(leaver)).status, 403);

  const oldLink = host.pairToken;
  await actors.resetHost(host);
  const typedBeat = await heartbeat(typed);
  assert.equal(typedBeat.status, 403);
  assert.match(typedBeat.data.error, /new code|scan/i);
  assert.equal((await join({ pairToken: oldLink, clientId: newDeviceId() }, newSource())).status, 403);

  // The phone's state poll also learns that its credential ended, and why.
  const polled = await call('GET', '/api/remote/state', {
    query: { clientId: typed.clientId },
    headers: { 'X-Remote-Client-Token': typed.token },
  });
  assert.equal(polled.data.remoteSession.paired, false);
  assert.match(polled.data.remoteSession.error, /new code|scan/i);
  const anonymous = await call('GET', '/api/remote/state', { query: { clientId: typed.clientId } });
  assert.equal(anonymous.data.remoteSession.error, undefined, 'reason revealed without the credential');

  // After a reset even a previously kicked phone may pair again.
  const back = await pairByLink(host, { clientId: kicked.clientId, source: kicked.source });
  assert.notEqual(back.token, kicked.token);
});

// ── Guessing and abuse ────────────────────────────────────────────────────

test('invalid and expired capabilities get one generic answer that echoes nothing', async () => {
  const host = await actors.newHost();
  const badCode = await join({ code: '0042', clientId: newDeviceId() }, newSource());
  const badLink = await join({ pairToken: 'Z'.repeat(32), clientId: newDeviceId() }, newSource());
  for (const res of [badCode, badLink]) {
    assert.equal(res.status, 403);
    assert.equal(res.data.clientToken, undefined);
    assert.equal(res.data.session, undefined);
  }
  assert.equal(badCode.data.error, badLink.data.error);
  assert.ok(!JSON.stringify(badCode.data).includes('0042'));
  assert.ok(!JSON.stringify(badLink.data).includes('Z'.repeat(32)));
  assert.ok(!JSON.stringify(badCode.data).includes(host.code));
});

test('repeated wrong codes from one phone are throttled without blocking anyone else', async (t) => {
  mockClock(t);
  const host = await actors.newHost();
  const guesser = newSource();
  const neighbour = newSource();
  for (let i = 0; i < FAILURE_BURST; i += 1) {
    const res = await join({ code: wrongCode(i), clientId: newDeviceId('guess') }, guesser);
    assert.equal(res.status, 403, `guess ${i + 1}`);
  }
  const blocked = await join({ code: host.code, clientId: newDeviceId('guess') }, guesser);
  assert.equal(blocked.status, 429, 'correct code evaluated while throttled');
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  assert.ok(!JSON.stringify(blocked.data).includes(host.code));

  // Another phone on the same Wi-Fi is unaffected.
  assert.equal((await join({ code: host.code, clientId: newDeviceId('neighbour') }, neighbour)).status, 200);
  // The QR path never shares the typed-code budget, and paired devices work.
  const viaLink = await pairByLink(host, { source: guesser });
  assert.equal((await heartbeat(viaLink)).status, 200);

  // The budget refills slowly: one more guess per refill interval.
  t.mock.timers.tick(FAILURE_REFILL_MS);
  assert.equal((await join({ code: wrongCode(500), clientId: newDeviceId('guess') }, guesser)).status, 403);
  assert.equal((await join({ code: wrongCode(501), clientId: newDeviceId('guess') }, guesser)).status, 429);
});

test('concurrent wrong guesses: the budget is enforced exactly', async (t) => {
  mockClock(t);
  const source = newSource();
  const results = await Promise.all(Array.from({ length: FAILURE_BURST + 4 }, (_, i) =>
    join({ code: wrongCode(100 + i), clientId: newDeviceId('race') }, source)));
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 403).length, FAILURE_BURST, String(statuses));
  assert.equal(statuses.filter((s) => s === 429).length, 4, String(statuses));
});

test('shared reverse proxy: X-Forwarded-For is trusted only from a loopback proxy', () => {
  const trust = createApp({ logging: false }).get('trust proxy fn');
  assert.equal(trust('127.0.0.1', 0), true);
  assert.equal(trust('::1', 0), true);
  assert.equal(trust('::ffff:127.0.0.1', 0), true);
  assert.equal(trust('192.168.1.20', 0), false, 'LAN peer could spoof its source');
  assert.equal(trust('10.0.0.5', 0), false);
});

test('TRUST_PROXY never turns into "trust every peer"', () => {
  const read = (value) => {
    const out = spawnSync(process.execPath, ['-e', "process.stdout.write(JSON.stringify(require('./src/config').trustProxy))"], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, TRUST_PROXY: value },
      encoding: 'utf8',
    });
    return JSON.parse(out.stdout);
  };
  assert.deepEqual(read('true'), ['loopback']);
  assert.deepEqual(read('2'), ['loopback']);
  assert.equal(read('false'), false);
  assert.deepEqual(read('loopback, 10.0.0.2'), ['loopback', '10.0.0.2']);
});

test('proxy without forwarding: typed codes share one budget, QR pairing and paired phones keep working', async (t) => {
  mockClock(t);
  const host = await actors.newHost();
  const paired = await pairByLink(host, { source: null });
  for (let i = 0; i < FAILURE_BURST; i += 1) {
    await join({ code: wrongCode(200 + i), clientId: newDeviceId('shared') }, null);
  }
  assert.equal((await join({ code: host.code, clientId: newDeviceId('shared') }, null)).status, 429);
  await pairByLink(host, { source: null });
  assert.equal((await heartbeat(paired)).status, 200);
  assert.equal((await command(paired)).status, 200);
});

test('per-session cap on typed-code devices awaiting approval', async () => {
  const host = await actors.newHost();
  const typed = [];
  for (let i = 0; i < MAX_CODE_DEVICES; i += 1) typed.push(await pairByCode(host, { name: `typed-${i}` }));
  const over = await join({ code: host.code, clientId: newDeviceId('over') }, newSource());
  assert.equal(over.status, 429);
  await pairByLink(host); // QR pairing is not capped

  await claim(typed[0]);
  assert.equal((await hostGrant(host, typed[0])).status, 200);
  await pairByCode(host, { name: 'after-approval' });
});

// ── Lifecycle ─────────────────────────────────────────────────────────────

test('pairing code lifecycle: a fresh code is shown before the old one expires', async (t) => {
  mockClock(t);
  const host = await actors.newHost();
  const first = host.code;
  const pairedEarly = await pairByLink(host);
  await advance(t, host, PAIR_CODE_REFRESH_MS);
  assert.notEqual(host.code, first, 'host was not given a fresh code to display');
  assert.equal((await heartbeat(pairedEarly)).status, 200, 'code refresh dropped a paired phone');
  assert.equal((await join({ code: first, clientId: newDeviceId() }, newSource())).status, 200,
    'a code read just before the refresh stopped working');

  await advance(t, host, PAIR_CODE_TTL_MS - PAIR_CODE_REFRESH_MS + HOST_STEP_MS);
  if (host.code !== first) {
    assert.equal((await join({ code: first, clientId: newDeviceId() }, newSource())).status, 403, 'expired code accepted');
  }
  assert.equal((await join({ code: host.code, clientId: newDeviceId() }, newSource())).status, 200);
});

test('pairing link lifecycle: a photographed QR stops working within its TTL', async (t) => {
  mockClock(t);
  const host = await actors.newHost();
  const photo = host.pairToken;
  await advance(t, host, PAIR_LINK_REFRESH_MS);
  assert.notEqual(host.pairToken, photo);
  assert.equal((await join({ pairToken: photo, clientId: newDeviceId() }, newSource())).status, 200);

  await advance(t, host, PAIR_LINK_TTL_MS - PAIR_LINK_REFRESH_MS + HOST_STEP_MS);
  assert.equal((await join({ pairToken: photo, clientId: newDeviceId() }, newSource())).status, 403, 'expired QR accepted');
  assert.equal((await join({ pairToken: host.pairToken, clientId: newDeviceId() }, newSource())).status, 200);
});

test('reset revokes every enrollment capability and device; old QR links cannot pair', async () => {
  const host = await actors.newHost();
  const oldLink = host.pairToken;
  const oldCode = host.code;
  const phone = await pairByLink(host);
  await actors.resetHost(host);
  assert.notEqual(host.pairToken, oldLink);
  assert.equal((await join({ pairToken: oldLink, clientId: newDeviceId() }, newSource())).status, 403);
  if (host.code !== oldCode) {
    assert.equal((await join({ code: oldCode, clientId: newDeviceId() }, newSource())).status, 403);
  }
  assert.equal((await heartbeat(phone)).status, 403);
  assert.equal((await command(phone)).status, 403);
  const fresh = await pairByLink(host);
  assert.equal(fresh.session.role, 'controller');
});

test('host reload keeps the current link, code and paired devices', async () => {
  const host = await actors.newHost();
  const phone = await pairByLink(host);
  const before = { pairToken: host.pairToken, code: host.code };
  await actors.publish(host, 'After reload'); // same hostId and stored hostToken
  assert.equal(host.pairToken, before.pairToken);
  assert.equal(host.code, before.code);
  const beat = await heartbeat(phone);
  assert.equal(beat.status, 200);
  assert.equal(beat.data.session.role, 'controller');
});

test('paired phones survive screen sleep; the credential ends after long idle', async (t) => {
  mockClock(t);
  const host = await actors.newHost();
  const phone = await pairByLink(host);
  await advance(t, host, 5 * 60_000); // phone screen off for 5 minutes

  const view = await hostView(host);
  assert.ok(!view.clients.some((c) => c.clientId === phone.clientId), 'sleeping phone listed as present');
  assert.equal(controllerOf(view), '');
  const wake = await heartbeat(phone);
  assert.equal(wake.status, 200, 'phone had to re-pair after its screen slept');
  assert.equal(wake.data.session.trusted, true);
  assert.equal((await command(phone)).status, 200, 'QR-paired phone could not resume control after sleep');

  await advance(t, host, DEVICE_IDLE_TTL_MS + HOST_STEP_MS);
  assert.equal((await heartbeat(phone)).status, 403, 'credential survived beyond the idle limit');
});

test('a device credential only acts in its own session', async () => {
  const hostA = await actors.newHost();
  const hostB = await actors.newHost();
  const phone = await pairByLink(hostA);
  // A wrong code plus a valid credential resumes the device's own session.
  const res = await join({ code: wrongCode(7), ...asDevice(phone) }, phone.source);
  assert.equal(res.status, 200);
  assert.equal(res.data.clientToken, phone.token);
  assert.ok(!(await hostView(hostB)).clients.some((c) => c.clientId === phone.clientId));

  await command(phone, 'projector-blank');
  assert.deepEqual(await hostCommandTypes(hostA), ['projector-blank']);
  assert.deepEqual(await hostCommandTypes(hostB), []);
});

test('backend restart: old links, codes and device credentials are dead; the host pairs again', async (t) => {
  async function boot() {
    const child = fork(path.join(__dirname, 'fixtures', 'app-process.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    const [{ port }] = await once(child, 'message');
    const client = makeClient(`http://127.0.0.1:${port}`);
    return { child, client, actors: remoteActors(client, 'pair-restart') };
  }

  const first = await boot();
  const host = await first.actors.newHost();
  const old = { pairToken: host.pairToken, code: host.code };
  const joined = await first.client('POST', '/api/remote/join', { body: { pairToken: host.pairToken, clientId: 'restart-phone' } });
  assert.equal(joined.status, 200);
  first.child.kill();
  await once(first.child, 'exit');

  const second = await boot();
  await second.actors.publish(host); // main app reconnects with its stored id and token
  assert.notEqual(host.pairToken, old.pairToken);
  const call2 = second.client;
  assert.equal((await call2('POST', '/api/remote/join', { body: { pairToken: old.pairToken, clientId: 'restart-new' } })).status, 403);
  if (host.code !== old.code) {
    assert.equal((await call2('POST', '/api/remote/join', { body: { code: old.code, clientId: 'restart-new' } })).status, 403);
  }
  const beat = await call2('POST', '/api/remote/heartbeat', {
    body: { clientId: 'restart-phone', clientToken: joined.data.clientToken },
  });
  assert.equal(beat.status, 403);
  const again = await call2('POST', '/api/remote/join', { body: { pairToken: host.pairToken, clientId: 'restart-phone' } });
  assert.equal(again.status, 200);
  assert.equal(again.data.session.role, 'controller');
});
