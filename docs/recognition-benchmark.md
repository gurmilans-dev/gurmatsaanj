# Recognition benchmark and recording guide

For the automated external-reference workflow and measured Phase 4 results,
see [Recognition real-world validation](recognition-real-world-validation.md).
The manual annotation instructions below remain an optional low-level workflow.

This phase adds optional measurement, not a recognition change. Matching
weights, thresholds, temporal confirmation, hold/cooldown periods, recognition
models, ranking, and remote authorization retain their existing behavior.
There are no independently annotated live recordings in this repository.
The supplied example is **synthetic**, with deliberately incorrect outputs;
its scores are arithmetic regression checks, not Gurbani recognition accuracy.

## Windows quick start

Use the application built from the revision you intend to measure. Keep its
revision/build identifier with your recording; do not infer the recorded build
from whichever checkout happens to evaluate the file later.

1. Open a Shabad in Kirtan mode, or a Shabad/Ang in Katha mode. Expand **Voice
   debug**. Click **Record** before starting the mic/performance. Recording is
   off by default. It records transcript text and diagnostics, not audio.
2. If you have separately arranged an audio/video recording, click **Sync
   marker** while making an identifiable cue in that recording. Repeat near
   the end. The trace contains numbered `session` / `sync-marker` events.
   Account for the uncertainty between the click and the audible/visible cue.
   No recording is uploaded by this diagnostic system.
3. Use the live app normally. Open the projector if projector delivery is part
   of the measurement. Click **Stop**, then **Download**. Recording survives
   navigation between pages in the same app window. A reload loses the
   in-memory recording; export first. Starting another recording replaces it.
4. Save the downloaded JSON under this worktree's ignored `.cache/recordings/`
   directory, or another location you control. Retain the original unchanged.
5. Create a blank annotation file, then label the performance independently:

   ```powershell
   Set-Location 'C:\Users\gurmi\Desktop\Projects\gurmatsaanj-tests'
   node tools/evaluate-recognition.mjs .cache/recordings/service.json --init-labels .cache/recordings/service.labels.json
   ```

   The template intentionally starts with `independent: false` and an
   ambiguous segment. It does not copy predictions into the labels.
6. Review audio/video without using the application's predicted line as the
   answer. Find the canonical Shabad/verse from an independent Gurbani source.
   Enter labeled intervals and set `provenance.independent` to `true` only after
   this review. Prefer canonical `verseId` plus `shabadId`. Line indexes are
   **zero-based** within the captured group; they are not Ang-wide canonical
   verse identifiers. Verify IDs against your chosen canonical source.
7. Generate JSON and Markdown reports, optionally including an observed-state
   timeline:

   ```powershell
   node tools/evaluate-recognition.mjs .cache/recordings/service.json .cache/recordings/service.labels.json --out .cache/reports/service --timeline .cache/reports/service.timeline.json
   ```

   Or from `frontend/`:

   ```powershell
   npm run eval:recognition -- ../.cache/recordings/service.json ../.cache/recordings/service.labels.json --out ../.cache/reports/service
   npm run replay:session -- ../.cache/recordings/service.json --verbose
   ```

The replay command tests Kirtan matcher-call parity. The evaluation command
measures recorded committed outputs against your independent labels. They
answer different questions.

## What was missing

The original v1 recorder captured only Kirtan `matchLine()` inputs and proposed
results: wall-clock-relative `t`, cumulative transcript, five-word tail,
recorded current line, proposed line, score, and `tracked`. It stored Gurmukhi
verse text per Shabad, evicting old events at 60,000 entries. It did not record
recognition revisions/lifecycle, Katha decisions, far-jump confirmation,
tracker commitments, hold changes, operator actions, page selection, successful
route changes, or projector delivery. It could not establish display accuracy,
navigation accuracy, latency, recovery, or intervention rate.

V1 query freshness, V2 score/confirmation policy, V3 hold recovery, V5 request
lifetime, and V13 replay exit behavior were verified in source and the existing
58-test suite before implementation. Existing regression notes are in
`frontend/test/README.md`; no separate historical audit report is checked in.

## Trace v2

The JSON envelope is:

