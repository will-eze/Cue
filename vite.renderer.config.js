import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Build number ≈ total git commit count, resolved at config eval (dev serve + make).
// Falls back to 0 when git isn't available (e.g. building from a source tarball).
function gitCommitCount() {
  try {
    return parseInt(execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// MAJOR = current DB schema version, derived from the highest migration (vN) in
// schema.js so it can never drift from the schema. Bump MINOR/PATCH by hand per the
// convention in CLAUDE.md (MINOR = features w/o migration; PATCH = fixes/docs/chores).
const VERSION_MINOR = 3;
const VERSION_PATCH = 0;

function schemaVersion() {
  try {
    const src = readFileSync(fileURLToPath(new URL('./src/main/db/schema.js', import.meta.url)), 'utf8');
    const versions = [...src.matchAll(/function\s+v(\d+)\s*\(/g)].map((m) => Number(m[1]));
    return versions.length ? Math.max(...versions) : 0;
  } catch {
    return 0;
  }
}

const APP_VERSION = `${schemaVersion()}.${VERSION_MINOR}.${VERSION_PATCH}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_NUMBER__: JSON.stringify(gitCommitCount()),
  },
  // WebGPU ASR (renderer worker, whisper-worker.web.js): keep transformers.js out of
  // Vite's dep pre-bundle — its onnxruntime-web wasm/WebGPU assets choke esbuild's
  // optimizer, and the worker dynamic-imports it. ORT-web wasm is served locally via the
  // worker's `?url` imports (no CDN).
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  // Electron's Chromium supports <link rel="modulepreload"> natively, so drop Vite's inline
  // polyfill script — it's the only inline <script> in the built HTML, and the packaged
  // Content-Security-Policy (src/main/index.js) sets script-src 'self' with no 'unsafe-inline'.
  // Without this, that inline script would be CSP-blocked.
  build: { modulePreload: { polyfill: false } },
  // The ASR worker dynamic-imports transformers.js → code-splitting, which Vite's default
  // `iife` worker format can't do (only shows in the production build, not `npm start`).
  // ES-module workers support it; Vite then instantiates with `new Worker(url, {type:'module'})`.
  worker: { format: 'es' },
});
