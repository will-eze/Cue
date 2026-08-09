// Whisper ASR engine provisioning — transformers.js / onnxruntime-node backend.
//
// Per the benchmarked decision (RTF ~0.22 for base.en on Apple Silicon; real-time
// on a modern CPU), ASR runs through @huggingface/transformers rather than a
// whisper.cpp binary: there is no stable cross-platform prebuilt whisper.cpp CLI to
// auto-download, whereas transformers.js auto-downloads the Whisper ONNX weights +
// tokenizer on first use and keeps the model RESIDENT (no per-step reload). The
// engine sits behind this module's interface, so a faster whisper.cpp (ggml) path
// can swap in later without touching asr.js / the manager.
//
// Same provisioning policy as the rest of the app: nothing ships in the installer;
// the model is fetched into userData/whisper-model on first enable.
//
// @huggingface/transformers is ESM-only and the main bundle is CommonJS, so it is
// always reached via dynamic import().

import os from 'os';
import path from 'path';
import fs from 'fs';
import { userDir, dirSizeBytes } from './provision.js';

// transformers.js model repos (Xenova ONNX exports) per size.
const MODELS = {
  'tiny.en':  { repo: 'Xenova/whisper-tiny.en'  },
  'base.en':  { repo: 'Xenova/whisper-base.en'  },
  'small.en': { repo: 'Xenova/whisper-small.en' },
};

// Run the INT8-quantized ONNX weights. Benchmarked in the Electron runtime against
// the fp32 weights (JFK 16 kHz sample): ~1.85× faster on small.en (a 2 s utterance
// 2925 ms → 1579 ms) with no transcription change, and a much smaller download
// (~¼ the size). Whisper's encoder is fixed at a 30 s window, so per-utterance time
// is near-constant regardless of length — quantization is the one real speed lever
// (CoreML/CPU-EP gave nothing here). The dtype is baked into the ready-marker so a
// dtype change forces a re-fetch rather than loading stale fp32 files.
const QUANT = 'q8';

function cacheDir() { return userDir('whisper-model'); }
function readyMarker(name) { return path.join(cacheDir(), `.ready-${name}-${QUANT}`); }

// Pick a default model from detected hardware: Apple Silicon (fast) → small.en; a
// roomy multi-core box → small.en; otherwise base.en (real-time on a modern CPU).
export function autoModel() {
  const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
  const cores = os.cpus()?.length || 4;
  const gbRam = os.totalmem() / 1e9;
  if (isAppleSilicon) return 'small.en';
  if (cores >= 8 && gbRam >= 16) return 'small.en';
  return 'base.en';
}

// CPU thread budgets for the resident ONNX sessions. onnxruntime-node defaults each
// session's intra-op pool to ~core count, and transformers.js loads encoder + decoder
// as separate sessions — so a two-tier setup (commit model + tiny.en interim) spins up
// ~4 full-core pools that thrash the cores and slow the AUTHORITATIVE commit decode.
// We cap them so commit + interim together never exceed the cores: the commit gets the
// lion's share (it's the result that goes to air), the interim a small slice, and ~1–2
// cores stay free for the audio callback + main. (The commit only ever runs alongside
// an interim briefly — interims defer while a commit is in flight, see asr.js.)
export function commitThreads() { return Math.max(1, (os.cpus()?.length || 4) - 2); }
export function interimThreads() { return Math.max(1, Math.min(2, (os.cpus()?.length || 4) - 2)); }

// The engine (npm package) is always present — there is no separate binary to
// install. Kept for the manager/Settings readiness shape.
export function binReady() { return true; }

// A model is ready once it has been fully fetched + loaded once (marker written).
export function modelReady(name) {
  return fs.existsSync(readyMarker(MODELS[name] ? name : 'base.en'));
}

export function isReady(name) { return binReady() && modelReady(name); }
export function detect(name) {
  return { engine: 'transformers.js', model: modelReady(name) ? MODELS[name]?.repo : null, modelName: name };
}

