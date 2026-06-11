import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getDb } from './schema.js';
import { get as getSetting, set as setSetting } from './settings.js';
import { parseGhsItems } from '../import/songs-import.js';

export function search(query) {
  const db = getDb();
  if (!query || !query.trim()) {
    return db.prepare('SELECT id, title, author FROM songs ORDER BY title COLLATE NOCASE').all();
  }
  const escaped = query.trim().replace(/['"*]/g, ' ').trim();
  if (!escaped) return [];
  try {
    return db.prepare(`
      SELECT DISTINCT s.id, s.title, s.author
      FROM songs_fts f
      JOIN song_sections ss ON ss.id = f.rowid
      JOIN songs s ON s.id = ss.song_id
      WHERE songs_fts MATCH ?
      ORDER BY rank
    `).all(escaped + '*');
  } catch { return []; }
}

const _listAllSongsStmt = () => getDb().prepare(
  'SELECT id, title, author, copyright, default_background_id, created_at, updated_at FROM songs ORDER BY title COLLATE NOCASE'
);
const _listTagsForSongStmt = () => getDb().prepare(
  `SELECT t.id, t.name, t.colour FROM tags t JOIN taggables tb ON tb.tag_id = t.id WHERE tb.entity_type = 'song' AND tb.entity_id = ?`
);

export function listAll() {
  const songs = _listAllSongsStmt().all();
  const tagsStmt = _listTagsForSongStmt();
  return songs.map((s) => ({ ...s, tags: tagsStmt.all(s.id) }));
}

export function getById(id) {
  const db = getDb();
  const song = db.prepare(`
    SELECT s.*, ma.path AS background_path, ma.filename AS background_filename
    FROM songs s
    LEFT JOIN media_assets ma ON ma.id = s.default_background_id
    WHERE s.id = ?
  `).get(id);
  if (!song) return null;
  song.sections = db.prepare('SELECT * FROM song_sections WHERE song_id = ? ORDER BY order_index').all(id);
  song.tags = db.prepare(
    `SELECT t.* FROM tags t JOIN taggables tb ON tb.tag_id = t.id WHERE tb.entity_type = 'song' AND tb.entity_id = ?`
  ).all(id);
  return song;
}

export function create(data) {
  const db = getDb();
  const { title, author, copyright, sections = [], tagIds = [] } = data;
  const defaultBgId = getSetting('global_bg_song_id') ?? null;
  return db.transaction(() => {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO songs (title, author, copyright, default_background_id) VALUES (?, ?, ?, ?)'
    ).run(title, author || null, copyright || null, defaultBgId);
    sections.forEach((s, i) =>
      db.prepare('INSERT INTO song_sections (song_id, type, order_index, content, style_json) VALUES (?, ?, ?, ?, ?)')
        .run(lastInsertRowid, s.type, i, s.content, s.style_json ?? null)
    );
    tagIds.forEach((tagId) =>
      db.prepare(`INSERT OR IGNORE INTO taggables (tag_id, entity_type, entity_id) VALUES (?, 'song', ?)`)
        .run(tagId, lastInsertRowid)
    );
    return Number(lastInsertRowid);
  })();
}

const _IMPORT_TYPES = new Set(['verse', 'chorus', 'refrain', 'bridge', 'pre-chorus', 'tag', 'intro', 'outro']);

// Distinct colours for auto-created import tags (so e.g. GHS stands out).
const _IMPORT_TAG_COLOUR = { GHS: '#4d8eff' };

// Bulk-create songs from parsed import previews. One transaction for the whole
// batch. Each song inherits the global song background like create() does, and
// any `song.tags` (array of tag names) are get-or-created and assigned.
export function importSongs(parsedSongs = []) {
  const db = getDb();
  const defaultBgId = getSetting('global_bg_song_id') ?? null;
  const tagCache = new Map();
  const getOrCreateTag = (name) => {
    if (tagCache.has(name)) return tagCache.get(name);
    const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    const id = existing
      ? existing.id
      : Number(db.prepare('INSERT INTO tags (name, colour) VALUES (?, ?)').run(name, _IMPORT_TAG_COLOUR[name] ?? null).lastInsertRowid);
    tagCache.set(name, id);
    return id;
  };
  const ids = db.transaction(() => {
    const out = [];
    for (const song of parsedSongs) {
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO songs (title, author, copyright, default_background_id) VALUES (?, ?, ?, ?)'
      ).run(song.title || 'Untitled', song.author || null, song.copyright || null, defaultBgId);
      (song.sections || []).forEach((s, i) =>
        db.prepare('INSERT INTO song_sections (song_id, type, order_index, content, style_json) VALUES (?, ?, ?, ?, NULL)')
          .run(lastInsertRowid, _IMPORT_TYPES.has(s.type) ? s.type : 'verse', i, s.content)
      );
      for (const tagName of (song.tags || [])) {
        db.prepare(`INSERT OR IGNORE INTO taggables (tag_id, entity_type, entity_id) VALUES (?, 'song', ?)`)
          .run(getOrCreateTag(tagName), Number(lastInsertRowid));
      }
      out.push(Number(lastInsertRowid));
    }
    return out;
  })();
  return { count: ids.length, ids };
}

// Lowercased set of existing song titles — lets the importer flag duplicates.
export function existingTitleSet() {
  return new Set(getDb().prepare('SELECT title FROM songs').all().map((r) => String(r.title || '').trim().toLowerCase()));
}

// ── Bundled GHS hymnal ────────────────────────────────────────────────────────
// resources/ghs/ghs-hymnal.json is packaged into the app's Resources/ dir, or
// read from the repo in dev. Mirrors bundledBibleDir() in db/bible.js.
function ghsHymnalPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ghs', 'ghs-hymnal.json')
    : path.join(app.getAppPath(), 'resources', 'ghs', 'ghs-hymnal.json');
}