```json
{
  "version": 2,
  "app": "saanj-kirtan",
  "sessionId": "opaque-recording-id",
  "clock": "relative-monotonic-ms",
  "startedAt": 0,
  "durationMs": 10000,
  "eventCount": 0,
  "metadata": { "mode": "kirtan", "synthetic": false },
  "capture": { "complete": true, "reason": null },
  "shabads": {},
  "events": []
}
```

`startedAt` is a human wall-clock reference, not a latency clock. Event `t` is
relative to `performance.now()` in the recording window. Events have unique
`id`, nondecreasing `t`, `type`, and allowlisted `data`. Equal timestamps retain
array order; the evaluator never silently sorts malformed recordings.
`recognitionTrace.js` validates the schema, including legacy matcher records.

| Event type | Evidence |
| --- | --- |
| `session` | Start/stop and operator sync markers |
| `recognition` | Stream, engine epoch, source/language, start/stop/restart/error/reset; incremental final `append` and replacement `interim` |
| `matcher` | Actual bounded query tail, recorded matcher input position, proposed position, score, acceptance/rejection reason, input event reference when available; Katha competitors |
| `tracker` | Committed internal cursor state or deferred/rejected commit, including pending far-line information |
| `discovery` | Misses, request/result IDs, captured candidates, pending confirmation, expiry/cancellation, rejection, policy commitment, evidence age and remaining cooldown |
| `hold` | Following/held/locked/idle state and evidence age |
| `manual` | Observed operator line correction, lock/unlock, or instrumented Shabad/queue control |
| `navigation` | Requested navigation versus a successfully loaded page; automatic/operator provenance when a recorded request can be correlated |
| `page` | Position actually selected by the committed page, with hold/tracked/manual flags |
| `projector.publish` | Sender publication ID and projected canonical position/mode |
| `projector.ack` | Receiver ID, publication ID, received/React-committed phase, and sender-clock round-trip upper bound |
| `projector.render` | Reserved for output evidence already correlated to trace time; exercised only by synthetic test data in this phase |

A position has `shabadId`, `groupId`, `verseId` when supplied by the data, and
nullable `lineIndex`. `groupId` disambiguates Shabad/Ang-local indexes. With
canonical IDs on both sides, compare Shabad + verse IDs. Otherwise comparison
requires the same group and valid local indexes. Missing identity is not
guessed from text or a confidence score. Source-provided fallback IDs must
still be verified when preparing independent canonical labels.

The canonical dictionary stores only Gurmukhi and verse/Shabad identifiers,
once per captured group. It excludes translations, images, QR links, pairing
codes, tokens, host/client credentials, URLs, and environment values.
Loading, error, and unmounted pages explicitly record an empty selection;
the evaluator does not silently carry their previous page position forward.

Recognition final fragments are appended once per observed recognition batch;
interim text replaces the prior interim revision. A recording started mid-mic
gets a bounded initial tail and an explicit `baselineTruncated` indicator when
earlier final text is omitted. This is not a complete historical ASR transcript.
Start recording before the mic for the cleanest inputs. Matcher tails remain
recorded separately so individual Kirtan calls can still be checked.

Runtime evidence-age fields observe the existing policy's wall-time arithmetic;
they do not change it. Performance metrics use monotonic event time, not those
policy age fields. A system wall-clock adjustment can affect the existing live
policy independently of this trace clock.

## Projector timing and output identity

Publication is not receipt. Receipt is not a React commit. A React commit is
not proof that pixels reached the physical screen.

While recording, a state message gets an optional diagnostic envelope containing
only recording/publication IDs. The projector acknowledges receipt and the
React state commit. The sender timestamps acknowledgement arrival on its own
monotonic clock. The actual receive/commit time lies between publication and
acknowledgement arrival. No unrelated browser clocks are subtracted. Duplicate
acknowledgements are deduplicated by publication, receiver, and phase.

The report therefore provides round-trip **upper bounds**, not exact projector
latency or time-weighted projector accuracy. Exact projector metrics are
unavailable for ordinary v2 recordings in this phase. The acknowledged
canonical position follows the projector's opening-verse fallback, but overlays,
browser paint, display hardware, and physical presentation are not measured.
Multiple projector receivers remain separately identifiable in raw events.

When recording is off, projector state messages retain their original shape
and no diagnostic acknowledgements are requested. Persisted app state and remote
authentication/pairing are unchanged. `AppContext.jsx` is untouched.

