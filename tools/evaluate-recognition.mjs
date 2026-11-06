#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { evaluateRecognition, reportMarkdown, replayTimeline } from './lib/recognition-evaluation.mjs';
import { validateTrace } from '../frontend/src/utils/recognitionTrace.js';

function readJson(file) {
  if (fs.statSync(file).size > 40 * 1024 * 1024) throw new Error('Input exceeds the 40 MiB file limit');
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

try {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) {
    console.log('Usage: node tools/evaluate-recognition.mjs <trace.json> <labels.json> [--out report-prefix] [--timeline file.json] [--stable-ms 1000] [--min-display-accuracy 90] [--max-false-shabad-switches 0] [--require-metrics]');
    console.log('Annotation template: node tools/evaluate-recognition.mjs <trace.json> --init-labels labels.json');
    if (args.length === 0) process.exitCode = 2;
  } else {
    const options = {};
    const files = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '--require-metrics') options.requireMetrics = true;
      else if (['--out', '--timeline', '--stable-ms', '--min-display-accuracy', '--max-false-shabad-switches', '--init-labels'].includes(arg)) {
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
        options[arg.slice(2)] = value;
      } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
      else files.push(arg);
    }
    const trace = validateTrace(readJson(files[0]));
    if (options['init-labels']) {
      if (files.length !== 1) throw new Error('Annotation template requires exactly one trace');
      if (fs.existsSync(options['init-labels'])) throw new Error('Annotation file already exists; refusing to overwrite');
      writeJson(options['init-labels'], {
        version: 1, sessionId: trace.sessionId || 'legacy', synthetic: trace.metadata?.synthetic === true,
        timebase: 'trace-relative-ms', timingUncertaintyMs: 0,
        provenance: { independent: false, method: 'Replace after independent audio/video review' },
        segments: trace.durationMs > 0 ? [{ id: 'occurrence-1', startMs: 0, endMs: trace.durationMs, activity: 'ambiguous', target: null }] : [],
      });
      console.log('Blank annotation template written. No predictions were used as ground truth.');
    } else {
      if (files.length !== 2) throw new Error('Expected a trace and independent annotation file');
      const numeric = (key, fallback) => {
        if (options[key] == null) return fallback;
        const value = Number(options[key]);
        if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid --${key}`);
        return value;
      };
      const report = evaluateRecognition(trace, readJson(files[1]), { stableMs: numeric('stable-ms', 1000) });
      const markdown = reportMarkdown(report);
      console.log(markdown);
      if (options.out) {
        writeJson(options.out + '.json', report);
        fs.writeFileSync(options.out + '.md', markdown);
      }
      if (options.timeline) writeJson(options.timeline, replayTimeline(trace));
      const minimum = numeric('min-display-accuracy', null);
      const maximum = numeric('max-false-shabad-switches', null);
      if (minimum != null && minimum > 100) throw new Error('Accuracy threshold must be between 0 and 100');
      const required = (minimum != null || options.requireMetrics) && report.page.displayAccuracy.status !== 'available' ||
        (maximum != null || options.requireMetrics) && report.falseShabadSwitches.status !== 'available';
      if (required) { console.error('Required evaluation metric is unavailable.'); process.exitCode = 2; }
      else if ((minimum != null && report.page.displayAccuracy.percent < minimum) ||
               (maximum != null && report.falseShabadSwitches.count > maximum)) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(`Evaluation failed: ${error.message}`);
  process.exitCode = 2;
}
