// In-app updater (Option A — manual "Check for Updates").
//
// will-eze/Cue is a PUBLIC repo, so listing releases and downloading assets needs
// no auth, no token, and no `gh` CLI — we talk to the GitHub REST API anonymously
// over HTTPS, exactly like a browser would. See plan/auto-update-handoff.md.
//
// CI publishes PRERELEASES, and GitHub's /releases/latest skips prereleases, so we
// query /releases and take index 0 (newest). Asset names are NOT versioned/arch'd in
// a predictable pattern (mac ships `Cue.dmg`, win ships `Cue-<ver>.Setup.exe`), so we
// select by file EXTENSION, never by a name template.

import { app, shell } from 'electron';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { execFile, spawn } from 'child_process';
import semver from 'semver';

const RELEASES_URL = 'https://api.github.com/repos/will-eze/Cue/releases';
const UA = `Cue/${app.getVersion()} (auto-update)`; // GitHub rejects requests with no User-Agent

// GET a URL as JSON, following redirects. GitHub API never redirects, but keep it
// symmetric with the asset download path.
function getJson(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'));
    https
      .get(url, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(getJson(res.headers.location, depth + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GitHub API ${res.statusCode}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

// Stream a URL to `dest`, following GitHub's 302 redirect to the S3/objects host.
// Reports {received,total} via onProgress. Node's https.get does NOT auto-follow
// redirects, so we recurse on Location.
function download(url, dest, onProgress, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'));
    https
      .get(url, { headers: { 'User-Agent': UA, Accept: 'application/octet-stream' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(res.headers.location, dest, onProgress, depth + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        const file = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          received += chunk.length;
          onProgress?.({ received, total });
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve({ received, total })));
        file.on('error', (e) => { fs.rm(dest, { force: true }, () => reject(e)); });
      })
      .on('error', reject);
  });
}

// Pick the asset for this OS by extension (mac → .dmg, win → .exe Setup).
function pickAsset(assets) {
  if (process.platform === 'darwin') {
    return assets.find((a) => a.name.toLowerCase().endsWith('.dmg'));
  }
  if (process.platform === 'win32') {
    return assets.find((a) => /setup\.exe$/i.test(a.name)) || assets.find((a) => a.name.toLowerCase().endsWith('.exe'));
  }
  return null;
}

// Query GitHub, compare versions, return what (if anything) is newer.
export async function checkForUpdate() {
  const current = app.getVersion();
  try {
    const releases = await getJson(RELEASES_URL);
    if (!Array.isArray(releases) || releases.length === 0) {
      return { ok: true, current, upToDate: true, latest: current };
    }
    const release = releases[0]; // newest, incl. prereleases (/latest would skip them)
    const latest = (release.tag_name || '').replace(/^v/, '');
    const latestSemver = semver.valid(semver.coerce(latest));
    const currentSemver = semver.valid(semver.coerce(current));
    const isNewer = !!(latestSemver && currentSemver && semver.gt(latestSemver, currentSemver));
    if (!isNewer) return { ok: true, current, latest, upToDate: true };

    const asset = pickAsset(release.assets || []);
    if (!asset) {
      return { ok: false, current, latest, error: `No installer for ${process.platform} in release ${latest}` };
    }
    return {
      ok: true,
      current,
      latest,
      isNewer: true,
      notes: release.body || '',
      asset: { name: asset.name, url: asset.browser_download_url, size: asset.size },
    };
  } catch (e) {
    return { ok: false, current, error: e.message || String(e) };
  }
}

// Download the chosen asset to temp, strip macOS quarantine so the ad-hoc-signed app
// launches cleanly, open the installer, then quit so the user can replace the app.
export async function downloadAndInstall(asset, win) {
  if (!asset?.url) return { ok: false, error: 'No asset to download' };
  const dest = path.join(app.getPath('temp'), asset.name);
  try {
    await download(asset.url, dest, (p) => win?.webContents.send('update:progress', p));
  } catch (e) {
    return { ok: false, error: `Download failed: ${e.message || e}` };
  }

  // macOS: a quarantine xattr on an ad-hoc-signed app = Gatekeeper hard-block. Strip it.
  // (Programmatic downloads usually aren't quarantined, but make it deterministic.)
  if (process.platform === 'darwin') {
    await new Promise((resolve) => execFile('xattr', ['-dr', 'com.apple.quarantine', dest], () => resolve()));
  }

  // Windows: run the NSIS installer SILENTLY (`/S`) so an in-app update reuses the
  // existing install dir with no wizard, then relaunches Cue itself (cue.nsi's silent
  // path). A bare `shell.openPath` would pop the full multi-page wizard on every update.
  // macOS has no installer — `shell.openPath(dmg)` just mounts it for the user to drag.
  if (process.platform === 'win32') {
    try {
      spawn(dest, ['/S'], { detached: true, stdio: 'ignore' }).unref();
    } catch (e) {
      return { ok: false, error: `Failed to launch installer: ${e.message || e}` };
    }
  } else {
    const err = await shell.openPath(dest); // '' on success
    if (err) return { ok: false, error: err };
  }

  // Give the IPC reply time to reach the renderer, then quit so the installer can
  // replace the running app (Windows can't overwrite a running exe; macOS can't
  // overwrite a live .app). The silent installer waits briefly for this exit.
  setTimeout(() => app.quit(), 1200);
  return { ok: true, path: dest };
}
