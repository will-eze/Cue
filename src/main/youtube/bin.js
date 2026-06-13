// ── Bundled binary resolver (yt-dlp + ffmpeg) ────────────────────────────────
// YouTube playback is built on yt-dlp resolving a URL to a local file (which then
// flows through the normal media transport / NDI / operator-control stack) and
// ffmpeg merging the separate video+audio streams YouTube serves above 720p.
//
// Both ship as platform binaries under resources/bin/<platform>-<arch>/, copied
// into the packaged app's Resources/bin by forge.config.js (extraResource) and
// covered by the macOS ad-hoc codesign (postPackage --deep). Path resolution
// mirrors bundledBibleDir() in db/bible.js: app.getAppPath() in dev,
// process.resourcesPath when packaged.
//
// A newer yt-dlp downloaded into userData/bin takes precedence over the bundled
// seed — YouTube breaks extractors regularly and the in-bundle binary can't be
// rewritten without invalidating the macOS signature, so updates live in userData.
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

function platformDir() {
  return `${process.platform}-${process.arch}`;
}

function exe(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function bundledBinDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', platformDir())
    : path.join(app.getAppPath(), 'resources', 'bin', platformDir());
}

// Updatable yt-dlp lives here (writable, outside the signed bundle).
export function userBinDir() {
  return path.join(app.getPath('userData'), 'bin');
}

// yt-dlp: prefer a self-updated copy in userData, else the bundled seed.
export function ytDlpPath() {
  const name = exe('yt-dlp');
  const updated = path.join(userBinDir(), name);
  try { if (fs.existsSync(updated)) return updated; } catch {}
  return path.join(bundledBinDir(), name);
}

// ffmpeg only ever ships bundled (yt-dlp uses it to merge/remux to mp4).
export function ffmpegPath() {
  return path.join(bundledBinDir(), exe('ffmpeg'));
}

// Health check for Settings — reports whether each binary is present + runnable.
export function detect() {
  const out = { ytDlp: null, ffmpeg: null };
  const yt = ytDlpPath();
  const ff = ffmpegPath();
  try { out.ytDlp = fs.existsSync(yt) ? yt : null; } catch {}
  try { out.ffmpeg = fs.existsSync(ff) ? ff : null; } catch {}
  return out;
}