// Parse the bundled hymnal into preview rows, flagging any already in the DB.
// Used by the manual Library → Import → GHS Hymnal path.
export function readBundledGhsRows() {
  const raw = JSON.parse(fs.readFileSync(ghsHymnalPath(), 'utf8'));
  const rows = parseGhsItems(raw.items || []);
  const existing = existingTitleSet();
  return rows.map((r) => ({ ...r, existing: existing.has(r.title.trim().toLowerCase()) }));
}

// Ensure every "GHS N …" song carries the GHS tag (so the GHS folder shows).
// Idempotent backfill — covers hymns imported before tag support and any path
// that didn't assign the tag. Creates the GHS tag if absent.
export function tagGhsSongs() {
  const db = getDb();
  const ghsSongs = db.prepare("SELECT id FROM songs WHERE title GLOB 'GHS [0-9]*'").all();
  if (!ghsSongs.length) return;
  const existing = db.prepare("SELECT id FROM tags WHERE name = 'GHS'").get();
  const tagId = existing
    ? existing.id
    : Number(db.prepare("INSERT INTO tags (name, colour) VALUES ('GHS', '#4d8eff')").run().lastInsertRowid);
  const insert = db.prepare(`INSERT OR IGNORE INTO taggables (tag_id, entity_type, entity_id) VALUES (?, 'song', ?)`);
  db.transaction(() => { for (const s of ghsSongs) insert.run(tagId, s.id); })();
}

// Seed the GHS hymnal on startup. The import itself runs once (gated by a
// `ghs_seeded` flag so deletions stick), but tagGhsSongs() always runs to keep
// the GHS folder correct even for hymns imported by an earlier/other path.
export function seedGhsHymnal() {
  if (!getSetting('ghs_seeded')) {
    try {
      const toImport = readBundledGhsRows()
        .filter((r) => r.ok && !r.existing)
        .map((r) => ({ title: r.title, author: r.author, copyright: r.copyright, sections: r.sections, tags: r.tags }));
      if (toImport.length) importSongs(toImport);
      setSetting('ghs_seeded', true);
    } catch { /* no bundled hymnal present (e.g. dev checkout without resources) */ }
  }
  tagGhsSongs();
}

export function update(id, data) {
  const db = getDb();
  const { title, author, copyright, sections, tagIds } = data;
  db.transaction(() => {
    db.prepare(`UPDATE songs SET title=?, author=?, copyright=?, updated_at=datetime('now') WHERE id=?`)
      .run(title, author || null, copyright || null, id);
    if (sections !== undefined) {
      db.prepare('DELETE FROM song_sections WHERE song_id = ?').run(id);
      sections.forEach((s, i) =>
        db.prepare('INSERT INTO song_sections (song_id, type, order_index, content, style_json) VALUES (?, ?, ?, ?, ?)')
          .run(id, s.type, i, s.content, s.style_json ?? null)
      );
    } else {
      const existing = db.prepare('SELECT * FROM song_sections WHERE song_id = ?').all(id);
      existing.forEach((s) => {
        db.prepare(`INSERT INTO songs_fts(songs_fts, rowid, title, author, content) VALUES('delete',?,?,'','')`)
          .run(s.id, '');
        db.prepare('INSERT INTO songs_fts(rowid, title, author, content) SELECT ?, title, author, ? FROM songs WHERE id=?')
          .run(s.id, s.content, id);
      });
    }
    if (tagIds !== undefined) {
      db.prepare(`DELETE FROM taggables WHERE entity_type='song' AND entity_id=?`).run(id);
      tagIds.forEach((tagId) =>
        db.prepare(`INSERT OR IGNORE INTO taggables (tag_id, entity_type, entity_id) VALUES (?, 'song', ?)`)
          .run(tagId, id)
      );
    }
  })();
}

export function del(id) {
  const db = getDb();
  const refs = db.prepare(`SELECT COUNT(*) AS count FROM service_items WHERE item_type='song' AND ref_id=?`).get(id);
  if (refs.count > 0) return { hasReferences: true, count: refs.count };
  db.prepare('DELETE FROM songs WHERE id = ?').run(id);
  return { hasReferences: false };
}

export function deleteAll() {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM taggables WHERE entity_type='song'`).run();
    db.prepare(`DELETE FROM service_items WHERE item_type='song'`).run();
    db.prepare('DELETE FROM songs').run();
  })();
}

export function addTag(songId, tagId) {
  getDb().prepare(`INSERT OR IGNORE INTO taggables (tag_id, entity_type, entity_id) VALUES (?, 'song', ?)`)
    .run(tagId, songId);
}

export function removeTag(songId, tagId) {
  getDb().prepare(`DELETE FROM taggables WHERE tag_id=? AND entity_type='song' AND entity_id=?`)
    .run(tagId, songId);
}

export function setBackground(songId, mediaId) {
  getDb().prepare(`UPDATE songs SET default_background_id=?, updated_at=datetime('now') WHERE id=?`)
    .run(mediaId || null, songId);
}

export function listTags() {
  return getDb().prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE').all();
}

export function createTag(data) {
  const { lastInsertRowid } = getDb().prepare('INSERT INTO tags (name, colour) VALUES (?, ?)')
    .run(data.name, data.colour || null);
  return Number(lastInsertRowid);
}

export function updateTag(id, data) {
  getDb().prepare('UPDATE tags SET name=?, colour=? WHERE id=?').run(data.name, data.colour || null, id);
}

export function deleteTag(id) {
  getDb().prepare('DELETE FROM tags WHERE id=?').run(id);
}
