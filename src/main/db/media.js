import { getDb } from './schema.js';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

export function getMediaDir() {
  return path.join(app.getPath('userData'), 'media');
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
      const { lastInsertRowid } = db.prepare('INSERT INTO media_assets (filename, path, type) VALUES (?,?,?)')
        .run(filename, destPath, type);
      results.push({ id: Number(lastInsertRowid), filename, path: destPath, type });
    }
  })();
  return results;
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

export function del(id) {
  const db = getDb();
  const asset = db.prepare('SELECT * FROM media_assets WHERE id=?').get(id);
  if (!asset) return;
  db.prepare('DELETE FROM media_assets WHERE id=?').run(id);
  try { if (fs.existsSync(asset.path)) fs.unlinkSync(asset.path); } catch {}
}

export function deleteMany(ids) {
  if (!Array.isArray(ids)) return 0;
  let removed = 0;
  for (const id of ids) { del(id); removed++; }
  return removed;
}

// Media not referenced by any song background, rundown item, channel logo,
// theme, or global setting — i.e. safe to delete. Settings store media ids as
// JSON-encoded integers, so they're collected separately from the FK columns.
export function findUnused() {
  const db = getDb();
  const referenced = new Set();
  const addAll = (rows) => { for (const r of rows) if (r.id != null) referenced.add(r.id); };
  addAll(db.prepare('SELECT DISTINCT default_background_id  AS id FROM songs           WHERE default_background_id  IS NOT NULL').all());
  addAll(db.prepare('SELECT DISTINCT background_override_id AS id FROM service_items   WHERE background_override_id IS NOT NULL').all());
  addAll(db.prepare('SELECT DISTINCT logo_override_id       AS id FROM output_channels WHERE logo_override_id       IS NOT NULL').all());
  addAll(db.prepare('SELECT DISTINCT background_id          AS id FROM themes          WHERE background_id          IS NOT NULL').all());
  for (const key of ['global_logo_id', 'global_bg_song_id', 'global_bg_scripture_id', 'global_bg_slide_id']) {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    if (!row) continue;
    try { const v = JSON.parse(row.value); if (v != null) referenced.add(Number(v)); } catch {}
  }
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
