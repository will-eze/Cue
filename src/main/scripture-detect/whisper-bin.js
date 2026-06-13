// whisper.cpp binary + ggml model provisioning. Same policy as youtube/bin.js:
// nothing ships in the installer; we resolve from userData/whisper → system PATH →
// a dev-only resources/whisper copy, and only download what's missing on first use.
//
// Binary: the stock whisper.cpp CLI (`whisper-cli`, formerly `main`). Prebuilt
// binaries vary by platform; we look for one the user/dev provided and, on macOS,
// fall back to a Homebrew `whisper-cpp`. The ggml MODEL has stable hosted URLs
// (Hugging Face), so that we always auto-download.
//
// Model auto-pick by hardware: Apple Silicon (Metal) is fast enough for small.en;
// everything else defaults to base.en (real-time on a modern CPU). Overridable in
// Settings.

import os from 'os';
import path from 'path';
import fs from 'fs';
import { userDir, bundledDir, exe, findOnPath, downloadTo } from './provision.js';

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const MODELS = {
  'base.en':  { file: 'ggml-base.en.bin',  url: `${HF_BASE}/ggml-base.en.bin`  },
  'small.en': { file: 'ggml-small.en.bin', url: `${HF_BASE}/ggml-small.en.bin` },
  'tiny.en':  { file: 'ggml-tiny.en.bin',  url: `${HF_BASE}/ggml-tiny.en.bin`  },
};

function dir() { return userDir('whisper'); }

// Pick a default model from detected hardware. Apple Silicon → small.en; a
// roomy multi-core box → small.en; otherwise base.en.
export function autoModel() {
  const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
  const cores = os.cpus()?.length || 4;
  const gbRam = os.totalmem() / 1e9;
  if (isAppleSilicon) return 'small.en';
  if (cores >= 8 && gbRam >= 16) return 'small.en';
  return 'base.en';
}

let binCache = null;
export function clearCache() { binCache = null; }

// Resolve the whisper CLI: userData/whisper → PATH (whisper-cli / whisper-cpp /
// main) → dev resources/whisper. Returns an absolute path or null.
export function whisperPath() {
  if (binCache && fs.existsSync(binCache)) return binCache;
  const names = ['whisper-cli', 'whisper-cpp', 'main'];
  const candidates = [
    ...names.map((n) => path.join(dir(), exe(n))),
    ...names.map((n) => path.join(bundledDir('whisper'), exe(n))),
  ];
  let resolved = candidates.find((p) => fs.existsSync(p)) || null;
  if (!resolved) {
    for (const n of names) { const p = findOnPath(n); if (p) { resolved = p; break; } }
  }
  binCache = resolved;
  return resolved;
}

export function modelPath(name) {
  const m = MODELS[name] || MODELS['base.en'];
  return path.join(dir(), m.file);
}

export function modelReady(name) { return fs.existsSync(modelPath(name)); }
export function binReady() { return !!whisperPath(); }
export function isReady(name) { return binReady() && modelReady(name); }

export function detect(name) {
  return { bin: whisperPath(), model: modelReady(name) ? modelPath(name) : null, modelName: name };
}

// Ensure the chosen model exists, downloading it if missing. The BINARY is not
// auto-downloaded (no single stable cross-platform URL) — readiness reflects
// whether it was found; the UI prompts the user to install it if not.
let ensurePromise = null;
export function ensureModel(name, onProgress) {
  const target = MODELS[name] ? name : 'base.en';
  if (modelReady(target)) return Promise.resolve({ ok: true });
  if (!ensurePromise) {
    ensurePromise = downloadTo(MODELS[target].url, modelPath(target), (p) =>
      onProgress?.({ name: target, percent: p }))
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, error: err.message }))
      .finally(() => { ensurePromise = null; });
  }
  return ensurePromise;
}

export { MODELS };
