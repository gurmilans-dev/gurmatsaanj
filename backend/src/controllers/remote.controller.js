/**
 * Local-network remote controller — per-host sessions.
 *
 * Each main-app instance (each browser tab/PWA that opens the app) is its
 * own SESSION. Sessions are keyed by the main app's `remoteHostId`, which is
 * generated client-side and stored in localStorage so the same tab reuses
 * its id across reloads. Every session has its own pairing code, command
 * queue, latest state, clients map, and SSE subscriber set.
 *
 * Routing rules:
 *   - postState : creates/updates the session keyed by remoteHostId in body.
 *   - getCommands : main app polls its OWN session's commands with the
 *     X-Remote-Host-Id + X-Remote-Host-Token headers. The host id alone is
 *     never enough.
 *   - createStreamTicket / streamCommands : EventSource cannot send headers,
 *     so the main app trades its hostToken for a short-lived, single-use
 *     ticket and opens /stream?ticket=... The hostToken never goes in a URL.
 *   - streamFollowState : Sangat View, keyed by the shared follow code.
 *     Rotating the code (resetSession) or ending the session closes every
 *     stream opened with the old code with a `revoked` event.
 *   - joinSession : device enrollment. Two capabilities, never interchangeable:
 *       pairing link token (QR `/remote#pair=...`): high entropy, short-lived,
 *         multi-use; enrolls a trusted device (may hold control).
 *       pairing code (typed, 4 digits): crypto-random, expiring, throttled per
 *         source; enrolls a view-only device. It is shown in the main app
 *         header, so it is treated as public. Control needs host or controller
 *         approval (grantControl), which makes the device trusted.
 *     Success returns a per-device secret (clientToken).
 *   - postCommand / heartbeat / claim / release / grant / leave / getState :
 *     the phone proves its identity with clientId + clientToken; the token
 *     alone selects the session (no pair code needed, so codes can expire
 *     without dropping paired phones). A clientId alone is never enough:
 *     every paired device can see the other devices' ids in the roster.
 *   - resetSession : hostId resolves the session (host can only reset its
 *     own session, never anyone else's).
 *
 * Everything is in-memory and expires on host inactivity (HOST_TTL_MS for
 * "host connected" flag, SESSION_GRACE_MS before the session is purged).
 */

const crypto = require('crypto');

const MAX_PANKTI_LINES = 220;
const MAX_PANKTI_LEN = 260;
const MAX_TRANSLATION_LEN = 420;
const MAX_QUEUE_ITEMS = 60;
const MAX_QUEUE_TEXT_LEN = 220;
const MAX_COMMANDS = 80;
const HOST_TTL_MS = 4500;
const SESSION_GRACE_MS = 60_000;          // remove session this long after host disconnects
const CLIENT_TTL_MS = 45_000;             // presence: listed as paired / may hold control
const DEVICE_IDLE_TTL_MS = 12 * 60 * 60_000; // credential: survives screen sleep, ends after long idle
const CONTROLLER_TTL_MS = 30_000;
// Enrollment policy. A refreshed code/link is issued while the previous one
// is still valid, so whatever the host screen shows keeps working for at
// least (TTL - REFRESH) after it was read.
const PAIR_LINK_TTL_MS = 5 * 60_000;
const PAIR_LINK_REFRESH_MS = 2 * 60_000;
const PAIR_CODE_TTL_MS = 15 * 60_000;
const PAIR_CODE_REFRESH_MS = 10 * 60_000;
// Wrong typed codes per source: a burst, then one more per refill interval.
const PAIR_FAILURE_BURST = 10;
const PAIR_FAILURE_REFILL_MS = 30_000;
const MAX_PAIRING_SOURCES = 5000;
// Typed-code devices present in one session before new ones are refused.
const MAX_CODE_DEVICES_PER_SESSION = 8;
// How long a revoked device credential still gets a specific reason.
const REVOKED_NOTICE_TTL_MS = 30 * 60_000;
const MAX_REVOKED_NOTICES = 2000;
const CONTROL_REQUEST_TTL_MS = 60_000;
const REMOTE_CONTENT_TTL_MS = 12_000;
const STREAM_TICKET_TTL_MS = 30_000;      // host SSE connect ticket lifetime
const MAX_STREAM_TICKETS_PER_SESSION = 4;
const SSE_HEARTBEAT_MS = 20_000;
// `retry:` sent with a revoked Sangat View stream. A page that predates the
// `revoked` event would otherwise let EventSource reconnect every few seconds
// for as long as the phone stays open.
const REVOKED_RETRY_MS = 24 * 60 * 60 * 1000;

const ALLOWED_COMMANDS = new Set([
  // Line navigation
  'line-prev', 'line-next', 'line-first', 'line-last',
  'line-select', 'load-more-lines', 'resume-live',
  // Context navigation
  'shabad-prev', 'shabad-next', 'ang-prev', 'ang-next',
  // Projector view modes
  'projector-shabad', 'projector-waheguru', 'projector-blank',
  'projector-mool-mantar', 'projector-focus',
  // Projector look presets
  'preset-warm', 'preset-contrast', 'preset-simple',
  // Font scale on the projector
  'font-up', 'font-down',
  // Mic / live listening
  'mic-toggle', 'mic-start', 'mic-stop',
  // Open content directly
  'open-shabad', 'open-ang',
  // Queue
  'queue-add', 'queue-open', 'queue-remove', 'queue-clear',
  'undo-open',
]);
const SUPPORTED_COMMANDS = Array.from(ALLOWED_COMMANDS);

// ── Helpers ──────────────────────────────────────────────────────────────

function cleanString(value, max = 180) {
  return String(value || '').trim().slice(0, max);
}

function makeSecretToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function hostTokenFrom(value) {
  return cleanString(value, 160);
}

const CLIENT_TOKEN_HEADER = 'x-remote-client-token';
const HOST_TOKEN_HEADER = 'x-remote-host-token';
const HOST_ID_HEADER = 'x-remote-host-id';
const KICKED_ERROR = 'This remote was removed from the session. Ask the main app to generate a new code if you need to rejoin.';
const RESET_ERROR = 'The main app generated a new code. Scan the QR code or enter the new code to pair again.';
const FOLLOW_EXPIRED_ERROR = 'Sangat View link has expired. Generate a new QR from the main app.';
// One answer for every wrong, expired or revoked code/link: no oracle.
const PAIRING_INVALID_ERROR = 'That pairing code or QR link is not valid. Check the code on the main app, or scan its QR code again.';
const PAIRING_THROTTLED_ERROR = 'Too many incorrect codes from this device. Wait a moment, or scan the QR code on the main app.';
const CODE_DEVICE_LIMIT_ERROR = 'Too many phones paired with the typed code are waiting. Scan the QR code on the main app instead.';
const APPROVAL_REQUIRED_ERROR = 'This phone was paired with a typed code, so it is view only. Ask the main app to allow control.';

/** Device secret from the header (GET /state) or the JSON body (POSTs). */
function clientTokenFrom(req) {
  return cleanString(req.get?.(CLIENT_TOKEN_HEADER) || req.body?.clientToken, 160);
}

