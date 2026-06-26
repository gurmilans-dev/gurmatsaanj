# AGENTS.md

This guide is for coding agents working in this repository. It reflects the actual project files as of this scan, not only the older README/CLAUDE notes.

## Project Shape

Gurmat Saanj is a local-network live Gurbani companion:

- Backend: Node 18+ / Express API in `backend/`.
- Frontend: React 18 / Vite app in `frontend/`.
- Data source: BaniDB v2 through the backend, plus generated semantic-search artifacts under `frontend/public/semantic/`.
- Live workflows: Kirtan, Katha, Shabad reader, Ang reader, Bani reader, projector, remote controller, Sangat View, Hukamnama, calendar, setup/readiness.

There is no root app package. Run backend and frontend commands from their own folders.

## Source Of Truth

Read and edit these when changing behavior:

- `backend/server.js`
- `backend/src/config/index.js`
- `backend/src/controllers/*`
- `backend/src/routes/*`
- `backend/src/services/banidb.service.js`
- `backend/src/services/matching.service.js`
- `backend/src/utils/gurmukhi.js`
- `frontend/src/App.jsx`
- `frontend/src/context/AppContext.jsx`
- `frontend/src/pages/*`
- `frontend/src/features/*`
- `frontend/src/hooks/*`
- `frontend/src/services/*`
- `frontend/src/utils/*`
- `frontend/src/data/*`
- `frontend/public/sw.js`
- `frontend/vite.config.js`
- `tools/*`
- `scripts/generate-pwa-assets.mjs`

Treat these as generated/vendor unless the task specifically targets them:

- `backend/node_modules/`
- `frontend/node_modules/`
- `frontend/dist/`
- `frontend/public/semantic/embeddings.bin`
- static PNG icon/splash/brand assets in `frontend/public/`

## Commands

Backend:

```powershell
cd backend
npm install
npm run dev
npm start
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
npm run build
npm run preview
npm run build:semantic
npm run eval:semantic
npm run replay:session -- ../path/to/session.json --verbose
```

PWA asset generation:

```powershell
node scripts/generate-pwa-assets.mjs
```

Health checks:

```text
http://localhost:5000/health
http://localhost:5000/api/health
```

## Environment Defaults

Backend defaults in `backend/src/config/index.js`:

- `PORT=5000`
- `CORS_ORIGIN=http://localhost:5173`
- `BANIDB_BASE_URL=https://api.banidb.com/v2`
- `BANIDB_TIMEOUT_MS=20000`
- `RATE_LIMIT_WINDOW_MS=60000`
- `RATE_LIMIT_MAX=600`
- `MIN_LINE_CONFIDENCE=50`

Frontend env usage:

- `VITE_API_URL` overrides the default `/api` base path.
- `VITE_PUBLIC_APP_URL` or `VITE_PUBLIC_REMOTE_URL` sets public QR/remote/follow links for phones.

Vite dev and preview use HTTPS with a self-signed cert and proxy `/api` to `http://localhost:5000`.

## Backend Notes

- `server.js` mounts `/health` and `/api/*`, applies security middleware, JSON limits, Morgan logging, 404 JSON, and centralized error handling.
- `banidb.service.js` owns BaniDB retries, 12-hour in-memory cache, Unicode Gurmukhi selection, search-type detection, Ang lookup, Bani lookup, daily Hukam, and fallback shaping.
- `matching.service.js` owns live Shabad suggestions and backend line tracking fallback with fuzzy scoring.
- `remote.controller.js` is process-local memory only. Remote sessions, pair codes, follow codes, clients, queues, and latest state are lost on backend restart.
- Do not add BaniDB search type `5` to generic text fallback chains; type `5` is Ang/page search.
- Preserve the `pickUnicode`/`isUnicodeGurmukhi` behavior when reshaping BaniDB responses.

Backend API map:

- `/api/shabads/search`, `/api/shabads/ang/:ang`, `/api/shabads/:id`
- `/api/banis/:id`
- `/api/hukamnamas/today`
- `/api/voice/suggest`, `/api/voice/track-line`
- `/api/filters/raags`, `/writers`, `/sources`
- `/api/remote/command`, `/commands`, `/stream`, `/state`, `/join`, `/leave`, `/kick`, `/heartbeat`, `/claim`, `/release`, `/grant`, `/reset`, `/follow/:code/state`, `/follow/stream`

