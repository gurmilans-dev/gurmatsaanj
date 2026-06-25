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
- Remote controller with pair code, control approval, queue tools, mic controls, projector controls, and line navigation.
- Sangat View (`/follow/:code`) for read-only phones using the remote follow code.
- Session tools: queue timeline, history, saved Shabads, preloading, crash recovery, readiness checks, and keyboard emergency shortcuts.
- PWA shell, generated icons/splash screens, service worker runtime cache, local API cache, and offline session packs.
- 2026 Sikh/Nanakshahi calendar data, local correction overlays, suggested Shabad preparation, and daily Hukamnama.

The app posts recognized transcript text to its own API for matching. Microphone capture itself is handled by the browser.

## Repository Map

```text
.
|-- backend/                         Express API
|   |-- server.js                    App entry, middleware, routes, errors
|   |-- package.json
|   `-- src/
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
|-- tools/                           Semantic index/eval and session replay
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

Backend:

```powershell
cd backend
npm install
npm run dev
```

Frontend:

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

Most settings have defaults. Create local `.env` files only when you need to override them.

Backend optional `.env`:

```dotenv
PORT=5000
CORS_ORIGIN=http://localhost:5173,https://localhost:5173
BANIDB_BASE_URL=https://api.banidb.com/v2
BANIDB_TIMEOUT_MS=20000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=600
MIN_LINE_CONFIDENCE=50
```

Frontend optional `.env`:

```dotenv
# Leave empty or omit it to use the Vite /api proxy.
VITE_API_URL=

# Use a LAN HTTPS origin when QR links should open on phones.
VITE_PUBLIC_APP_URL=https://YOUR-LAN-IP:5173
```

`VITE_PUBLIC_REMOTE_URL` is also recognized as an older alias for public remote/follow links.

## Scripts

Backend:

```powershell
cd backend
npm run dev      # nodemon development server
npm start        # node server.js
```

Frontend:

```powershell
cd frontend
npm run dev              # HTTPS Vite dev server on 5173
npm run build            # production build to frontend/dist
npm run preview          # HTTPS preview on 4173, with /api proxy
npm run build:semantic   # rebuild public/semantic artifacts
npm run eval:semantic    # evaluate semantic recall fixtures
npm run replay:session -- ../path/to/session.json --verbose
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
- `/api/remote/*` for command polling/SSE, state, join/leave, heartbeat, control claims, grants, kicks, reset, and follow streams.

## Architecture Notes

- BaniDB is the source for Shabad, Ang, Bani, Hukamnama, and filter data. The backend wraps it with retries, a 12-hour in-memory cache for stable data, Unicode Gurmukhi selection, and search fallbacks.
- Ang search uses BaniDB search type `5` and is kept separate from generic text-search fallbacks.
- Remote pairing state is process-local memory. Codes, clients, command queues, and follow state reset when the backend process restarts.
- The frontend API client caches Shabad, Ang, Bani, and Hukam responses in `localStorage` for 14 days and can return cached data while offline.
- The service worker caches the app shell/static assets only. API JSON is intentionally handled by the app cache.
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

## Data And Credits

Gurbani/Bani content and metadata are provided through BaniDB and related credited sources shown on the app's `/credits` page. Generated semantic artifacts, local caches, and offline packs may store portions of that data on the user's device for app functionality.

No standalone `LICENSE` file is present in this repository. Check `/credits` and the upstream data-source terms before redistribution.
