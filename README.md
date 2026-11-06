# Gurmat Saanj - Every Line. Live.

Gurmat Saanj is a full-stack React/Vite + Express app for live Gurudwara use. It helps a sevadar search Gurbani, follow live Kirtan or Katha, track the current line, control a projector, share a Sangat View, and manage a session queue from the main screen or a remote device.

The app uses BaniDB as its Gurbani/Bani source, runs live matching in the browser and backend, and bundles generated semantic-search artifacts for meaning-based search.

## What It Does

- Live Kirtan and Katha modes with Punjabi speech recognition (`pa-IN`) through the browser Web Speech API.
- Manual Shabad search by auto-detected query, full words, first-letter shorthand, Ang number, or semantic meaning.
- Filters for source, writer, and raag, backed by BaniDB with local fallback lists.
- Reader views for Shabad and Ang pages with line highlighting, vishraam marks, Rahao handling, larivaar display, transliteration, English translation, and Punjabi steek options.
- Kirtan line tracking, follow-hold behavior, queue-aware auto advance, and automatic Anand Sahib opening when detected.
- Katha-friendly tracking across nearby Shabads or full Ang pages.
- Bani mode for common Banis, variants, progress restore, search/jump, and local line tracking.
- Projector window with presets, background/image modes, emergency screens, font controls, and QR sharing.
- Remote controller with trusted QR pairing, expiring view-only pairing codes, control approval, queue tools, mic controls, projector controls, and line navigation.
- Sangat View (`/follow/:code`) for read-only phones using the remote follow code.
- Session tools: queue timeline, history, saved Shabads, preloading, crash recovery, readiness checks, and keyboard emergency shortcuts.
- Opt-in recognition traces, audio/trace test capture, local review tools, and offline evaluation against independently reviewed labels.
- PWA shell, generated icons/splash screens, service worker runtime cache, local API cache, and offline session packs.
- 2026 Sikh/Nanakshahi calendar data, local correction overlays, suggested Shabad preparation, and daily Hukamnama.

The app posts recognized transcript text to its own API for matching. Microphone capture and speech recognition are handled by the browser; recognition may use an online provider. Optional diagnostic audio capture stays in memory until you export it.

## Repository Map

```text
.
|-- backend/                         Express API
|   |-- server.js                    Loads env and starts the HTTP listener
|   |-- package.json
|   |-- tests/                       Node test suites using local test servers
|   `-- src/
|       |-- app.js                   Express app factory, middleware and routes
|       |-- config/                  Env defaults and constants
|       |-- controllers/             Request handlers
|       |-- middleware/              Helmet, CORS, rate limit, error JSON
|       |-- routes/                  /api route modules
|       |-- services/                BaniDB client, matching, fallback filters
|       `-- utils/                   Gurmukhi normalization helpers
|-- frontend/                        React 18 + Vite app
|   |-- index.html                   PWA metadata, CSP, fonts
|   |-- vite.config.js               HTTPS dev server, proxy, preview proxy
|   |-- public/
|   |   |-- brand/, icons/, splash/   Static generated/brand assets
|   |   |-- semantic/                Generated semantic-search artifacts
|   |   `-- sw.js                    Service worker
|   |-- test/                        Vitest suites and replay/evaluation fixtures
|   `-- src/
|       |-- App.jsx                  Route tree
|       |-- context/                 Global app/session/projector state
|       |-- data/                    Bani catalog, calendar, guidance, chips
|       |-- pages/                   Kirtan, Katha, Shabad, Ang, Bani, etc.
|       |-- features/                Search, projector, audio, session UI
|       |-- hooks/                   Voice, tracking, wake lock, auto advance
|       |-- services/                API, projector, semantic search
|       |-- styles/                  Design tokens, reset, global atoms
|       `-- utils/                   Matching/rendering/storage helpers
|-- docs/                            Remote security and recognition guides
|-- tools/                           Semantic builds, replay, capture review/eval
|-- scripts/                         PWA asset generator
|-- CLAUDE.md                        Older Claude-specific notes
`-- AGENTS.md                        Current coding-agent guide
```

