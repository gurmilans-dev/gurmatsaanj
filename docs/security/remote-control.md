# Remote control security notes

Scope: the local-network remote controller (`backend/src/controllers/remote.controller.js`),
the phone remote (`frontend/src/pages/RemoteControlPage/`), the main app host loop
(`frontend/src/context/AppContext.jsx`), the pairing panel in
`frontend/src/components/common/Header/Header.jsx` and Sangat View (`frontend/src/pages/FollowPage/`).

## Capabilities and credentials

Each row is its own namespace; none is accepted where another is expected (tested).

| Name | Format | Held by | Lifetime | Grants | Travels in |
| --- | --- | --- | --- | --- | --- |
| Pairing link token | 192-bit random | QR / "Open remote" link on the host screen | 5 min; a new one is shown after 2 min; multi-use | enrolls a **trusted** device | URL fragment `/remote#pair=...` (never sent to a server), then the `/join` body |
| Pairing code | 4 digits, `crypto.randomInt` | host header and pairing panel | 15 min; a new one is shown after 10 min; multi-use | enrolls a **view-only** device | `/join` body only |
| Device credential | `clientId` (visible to paired devices) + `clientToken` (192-bit, minted by `/join`) | phone `localStorage` | until kick, leave, reset, session end, backend restart or 12 h idle | act as that device | `clientToken` in POST bodies; `X-Remote-Client-Token` header on `GET /remote/state` |
| Host credential | `remoteHostId` + `hostToken` | main app `localStorage` | until the session ends | host actions | JSON body of host POSTs; `X-Remote-Host-Token` header on `GET /remote/commands` |
| Host stream ticket | 192-bit random | main app memory | single use, 30 s | one `/remote/stream` connection | `GET /remote/stream?ticket=...` |
| Sangat View follow code | 6 chars `[0-9A-Z]`, `crypto.randomInt` | Sangat QR / link | until reset or session end | read-only state | path / query |

The `hostToken`, `clientToken` and pairing codes never go in a URL. The pairing link token is
only in a URL fragment, which browsers do not send to servers or in `Referer`; the remote page
removes it from the address bar and the current history entry once its join attempt settles.

## Device enrollment (S6)

Threat model: the main app header shows the 4-digit code whenever a session exists, and many
Gurdwaras mirror the laptop screen on the projector, so the code must be treated as visible to
anyone in the hall. Phones share the Gurdwara Wi-Fi with the sangat. The asset is control of
the projected display during a live service.

Policy:

- **QR link = trusted.** Scanning the pairing link enrolls a trusted device. The first trusted
  device becomes controller if nobody controls; later ones are viewers.
- **Typed code = view only.** The code enrolls an untrusted viewer. It never becomes controller
  on its own, not on join, not by `/claim`, not by sending a command, and not when control is
  free because the controller's phone slept. Its attempts become a control request; the main
  app (header "Allow") or the current controller approves it (`/grant`), which makes the device
  trusted from then on.
- **Trusted devices** may take free control themselves (`/claim` or the first command), so a
  sevadar whose phone slept carries on without walking to the laptop. Taking control from an
  active controller still needs approval, as before.
- `trusted` is server state only. It is raised by QR enrollment or approval, never by request
  input, and never lowered except by revoking the device.

Abuse controls:

- Wrong typed codes cost one unit of a per-source budget: 10 at once, then one more per 30 s.
  When it is spent, typed codes from that source get `429` with `Retry-After` and the code is
  not even looked at. A correct code does not reset the budget. Enrolled devices are charged
  too, so a credential is no way around it.
- QR pairing, heartbeats, commands and every other request are never throttled by this
  budget. A throttled source can always still scan the QR.
- At most 8 typed-code devices may be present per session; more get `429` (QR is not capped).
- One generic answer (`403`, same text) for every wrong, expired or revoked code or link. Error
  bodies never echo the code or token.
- Source identity: Express `trust proxy` is `loopback` by default (`TRUST_PROXY`), and the Vite
  dev/preview proxies send `X-Forwarded-For` (`xfwd: true`). Each phone behind the local proxy
  is then its own source, and a LAN client cannot claim another address (a header from a
  non-loopback peer is ignored). `TRUST_PROXY=true` or a hop count are refused and treated as
  `loopback`. The same identity now keys the app-wide rate limiter.
