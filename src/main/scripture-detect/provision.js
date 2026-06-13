// Shared provisioning helpers for the scripture-detection assets (whisper binary
// + ggml model, sentence-embedding model). Mirrors src/main/youtube/bin.js: assets
// are NOT shipped in the installer (anti-bloat — see CLAUDE.md), they are
// auto-downloaded into userData on first enable with single-flight + progress.

import { app } from 'electron';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export function platformDir() { return `${process.platform}-${process.arch}`; }
export function exe(name) { return process.platform === 'win32' ? `${name}.exe` : name; }

// userData/<sub> — where auto-downloaded assets live (kept across runs).
export function userDir(sub) { return path.join(app.getPath('userData'), sub); }

// Dev-only bundled copy under resources/<sub> (present in a checkout, never packaged).
export function bundledDir(sub) {
  return app.isPackaged
    ? path.join(process.resourcesPath, sub)
    : path.join(app.getAppPath(), 'resources', sub);
}

export function findOnPath(name) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, [name], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().split(/\r?\n/)[0];
    return out && fs.existsSync(out) ? out : null;
  } catch { return null; }
}

// Stream a URL to `dest` (atomic via .part rename), reporting 0–1 progress.
export async function downloadTo(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  let received = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      if (onProgress) onProgress(total ? received / total : 0);
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    try { out.destroy(); fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
  if (process.platform !== 'win32') { try { fs.chmodSync(tmp, 0o755); } catch {} }
  fs.renameSync(tmp, dest);
}
