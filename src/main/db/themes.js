import { getDb } from './schema.js';

export function list() {
  return getDb().prepare(`
    SELECT t.*, ma.path AS background_path, ma.filename AS background_filename, ma.type AS background_type
    FROM themes t
    LEFT JOIN media_assets ma ON ma.id = t.background_id
    ORDER BY t.name COLLATE NOCASE
  `).all();
}

export function get(id) {
  return getDb().prepare(`
    SELECT t.*, ma.path AS background_path, ma.filename AS background_filename, ma.type AS background_type
    FROM themes t
    LEFT JOIN media_assets ma ON ma.id = t.background_id
    WHERE t.id = ?
  `).get(id);
}

export function create(data) {
  const { name, style_json, background_id } = data;
  const { lastInsertRowid } = getDb().prepare(
    `INSERT INTO themes (name, style_json, background_id) VALUES (?, ?, ?)`
  ).run(name, style_json ?? null, background_id ?? null);
  return Number(lastInsertRowid);
}

export function update(id, data) {
  const { name, style_json, background_id } = data;
  getDb().prepare(
    `UPDATE themes SET name=?, style_json=?, background_id=?, updated_at=datetime('now') WHERE id=?`
  ).run(name, style_json ?? null, background_id ?? null, id);
}

export function del(id) {
  getDb().prepare('DELETE FROM themes WHERE id = ?').run(id);
}

// Merge theme style_json into a section's existing style_json, preserving inline
// text runs (per-character bold/italic/colour ranges that belong to that section).
function mergeIntoSection(sectionStyleJson, themeStyleObj) {
  if (!themeStyleObj || !Object.keys(themeStyleObj).length) return sectionStyleJson;
  const existing = sectionStyleJson ? JSON.parse(sectionStyleJson) : {};
  const merged = { ...themeStyleObj };
  if (existing.runs && existing.runs.length) merged.runs = existing.runs;
  return JSON.stringify(merged);
}

// Apply theme to all sections of a single song. Optionally updates the song's
// default_background_id if the theme has one and setBg is true. When the
// background is applied, per-slot overrides on rundown items referencing this
// song are cleared so the theme's background actually shows (an override would
// otherwise win over the song default).
export function applyToSong(themeId, songId, setBg = true) {
  const db = getDb();
  const theme = get(themeId);
  if (!theme) return 0;
  const themeStyle = theme.style_json ? JSON.parse(theme.style_json) : {};
  const sections = db.prepare('SELECT id, style_json FROM song_sections WHERE song_id = ?').all(songId);
  db.transaction(() => {
    for (const sec of sections) {
      db.prepare('UPDATE song_sections SET style_json = ? WHERE id = ?')
        .run(mergeIntoSection(sec.style_json, themeStyle), sec.id);
    }
    if (setBg && theme.background_id) {
      db.prepare(`UPDATE songs SET default_background_id=?, updated_at=datetime('now') WHERE id=?`)
        .run(theme.background_id, songId);
      db.prepare(`UPDATE service_items SET background_override_id=NULL WHERE item_type='song' AND ref_id=?`)
        .run(songId);
    }
  })();
  return sections.length;
}

// Apply theme to all songs referenced by song items in a rundown.
export function applyToRundown(themeId, serviceId, setBg = true) {
  const db = getDb();
  const theme = get(themeId);
  if (!theme) return 0;
  const themeStyle = theme.style_json ? JSON.parse(theme.style_json) : {};
  const songIds = db.prepare(
    `SELECT DISTINCT ref_id FROM service_items WHERE service_id=? AND item_type='song' AND ref_id IS NOT NULL`
  ).all(serviceId).map((r) => r.ref_id);
  if (!songIds.length) return 0;
  db.transaction(() => {
    for (const songId of songIds) {
      const sections = db.prepare('SELECT id, style_json FROM song_sections WHERE song_id = ?').all(songId);
      for (const sec of sections) {
        db.prepare('UPDATE song_sections SET style_json = ? WHERE id = ?')
          .run(mergeIntoSection(sec.style_json, themeStyle), sec.id);
      }
      if (setBg && theme.background_id) {
        db.prepare(`UPDATE songs SET default_background_id=?, updated_at=datetime('now') WHERE id=?`)
          .run(theme.background_id, songId);
      }
    }
    // Clear per-slot overrides on this rundown's song items so the theme bg wins.
    if (setBg && theme.background_id) {
      db.prepare(`UPDATE service_items SET background_override_id=NULL WHERE service_id=? AND item_type='song'`)
        .run(serviceId);
    }
  })();
  return songIds.length;
}

// Apply theme to every song in the library.
export function applyToAllSongs(themeId, setBg = true) {
  const db = getDb();
  const theme = get(themeId);
  if (!theme) return 0;
  const themeStyle = theme.style_json ? JSON.parse(theme.style_json) : {};
  const songIds = db.prepare('SELECT id FROM songs').all().map((r) => r.id);
  if (!songIds.length) return 0;
  db.transaction(() => {
    for (const songId of songIds) {
      const sections = db.prepare('SELECT id, style_json FROM song_sections WHERE song_id = ?').all(songId);
      for (const sec of sections) {
        db.prepare('UPDATE song_sections SET style_json = ? WHERE id = ?')
          .run(mergeIntoSection(sec.style_json, themeStyle), sec.id);
      }
      if (setBg && theme.background_id) {
        db.prepare(`UPDATE songs SET default_background_id=?, updated_at=datetime('now') WHERE id=?`)
          .run(theme.background_id, songId);
      }
    }
    // Clear every song slot's per-slot override so the theme bg wins everywhere.
    if (setBg && theme.background_id) {
      db.prepare(`UPDATE service_items SET background_override_id=NULL WHERE item_type='song'`).run();
    }
  })();
  return songIds.length;
}
