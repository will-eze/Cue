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
import { userDir } from './provision.js';

// transformers.js model repos (Xenova ONNX exports) per size.
const MODELS = {
  'tiny.en':  { repo: 'Xenova/whisper-tiny.en'  },
  'base.en':  { repo: 'Xenova/whisper-base.en'  },
  'small.en': { repo: 'Xenova/whisper-small.en' },
};

function cacheDir() { return userDir('whisper-model'); }
function readyMarker(name) { return path.join(cacheDir(), `.ready-${name}`); }

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

// ── resident pipeline ────────────────────────────────────────────────────────
let pipe = null;            // the loaded ASR pipeline
let pipeModel = null;       // which model it was loaded for
let loadPromise = null;

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
export function ensureModel(name, onProgress) {
  const target = MODELS[name] ? name : 'base.en';
  if (pipe && pipeModel === target) return Promise.resolve({ ok: true });
  if (loadPromise && pipeModel === target) return loadPromise;
  pipeModel = target;
  loadPromise = (async () => {
    try {
      const { pipeline } = await loadTransformers();
      fs.mkdirSync(cacheDir(), { recursive: true });
      const next = await pipeline('automatic-speech-recognition', MODELS[target].repo, {
        progress_callback: (p) => {
          if (p?.status === 'progress' && p.total) {
            onProgress?.({ name: p.file || target, percent: (p.loaded || 0) / p.total });
          }
        },
      });
      pipe = next;
      fs.writeFileSync(readyMarker(target), String(Date.now()));
      return { ok: true };
    } catch (err) {
      pipe = null; pipeModel = null;
      return { ok: false, error: err.message };
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

// Transcribe a Float32 mono 16 kHz buffer with the resident pipeline. Returns the
// text, or null if the model isn't loaded yet (detection silently idles until the
// user provisions it from Settings — mirrors the old "binary missing" behaviour).
export async function transcribe(float32, name) {
  const target = MODELS[name] ? name : 'base.en';
  if (!pipe || pipeModel !== target) return null;
  const r = await pipe(float32, { chunk_length_s: 30, language: 'en', task: 'transcribe' });
  return (r?.text || '').replace(/\s+/g, ' ').trim();
}

export function dispose() { pipe = null; pipeModel = null; loadPromise = null; }
export { MODELS };
