// VAD-segmented transcription with VAD-GATED interim decoding.
//
// Authoritative model: segment incoming audio into UTTERANCES with a lightweight
// energy VAD (detect speech onset, buffer until the speaker pauses), then transcribe
// that one complete, silence-trimmed utterance and hand its FULL text to detection
// (`onCommitted`). A clean bounded clip per utterance gives Whisper its best accuracy
// and never discards a correct transcription.
//
// Latency layer (allowed, NOT the banned rolling window): while the VAD says speech
// is ACTIVE, we also decode the accumulated SPEECH-ONLY buffer at a coarse cadence
// (and immediately on a soft intra-phrase pause) and emit an *interim* hypothesis
// (`onInterim`). This produces transcript while a long verse is still being read,
// instead of only after the full stop. Crucially it decodes only the speech-active
// buffer — never silence — so it cannot reproduce the hallucination/lossy-commit
// failure that got fixed-window-over-silence transcription (the old LocalAgreement
// scheme) banned. The end-of-utterance commit is unchanged and remains the single
// source of truth; interims only stage a Preview, they never go to air. Interim
// decodes are LATEST-WINS and may run on a separate fast model (tiny.en) so they
// never block the authoritative commit. See plan/scripture-improvements.md §2.
//
// The engine sits behind whisper-bin.js so a faster path could swap in unchanged.

import * as whisperBin from './whisper-bin.js';

const SAMPLE_RATE = 16000;
const FRAME_MS = 250;            // each pushed frame ≈ 4000 samples @ 16 kHz
const MIN_SPEECH_MS = 350;       // ignore blips shorter than this (clicks, coughs)
const MAX_UTTERANCE_MS = 18000;  // hard cap: force-flush a run-on so latency is bounded
const PREROLL_FRAMES = 2;        // ~500 ms kept before onset (don't clip the first word)
const ABS_FLOOR = 0.005;         // absolute RMS speech floor (normalized −1..1)
const ONSET_RATIO = 3.0;         // onset threshold = max(ABS_FLOOR, noiseFloor*ratio)
const RELEASE_RATIO = 0.55;      // hysteresis: stay "in speech" while above onset*this
const MAX_QUEUE = 4;             // cap the backlog of utterances awaiting transcription

// Tunable defaults (overridable per-instance from the manager config / presets).
const DEFAULTS = {
  endSilenceMs: 380,   // trailing silence that CLOSES an utterance (lower = snappier)
  interimEnabled: true,
  interimCadenceMs: 1000, // min gap between interim decodes while speech is active
  softPauseMs: 280,    // a short intra-phrase pause triggers an immediate interim
  interimModel: 'tiny.en', // fast resident model for interims (commit uses modelName)
};

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

