import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getDb } from './schema.js';
import { get as getSetting, set as setSetting } from './settings.js';
import { parseGhsItems } from '../import/songs-import.js';
import { words as _words, distinctive as _distinctive, ftsQuery as _ftsQuery, rankByOverlap, matchSetList } from '../../shared/setlist-match.js';

export function search(query) {
  const db = getDb();
  const tagsStmt = _listTagsForSongStmt();
  if (!query || !query.trim()) {
    return db.prepare('SELECT id, title, author FROM songs ORDER BY title COLLATE NOCASE').all()
      .map((s) => ({ ...s, tags: tagsStmt.all(s.id) }));
  }
  // Strip apostrophes (straight + curly + modifier) so the query collapses "God's" →
  // "gods" and matches the apostrophe-stripped FTS index (schema v26); replace FTS
  // operator chars with spaces. Missing apostrophes no longer harm strict results.
  const escaped = query.trim()
    .replace(/['’‘ʼ´`]/g, '')
    .replace(/["*]/g, ' ')
    .trim();
  if (!escaped) return [];

  // Strict AND-prefix search — every word must be present (last token a prefix). This
  // is the primary, unchanged behaviour; its hits always rank first by FTS rank.
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT DISTINCT s.id, s.title, s.author
      FROM songs_fts f
      JOIN song_sections ss ON ss.id = f.rowid
      JOIN songs s ON s.id = ss.song_id
      WHERE songs_fts MATCH ?
      ORDER BY rank
    `).all(escaped + '*');
  } catch { rows = []; }

  // Lyric-tolerant fallback: the strict AND query returns nothing when a pasted/typed
  // lyric line carries one misremembered or extra word. It ALWAYS runs (regardless of
  // how many strict hits came in) as long as the query has ≥1 word and ≥1 distinctive
  // token, OR-recalls the distinctive tokens, phrase-ranks them, and APPENDS any NEW
  // songs strictly BELOW the strict hits (which stay on top, untouched). De-dupe keeps
  // it from repeating a strict hit, so on an exact query it adds nothing.
  if (_words(escaped).length >= 1 && _distinctive(escaped).length >= 1) {
    const expr = _ftsQuery(escaped);
    if (expr) {
      try {
        const ftsRows = db.prepare(`
          SELECT ss.song_id AS id, s.title, s.author, bm25(songs_fts, 8.0, 1.0, 4.0) AS bm
          FROM songs_fts f
          JOIN song_sections ss ON ss.id = f.rowid
          JOIN songs s ON s.id = ss.song_id
          WHERE songs_fts MATCH ?
          ORDER BY bm
          LIMIT 60
        `).all(expr);
        const sectionsStmt = db.prepare('SELECT content FROM song_sections WHERE song_id = ?');
        const textOf = (id) => sectionsStmt.all(id).map((x) => x.content).join('\n');
        const have = new Set(rows.map((r) => r.id));
        // Already best-first; keep only plausible matches and append in order so the
        // OR-recall block always sits beneath the strict AND results.
        for (const c of rankByOverlap(escaped, escaped, ftsRows, textOf)) {
          if (have.has(c.id) || !(c.phrase >= 2 || c.cov >= 0.34)) continue;
          rows.push({ id: c.id, title: c.title, author: c.author });
          have.add(c.id);
        }
      } catch { /* FTS5 syntax fallthrough — strict results stand */ }
    }
  }

  return rows.map((s) => ({ id: s.id, title: s.title, author: s.author, tags: tagsStmt.all(s.id) }));
}

const _listAllSongsStmt = () => getDb().prepare(
  'SELECT id, title, author, copyright, default_background_id, max_lines, created_at, updated_at FROM songs ORDER BY title COLLATE NOCASE'
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

// Per-song max lines per slide: a non-negative integer, 0 = inherit (no cap).
// Clamped to the same 0–20 range the Song Editor / Theme controls offer.
function normMaxLines(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(20, n) : 0;
}

// Arrangement = the played order of sections as 0-based positions (repeats
// allowed), stored as JSON. Normalise unknown shapes to null (= natural order).
function serializeArrangement(arrangement, sectionCount) {
  if (!Array.isArray(arrangement)) return null;
  const idxs = arrangement
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < sectionCount);
  return idxs.length ? JSON.stringify(idxs) : null;
}

export function create(data) {
  const db = getDb();
  const { title, author, copyright, sections = [], tagIds = [], arrangement, maxLines } = data;
  // A new song starts with NO background of its own — it follows the live global
  // song default (resolved at output time, §9) until one is set explicitly. Don't
  // snapshot the global here, or the song would silently stop tracking it.
  return db.transaction(() => {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO songs (title, author, copyright, default_background_id, arrangement_json, max_lines) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(title, author || null, copyright || null, null, serializeArrangement(arrangement, sections.length), normMaxLines(maxLines));
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
// batch. Each song starts with no background of its own (it follows the live global
// default, like create()), and any `song.tags` are get-or-created and assigned.
export function importSongs(parsedSongs = []) {
  const db = getDb();
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
        'INSERT INTO songs (title, author, copyright, default_background_id, arrangement_json) VALUES (?, ?, ?, ?, ?)'
      ).run(song.title || 'Untitled', song.author || null, song.copyright || null, null,
        serializeArrangement(song.arrangement, (song.sections || []).length));
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
        .map((r) => ({ title: r.title, author: r.author, copyright: r.copyright, sections: r.sections, arrangement: r.arrangement, tags: r.tags }));
      if (toImport.length) importSongs(toImport);
      setSetting('ghs_seeded', true);
    } catch { /* no bundled hymnal present (e.g. dev checkout without resources) */ }
  }
  tagGhsSongs();
  patchGhsPunctuation();
}

// One-time content fix for OCR punctuation artefacts in five bundled GHS hymns
// (printed note-sustain dots captured as literal "., . . ." plus a few mangled
// words). The seed import is gated by `ghs_seeded` and skips existing titles, so
// a corrected ghs-hymnal.json alone never reaches users who already imported the
// broken text — this backfill does. It edits song_sections.content at the
// substring level, so it is independent of how a song was split into sections,
// idempotent (the broken fragment is gone after the first run), respects user
// edits (an edited line no longer matches, so it is left alone) and never
// resurrects a deleted hymn (it only touches rows that still exist). Scoped to
// GHS songs. song_sections UPDATE triggers keep songs_fts in sync automatically.
const GHS_PUNCT_FIXES = [
  // GHS 47 – Just Obey
  ['Just obey . . ., just obey . . .,', 'Just obey, just obey,'],
  ['Is the way . . ., God’s way . . .,', 'Is the way, God’s way,'],
  ['Just obey . . . just obey.', 'Just obey, just obey.'],
  // GHS 24 – It Is Well With My Soul
  ['It is well . . . with my soul . . .', 'It is well, with my soul,'],
  // GHS 121 – Somebody Else Needs Him, Too
  ['They-need Him., they need Him, too', 'They need Him, they need Him, too'],
  ['waiting for you;…', 'waiting for you…'],
  // GHS 132 – Running Over
  ['Ru.. nning over, Ru… nning over,', 'Running over, running over,'],
  ['Tho’.my way be drear', 'Tho’ my way be drear'],
  ['My cup’s and running over.', 'My cup’s fill’d and running over.'],
  // GHS 174 – Jesus Is Coming Again
  ['again!..', 'again!'],
];

export function patchGhsPunctuation() {
  if (getSetting('ghs_punct_fix_v1')) return;
  const db = getDb();
  try {
    const upd = db.prepare(`
      UPDATE song_sections SET content = REPLACE(content, @from, @to)
      WHERE song_id IN (SELECT id FROM songs WHERE title GLOB 'GHS [0-9]*')
        AND content LIKE '%' || @from || '%'
    `);
    db.transaction(() => {
      for (const [from, to] of GHS_PUNCT_FIXES) upd.run({ from, to });
    })();
    setSetting('ghs_punct_fix_v1', true);
  } catch { /* non-fatal: a failed backfill just retries next launch */ }
}

export function update(id, data) {
  const db = getDb();
  const { title, author, copyright, sections, tagIds, arrangement, maxLines } = data;
  db.transaction(() => {
    db.prepare(`UPDATE songs SET title=?, author=?, copyright=?, updated_at=datetime('now') WHERE id=?`)
      .run(title, author || null, copyright || null, id);
    // Per-song max-lines cap. `undefined` = leave untouched (partial edits); an
    // explicit value (incl. 0 = clear) is normalised and written.
    if (maxLines !== undefined) {
      db.prepare('UPDATE songs SET max_lines=? WHERE id=?').run(normMaxLines(maxLines), id);
    }
    // Arrangement rides the same save as the sections it indexes (positions, not
    // ids — the section rewrite below churns ids). `undefined` = leave untouched.
    if (arrangement !== undefined) {
      const count = sections !== undefined
        ? sections.length
        : db.prepare('SELECT COUNT(*) AS c FROM song_sections WHERE song_id=?').get(id).c;
      db.prepare('UPDATE songs SET arrangement_json=? WHERE id=?')
        .run(serializeArrangement(arrangement, count), id);
    }
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
      // Strip apostrophes on the way in, mirroring the songs_fts triggers (schema v26)
      // so a title/author-only edit keeps the index apostrophe-insensitive.
      const _strip = (c) => `replace(replace(replace(replace(${c},char(39),''),char(8217),''),char(8216),''),char(700),'')`;
      const ins = db.prepare(`
        INSERT INTO songs_fts(rowid, title, author, content)
        SELECT ss.id, ${_strip('s.title')}, ${_strip('s.author')}, ${_strip('ss.content')}
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

export function applyStyleToSong(songId, styleJson) {
  const db = getDb();
  let newStyle = {};
  try { newStyle = styleJson ? JSON.parse(styleJson) : {}; } catch {}
  const sections = db.prepare('SELECT id, style_json FROM song_sections WHERE song_id = ?').all(songId);
  const upd = db.prepare('UPDATE song_sections SET style_json = ? WHERE id = ?');
  db.transaction(() => {
    for (const sec of sections) {
      let existing = {};
      try { existing = sec.style_json ? JSON.parse(sec.style_json) : {}; } catch {}
      // Preserve character-level runs from the existing section.
      const runs = existing.runs?.length ? existing.runs : undefined;
      const merged = runs ? { ...newStyle, runs } : newStyle;
      const isEmpty = Object.keys(merged).length === 0;
      upd.run(isEmpty ? null : JSON.stringify(merged), sec.id);
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

// Lock/unlock a song's background. While locked the song's own
// default_background_id is pinned at the top of the resolution cascade
// (lock → override → song → global → black): slot overrides and the live global
// default are ignored, and the bulk "apply background" actions skip it. Pure flag,
// no media reference.
export function setLock(songId, locked) {
  getDb().prepare(`UPDATE songs SET background_locked=?, updated_at=datetime('now') WHERE id=?`)
    .run(locked ? 1 : 0, songId);
}

// ── Paste Song List matcher ───────────────────────────────────────────────────
// Paste-a-set-list matcher. All segmentation + matching logic lives in
// src/shared/setlist-match.js (pure, unit-tested); this just hands it the library:
// a title/first-line index, FTS5 recall over title+lyrics, and lyric text per song.
export function matchTitles(rawText) {
  const db = getDb();
  // bm25 column weights: title ≫ content ≫ author. Lower bm25 = better → ORDER BY asc.
  const ftsStmt = db.prepare(`
    SELECT ss.song_id AS id, s.title, s.author, bm25(songs_fts, 8.0, 1.0, 4.0) AS bm
    FROM songs_fts f
    JOIN song_sections ss ON ss.id = f.rowid
    JOIN songs s ON s.id = ss.song_id
    WHERE songs_fts MATCH ?
    ORDER BY bm
    LIMIT 60
  `);
  const sectionsStmt = db.prepare('SELECT content FROM song_sections WHERE song_id = ? ORDER BY order_index');
  const textCache = new Map();
  const textOf = (id) => {
    if (!textCache.has(id)) textCache.set(id, sectionsStmt.all(id).map((x) => x.content).join('\n'));
    return textCache.get(id);
  };
  // First line of every section ("As the deer panteth…", a chorus's opening line) —
  // set lists name songs by these as often as by title.
  const firstLines = new Map();
  for (const r of db.prepare('SELECT song_id, content FROM song_sections ORDER BY song_id, order_index').all()) {
    const line = String(r.content || '').split('\n').find((l) => l.trim() && !/^\s*⁂\s*$/.test(l));
    if (!line) continue;
    const a = firstLines.get(r.song_id);
    if (a) { if (a.length < 6) a.push(line); } else firstLines.set(r.song_id, [line]);
  }
  const songs = db.prepare('SELECT id, title, author FROM songs').all()
    .map((s) => ({ ...s, firstLines: firstLines.get(s.id) || [] }));

  return matchSetList(rawText, {
    songs,
    textOf,
    fts: (expr) => ftsStmt.all(expr),
  });
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

// ── Song usage log (CCLI reporting) ──────────────────────────────────────────
// One row per song aired, deduped so re-airing the same song within a service
// (slide jumps, GO'ing back after scripture, etc.) counts once. Fields are
// snapshotted at air time so the report survives later edits/deletes.
const USAGE_DEDUPE_HOURS = 12;

export function logUsage(songId) {
  const db = getDb();
  const song = db.prepare('SELECT id, title, author, copyright FROM songs WHERE id=?').get(songId);
  if (!song) return { logged: false };
  const recent = db.prepare(
    `SELECT id FROM song_usage WHERE song_id=? AND used_at >= datetime('now', ?) LIMIT 1`
  ).get(songId, `-${USAGE_DEDUPE_HOURS} hours`);
  if (recent) return { logged: false };
  db.prepare('INSERT INTO song_usage (song_id, title, author, copyright) VALUES (?, ?, ?, ?)')
    .run(song.id, song.title, song.author || null, song.copyright || null);
  return { logged: true };
}

// Aggregated usage between two ISO dates (inclusive), newest-used first.
// Grouped by the snapshotted title/author/copyright so renamed/deleted songs
// still report what was actually shown.
export function usageReport(fromIso, toIso) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT title, author, copyright, COUNT(*) AS times_used,
           MIN(used_at) AS first_used, MAX(used_at) AS last_used
    FROM song_usage
    WHERE date(used_at) >= date(?) AND date(used_at) <= date(?)
    GROUP BY title, author, copyright
    ORDER BY last_used DESC
  `).all(fromIso, toIso);
  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM song_usage WHERE date(used_at) >= date(?) AND date(used_at) <= date(?)`
  ).get(fromIso, toIso).c;
  return { rows, total };
}

export function usageClear() {
  getDb().prepare('DELETE FROM song_usage').run();
}
