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
 *   - joinSession : phone enters a code. We find the matching session, bind
 *     its clientId, and return a per-device secret (clientToken).
 *   - postCommand / heartbeat / claim / release / grant / leave / getState :
 *     the phone proves its identity with clientId + clientToken. A clientId
 *     alone is never enough: every paired device can see the other devices'
 *     ids in the session roster.
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
const CLIENT_TTL_MS = 45_000;
const CONTROLLER_TTL_MS = 30_000;
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
const FOLLOW_EXPIRED_ERROR = 'Sangat View link has expired. Generate a new QR from the main app.';

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
/** @type {Map<string, string>} code -> hostId */
const codeToHost = new Map();
/** @type {Map<string, string>} followCode -> hostId */
const followCodeToHost = new Map();
/** @type {Map<string, string>} clientId -> hostId */
const clientToHost = new Map();

function makeCode() {
  // 4-digit numeric. Retry until we find one not already in use.
  for (let i = 0; i < 64; i += 1) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!codeToHost.has(code)) return code;
  }
  // Fallback: collision-tolerant 6 digits.
  return String(Math.floor(100000 + Math.random() * 900000));
}

function makeFollowCode() {
  for (let i = 0; i < 64; i += 1) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    if (code.length >= 6 && !followCodeToHost.has(code)) return code;
  }
  return `${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

function createSession(hostId, hostToken = '') {
  const code = makeCode();
  const followCode = makeFollowCode();
  const now = Date.now();
  const session = {
    hostId,
    hostToken: hostTokenFrom(hostToken) || makeSecretToken(),
    code,
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
  codeToHost.set(code, hostId);
  followCodeToHost.set(followCode, hostId);
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

function rotateCode(session) {
  if (session.code) codeToHost.delete(session.code);
  if (session.followCode) followCodeToHost.delete(session.followCode);
  session.code = makeCode();
  session.followCode = makeFollowCode();
  session.generatedAt = Date.now();
  session.kickedClients = new Set();
  codeToHost.set(session.code, session.hostId);
  followCodeToHost.set(session.followCode, session.hostId);
  // The old Sangat View link is revoked: close streams opened with it.
  revokeFollowStreams(session);
}

function purgeSession(hostId) {
  const session = sessions.get(hostId);
  if (!session) return;
  if (session.code) codeToHost.delete(session.code);
  if (session.followCode) followCodeToHost.delete(session.followCode);
  for (const clientId of session.clients.keys()) {
    if (clientToHost.get(clientId) === hostId) clientToHost.delete(clientId);
  }
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
    }
  }
  pruneStreamTickets(now);
}

function findSessionByClientId(clientId) {
  if (!clientId) return null;
  const hostId = clientToHost.get(clientId);
  if (!hostId) return null;
  return sessions.get(hostId) || null;
}

function findSessionByCode(code) {
  if (!code) return null;
  const hostId = codeToHost.get(code);
  if (!hostId) return null;
  return sessions.get(hostId) || null;
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
  for (const [id, client] of session.clients.entries()) {
    if (now - Number(client.lastSeen || 0) > CLIENT_TTL_MS) {
      session.clients.delete(id);
      if (clientToHost.get(id) === session.hostId) clientToHost.delete(id);
    }
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
      if (!client) return false;
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

function touchClient(session, clientId, patch = {}) {
  const id = cleanString(clientId, 80);
  if (!id) return null;
  const existing = session.clients.get(id) || {};
  const client = {
    id,
    name: cleanString(patch.name || existing.name || 'Remote device', 80),
    lastSeen: Date.now(),
    // Per-device secret, minted once when the device first joins. Never
    // included in publicSession() payloads.
    token: existing.token || makeSecretToken(),
  };
  session.clients.set(id, client);
  clientToHost.set(id, session.hostId);
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
  const viewerCount = Array.from(session.clients.entries())
    .filter(([idKey]) => idKey !== session.controllerId)
    .length;
  const now = Date.now();
  const pendingRequests = activeControlRequests(session, now).map((r) => ({
    clientId: r.clientId,
    name: r.name,
    requestedAt: r.requestedAt,
    ageMs: Math.max(0, now - Number(r.requestedAt || now)),
  }));
  const clients = Array.from(session.clients.entries()).map(([clientKey, item]) => ({
    clientId: clientKey,
    name: cleanString(item?.name || 'Remote device', 80),
    role: session.controllerId === clientKey ? 'controller' : 'viewer',
    isController: session.controllerId === clientKey,
    lastSeenAgeMs: Math.max(0, now - Number(item?.lastSeen || now)),
    pendingControl: pendingRequests.some((request) => request.clientId === clientKey),
  }));
  return {
    ...(includeCode ? { code: session.code, followCode: session.followCode, hostToken: session.hostToken } : {}),
    role,
    paired: Boolean(client),
    locked: Boolean(session.controllerId),
    hostConnected: Boolean(session.hostLastSeen && now - session.hostLastSeen <= HOST_TTL_MS),
    controllerName: controller?.name || '',
    viewerCount,
    clientCount: session.clients.size,
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
 * Authenticate a paired remote device: it must be a current member of the
 * session and present the clientToken minted for it by /join.
 *
 * With requireCode (default) the session is the one matching the current pair
 * code. Without it (getState, leave) the device's own clientId binding is
 * also tried, so a device whose local code was cleared can still read state
 * or leave. Resolving by code first means a clientId binding that someone
 * else re-pointed cannot redirect an authenticated device.
 */
function authenticateClient({ clientId, code, token }, { requireCode = true } = {}) {
  const id = cleanString(clientId, 80);
  const pairCode = cleanString(code, 12);
  if (!id) return { ok: false, reason: 'unpaired', clientId: id, session: null };
  const byCode = findSessionByCode(pairCode);
  const candidates = requireCode ? [byCode] : [byCode, findSessionByClientId(id)];
  let kicked = false;
  for (const session of candidates) {
    if (!session) continue;
    if (session.kickedClients?.has(id)) { kicked = true; continue; }
    cleanupSessionClients(session);
    const client = session.clients.get(id);
    if (client && tokensMatch(client.token, token)) return { ok: true, clientId: id, session, client };
  }
  return { ok: false, reason: kicked ? 'kicked' : 'unpaired', clientId: id, session: null };
}

function verifyController(body = {}, token = '') {
  cleanupSessions();
  const auth = authenticateClient({ clientId: body.clientId, code: body.code, token });
  if (!auth.ok) {
    return {
      ok: false,
      status: 403,
      error: auth.reason === 'kicked'
        ? KICKED_ERROR
        : 'Remote is not paired. Enter the current remote code again.',
      clientId: auth.clientId,
      session: null,
    };
  }
  const { session, clientId } = auth;
  touchClient(session, clientId, { name: body.clientName || body.name });
  if (!session.controllerId) session.controllerId = clientId;
  if (session.controllerId !== clientId) {
    const controller = session.clients.get(session.controllerId);
    addControlRequest(session, clientId);
    return {
      ok: false,
      status: 423,
      error: controller?.name
        ? `${controller.name} is controlling this session. This device is view only.`
        : 'Another remote is controlling this session. This device is view only.',
      clientId,
      session,
    };
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

  // Return the host's OWN session info, including the code (only the host
  // sees the code via this endpoint).
  res.json({ ok: true, session: publicSession(session, '', true) });
}

function getState(req, res) {
  cleanupSessions();
  const clientId = cleanString(req.query?.clientId, 80);
  const code = cleanString(req.query?.code, 24);
  const auth = clientId
    ? authenticateClient(
      { clientId, code: req.query?.pairCode, token: clientTokenFrom(req) },
      { requireCode: false },
    )
    : null;
  const session = auth?.ok ? auth.session : findSessionByFollowCode(code);
  if (!session) {
    return res.json(publicRemoteState(null, '', { includeCommands: true, includeSession: true }));
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

function joinSession(req, res) {
  cleanupSessions();
  const code = cleanString(req.body?.code, 12);
  const clientId = cleanString(req.body?.clientId, 80);
  if (!clientId) return res.status(400).json({ error: 'Missing remote client id.' });

  const session = findSessionByCode(code);
  if (!session) {
    return res.status(403).json({ error: 'Wrong remote code. Check the main app and try again.' });
  }
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
  const client = touchClient(session, clientId, { name: req.body?.name || req.body?.clientName });
  if (!session.controllerId) session.controllerId = clientId;
  return res.json({ ok: true, clientToken: client.token, session: publicSession(session, clientId) });
}

/** Shared auth for heartbeat / claim / release; sends the 403 itself. */
function requirePairedClient(req, res, unpairedError) {
  const auth = authenticateClient({
    clientId: req.body?.clientId,
    code: req.body?.code,
    token: clientTokenFrom(req),
  });
  if (!auth.ok) {
    res.status(403).json({
      error: auth.reason === 'kicked' ? 'This remote was removed from the session.' : unpairedError,
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
  if (session.controllerId && session.controllerId !== clientId) {
    touchClient(session, clientId, { name: req.body?.name || req.body?.clientName });
    addControlRequest(session, clientId);
    const controller = session.clients.get(session.controllerId);
    return res.status(409).json({
      error: controller?.name
        ? `${controller.name} is still controlling this session.`
        : 'Another remote is still controlling this session.',
      session: publicSession(session, clientId),
    });
  }
  touchClient(session, clientId, { name: req.body?.name || req.body?.clientName });
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
  // Determine which session to operate on. Prefer hostId (host approval),
  // otherwise fall back to clientId (controller approval).
  const hostId = cleanString(req.body?.hostId || req.body?.remoteHostId, 80);
  const hostToken = hostTokenFrom(req.body?.hostToken);
  const approverClientId = cleanString(req.body?.clientId, 80);
  const code = cleanString(req.body?.code, 12);
  const session = (hostId && sessions.get(hostId))
    || findSessionByCode(code)
    || findSessionByClientId(approverClientId);
  if (!session) {
    return res.status(404).json({ error: 'That session is no longer connected.' });
  }
  cleanupSessionClients(session);

  const isHostApproval = Boolean(hostId && session.hostId === hostId && verifyHostToken(session, hostToken));
  const approverAuthenticated = Boolean(
    approverClientId &&
    code === session.code &&
    !session.kickedClients?.has(approverClientId) &&
    tokensMatch(session.clients.get(approverClientId)?.token, clientTokenFrom(req))
  );
  const isControllerApproval = approverAuthenticated && session.controllerId === approverClientId;
  if (!isHostApproval && !isControllerApproval) {
    return res.status(403).json({
      error: 'Only the main app or current controller can approve control.',
      session: approverAuthenticated ? publicSession(session, approverClientId) : emptyPublicSession(),
    });
  }

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
 * Phone explicitly wants to forget its pairing — drop it from the session
 * and from clientToHost so the next /state poll returns "unpaired" instead
 * of the stale binding we'd otherwise hand back. Used by the "Pair another
 * code" button on the remote page. Only the device itself (clientToken) can
 * leave; a bare clientId must not disconnect someone else's remote.
 */
function leaveSession(req, res) {
  cleanupSessions();
  const clientId = cleanString(req.body?.clientId, 80);
  if (!clientId) return res.status(400).json({ error: 'Missing remote client id.' });
  const auth = authenticateClient(
    { clientId, code: req.body?.code, token: clientTokenFrom(req) },
    { requireCode: false },
  );
  if (!auth.ok) {
    return res.status(403).json({ error: 'Remote is not paired with this session.' });
  }
  const { session } = auth;
  if (session.controllerId === clientId) session.controllerId = '';
  session.clients.delete(clientId);
  clearControlRequests(session, clientId);
  if (clientToHost.get(clientId) === session.hostId) clientToHost.delete(clientId);
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

  const target = session.clients.get(targetClientId);
  session.kickedClients?.add(targetClientId);
  if (session.controllerId === targetClientId) session.controllerId = '';
  session.clients.delete(targetClientId);
  clearControlRequests(session, targetClientId);
  if (clientToHost.get(targetClientId) === hostId) clientToHost.delete(targetClientId);

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
  // Rotate the code, drop all paired clients (they need to re-pair with
  // the new code). Only this host's session is affected. rotateCode also
  // closes Sangat View streams on the old link. Unused stream tickets are
  // dropped; the host's own open command stream stays connected.
  rotateCode(session);
  revokeStreamTickets(session);
  for (const clientId of session.clients.keys()) {
    if (clientToHost.get(clientId) === session.hostId) clientToHost.delete(clientId);
  }
  session.clients.clear();
  session.kickedClients = new Set();
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
