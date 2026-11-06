/**
 * Centralised API client. All HTTP traffic to the backend goes through here.
 * Every method returns plain data so React components don't deal with axios.
 */
import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || '/api';

const http = axios.create({
  baseURL,
  timeout: 45_000,
  headers: { Accept: 'application/json' },
});

const CACHE_PREFIX = 'saanj-kirtan.api-cache.';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function cacheKey(parts) {
  return `${CACHE_PREFIX}${parts.filter((p) => p != null && p !== '').join(':')}`;
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.ts || Date.now() - cached.ts > CACHE_TTL_MS) return null;
    return { ...cached.data, __offline: true };
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Storage can fill up during long use. Keep the live request working.
  }
}

async function withCache(key, request) {
  try {
    const data = await request();
    writeCache(key, data);
    return data;
  } catch (err) {
    const cached = readCache(key);
    if (cached) return cached;
    throw err;
  }
}

// Light retry on network blips (not on 4xx/5xx)
http.interceptors.response.use(
  (r) => r,
  async (err) => {
    if (!err.config || err.config.__retried) return Promise.reject(err);
    if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED') {
      err.config.__retried = true;
      await new Promise((r) => setTimeout(r, 600));
      return http.request(err.config);
    }
    return Promise.reject(err);
  }
);

export const api = {
  health() {
    return http.get('/health', { timeout: 4000 }).then((r) => r.data);
  },

  // Search ----------------------------------------------------------------
  searchShabads(params) {
    return http.get('/shabads/search', { params }).then((r) => r.data);
  },
  getShabad(shabadId) {
    const key = cacheKey(['shabad', shabadId]);
    return withCache(key, () =>
      http.get(`/shabads/${encodeURIComponent(shabadId)}`).then((r) => r.data)
    );
  },
  getAng(ang, params = {}) {
    const key = cacheKey(['ang', ang, params.source || '', params.seedShabadId || params.seed || '']);
    return withCache(key, () =>
      http.get(`/shabads/ang/${encodeURIComponent(ang)}`, { params }).then((r) => r.data)
    );
  },
  getBaniById(baniId) {
    const key = cacheKey(['bani', baniId]);
    return withCache(key, () =>
      http.get(`/banis/${encodeURIComponent(baniId)}`).then((r) => r.data)
    );
  },
  getDailyHukam() {
    // Bucket the cache by Gregorian date so a fresh Hukam loads after midnight.
    const today = new Date().toISOString().slice(0, 10);
    const key = cacheKey(['hukam', today]);
    return withCache(key, () => http.get('/hukamnamas/today').then((r) => r.data));
  },

  // Voice / matching ------------------------------------------------------
  suggestShabads(transcript, filters = {}) {
    return http.post('/voice/suggest', { transcript, ...filters }).then((r) => r.data);
  },
  trackLine(shabadId, transcript, verses, currentLine = -1) {
    return http
      .post('/voice/track-line', { shabadId, transcript, verses, currentLine })
      .then((r) => r.data);
  },

  // Filters ---------------------------------------------------------------
  listRaags()   { return http.get('/filters/raags').then((r) => r.data); },
  listWriters() { return http.get('/filters/writers').then((r) => r.data); },
  listSources() { return http.get('/filters/sources').then((r) => r.data); },

  // Local-network remote controller -------------------------------------
  // Phone remotes authenticate with clientId + the clientToken returned by
  // /remote/join. POSTs carry it in the body; GET /remote/state uses a header
  // so the secret stays out of URLs and request logs.
  sendRemoteCommand(type, payload = {}, auth = {}) {
    return http.post('/remote/command', {
      type,
      payload,
      clientId: auth.clientId,
      clientToken: auth.clientToken,
      code: auth.code,
      clientName: auth.name,
    }).then((r) => r.data);
  },
  // Main app (host) command polling. The hostToken goes in a header, never
  // in the URL; the host id alone is not accepted by the backend.
  getRemoteCommands(after = 0, { hostId, hostToken } = {}) {
    const headers = {};
    if (hostId) headers['X-Remote-Host-Id'] = hostId;
    if (hostToken) headers['X-Remote-Host-Token'] = hostToken;
    return http
      .get('/remote/commands', { params: { after }, headers })
      .then((r) => r.data);
  },
  // EventSource cannot send headers, so the host exchanges its token for a
  // short-lived, single-use ticket and puts only that in the stream URL.
  getRemoteStreamTicket({ hostId, hostToken }) {
    return http.post('/remote/stream-ticket', { hostId, hostToken }).then((r) => r.data);
  },
  publishRemoteState(state) {
    return http.post('/remote/state', state).then((r) => r.data);
  },
  // Paired phones identify with clientId + the clientToken header; no pair
  // code in the URL. `code` here is a read-only Sangat View follow code.
  getRemoteState(auth = {}) {
    return http.get('/remote/state', {
      params: {
        clientId: auth.clientId || undefined,
        code: auth.code || undefined,
      },
      headers: auth.clientToken ? { 'X-Remote-Client-Token': auth.clientToken } : undefined,
    }).then((r) => r.data);
  },
  getFollowState(code) {
    return http.get(`/remote/follow/${encodeURIComponent(code)}/state`).then((r) => r.data);
  },
  // Enrollment: `pairToken` from the QR link (full rights) or the typed
  // `code` (view only until the main app allows control). Body only.
  joinRemoteSession({ code, pairToken, clientId, clientToken, name }) {
    return http.post('/remote/join', { code, pairToken, clientId, clientToken, name }).then((r) => r.data);
  },
  leaveRemoteSession({ code, clientId, clientToken }) {
    return http.post('/remote/leave', { code, clientId, clientToken }).then((r) => r.data);
  },
  kickRemoteClient({ hostId, hostToken, targetClientId }) {
    return http.post('/remote/kick', { hostId, hostToken, targetClientId }).then((r) => r.data);
  },
  heartbeatRemoteSession({ code, clientId, clientToken, name }) {
    return http.post('/remote/heartbeat', { code, clientId, clientToken, name }).then((r) => r.data);
  },
  claimRemoteControl({ code, clientId, clientToken, name }) {
    return http.post('/remote/claim', { code, clientId, clientToken, name }).then((r) => r.data);
  },
  releaseRemoteControl({ code, clientId, clientToken, name }) {
    return http.post('/remote/release', { code, clientId, clientToken, name }).then((r) => r.data);
  },
  grantRemoteControl({ code, clientId, clientToken, name, targetClientId, hostId, hostToken }) {
    return http.post('/remote/grant', { code, clientId, clientToken, name, targetClientId, hostId, hostToken }).then((r) => r.data);
  },
  resetRemoteSession(hostId, hostToken) {
    return http.post('/remote/reset', { hostId, hostToken }).then((r) => r.data);
  },
};
