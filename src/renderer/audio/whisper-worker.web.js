// WebGPU Whisper ASR — renderer Web Worker.
//
// The GPU counterpart to main's whisper-bin.js. Runs transformers.js' WEB build with
// device:'webgpu' on a resident pipeline, driven by the SHARED asr-core.js VAD/interim
// orchestration (the same logic the CPU path uses — see asr-core.js header). Audio frames
// arrive from useScriptureCapture's AudioWorklet; the worker segments + transcribes here
// in the renderer and posts utterance TEXT to the main thread, which forwards it to
// main-process detection (manager.ingestTranscript). Parser + content-match stay in main.
//
// Loaded via Vite `?worker` (see useScriptureAsr.js). ORT-web wasm is served LOCALLY from
// bundled assets (NO CDN) — see WASM paths below.

import { createAsrCore } from '../../main/scripture-detect/asr-core.js';

// Serve onnxruntime-web's wasm from local bundled assets instead of the jsdelivr CDN
// (the plan's hard requirement). Vite fingerprints these `?url` imports and emits them as
// build assets, so the same code resolves them in dev AND in a packaged asar. transformers
// v4 picks the `asyncify` build for WebGPU on non-Safari (it's what the spike used over CDN
// when WebGPU worked) and expects wasmPaths as a { wasm, mjs } pair (see its
// ensureWasmLoaded()).
// NB: import from the package ROOT, not /dist/ — onnxruntime-web's `exports` map exposes
// the wasm/mjs as `onnxruntime-web/ort-wasm-…` (it maps to ./dist/ internally). A /dist/
// specifier is blocked by the exports field and fails Vite resolution.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

// WebGPU-capable ONNX exports (onnx-community repos carry the fp16/q4 variants the Xenova
// q8 CPU repos don't). Mirrors the validated spike presets. dtype can be a per-module map.
const MODELS = {
  // small.en: fp16 encoder + q4 decoder. NOT a plain fp16 dtype — whisper-small.en's
  // decoder_model_merged_fp16.onnx is a broken export (ORT rejects it: "Subgraph output
  // (logits) is an outer scope value"). The q4 decoder loads cleanly (same approach as
  // turbo) and keeps the encoder fp16 for acoustic accuracy.
  'small.en': {
    repo: 'onnx-community/whisper-small.en',
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' }, multilingual: false,
  },
  'turbo-q4f16': {
    repo: 'onnx-community/whisper-large-v3-turbo',
    dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' }, multilingual: true,
  },
};
const DEFAULT_MODEL = 'small.en';

// Book-name decoder bias — kept verbatim from whisper-bin.js (the SOURCE OF TRUTH; update
// there and mirror here). Whisper's prompt_ids primes proper nouns so book names
// (Habakkuk, Colossians, Thessalonians…) transcribe correctly. The reference parser still
// requires chapter/verse numbers to fire, so a prompted noun alone can't auto-air.
const BOOK_PROMPT = ' Genesis Exodus Leviticus Numbers Deuteronomy Joshua Judges Ruth'
  + ' Samuel Kings Chronicles Ezra Nehemiah Esther Job Psalms Proverbs Ecclesiastes'
  + ' Song of Solomon Isaiah Jeremiah Lamentations Ezekiel Daniel Hosea Joel Amos'
  + ' Obadiah Jonah Micah Nahum Habakkuk Zephaniah Haggai Zechariah Malachi Matthew'
  + ' Mark Luke John Acts Romans Corinthians Galatians Ephesians Philippians Colossians'
  + ' Thessalonians Timothy Titus Philemon Hebrews James Peter Jude Revelation';

let core = null;            // the resident asr-core instance (created on start)
let pipe = null;            // resident transformers.js pipeline
let promptIds = null;       // book-name prompt for the loaded model
let loadedModel = null;     // id of the resident model
let multilingual = false;
let tail = Promise.resolve(); // single-flight serializer — onnxruntime/WebGPU isn't re-entrant

function post(msg) { self.postMessage(msg); }

function buildPromptIds(p) {
  try {
    const tk = p.tokenizer;
    const sop = tk.encode('<|startofprev|>', { add_special_tokens: false })[0];
    const toks = tk.encode(BOOK_PROMPT, { add_special_tokens: false });
    return Number.isInteger(sop) ? [sop, ...toks] : toks;
  } catch { return null; }
}

