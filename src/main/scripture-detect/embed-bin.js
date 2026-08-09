// Sentence-embedding model provisioning (all-MiniLM-L6-v2, ONNX). Same bin-style
// policy: auto-downloaded into userData/embed-model on first enable, never shipped.
// We pull the quantized ONNX graph + the BERT WordPiece vocab (the worker tokenizes
// with vocab.txt directly — no transformers.js dependency).

import path from 'path';
import fs from 'fs';
import { userDir, downloadTo, dirSizeBytes } from './provision.js';

// Xenova mirror exposes a stable, CORS-friendly ONNX export of MiniLM.
const BASE = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main';
const FILES = [
  { name: 'model.onnx', url: `${BASE}/onnx/model_quantized.onnx` },
  { name: 'vocab.txt',  url: `${BASE}/vocab.txt` },
];

export const EMBED_DIM = 384;          // MiniLM-L6 hidden size
export const MODEL_ID = 'all-MiniLM-L6-v2';

export function modelDir() { return userDir('embed-model'); }
export function modelFile(name) { return path.join(modelDir(), name); }
export function isReady() { return FILES.every((f) => fs.existsSync(modelFile(f.name))); }

let ensurePromise = null;
export function ensureModel(onProgress) {
  if (isReady()) return Promise.resolve({ ok: true });
  if (!ensurePromise) ensurePromise = doEnsure(onProgress).finally(() => { ensurePromise = null; });
  return ensurePromise;
}

async function doEnsure(onProgress) {
  try {
    const missing = FILES.filter((f) => !fs.existsSync(modelFile(f.name)));
    for (let i = 0; i < missing.length; i++) {
      const f = missing[i];
      await downloadTo(f.url, modelFile(f.name), (p) =>
        onProgress?.({ name: f.name, index: i, count: missing.length, percent: p }));
    }
    if (!isReady()) throw new Error('embedding model download incomplete');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Package-manager surface ──────────────────────────────────────────────────
export function modelStorePath() { return modelDir(); }
export function storeSizeBytes() { return dirSizeBytes(modelDir()); }
export function removeModel() {
  try { fs.rmSync(modelDir(), { recursive: true, force: true }); } catch {}
  return { ok: true };
}
