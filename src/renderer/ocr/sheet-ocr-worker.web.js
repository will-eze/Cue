// Sheet-music OCR — renderer Web Worker.
//
// Runs transformers.js' WEB build (Florence-2) to OCR a page image of sheet music and
// return text lines with bounding boxes in reading order. Mirrors the WebGPU whisper
// worker (audio/whisper-worker.web.js): local onnxruntime-web wasm (NO CDN — the wasm is
// bundled and referenced via Vite `?url`), model weights cached by Chromium's Cache API
// (opt-in download), a single-flight serializer around generate() (ORT/WebGPU isn't
// re-entrant). Structuring the raw lines into title/verses/chorus happens on the main
// thread in ocr/sheetParse.js; this worker only reads pixels → text.
//
// Loaded via Vite `?worker` (see ocr/sheetOcrStore.js + components/SheetMusicImportModal.jsx).

import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

// Florence-2 base (fine-tuned) — strong document/scene OCR, ~340 MB across the ONNX
// variants below. `-ft` beats plain `-base` on the OCR/region tasks we use.
const MODEL_ID = 'onnx-community/Florence-2-base-ft';
// Per-module dtypes from the transformers.js Florence-2 reference: keep the vision
// encoder fp32 (OCR accuracy is sensitive to it) and quantise the language decoder (q4)
// for size/speed. `dtype` can be a per-module map.
const DTYPE = {
  embed_tokens: 'fp16',
  vision_encoder: 'fp32',
  encoder_model: 'fp16',
  decoder_model_merged: 'q4',
};
// Region OCR gives per-line text + quad boxes, so we can reconstruct reading order and
// line breaks (plain '<OCR>' returns one run-on string with no structure).
const TASK = '<OCR_WITH_REGION>';

let tf = null;         // the imported transformers.js module
let model = null;      // resident Florence-2 model
let processor = null;  // resident Florence-2 processor (image preprocess + prompt + decode)
let tail = Promise.resolve(); // serialize generate() — one decode at a time on the device

function post(m) { self.postMessage(m); }

// Load the model resident (WebGPU when available, else wasm). transformers' browser cache
// is a layer over the REMOTE path: a cache hit short-circuits the network, so an
// already-downloaded model loads with no fetch. The opt-in guarantee (never auto-download)
// is enforced upstream — SheetMusicImportModal only calls this after sheetModelPresent(),
// and the explicit "Download" button is the only path that fetches a missing model.
async function ensureLoaded() {
  if (model && processor) return;
  tf = tf || await import('@huggingface/transformers');
  // Local wasm (no CDN) — { wasm, mjs } pair, the shape transformers v4 expects.
  tf.env.backends.onnx.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
  tf.env.allowLocalModels = false;    // weights come from the HF Hub (cached in Cache API)
  tf.env.allowRemoteModels = true;    // cache-first; a downloaded model loads with no network
  tf.env.useBrowserCache = true;
  const device = (typeof navigator !== 'undefined' && navigator.gpu) ? 'webgpu' : 'wasm';
  const progress_callback = (pg) => {
    if (pg?.status === 'progress' && pg.total) {
      post({ type: 'progress', file: pg.file || '', percent: (pg.loaded || 0) / pg.total });
    }
  };
  model = await tf.Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, { dtype: DTYPE, device, progress_callback });
  processor = await tf.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });
}

// OCR one page. `bytes` is a PNG/JPEG ArrayBuffer, `mime` its type. Returns text lines with
// normalized (0–1) top-left positions so the caller can sort into reading order across pages.
async function ocrPage(bytes, mime) {
  await ensureLoaded();
  const image = await tf.RawImage.fromBlob(new Blob([bytes], { type: mime || 'image/png' }));
  const prompts = processor.construct_prompts(TASK);
  const inputs = await processor(image, prompts);
  const ids = await model.generate({ ...inputs, max_new_tokens: 1024, num_beams: 1, do_sample: false });
  const decoded = processor.batch_decode(ids, { skip_special_tokens: false })[0];
  const parsed = processor.post_process_generation(decoded, TASK, image.size);
  const region = parsed?.[TASK] || {};
  const labels = region.labels || [];
  const boxes = region.quad_boxes || [];
  const [W, H] = image.size;
  const lines = labels.map((lbl, i) => {
    const q = boxes[i] || [];
    const xs = q.filter((_, j) => j % 2 === 0);
    const ys = q.filter((_, j) => j % 2 === 1);
    const x = xs.length ? Math.min(...xs) : 0;
    const y = ys.length ? Math.min(...ys) : 0;
    return {
      // Florence tags region labels with </s> separators — strip them.
      text: String(lbl).replace(/<\/?s>/g, '').replace(/\s+/g, ' ').trim(),
      x: W ? x / W : 0,
      y: H ? y / H : 0,
    };
  }).filter((l) => l.text);
  return { lines, width: W, height: H };
}

// Chain a decode behind the previous one — never two concurrent generate() calls.
function serialize(fn) {
  const run = tail.then(fn);
  tail = run.catch(() => {});
  return run;
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    switch (msg.type) {
      case 'load':
        post({ type: 'loading' });
        await serialize(() => ensureLoaded());
        post({ type: 'ready' });
        break;
      case 'ocr': {
        const res = await serialize(() => ocrPage(msg.bytes, msg.mime));
        post({ type: 'result', page: msg.page ?? 0, ...res });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    post({ type: 'error', error: err?.message || String(err), phase: msg.type });
  }
};
