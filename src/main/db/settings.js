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

// "Apply to all songs in the library." Affects every song EXCEPT those whose
// background is locked. For affected songs it both writes the song's own default
// AND clears any per-slot rundown override, so even slot-overridden songs flip to
// the new background (the override sits below the song level in the cascade, so it
// must be cleared for the change to actually show). Locked songs are untouched.
export function applyBackgroundToAll(type, mediaId) {
  if (type !== 'song') return;
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE songs SET default_background_id=?, updated_at=datetime('now') WHERE background_locked=0`).run(mediaId);
    db.prepare(`
      UPDATE service_items SET background_override_id=NULL
      WHERE item_type='song'
        AND ref_id IN (SELECT id FROM songs WHERE background_locked=0)
    `).run();
  })();
}

export { getDiskUsage };

export function getDataPath() { return app.getPath('userData'); }

export function openDataFolder() { shell.openPath(app.getPath('userData')); }
