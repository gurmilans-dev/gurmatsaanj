/**
 * Gurmat Saanj - Backend entry
 * Loads env, builds the Express app (src/app.js) and listens on config.port.
 */
require('dotenv').config();

const config = require('./src/config');
const { createApp } = require('./src/app');

const app = createApp();

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
