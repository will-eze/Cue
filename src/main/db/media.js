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