function tokensMatch(expected, presented) {
  const a = Buffer.from(String(expected || ''));
  const b = Buffer.from(String(presented || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyHostToken(session, token) {
  return Boolean(session?.hostToken && tokensMatch(session.hostToken, hostTokenFrom(token)));
}

/**
 * Host credentials for GET endpoints come from headers; POSTs may use the
 * JSON body. Never the query string: URLs end up in request logs. The host id
 * is only an identifier, so a query value is still accepted for it.
 */
function authenticateHost(req) {
  const hostId = cleanString(
    req.get?.(HOST_ID_HEADER) || req.body?.hostId || req.body?.remoteHostId || req.query?.hostId,
    80,
  );
  const token = req.get?.(HOST_TOKEN_HEADER) || req.body?.hostToken;
  const session = hostId ? sessions.get(hostId) : null;
  return session && verifyHostToken(session, token) ? session : null;
}

function rejectHostAuth(res) {
  return res.status(403).json({ error: 'Main app session is not authorized. Refresh the main app and try again.' });
}

function sanitizeLines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_PANKTI_LINES)
    .map((line) => ({
      index: Number.isFinite(Number(line?.index)) ? Number(line.index) : -1,
      gurmukhi: String(line?.gurmukhi || '').slice(0, MAX_PANKTI_LEN),
      transliteration: String(line?.transliteration || '').slice(0, MAX_TRANSLATION_LEN),
      translationEn: String(line?.translationEn || '').slice(0, MAX_TRANSLATION_LEN),
      translationPa: String(line?.translationPa || '').slice(0, MAX_TRANSLATION_LEN),
      vishraams: Array.isArray(line?.vishraams) ? line.vishraams.slice(0, 80) : [],
    }))
    .filter((line) => line.index >= 0 && line.gurmukhi);
}

function sanitizeQueueItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_QUEUE_ITEMS)
    .map((item) => {
      const kind = cleanString(item?.kind, 24) === 'ang' ? 'ang' : 'shabad';
      const shabadId = cleanString(item?.shabadId, 80);
      const pageNo = Number.isFinite(Number(item?.pageNo)) ? Number(item.pageNo) : null;
      const id = cleanString(item?.id || shabadId || (kind === 'ang' && pageNo ? `ang:${pageNo}` : ''), 100);
      return {
        id,
        kind,
        shabadId,
        pageNo,
        source: cleanString(item?.source, 80),
        sessionId: cleanString(item?.sessionId || item?.queueSessionId, 24) === 'katha' ? 'katha' : 'kirtan',
        gurmukhi: cleanString(item?.gurmukhi || item?.displayGurmukhi || item?.mainGurmukhi, MAX_QUEUE_TEXT_LEN),
        title: cleanString(item?.title, MAX_QUEUE_TEXT_LEN),
        raag: cleanString(item?.raag, 80),
        writer: cleanString(item?.writer, 80),
      };
    })
    .filter((item) => item.id && (item.kind === 'ang' ? item.pageNo : item.shabadId));
}

function emptyState() {
  return {
    updatedAt: 0,
    contentUpdatedAt: 0,
    connected: false,
    selectedTitle: '',
    selectedMeta: '',
    viewerTitle: '',
    activeLineIndex: -1,
    activeLineText: '',
    activeLineTransliteration: '',
    activeLineTranslationEn: '',
    activeLineTranslationPa: '',
    activeLineVishraams: [],
    activeLineTotal: 0,
    viewerKind: '',
    viewerMode: '',
    currentAng: null,
    canLoadMore: false,
    shownLineCount: 0,
    projectorMode: 'idle',
    projectorView: 'idle',
    emergencyTitle: '',
    emergencyGurmukhi: '',
    emergencyTransliteration: '',
    projectorPreset: '',
    fontScale: 1,
    showTransliteration: true,
    showEnglish: true,
    showPunjabi: false,
    larivaar: false,
    micListening: false,
    queueCount: 0,
    queueItems: [],
    canUndoOpen: false,
    undoOpenLabel: '',
    surroundingLines: [],
  };
}

// ── Session store ────────────────────────────────────────────────────────

/** @type {Map<string, Session>} hostId -> session */
const sessions = new Map();
/** @type {Map<string, string>} live pairing code -> hostId */
const codeToHost = new Map();
/** @type {Map<string, string>} live pairing link token -> hostId */
const pairLinkToHost = new Map();
/** @type {Map<string, string>} followCode -> hostId */
const followCodeToHost = new Map();
/**
 * Device credential index: clientToken -> session. A device's requests are
 * resolved by its own secret, never by a pair code or a clientId binding
 * that another session could re-point.
 * @type {Map<string, Session>}
 */
const deviceTokens = new Map();
/** @type {Map<string, { reason: string, expiresAt: number }>} revoked clientToken -> why */
const revokedDevices = new Map();

function makeCode() {
  // 4 digits from a CSPRNG, unique among all live codes.
  for (let i = 0; i < 64; i += 1) {
    const code = String(crypto.randomInt(1000, 10000));
    if (!codeToHost.has(code)) return code;
  }
  const start = crypto.randomInt(0, 9000);
  for (let i = 0; i < 9000; i += 1) {
    const code = String(1000 + ((start + i) % 9000));
    if (!codeToHost.has(code)) return code;
  }
  return String(crypto.randomInt(1000, 10000)); // unreachable below ~4500 live sessions
}

const FOLLOW_CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function makeFollowCode() {
  let code = '';
  for (let attempt = 0; attempt < 64; attempt += 1) {
    code = '';
    for (let i = 0; i < 6; i += 1) code += FOLLOW_CODE_ALPHABET[crypto.randomInt(FOLLOW_CODE_ALPHABET.length)];
    if (!followCodeToHost.has(code)) break;
  }
  return code;
}

// ── Enrollment capabilities ──────────────────────────────────────────────
// session.pairCodes / session.pairLinks: [{ value, issuedAt, expiresAt }],
// newest last. Both are multi-use within their lifetime (several phones
// pair from the same screen).

function issueEntry(session, list, index, value, ttlMs, now) {
  const entry = { value, issuedAt: now, expiresAt: now + ttlMs };
  list.push(entry);
  index.set(value, session.hostId);
  return entry;
}

function pruneEntries(session, list, index, now) {
  return list.filter((entry) => {
    if (now <= entry.expiresAt) return true;
    if (index.get(entry.value) === session.hostId) index.delete(entry.value);
    return false;
  });
}

/** Drop expired codes/links and issue fresh ones when the newest is due. */
function refreshPairing(session, now = Date.now()) {
  session.pairCodes = pruneEntries(session, session.pairCodes, codeToHost, now);
  session.pairLinks = pruneEntries(session, session.pairLinks, pairLinkToHost, now);
  const code = session.pairCodes[session.pairCodes.length - 1];
  if (!code || now - code.issuedAt >= PAIR_CODE_REFRESH_MS) {
    issueEntry(session, session.pairCodes, codeToHost, makeCode(), PAIR_CODE_TTL_MS, now);
  }
  const link = session.pairLinks[session.pairLinks.length - 1];
  if (!link || now - link.issuedAt >= PAIR_LINK_REFRESH_MS) {
    issueEntry(session, session.pairLinks, pairLinkToHost, makeSecretToken(), PAIR_LINK_TTL_MS, now);
  }
}

