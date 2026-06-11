import { getDb } from './schema.js';
import { app, shell } from 'electron';
import { getDiskUsage } from './media.js';

export function get(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export function set(key, value) {
  getDb().prepare(
    'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, JSON.stringify(value));
}

export function setGlobalLogo(mediaId) { set('global_logo_id', mediaId); }

export function setGlobalBackground(type, mediaId) {
  const key = type === 'song' ? 'global_bg_song_id'
    : type === 'scripture' ? 'global_bg_scripture_id'
    : 'global_bg_slide_id';
  set(key, mediaId);
}

export function applyBackgroundToAll(type, mediaId) {
  if (type === 'song') {
    getDb().prepare(`UPDATE songs SET default_background_id=?, updated_at=datetime('now')`).run(mediaId);
  }
}

export { getDiskUsage };

export function getDataPath() { return app.getPath('userData'); }

export function openDataFolder() { shell.openPath(app.getPath('userData')); }
