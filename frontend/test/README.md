# Recognition regressions

From `frontend/` in PowerShell:

```powershell
npm ci
npm test
npm run build
```

Run one area with `npm test -- test/useAutoShabadAdvance.test.js`.

The hook tests use React 18's test renderer, fake timers, deferred promises,
and mocked API methods. No microphone, browser speech service, or BaniDB
connection is needed. The controller tests replace its CommonJS service
dependencies and do not require a backend dependency installation.

Replay tests launch the real CLI against fixed fixtures: exact parity exits
with 0; a mismatch exits with 1 after printing its report. These fixtures test
reproducibility and CLI behavior, not accuracy on a real performance.

The suite covers V1 query freshness, V5 request lifetime, and V13 replay exit
status. Queue priority, the existing switch cooldown, unchanged-query
deduplication, and short-input behavior are retained as passing controls.
