# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Saanj Kirtan** is a full-stack web application that listens to live kirtan (Sikh devotional singing), detects which Shabad is being sung in real time, and auto-scrolls through the verses. It combines the Web Speech API (for Punjabi voice recognition) with fuzzy matching and BaniDB (public Sikh scripture database) to provide a live companion for Gurudwara sessions.

**Key features:**
- Live voice recognition in Punjabi (pa-IN) via Web Speech API
- Real-time Shabad detection with fuzzy matching and confidence scores
- Manual search with three modes: full Gurmukhi, romanized transliteration, first-letter shorthand
- On-screen Gurmukhi keyboard
- Filters by Raag, Writer (Guru/Bhagat/Bhai), and source Granth
- Bilingual display (Gurmukhi + English transliteration/translation)
- Calender
- Security hardening (Helmet, CORS, rate-limiting, CSP, input validation)

## Tech Stack

**Backend:**
- Node.js (>=18), Express 4.x
- axios for BaniDB API calls
- fuzzball for fuzzy matching (token_set_ratio)
- helmet, cors, express-rate-limit for security
- morgan for request logging
- nodemon for development

**Frontend:**
- React 18.3.1
- React Router 6.26.2
- Vite 5.4.6 for bundling
- Axios for API client
- CSS custom properties for theming (no CSS-in-JS)

## Architecture

### Data Flow

```
User speaks or types query
    → Frontend (Web Speech API or manual input)
    → POST /api/voice/suggest { transcript, filters }
    → Backend matching.service.matchShabads()
       - Fetches candidates from BaniDB via cascading search
       - Applies dual-channel fuzzy matching (full + vowel-stripped)
       - Returns top 8 suggestions with confidence scores
    → Frontend displays suggestions
    → User clicks a suggestion → navigate to /shabad/:id
    → GET /api/shabads/:id → fetch full Shabad verses
    → Live tracking: POST /api/voice/track-line { shabadId, transcript, verses }
       - Matching service finds which line is currently being sung
       - Frontend auto-scrolls to that line
```

### Backend Structure

```
backend/
├── server.js                      # Express app entry, security middleware, routes
├── src/
│   ├── config/index.js            # Env-based config (port, CORS, BaniDB, rate limits)
│   ├── middleware/
│   │   ├── security.js            # helmet, CORS, rate-limiting setup
│   │   └── errorHandler.js        # Global error handler
│   ├── routes/
│   │   ├── index.js               # Main router (mounts /shabads, /voice, /filters)
│   │   ├── shabad.routes.js       # GET /shabads/search, GET /shabads/:id
│   │   ├── voice.routes.js        # POST /voice/suggest, POST /voice/track-line
│   │   └── filter.routes.js       # GET /filters/{raags,writers,sources}
│   ├── controllers/
│   │   ├── shabad.controller.js   # search() and getShabad() handlers
│   │   ├── voice.controller.js    # suggestShabads() and trackLine() handlers
│   │   └── filter.controller.js   # raags(), writers(), sources() handlers
│   ├── services/
│   │   ├── banidb.service.js      # HTTP proxy + caching (12h TTL) for BaniDB API
│   │   │                           # Handles Unicode normalization (AnmolLipi → Unicode)
│   │   │                           # Smart search type detection (0/7=first-letter, 2=Gurmukhi, 4=Roman)
│   │   │                           # Cascading fallbacks if primary search type fails
│   │   └── matching.service.js    # matchShabads() and matchLine() using fuzzy logic
│   │                               # Dual-channel scoring: 65% full match + 35% vowel-stripped
│   │                               # Cascading tail windows (6→4→3→2 words) + first-letter projection
│   └── utils/
│       └── gurmukhi.js            # Normalization: Devanagari→Gurmukhi, vowel stripping, tokenization
│                                   # Unicode detection (U+0A00–U+0A7F block check)
└── .env.example                    # PORT, CORS_ORIGIN, BANIDB_BASE_URL, rate limits, MIN_LINE_CONFIDENCE
```

**Key services:**