Generated/vendor folders such as `frontend/node_modules`, `backend/node_modules`, and `frontend/dist` are not source-of-truth files.

## Requirements

- Node.js 18 or newer.
- npm.
- Chrome or Edge for the best Web Speech API support.
- HTTPS or `localhost` for microphone, wake lock, service worker, and LAN phone workflows. The Vite config uses a self-signed HTTPS certificate in dev and preview.

## Setup

There is no root `package.json`; install backend and frontend dependencies separately.

In one terminal, start the backend from the repository root:

```powershell
cd backend
npm install
npm run dev
```

In a second terminal, start the frontend from the repository root:

```powershell
cd frontend
npm install
npm run dev
```

Open `https://localhost:5173/kirtan`. Accept the local certificate warning when the browser asks. The frontend proxies `/api/*` to `http://localhost:5000`, so the backend should be running at the same time.

Useful health checks:

```text
http://localhost:5000/health
http://localhost:5000/api/health
```

## Environment

Most settings have defaults. Create local `.env` files only when you need to override them; examples are in [backend/.env.example](backend/.env.example) and [frontend/.env.example](frontend/.env.example).

Backend optional `.env`:

```dotenv
PORT=5000
CORS_ORIGIN=http://localhost:5173,https://localhost:5173
BANIDB_BASE_URL=https://api.banidb.com/v2
BANIDB_TIMEOUT_MS=20000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=600
TRUST_PROXY=loopback
MIN_LINE_CONFIDENCE=50
```

The built-in CORS default is `http://localhost:5173`; the example above also allows the HTTPS development origin. `TRUST_PROXY` defaults to `loopback`, so the local Vite proxy can forward each phone's address for rate limiting and typed-code throttling. For a different reverse proxy, configure its address or CIDR explicitly. `false` disables proxy trust; `true` and numeric hop counts fall back to `loopback`.

Frontend optional `.env`:

```dotenv
# Leave empty or omit it to use the Vite /api proxy.
VITE_API_URL=

# Use a LAN HTTPS origin when QR links should open on phones.
VITE_PUBLIC_APP_URL=https://YOUR-LAN-IP:5173
```

`VITE_PUBLIC_REMOTE_URL` is also recognized as an older alias for public remote/follow links.

For LAN phones, use the computer's reachable LAN address, keep both servers running, and accept the local HTTPS certificate on each device. When using preview, point the public URL at port `4173` instead of `5173`.

## Scripts

Backend:

```powershell
cd backend
npm run dev      # nodemon development server
npm start        # node server.js
npm test         # Node test suites; local ephemeral ports, no BaniDB calls
```

Frontend:

```powershell
cd frontend
npm run dev              # HTTPS Vite dev server on 5173
npm run build            # production build to frontend/dist
npm run preview          # HTTPS preview on 4173, with /api proxy
npm test                 # Vitest recognition, tracking, capture and replay suites
npm run build:semantic   # rebuild public/semantic artifacts
npm run eval:semantic    # evaluate semantic recall fixtures
npm run replay:session -- ../path/to/session.json --verbose
npm run eval:recognition -- ../path/to/trace.json ../path/to/labels.json --out ../.cache/reports/session
```

PWA assets:

```powershell
node scripts/generate-pwa-assets.mjs
```

## Main Routes

Frontend routes:

- `/kirtan` - live Kirtan search and suggestions.
- `/katha` - Katha-oriented search and tracking.
- `/shabad/:id` - Shabad reader/tracker.
- `/ang/:ang` - full Ang reader/tracker.
- `/bani` and `/bani/:id` - Bani index and Bani reader.
- `/hukam` - daily Hukamnama.
- `/calendar` - Sikh/Nanakshahi calendar.
- `/projector` - passive projector display.
- `/remote` - phone/tablet remote controller.
- `/follow/:code` - Sangat View.
- `/setup` - audio/device preflight.
- `/credits` - data, license, and attribution notes.