## Independent annotation

Each segment is a half-open interval `[startMs, endMs)` with a unique occurrence
ID, activity, and an explicit target or `null`. Supported activities are
`kirtan`, `katha`, `silence`, `instrumental`, `explanation`, and `ambiguous`.

Use separate occurrence IDs for repeated Pangtis and Rahao returns, even when
they share a target. Label skipped verses and Shabad changes as actually
performed. Do not infer a sequential verse order. Use `target: null` for
instrumental/silent/spoken passages without a reliably determined canonical
target, and mark uncertain boundaries/lines ambiguous. An explicit independently
justified target may also describe the desired display during an explanation.

```json
{
  "version": 1,
  "sessionId": "opaque-recording-id",
  "synthetic": false,
  "timebase": "trace-relative-ms",
  "timingUncertaintyMs": 100,
  "provenance": { "independent": true, "method": "Independent audio review" },
  "segments": [
    { "id": "phrase-1", "startMs": 2000, "endMs": 8000,
      "activity": "kirtan",
      "target": { "shabadId": "verified-id", "verseId": "verified-verse" } },
    { "id": "gap-1", "startMs": 8000, "endMs": 10000,
      "activity": "instrumental", "target": null }
  ]
}
```

This snippet is a format illustration, not annotated live data.

For labels made against separate audio/video, use `timebase: "media-ms"` and
add at least two independent synchronization anchors:

```json
"alignment": {
  "anchors": [
    { "mediaMs": 1000, "traceMs": 0 },
    { "mediaMs": 61000, "traceMs": 60000 }
  ]
}
```

The tool maps between ordered anchors by piecewise-linear interpolation,
accounting for measured drift. It refuses extrapolation and a lone anchor.
Record your timing uncertainty honestly; do not use zero just to obtain a
latency statistic. Uncertainty trims segment boundaries for time-weighted
accuracy and makes exact transition latency unavailable. Labels remain
independent of predictions; a synchronization cue is timing evidence only.

To inspect marker times in PowerShell:

```powershell
$trace = Get-Content -Raw -Encoding UTF8 .cache/recordings/service.json | ConvertFrom-Json
$trace.events | Where-Object { $_.type -eq 'session' -and $_.data.action -eq 'sync-marker' } | Select-Object t, data
```

## Metric calculation rules

| Metric | Rule and denominator |
| --- | --- |
| Display accuracy | Correct canonical Shabad + Pangti milliseconds / independently labeled target milliseconds, with uncertain boundary regions excluded |
| Shabad accuracy | Same time weighting, comparing Shabad identity only |
| False line jumps | Incorrect committed page line changes within the correct Shabad; includes incorrect manual commits. Initial acquisition and Shabad changes are not line jumps |
| False automatic Shabad switches | Successful automatic page Shabad changes to an incorrect labeled Shabad; requested/cancelled navigation is not counted |
| False-event rates | Count / hours of evaluable labeled target material; unscorable gap/ambiguous changes are listed separately |
| Transition latency | From a distinct labeled target/return to the first correct run lasting `stableMs`, default 1000 ms. The reported latency is the run's start, with confirmation time also retained |
| Undetected transitions | No stable correct run before the labeled occurrence ends. Unknown output and occurrences shorter than the stability window are separate statuses, not silently excluded |
| Recovery | After losing a previously correct position within one labeled occurrence, time to the next stable correct run. Unrecovered episodes are right-censored at the occurrence boundary |
| Coverage/abstention | Time-weighted manual, held, following, and uncertain state, in that priority order, over labeled target time. These are state fractions, not calibrated confidence/correctness probabilities |
| Manual interventions | Count/type of explicit operator events and observed count per recorded hour; instrumentation scope is stated rather than claiming all possible human actions |

Unlabeled time, ambiguous targets, and unidentifiable lines do not become
correct observations. Missing leading/output coverage makes the full-time
accuracy unavailable; known/unknown milliseconds are retained in JSON. Begin
labeling after a known output snapshot, or retain that unavailable result.
False-event rates also require output coverage. Unclassified Shabad changes
make the automatic-switch metric unavailable rather than assuming an actor.
First acquisition is not included in transition latency. Repeated adjacent
labels of the same displayed position do not fabricate a display transition.

