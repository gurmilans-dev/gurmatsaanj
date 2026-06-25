/**
 * Gurmat Saanj - Backend entry
 * Boots the Express app, applies security middleware, mounts routes.
 */
require('dotenv').config();

const express = require('express');
const morgan = require('morgan');

const config = require('./src/config');
const { applySecurity } = require('./src/middleware/security');
const errorHandler = require('./src/middleware/errorHandler');
const routes = require('./src/routes');

const app = express();

// --- Security & parsing ---------------------------------------------------
applySecurity(app);
// Remote state can include an expanded read-along window for long Ang/Bani
// views. Keep the limit modest, but high enough that "Load More Lines"
// does not make /api/remote/state fail with 413.
app.use(express.json({ limit: '256kb' }));
app.use(morgan(config.isProd ? 'combined' : 'dev'));

// --- Health check ---------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), name: 'gurmat-saanj-api' });
});

// --- API routes -----------------------------------------------------------
app.use('/api', routes);

// --- 404 + error handler --------------------------------------------------
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

// --- Start ----------------------------------------------------------------
const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Gurmat Saanj API listening on http://localhost:${config.port}`);
});

server.on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

process.on('unhandledRejection', (err) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledRejection]', err?.message || err);
});
