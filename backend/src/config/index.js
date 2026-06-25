/**
 * Centralised configuration. Reads from environment with sensible defaults.
 */
const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  isProd: process.env.NODE_ENV === 'production',
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