- **banidb.service.js**: Thin cached HTTP client wrapping `https://api.banidb.com/v2`. Handles the quirk that BaniDB returns both legacy ASCII-font (AnmolLipi/GurbaniAkhar) and Unicode Gurmukhi; always picks Unicode via `pickUnicode()`. Implements smart search type detection and cascading fallbacks.

- **matching.service.js**: Core fuzzy matching engine. Uses `fuzzball.token_set_ratio()` for scoring. Two channels: full normalization (consonants + vowels) at 65% weight, loose (consonants only) at 35%. Handles "always show something" via cascading tail windows and first-letter projection.

### Frontend Structure

```
frontend/
├── index.html                      # Entry point; mounts React app
├── vite.config.js                  # Vite config + dev proxy (/api → localhost:5000)
├── src/
│   ├── main.jsx                    # React root render
│   ├── App.jsx                     # Router + Layout
│   ├── context/
│   │   └── AppContext.jsx          # Global state: voice recognition, filters, display prefs
│   ├── pages/
│   │   ├── HomePage/               # Voice recognizer + live suggestions
│   │   ├── SearchPage/             # Manual search interface
│   │   └── ShabadPage/             # Full Shabad + line tracking
│   ├── features/
│   │   ├── voiceRecognition/       # VoiceRecognizer, ShabadSuggestions components
│   │   ├── search/                 # SearchBar, SearchResults, GurmukhiKeyboard
│   │   ├── filters/                # FilterPanel
│   │   └── shabadView/             # ShabadView (verses + line highlighting)
│   ├── hooks/
│   │   ├── useVoiceRecognition.js  # Web Speech API wrapper (Chrome/Edge/Safari)
│   │   │                            # Handles continuous listening + auto-restart (~60s Chrome limit)
│   │   │                            # Separates final vs interim results
│   │   ├── useLineTracking.js      # Line-by-line tracking state
│   │   └── useShabadMatching.js    # Polling for suggestions during listen
│   ├── services/
│   │   └── api.js                  # Centralized axios client with retry on network blips
│   ├── utils/
│   │   └── gurmukhi.js             # Frontend version of Gurmukhi utils (mirrors backend)
│   ├── components/common/
│   │   ├── Header, Footer, Layout, Loader, ConfidenceBadge
│   └── styles/
│       └── variables.css, global.css, reset.css
└── .env.example                    # VITE_API_URL (optional; dev uses proxy)
```

**Key hooks:**

- **useVoiceRecognition()**: Wraps Web Speech API. Returns `{ isSupported, isListening, transcript, lastFinal, error, start(), stop(), reset() }`. Handles browser differences (webkit vs standard), continuous listening with auto-restart, and interim vs final separation.

- **useShabadMatching()**: Polls `/api/voice/suggest` during active listening, debounces requests, and surfaces top suggestions.

- **useLineTracking()**: Subscribes to live transcript + current Shabad, polls `/api/voice/track-line` to find which verse is being sung.

## Common Commands

### Backend

```bash
cd backend

# Install dependencies
npm install

# Development (auto-reload with nodemon)
npm run dev          # → http://localhost:5000

# Production
npm start            # Runs server.js directly
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Development (Vite dev server with /api proxy)
npm run dev          # → http://localhost:5173
# The proxy in vite.config.js routes /api/* to localhost:5000

# Build for production
npm run build        # → dist/

# Preview production build locally
npm run preview
```

### Full Stack

```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev

# Open http://localhost:5173
```

## Key Design Patterns

### "Always Show Something" Strategy

The matching service never returns an empty result set:

1. **Cascading BaniDB search**: Try recent 6 words, then 4, then 3, then 2. Stop at first success.
2. **First-letter fallback**: Also project the transcript to first-letter shorthand and search via BaniDB's native first-letter mode.
3. **Fuzzy re-ranking**: Collect all candidates, re-rank with dual-channel scoring. If confidence is low, mark as "best guess" instead of hiding the result.

### Dual-Channel Fuzzy Scoring

Both backend and frontend use the same normalization pipeline:

