/**
 * applySecurity(app)
 * Applies a layered set of security middleware:
 *  - helmet: sane HTTP headers
 *  - cors:   restricted to configured origins
 *  - rate-limit: per-IP request throttling
 */
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('../config');

function applySecurity(app) {
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false, // CSP is enforced by the frontend host, not this API
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // Allow:
  //   - any explicitly configured origin from CORS_ORIGIN
  //   - localhost / 127.x / 169.254.x (link-local)
  //   - any RFC 1918 private LAN address (10/8, 172.16/12, 192.168/16)
  // The remote-control feature relies on a phone reaching the backend over
  // the LAN — that browser's Origin header is the laptop's LAN IP, not
  // localhost, so we have to whitelist private ranges or the cors middleware
  // fails the request and the phone sees a network error.
  const LAN_ORIGIN_RE = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/i;

  app.use(
    cors({
      origin(origin, callback) {
        // Allow tools like curl / mobile apps with no Origin header.
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes(origin)) return callback(null, true);
        if (LAN_ORIGIN_RE.test(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      methods: ['GET', 'POST'],
      credentials: false,
    })
  );

  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, please try again later.' },
    })
  );
}

module.exports = { applySecurity };
