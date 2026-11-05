/**
 * Child-process fixture: boots the real app on an ephemeral 127.0.0.1 port
 * and reports the port to the parent over IPC. Used by tests that need to
 * observe whether a request can crash the whole process.
 */
const { createApp } = require('../../src/app');

const server = createApp({ logging: false }).listen(0, '127.0.0.1', () => {
  process.send?.({ port: server.address().port });
});

process.on('disconnect', () => process.exit(0));