- Wrong codes cannot be attributed to a session (a wrong code names no session), so there is
  no per-session wrong-code budget that an outsider could exhaust to block a host. Per-session
  limits apply to what succeeds instead (the typed-code device cap, 5 control requests).

Lifecycle:

| Event | Pairing link / code | Device credentials | Sangat View link |
| --- | --- | --- | --- |
| Host publish (every second) | expired ones pruned; fresh ones issued on schedule | unchanged | unchanged |
| Host page reload | unchanged (same session) | unchanged | unchanged |
| "New code" (`/reset`) | all revoked, new ones issued | all revoked (`reset` reason) | revoked, streams closed |
| Kick | unchanged | that device revoked; its id cannot re-enroll until reset | unchanged |
| Leave ("Pair another code") | unchanged | that device revoked | unchanged |
| Phone screen off | unchanged | kept; the device is just not listed after 45 s and loses control after 30 s | unchanged |
| 12 h without contact | — | that device revoked | — |
| Host gone 60 s, or backend restart | all gone | all gone | all gone |

A revoked credential presented again gets the reason (removed / new code / pairing ended) for
30 minutes, and only to its holder (keyed by the secret itself). `GET /remote/state` reports it
in `remoteSession.error`, so a phone drops the credential and says why.

## Phone remote rules (S2/S3, updated for S6)

- `/command`, `/heartbeat`, `/claim`, `/release`, controller-side `/grant`, `/leave` and the
  session view of `GET /state` all require `clientId` + matching `clientToken`.
- The `clientToken` alone selects the session (token index); the `clientId` must be the device
  that token was minted for. No pair code is involved any more, so codes can expire without
  dropping paired phones, and no `clientId -> host` binding exists that could be re-pointed.
  A `code` sent with these requests is ignored.
- Re-joining with a `clientId` that is already in the session requires that device's token
  (reload, second tab). Without it `/join` returns `409`, so a viewer cannot join under the
  controller's id. The phone answers a `409` by pairing once more under a fresh device id
  (e.g. after the reply to an earlier join was lost).
- Tokens are never included in roster payloads (`publicSession`).

## Host command rules (S5)

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

## Sangat View rules (S4)

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

Regression tests (`cd backend && npm test`): `remote-auth.test.js` (S2/S3),
`host-command-auth.test.js` (S5), `sangat-revocation.test.js` (S4),
`pairing-enrollment.test.js` (S6). The S2/S3/S5 suites enroll their phones through the QR
pairing link; typed-code enrollment is covered in `pairing-enrollment.test.js`.

## Findings status

| ID | Finding | Status |
| --- | --- | --- |
| S1 | Vulnerable `body-parser` (GHSA-27r3-jxmh-p828 crash via trailing bytes after a compressed body; GHSA-v422-hmwv-36x6) | Fixed: lockfile pins `body-parser@1.20.9`; tests in `backend/tests/dependencies.test.js` and `backend/tests/body-parsing.test.js` |
| S2 | Paired viewer can impersonate the controller | Fixed: per-device `clientToken` |
| S3 | `/api/remote/leave` disconnects any client by id | Fixed: `/leave` requires the device's `clientToken` |
| S4 | Revoked Sangat streams stay connected | Fixed: streams are bound to their follow code and closed with `event: revoked` on reset / expiry |
| S5 | Host command retrieval needs only `hostId` | Fixed: `hostToken` header for polling, single-use stream tickets for SSE |
| S6 | Weak device enrollment: 4-digit `Math.random` code, valid for the whole session, unthrottled, and a guessed code could take control | Mitigated: QR link token for trusted enrollment; typed code is crypto-random, expiring, throttled per source and view-only until approved; credentials no longer depend on the code |

## Compatibility notes

- Deploy backend and frontend together, then reload open main app and remote tabs once
  (navigations are network-first in `public/sw.js`).
- **Visible change:** a phone paired by typing the code is view only until someone presses
  "Allow" on the main app (or the current controller allows it on their phone). Scanning the
  QR works as before (first phone controls). Volunteers who type the code need one extra tap
  at the laptop.
- The 4-digit code in the header changes about every 10 minutes; each code keeps working for
  at least 5 minutes after it is replaced. Paired phones are not affected by the change.
