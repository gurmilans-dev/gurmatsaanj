# Remote control security notes

Scope: the local-network remote controller (`backend/src/controllers/remote.controller.js`),
the phone remote (`frontend/src/pages/RemoteControlPage/`), the main app host loop
(`frontend/src/context/AppContext.jsx`) and Sangat View (`frontend/src/pages/FollowPage/`).

## Credentials

| Party | Identifier | Secret | Where the secret travels |
| --- | --- | --- | --- |
| Main app (host) | `remoteHostId` | `hostToken` | JSON body of `/state`, `/grant`, `/kick`, `/reset`, `/stream-ticket`; `X-Remote-Host-Token` header on `GET /remote/commands` |
| Main app SSE | stream ticket (from `/stream-ticket`) | the ticket itself: single use, 30 s | `GET /remote/stream?ticket=...` |
| Phone remote | `clientId` (visible to every paired device) | `clientToken`, minted by `/join` | JSON body of POSTs; `X-Remote-Client-Token` header on `GET /remote/state` |
| Sangat View | `followCode` (shared by QR) | none (read-only, revocable) | path / query |

The `hostToken` never goes in a URL. The host id is an identifier, not a credential.

Phone remote rules (S2/S3 fix):

- `/join` with the current pair code mints a per-device `clientToken` and returns it once.
  The phone stores it in `localStorage` (`saanj-kirtan.remoteClientToken`).
- `/command`, `/heartbeat`, `/claim`, `/release`, controller-side `/grant`, `/leave` and the
  session view of `GET /state` all require `clientId` + matching `clientToken`.
- Re-joining with a `clientId` that is already in the session requires that device's token
  (reload, second tab). Without it `/join` returns `409`, so a viewer cannot join under the
  controller's id.
- Sessions resolve by pair code first, then by the device's own binding, so a re-pointed
  `clientId -> host` binding cannot redirect an authenticated device.
- Tokens are never included in roster payloads (`publicSession`). Kick, code reset, client
  expiry (45 s without heartbeat) and backend restart all invalidate them.

Host command rules (S5 fix):

- `GET /remote/commands` needs `X-Remote-Host-Id` + `X-Remote-Host-Token` for an existing
  session. A missing or wrong token, a token from another session, or a token in the query
  string all get `403`. (The host id may still come from the query; it is not a secret.)
- `EventSource` cannot send headers, so the main app first calls
  `POST /remote/stream-ticket { hostId, hostToken }` and opens
  `GET /remote/stream?ticket=...&after=...`. The ticket alone selects the session; a `hostId`
  in the stream URL is ignored.
- Tickets are 192-bit random, single use (deleted on first redemption, valid or not), expire
  after 30 s, are capped at 4 outstanding per session, and are bound to the session object:
  session expiry, backend restart and code reset (`/reset`) invalidate unused tickets, and a
  re-created session for the same host id does not accept them. A rejected stream gets a
  plain `403` so the browser stops instead of replaying the ticket.
- `AppContext.jsx` uses SSE while it is up. On any stream error it closes the
  `EventSource` (whose built-in reconnect would replay a used ticket), polls with headers,
  and retries SSE with a fresh ticket (2 s doubling to 30 s). Polling stops when the new
  stream sends its `cursor` event. The first-poll/first-cursor skip of queued commands and
  the id-based de-duplication are unchanged.
- A code reset leaves the host's already-open command stream connected: it was opened with
  the host's credentials, which a reset does not change.

Sangat View rules (S4 fix):

- Each follow stream remembers the follow code it was opened with.
- Code rotation (`/reset`) and session expiry end every stream on the old code with
  `retry: 86400000`, `event: revoked`, `data: { error }`. State broadcasts also skip and close
  any stream whose code is no longer current, as a second check.
- Connecting with an unknown, rotated or expired code gets the same `revoked` frame and an
  immediate close. Follow codes are random per session and never map to a session again.
- `FollowPage.jsx` closes the `EventSource` on `revoked` or on a `404` from
  `/follow/:code/state`, drops the last state from the screen and shows "This Sangat View link
  has expired". Late responses after that are ignored. If the browser gives up on the stream
  after an HTTP error (e.g. a proxy `502` while the backend restarts), the page re-checks over
  REST and reopens it, backing off from 3 s to 30 s.

Regression tests (`cd backend && npm test`): `backend/tests/remote-auth.test.js` (S2/S3),
`backend/tests/host-command-auth.test.js` (S5), `backend/tests/sangat-revocation.test.js` (S4).

## Findings status