Backend API:

- `GET /health` and `GET /api/health`
- `GET /api/shabads/search`
- `GET /api/shabads/ang/:ang`
- `GET /api/shabads/:id`
- `GET /api/banis/:id`
- `GET /api/hukamnamas/today`
- `POST /api/voice/suggest`
- `POST /api/voice/track-line`
- `GET /api/filters/raags`
- `GET /api/filters/writers`
- `GET /api/filters/sources`
- `/api/remote/*` for authenticated command polling/SSE, stream tickets, state, join/leave, heartbeat, control claims, grants, kicks, reset, and follow streams.

## Remote Pairing And Sangat View

Open the pairing panel in the main app header. Set `VITE_PUBLIC_APP_URL` to a LAN-reachable HTTPS origin before sharing links with phones.

- **Scan the remote QR:** enrolls a trusted device. The first trusted device takes control when control is free; later devices can request a handoff. The pairing link expires after five minutes.
- **Type the four-digit code at `/remote`:** enrolls a view-only device. The host or current controller must select **Allow** before it can control the session. Codes expire, rotate automatically, and are throttled per source.
- **Share the Sangat View link:** opens `/follow/:code` as a read-only display. It uses a separate follow code and does not grant remote control.
- **Select New code:** revokes existing paired devices and Sangat View links. Open Sangat View pages show that their link has expired.

Paired phones authenticate with their own stored device token, so automatic pairing-code rotation does not disconnect them. A backend restart or session expiry ends pairing and invalidates follow links. Deploy frontend and backend together, then reload open host and remote tabs when upgrading.

See [Remote control security](docs/security/remote-control.md) for credential lifetimes, enrollment rules, proxy configuration, and regression coverage.

## Recognition Capture And Evaluation

For trace-only diagnostics, open a Shabad viewer or a Katha Ang viewer, expand **Voice debug**, select **Record**, and export the JSON trace with **Download** after stopping it. Traces include recognized text, matching and navigation decisions, and projector timing evidence; this recording does not include audio.

For a combined audio/trace test, use a separate test session and stop the live mic first:

1. Expand **Voice debug**, then **Audio + trace test capture**, and confirm permission to record everyone audible.
2. Leave browser recognition off for audio-only capture, or explicitly enable provider processing for the test. Shared-track recognition is experimental and depends on browser support.
3. Select **Record test session**, perform the test, then **Stop test capture** and **Export capture bundle**.

Audio capture stops at ten minutes or 16 MiB of retained audio. Export each segment before starting another; closing or reloading the app can lose unexported data. Keep captures private. The capture/export system does not upload audio; separately enabled browser recognition may send it to its provider.

From the repository root, prepare a local review page in a new output directory:

```powershell
node tools/prepare-capture-review.mjs path/to/capture.zip --out .cache/review/new-session
```

