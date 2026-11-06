# Recognition regressions

The recording/evaluation guide and Windows workflow are in
[`docs/recognition-benchmark.md`](../../docs/recognition-benchmark.md).
Run the suite with `TEST_RECORDING=1` to repeat it with recording enabled
and validate each emitted trace. Benchmark fixtures are explicitly synthetic.

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

The suite covers V1 query freshness, V2 transition policy, V3 hold recovery,
V5 request lifetime, and V13 replay exit status. Queue priority, the existing
switch cooldown, unchanged-query deduplication, and short-input behavior are
retained as passing controls. No dependency or matching algorithm changes
are required for the transition tests.

`shabadTransitions.test.js` checks repeated Pangtis and Rahao, weak and
ambiguous scores, current-versus-alternative margins, queue selection,
temporal confirmation, gaps, manual overrides, cancellation, and stalled
requests. `followHold.test.js` exercises the real line-tracking and hold hooks
with a controlled matcher. `shabadPageTransitions.test.js` renders the actual
page with mocked voice input, APIs, and child views; it verifies background
discovery during hold, stable projector state, manual corrections, and Katha
mode isolation. The V5 tests prime one candidate observation before delaying
the confirming response, so an invalid response could otherwise navigate.

## Verified defects and policy

- A local `tracked` result at 45 previously vetoed all discovery, even when
  recent initials were absent from the current Shabad. Local cursor confidence
  now has no veto over identity discovery. Current-text initials still cancel
  discovery, including pending requests.
- The old global margin applied only when current scored at least 70,
  permitting alternative 60 to replace current 69. Every candidate now needs
  a lead of 10 over current and 8 over competing alternatives. The confidence
  floor remains 60. Queue order bonuses cannot resolve score ambiguity; queued
  candidates also need a raw-score lead over current text matched locally on
  the same query. The matcher itself is unchanged.
- The page previously disabled discovery on auto-hold. Auto-hold now freezes
  the displayed Pangti while discovery continues. Manual lock or a manual
  Pangti selection blocks navigation and invalidates pending discovery; each
  manual anchor also starts a five-second quiet window.
- Hold freshness previously depended only on changes to `tracked` and
  `confidence`. The line tracker now emits a timestamped observation for fresh
  transcript text, including appended repetitions with the same five-word
  tail and score. Re-rendering or advancing the clock without new text does
  not refresh that evidence. A fresh match at 50 still resumes follow; the
  existing 2.5-second hold threshold is unchanged.

Discovery still starts after two distinct missing-initial observations.
Navigation additionally requires two qualifying observations of the same
candidate, with different signatures and at least 1.2 seconds between query
times. Queries are spaced by at least 1.2 seconds. Candidate evidence and
responses expire after four seconds. Current-text evidence, weak/ambiguous
results, context changes, manual corrections, and input gaps discard pending
confirmation. A stalled request cannot retain the discovery lock after its
freshness window once new input arrives. The five-second cooldown after a
committed switch remains in force. No timer alone can trigger navigation.

## Regression evidence

Before production edits, the first run had **24 failures and 31 passes**:
all 24 existing V1/V5/V13 tests passed; 24 of the initial 31 transition/hold
tests reproduced defects. After the fixes, all 31 new tests passed. Three
additional cases cover stronger current text against queued candidates,
stalled-request recovery, and a sustained manual lock. The complete final
suite has **58 passing tests** across seven files. Production build succeeds
with the existing large-chunk warning.

## Limits

These are controlled state-machine regressions, not labeled-audio accuracy
measurements. Two rolling transcript windows may overlap. Long instrumental
gaps, speech recognition stalls, repeated identical initials, slow API replies,
or closely scored Shabads can delay a switch or require operator action. The
confirmation interval adds at least 1.2 seconds after the first qualifying
query; a manual correction adds a five-second quiet window. Conservative
score gaps can also retain the current Shabad when a genuine transition is
ambiguous.

Weak explanation prose and one isolated quotation do not switch in the
fixtures. Sustained spoken quotation that produces repeated strong matches
cannot be distinguished reliably from singing using transcripts alone. The
independent Anand Sahib watcher and the optional end-of-queue countdown are
unchanged and do not use this new confirmation policy. Katha tracking and
remote authentication are unchanged.

A browser smoke check was attempted with local fixture APIs and synthetic
speech input. Computer Use stopped before opening the fixture tab because
it could not verify the existing browser URL. No browser or live-microphone
validation is claimed; the automated page integration tests provide the
display/navigation regression coverage.
