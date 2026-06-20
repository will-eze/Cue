// WebGPU ASR model store — the opt-in download / remove / clear operations behind the
// Settings model picker. Models cache via Chromium's Cache API (the transformers.js web
// build), which lands in userData/Service Worker/CacheStorage (backup-excluded). Downloads
// go through the worker (it owns transformers.js); removal/clear use the Cache API directly.
import WhisperWorker from './whisper-worker.web.js?worker';

// UI metadata for the GPU models. `repo` mirrors whisper-worker.web.js' MODELS (source of
// truth for repo+dtype) — kept here only to match Cache API entries for per-model removal.
export const GPU_MODELS = [
  { id: 'small.en',    label: 'Small.en', sub: 'Recommended — fast, low VRAM',         repo: 'onnx-community/whisper-small.en',       approxMB: 180 },
  { id: 'turbo-q4f16', label: 'Turbo',    sub: 'High accuracy (book names), larger',   repo: 'onnx-community/whisper-large-v3-turbo', approxMB: 380 },
];

// Download a model into the Cache API via the worker (allowDownload:true). onProgress(pct).
export function downloadGpuModel(modelId, onProgress) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new WhisperWorker(); } catch (e) { reject(e); return; }
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'progress') onProgress?.(Math.round((m.percent || 0) * 100), m.file);
      else if (m.type === 'ready') { worker.terminate(); resolve(); }
      else if (m.type === 'error') { worker.terminate(); reject(new Error(m.error || 'download failed')); }
    };
    worker.onerror = (err) => { worker.terminate(); reject(err instanceof Error ? err : new Error(String(err?.message || err))); };
    worker.postMessage({ type: 'load', model: modelId, allowDownload: true });
  });
}

// Delete one model's cached weights (Cache API entries whose URL contains its repo path).
export async function removeGpuModel(modelId) {
  const repo = GPU_MODELS.find((m) => m.id === modelId)?.repo;
  if (!repo || typeof caches === 'undefined') return;
  for (const name of await caches.keys()) {
    if (!/transformers/i.test(name)) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      if (req.url.includes(repo)) { try { await cache.delete(req); } catch {} }
    }
  }
}

// Drop ALL transformers.js caches (every downloaded GPU model).
export async function clearGpuModels() {
  if (typeof caches === 'undefined') return;
  for (const name of await caches.keys()) {
    if (/transformers/i.test(name)) { try { await caches.delete(name); } catch {} }
  }
}
