/**
 * Minimal Server-Sent Events reader for tests.
 *
 * Opens a fetch stream, parses `retry:` / `event:` / `data:` frames as they
 * arrive, and lets a test wait for a named event or for the server to end the
 * response. Waits are event driven; the timeout only bounds a failing test.
 */

function parseFrame(frame) {
  const out = { event: 'message', data: '', retry: null };
  let hasField = false;
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const sep = line.indexOf(':');
    const field = sep === -1 ? line : line.slice(0, sep);
    const value = sep === -1 ? '' : line.slice(sep + 1).replace(/^ /, '');
    hasField = true;
    if (field === 'event') out.event = value;
    else if (field === 'data') out.data = out.data ? `${out.data}\n${value}` : value;
    else if (field === 'retry') out.retry = Number(value);
  }
  return hasField ? out : null;
}

async function openEventStream(url, { headers } = {}) {
  const controller = new AbortController();
  const res = await fetch(url, { headers, signal: controller.signal });
  const isStream = (res.headers.get('content-type') || '').includes('text/event-stream');

  if (!isStream) {
    const body = await res.text();
    return {
      status: res.status,
      body,
      events: [],
      ended: true,
      waitForEvent: async () => null,
      waitForEnd: async () => true,
      close() {},
    };
  }

  const events = [];
  const waiters = new Set();
  let ended = false;
  const notify = () => { for (const wake of waiters) wake(); };

  (async () => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
          const parsed = parseFrame(frame);
          if (parsed) {
            events.push(parsed);
            notify();
          }
        }
      }
    } catch {
      // Aborted by close(); treat as ended.
    }
    ended = true;
    notify();
  })();

  function waitUntil(check, timeoutMs) {
    return new Promise((resolve) => {
      const immediate = check();
      if (immediate) return resolve(immediate);
      let timer = null;
      const wake = () => {
        const value = check();
        if (value || ended) {
          clearTimeout(timer);
          waiters.delete(wake);
          resolve(value || null);
        }
      };
      timer = setTimeout(() => { waiters.delete(wake); resolve(check() || null); }, timeoutMs);
      waiters.add(wake);
    });
  }

  return {
    status: res.status,
    body: null,
    events,
    get ended() { return ended; },
    /** Resolves with the first matching event, or null on end/timeout. */
    waitForEvent(name, { timeoutMs = 2000, where = () => true } = {}) {
      return waitUntil(() => events.find((e) => e.event === name && where(e)) || null, timeoutMs);
    },
    /** Resolves true once the server ended the response, false on timeout. */
    async waitForEnd(timeoutMs = 2000) {
      await waitUntil(() => ended, timeoutMs);
      return ended;
    },
    close() { controller.abort(); },
  };
}

module.exports = { openEventStream, parseFrame };
