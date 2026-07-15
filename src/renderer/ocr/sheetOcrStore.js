// Sheet-music OCR model store — opt-in download / presence-check / remove for the Florence-2
// weights behind SheetMusicImportModal. Same shape as audio/gpuModelStore.js: weights cache
// via Chromium's Cache API (the transformers.js web build), which lands in
// userData/Service Worker/CacheStorage (backup-excluded). Download goes through the worker
// (it owns transformers.js); presence/remove use the Cache API directly.
import SheetOcrWorker from './sheet-ocr-worker.web.js?worker';

// `repo` mirrors sheet-ocr-worker.web.js' MODEL_ID (source of truth). approxMB is the total
// download across the ONNX dtype variants the worker requests — shown in the modal.
export const SHEET_MODEL = {
  id: 'florence2-base-ft',
  repo: 'onnx-community/Florence-2-base-ft',
  approxMB: 340,
};

// True once the weights are cached. The decoder ONNX is the last/largest file, so its
// presence is a reliable "download completed" sentinel (a half-finished download won't have it).
export async function sheetModelPresent() {
  if (typeof caches === 'undefined') return false;
  for (const name of await caches.keys()) {
    if (!/transformers/i.test(name)) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      if (req.url.includes(SHEET_MODEL.repo) && /decoder_model_merged[^/]*\.onnx(_data)?$/.test(req.url)) return true;
    }
  }
  return false;
}

// Download the model into the Cache API via the worker. onProgress(pct, file).
export function downloadSheetModel(onProgress) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new SheetOcrWorker(); } catch (e) { reject(e); return; }
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'progress') onProgress?.(Math.round((m.percent || 0) * 100), m.file);
      else if (m.type === 'ready') { worker.terminate(); resolve(); }
      else if (m.type === 'error') { worker.terminate(); reject(new Error(m.error || 'download failed')); }
    };
    worker.onerror = (err) => { worker.terminate(); reject(err instanceof Error ? err : new Error(String(err?.message || err))); };
    worker.postMessage({ type: 'load' });
  });
}

// Delete the model's cached weights (Cache API entries whose URL contains its repo path).
export async function removeSheetModel() {
  if (typeof caches === 'undefined') return;
  for (const name of await caches.keys()) {
    if (!/transformers/i.test(name)) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      if (req.url.includes(SHEET_MODEL.repo)) { try { await cache.delete(req); } catch {} }
    }
  }
}
