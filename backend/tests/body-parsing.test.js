/**
 * S1: request-body parsing behaviour of the real app stack.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const { fork } = require('node:child_process');
const { once } = require('node:events');

const { startTestServer, makeClient } = require('./helpers/server');

function rawPost(port, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method: 'POST',
      headers: { 'Content-Length': body.length, ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function getStatus(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

test('gzip body with trailing bytes does not crash the server process (GHSA-27r3-jxmh-p828)', async (t) => {
  const child = fork(path.join(__dirname, 'fixtures', 'app-process.js'), [], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill(); });

  const [{ port }] = await once(child, 'message');

  // One complete gzip frame, a 0x00 byte (zlib ends the decoder at the frame
  // boundary), then 100 KB that reaches the finished decoder in later TCP
  // chunks. Vulnerable body-parser leaves that decoder piped with no error
  // listener, so the process dies with an uncaught Z_DATA_ERROR.
  const payload = Buffer.concat([
    zlib.gzipSync(Buffer.from(JSON.stringify({ probe: true }))),
    Buffer.from([0x00]),
    Buffer.alloc(100 * 1024, 0x58),
  ]);
  const res = await rawPost(port, '/api/__body_parser_probe', payload, {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
  }).catch(() => ({ status: 0 }));
  assert.ok(res.status < 500, `unexpected status ${res.status}`);

  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 750)),
  ]);
  assert.equal(exited, false, `server process exited after the request:\n${stderr}`);
  assert.equal(await getStatus(port, '/api/health'), 200);
});

test('oversized JSON body is rejected with 413', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const call = makeClient(server.baseUrl);
  const res = await call('POST', '/api/remote/state', {
    body: { remoteHostId: 'host-oversize', padding: 'x'.repeat(300 * 1024) },
  });
  assert.equal(res.status, 413);
});

test('valid gzip-encoded JSON is still accepted', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { port } = new URL(server.baseUrl);
  const body = zlib.gzipSync(Buffer.from(JSON.stringify({ remoteHostId: 'host-gzip', selectedTitle: 'Gzip probe' })));
  const res = await rawPost(Number(port), '/api/remote/state', body, {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
  });
  assert.equal(res.status, 200, res.body);
  assert.equal(JSON.parse(res.body).ok, true);
});

test('malformed JSON is a 400, not a 500', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { port } = new URL(server.baseUrl);
  const res = await rawPost(Number(port), '/api/remote/state', Buffer.from('{"remoteHostId":'), {
    'Content-Type': 'application/json',
  });
  assert.equal(res.status, 400);
});
