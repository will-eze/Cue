import { getDb } from './schema.js';
import { collectImageMediaIds } from './presentations.js';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { ffmpegPath } from '../youtube/bin.js';

export function getMediaDir() {
  return path.join(app.getPath('userData'), 'media');
}

// Cached, downscaled JPEG posters generated on demand by the cue-thumb protocol
// handler. This is a pure derived cache (regenerated if missing), so it is NOT a
// media reference for findUnused() and is not included in backups — it is keyed
// by a hash of the source path and cleared alongside the assets it mirrors.
export function getThumbnailDir() {
  return path.join(app.getPath('userData'), 'thumbnails');
}

export function thumbCachePath(srcPath) {
  const hash = crypto.createHash('sha1').update(srcPath).digest('hex');
  return path.join(getThumbnailDir(), hash + '.jpg');
}

function ensureMediaDir() {
  const dir = getMediaDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function detectType(ext) {
  const e = ext.toLowerCase().replace('.', '');
  if (['jpg','jpeg','png','gif','webp','bmp','tiff','svg'].includes(e)) return 'image';
  if (['mp4','webm','mov','avi','mkv','m4v'].includes(e)) return 'video';
  if (['mp3','wav','aac','flac','ogg','m4a'].includes(e)) return 'audio';
  return 'image';
}

// Probe video/audio duration using ffmpeg header-read (fast — no decode).
// Returns milliseconds, or null if ffmpeg is unavailable or probing fails.
function probeDurationMs(filePath) {
  const ff = ffmpegPath();
  if (!ff) return null;
  try {
    const r = spawnSync(ff, ['-v', 'error', '-i', filePath], { encoding: 'utf8', timeout: 8000 });
    const m = (r.stderr || '').match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!m) return null;
    return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
  } catch { return null; }
}

export function importFiles(filePaths) {
  const db = getDb();
  const mediaDir = ensureMediaDir();
  const results = [];
  db.transaction(() => {
    for (const src of filePaths) {
      const ext = path.extname(src);
      const destName = crypto.randomUUID() + ext;
      const destPath = path.join(mediaDir, destName);
      fs.copyFileSync(src, destPath);
      const type = detectType(ext);
      const filename = path.basename(src);
      const durationMs = (type === 'video' || type === 'audio') ? probeDurationMs(destPath) : null;
      let sizeBytes = null;
      try { sizeBytes = fs.statSync(destPath).size; } catch {}
      const { lastInsertRowid } = db.prepare('INSERT INTO media_assets (filename, path, type, duration_ms, size_bytes) VALUES (?,?,?,?,?)')
        .run(filename, destPath, type, durationMs, sizeBytes);
      results.push({ id: Number(lastInsertRowid), filename, path: destPath, type, duration_ms: durationMs, size_bytes: sizeBytes });
    }
  })();
  return results;
}

// Save raw bytes (e.g. a rasterised PowerPoint slide PNG from pdfjs) as a media
// asset — same destination + row shape as importFiles, but the source is an
// in-memory buffer rather than a file on disk.
export function importBuffer(bytes, filename, ext) {
  const db = getDb();
  const mediaDir = ensureMediaDir();
  const e = (ext || '.png').startsWith('.') ? (ext || '.png') : '.' + ext;
  const destName = crypto.randomUUID() + e;
  const destPath = path.join(mediaDir, destName);
  fs.writeFileSync(destPath, Buffer.from(bytes));
  const type = detectType(e);
  const { lastInsertRowid } = db.prepare('INSERT INTO media_assets (filename, path, type) VALUES (?,?,?)')
    .run(filename || ('slide' + e), destPath, type);
  return { id: Number(lastInsertRowid), filename: filename || ('slide' + e), path: destPath, type };
}

export function getById(id) {
  return getDb().prepare('SELECT * FROM media_assets WHERE id=?').get(id) || null;
}

export function list(folderId) {
  const db = getDb();
  if (folderId == null) {
    return db.prepare('SELECT * FROM media_assets WHERE folder_id IS NULL ORDER BY filename COLLATE NOCASE').all();
  }
  return db.prepare('SELECT * FROM media_assets WHERE folder_id=? ORDER BY filename COLLATE NOCASE').all(folderId);
}

// Flat list of every asset regardless of folder — used by the command palette's
// media search (the foldered `list` only returns one folder at a time).
export function listAll() {
  return getDb().prepare('SELECT * FROM media_assets ORDER BY filename COLLATE NOCASE').all();
}

export function del(id) {
  const db = getDb();
  const asset = db.prepare('SELECT * FROM media_assets WHERE id=?').get(id);
  if (!asset) return;
  db.prepare('DELETE FROM media_assets WHERE id=?').run(id);
  try { if (fs.existsSync(asset.path)) fs.unlinkSync(asset.path); } catch {}
  try { fs.unlinkSync(thumbCachePath(asset.path)); } catch {}
}

export function deleteMany(ids) {
  if (!Array.isArray(ids)) return 0;
  let removed = 0;
  for (const id of ids) { del(id); removed++; }
  return removed;
}