/** Invalidate every code and link of a session at once (reset, session end). */
function revokePairing(session) {
  for (const entry of session.pairCodes) {
    if (codeToHost.get(entry.value) === session.hostId) codeToHost.delete(entry.value);
  }
  for (const entry of session.pairLinks) {
    if (pairLinkToHost.get(entry.value) === session.hostId) pairLinkToHost.delete(entry.value);
  }
  session.pairCodes = [];
  session.pairLinks = [];
}

function newestValue(list) {
  return list[list.length - 1]?.value || '';
}

function expiresInMs(list, now = Date.now()) {
  const entry = list[list.length - 1];
  return entry ? Math.max(0, entry.expiresAt - now) : 0;
}

function findSessionByLiveEntry(index, field, value, now = Date.now()) {
  const hostId = value ? index.get(value) : '';
  const session = hostId ? sessions.get(hostId) : null;
  const entry = session?.[field].find((item) => item.value === value);
  return entry && now <= entry.expiresAt ? session : null;
}

// ── Device credentials ───────────────────────────────────────────────────

function pruneRevokedDevices(now = Date.now()) {
  for (const [token, notice] of revokedDevices) {
    if (now > notice.expiresAt) revokedDevices.delete(token);
  }
}

function rememberRevoked(token, reason, now = Date.now()) {
  if (!token || !reason) return;
  revokedDevices.delete(token);
  revokedDevices.set(token, { reason, expiresAt: now + REVOKED_NOTICE_TTL_MS });
  while (revokedDevices.size > MAX_REVOKED_NOTICES) revokedDevices.delete(revokedDevices.keys().next().value);
}

/**
 * Remove a device and invalidate its credential. `reason` ('kicked',
 * 'reset', 'expired') is what a later replay of that credential is told;
 * leaving voluntarily records none.
 */
function forgetDevice(session, clientId, reason = '') {
  const client = session.clients.get(clientId);
  if (!client) return null;
  session.clients.delete(clientId);
  if (deviceTokens.get(client.token) === session) deviceTokens.delete(client.token);
  rememberRevoked(client.token, reason);
  if (session.controllerId === clientId) session.controllerId = '';
  session.controlRequests = (session.controlRequests || []).filter((r) => r.clientId !== clientId);
  return client;
}

function forgetAllDevices(session, reason) {
  for (const clientId of Array.from(session.clients.keys())) forgetDevice(session, clientId, reason);
}

function isPresent(client, now = Date.now()) {
  return Boolean(client) && now - Number(client.lastSeen || 0) <= CLIENT_TTL_MS;
}

function createSession(hostId, hostToken = '') {
  const followCode = makeFollowCode();
  const now = Date.now();
  const session = {
    hostId,
    hostToken: hostTokenFrom(hostToken) || makeSecretToken(),
    pairCodes: [],
    pairLinks: [],
    followCode,
    generatedAt: now,
    hostLastSeen: now,
    controllerId: '',
    controlRequests: [],
    clients: new Map(),
    kickedClients: new Set(),
    commands: [],
    nextCommandId: 1,
    state: emptyState(),
    sseClients: new Set(),
    stateSseClients: new Set(),
  };
  sessions.set(hostId, session);
  followCodeToHost.set(followCode, hostId);
  refreshPairing(session, now);
  return session;
}

function getOrCreateSession(hostId, hostToken = '') {
  return sessions.get(hostId) || createSession(hostId, hostToken);
}

// ── SSE subscriptions ────────────────────────────────────────────────────
// session.sseClients (host command streams) and session.stateSseClients
// (Sangat View streams) hold { res, stop, ...meta } subscriptions.