// ── resident pipelines ───────────────────────────────────────────────────────
// A MAP of resident pipelines keyed by model name, not a single pipe: the two-tier
// interim path keeps a fast tiny.en pipe resident for live partials WHILE the
// authoritative commit model (base/small.en) stays loaded. Each entry holds its own
// decoder prompt and a single-flight tail promise that SERIALIZES transcribe() calls
// for that model — onnxruntime CPU sessions are not concurrency-safe, and the commit
// decode and an interim decode can otherwise overlap. Different models run on
// independent sessions, so interims never block the commit when they use a separate
// model (the recommended/default config).
const pipes = new Map();        // name → { pipe, promptIds, tail: Promise }
const loadPromises = new Map(); // name → in-flight ensureModel promise

// Bias Whisper's decoder toward the 66 book names (deduped — numbered books share a
// name). Whisper's `prompt_ids` is the documented way to prime "custom vocabularies
// or proper nouns" so they're transcribed correctly — book names (Habakkuk,
// Colossians, Thessalonians…) are exactly the hard, accuracy-critical tokens here.
// Measured cost in-runtime: +~23 ms/utterance (≈1%), and zero change to normal
// speech (verified on a non-scripture sample), so it's an effectively free accuracy
// gain. The reference parser still requires chapter/verse numbers to fire, so a
// stray prompted noun can't auto-air a false reference.
const BOOK_PROMPT = ' Genesis Exodus Leviticus Numbers Deuteronomy Joshua Judges Ruth'
  + ' Samuel Kings Chronicles Ezra Nehemiah Esther Job Psalms Proverbs Ecclesiastes'
  + ' Song of Solomon Isaiah Jeremiah Lamentations Ezekiel Daniel Hosea Joel Amos'
  + ' Obadiah Jonah Micah Nahum Habakkuk Zephaniah Haggai Zechariah Malachi Matthew'
  + ' Mark Luke John Acts Romans Corinthians Galatians Ephesians Philippians Colossians'
  + ' Thessalonians Timothy Titus Philemon Hebrews James Peter Jude Revelation';

// Resolve a requested model name to a known repo key (fallback base.en).
function resolveName(name) { return MODELS[name] ? name : 'base.en'; }

// Build the decoder prompt once per loaded model: [<|startofprev|>, ...book tokens].
function buildPromptIds(p) {
  try {
    const tk = p.tokenizer;
    const sop = tk.encode('<|startofprev|>', { add_special_tokens: false })[0];
    const toks = tk.encode(BOOK_PROMPT, { add_special_tokens: false });
    return Number.isInteger(sop) ? [sop, ...toks] : toks;
  } catch { return null; }
}

// Configure transformers.js to cache into userData and run on CPU.
async function loadTransformers() {
  const tf = await import('@huggingface/transformers');
  tf.env.cacheDir = cacheDir();
  tf.env.allowRemoteModels = true;
  return tf;
}

// Ensure the chosen model is downloaded + resident. Reports 0–1 download progress
// per file via onProgress({ name, percent }). Single-flight; re-loads if the model
// changed. Returns { ok } | { ok:false, error }.
export function ensureModel(name, onProgress, opts = {}) {
  const target = resolveName(name);
  if (pipes.has(target)) return Promise.resolve({ ok: true });
  if (loadPromises.has(target)) return loadPromises.get(target);
  // Thread cap is baked into the session at load — the first ensureModel for a given
  // model wins (the manager loads commit then interim with their budgets up front, so
  // a later self-heal call's default never overrides). interOp stays 1: a single
  // utterance runs its graph serially, so inter-op parallelism only adds contention.
  const intraOpNumThreads = opts.intraOpNumThreads ?? commitThreads();
  const p = (async () => {
    try {
      const { pipeline } = await loadTransformers();
      fs.mkdirSync(cacheDir(), { recursive: true });
      const next = await pipeline('automatic-speech-recognition', MODELS[target].repo, {
        dtype: QUANT, // INT8-quantized weights — see QUANT note above.
        // CRITICAL (Electron-only crash): onnxruntime's default CPU memory arena
        // (BFCArena) requests one large *aligned* block for Whisper's decoder.
        // Electron overrides global new/malloc with its PartitionAlloc shim, which
        // aborts that large aligned allocation → EXC_BREAKPOINT/SIGTRAP that takes
        // down the whole app the instant the first inference runs. (Plain Node has
        // no such shim, so it never showed; embeddings survive because MiniLM's
        // allocations are small.) Disabling the arena makes ORT do many small
        // direct allocations instead, which the shim allows. DO NOT REMOVE.
        session_options: {
          enableCpuMemArena: false, enableMemPattern: false, executionProviders: ['cpu'],
          intraOpNumThreads, interOpNumThreads: 1,
        },
        progress_callback: (pg) => {
          if (pg?.status === 'progress' && pg.total) {
            onProgress?.({ name: pg.file || target, percent: (pg.loaded || 0) / pg.total });
          }
        },
      });
      pipes.set(target, { pipe: next, promptIds: buildPromptIds(next), tail: Promise.resolve() });
      fs.writeFileSync(readyMarker(target), String(Date.now()));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      loadPromises.delete(target);
    }
  })();
  loadPromises.set(target, p);
  return p;
}

