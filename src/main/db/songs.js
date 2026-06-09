import { getDb } from './schema.js';
import { get as getSetting } from './settings.js';

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

export function listAll() {
  const db = getDb();
  const songs = db.prepare(
    'SELECT id, title, author, copyright, default_background_id, created_at, updated_at FROM songs ORDER BY title COLLATE NOCASE'
  ).all();
  const tagsStmt = db.prepare(
    `SELECT t.* FROM tags t JOIN taggables tb ON tb.tag_id = t.id WHERE tb.entity_type = 'song' AND tb.entity_id = ?`
  );
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
