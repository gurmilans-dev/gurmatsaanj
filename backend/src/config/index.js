/**
 * Centralised configuration. Reads from environment with sensible defaults.
 */

/**
 * Which proxies may set X-Forwarded-For (Express `trust proxy`). Default:
 * only a proxy on this machine (the Vite dev/preview proxy), so each phone
 * behind it keeps its own address while a LAN client cannot claim another
 * one. `false` disables it; otherwise a comma list of proxy-addr names or
 * CIDRs. `true` and hop counts would trust any peer and are not accepted.
 */
function parseTrustProxy(value) {
  const raw = String(value ?? 'loopback').trim();
  if (!raw || /^(false|off|no|0)$/i.test(raw)) return false;
  if (/^(true|on|yes|\d+)$/i.test(raw)) return ['loopback'];
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  isProd: process.env.NODE_ENV === 'production',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  banidb: {
    baseUrl: process.env.BANIDB_BASE_URL || 'https://api.banidb.com/v2',
    timeoutMs: parseInt(process.env.BANIDB_TIMEOUT_MS || '20000', 10),
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '600', 10),
  },
  matching: {
    minLineConfidence: parseInt(process.env.MIN_LINE_CONFIDENCE || '50', 10),
    maxQueryLength: 300,
    maxSuggestions: 10,
  },
};

module.exports = config;