// Load the model resident on WebGPU. transformers' browser cache is a layer over the
// REMOTE path: a cache hit short-circuits the network, so an already-downloaded model
// loads with no fetch. `allowRemoteModels` must therefore stay true even on arm — setting
// it false (with allowLocalModels false) makes transformers throw "both local and remote
// models are disabled" before it ever consults the cache. The opt-in guarantee
// (never auto-download) is enforced UPSTREAM: useScriptureAsr only arms this worker when the
// model is already downloaded; the explicit Settings "Download" is the only path that
// fetches a missing model. `allowDownload` is kept for call-site intent only.
async function loadModel(modelId, allowDownload) { // eslint-disable-line no-unused-vars
  const id = MODELS[modelId] ? modelId : DEFAULT_MODEL;
  const m = MODELS[id];
  const tf = await import('@huggingface/transformers');
  // Local wasm (no CDN) — { wasm, mjs } pair, the shape transformers v4 expects. It forces
  // ORT proxy:false itself, and WebGPU is available in workers, so ORT runs on this thread.
  tf.env.backends.onnx.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
  tf.env.allowLocalModels = false;          // weights come from the HF Hub (cached in Cache API)
  tf.env.allowRemoteModels = true;          // cache-first; a downloaded model loads with no network
  tf.env.useBrowserCache = true;

  const next = await tf.pipeline('automatic-speech-recognition', m.repo, {
    device: 'webgpu',
    dtype: m.dtype,
    progress_callback: (pg) => {
      if (pg?.status === 'progress' && pg.total) {
        post({ type: 'progress', file: pg.file || id, percent: (pg.loaded || 0) / pg.total });
      }
    },
  });
  pipe = next;
  promptIds = buildPromptIds(next);
  multilingual = !!m.multilingual;
  loadedModel = id;
}

// Serialized decode of one Float32 mono 16 kHz buffer. Chains behind the previous decode
// (commit or interim) so two never run concurrently on the single WebGPU device — the same
// guarantee whisper-bin.js' per-model tail gives the CPU path. Returns text, or null if no
// model is resident yet (the core idles, exactly like the CPU "model still loading" case).
function transcribe(float32) {
  if (!pipe) return Promise.resolve(null);
  const run = tail.then(() => decodeOne(float32));
  tail = run.catch(() => {});
  return run;
}

async function decodeOne(float32) {
  // Adaptive chunk: pad to ⌈dur⌉+2 s, floored 8, capped 30 — VAD utterances are ≤18 s so
  // always a single chunk. ~20% cheaper than the full 30 s window (kept from whisper-bin.js).
  const durSec = float32.length / 16000;
  const opts = { chunk_length_s: Math.min(30, Math.max(8, Math.ceil(durSec) + 2)) };
  if (promptIds) opts.prompt_ids = promptIds;
  // English-only models reject language/task; multilingual (turbo) needs them pinned to en.
  if (multilingual) { opts.language = 'en'; opts.task = 'transcribe'; }
  const r = await pipe(float32, opts);
  return (r?.text || '').replace(/\s+/g, ' ').trim();
}

function startCore(config) {
  if (core) core.stop();
  core = createAsrCore({
    transcribeCommit: transcribe,
    transcribeInterim: transcribe,            // same GPU pipe (serialized); fast enough for interims
    onCommitted: (fresh, _committed, meta) => post({ type: 'commit', text: fresh, onsetAt: meta?.onsetAt }),
    onInterim: ({ text, onsetAt }) => post({ type: 'interim', text, onsetAt }),
    onError: (e) => post({ type: 'asr-error', error: e }),
    config,
  });
  core.start();
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    switch (msg.type) {
      case 'load': {
        post({ type: 'loading', model: msg.model });
        await loadModel(msg.model, !!msg.allowDownload);
        post({ type: 'ready', model: loadedModel });
        break;
      }
      case 'start':
        startCore(msg.config || {});
        post({ type: 'started' });
        break;
      case 'frame':
        // Transferable ArrayBuffer of Int16 PCM from the AudioWorklet.
        if (core && msg.buf) core.pushAudio(new Int16Array(msg.buf));
        break;
      case 'stop':
        if (core) { core.stop(); core = null; }
        post({ type: 'stopped' });
        break;
      default:
        break;
    }
  } catch (err) {
    post({ type: 'error', error: err?.message || String(err), phase: msg.type });
  }
};
