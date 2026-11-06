# SYNTHETIC recognition benchmark — not real performance accuracy

Session: synthetic-mixed-60s. Duration: 60000 ms. Trace version: 2.
Independent annotation method: Hand-specified synthetic timeline; not a recording or runtime simulation. Evaluable target time: 50000 ms.

| Metric | Result |
|---|---|
| Page Shabad + Pangti accuracy (%) | 60 |
| Page Shabad accuracy (%) | 92 |
| False line jumps / labeled hour | 72 |
| False automatic Shabad switches / labeled hour | 72 |
| Transition median / p90 / p95 (ms) | 2000 / unavailable / unavailable |
| Undetected / unavailable / short transitions | 1 / 0 / 0 |
| Recovery median (ms) / censored episodes | 2000 / 0 |
| Explicit manual interventions | 2 |
| Projector Shabad + Pangti accuracy (%) | unavailable (Output evidence does not cover all labeled target time) |

Following/held/manual fractions describe recorded state, not calibrated correctness. See the JSON report for denominators, unknown time, individual transitions, recovery episodes, and diagnostic counts.

Sender-clock acknowledgement times bound delivery/React commit from above; they are not exact projector render/paint times.

Capture complete: true.
Observed-state replay only: pending/hold/cooldown events are reconstructed, not recomputed. It does not simulate a changed policy or network.

- No real-world accuracy claim follows from synthetic fixtures.
- Matcher confidence is not a calibrated probability.
- Display accuracy includes operator assistance; compare interventions and control operator actions across runs.
- Legacy matcher calls cannot establish tracker/page/projector output.
- Projector acknowledgements alone cannot establish exact time-weighted render accuracy.