function openSseResponse(res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

function subscribe(set, req, res, meta = {}) {
  const heartbeat = setInterval(() => {
    try { res.write(': hb\n\n'); } catch { /* noop */ }
  }, SSE_HEARTBEAT_MS);
  const sub = { res, ...meta, stop: null };
  sub.stop = () => {
    clearInterval(heartbeat);
    set.delete(sub);
  };
  set.add(sub);
  req.on('close', sub.stop);
  res.on('close', sub.stop);
  res.on('error', sub.stop);
  return sub;
}

/** Server-side close: unsubscribe first so no later broadcast reaches it. */
function endSubscription(sub, finalFrame = '') {
  sub.stop();
  try {
    if (finalFrame) sub.res.write(finalFrame);
    sub.res.end();
  } catch { /* socket already gone */ }
}

const FOLLOW_REVOKED_FRAME = `retry: ${REVOKED_RETRY_MS}\nevent: revoked\ndata: ${JSON.stringify({ error: FOLLOW_EXPIRED_ERROR })}\n\n`;

/** Close every Sangat View stream of a session (code reset / session end). */
function revokeFollowStreams(session) {
  for (const sub of Array.from(session.stateSseClients)) endSubscription(sub, FOLLOW_REVOKED_FRAME);
}

// ── Host stream tickets ──────────────────────────────────────────────────
// EventSource cannot send headers, and the long-lived hostToken must not go
// in a URL. The host trades its token for a random ticket that opens exactly
// one /remote/stream connection within STREAM_TICKET_TTL_MS. A ticket is
// bound to the session object, so it dies with the session (expiry, backend
// restart) even if the same host id later creates a new session.

/** @type {Map<string, { session: object, hostToken: string, expiresAt: number }>} */
const streamTickets = new Map();

function revokeStreamTickets(session) {
  for (const [ticket, entry] of streamTickets) {
    if (entry.session === session) streamTickets.delete(ticket);
  }
}

function pruneStreamTickets(now = Date.now()) {
  for (const [ticket, entry] of streamTickets) {
    if (now > entry.expiresAt) streamTickets.delete(ticket);
  }
}

function issueStreamTicket(session) {
  const now = Date.now();
  pruneStreamTickets(now);
  // Map order is issue order: drop this session's oldest beyond the cap.
  const own = Array.from(streamTickets).filter(([, entry]) => entry.session === session);
  for (const [ticket] of own.slice(0, Math.max(0, own.length - MAX_STREAM_TICKETS_PER_SESSION + 1))) {
    streamTickets.delete(ticket);
  }
  const ticket = makeSecretToken();
  streamTickets.set(ticket, { session, hostToken: session.hostToken, expiresAt: now + STREAM_TICKET_TTL_MS });
  return ticket;
}

function redeemStreamTicket(value) {
  const ticket = cleanString(value, 160);
  const entry = ticket ? streamTickets.get(ticket) : null;
  if (!entry) return null;
  streamTickets.delete(ticket); // single use
  const { session } = entry;
  if (Date.now() > entry.expiresAt) return null;
  if (sessions.get(session.hostId) !== session) return null;
  if (!tokensMatch(session.hostToken, entry.hostToken)) return null;
  return session;
}

/** "New code": every code, QR link and the Sangat View link are replaced. */
function rotatePairing(session) {
  const now = Date.now();
  revokePairing(session);
  if (session.followCode) followCodeToHost.delete(session.followCode);
  session.followCode = makeFollowCode();
  session.generatedAt = now;
  session.kickedClients = new Set();
  followCodeToHost.set(session.followCode, session.hostId);
  refreshPairing(session, now);
  // The old Sangat View link is revoked: close streams opened with it.
  revokeFollowStreams(session);
}

function purgeSession(hostId) {
  const session = sessions.get(hostId);
  if (!session) return;
  revokePairing(session);
  if (session.followCode) followCodeToHost.delete(session.followCode);
  forgetAllDevices(session, 'expired');
  for (const sub of Array.from(session.sseClients)) endSubscription(sub);
  revokeFollowStreams(session);
  revokeStreamTickets(session);
  sessions.delete(hostId);
}

function cleanupSessions() {
  const now = Date.now();
  for (const [hostId, session] of sessions) {
    if (now - session.hostLastSeen > SESSION_GRACE_MS) {
      purgeSession(hostId);
    } else {
      session.pairCodes = pruneEntries(session, session.pairCodes, codeToHost, now);
      session.pairLinks = pruneEntries(session, session.pairLinks, pairLinkToHost, now);
    }
  }
  pruneStreamTickets(now);
  pruneRevokedDevices(now);
}

function findSessionByCode(code) {
  return findSessionByLiveEntry(codeToHost, 'pairCodes', code);
}

function findSessionByPairLink(token) {
  return findSessionByLiveEntry(pairLinkToHost, 'pairLinks', token);
}

function findSessionByFollowCode(code) {
  if (!code) return null;
  const hostId = followCodeToHost.get(code);
  if (!hostId) return null;
  return sessions.get(hostId) || null;
}

// ── Per-session helpers (operate on a passed session) ────────────────────

function cleanupSessionClients(session) {
  const now = Date.now();
  // A sleeping phone keeps its credential (it resumes without re-pairing)
  // but stops counting as present; only long idle ends the credential.
  for (const [id, client] of Array.from(session.clients.entries())) {
    if (now - Number(client.lastSeen || 0) > DEVICE_IDLE_TTL_MS) forgetDevice(session, id, 'expired');
  }
  const controller = session.controllerId ? session.clients.get(session.controllerId) : null;
  if (!controller || now - Number(controller.lastSeen || 0) > CONTROLLER_TTL_MS) {
    session.controllerId = '';
  }
  activeControlRequests(session, now);
}

function activeControlRequests(session, now = Date.now()) {
  const requests = Array.isArray(session.controlRequests) ? session.controlRequests : [];
  const filtered = requests
    .filter((request) => {
      const clientId = cleanString(request?.clientId, 80);
      const client = clientId ? session.clients.get(clientId) : null;
      if (!isPresent(client, now)) return false;
      if (session.controllerId === clientId) return false;
      return now - Number(request?.requestedAt || 0) <= CONTROL_REQUEST_TTL_MS;
    })
    .map((request) => {
      const client = session.clients.get(request.clientId);
      return {
        clientId: request.clientId,
        name: cleanString(client?.name || request.name || 'Remote device', 80),
        requestedAt: Number(request.requestedAt || now),
      };
    });
  if (filtered.length !== requests.length) session.controlRequests = filtered;
  return filtered;
}

function addControlRequest(session, clientId) {
  const id = cleanString(clientId, 80);
  const client = id ? session.clients.get(id) : null;
  if (!client) return;
  const now = Date.now();
  const rest = activeControlRequests(session, now).filter((r) => r.clientId !== id);
  session.controlRequests = [
    { clientId: id, name: client.name || 'Remote device', requestedAt: now },
    ...rest,
  ].slice(0, 5);
}

function clearControlRequests(session, clientId = '') {
  const id = cleanString(clientId, 80);
  if (!id) { session.controlRequests = []; return; }
  session.controlRequests = activeControlRequests(session).filter((r) => r.clientId !== id);
}

/**
 * Refresh a device's presence; on first enrollment mint its credential.
 * `trusted` can only be raised here (QR enrollment or approval), never
 * lowered or set from request input.
 */
function touchClient(session, clientId, patch = {}) {
  const id = cleanString(clientId, 80);
  if (!id) return null;
  const existing = session.clients.get(id);
  const client = {
    id,
    name: cleanString(patch.name || existing?.name || 'Remote device', 80),
    lastSeen: Date.now(),
    // Per-device secret, minted once when the device first joins. Never
    // included in publicSession() payloads.
    token: existing?.token || makeSecretToken(),
    trusted: Boolean(existing?.trusted || patch.trusted === true),
    enrolledVia: existing?.enrolledVia || patch.enrolledVia || 'link',
  };
  session.clients.set(id, client);
  if (!existing) deviceTokens.set(client.token, session);
  return client;
}

function publicSession(session, clientId = '', includeCode = false) {
  if (!session) return emptyPublicSession();
  cleanupSessionClients(session);
  const id = cleanString(clientId, 80);
  const client = id ? session.clients.get(id) : null;
  const controller = session.controllerId ? session.clients.get(session.controllerId) : null;
  const role = client
    ? (session.controllerId === id ? 'controller' : 'viewer')
    : 'unpaired';
  const now = Date.now();
  // Rosters list devices that are present; sleeping phones keep their
  // credential but are not shown until they check in again.
  const present = Array.from(session.clients.entries()).filter(([, item]) => isPresent(item, now));
  const viewerCount = present.filter(([idKey]) => idKey !== session.controllerId).length;
  const pendingRequests = activeControlRequests(session, now).map((r) => ({
    clientId: r.clientId,
    name: r.name,
    requestedAt: r.requestedAt,
    ageMs: Math.max(0, now - Number(r.requestedAt || now)),
  }));
  const clients = present.map(([clientKey, item]) => ({
    clientId: clientKey,
    name: cleanString(item?.name || 'Remote device', 80),
    role: session.controllerId === clientKey ? 'controller' : 'viewer',
    isController: session.controllerId === clientKey,
    trusted: Boolean(item?.trusted),
    lastSeenAgeMs: Math.max(0, now - Number(item?.lastSeen || now)),
    pendingControl: pendingRequests.some((request) => request.clientId === clientKey),
  }));
  return {
    // Host only (authenticated by hostToken): enrollment capabilities.
    ...(includeCode ? {
      code: newestValue(session.pairCodes),
      codeExpiresInMs: expiresInMs(session.pairCodes, now),
      pairToken: newestValue(session.pairLinks),
      pairTokenExpiresInMs: expiresInMs(session.pairLinks, now),
      followCode: session.followCode,
      hostToken: session.hostToken,
    } : {}),
    role,
    paired: Boolean(client),
    // false = paired with a typed code; control needs host/controller approval.
    ...(client ? { trusted: Boolean(client.trusted) } : {}),
    locked: Boolean(session.controllerId),
    hostConnected: Boolean(session.hostLastSeen && now - session.hostLastSeen <= HOST_TTL_MS),
    controllerName: controller?.name || '',
    viewerCount,
    clientCount: present.length,
    clients,
    pendingRequests,
    controlRequestCount: pendingRequests.length,
    generatedAt: session.generatedAt,
    controllerExpiresInMs: controller
      ? Math.max(0, CONTROLLER_TTL_MS - (now - Number(controller.lastSeen || 0)))
      : 0,
  };
}

function publicRemoteState(session, clientId = '', options = {}) {
  if (!session) {
    const empty = emptyState();
    return {
      ...empty,
      connected: false,
      supportedCommands: options.includeCommands ? SUPPORTED_COMMANDS : [],
      remoteSession: options.includeSession ? emptyPublicSession() : undefined,
    };
  }
  const stale = !session.state.updatedAt || Date.now() - session.state.updatedAt > 3000;
  const { contentUpdatedAt, ...publicState } = session.state;
  void contentUpdatedAt;
  const next = {
    ...publicState,
    connected: !stale,
  };
  if (options.includeCommands) next.supportedCommands = SUPPORTED_COMMANDS;
  if (options.includeSession) next.remoteSession = publicSession(session, clientId, false);
  return next;
}

function emptyPublicSession() {
  return {
    role: 'unpaired',
    paired: false,
    locked: false,
    hostConnected: false,
    controllerName: '',
    viewerCount: 0,
    clientCount: 0,
    clients: [],
    pendingRequests: [],
    controlRequestCount: 0,
    generatedAt: 0,
    controllerExpiresInMs: 0,
  };
}

/**
 * Authenticate a paired remote device by its own credential: the clientToken
 * selects the session, and the clientId must be the device that token was
 * minted for. No pair code is involved, so codes can expire or rotate without
 * dropping paired phones, and no clientId binding can be re-pointed. Any `code`
 * a device sends is ignored here.
 *
 * reason on failure: 'kicked' | 'reset' | 'expired' | 'unpaired'.
 */
function authenticateClient({ clientId, token }) {
  const id = cleanString(clientId, 80);
  const secret = cleanString(token, 160);
  if (!id || !secret) return { ok: false, reason: 'unpaired', clientId: id, session: null };
  const session = deviceTokens.get(secret);
  if (session && sessions.get(session.hostId) === session && !session.kickedClients?.has(id)) {
    cleanupSessionClients(session);
    const client = session.clients.get(id);
    if (client && tokensMatch(client.token, secret)) return { ok: true, clientId: id, session, client };
  }
  return { ok: false, reason: revokedDevices.get(secret)?.reason || 'unpaired', clientId: id, session: null };
}

function deviceAuthError(reason, unpairedError) {
  if (reason === 'kicked') return KICKED_ERROR;
  if (reason === 'reset') return RESET_ERROR;
  return unpairedError;
}

function verifyController(body = {}, token = '') {
  cleanupSessions();
  const auth = authenticateClient({ clientId: body.clientId, token });
  if (!auth.ok) {
    return {
      ok: false,
      status: 403,
      error: deviceAuthError(auth.reason, 'Remote is not paired. Enter the current remote code again.'),
      clientId: auth.clientId,
      session: null,
    };
  }
  const { session, clientId } = auth;
  const client = touchClient(session, clientId, { name: body.clientName || body.name });
  // Free control goes to trusted devices only (QR-paired or approved), so a
  // phone whose controller slept can carry on, but a typed code cannot.
  if (!session.controllerId && client.trusted) session.controllerId = clientId;
  if (session.controllerId !== clientId) {
    const controller = session.clients.get(session.controllerId);
    addControlRequest(session, clientId);
    let error = APPROVAL_REQUIRED_ERROR;
    if (controller) {
      error = controller.name
        ? `${controller.name} is controlling this session. This device is view only.`
        : 'Another remote is controlling this session. This device is view only.';
    }
    return { ok: false, status: 423, error, clientId, session };
  }
  return { ok: true, clientId, session };
}

function hasMeaningfulContent(state = {}) {
  return Boolean(
    cleanString(state.selectedTitle, 220) ||
    Number(state.activeLineTotal || 0) > 0 ||
    sanitizeLines(state.surroundingLines).length > 0
  );
}

function mergeHeartbeatState(currentState, nextState) {
  const currentHasContent = hasMeaningfulContent(currentState);
  const nextHasContent = hasMeaningfulContent(nextState);
  const contentUpdatedAt = Number(currentState.contentUpdatedAt || currentState.updatedAt || 0);
  const currentFresh = contentUpdatedAt && Date.now() - contentUpdatedAt <= REMOTE_CONTENT_TTL_MS;
  if (nextHasContent) return { ...nextState, contentUpdatedAt: nextState.updatedAt };
  if (!currentHasContent || !currentFresh) return { ...nextState, contentUpdatedAt: 0 };
  return {
    ...currentState,
    updatedAt: nextState.updatedAt,
    connected: true,
    projectorMode: nextState.projectorMode,
    projectorView: nextState.projectorView,
    emergencyTitle: nextState.emergencyTitle,
    emergencyGurmukhi: nextState.emergencyGurmukhi,
    emergencyTransliteration: nextState.emergencyTransliteration,
    projectorPreset: nextState.projectorPreset,
    fontScale: nextState.fontScale,
    showTransliteration: nextState.showTransliteration,
    showEnglish: nextState.showEnglish,
    showPunjabi: nextState.showPunjabi,
    larivaar: nextState.larivaar,
    micListening: nextState.micListening,
    queueCount: nextState.queueCount,
    queueItems: nextState.queueItems,
    canUndoOpen: nextState.canUndoOpen,
    undoOpenLabel: nextState.undoOpenLabel,
  };
}

function broadcastSseToSession(session, command) {
  if (!session?.sseClients?.size) return;
  const payload = `event: command\ndata: ${JSON.stringify(command)}\n\n`;
  for (const sub of session.sseClients) {
    try { sub.res.write(payload); } catch { /* will be cleaned up by req close handler */ }
  }
}

function broadcastStateToSession(session) {
  if (!session?.stateSseClients?.size) return;
  const payload = `event: state\ndata: ${JSON.stringify(publicRemoteState(session))}\n\n`;
  for (const sub of Array.from(session.stateSseClients)) {
    // Defense in depth: a stream opened with a follow code that is no longer
    // current never gets new state, even if a revocation path missed it.
    if (sub.followCode !== session.followCode) {
      endSubscription(sub, FOLLOW_REVOKED_FRAME);
      continue;
    }
    try { sub.res.write(payload); } catch { /* cleaned up on close */ }
  }
}

// ── HTTP handlers ────────────────────────────────────────────────────────

function postState(req, res) {
  cleanupSessions();
  const body = req.body || {};
  const hostId = cleanString(body.remoteHostId, 80);
  const hostToken = hostTokenFrom(body.hostToken);
  if (!hostId) {
    return res.status(400).json({ error: 'Missing main app id.' });
  }
  const existing = sessions.get(hostId);
  if (existing && !verifyHostToken(existing, hostToken)) {
    return rejectHostAuth(res);
  }
  const session = existing || getOrCreateSession(hostId, hostToken);
  session.hostLastSeen = Date.now();

  const nextState = {
    updatedAt: Date.now(),
    connected: true,
    selectedTitle: cleanString(body.selectedTitle, 220),
    selectedMeta: cleanString(body.selectedMeta, 220),
    viewerTitle: cleanString(body.viewerTitle, 220),
    activeLineIndex: Number.isFinite(Number(body.activeLineIndex)) ? Number(body.activeLineIndex) : -1,
    activeLineText: cleanString(body.activeLineText, 260),
    activeLineTransliteration: cleanString(body.activeLineTransliteration, MAX_TRANSLATION_LEN),
    activeLineTranslationEn: cleanString(body.activeLineTranslationEn, MAX_TRANSLATION_LEN),
    activeLineTranslationPa: cleanString(body.activeLineTranslationPa, MAX_TRANSLATION_LEN),
    activeLineVishraams: Array.isArray(body.activeLineVishraams) ? body.activeLineVishraams.slice(0, 80) : [],
    activeLineTotal: Number.isFinite(Number(body.activeLineTotal)) ? Number(body.activeLineTotal) : 0,
    viewerKind: cleanString(body.viewerKind, 40),
    viewerMode: cleanString(body.viewerMode, 60),
    currentAng: Number.isFinite(Number(body.currentAng)) ? Number(body.currentAng) : null,
    canLoadMore: Boolean(body.canLoadMore),
    shownLineCount: Number.isFinite(Number(body.shownLineCount)) ? Number(body.shownLineCount) : 0,
    hasPreviousShabad: Boolean(body.hasPreviousShabad),
    hasNextShabad: Boolean(body.hasNextShabad),
    hasPreviousAng: Boolean(body.hasPreviousAng),
    hasNextAng: Boolean(body.hasNextAng),
    projectorMode: cleanString(body.projectorMode, 60) || 'idle',
    projectorView: cleanString(body.projectorView, 60) || 'idle',
    emergencyTitle: cleanString(body.emergencyTitle, 180),
    emergencyGurmukhi: cleanString(body.emergencyGurmukhi, MAX_PANKTI_LEN),
    emergencyTransliteration: cleanString(body.emergencyTransliteration, MAX_TRANSLATION_LEN),
    projectorPreset: cleanString(body.projectorPreset, 60),
    fontScale: Number.isFinite(Number(body.fontScale)) ? Number(body.fontScale) : 1,
    showTransliteration: body.showTransliteration !== false,
    showEnglish: body.showEnglish !== false,
    showPunjabi: Boolean(body.showPunjabi),
    larivaar: Boolean(body.larivaar),
    micListening: Boolean(body.micListening),
    queueCount: Number.isFinite(Number(body.queueCount)) ? Number(body.queueCount) : 0,
    queueItems: sanitizeQueueItems(body.queueItems),
    canUndoOpen: Boolean(body.canUndoOpen),
    undoOpenLabel: cleanString(body.undoOpenLabel, 180),
    surroundingLines: sanitizeLines(body.surroundingLines),
  };
  session.state = mergeHeartbeatState(session.state, nextState);
  broadcastStateToSession(session);
  // The host's publish loop (every second) keeps its displayed code and QR
  // link fresh; expired ones stop working whether or not they are replaced.
  refreshPairing(session);

  // Return the host's OWN session info, including the enrollment
  // capabilities (only the host sees them, via this endpoint).
  res.json({ ok: true, session: publicSession(session, '', true) });
}

function getState(req, res) {
  cleanupSessions();
  const clientId = cleanString(req.query?.clientId, 80);
  // `code` here is a Sangat View follow code (read-only), never a pair code.
  const code = cleanString(req.query?.code, 24);
  const presentedToken = clientTokenFrom(req);
  const auth = clientId ? authenticateClient({ clientId, token: presentedToken }) : null;
  const session = auth?.ok ? auth.session : findSessionByFollowCode(code);
  if (!session) {
    const empty = publicRemoteState(null, '', { includeCommands: true, includeSession: true });
    // A device whose credential stopped working learns why (only the holder
    // of that credential can ask), so it can drop it and pair again.
    if (auth && !auth.ok && presentedToken) {
      empty.remoteSession.error = deviceAuthError(
        auth.reason,
        'Remote pairing ended. Scan the QR code or enter the code from the main app.',
      );
    }
    return res.json(empty);
  }
  res.json(publicRemoteState(session, auth?.ok ? clientId : '', {
    includeCommands: true,
    includeSession: Boolean(auth?.ok),
  }));
}

function getFollowState(req, res) {
  cleanupSessions();
  const code = cleanString(req.params?.code || req.query?.code, 24);
  const session = findSessionByFollowCode(code);
  if (!session) {
    return res.status(404).json({ error: 'Sangat View link has expired. Generate a new QR from the main app.' });
  }
  return res.json(publicRemoteState(session));
}

function postCommand(req, res) {
  cleanupSessions();
  const type = cleanString(req.body?.type, 60);
  if (!ALLOWED_COMMANDS.has(type)) {
    return res.status(400).json({ error: 'Unsupported remote command.' });
  }
  const auth = verifyController(req.body || {}, clientTokenFrom(req));
  if (!auth.ok) {
    return res.status(auth.status).json({
      error: auth.error,
      session: publicSession(auth.session, auth.clientId),
    });
  }

  const session = auth.session;
  const command = {
    id: session.nextCommandId,
    type,
    payload: req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {},
    createdAt: Date.now(),
  };
  session.nextCommandId += 1;
  session.commands.push(command);
  while (session.commands.length > MAX_COMMANDS) session.commands.shift();

  broadcastSseToSession(session, command);
  return res.json({ ok: true, command });
}

/** Host polling. Needs X-Remote-Host-Id + X-Remote-Host-Token headers. */
function getCommands(req, res) {
  cleanupSessions();
  const session = authenticateHost(req);
  if (!session) return rejectHostAuth(res);
  const after = Number(req.query?.after || 0) || 0;
  res.json({
    commands: session.commands.filter((c) => c.id > after),
    latestId: session.commands[session.commands.length - 1]?.id || after,
  });
}

/** Host trades its token for a single-use ticket to open /remote/stream. */
function createStreamTicket(req, res) {
  cleanupSessions();
  const session = authenticateHost(req);
  if (!session) return rejectHostAuth(res);
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, ticket: issueStreamTicket(session), expiresInMs: STREAM_TICKET_TTL_MS });
}