// Transcribe a Float32 mono 16 kHz buffer with the resident pipeline. Returns the
// text, or null if the model isn't loaded yet (detection silently idles until the
// user provisions it from Settings — mirrors the old "binary missing" behaviour).
export async function transcribe(float32, name) {
  const target = resolveName(name);
  const entry = pipes.get(target);
  if (!entry) {
    // The resident pipeline isn't loaded. This is the normal state on every app
    // launch AFTER the first download: the on-disk `.ready-*` marker exists, so
    // the renderer skips ensureModel, and nothing ever rehydrates the map. Kick a
    // single-flight load here (a quick reload from cache; a download only on a
    // truly fresh machine) and idle until it's ready. Self-heals regardless of
    // how detection was started.
    ensureModel(target);
    return null;
  }
  // Serialize per-model: chain this decode behind the model's previous one so a
  // commit decode and an interim decode on the SAME pipe never run concurrently
  // (onnxruntime CPU sessions aren't re-entrant). Independent models don't share a
  // tail, so two-tier interims (tiny.en) run free of the commit (small/base.en).
  const run = entry.tail.then(() => decodeOne(entry, float32));
  entry.tail = run.catch(() => {}); // keep the chain alive even if a decode throws
  return run;
}

async function decodeOne(entry, float32) {
  // Whisper's encoder pads every input to a `chunk_length_s` window before running.
  // The ONNX encoder's mel axis is dynamic, so padding a short VAD utterance to just
  // above its real length (instead of the full 30 s) cuts encoder work with no change
  // to the text. Pad to ⌈dur⌉+2 s, floored at 8 s (avoids a near-boundary chunking
  // slowdown) and capped at 30 s — utterances are VAD-bounded ≤18 s, so this is
  // always a single chunk (no cross-chunk merge artefacts). Measured ~20% faster.
  // NB: models are English-only (*.en) — passing `language`/`task` throws
  // ("Cannot specify task or language for an English-only model").
  const durSec = float32.length / 16000;
  const chunkLengthS = Math.min(30, Math.max(8, Math.ceil(durSec) + 2));
  const opts = { chunk_length_s: chunkLengthS };
  if (entry.promptIds) opts.prompt_ids = entry.promptIds; // bias toward book names (see BOOK_PROMPT)
  const r = await entry.pipe(float32, opts);
  return (r?.text || '').replace(/\s+/g, ' ').trim();
}

export function dispose() { pipes.clear(); loadPromises.clear(); }

// ── Package-manager surface ──────────────────────────────────────────────────
// The CPU whisper cache is a single userData dir shared by every downloaded model
// size; the manager reports/removes it as one package. `anyModelReady` is true once
// ANY size has been fetched (a fresh install nudges the user to download).
export function modelStorePath() { return cacheDir(); }
export function storeSizeBytes() { return dirSizeBytes(cacheDir()); }
export function anyModelReady() { return Object.keys(MODELS).some(modelReady); }
export function removeModels() {
  dispose(); // drop resident pipes so no ONNX session holds the files open
  try { fs.rmSync(cacheDir(), { recursive: true, force: true }); } catch {}
  return { ok: true };
}

export { MODELS };
