// Phase 1b — Background Library (Layer 1).
//
// A curated, tagged pool of 16:9 worship backgrounds shipped only as a small
// manifest (resources/media-manifest.json: tags + dims + a `thumb` poster URL +
// an origin `url`). Distribution = Option A: we never rehost — the picker
// browses by hotlinking each item's remote `thumb`, and a pick downloads the
// origin `url` into the SAME local media library as any imported file (a normal
// `media_assets` row, served via cue-media:// / cue-thumb://, usable everywhere
// a background can be set). No parallel media model.
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Readable } from 'stream';
import { getDb } from './schema.js';
import { get as getSetting, set as setSetting, setGlobalBackground, applyBackgroundToAll } from './settings.js';
import { getMediaDir } from './media.js';

// settings map { manifestItemId -> media_assets.id } for idempotent re-picks and
// "already in your library" state. Exposed to media.findUnused() so a downloaded
// background isn't reported as unused (and deleted) before it's applied to a song.
export const DOWNLOAD_MAP_KEY = 'bg_library_downloads';

function manifestPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'media-manifest.json')
    : path.join(app.getAppPath(), 'resources', 'media-manifest.json');
}

let _manifest = null;
function loadManifest() {
  if (_manifest) return _manifest;
  try {
    _manifest = JSON.parse(fs.readFileSync(manifestPath(), 'utf8'));
  } catch {
    _manifest = { items: [], tag_counts: {} };
  }
  return _manifest;
}

export function downloadMap() {
  try { return JSON.parse(getSetting(DOWNLOAD_MAP_KEY) || '{}'); } catch { return {}; }
}
function saveDownloadMap(m) { setSetting(DOWNLOAD_MAP_KEY, JSON.stringify(m)); }

function findItem(id) {
  return (loadManifest().items || []).find((i) => i.file === id) || null;
}

// Browse payload — no origin `url` leaves main; the renderer only needs the
// hotlinked `thumb` for the grid plus whether it's already downloaded.
export function list() {
  const items = loadManifest().items || [];
  const map = downloadMap();
  const db = getDb();
  let dirty = false;
  const out = items.map((it) => {
    let mediaId = map[it.file] ?? null;
    if (mediaId != null && !db.prepare('SELECT 1 FROM media_assets WHERE id=?').get(mediaId)) {
      delete map[it.file]; mediaId = null; dirty = true; // asset deleted -> allow re-download
    }
    return {
      id: it.file,
      kind: it.kind,
      source: it.source,
      width: it.width, height: it.height,
      tags: it.tags || [],
      thumb: it.thumb || null,
      available: !!it.url,        // false for the few still-unresolved items
      mediaId,                    // non-null => already in local library
    };
  });
  if (dirty) saveDownloadMap(map);
  return out;
}

export function tagCounts() {
  return loadManifest().tag_counts || {};
}

async function streamDownload(url, destPath) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const dir = getMediaDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = destPath + '.part';
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(tmp);
    Readable.fromWeb(res.body).pipe(ws).on('finish', resolve).on('error', reject);
  });
  fs.renameSync(tmp, destPath);
}

// Download (once) into the local media library; idempotent via the map.
export async function download(id) {
  const item = findItem(id);
  if (!item) throw new Error('unknown background: ' + id);
  if (!item.url) throw new Error('background not available yet (unresolved url): ' + id);
  const db = getDb();
  const map = downloadMap();
  const existing = map[id];
  if (existing != null) {
    const row = db.prepare('SELECT * FROM media_assets WHERE id=?').get(existing);
    if (row) return { id: row.id, path: row.path, type: row.type, filename: row.filename };
    delete map[id]; // stale -> fall through and re-download
  }
  const ext = item.kind === 'photo' ? '.jpg' : '.mp4';
  const destPath = path.join(getMediaDir(), crypto.randomUUID() + ext);
  await streamDownload(item.url, destPath);
  const type = item.kind === 'photo' ? 'image' : 'video';
  const filename = path.basename(item.file); // descriptive for coverr, id-based otherwise
  const { lastInsertRowid } = db.prepare('INSERT INTO media_assets (filename, path, type) VALUES (?,?,?)')
    .run(filename, destPath, type);
  const mediaId = Number(lastInsertRowid);
  map[id] = mediaId; saveDownloadMap(map);
  return { id: mediaId, path: destPath, type, filename };
}

// Convenience: download + set as the global default background for a surface
// ('song' | 'scripture' | 'slide'); optionally push to every existing item.
export async function applyAsDefault(id, surface, toAll = false) {
  const asset = await download(id);
  if (toAll) applyBackgroundToAll(surface, asset.id);
  else setGlobalBackground(surface, asset.id);
  return asset;
}