function streamCommands(req, res) {
  cleanupSessions();
  // The ticket alone selects the session; any hostId in the URL is ignored.
  const session = redeemStreamTicket(req.query?.ticket);
  if (!session) {
    // A non-200 answer makes EventSource stop instead of replaying a used
    // ticket; the main app falls back to polling and asks for a new ticket.
    return rejectHostAuth(res);
  }

  openSseResponse(res);
  const after = Number(req.query?.after || 0) || 0;
  const backlog = session.commands.filter((c) => c.id > after);
  for (const c of backlog) {
    res.write(`event: command\ndata: ${JSON.stringify(c)}\n\n`);
  }
  res.write(`event: cursor\ndata: ${JSON.stringify({ latestId: session.commands[session.commands.length - 1]?.id || 0 })}\n\n`);
  subscribe(session.sseClients, req, res);
}

function streamFollowState(req, res) {
  openSseResponse(res);
  cleanupSessions();
  const code = cleanString(req.query?.code || req.params?.code, 24);
  const session = findSessionByFollowCode(code);
  if (!session) {
    // Unknown, reset or expired link. `revoked` tells Sangat View to stop
    // reconnecting; a revoked code never maps to a session again.
    res.write(FOLLOW_REVOKED_FRAME);
    res.end();
    return;
  }

  res.write(`event: state\ndata: ${JSON.stringify(publicRemoteState(session))}\n\n`);
  // Remember which link opened the stream so a later code rotation can
  // revoke it (see revokeFollowStreams / broadcastStateToSession).
  subscribe(session.stateSseClients, req, res, { followCode: session.followCode });
}

