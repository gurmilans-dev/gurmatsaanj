/**
 * Remote-control test actors: a main app (host), paired phones and Sangat
 * View followers, all talking to a local test server through `call`.
 */
const assert = require('node:assert/strict');

const HOST_TOKEN_HEADER = 'X-Remote-Host-Token';
const HOST_ID_HEADER = 'X-Remote-Host-Id';

function remoteActors(call, prefix) {
  let seq = 0;

  /** Main app publishing state; creates the session on first publish. */
  async function publish(host, title = 'Test Shabad') {
    const res = await call('POST', '/api/remote/state', {
      body: {
        remoteHostId: host.hostId,
        hostToken: host.hostToken,
        selectedTitle: title,
        activeLineIndex: 0,
        activeLineTotal: 2,
        surroundingLines: [{ index: 0, gurmukhi: 'ਸਤਿ ਨਾਮੁ' }, { index: 1, gurmukhi: 'ਕਰਤਾ ਪੁਰਖੁ' }],
      },
    });
    assert.equal(res.status, 200, `publish failed: ${JSON.stringify(res.data)}`);
    Object.assign(host, {
      hostToken: res.data.session.hostToken,
      code: res.data.session.code,
      followCode: res.data.session.followCode,
    });
    return res.data.session;
  }

  async function newHost(title) {
    seq += 1;
    const host = { hostId: `${prefix}-host-${seq}`, hostToken: '' };
    await publish(host, title);
    return host;
  }

  async function resetHost(host) {
    const res = await call('POST', '/api/remote/reset', {
      body: { hostId: host.hostId, hostToken: host.hostToken },
    });
    assert.equal(res.status, 200);
    Object.assign(host, { code: res.data.session.code, followCode: res.data.session.followCode });
    return res.data.session;
  }

  /** Pair a phone with the host's current code; it becomes controller if free. */
  async function pairPhone(host, name = 'phone') {
    seq += 1;
    const clientId = `${prefix}-${name}-${seq}`;
    const res = await call('POST', '/api/remote/join', { body: { code: host.code, clientId, name } });
    assert.equal(res.status, 200, `join failed: ${JSON.stringify(res.data)}`);
    return { clientId, token: res.data.clientToken, code: host.code };
  }

  async function sendCommand(phone, type, payload = {}) {
    const res = await call('POST', '/api/remote/command', {
      body: { type, payload, code: phone.code, clientId: phone.clientId, clientToken: phone.token },
    });
    assert.equal(res.status, 200, `command failed: ${JSON.stringify(res.data)}`);
    return res.data.command;
  }

  /** Host command polling with its credentials in headers (never the URL). */
  function pollCommands(host, { after = 0, token = host.hostToken } = {}) {
    return call('GET', '/api/remote/commands', {
      query: { after },
      headers: { [HOST_ID_HEADER]: host.hostId, ...(token ? { [HOST_TOKEN_HEADER]: token } : {}) },
    });
  }

  function requestStreamTicket(host, { token = host.hostToken } = {}) {
    return call('POST', '/api/remote/stream-ticket', {
      body: { hostId: host.hostId, hostToken: token },
    });
  }

  return { publish, newHost, resetHost, pairPhone, sendCommand, pollCommands, requestStreamTicket };
}

module.exports = { remoteActors, HOST_TOKEN_HEADER, HOST_ID_HEADER };
