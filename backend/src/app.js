/**
 * Express app factory.
 * Builds the app with security middleware, body parsing, routes and error
 * handling, without binding a port. server.js listens on config.port; tests
 * mount the same stack on an ephemeral local port.
 */
const express = require('express');
const morgan = require('morgan');

const config = require('./config');
const { applySecurity } = require('./middleware/security');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');

function createApp({ logging = true } = {}) {
  const app = express();

  // --- Security & parsing -------------------------------------------------
  applySecurity(app);
  // Remote state can include an expanded read-along window for long Ang/Bani
  // views. Keep the limit modest, but high enough that "Load More Lines"
  // does not make /api/remote/state fail with 413.
  app.use(express.json({ limit: '256kb' }));
  if (logging) app.use(morgan(config.isProd ? 'combined' : 'dev'));

  // --- Health check -------------------------------------------------------
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), name: 'gurmat-saanj-api' });
  });

  // --- API routes ---------------------------------------------------------
  app.use('/api', routes);

  // --- 404 + error handler ------------------------------------------------
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