// ── Typed-code guessing budget ───────────────────────────────────────────
// Wrong typed codes are counted per request source (token bucket). With
// `trust proxy` limited to a loopback proxy (middleware/security.js), each
// phone behind the local Vite proxy is its own source and a LAN client
// cannot spoof X-Forwarded-For. Behind a proxy that does not forward the
// client address everyone shares one budget: typed codes can then be slowed
// for all of them, but QR pairing and already-paired devices never are.
// The budget is a speed bump, not the security boundary: a typed code only
// ever yields a view-only device.

/** @type {Map<string, { tokens: number, updatedAt: number }>} */
const pairingBudgets = new Map();

function pairingSource(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function pairingBudget(source, now) {
  const bucket = pairingBudgets.get(source);
  if (!bucket) return { tokens: PAIR_FAILURE_BURST, updatedAt: now };
  const refill = Math.max(0, now - bucket.updatedAt) / PAIR_FAILURE_REFILL_MS;
  return { tokens: Math.min(PAIR_FAILURE_BURST, bucket.tokens + refill), updatedAt: now };
}

/** ms until this source may try a typed code again (0 = now). */
function pairingRetryAfterMs(source, now = Date.now()) {
  const { tokens } = pairingBudget(source, now);
  return tokens >= 1 ? 0 : Math.ceil((1 - tokens) * PAIR_FAILURE_REFILL_MS);
}

function recordPairingFailure(source, now = Date.now()) {
  const bucket = pairingBudget(source, now);
  bucket.tokens = Math.max(0, bucket.tokens - 1);
  pairingBudgets.delete(source); // keep Map order = least recently failed first
  pairingBudgets.set(source, bucket);
  while (pairingBudgets.size > MAX_PAIRING_SOURCES) pairingBudgets.delete(pairingBudgets.keys().next().value);
}

function codeDevicesPresent(session, now = Date.now()) {
  let count = 0;
  for (const client of session.clients.values()) {
    if (!client.trusted && isPresent(client, now)) count += 1;
  }
  return count;
}

function enrollDevice(req, res, session, { clientId, name, trusted, via }) {
  if (session.kickedClients?.has(clientId)) {
    return res.status(403).json({ error: KICKED_ERROR });
  }
  cleanupSessionClients(session);
  // A device already in the session may only re-join (page reload, second
  // tab) with its own secret. Otherwise any viewer could join under the
  // controller's visible clientId and be handed its identity.
  const existing = session.clients.get(clientId);
  if (existing && !tokensMatch(existing.token, clientTokenFrom(req))) {
    return res.status(409).json({
      error: 'This remote ID is already paired in this session. Close other remote tabs, wait a minute, then pair again.',
    });
  }
  if (!existing && !trusted && codeDevicesPresent(session) >= MAX_CODE_DEVICES_PER_SESSION) {
    return res.status(429).json({ error: CODE_DEVICE_LIMIT_ERROR });
  }
  const client = touchClient(session, clientId, { name, trusted, enrolledVia: via });
  if (client.trusted && !session.controllerId) session.controllerId = clientId;
  return res.json({ ok: true, clientToken: client.token, session: publicSession(session, clientId) });
}

/** An enrolled device re-joining with its own credential keeps its rights. */
function resumeDevice(res, auth, name) {
  const { session, clientId } = auth;
  const client = touchClient(session, clientId, { name });
  if (client.trusted && !session.controllerId) session.controllerId = clientId;
  return res.json({ ok: true, clientToken: client.token, session: publicSession(session, clientId) });
}

/**
 * Enrollment. `pairToken` (QR link) enrolls a trusted device; `code` (typed)
 * enrolls a view-only device and is throttled per source. Without either, or
 * when they no longer work, a device that presents its own valid credential
 * resumes its session (reload, older remote pages re-sending a stale code).
 * Wrong, expired and revoked capabilities all get the same answer.
 */
function joinSession(req, res) {
  cleanupSessions();
  const clientId = cleanString(req.body?.clientId, 80);
  if (!clientId) return res.status(400).json({ error: 'Missing remote client id.' });
  const name = req.body?.name || req.body?.clientName;
  const pairToken = cleanString(req.body?.pairToken, 160);
  const code = cleanString(req.body?.code, 12);
  const device = authenticateClient({ clientId, token: clientTokenFrom(req) });

  if (pairToken) {
    const session = findSessionByPairLink(pairToken);
    if (session) return enrollDevice(req, res, session, { clientId, name, trusted: true, via: 'link' });
    if (device.ok) return resumeDevice(res, device, name);
    return res.status(403).json({ error: PAIRING_INVALID_ERROR });
  }

  if (code) {
    const source = pairingSource(req);
    const retryAfterMs = pairingRetryAfterMs(source);
    if (retryAfterMs > 0) {
      // Out of budget: the code is not looked at, so guessing stops here.
      if (device.ok) return resumeDevice(res, device, name);
      res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({ error: PAIRING_THROTTLED_ERROR });
    }
    const session = findSessionByCode(code);
    if (session) return enrollDevice(req, res, session, { clientId, name, trusted: false, via: 'code' });
    // Counted even for enrolled devices, so a credential is no way around it.
    recordPairingFailure(source);
    if (device.ok) return resumeDevice(res, device, name);
    return res.status(403).json({ error: PAIRING_INVALID_ERROR });
  }

  if (device.ok) return resumeDevice(res, device, name);
  return res.status(403).json({ error: PAIRING_INVALID_ERROR });
}

/** Shared auth for heartbeat / claim / release; sends the 403 itself. */
function requirePairedClient(req, res, unpairedError) {
  const auth = authenticateClient({ clientId: req.body?.clientId, token: clientTokenFrom(req) });
  if (!auth.ok) {
    res.status(403).json({
      error: auth.reason === 'kicked'
        ? 'This remote was removed from the session.'
        : deviceAuthError(auth.reason, unpairedError),
    });
  }
  return auth;
}

function heartbeat(req, res) {
  cleanupSessions();
  const auth = requirePairedClient(req, res, 'Remote session expired. Pair again.');
  if (!auth.ok) return undefined;
  const { session, clientId } = auth;
  touchClient(session, clientId, { name: req.body?.name || req.body?.clientName });
  return res.json({ ok: true, session: publicSession(session, clientId) });
}

function claimControl(req, res) {
  cleanupSessions();
  const auth = requirePairedClient(req, res, 'Pair this remote before taking control.');
  if (!auth.ok) return undefined;
  const { session, clientId } = auth;
  const client = touchClient(session, clientId, { name: req.body?.name || req.body?.clientName });
  if (session.controllerId && session.controllerId !== clientId) {
    addControlRequest(session, clientId);
    const controller = session.clients.get(session.controllerId);
    return res.status(409).json({
      error: controller?.name
        ? `${controller.name} is still controlling this session.`
        : 'Another remote is still controlling this session.',
      session: publicSession(session, clientId),
    });
  }
  if (!client.trusted) {
    // Free control is not free for a typed-code device: ask for approval.
    addControlRequest(session, clientId);
    return res.status(409).json({ error: APPROVAL_REQUIRED_ERROR, session: publicSession(session, clientId) });
  }
  session.controllerId = clientId;
  clearControlRequests(session, clientId);
  return res.json({ ok: true, session: publicSession(session, clientId) });
}

function releaseControl(req, res) {
  cleanupSessions();
  const auth = requirePairedClient(req, res, 'Remote session expired. Pair again.');
  if (!auth.ok) return undefined;
  const { session, clientId } = auth;
  touchClient(session, clientId, { name: req.body?.name || req.body?.clientName });
  if (session.controllerId === clientId) session.controllerId = '';
  clearControlRequests(session, clientId);
  return res.json({ ok: true, session: publicSession(session, clientId) });
}

function grantControl(req, res) {
  cleanupSessions();
  const targetClientId = cleanString(req.body?.targetClientId, 80);
  // Only two approvers exist: the main app (hostToken) and the current
  // controller (its own device credential). Approval also marks the target
  // trusted, so it may take free control later without asking again.
  const hostId = cleanString(req.body?.hostId || req.body?.remoteHostId, 80);
  const hostSession = hostId ? sessions.get(hostId) : null;
  const isHostApproval = Boolean(hostSession && verifyHostToken(hostSession, req.body?.hostToken));
  const approver = isHostApproval ? null : authenticateClient({ clientId: req.body?.clientId, token: clientTokenFrom(req) });
  const session = isHostApproval ? hostSession : (approver?.ok ? approver.session : null);
  const approverClientId = approver?.ok ? approver.clientId : '';
  const isControllerApproval = Boolean(session && approverClientId && session.controllerId === approverClientId);
  if (!isHostApproval && !isControllerApproval) {
    return res.status(403).json({
      error: 'Only the main app or current controller can approve control.',
      session: approverClientId ? publicSession(session, approverClientId) : emptyPublicSession(),
    });
  }
  cleanupSessionClients(session);

  const targetClient = targetClientId ? session.clients.get(targetClientId) : null;
  if (!targetClient) {
    return res.status(404).json({ error: 'That remote is no longer connected.' });
  }
  const requests = activeControlRequests(session);
  const hasRequest = requests.some((r) => r.clientId === targetClientId);
  if (!hasRequest) {
    return res.status(404).json({ error: 'That control request has expired.' });
  }
  if (isControllerApproval) {
    touchClient(session, approverClientId, { name: req.body?.name || req.body?.clientName });
  }
  targetClient.trusted = true;
  session.controllerId = targetClientId;
  clearControlRequests(session, targetClientId);
  return res.json({
    ok: true,
    session: publicSession(session, isControllerApproval ? approverClientId : '', isHostApproval),
    grantedTo: {
      clientId: targetClientId,
      name: targetClient.name || 'Remote device',
    },
  });
}

/**
 * Phone explicitly wants to forget its pairing — drop it and its credential
 * so the next /state poll returns "unpaired". Used by the "Pair another code"
 * button on the remote page. Only the device itself (clientToken) can leave;
 * a bare clientId must not disconnect someone else's remote.
 */
function leaveSession(req, res) {
  cleanupSessions();
  const clientId = cleanString(req.body?.clientId, 80);
  if (!clientId) return res.status(400).json({ error: 'Missing remote client id.' });
  const auth = authenticateClient({ clientId, token: clientTokenFrom(req) });
  if (!auth.ok) {
    return res.status(403).json({ error: 'Remote is not paired with this session.' });
  }
  forgetDevice(auth.session, clientId);
  return res.json({ ok: true });
}

function kickClient(req, res) {
  cleanupSessions();
  const hostId = cleanString(req.body?.hostId || req.body?.remoteHostId, 80);
  const hostToken = hostTokenFrom(req.body?.hostToken);
  const targetClientId = cleanString(req.body?.targetClientId || req.body?.clientId, 80);
  if (!hostId) return res.status(400).json({ error: 'Missing main app id.' });
  if (!targetClientId) return res.status(400).json({ error: 'Missing remote device.' });
  const session = sessions.get(hostId);
  if (!session) return res.status(404).json({ error: 'Remote session is not connected.' });
  if (!verifyHostToken(session, hostToken)) return rejectHostAuth(res);

  const target = forgetDevice(session, targetClientId, 'kicked');
  session.kickedClients?.add(targetClientId);

  return res.json({
    ok: true,
    removed: {
      clientId: targetClientId,
      name: target?.name || 'Remote device',
    },
    session: publicSession(session, '', true),
  });
}

function resetSession(req, res) {
  cleanupSessions();
  const hostId = cleanString(req.body?.hostId || req.body?.remoteHostId, 80);
  const hostToken = hostTokenFrom(req.body?.hostToken);
  if (!hostId) {
    return res.status(400).json({ error: 'Missing main app id.' });
  }
  const session = sessions.get(hostId);
  if (!session) {
    // No session yet for this host — create one so the host has a code to
    // share. This also means a brand-new main app pressing "New code"
    // before its first state publish gets a fresh session.
    const fresh = createSession(hostId, hostToken);
    return res.json({ ok: true, session: publicSession(fresh, '', true) });
  }
  if (!verifyHostToken(session, hostToken)) return rejectHostAuth(res);
  // "New code": revoke every paired device credential, pairing code, QR
  // link and the Sangat View link (rotatePairing also closes Sangat View
  // streams on the old link). Unused stream tickets are dropped; the host's
  // own open command stream stays connected. Only this host is affected.
  forgetAllDevices(session, 'reset');
  rotatePairing(session);
  revokeStreamTickets(session);
  session.controllerId = '';
  session.controlRequests = [];
  session.commands = [];
  session.nextCommandId = 1;
  return res.json({ ok: true, session: publicSession(session, '', true) });
}

module.exports = {
  postCommand,
  getCommands,
  createStreamTicket,
  streamCommands,
  postState,
  getState,
  getFollowState,
  streamFollowState,
  joinSession,
  leaveSession,
  kickClient,
  heartbeat,
  claimControl,
  releaseControl,
  grantControl,
  resetSession,
};