// Media not referenced by any song background, rundown item, channel logo,
// theme, presentation, or global setting — i.e. safe to delete. Settings store
// media ids as JSON-encoded integers, and presentation image elements store ids
// inside elements_json, so both are collected separately from the FK columns.
export function findUnused() {
  const db = getDb();
  const referenced = new Set();
  const addAll = (rows) => { for (const r of rows) if (r.id != null) referenced.add(r.id); };
  addAll(db.prepare('SELECT DISTINCT default_background_id  AS id FROM songs           WHERE default_background_id  IS NOT NULL').all());
  addAll(db.prepare('SELECT DISTINCT background_override_id AS id FROM service_items   WHERE background_override_id IS NOT NULL').all());
  addAll(db.prepare('SELECT DISTINCT logo_override_id       AS id FROM output_channels WHERE logo_override_id       IS NOT NULL').all());
  addAll(db.prepare('SELECT DISTINCT background_id          AS id FROM themes          WHERE background_id          IS NOT NULL').all());
  addAll(db.prepare('SELECT DISTINCT background_id          AS id FROM presentation_slides    WHERE background_id IS NOT NULL').all());
  addAll(db.prepare('SELECT DISTINCT background_id          AS id FROM presentation_templates WHERE background_id IS NOT NULL').all());
  addAll(db.prepare('SELECT DISTINCT background_media_id    AS id FROM graphics               WHERE background_media_id IS NOT NULL').all());
  // onEndMediaId is stored inside style_json for countdown graphics (no FK column).
  for (const { style_json } of db.prepare("SELECT style_json FROM graphics WHERE kind='countdown' AND style_json IS NOT NULL").all()) {
    try { const s = JSON.parse(style_json); if (s.onEndMediaId) referenced.add(Number(s.onEndMediaId)); } catch {}
  }
  // Image elements reference media by id inside elements_json (not an FK column).
  for (const r of db.prepare('SELECT elements_json FROM presentation_slides UNION ALL SELECT elements_json FROM presentation_templates').all()) {
    for (const id of collectImageMediaIds(r.elements_json)) referenced.add(id);
  }
  for (const key of ['global_logo_id', 'global_bg_song_id', 'global_bg_scripture_id', 'global_bg_slide_id']) {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if (!row) continue;
    try { const v = JSON.parse(row.value); if (v != null) referenced.add(Number(v)); } catch {}
  }
  // Background-library downloads (settings JSON map { manifestId: mediaAssetId },
  // see db/background-library.js) are intentional library additions — keep them
  // out of "unused" even before they're applied to a song/global background.
  const bgRow = db.prepare("SELECT value FROM settings WHERE key='bg_library_downloads'").get();
  if (bgRow) { try { for (const v of Object.values(JSON.parse(bgRow.value))) if (v != null) referenced.add(Number(v)); } catch {} }
  return db.prepare('SELECT * FROM media_assets ORDER BY filename COLLATE NOCASE').all()
    .filter((m) => !referenced.has(m.id))
    .map((m) => {
      let size = 0;
      try { size = fs.statSync(m.path).size; } catch {}
      return { ...m, size_bytes: size };
    });
}

// Wipe the entire media library: every asset file + DB row + folders. FK columns
// referencing media_assets are ON DELETE SET NULL, so song/theme/channel/item
// backgrounds clear automatically; the global media settings keys aren't FKs, so
// reset them explicitly. Returns how many assets were removed.
export function deleteAllMedia() {
  const db = getDb();
  const assets = db.prepare('SELECT id, path FROM media_assets').all();
  db.transaction(() => {
    db.prepare('DELETE FROM media_assets').run();
    db.prepare('DELETE FROM media_folders').run();
    for (const key of ['global_logo_id', 'global_bg_song_id', 'global_bg_scripture_id', 'global_bg_slide_id']) {
      db.prepare("UPDATE settings SET value='null' WHERE key=?").run(key);
    }
  })();
  // Remove the files after the rows are gone. Clear the whole media dir so any
  // orphans left by past crashes go too.
  for (const a of assets) { try { if (fs.existsSync(a.path)) fs.unlinkSync(a.path); } catch {} }
  try {
    const dir = getMediaDir();
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
  } catch {}
  // The thumbnail cache mirrors the assets we just wiped — clear it too.
  try {
    const tdir = getThumbnailDir();
    if (fs.existsSync(tdir)) for (const f of fs.readdirSync(tdir)) { try { fs.unlinkSync(path.join(tdir, f)); } catch {} }
  } catch {}
  return assets.length;
}

export function createFolder(name, parentId) {
  const { lastInsertRowid } = getDb().prepare('INSERT INTO media_folders (name, parent_id) VALUES (?,?)').run(name, parentId || null);
  return Number(lastInsertRowid);
}

export function renameFolder(id, name) {
  getDb().prepare('UPDATE media_folders SET name=? WHERE id=?').run(name, id);
}

export function deleteFolder(id) {
  getDb().prepare('DELETE FROM media_folders WHERE id=?').run(id);
}

export function getFolderTree() {
  const folders = getDb().prepare('SELECT * FROM media_folders ORDER BY name COLLATE NOCASE').all();
  function buildTree(parentId) {
    return folders
      .filter((f) => (f.parent_id ?? null) === (parentId ?? null))
      .map((f) => ({ ...f, children: buildTree(f.id) }));
  }
  return buildTree(null);
}

export function getDiskUsage() {
  const dir = getMediaDir();
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const f of fs.readdirSync(dir)) {
    try { total += fs.statSync(path.join(dir, f)).size; } catch {}
  }
  return total;
}