| ID | Finding | Status |
| --- | --- | --- |
| S1 | Vulnerable `body-parser` (GHSA-27r3-jxmh-p828 crash via trailing bytes after a compressed body; GHSA-v422-hmwv-36x6) | Fixed: lockfile pins `body-parser@1.20.9`; tests in `backend/tests/dependencies.test.js` and `backend/tests/body-parsing.test.js` |
| S2 | Paired viewer can impersonate the controller | Fixed: per-device `clientToken` |
| S3 | `/api/remote/leave` disconnects any client by id | Fixed: `/leave` requires the device's `clientToken` |
| S4 | Revoked Sangat streams stay connected | Fixed: streams are bound to their follow code and closed with `event: revoked` on reset / expiry |
| S5 | Host command retrieval needs only `hostId` | Fixed: `hostToken` header for polling, single-use stream tickets for SSE |

## Compatibility notes

- Deploy backend and frontend together. A main app tab still running the pre-S5 bundle gets
  `403` on `/remote/commands` and `/remote/stream`, so phone commands stop reaching it until
  it reloads. Navigations are network-first in `public/sw.js`, so one reload picks up the new
  bundle. Phone remotes are unaffected by S4/S5.
- A Sangat View phone still on the pre-S4 page stops receiving data when its link is revoked
  (the server enforces it). It keeps the last screen with "Reconnecting..." until reloaded,
  and the `retry` hint makes its `EventSource` reconnect about once a day instead of every few
  seconds.
- Any external tool polling `/remote/commands?hostId=...` or opening `/remote/stream?hostId=...`
  must switch to the headers / ticket flow.
- On a brand-new main app, or right after a backend restart, the first `/stream-ticket` and
  `/commands` calls can return `403` for about a second, until the first state publish
  creates the session. The browser console shows them; the loop retries on its own (seen
  in the browser check as `POLL 403` then `TICKET 200` about 1.5 s after a restart).
- Proxies must forward `X-Remote-Host-Id` and `X-Remote-Host-Token`. CORS preflight reflects
  them (tested). Verified in headless Chrome through the Vite preview proxy and through a
  Node proxy that mirrors the dev proxy's error handler.
- Vite preview proxy, existing behaviour: `vite.config.js` gives the dev proxy an `error`
  handler that ends the response, but not the preview proxy. When the backend dies, the
  preview proxy leaves open SSE responses hanging until `proxyTimeout` (60 s), so the main app
  and Sangat View only notice then. With the dev handler copied to `preview.proxy`, recovery
  after a backend restart took 1.5 s in the same browser check.

## Remaining risks

### Short pairing code (next remediation)

The pair code is 4 digits (9,000 values) from `Math.random`. It stays valid until the host
presses "New code" or the session expires, and nothing limits guesses per code. The only
brake is the per-IP rate limit (600 requests/min by default). Through the Vite proxy every
client shares one IP, so that limit is effectively global. One LAN device can try every code
in about 15 minutes, and with several sessions active each guess is more likely to hit one.
A correct guess pairs the attacker's device as a viewer. If no controller is active (the
controller lapses after 30 s without a heartbeat), it gets control and can drive the
projector during a live service. Gurdwara Wi-Fi is often shared with the sangat.

Proposed next step, in order:

1. Throttle failed `/join` attempts by code, not by IP: a global budget for wrong codes (for
   example 10/min, then a short lockout), and rotate a session's code after a set number of
   failed tries while it is displayed. Generate codes with `crypto.randomInt`.
2. Make the code short-lived: expire it a few minutes after it is shown or after its first
   successful pairing, and show a new one when the host opens the pairing panel.
3. Longer term: pair by QR carrying a high-entropy one-time pairing token, keeping the
   4-digit code as a manual fallback that needs host approval on the main app (reuse the
   existing control-request approval flow).

### Other remaining risks

- Session claim after expiry or restart: `postState` and `/reset` still accept a client-supplied
  `hostToken` when they create a session, and the browser generates it (64 bits, with a
  `Math.random` fallback). Anyone who knows a host id can create that session first after a
  backend restart or a 60 s host absence and lock the real main app out (`403`). This is denial
  of service only: it gives no access to the real host's phones or commands. S5 stops new
  host-id exposure in URLs, but request logs from before this change may still contain host
  ids. Remediation: server-minted host token on first publish, and a new host id when the
  server rejects the stored token.
- Stream tickets appear in the stream URL, so in request logs. They are single use, live for
  30 s and are redeemed within milliseconds of issue. A logged ticket is useless unless
  someone reads the log in real time and connects before the main app.
- Follow codes are 6 base-36 characters from `Math.random`. That is too large to guess at
  the rate limit, but the values are not cryptographically random. Switch to `crypto` along
  with the pair code.
- SSE liveness: the backend's 20 s heartbeat is an SSE comment, which `EventSource` does not
  pass to page code. A connection that dies silently (for example the Vite preview proxy case
  above) is only noticed when the transport errors. A named heartbeat event with a client
  watchdog would bound that.
- Remote state is in memory. A backend restart ends all sessions; phones must re-pair and
  Sangat View links must be re-shared.
