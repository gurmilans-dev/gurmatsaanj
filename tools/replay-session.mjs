#!/usr/bin/env node
/**
 * Replay a recorded kirtan session (see frontend/src/utils/sessionRecorder.js)
 * through the SAME client-side matchLine() the live app uses, and report how
 * the line-tracking behaved. Because matchLine is deterministic, replaying the
 * recorded transcript tails reproduces every decision exactly — so this also
 * doubles as a regression check: if the frontend matcher later drifts, the
 * "replay parity" line will show mismatches.
 *
 * Usage (from repo root or frontend/):
 *
 *   node tools/replay-session.mjs <trace.json> [--verbose]
 *   # or, via the frontend package script:
 *   npm run replay:session -- ../path/to/kirtan-session-….json --verbose
 *
 * What to look for when tuning:
 *   - "avg conf" and the per-event confidences (--verbose): where did the
 *     score collapse? That's where the cursor lagged or dropped tracking.
 *   - long runs of `·` (untracked) in the middle of a shabad → vyakhya /
 *     instrumental gaps (useful for setting Lock/Follow auto-hold thresholds).
 */
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const file = process.argv[2];
const verbose = process.argv.includes('--verbose');
if (!file) {
  console.error('Usage: node tools/replay-session.mjs <trace.json> [--verbose]');
  process.exit(1);
}

// On Windows, dynamic import() of an absolute path needs a file:// URL.
const matchLineUrl = url.pathToFileURL(
  path.join(__dirname, '..', 'frontend', 'src', 'utils', 'matchLine.js'),
).href;
const { matchLine } = await import(matchLineUrl);

let trace;
try {
  trace = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`Could not read trace: ${err.message}`);
  process.exit(1);
}

const shabads = trace.shabads || {};
const events = trace.events || [];

let mismatches = 0;
let trackedCount = 0;
let lineChanges = 0;
let confSum = 0;
let prevTrackedLine = null;

for (const ev of events) {
  const verses = shabads[ev.shabadId] || [];
  const res = matchLine(verses, ev.tail, { currentLine: ev.currentLine });
  const same =
    res.lineIndex === ev.lineIndex &&
    res.confidence === ev.confidence &&
    res.tracked === ev.tracked;
  if (!same) mismatches += 1;
  if (ev.tracked) trackedCount += 1;
  confSum += Number(ev.confidence) || 0;
  if (ev.tracked && ev.lineIndex !== prevTrackedLine) {
    lineChanges += 1;
    prevTrackedLine = ev.lineIndex;
  }
  if (verbose) {
    const secs = (ev.t / 1000).toFixed(1).padStart(7);
    const flag = ev.tracked ? '✓' : '·';
    const drift = same ? '' : `  ‼ replay=${JSON.stringify(res)}`;
    console.log(
      `${secs}s  cur=${String(ev.currentLine).padStart(2)} → line=${String(ev.lineIndex).padStart(2)} conf=${String(ev.confidence).padStart(3)} ${flag}  "${ev.tail}"${drift}`,
    );
  }
}

const pct = (n) => (events.length ? ((n / events.length) * 100).toFixed(1) : '0.0');

console.log('\n── Session replay ─────────────────────────');
console.log(`file:          ${path.basename(file)}`);
console.log(`duration:      ${(Number(trace.durationMs || 0) / 1000).toFixed(1)}s`);
console.log(`events:        ${events.length}`);
console.log(`shabads:       ${Object.keys(shabads).length}`);
console.log(`tracked:       ${trackedCount} (${pct(trackedCount)}%)`);
console.log(`line moves:    ${lineChanges}`);
console.log(`avg conf:      ${events.length ? (confSum / events.length).toFixed(1) : '0.0'}`);
console.log(
  `replay parity: ${mismatches === 0
    ? 'EXACT ✓ (deterministic — matcher unchanged)'
    : `${mismatches} mismatch(es) — frontend matchLine has drifted from this recording`}`,
);
