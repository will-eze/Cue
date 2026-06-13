// ── yt-dlp + ffmpeg provisioning ─────────────────────────────────────────────
// The YouTube player needs yt-dlp (resolve/download) and ffmpeg (merge ≥1080p to
// mp4). These are NOT shipped in the installer — bundling ~85 MB per platform bloats
// the download and, worse, yt-dlp goes stale (YouTube breaks extractors every few
// weeks and a baked-in copy can't be updated). Instead they are AUTO-DOWNLOADED into
// `userData/bin` on first use (current platform only, ~85 MB once) and yt-dlp is
// refreshed when an extraction fails.
//
// Resolution order for each binary: userData/bin (auto-downloaded, kept fresh) →
// system PATH (power users who manage their own) → a bundled dev copy under
// resources/bin (present only in a dev checkout, never in a packaged build). Only if
// NONE of those has it do we download — so a system install suppresses the download.
import { app } from 'electron';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

function platformDir() {
  return `${process.platform}-${process.arch}`;
}

function exe(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

export function userBinDir() {
  return path.join(app.getPath('userData'), 'bin');
}

function bundledBinDir() {
  // Packaged builds don't ship this (no extraResource); only a dev checkout has it.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', platformDir())
    : path.join(app.getAppPath(), 'resources', 'bin', platformDir());
}

// Download sources. yt-dlp `latest` (so a fresh fetch is always current); ffmpeg
// pinned to the eugeneware/ffmpeg-static b6.0 release (stable, per-arch).
const YTDLP_URL = process.platform === 'win32'
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
const FFMPEG_URLS = {
  'darwin-arm64': 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-arm64',
  'darwin-x64':   'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-x64',
  'win32-x64':    'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64',
};

// Resolution is memoised (a `which` spawn per call is wasteful); cleared after a
// download so a freshly-fetched userData copy is picked up.
const cache = {};
export function clearCache() { cache['yt-dlp'] = null; cache.ffmpeg = null; }

function findOnPath(name) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, [name], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().split(/\r?\n/)[0];
    return out && fs.existsSync(out) ? out : null;
  } catch { return null; }
}

function resolveBinary(name) {
  if (cache[name] && fs.existsSync(cache[name])) return cache[name];
  const e = exe(name);
  const candidates = [
    path.join(userBinDir(), e),     // 1. auto-downloaded (fresh)
    null,                           // 2. system PATH (filled below)
    path.join(bundledBinDir(), e),  // 3. dev-only bundled copy
  ];
  let resolved = null;
  if (fs.existsSync(candidates[0])) resolved = candidates[0];
  else { const p = findOnPath(name); if (p) resolved = p; else if (fs.existsSync(candidates[2])) resolved = candidates[2]; }
  cache[name] = resolved;
  return resolved;
}

export const ytDlpPath  = () => resolveBinary('yt-dlp');
export const ffmpegPath = () => resolveBinary('ffmpeg');

// Health check for Settings / callers — absolute path of each, or null if missing.
export function detect() { return { ytDlp: ytDlpPath(), ffmpeg: ffmpegPath() }; }
export function isReady() { return !!(ytDlpPath() && ffmpegPath()); }

// Stream a URL to `dest` (atomic via .part rename), reporting 0–1 progress.
async function downloadTo(url, dest, onProgress) {
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
  if (process.platform !== 'win32') fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, dest);
}

// Ensure both binaries exist, downloading any that are missing into userData/bin.
// Idempotent + single-flight: concurrent callers (e.g. a speculative paste-time
// prefetch) share one in-progress setup. `onProgress({name,index,count,percent})`.
let ensurePromise = null;
export function ensureBinaries(onProgress) {
  if (isReady()) return Promise.resolve({ ok: true });
  if (!ensurePromise) ensurePromise = doEnsure(onProgress).finally(() => { ensurePromise = null; });
  return ensurePromise;
}

async function doEnsure(onProgress) {
  try {
    const tasks = [];
    if (!ffmpegPath()) {
      const url = FFMPEG_URLS[platformDir()];
      if (!url) throw new Error(`no ffmpeg build for ${platformDir()}`);
      tasks.push({ name: 'ffmpeg', url, dest: path.join(userBinDir(), exe('ffmpeg')) });
    }
    if (!ytDlpPath()) tasks.push({ name: 'yt-dlp', url: YTDLP_URL, dest: path.join(userBinDir(), exe('yt-dlp')) });
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      await downloadTo(t.url, t.dest, (p) => onProgress?.({ name: t.name, index: i, count: tasks.length, percent: p }));
      clearCache();
    }
    if (!isReady()) throw new Error('setup incomplete');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Re-download the latest yt-dlp into userData (used when an extraction fails because
// YouTube changed). Throttled so a burst of failures doesn't re-fetch repeatedly.
let lastRefresh = 0;
export async function refreshYtDlp(onProgress) {
  if (Date.now() - lastRefresh < 10 * 60 * 1000) return { ok: false, throttled: true };
  lastRefresh = Date.now();
  try {
    await downloadTo(YTDLP_URL, path.join(userBinDir(), exe('yt-dlp')), (p) => onProgress?.(p));
    clearCache();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
