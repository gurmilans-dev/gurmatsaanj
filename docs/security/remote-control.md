# Remote control security notes

Scope: the local-network remote controller (`backend/src/controllers/remote.controller.js`),
the phone remote (`frontend/src/pages/RemoteControlPage/`), the main app host loop
(`frontend/src/context/AppContext.jsx`) and Sangat View (`frontend/src/pages/FollowPage/`).

## Credentials

| Party | Identifier | Secret | Where the secret travels |
| --- | --- | --- | --- |
| Main app (host) | `remoteHostId` | `hostToken` | JSON body of `/state`, `/grant`, `/kick`, `/reset` |
| Phone remote | `clientId` (visible to every paired device) | `clientToken`, minted by `/join` | JSON body of POSTs; `X-Remote-Client-Token` header on `GET /remote/state` |
| Sangat View | `followCode` (shared by QR) | none (read-only by design) | path / query |

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

Regression tests: `backend/tests/remote-auth.test.js` (`cd backend && npm test`).

## Findings status

| ID | Finding | Status |
| --- | --- | --- |
| S1 | Vulnerable `body-parser` (GHSA-27r3-jxmh-p828 crash via trailing bytes after a compressed body; GHSA-v422-hmwv-36x6) | Fixed: lockfile pins `body-parser@1.20.9`; tests in `backend/tests/dependencies.test.js` and `backend/tests/body-parsing.test.js` |
| S2 | Paired viewer can impersonate the controller | Fixed: per-device `clientToken` |
| S3 | `/api/remote/leave` disconnects any client by id | Fixed: `/leave` requires the device's `clientToken` |
| S4 | Revoked Sangat streams stay connected | Open, see below |
| S5 | Host command retrieval needs only `hostId` | Open, see below |

## S4: revoked Sangat View streams stay connected

Verified behaviour: after the host presses "New code" (`POST /remote/reset`), the old follow
code returns `404` over REST, but any `GET /remote/follow/stream` opened before the reset stays
in `session.stateSseClients` and keeps receiving every later state broadcast. Anyone holding an
old QR link keeps watching after the host revoked it.

Next required changes:

1. Backend: in `rotateCode()` (used by `/reset`), write
   `event: revoked` with `{ error: 'Sangat View link has expired...' }` to each
   `session.stateSseClients` response, `end()` it, and clear the set.
2. Backend, defense in depth: record the follow code on each stream subscription and have
   `broadcastStateToSession()` skip (and end) subscriptions whose code no longer equals
   `session.followCode`.
3. Frontend `FollowPage.jsx`: listen for `revoked`, call `es.close()` so the browser stops
   its auto-reconnect loop, clear the displayed state, and show the "link expired" message.
   Today a closed stream triggers endless reconnects and the last line stays on screen.
4. Tests: open a follow stream, reset, assert the stream ends and the post-reset state is not
   delivered; assert a stream on the new follow code still works.

## S5: host command retrieval needs only `hostId`

Verified behaviour: `GET /remote/commands?hostId=...` and `GET /remote/stream?hostId=...` return
the full command queue and live command stream (for example `open-shabad` payloads) without
`hostToken`. `hostId` is random (64 bits) and not returned by any API, but it is sent in the
query string of every poll and SSE connect, so it is recorded by Morgan request logs and any
proxy logs, and it is effectively a bearer secret in URLs.

Next required changes:

1. Backend: require `verifyHostToken(session, token)` in `getCommands` and `streamCommands`;
   answer `403` (or close the stream with an error event) on mismatch.
2. Transport for the token, since `EventSource` cannot set headers. Preferred: a short-lived,
   single-use stream ticket (`POST /remote/stream-ticket { hostId, hostToken }` returns a
   random ticket valid for ~30 s; `GET /remote/stream?ticket=...`). Alternative: replace
   `EventSource` in `AppContext.jsx` with `fetch()` streaming so the token can go in an
   `X-Remote-Host-Token` header. Do not put `hostToken` itself in the query string.
3. Frontend `AppContext.jsx`: send the host token header on `getRemoteCommands` polling
   (`frontend/src/services/api.js`) and use the ticket/header path for the SSE stream. Keep
   the existing polling fallback.
4. Tests: `/commands` and `/stream` without or with a wrong token are rejected; with the
   right token the backlog and live commands still arrive; the first-poll cursor skip in
   `AppContext.jsx` is unchanged.

Related hardening to schedule with S5: `postState` currently accepts a client-supplied
`hostToken` when it creates a session, and the main app generates that token in the browser
(`randomId`, 64 bits, with a `Math.random` fallback). Prefer a server-minted host token
returned on first publish.

## Compatibility notes

- Deploy backend and frontend together. A phone running a cached pre-fix remote page sends
  no `clientToken`, gets `403` on heartbeat/commands, and must reload to pick up the new
  bundle. Remote sessions are in memory, so the backend restart already forces re-pairing.
- If a device keeps its `clientId` but loses its stored token while its old entry is still
  live, `/join` returns `409` until that entry expires (about 45 s), then pairing works again.
- The new `X-Remote-Client-Token` request header is accepted by the existing CORS setup
  (preflight reflects requested headers). Forwarding through the Vite dev proxy was verified
  end to end; the preview proxy uses the same proxy mechanism but was not exercised.
