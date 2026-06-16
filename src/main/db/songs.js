import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getDb } from './schema.js';
import { get as getSetting, set as setSetting } from './settings.js';
import { parseGhsItems } from '../import/songs-import.js';

export function search(query) {
  const db = getDb();
  const tagsStmt = _listTagsForSongStmt();
  if (!query || !query.trim()) {
    return db.prepare('SELECT id, title, author FROM songs ORDER BY title COLLATE NOCASE').all()
      .map((s) => ({ ...s, tags: tagsStmt.all(s.id) }));
  }
  const escaped = query.trim().replace(/['"*]/g, ' ').trim();
  if (!escaped) return [];
  try {
    const rows = db.prepare(`
      SELECT DISTINCT s.id, s.title, s.author
      FROM songs_fts f
      JOIN song_sections ss ON ss.id = f.rowid
      JOIN songs s ON s.id = ss.song_id
      WHERE songs_fts MATCH ?
      ORDER BY rank
    `).all(escaped + '*');
    return rows.map((s) => ({ ...s, tags: tagsStmt.all(s.id) }));
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
        db.prepare('INSERT INTO song_sections (song_id, type, order_index, content, style_json) VALUES (?, ?, ?, ?, ?)')
          .run(lastInsertRowid, _IMPORT_TYPES.has(s.type) ? s.type : 'verse', i, s.content, s.style_json ?? null)
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
      // Sections weren't replaced (e.g. a title/author/tag-only edit), so the
      // song_sections triggers never fired and the title/author indexed in
      // songs_fts is now stale. Re-sync this song's FTS rows in place. Delete by
      // rowid — the contentless_delete=1 idiom — never the 'delete' command with
      // empty values, which leaves orphaned tokens and corrupts the index.
      const del = db.prepare('DELETE FROM songs_fts WHERE rowid = ?');
      const ins = db.prepare(`
        INSERT INTO songs_fts(rowid, title, author, content)
        SELECT ss.id, s.title, s.author, ss.content
        FROM song_sections ss JOIN songs s ON s.id = ss.song_id
        WHERE ss.id = ?
      `);
      for (const s of db.prepare('SELECT id FROM song_sections WHERE song_id = ?').all(id)) {
        del.run(s.id);
        ins.run(s.id);
      }
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

// ── Paste Song List matcher ───────────────────────────────────────────────────
// Parses a raw pasted block into candidate titles and matches each against the
// library using FTS + title similarity. Where lyric snippets are present they
// boost the confidence of the correct match.

function _norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(); }

function _diceSim(a, b) {
  const wa = new Set(a.split(' ').filter(Boolean));
  const wb = new Set(b.split(' ').filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return (inter * 2) / (wa.size + wb.size);
}

function _stripLeadingNumber(line) {
  return line.replace(/^\s*\d+[\.\)\-]\s*/, '').trim();
}

// A leading "1." / "2)" / "3 -" list marker — the strongest title delimiter in a
// dirty pasted list. Requires text after it so a bare "1" lyric line isn't a title.
const _NUMBERED_RE = /^\s*\d{1,3}[\.\)\-]?\s+\S/;

// Section-header / lyric markers (Verse 2, Chorus:, [Bridge], Pre-Chorus…). Ported
// from songs-import.js's parseSections so paste behaves like file import: these are
// never song titles — they belong to the lyrics of the title above them.
const _SECTION_KW = 'verse|chorus|bridge|pre[-\\s]?chorus|prechorus|tag|intro|outro|refrain|vamp|interlude|ending';
const _SECTION_HEADER_RES = [
  new RegExp('^\\[(.{1,40}?)\\]\\s*:?\\s*$'),
  new RegExp(`^(${_SECTION_KW})\\s*\\d*\\s*:?\\s*$`, 'i'),
];
function _isSectionHeader(line) {
  const t = (line || '').trim();
  if (!t || t.length > 60) return false;
  return _SECTION_HEADER_RES.some((re) => re.test(t));
}

// Turn a raw pasted block into { rawTitle, lyrics } candidates. The input is often
// dirty — titles interleaved with lyrics. Detection order:
//   1. Numbered list  → each "N." line starts a song; following lines are its lyrics.
//   2. Blank-line blocks → first non-header line of each block is the title.
//   3. Plain list     → one title per line (no lyrics to disambiguate with).
// Section-header lines are folded into lyrics, never treated as titles.
function _parsePastedList(raw) {
  const lines = (raw || '').split('\n').map((l) => l.trim());
  const numberedCount = lines.filter((l) => _NUMBERED_RE.test(l)).length;

  // 1. Numbered list — robust even when songs aren't blank-separated.
  if (numberedCount >= 2) {
    const out = [];
    let cur = null;
    for (const l of lines) {
      if (!l) continue;
      if (_NUMBERED_RE.test(l)) {
        if (cur) out.push(cur);
        cur = { rawTitle: _stripLeadingNumber(l), lyrics: [] };
      } else if (cur && !_isSectionHeader(l)) {
        cur.lyrics.push(l);
      }
    }
    if (cur) out.push(cur);
    return out.map((c) => ({ rawTitle: c.rawTitle, lyrics: c.lyrics.join('\n') }));
  }

  // 2. Blank-line-separated blocks — first non-header line is the title.
  if (lines.some((l) => l === '')) {
    const blocks = [];
    let cur = [];
    for (const l of lines) {
      if (!l) { if (cur.length) { blocks.push(cur); cur = []; } }
      else cur.push(l);
    }
    if (cur.length) blocks.push(cur);
    return blocks
      .map((b) => {
        const titleIdx = b.findIndex((l) => !_isSectionHeader(l));
        if (titleIdx === -1) return null;
        const rawTitle = _stripLeadingNumber(b[titleIdx]);
        const lyrics = b.slice(titleIdx + 1).filter((l) => !_isSectionHeader(l)).join('\n');
        return rawTitle ? { rawTitle, lyrics } : null;
      })
      .filter(Boolean);
  }

  // 3. Plain one-per-line list (drop stray section headers).
  return lines
    .filter((l) => l && !_isSectionHeader(l))
    .map((l) => ({ rawTitle: _stripLeadingNumber(l), lyrics: '' }));
}

// Build a safe FTS5 MATCH expression from a free-text title. Two reasons not to
// feed the raw string to MATCH:
//   • FTS5 treats (), ", :, * as operators, so "Worthy (Is the Lamb)" is a syntax
//     error that throws inside the JOIN.
//   • AND-ing every word ("a AND new AND name AND in AND glory") misses a library
//     title that words differently — too strict for a hand-typed list.
// Instead: clean alphanumeric tokens, each prefix-matched and OR-ed, restricted to
// the title column so we rank songs by how many title words overlap (bm25 via
// `ORDER BY rank`) rather than demanding an exact word-for-word title.
function _ftsQuery(title) {
  const tokens = (title.toLowerCase().match(/[a-z0-9]+/g) || []).filter(Boolean);
  if (!tokens.length) return '';
  return `{title} : (${tokens.map((t) => t + '*').join(' OR ')})`;
}

export function matchTitles(rawText) {
  const db = getDb();
  const candidates = _parsePastedList(rawText);

  return candidates.map(({ rawTitle, lyrics }) => {
    const title = rawTitle.trim();
    if (!title) return null;
    try {
    // Exact case-insensitive hit
    const exact = db.prepare('SELECT id, title, author FROM songs WHERE title = ? COLLATE NOCASE').get(title);
    if (exact) return { input: rawTitle, match: exact, alternates: [], confidence: 'exact' };

    // FTS search (query sanitised to clean tokens so titles with (), ", : don't throw)
    const ftsExpr = _ftsQuery(title);
    let results = [];
    if (ftsExpr) {
      try {
        results = db.prepare(`
          SELECT DISTINCT s.id, s.title, s.author
          FROM songs_fts f
          JOIN song_sections ss ON ss.id = f.rowid
          JOIN songs s ON s.id = ss.song_id
          WHERE songs_fts MATCH ?
          ORDER BY rank
          LIMIT 6
        `).all(ftsExpr);
      } catch { results = []; }
    }

    if (!results.length) return { input: rawTitle, match: null, alternates: [], confidence: 'none' };

    const qNorm = _norm(title);
    const scored = results.map((r) => {
      const rNorm = _norm(r.title);
      let score;
      if (rNorm === qNorm) score = 1.0;
      else if (rNorm.startsWith(qNorm) || qNorm.startsWith(rNorm)) score = 0.8;
      else score = _diceSim(qNorm, rNorm);
      return { ...r, score };
    });

    // Lyric verification: boost candidates whose sections contain matching words
    if (lyrics && lyrics.trim()) {
      const lyricWords = new Set(
        _norm(lyrics).split(/\s+/).filter((w) => w.length > 3).slice(0, 50)
      );
      if (lyricWords.size > 0) {
        for (const r of scored) {
          const sections = db.prepare('SELECT content FROM song_sections WHERE song_id = ? LIMIT 4').all(r.id);
          const contentWords = new Set(
            sections.map((s) => s.content).join(' ')
              .toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 3)
          );
          const hits = [...lyricWords].filter((w) => contentWords.has(w)).length;
          if (hits > 0) r.score += Math.min(hits * 0.04, 0.15);
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const confidence =
      top.score >= 0.95 ? 'exact'
      : top.score >= 0.65 ? 'high'
      : top.score >= 0.3  ? 'low'
      : 'none';

    if (confidence === 'none') return { input: rawTitle, match: null, alternates: scored.slice(0, 3), confidence: 'none' };
    return { input: rawTitle, match: top, alternates: scored.slice(1, 4), confidence };
    } catch {
      // One bad title must not abort the whole batch — report it as not found.
      return { input: rawTitle, match: null, alternates: [], confidence: 'none' };
    }
  }).filter(Boolean);
}

export function listTags() {
  return getDb().prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM taggables tb WHERE tb.tag_id = t.id AND tb.entity_type = 'song') AS song_count
    FROM tags t
    ORDER BY t.name COLLATE NOCASE
  `).all();
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
