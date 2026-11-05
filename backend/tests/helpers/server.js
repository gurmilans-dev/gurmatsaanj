/**
 * Local test server helpers. Everything binds to 127.0.0.1 on an ephemeral
 * port; nothing here talks to a deployed system or to BaniDB.
 */
const http = require('node:http');

const { createApp } = require('../../src/app');

async function startTestServer() {
  const server = http.createServer(createApp({ logging: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close() {
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Small fetch wrapper: JSON in, { status, data, headers } out.
 */
function makeClient(baseUrl) {
  return async function call(method, path, { body, headers = {}, query } = {}) {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const res = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
}

module.exports = { startTestServer, makeClient };