Median requires at least one detected sample; nearest-rank p90 requires 10 and
p95 requires 20. The JSON includes sample counts, undetected transitions,
unavailable/short windows, recovery episodes, denominators, and capture status.
`stableMs` is an **evaluation definition**, not a change to the live switching
confirmation policy. Use identical labels, timing alignment, and `stableMs`
when comparing runs.
Display accuracy includes operator assistance. Compare intervention counts
alongside it, and control/replay the same operator actions across comparisons;
do not describe an assisted display score as unassisted recognizer accuracy.

Stage diagnostics count labeled matcher proposals and captured retrieval
candidates. They cannot causally separate ASR corruption from retrieval failure
without an independent verbatim speech transcript. ASR accuracy is explicitly
unavailable. Scores are heuristics, not calibrated probabilities. Retrieval
captures at most eight candidates; this is not full-corpus recall.

## Replay and compatibility

Original v1 files remain readable by `replay-session.mjs`; mismatches still
exit **1**. V2 Kirtan matcher events use the same parity check. No matcher calls
means parity is unavailable, not an exact/perfect score. Katha's separate
matcher is recorded but is not passed through the Kirtan matcher for parity.

`--timeline` reconstructs ordered recognition revisions, tracker commitments
and pending lines, page positions, hold state, pending discovery/request IDs,
cooldown deadlines, and manual changes. A late response from an old request
does not clear a newer pending request. This is **observed-state replay**, not
a counterfactual implementation of the React hooks. It does not recompute
thresholds, confirmations, timers, navigation, or asynchronous scheduling.

The deterministic hook tests additionally feed controlled observations through
the actual hooks with fake timers, retaining their own evolving cursor state;
they do not inject a recorded current line before each observation. Full
counterfactual CLI replay would require an adapter for the actual hooks and
recorded retrieval/cache completions. That adapter is intentionally deferred
instead of restructuring the live runtime or maintaining a second policy.
Keep input traces, independent labels/audio, build identifiers, and output
reports immutable so future adapters can evaluate the same material.

CLI exit codes: **0** for a valid report, **1** for a requested quality gate
failure, **2** for invalid input/options or a required unavailable metric.
Without a gate, a poor score is a valid measurement and still exits 0.

```powershell
node tools/evaluate-recognition.mjs trace.json labels.json --min-display-accuracy 90 --max-false-shabad-switches 0 --require-metrics
```

`--require-metrics` requires page accuracy and automatic-switch evidence; it
does not pretend exact projector timing is available. Export prefixes create
`.json` and `.md` reports. Annotation initialization refuses to overwrite an
existing file.

## Bounds, overhead, privacy, and retention

Recording stops at 120,000 events, a conservative 32 MiB serialized-data
budget, or 12 hours. It also stops rather than silently clipping an oversized
observation/canonical verse. No old events are evicted. `capture.complete` and
`capture.reason` identify the preserved prefix, and the debug panel exposes
automatic stopping. Export and start a new segment for a longer service.
Record length depends on recognition event rate. The 40 MiB evaluator input
file limit prevents accidental unbounded JSON loading. In-memory object and
export-copy overhead is additional to the serialized budget; this is not a
32 MiB JavaScript heap guarantee.

Disabled recording returns before clocks, payload factories, serialization,
and canonical copying. Enabled recording adds bounded serialization/copying
on observations and diagnostic projector messages. Snapshot subscriptions do
not set recognition or page state. The same regression suite is run with
recording off and on; emitted traces are validated after each enabled test.

Run the reproducible CPU probe:

```powershell
node tools/recognition-overhead.mjs
```

One local Node v24.17.0 run, 10,000 calls: approximately **0.016 microseconds**
per disabled `recordDecision`, **2.595 microseconds** enabled, 10,001 retained
events before stop, about 3.2 MB exported, and roughly 9.9 MB observed heap
allocation delta. These are noisy single-process serialization measurements,
not browser/hook, microphone, network, projector-paint, or production latency.
The probe excludes `getTrace()`/export time from its per-call timing; its heap
delta includes snapshot allocation and garbage-collection noise.

