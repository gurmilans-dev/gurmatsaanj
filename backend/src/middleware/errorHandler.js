/**
 * Centralised Express error handler.
 * Never leaks stack traces in production.
 */
const config = require('../config');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const payload = {
    error: err.expose ? err.message : status >= 500 ? 'Internal server error' : err.message,
  };
  if (!config.isProd && err.stack) payload.stack = err.stack;
  // eslint-disable-next-line no-console
  console.error(`[${status}]`, err.message);
  res.status(status).json(payload);
}

module.exports = errorHandler;