1. **Full channel** (65% weight): Consonants + vowel signs normalized. Catches exact matches and near-misses.
2. **Loose channel** (35% weight): Consonants only (vowels stripped). Catches cases where the speech engine flips vowels or drops matras.

Scoring formula: `0.65 * full_ratio + 0.35 * loose_ratio`

### Gurmukhi Normalization

Accounts for three sources of transcription error:

1. **Devanagari confusion**: Speech API sometimes returns Hindi (Devanagari) when set to Punjabi. Map via `DEVA_TO_GURMUKHI` lookup table.
2. **Diacritic drift**: Strip matras and vowel signs for loose matching (often misplaced by speech engine).
3. **Case and punctuation**: Lowercase and strip Gurmukhi/ASCII punctuation.

### Unicode Preservation

BaniDB sometimes returns legacy ASCII-font encodings (AnmolLipi, GurbaniAkhar) alongside Unicode. The code always picks Unicode (U+0A00–U+0A7F) via `isUnicodeGurmukhi()` check and `pickUnicode()` helper, ensuring the UI never displays garbled glyphs.

### BaniDB Caching

The `banidb.service.js` implements a simple 12-hour in-memory cache for `/raags`, `/writers`, `/sources` (slow-changing metadata). Reduces load on upstream and improves perceived responsiveness.

## Environment Variables

### Backend (`.env`)

```
PORT=5000                              # Express listen port
CORS_ORIGIN=http://localhost:5173      # Frontend origin (comma-separated for multiple)
BANIDB_BASE_URL=https://api.banidb.com/v2
RATE_LIMIT_WINDOW_MS=60000             # Request throttling window
RATE_LIMIT_MAX=60                      # Max requests per window
MIN_LINE_CONFIDENCE=55                 # Minimum fuzzy score to mark a line as "tracked"
```

### Frontend (`.env`)

```
VITE_API_URL=                          # Optional; leave empty for dev proxy (/api → localhost:5000)
```

## Security

- **Helmet**: Sets sane HTTP headers (CSP, X-Frame-Options, X-Content-Type-Options, etc.).
- **CORS**: Restricted to configured origins; allows origin-less requests (e.g., curl, mobile apps).
- **Rate-limiting**: Per-IP request throttling (default 60 req/min).
- **Input validation**: Transcript clamped to 300 chars, shabadId sanitized, query length bounds enforced.
- **No audio transmission**: Web Speech API transcription happens locally; only text reaches the backend.

## Testing & Debugging

- **Health check**: `GET /api/health` returns `{ status: 'ok', uptime, name }`
- **BaniDB caching**: Check `banidb.service.js` cache map; 12h TTL per entry
- **Fuzzy matching**: Token_set_ratio in `matching.service.js`; adjust `MIN_QUERY_TOKENS`, `maxSuggestions` in config
- **Voice issues**: Check browser support (Chrome/Edge work best), language set to `pa-IN`, interim vs final separation in `useVoiceRecognition.js`

## Notes for Future Contributors

1. **Gurmukhi expertise**: If you modify normalization or fuzzy logic, test against edge cases like Devanagari confusion, vowel-heavy phrases, and first-letter shorthand.

2. **BaniDB API schema**: The upstream API is stable but sometimes returns fields in multiple encodings (`gurmukhi` vs `unicode` vs `gurmukhiUni`). Always use `pickUnicode()` and `isUnicodeGurmukhi()` checks.

3. **Search type cascading**: `banidb.service.js` tries search types in order `[detected, 0, 7, 4, 2]` where 0/7 cover first-letter modes, 2=Gurmukhi, and 4=Roman. Do not add search type 5 to generic text fallbacks; BaniDB uses it for Ang/page search.

4. **Frontend dev proxy**: Vite's dev proxy in `vite.config.js` routes `/api` calls to the backend. If the backend changes port, update the proxy target.

5. **Voice recognition edge cases**: Chrome stops recognition ~60s; the code auto-restarts via `wantsListeningRef`. Firefox has limited support. Test in target browsers.

6. **Rate limiting**: Default is 60 req/min/IP. Adjust `RATE_LIMIT_MAX` in config if the frontend polling interval becomes more aggressive.