No raw audio, credentials, pairing tokens, QR links, image data, environment
values, or unrelated application objects are recorded. Transcript fragments
can include spoken personal information; keep exports and separately supplied
audio under your control, share only with consent, and delete them when no
longer needed. There is no new upload service or automatic disk retention.
Existing speech-service and BaniDB traffic is unchanged. Browser reload/closing
discards the in-memory trace; downloaded files remain until you remove them.

## Verification and example

```powershell
Set-Location 'C:\Users\gurmi\Desktop\Projects\gurmatsaanj-tests\frontend'
npm test
$env:TEST_RECORDING = '1'
npm test
Remove-Item Env:TEST_RECORDING
npm run build

Set-Location '..\backend'
npm test
Set-Location '..'
git diff --check
node tools/evaluate-recognition.mjs frontend/test/fixtures/recognition-synthetic.json frontend/test/fixtures/recognition-synthetic.labels.json --out .cache/reports/synthetic
```

The checked-in `docs/examples/recognition-synthetic-report.md` and companion
JSON come from that fixture. Expected arithmetic: 50 seconds of labeled target
time, 60% page Pangti accuracy, 92% Shabad accuracy, one false line jump, one
false automatic Shabad switch, three detected transitions with 2-second median,
one undetected transition, a 2-second recovery, and two explicit interventions.
Exact projector accuracy and p90/p95 are unavailable. A short synthetic fixture
produces large per-hour rates; these must not be generalized to live services.

Remaining gaps include raw-audio/ASR accuracy, exact projector paint/physical
display timing, all remote/search-route operator actions, and full
counterfactual hook/network replay. Sangat View timing is not instrumented.
No browser/live-audio accuracy or performance improvement is claimed.

## Validation results and changed files

The initial baseline passed all 58 existing frontend regressions. The final
frontend suite passes 108 tests in 11 files with recording disabled and again
with recording enabled; the enabled run validates each emitted trace. This
includes existing V1/V2/V3/V5/V13 checks, legacy/v2 parity process exits, schema
and annotation failures, timing arithmetic, uncertainty, resource bounds,
instrumentation, Katha, and projector acknowledgements. All 40 backend tests
pass. The production build passes with the existing large-chunk warning.
`git diff --check` passes. No live microphone, BaniDB, or hosted inference is
needed for these tests. Browser/physical-projector performance is unmeasured.

Changed/new files, relative to the repository root:

```text
frontend/package.json
frontend/vitest.config.js
frontend/src/utils/sessionRecorder.js
frontend/src/utils/recognitionTrace.js
frontend/src/hooks/useTraceOutput.js
frontend/src/hooks/useVoiceRecognition.js
frontend/src/hooks/usePageVoiceTracking.js
frontend/src/hooks/useLineTracking.js
frontend/src/hooks/useKathaLineTracking.js
frontend/src/hooks/useAutoShabadAdvance.js
frontend/src/hooks/useFollowHold.js
frontend/src/hooks/useShabadMatching.js
frontend/src/features/voiceRecognition/VoiceDebugPanel.jsx
frontend/src/pages/ShabadPage/ShabadPage.jsx
frontend/src/pages/AngPage/AngPage.jsx
frontend/src/pages/ProjectorPage/ProjectorPage.jsx
frontend/src/services/projector.js
frontend/test/README.md
frontend/test/helpers/recordingEnabled.js
frontend/test/sessionRecorder.test.js
frontend/test/recognitionEvaluation.test.js
frontend/test/recognitionInstrumentation.test.js
frontend/test/projectorObservability.test.js
frontend/test/fixtures/recognition-synthetic.json
frontend/test/fixtures/recognition-synthetic.labels.json
tools/replay-session.mjs
tools/evaluate-recognition.mjs
tools/lib/recognition-evaluation.mjs
tools/recognition-overhead.mjs
docs/recognition-benchmark.md
docs/examples/recognition-synthetic-report.json
docs/examples/recognition-synthetic-report.md
```

Backend source/manifests, `AppContext.jsx`, the line-matching algorithm,
security/remote authentication, dependency lockfiles, and generated semantic
artifacts are unchanged. No Git commit or branch operation is performed by
the benchmark tools.

Suggested commits for review:

```text
feat(observability): add opt-in versioned recognition traces
feat(benchmark): evaluate labeled recognition timelines offline
test(benchmark): cover trace compatibility and evaluation metrics
docs(benchmark): document recording and independent annotation
```