## Frontend Notes

- `App.jsx` defines the route tree. `/projector` and `/follow/:code` render outside the normal layout.
- `AppContext.jsx` is the central state layer for voice, display prefs, theme/lang, selected Shabad, queues, history/favourites, projector, remote pairing, offline packs, and localStorage migrations.
- `services/api.js` uses axios with `/api` by default, one retry for network/timeouts, and 14-day localStorage cache for Shabad/Ang/Bani/Hukam data.
- `services/projector.js` syncs projector state through `BroadcastChannel` plus localStorage fallback.
- `services/semanticSearch.js` loads the semantic artifacts and browser-side `@huggingface/transformers`.
- `hooks/useLineTracking.js` and `utils/matchLine.js` are live hot paths. Avoid adding backend calls or unstable dependencies to short polling loops.
- `hooks/useKathaLineTracking.js` handles nearby Shabad/Ang groups for Katha; test boundary movement carefully.
- `hooks/usePageVoiceTracking.js` is shared by Shabad/Ang pages for reader mic tracking.
- `hooks/useAnandSahibWatch.js` opens the Anand Sahib bundle from recognized transcript.
- `features/session/*` provides queue/history library, crash recovery, live readiness, and keyboard emergency shortcuts.
- `public/sw.js` caches the app shell/static assets. API JSON is intentionally cached by the app, not by the service worker.

## Matching And Gurmukhi Safety

When changing matching or normalization:

- Keep backend and frontend Gurmukhi helpers conceptually aligned.
- Keep `frontend/src/utils/matchLine.js` deterministic; `tools/replay-session.mjs` depends on exact replay behavior.
- Test Devanagari-to-Gurmukhi conversion, vowel/matra drift, first-letter shorthand, Rahao lines, and Ang order.
- For Kirtan, avoid aggressive auto-advance unless the confidence and current-shabad checks are strong.
- For Katha, preserve locality/boundary gates so the tracker does not jump across unrelated lines.

## Semantic Search

Generated artifacts live in `frontend/public/semantic/`:

- `manifest.json`
- `embeddings.bin`
- `index.json`
- `shabad-meta.json`

Rebuild from `frontend/`:

```powershell
npm run build:semantic
npm run eval:semantic
```

Useful env vars:

- `SEMANTIC_MAX`
- `SEMANTIC_CONCURRENCY`
- `SEMANTIC_RESUME`
- `SEMANTIC_ID_START`
- `SEMANTIC_ID_END`
- `EVAL_K`
- `EVAL_VERBOSE=1`

The build script reaches into `backend/src/services/banidb.service.js` and `frontend/node_modules/@huggingface/transformers`.

## UI And Browser Constraints

- Target Chrome/Edge for speech recognition.
- Secure context matters: microphone, wake lock, service worker, and LAN phone flows need HTTPS or localhost.
- Phones scanning QR links need a LAN-reachable base URL, usually via `VITE_PUBLIC_APP_URL=https://<LAN-IP>:5173`.
- Keep live-service controls dense, reliable, and readable on mobile. This is an operational app, not a marketing landing page.
- Projector and Sangat View must tolerate blank/emergency/idle states and missing remote state without crashing.

## Verification

For docs-only edits, inspect the changed markdown.

For frontend behavior changes:

```powershell
cd frontend
npm run build
```

For backend changes, at minimum start the API and hit health:

```powershell
cd backend
npm run dev
```

Then open:

```text
http://localhost:5000/api/health
```

For live features, manually verify in a browser:

- `/kirtan` search and mic
- `/shabad/:id` line tracking
- `/ang/:ang` Katha tracking if touched
- `/projector` state sync
- `/remote` pairing/control if touched
- `/follow/:code` if remote/follow state changed
- `/setup` if audio code changed

There are no formal automated test scripts in `package.json` at the moment.

## Current Gotchas

- The old `CLAUDE.md` has several stale route/component/default notes. Prefer this file and the source tree.
- `backend/.env.example` and `frontend/.env.example` exist and should stay aligned with actual config defaults.
- `README.md` should not claim rate limit default is 60; the current default is 600.
- Remote state is not durable.
- Service worker registration only happens in production builds.
- `frontend/public/semantic/*` is large and generated; do not hand-edit it.
