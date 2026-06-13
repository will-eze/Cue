// Streaming transcription loop. Maintains a rolling 16 kHz mono PCM buffer fed by
// the renderer's audio capture, and runs whisper.cpp over a sliding window each
// step. Uses LocalAgreement: only words that agree across two consecutive
// hypotheses are "committed", giving stable text ~2–3 s behind speech with no
// flicker. The committed stream is what the reference parser + content matcher
// consume.
//
// v1 transport: spawn the stock whisper-cli per step over the current window
// (simple, uses the established spawn pattern). A resident-model N-API binding can
// later swap in behind this same interface if per-step spawn proves too slow.

import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { whisperPath, modelPath } from './whisper-bin.js';

const SAMPLE_RATE = 16000;
const MAX_WINDOW_SEC = 24;       // hard cap on the rolling buffer
const KEEP_ON_TRIM_SEC = 6;      // overlap retained after a trim
const STEP_MS = 1000;            // transcribe cadence
const MIN_STEP_SAMPLES = SAMPLE_RATE * 1.5; // need ≥1.5 s of new audio to bother

function writeWav(int16, file) {
  const dataLen = int16.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  Buffer.from(int16.buffer, int16.byteOffset, dataLen).copy(buf, 44);
  fs.writeFileSync(file, buf);
}

function commonPrefixWords(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return a.slice(0, i);
}

export function createAsr({ modelName = 'base.en', onTranscript, onCommitted, onError } = {}) {
  let buffer = new Int16Array(0);   // rolling PCM window
  let sinceStep = 0;                // new samples since last transcription
  let prevWords = [];               // previous hypothesis (for LocalAgreement)
  let committedCount = 0;           // words confirmed within the current buffer
  let committedText = '';           // full committed string for the current buffer
  let running = false;
  let busy = false;
  let timer = null;
  const tmpFile = path.join(os.tmpdir(), `cue-asr-${process.pid}.wav`);

  function append(int16) {
    if (!int16 || !int16.length) return;
    const merged = new Int16Array(buffer.length + int16.length);
    merged.set(buffer, 0); merged.set(int16, buffer.length);
    buffer = merged;
    sinceStep += int16.length;
    const max = MAX_WINDOW_SEC * SAMPLE_RATE;
    if (buffer.length > max) {
      // Trim oldest audio, keep an overlap, and reset commit bookkeeping (the
      // retained audio re-transcribes; downstream dedupe absorbs the repeat).
      buffer = buffer.slice(buffer.length - KEEP_ON_TRIM_SEC * SAMPLE_RATE);
      prevWords = []; committedCount = 0; committedText = '';
    }
  }

  function transcribeOnce() {
    return new Promise((resolve) => {
      const bin = whisperPath();
      if (!bin) return resolve(null);
      writeWav(buffer, tmpFile);
      const args = [
        '-m', modelPath(modelName), '-f', tmpFile,
        '-l', 'en', '-nt', '-np',
        '-t', String(Math.min(8, Math.max(2, (os.cpus()?.length || 4) - 1))),
      ];
      let out = '';
      let child;
      try { child = spawn(bin, args, { windowsHide: true }); }
      catch (err) { onError?.(err.message); return resolve(null); }
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('error', (err) => { onError?.(err.message); resolve(null); });
      child.on('close', () => resolve(out.replace(/\s+/g, ' ').trim()));
    });
  }

  async function step() {
    if (!running || busy || sinceStep < MIN_STEP_SAMPLES || !buffer.length) return;
    busy = true; sinceStep = 0;
    try {
      const text = await transcribeOnce();
      if (text == null) return;
      const words = text.split(/\s+/).filter(Boolean);
      // LocalAgreement: commit the common prefix of this and the previous hypothesis.
      const agreed = commonPrefixWords(prevWords, words);
      prevWords = words;
      if (agreed.length > committedCount) {
        const fresh = agreed.slice(committedCount).join(' ');
        committedCount = agreed.length;
        committedText = agreed.join(' ');
        if (fresh) onCommitted?.(fresh, committedText);
      }
      const tail = words.slice(committedCount).join(' ');
      onTranscript?.({ committed: committedText, tail, full: text });
    } finally {
      busy = false;
    }
  }

  return {
    pushAudio(int16) { if (running) append(int16); },
    start() {
      if (running) return;
      running = true;
      timer = setInterval(step, STEP_MS);
    },
    stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      buffer = new Int16Array(0); sinceStep = 0;
      prevWords = []; committedCount = 0; committedText = '';
      try { fs.rmSync(tmpFile, { force: true }); } catch {}
    },
    isRunning() { return running; },
  };
}
