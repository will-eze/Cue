// VAD-segmented transcription. Instead of transcribing a rolling window every tick
// (which makes Whisper hallucinate over the silence between sentences and forces a
// lossy LocalAgreement commit), we segment the incoming audio into UTTERANCES with
// a lightweight energy VAD: detect speech onset, buffer until the speaker pauses,
// then transcribe that one complete, silence-trimmed utterance and hand its FULL
// text to detection. This is the right model for catching discrete spoken
// references/quotes — a clean bounded clip per utterance gives Whisper its best
// accuracy and never discards a correct transcription (the old LocalAgreement path
// dropped "Matthew 1 verse 1" because it only survived a single hypothesis).
//
// The engine is transformers.js (whisper-bin.js), model resident; we just convert
// the utterance's Int16 PCM to Float32 and hand it to the resident pipeline. The
// engine sits behind whisper-bin.js so a faster path could swap in unchanged.

import * as whisperBin from './whisper-bin.js';

const SAMPLE_RATE = 16000;
const FRAME_MS = 250;            // each pushed frame ≈ 4000 samples @ 16 kHz
const END_SILENCE_MS = 550;      // trailing silence that closes an utterance (lower = snappier)
const MIN_SPEECH_MS = 350;       // ignore blips shorter than this (clicks, coughs)
const MAX_UTTERANCE_MS = 18000;  // hard cap: force-flush a run-on so latency is bounded
const PREROLL_FRAMES = 2;        // ~500 ms kept before onset (don't clip the first word)
const ABS_FLOOR = 0.005;         // absolute RMS speech floor (normalized −1..1)
const ONSET_RATIO = 3.0;         // onset threshold = max(ABS_FLOOR, noiseFloor*ratio)
const RELEASE_RATIO = 0.55;      // hysteresis: stay "in speech" while above onset*this
const MAX_QUEUE = 4;             // cap the backlog of utterances awaiting transcription

const DBG = process.env.CUE_SCRIPTURE_DEBUG !== '0';
function dbg(...a) { if (DBG) console.log('[scripture-detect][vad]', ...a); }

function toFloat32(int16) {
  const f = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f[i] = int16[i] / 32768;
  return f;
}

function rmsOf(int16) {
  let s = 0;
  for (let i = 0; i < int16.length; i++) { const v = int16[i] / 32768; s += v * v; }
  return Math.sqrt(s / (int16.length || 1));
}

function concat(frames) {
  let n = 0; for (const f of frames) n += f.length;
  const out = new Int16Array(n);
  let o = 0; for (const f of frames) { out.set(f, o); o += f.length; }
  return out;
}

export function createAsr({ modelName = 'base.en', onTranscript, onCommitted, onError } = {}) {
  let running = false;
  let transcribing = false;
  let noiseFloor = ABS_FLOOR;      // adaptive background-energy estimate
  let inSpeech = false;
  let speechMs = 0, silenceMs = 0;
  let utter = [];                  // frames of the active utterance (incl. pre-roll)
  let preroll = [];                // recent pre-onset frames (ring of PREROLL_FRAMES)
  let queue = [];                  // utterances awaiting transcription
  let idleFrames = 0;

  // Transcribe queued utterances one at a time (Whisper is single-session). Draining
  // sequentially preserves order and never blocks the audio callback.
  async function drain() {
    if (transcribing) return;
    const frames = queue.shift();
    if (!frames) return;
    transcribing = true;
    try {
      const text = await whisperBin.transcribe(toFloat32(concat(frames)), modelName);
      if (text != null) {                 // null = model still loading → just skip
        dbg('utterance →', JSON.stringify(text));
        onTranscript?.({ committed: text, tail: '', full: text });
        if (text) onCommitted?.(text, text);
      }
    } catch (e) {
      onError?.(e.message);
    } finally {
      transcribing = false;
      if (queue.length) drain();          // process the next queued utterance
    }
  }

  function flush(reason) {
    const frames = utter; const sp = speechMs;
    utter = []; inSpeech = false; speechMs = 0; silenceMs = 0;
    if (!frames.length || sp < MIN_SPEECH_MS) return;
    dbg(`flush (${reason}): ${sp}ms speech, ${frames.length} frames`);
    queue.push(frames);
    if (queue.length > MAX_QUEUE) queue.shift(); // drop oldest if we fall behind
    drain();
  }

  function onFrame(int16) {
    if (!int16 || !int16.length) return;
    const e = rmsOf(int16);
    const onset = Math.max(ABS_FLOOR, noiseFloor * ONSET_RATIO);

    if (!inSpeech) {
      // Idle: adapt the noise floor and keep a short pre-roll so onset isn't clipped.
      noiseFloor = 0.97 * noiseFloor + 0.03 * e;
      preroll.push(int16);
      if (preroll.length > PREROLL_FRAMES) preroll.shift();
      if (++idleFrames % 40 === 0) dbg(`idle: rms=${e.toFixed(4)} floor=${noiseFloor.toFixed(4)} onset=${onset.toFixed(4)}`);
      if (e > onset) {
        inSpeech = true; speechMs = 0; silenceMs = 0; idleFrames = 0;
        utter = preroll.slice(); preroll = [];
        utter.push(int16); speechMs += FRAME_MS;
        dbg(`speech start: rms=${e.toFixed(4)} onset=${onset.toFixed(4)}`);
      }
      return;
    }

    // In speech: accumulate until the speaker pauses (or we hit the hard cap).
    utter.push(int16);
    if (e > onset * RELEASE_RATIO) { speechMs += FRAME_MS; silenceMs = 0; }
    else { silenceMs += FRAME_MS; }
    if (silenceMs >= END_SILENCE_MS) flush('pause');
    else if (speechMs + silenceMs >= MAX_UTTERANCE_MS) flush('maxlen');
  }

  return {
    pushAudio(int16) { if (running) onFrame(int16); },
    start() {
      running = true;
      noiseFloor = ABS_FLOOR; inSpeech = false;
      utter = []; preroll = []; queue = [];
      speechMs = 0; silenceMs = 0; idleFrames = 0;
    },
    stop() {
      running = false; inSpeech = false;
      utter = []; preroll = []; queue = [];
      speechMs = 0; silenceMs = 0;
    },
    isRunning() { return running; },
  };
}
