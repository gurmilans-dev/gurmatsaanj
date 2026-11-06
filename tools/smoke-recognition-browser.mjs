#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateTrace } from '../frontend/src/utils/recognitionTrace.js';
import { sha256, wavMetadata } from './lib/recognition-validation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (key) => { const index = args.indexOf(key); return index < 0 ? null : args[index + 1]; };
const output = path.resolve(value('--out') || path.join(root, '.cache', 'browser-validation', String(Date.now())));
if (fs.existsSync(output)) throw new Error('Use a new browser report directory');
fs.mkdirSync(output, { recursive: true });
const modulePath = value('--module') || path.join(root, '.cache/browser-runtime/node_modules/playwright-core/index.mjs');
const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
const dist = path.join(root, 'frontend/dist');
const fixture = { meta: { shabadId: 'fixture' }, verses: [
  { gurmukhi: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ', verseId: 'fixture-0' },
  { gurmukhi: 'ਆਪਣਾ ਮੂਲੁ ਪਛਾਣੁ', verseId: 'fixture-1' },
] };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/speech-probe') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><button id="start">Start isolated audio probe</button><script>window.probe=[];document.querySelector("button").onclick=()=>{const C=window.SpeechRecognition||window.webkitSpeechRecognition;if(!C){probe.push({type:"unsupported"});return;}const r=window.probeRecognizer=new C();r.lang="pa-IN";r.continuous=true;r.interimResults=true;for(const name of ["start","audiostart","audioend","end","error","result"]){r.addEventListener(name,e=>probe.push({type:name,error:e.error||null,results:e.results?.length||0,t:performance.now()}));}try{r.start();}catch(e){probe.push({type:"start-failed",error:e.name});}};</script>'); return;
    }
    if (url.pathname.startsWith('/api/')) {
      const data = url.pathname === '/api/shabads/fixture' ? fixture : url.pathname === '/api/health' ? { status: 'ok' } : { ok: true, suggestions: [], commands: [], clients: [], pairCode: '0000', followCode: 'fixture-follow' };
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); return;
    }
    let file = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(dist + path.sep)) file = path.join(dist, 'index.html');
    try { if (!fs.statSync(file).isFile()) file = path.join(dist, 'index.html'); } catch { file = path.join(dist, 'index.html'); }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); response.end(fs.readFileSync(file));
  } catch { response.writeHead(500); response.end('Fixture server error'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
const result = { synthetic: true, checks: [], errors: [], nativeAudioProbe: null };
try {
  const audio = value('--audio');
  context = await chromium.launchPersistentContext(path.join(output, 'profile'), {
    channel: 'chrome', headless: true, chromiumSandbox: true, acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
    // Once the app's service worker controls the page, Playwright fails the
    // worker-handled /projector navigation with net::ERR_FAILED (plain Chrome
    // renders it), so the result depended on install timing. The worker is
    // not what this smoke checks; block it so runs are deterministic.
    serviceWorkers: 'block',
    args: audio ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${path.resolve(audio)}%noloop`] : [],
  });
  const observePage = (page) => page.on('pageerror', (error) => result.errors.push(error.message));
  context.on('page', observePage);
  for (const page of context.pages()) observePage(page);
  const page = context.pages()[0] || await context.newPage();
  if (audio) {
    const bytes = fs.readFileSync(path.resolve(audio));
    result.audioEvidence = { sha256: sha256(bytes), ...wavMetadata(bytes) };
    await page.goto(origin + '/speech-probe');
    await page.getByRole('button', { name: 'Start isolated audio probe' }).click();
    try { await page.waitForFunction(() => window.probe.some((e) => ['result', 'error', 'unsupported', 'start-failed'].includes(e.type)), null, { timeout: 20000 }); }
    catch { /* An unresponsive recognition service is a measured blocker. */ }
    result.nativeAudioProbe = await page.evaluate(() => { window.probeRecognizer?.stop(); return window.probe; });
    result.synthetic = false;
    result.nativeCaptureStatus = result.nativeAudioProbe.some((e) => e.type === 'result') ? 'transcript-observed-unscored' : 'blocked-no-transcript';
    result.interpretation = 'Native browser speech-service availability probe on a public file; not an accuracy evaluation or a synchronized performance trace.';
  } else {
    await context.addInitScript(() => {
      const Channel = window.BroadcastChannel;
      window.validationSignals = [];
      window.BroadcastChannel = class extends Channel {
        postMessage(message) { window.validationSignals.push({ type: message.type, diagnostics: Boolean(message.diagnostics) }); return super.postMessage(message); }
      };
      window.SpeechRecognition = window.webkitSpeechRecognition = class {
        start() {
          this.timer = setTimeout(() => { const result = [{ transcript: 'ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ' }]; result.isFinal = true; this.onresult?.({ resultIndex: 0, results: [result], timeStamp: performance.now() }); }, 100);
        }
        stop() { clearTimeout(this.timer); }
      };
    });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + '/shabad/fixture');
    await page.getByRole('button', { name: 'Next line', exact: true }).first().waitFor();
    const projector = await context.newPage(); await projector.goto(origin + '/projector');
    await projector.locator('.projector-line-active, .projector-line-opening').waitFor();
    const disabled = await page.evaluate(() => window.validationSignals.filter((s) => s.type === 'state'));
    if (!disabled.length || disabled.some((s) => s.diagnostics)) throw new Error('Disabled recording modified projector state envelopes');
    result.checks.push('disabled-state-envelope-unchanged');
    await page.locator('.voice-debug-panel > summary').click();
    await page.getByRole('button', { name: '● Record', exact: true }).click();
    await page.getByRole('button', { name: 'Start mic', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector('.voice-debug-panel').textContent.includes('ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ'));
    await page.getByRole('button', { name: 'Sync marker', exact: true }).click();
    await page.getByRole('button', { name: 'Next line', exact: true }).first().click();
    await projector.waitForFunction(() => document.querySelector('.projector-line-active')?.textContent.includes('ਆਪਣਾ ਮੂਲੁ ਪਛਾਣੁ'));
    result.checks.push('manual-correction-and-cross-tab-projector-sync');
    await page.getByRole('button', { name: /^■ Stop/ }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Download \(/ }).click();
    await (await downloadEvent).saveAs(path.join(output, 'trace.json'));
    const trace = validateTrace(JSON.parse(fs.readFileSync(path.join(output, 'trace.json'))));
    if (!trace.events.some((e) => e.type === 'manual') || !trace.events.some((e) => e.type === 'projector.ack' && e.data.phase === 'committed')) throw new Error('Browser trace lacks actual commit/manual evidence');
    result.checks.push('trace-export-schema-and-projector-acknowledgements');
    result.traceEvents = trace.events.length;
    await page.evaluate(() => { const channel = new BroadcastChannel('saanj-kirtan-projector'); channel.postMessage({ type: 'state', payload: { mode: 'blank' } }); channel.close(); });
    await projector.locator('.projector-blank').waitFor();
    result.checks.push('blank-projector-state');
    await page.goto(origin + '/shabad/fixture?katha=1');
    await page.getByRole('button', { name: 'Start mic', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector('.voice-debug-panel')?.textContent.includes('ਮਨ ਤੂੰ ਜੋਤਿ ਸਰੂਪੁ ਹੈ'));
    result.checks.push('katha-viewer-mic-fixture');
    await page.screenshot({ path: path.join(output, 'shabad.png'), fullPage: true });
  }
  result.status = result.errors.length ? 'failed' : result.nativeCaptureStatus === 'blocked-no-transcript' ? 'blocked' : 'passed';
  if (result.status !== 'passed') process.exitCode = result.status === 'blocked' ? 2 : 1;
} catch (error) { result.status = 'failed'; result.errors.push(error.message); process.exitCode = 1; }
finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