export function createAsr({
  modelName = 'base.en', onTranscript, onCommitted, onInterim, onError, config = {},
} = {}) {
  const cfg = { ...DEFAULTS, ...config };
  // Interims only make sense on a model that's actually loadable; if the configured
  // interim model is the commit model, they share one serialized pipe (still safe,
  // just no parallelism). 'off'/null disables the second pipe and reuses the commit.
  const interimModel = cfg.interimEnabled
    ? (cfg.interimModel && cfg.interimModel !== 'off' ? cfg.interimModel : modelName)
    : null;

  let running = false;
  let transcribing = false;
  let noiseFloor = ABS_FLOOR;      // adaptive background-energy estimate
  let inSpeech = false;
  let speechMs = 0, silenceMs = 0;
  let utter = [];                  // frames of the active utterance (incl. pre-roll)
  let preroll = [];                // recent pre-onset frames (ring of PREROLL_FRAMES)
  let queue = [];                  // utterances awaiting transcription (commit path)
  let idleFrames = 0;
  let uttSeq = 0;                  // monotonic id per utterance (Phase 0 timing)
  let uttId = 0;                   // id of the active utterance
  let onsetAt = 0;                 // t_onset of the active utterance

  // ── interim decode (latest-wins, never blocks the commit) ───────────────────
  let interimBusy = false;
  let interimPending = null;       // { frames, id, onsetAt } latest waiting decode
  let lastInterimAt = 0;           // wall clock of the last interim decode kick
  let softPauseFired = false;      // one soft-pause interim per pause stretch

  async function runInterim(job) {
    // Same-model interims share the commit pipe → don't pile an interim in front of
    // a pending/active commit (the commit must win). Different model = independent.
    if (interimModel === modelName && (transcribing || queue.length)) { interimPending = job; return; }
    if (interimBusy) { interimPending = job; return; } // latest-wins: keep only newest
    interimBusy = true;
    try {
      const text = await whisperBin.transcribe(toFloat32(concat(job.frames)), interimModel);
      if (text) {
        onInterim?.({ text, id: job.id, interim: true, onsetAt: job.onsetAt });
      }
    } catch (e) {
      // Interims are best-effort; never surface as a hard error.
      dbg('interim decode error:', e?.message);
    } finally {
      interimBusy = false;
      if (interimPending) { const next = interimPending; interimPending = null; runInterim(next); }
    }
  }

  function kickInterim() {
    if (!interimModel || !utter.length) return;
    lastInterimAt = Date.now();
    runInterim({ frames: utter.slice(), id: uttId, onsetAt });
  }

  // Transcribe queued utterances one at a time (commit path is single-file). Draining
  // sequentially preserves order and never blocks the audio callback.
  async function drain() {
    if (transcribing) return;
    const job = queue.shift();
    if (!job) return;
    transcribing = true;
    const tFlush = job.flushAt;
    try {
      const text = await whisperBin.transcribe(toFloat32(concat(job.frames)), modelName);
      if (text != null) {                 // null = model still loading → just skip
        const tDone = Date.now();
        dbg(`utterance #${job.id} →`, JSON.stringify(text),
          `(onset→transcribed ${tDone - job.onsetAt}ms, asr ${tDone - tFlush}ms)`);
        onTranscript?.({ committed: text, tail: '', full: text });
        if (text) onCommitted?.(text, text, { id: job.id, onsetAt: job.onsetAt, transcribedAt: tDone });
      }
    } catch (e) {
      onError?.(e.message);
    } finally {
      transcribing = false;
      if (queue.length) drain();          // process the next queued utterance
      else if (interimPending) { const next = interimPending; interimPending = null; runInterim(next); }
    }
  }

  function flush(reason) {
    const frames = utter; const sp = speechMs; const id = uttId; const onset = onsetAt;
    utter = []; inSpeech = false; speechMs = 0; silenceMs = 0; softPauseFired = false;
    interimPending = null;               // the utterance is over — drop stale interims
    if (!frames.length || sp < MIN_SPEECH_MS) return;
    dbg(`flush #${id} (${reason}): ${sp}ms speech, ${frames.length} frames`);
    queue.push({ frames, id, onsetAt: onset, flushAt: Date.now() });
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
        uttId = ++uttSeq; onsetAt = Date.now(); softPauseFired = false; lastInterimAt = onsetAt;
        utter = preroll.slice(); preroll = [];
        utter.push(int16); speechMs += FRAME_MS;
        dbg(`speech start #${uttId}: rms=${e.toFixed(4)} onset=${onset.toFixed(4)}`);
      }
      return;
    }

    // In speech: accumulate until the speaker pauses (or we hit the hard cap).
    utter.push(int16);
    const voiced = e > onset * RELEASE_RATIO;
    if (voiced) { speechMs += FRAME_MS; silenceMs = 0; softPauseFired = false; }
    else { silenceMs += FRAME_MS; }

    if (silenceMs >= cfg.endSilenceMs) { flush('pause'); return; }
    if (speechMs + silenceMs >= MAX_UTTERANCE_MS) { flush('maxlen'); return; }

    // Interim triggers (only while we have enough real speech to be worth decoding):
    if (interimModel && speechMs >= MIN_SPEECH_MS) {
      const now = Date.now();
      // Soft intra-phrase pause → decode once, immediately (catches the end of a
      // clause before the full stop closes the utterance).
      if (!voiced && silenceMs >= cfg.softPauseMs && !softPauseFired) {
        softPauseFired = true; kickInterim();
      } else if (voiced && now - lastInterimAt >= cfg.interimCadenceMs) {
        // Coarse cadence during continuous speech (a long read with no pause).
        kickInterim();
      }
    }
  }

  return {
    pushAudio(int16) { if (running) onFrame(int16); },
    start() {
      running = true;
      noiseFloor = ABS_FLOOR; inSpeech = false;
      utter = []; preroll = []; queue = [];
      speechMs = 0; silenceMs = 0; idleFrames = 0;
      interimBusy = false; interimPending = null; softPauseFired = false;
    },
    stop() {
      running = false; inSpeech = false;
      utter = []; preroll = []; queue = [];
      speechMs = 0; silenceMs = 0;
      interimPending = null;
    },
    isRunning() { return running; },
  };
}