- A paired phone whose screen was off now resumes with its stored credential (up to 12 h idle)
  instead of re-joining with a stored code. The typed code is no longer stored on the phone
  (`saanj-kirtan.remotePairCode` is cleared).
- Network blips no longer unpair a phone; only a rejected credential (`403`) does.
- A main app tab on the old bundle still renders a `?code=` QR. Phones scanning it pair view
  only (typed-code rules). Old remote pages keep working for already paired phones (they
  authenticate with their token; the code they send is ignored), and new pairings from them
  are view only.
- The device roster lists present devices only (seen in the last 45 s), as before; sleeping
  phones reappear when they check in.
- Behind the Vite proxy each phone now counts separately for the app-wide rate limit
  (600 req/min per source) instead of all phones sharing one budget. Deployments behind a
  different reverse proxy should forward `X-Forwarded-For` and set `TRUST_PROXY` to that
  proxy's address; without forwarding, typed-code throttling and rate limits are shared by
  everyone behind the proxy (QR pairing and paired devices still work).
- The QR now encodes about 70 characters (version 5-L holds 106 bytes). A
  `VITE_PUBLIC_APP_URL` origin longer than about 60 characters makes the QR show
  "QR unavailable"; the typed code still works.
- `main.jsx` no longer reloads the page when the service worker is first installed (the first
  `controllerchange`). That reload wiped a code being typed and could interrupt a QR pairing on
  a phone's first visit. Updates still reload once when the user accepts them.
- Unchanged from S5: a brand-new main app (or one right after a backend restart) sees a few
  `403`s on `/stream-ticket` and `/commands` until its first publish; it polls meanwhile and the
  first command still arrives (verified).
- Unchanged from S5: the Vite preview proxy keeps a dead SSE response open until its 60 s
  `proxyTimeout`, so after a backend restart the main app took 50 s to reconnect its command
  stream in the browser check. Copying the dev proxy's `error` handler to `preview.proxy`
  brought that to 1.5 s in the Phase 2 check.

## Remaining risks

- Typed code, residual: in a mirrored-display setup anyone can read the current code and pair
  a view-only device. That reveals what the projector already shows plus the device roster
  names, and lets them file control requests that a distracted sevadar might approve. The
  approval UI names the device; there is no device verification beyond that. Prefer an
  extended display (separate projector window) so the header is not projected.
- QR link, residual: anyone who sees the QR while the pairing panel is open (or photographs
  it) can enroll a trusted device for up to 5 minutes. In a mirrored-display setup that
  includes the hall. Closing the panel does not revoke the link; "New code" does.
- The per-source budget is a speed bump: a LAN attacker can change their address (trivially
  within an IPv6 /64) to get more guesses. Per address it allows about 120 wrong codes an
  hour after the first 10; with two live codes per session that is roughly a 2-3 % chance per
  hour per address per session of finding one. The result is still only a view-only device.
- Shared-identity DoS: where every phone reaches the backend through one non-forwarding proxy
  or NAT, an attacker spending the budget also blocks typed codes for everyone there. QR
  pairing and paired devices keep working.
- Device credentials now live up to 12 h idle (they lived 45 s before, with the code standing
  in for them). They are 192-bit secrets in phone `localStorage`; "New code" revokes them all.
  Sleeping devices are not listed, so the host cannot kick one it cannot see, only reset.
- Session claim after expiry or restart (unchanged): `postState` and `/reset` accept a
  client-supplied `hostToken` when they create a session, and the browser generates it
  (64 bits, with a `Math.random` fallback). Anyone who knows a host id can create that session
  first after a backend restart or a 60 s host absence and lock the real main app out. Denial
  of service only. Remediation (separate task, changes the host bootstrap protocol):
  server-minted host token on first publish, and a new host id when the stored token is
  rejected.
- Stream tickets appear in the stream URL, so in request logs. They are single use, live for
  30 s and are redeemed within milliseconds of issue.
- SSE liveness: the backend's 20 s heartbeat is an SSE comment, which `EventSource` does not
  pass to page code. A connection that dies silently (the Vite preview proxy case above) is only
  noticed when the transport errors.
- Remote state is in memory. A backend restart ends all sessions; phones must re-pair and
  Sangat View links must be re-shared.
