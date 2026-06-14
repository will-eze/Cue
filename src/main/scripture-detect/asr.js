// Streaming transcription loop. Maintains a rolling 16 kHz mono PCM buffer fed by
// the renderer's audio capture, and runs Whisper over a sliding window each step.
// Uses LocalAgreement: only words that agree across two consecutive hypotheses are
// "committed", giving stable text ~2–3 s behind speech with no flicker. The
// committed stream is what the reference parser + content matcher consume.
//
// The engine is transformers.js (whisper-bin.js), which keeps the model RESIDENT —
// no per-step process spawn or WAV temp file. We just convert the rolling Int16
// window to Float32 and hand it to the pipeline. The engine sits behind
// whisper-bin.js so a faster whisper.cpp path could swap in here unchanged.

import * as whisperBin from './whisper-bin.js';

const SAMPLE_RATE = 16000;
const MAX_WINDOW_SEC = 15;       // rolling-buffer cap (kept modest for latency)
const KEEP_ON_TRIM_SEC = 5;      // overlap retained after a trim
const STEP_MS = 1000;            // transcribe cadence
const MIN_STEP_SAMPLES = SAMPLE_RATE * 1.5; // need ≥1.5 s of new audio to bother

function toFloat32(int16) {
  const f = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f[i] = int16[i] / 32768;
  return f;
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

  async function transcribeOnce() {
    if (!buffer.length) return null;
    try { return await whisperBin.transcribe(toFloat32(buffer), modelName); }
    catch (err) { onError?.(err.message); return null; }
  }

  async function step() {
    if (!running || busy || sinceStep < MIN_STEP_SAMPLES || !buffer.length) return;
    busy = true; sinceStep = 0;
    try {
      const text = await transcribeOnce();
      if (text == null) return; // model not ready yet — idle until provisioned
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
    },
    isRunning() { return running; },
  };
}
