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
        const have = new Set(rows.map((r) => r.id));
        // Already best-first; keep only plausible matches and append in order so the
        // OR-recall block always sits beneath the strict AND results.
        for (const c of _rankByOverlap(escaped, escaped, ftsRows, sectionsStmt)) {
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
  // A new song starts with NO background of its own — it follows the live global
  // song default (resolved at output time, §9) until one is set explicitly. Don't
  // snapshot the global here, or the song would silently stop tracking it.
  return db.transaction(() => {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO songs (title, author, copyright, default_background_id) VALUES (?, ?, ?, ?)'
    ).run(title, author || null, copyright || null, null);
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
        'INSERT INTO songs (title, author, copyright, default_background_id) VALUES (?, ?, ?, ?)'
      ).run(song.title || 'Untitled', song.author || null, song.copyright || null, null);
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
// Operators are handed a set list that is almost never a clean column of titles.
// Each entry is usually the FIRST LINE OF LYRICS ("As the deer panteth for the
// waters…"), not the library title ("As the Deer"), and the block is sprinkled
// with list numbers, repeat markers ("x2"), voice-part cues and set-section
// headers ("Worship", "Praise"). So we do NOT treat each line as a title and FTS
// the title column — we treat each block as a lyric snippet and FTS the whole
// index (title + content), then rank by how much of the snippet the song's
// lyrics actually contain. Title equality is still the top tier when it happens.

function _norm(s) {
  // Apostrophes are STRIPPED first (not spaced) so "God's" → "gods" and matches an
  // input that dropped the apostrophe ("Gods"), instead of splitting into "god" + "s"
  // (where "s" is then dropped as sub-3-char noise and the words never line up).
  // Covers straight + curly + modifier-letter apostrophes that pasted lyrics mix.
  // THEN replace remaining punctuation with spaces so "holy.What" → "holy what", and
  // collapse runs — including Unicode separators (NBSP, word-joiner) pasted lists are
  // full of — to single ASCII spaces.
  return (s || '').toLowerCase()
    .replace(/['’‘ʼ´`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Function words that say nothing about WHICH song this is. Kept out of the FTS
// expression and out of coverage scoring so "the/of/you" don't manufacture hits.
const _STOP = new Set((
  'the a an and or of to in on at is are was were be been am i you he she it we they ' +
  'my your his her our their me him us them this that these those there here for with ' +
  'as so but if then than oh yeah na la will shall would could unto thee thy thou o ' +
  'into onto from by up down out all not no yes do does did have has had'
).split(' '));

function _words(s) { return _norm(s).split(' ').filter(Boolean); }
// Distinctive = the words worth indexing/scoring on (drop stopwords + 1–2 letter noise).
function _distinctive(s) { return _words(s).filter((w) => w.length >= 3 && !_STOP.has(w)); }

function _stripLeadingNumber(line) {
  return line.replace(/^\s*\d+[\.\)\-]\s*/, '').trim();
}

// Strip repeat directives a chorister scribbles after a line: "x2", "2x",
// "(x3)", "3 times", "repeat". They are not part of the lyric to match on.
function _stripRepeat(line) {
  return String(line || '')
    .replace(/[\s(\[]*(?:x\s*\d+|\d+\s*x|\d+\s*times?|repeat(?:\s+all)?)[\s)\]]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A leading "1." / "2)" / "3 -" list marker. Requires text after it so a bare "1"
// lyric line isn't read as a new entry.
const _NUMBERED_RE = /^\s*\d{1,3}[\.\)\-]?\s+\S/;

// Section-header markers (Verse 2, Chorus:, [Bridge], Pre-Chorus…). These are never
// an entry of their own — they belong to the lyrics of the block they sit in.
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

// Set-list segment labels the operator uses to group the running order
// ("Worship", "Praise", "Offering"…). They caption a block of songs, they are not
// a song. Dropped only when a whole line is exactly one of these (an exact-membership
// test, so "Worship the King" — a real lyric — is never mistaken for a label).
const _SEGMENT_HEADERS = new Set([
  'worship', 'praise', 'praise and worship', 'offering', 'offertory', 'communion',
  'altar', 'altar call', 'call to worship', 'prayer', 'intercession', 'thanksgiving',
  'adoration', 'consecration', 'dedication', 'sermon', 'message', 'preaching',
  'announcements', 'welcome', 'opening', 'closing', 'benediction', 'fast', 'slow',
  'fast songs', 'slow songs', 'hymn', 'hymns', 'medley', 'special', 'ministration',
]);
function _isSegmentHeader(line) {
  const t = _norm(_stripRepeat(line));
  return !!t && _SEGMENT_HEADERS.has(t);
}

// Turn a raw pasted block into matchable entries: { label, query }. `label` is the
// human-readable first line shown in the modal; `query` is the full snippet text fed
// to FTS + coverage. Segmentation prefers blank-line BLOCKS (the most reliable signal
// in a dirty list); a dense numbered run inside one block is split further, and a list
// with no blank lines at all falls back to numbered-marker splitting.
function _parsePastedList(raw) {
  const lines = (raw || '').replace(/\r\n?/g, '\n').split('\n');
  const hasBlank = lines.some((l) => l.trim() === '');

  // Split a block that holds ≥2 numbered lines into one sub-block per numbered line.
  function splitNumbered(block) {
    const subs = [];
    let cur = null;
    for (const l of block) {
      if (!l.trim()) continue;
      if (_NUMBERED_RE.test(l)) { if (cur) subs.push(cur); cur = [l]; }
      else if (cur) cur.push(l);
      else cur = [l];
    }
    if (cur) subs.push(cur);
    return subs;
  }

  let blocks;
  if (hasBlank) {
    blocks = [];
    let cur = [];
    for (const l of lines) {
      if (l.trim() === '') { if (cur.length) { blocks.push(cur); cur = []; } }
      else cur.push(l);
    }
    if (cur.length) blocks.push(cur);
  } else {
    blocks = [lines.filter((l) => l.trim() !== '')];
  }

  const entries = [];
  for (const block of blocks) {
    const numbered = block.filter((l) => _NUMBERED_RE.test(l)).length;
    const subBlocks = numbered >= 2 ? splitNumbered(block) : [block];
    for (const sub of subBlocks) {
      // Strip list numbers + section headers; a leading segment label is dropped too.
      let cleaned = sub
        .map((l) => _stripLeadingNumber(l))
        .map((l) => l.trim())
        .filter((l) => l && !_isSectionHeader(l));
      while (cleaned.length && _isSegmentHeader(cleaned[0])) cleaned = cleaned.slice(1);
      if (!cleaned.length) continue;            // block was only headers/labels
      // Trim leading non-alphanumeric noise (stray bullets, NBSP, word-joiners that
      // pasted lists carry) so the display label is clean and exact-title still matches.
      const label = (_stripRepeat(cleaned[0]) || cleaned[0]).replace(/^[^\p{L}\p{N}"'(]+/u, '').trim();
      const query = cleaned.join('\n');
      if (label) entries.push({ label, query });
    }
  }
  return entries;
}

// Build a safe FTS5 MATCH expression from a free-text snippet. FTS5 treats
// (), ", :, * as operators, so we never feed the raw string in — we extract
// distinctive prefix tokens and OR them across ALL columns (title + content),
// capped so a long pasted verse stays a bounded query. ORing (not ANDing) lets a
// snippet that words a line differently still surface the song; bm25 ranks by overlap.
function _ftsQuery(text) {
  let toks = [...new Set(_distinctive(text))];
  if (!toks.length) toks = [...new Set(_words(text))]; // snippet was all stopwords
  if (!toks.length) return '';
  return toks.slice(0, 16).map((t) => t + '*').join(' OR ');
}

// Longest contiguous run of snippet words that appears verbatim in the song text.
// This is the single strongest signal that a lyric snippet belongs to a song —
// "as the deer panteth" matching as a 4-word run beats any bag-of-words overlap.
function _longestPhrase(query, songNorm) {
  const qw = _words(query);
  const hay = ` ${songNorm} `;
  let best = 0;
  for (let i = 0; i < qw.length; i++) {
    let phrase = qw[i];
    if (hay.indexOf(` ${phrase} `) === -1) continue;
    let len = 1;
    for (let j = i + 1; j < qw.length; j++) {
      const next = `${phrase} ${qw[j]}`;
      if (hay.indexOf(` ${next} `) === -1) break;
      phrase = next; len++;
    }
    if (len > best) best = len;
  }
  return best;
}

// Rank songs by how well their title+lyrics overlap a free-text snippet. Shared by
// the paste-list matcher (matchTitles) and the lyric-tolerant fallback in search().
// `rows` are per-section FTS hits with { id, title, author, bm }; collapse to the best
// (lowest bm25) row per song, then score the strongest handful against full lyrics. The
// longest verbatim phrase run dominates; lyric + title word coverage fill in. Returns
// [{ id, title, author, cov, titleCov, phrase, score }] best-first. `label` is the
// title-oriented query (the paste-list title); pass query for both when there's no
// separate title (a pure lyric search).
function _rankByOverlap(query, label, rows, sectionsStmt) {
  const bySong = new Map();
  for (const r of rows) { const p = bySong.get(r.id); if (!p || r.bm < p.bm) bySong.set(r.id, r); }
  const top8 = [...bySong.values()].sort((a, b) => a.bm - b.bm).slice(0, 8);

  const qWords = new Set(_distinctive(query || label));
  const qTitleWords = new Set(_distinctive(label));
  const scored = top8.map((r) => {
    const songNorm = _norm(`${r.title}\n${sectionsStmt.all(r.id).map((x) => x.content).join('\n')}`);
    const songWords = new Set(songNorm.split(' ').filter(Boolean));
    const cov = qWords.size ? [...qWords].filter((w) => songWords.has(w)).length / qWords.size : 0;
    const titleCov = qTitleWords.size ? [...qTitleWords].filter((w) => songWords.has(w)).length / qTitleWords.size : 0;
    const phrase = _longestPhrase(query || label, songNorm);
    // Phrase run dominates; lyric coverage and title overlap fill in.
    const score = Math.max(cov, titleCov) + (phrase >= 4 ? 0.4 : phrase >= 3 ? 0.25 : phrase >= 2 ? 0.1 : 0);
    return { id: r.id, title: r.title, author: r.author, cov, titleCov, phrase, score };
  });
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  return scored;
}

export function matchTitles(rawText) {
  const db = getDb();
  const entries = _parsePastedList(rawText);

  const exactStmt = db.prepare('SELECT id, title, author FROM songs WHERE title = ? COLLATE NOCASE');
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
  const sectionsStmt = db.prepare('SELECT content FROM song_sections WHERE song_id = ?');

  const slim = (r) => ({ id: r.id, title: r.title, author: r.author });

  return entries.map(({ label, query }) => {
    try {
      // 1. Exact title equality — the only 'exact' tier.
      const exact = exactStmt.get(label.trim());
      if (exact) return { input: label, match: slim(exact), alternates: [], confidence: 'exact' };

      const expr = _ftsQuery(query || label);
      if (!expr) return { input: label, match: null, alternates: [], confidence: 'none' };
      let rows = [];
      try { rows = ftsStmt.all(expr); } catch { rows = []; }
      if (!rows.length) return { input: label, match: null, alternates: [], confidence: 'none' };

      // Collapse per-section hits to the best row per song, then phrase/coverage-rank
      // the strongest handful against full lyrics (shared with search()'s fallback).
      const scored = _rankByOverlap(query || label, label, rows, sectionsStmt);

      const top = scored[0];
      const second = scored[1];
      const margin = second ? top.score - second.score : top.score;

      let confidence;
      if (top.phrase >= 4 || top.cov >= 0.7 || top.titleCov >= 0.85) confidence = 'high';
      else if (top.phrase >= 2 || top.cov >= 0.35 || top.titleCov >= 0.5) confidence = 'low';
      else confidence = 'none';
      // Two near-tied strong candidates → not confident which; demote so the
      // operator eyeballs it (the match is still pre-selected as the top pick).
      if (confidence === 'high' && top.phrase < 4 && margin < 0.08) confidence = 'low';

      const alternates = scored.slice(1, 4).map(slim);
      if (confidence === 'none') return { input: label, match: null, alternates: scored.slice(0, 3).map(slim), confidence: 'none' };
      return { input: label, match: slim(top), alternates, confidence };
    } catch {
      // One bad entry must not abort the whole batch — report it as not found.
      return { input: label, match: null, alternates: [], confidence: 'none' };
    }
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