Use `--canonical` and `--source-url` with a separately obtained BaniDB response to populate target choices, as described in the [capture review guide](docs/recognition-capture-and-accuracy.md#independent-annotation-assistance). Open the generated `index.html` and review the recording, canonical targets, and timing alignment independently. After exporting verified labels, evaluate the trace:

```powershell
node tools/evaluate-recognition.mjs .cache/review/new-session/trace.json path/to/reviewed.labels.json --out .cache/reports/new-session --require-metrics
```

Real Kirtan recognition accuracy remains unmeasured: the available evidence has no authentic application recordings scored against independently verified, synchronized labels. Synthetic fixture scores and deterministic matcher replay verify tooling behavior; they do not establish live recognition accuracy. See the [benchmark guide](docs/recognition-benchmark.md), [capture workflow and limitations](docs/recognition-capture-and-accuracy.md), and [real-world validation report](docs/recognition-real-world-validation.md).

## Architecture Notes

- BaniDB is the source for Shabad, Ang, Bani, Hukamnama, and filter data. The backend wraps it with retries, a 12-hour in-memory cache for stable data, Unicode Gurmukhi selection, and search fallbacks.
- Ang search uses BaniDB search type `5` and is kept separate from generic text-search fallbacks.
- Remote pairing state is process-local memory. Codes, clients, command queues, and follow state reset when the backend process restarts.
- Phone actions require a server-minted device token. Host command polling uses host authentication headers; SSE uses a single-use 30-second stream ticket so the host token never appears in a URL.
- The frontend API client caches Shabad, Ang, Bani, and Hukam responses in `localStorage` for 14 days and can return cached data while offline.
- The service worker registers only in production builds and caches the app shell/static assets. API JSON is intentionally handled by the app cache. Updates wait for the operator to choose a refresh; the first installation does not force a reload.
- Projector state sync uses `BroadcastChannel` with a `localStorage` fallback. Remote/follow sync uses backend state plus SSE/polling.
- Semantic search loads `frontend/public/semantic/manifest.json`, `embeddings.bin`, `index.json`, and `shabad-meta.json`, then runs `Xenova/multilingual-e5-small` in the browser through `@huggingface/transformers`.
- The semantic artifacts currently total about 28 MB and were generated on 2026-05-21 according to `public/semantic/manifest.json`.

## Development Notes

- Keep `backend/src/utils/gurmukhi.js`, `frontend/src/utils/gurmukhi.js`, and `frontend/src/utils/matchLine.js` aligned when touching normalization or line matching.
- The frontend line tracker is a hot path. Prefer local matching and stable memoized data over new network calls in short polling loops.
- Preserve Unicode Gurmukhi selection when changing BaniDB parsing; upstream may return legacy font encodings beside Unicode fields.
- Rebuild semantic artifacts after changing semantic document construction or metadata fields:

```powershell
cd frontend
npm run build:semantic
npm run eval:semantic
```

- The 2026 calendar data is static in `frontend/src/data/sikhCalendar.js`; browser-local corrections live through `calendarOverrides.js`.
- Use `/setup` and the live readiness button before real sessions to verify backend, mic, projector, queue preload, and offline pack state.

## Verification

For backend changes, run `npm test` from `backend/`, then start the API and check `http://localhost:5000/api/health`. Backend tests cover dependency floors, body parsing, remote authentication, host stream tickets, Sangat View revocation, and device enrollment without calling BaniDB.

For frontend changes, run `npm test` and `npm run build` from `frontend/`. Vitest covers recognition hooks, voice control, tracking, capture, evaluation, and replay; remote and Sangat View pages also need browser checks.

Before a live session or after changing a related feature, manually check:

- `/kirtan` search and mic, plus line tracking in `/shabad/:id`.
- Katha tracking and boundary movement in `/ang/:ang`.
- `/projector` state sync, idle/blank/emergency screens, and focus returning to the operator window after opening it.
- `/remote` QR enrollment, typed-code approval, control handoff, and reset.
- `/follow/:code` updates and link revocation after reset.
- `/setup` audio readiness and device checks.

## Further Documentation

- [Remote control security and pairing](docs/security/remote-control.md)
- [Recognition benchmark and trace recording](docs/recognition-benchmark.md)
- [Audio capture, independent review, and accuracy readiness](docs/recognition-capture-and-accuracy.md)
- [Real-world recognition validation](docs/recognition-real-world-validation.md)
- [Coding-agent repository guide](AGENTS.md)

## Data And Credits

Gurbani/Bani content and metadata are provided through BaniDB and related credited sources shown on the app's `/credits` page. Generated semantic artifacts, local caches, and offline packs may store portions of that data on the user's device for app functionality.

No standalone `LICENSE` file is present in this repository. Check `/credits` and the upstream data-source terms before redistribution.
