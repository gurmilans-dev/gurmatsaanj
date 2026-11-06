#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { sha256, readJson, wavMetadata } from './lib/recognition-validation.mjs';
import { envelope, compareEnvelopes } from './lib/audio-routing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const options = {};
for (let i = 0; i < args.length; i++) {
  if (['--online', '--with-recorder'].includes(args[i])) options[args[i].slice(2)] = true;
  else if (['--audio', '--out', '--policy', '--mode', '--module'].includes(args[i]) && args[i + 1]) options[args[i++].slice(2)] = args[i];
  else throw new Error('Unknown/missing probe option');
}
if (!options.out || !['mic', 'track', undefined].includes(options.mode)) throw new Error('--out new-directory and --mode mic|track required');
const output = path.resolve(options.out); if (fs.existsSync(output)) throw new Error('Use a new probe directory');
fs.mkdirSync(output, { recursive: true });
const audioPath = path.resolve(options.audio || path.join(output, 'calibration.wav'));
if (!options.audio) {
  const rate = 16000; const seconds = 12; const samples = rate * seconds; const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) { const t = i / rate; const second = Math.floor(t); const amplitude = [0.2, 0.06, 0.35, 0.1][second % 4]; const frequency = [320, 690, 1230][second % 3]; wav.writeInt16LE(Math.round(32767 * amplitude * Math.sin(2 * Math.PI * frequency * t)), 44 + i * 2); }
  fs.writeFileSync(audioPath, wav, { flag: 'wx' });
}
const audioBytes = fs.readFileSync(audioPath); const metadata = wavMetadata(audioBytes);
if (metadata.encoding !== 1 || metadata.channels !== 1 || metadata.bitsPerSample !== 16 || metadata.durationMs < 6000) throw new Error('Probe requires at least six seconds of mono 16-bit PCM WAV');
const policy = options.policy ? readJson(options.policy) : null;
if (options.online && (policy?.sha256 !== sha256(audioBytes) || policy.onlineRecognitionAuthorized !== true || !policy.provenance)) throw new Error('Online recognition requires a matching explicit rights/transfer policy');
let dataStart = 0;
for (let p = 12; p + 8 <= audioBytes.length;) { const size = audioBytes.readUInt32LE(p + 4); if (audioBytes.toString('ascii', p, p + 4) === 'data') { dataStart = p + 8; break; } p += 8 + size + (size % 2); }
const expected = new Float32Array(metadata.dataBytes / 2); for (let i = 0; i < expected.length; i++) expected[i] = audioBytes.readInt16LE(dataStart + i * 2) / 32768;
const referenceEnvelope = envelope(expected, metadata.sampleRate);
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><button id="start">Start owned probe</button><script>
  window.result={events:[],pcm:[],sampleRate:0}; document.querySelector('button').onclick=async()=>{try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const context=new AudioContext();await context.resume();result.sampleRate=context.sampleRate;
    const source=context.createMediaStreamSource(stream);const processor=context.createScriptProcessor(1024,1,1);const mute=context.createGain();mute.gain.value=0;
    const chunks=[];let frames=0;processor.onaudioprocess=e=>{if(frames<context.sampleRate*5){chunks.push(Array.from(e.inputBuffer.getChannelData(0)));frames+=1024;}};
    source.connect(processor);processor.connect(mute);mute.connect(context.destination);
    let recorder;if(${Boolean(options['with-recorder'])}){recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{result.recordedBytes=(result.recordedBytes||0)+e.data.size;};recorder.start(500);}
    let rec;if(${Boolean(options.online)}){const C=window.SpeechRecognition||window.webkitSpeechRecognition;if(!C)throw Error('SpeechRecognition unsupported');rec=new C();rec.lang='en-US';rec.continuous=true;rec.interimResults=true;
      for(const type of ['start','audiostart','soundstart','speechstart','result','audioend','error','end'])rec.addEventListener(type,e=>result.events.push({type,t:performance.now(),error:e.error||null,text:e.results?Array.from(e.results).map(r=>r[0].transcript).join(' '):null}));
      try{${options.mode === 'track' ? 'rec.start(stream.getAudioTracks()[0]);' : 'rec.start();'}result.startAccepted=true;}catch(error){result.startError=error.name;}}
    await new Promise(r=>setTimeout(r,${options.online ? 13000 : 6000}));rec?.abort();if(recorder&&recorder.state!=='inactive'){const stopped=new Promise(r=>recorder.onstop=r);recorder.stop();await stopped;}
    result.pcm=chunks.flat();source.disconnect();processor.disconnect();stream.getTracks().forEach(t=>t.stop());await context.close();result.done=true;
  }catch(error){result.failure=error.message;result.done=true;}};</script>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  const { chromium } = await import(pathToFileURL(path.resolve(options.module || path.join(root, '.cache/browser-runtime/node_modules/playwright-core/index.mjs'))).href);
  context = await chromium.launchPersistentContext(path.join(output, 'profile'), { channel: 'chrome', headless: true, chromiumSandbox: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${audioPath}%noloop`] });
  const page = context.pages()[0]; await page.goto(`http://127.0.0.1:${server.address().port}`); await page.locator('#start').click();
  await page.waitForFunction(() => result.done, null, { timeout: 25000 }); const raw = await page.evaluate(() => result);
  const { correlation: best, offsetMs: offset } = compareEnvelopes(envelope(raw.pcm, raw.sampleRate), referenceEnvelope);
  const { pcm, ...details } = raw;
  const report = { kind: 'isolated-audio-routing-probe', synthetic: policy?.synthetic ?? !options.audio, browser: await context.browser().version(),
    source: { sha256: sha256(audioBytes), ...metadata, provenance: policy?.provenance || 'Local calibration waveform; no third-party performance' },
    onlineTransferAuthorized: Boolean(options.online), mode: options.mode || 'mic', withRecorder: Boolean(options['with-recorder']),
    ...details, capturedFrames: pcm.length, sourceEnvelopeCorrelation: best, bestOffsetMs: offset,
    captureInputVerified: best >= 0.95 && pcm.length >= raw.sampleRate * 4,
    speechProcessingVerified: raw.events.some((e) => e.type === 'result' && e.text),
    interpretation: 'Envelope agreement verifies supplied audio in getUserMedia only. A recognizer result is separately required; this control is never Kirtan accuracy.' };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
  if (!report.captureInputVerified || options.online && !report.speechProcessingVerified) process.exitCode = 2;
} finally { await context?.close(); await new Promise((resolve) => server.close(resolve)); }
