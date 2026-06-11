import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getDb } from './schema.js';
import { BOOKS, lookupBook } from './bible-books.js';
import { parseBibleFile, deriveAbbrev } from './bible-import.js';

export function listVersions() {
  const db = getDb();
  return db.prepare(`
    SELECT v.*, (SELECT COUNT(*) FROM bible_verses WHERE version_id = v.id) AS verse_count
    FROM bible_versions v ORDER BY v.name COLLATE NOCASE
  `).all();
}

// Import a parsed version payload into the DB. Returns { id, name, count }.
export function importVersion({ name, abbrev, language, verses }) {
  const db = getDb();
  let versionId;
  db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO bible_versions (name, abbrev, language) VALUES (?,?,?)')
      .run(name, abbrev, language || null);
    versionId = Number(lastInsertRowid);

    const insVerse = db.prepare(
      'INSERT INTO bible_verses (version_id, book_num, book_name, chapter, verse, text) VALUES (?,?,?,?,?,?)',
    );
    const insFts = db.prepare('INSERT INTO bible_verses_fts (rowid, book_name, text) VALUES (?,?,?)');
    for (const v of verses) {
      const { lastInsertRowid: vid } = insVerse.run(
        versionId, v.book_num, v.book_name, v.chapter, v.verse, v.text,
      );
      insFts.run(Number(vid), v.book_name, v.text);
    }
  })();
  return { id: versionId, name, count: verses.length };
}

// Import directly from a file path (parses + stores).
export function importFromFile(filePath, meta = {}) {
  const payload = parseBibleFile(filePath, meta);
  return importVersion(payload);
}

export function deleteVersion(id) {
  const db = getDb();
  // FTS has no FK; purge its rows for this version first, then cascade verses.
  // The 'delete' command needs the original column values to remove the tokens.
  const rows = db.prepare('SELECT id, book_name, text FROM bible_verses WHERE version_id = ?').all(id);
  const delFts = db.prepare(
    "INSERT INTO bible_verses_fts (bible_verses_fts, rowid, book_name, text) VALUES ('delete',?,?,?)",
  );
  db.transaction(() => {
    for (const r of rows) delFts.run(r.id, r.book_name, r.text);
    db.prepare('DELETE FROM bible_versions WHERE id = ?').run(id); // CASCADE removes verses
  })();
}

// Distinct book names present in a version (canonical order).
export function listBooks(versionId) {
  return getDb().prepare(
    'SELECT DISTINCT book_num, book_name FROM bible_verses WHERE version_id = ? ORDER BY book_num',
  ).all(versionId);
}

// Chapter numbers present for a book, ascending.
export function listChapters(versionId, bookNum) {
  return getDb().prepare(
    'SELECT DISTINCT chapter FROM bible_verses WHERE version_id = ? AND book_num = ? ORDER BY chapter',
  ).all(versionId, bookNum).map((r) => r.chapter);
}

// Every verse of a chapter, ascending — drives the live verse list.
export function listVerses(versionId, bookNum, chapter) {
  const db = getDb();
  const bookRow = db.prepare(
    'SELECT DISTINCT book_name FROM bible_verses WHERE version_id = ? AND book_num = ? LIMIT 1',
  ).get(versionId, bookNum);
  const bookName = bookRow?.book_name || null;
  const verses = db.prepare(
    'SELECT chapter, verse, text FROM bible_verses WHERE version_id = ? AND book_num = ? AND chapter = ? ORDER BY verse',
  ).all(versionId, bookNum, chapter);
  return { bookNum, bookName, chapter, verses };
}

// The verse immediately before/after (bookNum, chapter, verse) in canonical
// order within a version — rolls across chapter and book boundaries. dir: 1 | -1.
// Returns { book_num, book_name, chapter, verse, text } or null at the ends.
export function adjacentVerse(versionId, bookNum, chapter, verse, dir) {
  const db = getDb();
  if (dir >= 0) {
    return db.prepare(
      `SELECT book_num, book_name, chapter, verse, text FROM bible_verses
       WHERE version_id = ? AND (
         book_num > ? OR
         (book_num = ? AND (chapter > ? OR (chapter = ? AND verse > ?))))
       ORDER BY book_num, chapter, verse LIMIT 1`,
    ).get(versionId, bookNum, bookNum, chapter, chapter, verse) || null;
  }
  return db.prepare(
    `SELECT book_num, book_name, chapter, verse, text FROM bible_verses
     WHERE version_id = ? AND (
       book_num < ? OR
       (book_num = ? AND (chapter < ? OR (chapter = ? AND verse < ?))))
     ORDER BY book_num DESC, chapter DESC, verse DESC LIMIT 1`,
  ).get(versionId, bookNum, bookNum, chapter, chapter, verse) || null;
}

// ── Bundled translations ─────────────────────────────────────────────────────
// KJV + WEB ship as normalized seed JSON in resources/bible/. On first run (or
// whenever a bundled version is missing) they're imported so the app always has
// at least these two public-domain translations available.

function bundledBibleDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bible')
    : path.join(app.getAppPath(), 'resources', 'bible');
}

export function seedBundledBibles() {
  const dir = bundledBibleDir();
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
  } catch {
    return; // no bundled bibles present (e.g. dev checkout without resources)
  }
  const existing = new Set(listVersions().map((v) => String(v.abbrev).toUpperCase()));
  for (const file of files) {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (!payload?.abbrev || !Array.isArray(payload.verses)) continue;
      if (existing.has(String(payload.abbrev).toUpperCase())) continue;
      importVersion(payload);
      existing.add(String(payload.abbrev).toUpperCase());
    } catch (err) {
      console.error('[bible-seed] failed to import', file, err.message);
    }
  }
}

// Parse a free-text reference like "John 3:16", "John 3:16-18", "Psalm 23",
// "1 John 2:1-2" into { bookNum, bookName, chapter, vStart, vEnd } or null.
function parseReference(ref) {
  const m = /^\s*(.+?)\s+(\d+)(?:\s*[:.]\s*(\d+)(?:\s*-\s*(\d+))?)?\s*$/.exec(ref || '');
  if (!m) return null;
  const book = lookupBook(m[1]);
  if (!book) return null;
  const chapter = parseInt(m[2], 10);
  const vStart = m[3] ? parseInt(m[3], 10) : null;
  const vEnd = m[4] ? parseInt(m[4], 10) : vStart;
  return { bookNum: book.num, bookName: book.name, chapter, vStart, vEnd };
}

// Resolve a reference against a version into a self-contained passage payload
// suitable for storing on a service_item. Returns null if nothing matched.
export function resolvePassage(versionId, ref, versesPerSlide = 1) {
  const db = getDb();
  const version = db.prepare('SELECT * FROM bible_versions WHERE id = ?').get(versionId);
  if (!version) return null;
  const parsed = parseReference(ref);
  if (!parsed) return null;

  // Match the parsed canonical book to the version's actual stored book_name.
  const bookRow = db.prepare(
    'SELECT DISTINCT book_name FROM bible_verses WHERE version_id = ? AND book_num = ? LIMIT 1',
  ).get(versionId, parsed.bookNum);
  const storedBookName = bookRow?.book_name || parsed.bookName;

  let rows;
  if (parsed.vStart == null) {
    rows = db.prepare(
      'SELECT chapter, verse, text FROM bible_verses WHERE version_id = ? AND book_num = ? AND chapter = ? ORDER BY verse',
    ).all(versionId, parsed.bookNum, parsed.chapter);
  } else {
    rows = db.prepare(
      `SELECT chapter, verse, text FROM bible_verses
       WHERE version_id = ? AND book_num = ? AND chapter = ? AND verse BETWEEN ? AND ?
       ORDER BY verse`,
    ).all(versionId, parsed.bookNum, parsed.chapter, parsed.vStart, parsed.vEnd);
  }
  if (!rows.length) return null;

  const first = rows[0], last = rows[rows.length - 1];
  const reference = rows.length > 1
    ? `${storedBookName} ${parsed.chapter}:${first.verse}-${last.verse}`
    : `${storedBookName} ${parsed.chapter}:${first.verse}`;

  return {
    versionId,
    versionAbbrev: version.abbrev,
    versionName: version.name,
    bookNum: parsed.bookNum,
    bookName: storedBookName,
    reference,
    versesPerSlide: Math.max(1, versesPerSlide | 0),
    verses: rows.map((r) => ({ chapter: r.chapter, verse: r.verse, text: r.text })),
  };
}

// Full-text verse search within a version. Returns up to `limit` matches.
export function search(versionId, query, limit = 60) {
  const db = getDb();
  const tokens = String(query || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `${t}*`);
  if (!tokens.length) return [];
  const match = tokens.join(' ');
  return db.prepare(
    `SELECT v.book_name, v.book_num, v.chapter, v.verse, v.text
     FROM bible_verses_fts f
     JOIN bible_verses v ON v.id = f.rowid
     WHERE f.text MATCH ? AND v.version_id = ?
     ORDER BY v.book_num, v.chapter, v.verse
     LIMIT ?`,
  ).all(match, versionId, limit);
}

// ── Online catalog (getbible.net v2) ─────────────────────────────────────────
// A public, Git-backed Bible API exposing a 117-version catalog with per-version
// licence metadata — the same source the bundled KJV/WEB came from. Used by the
// "Import from online" flow to let the operator pick + download translations.
// Licence responsibility rests with the operator (see the UI warning).

const GETBIBLE_BASE = 'https://api.getbible.net/v2';

function cleanVerseText(s) {
  return String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// Catalog of downloadable versions, flagged with install state + licence.
export async function listOnlineVersions() {
  const res = await fetch(`${GETBIBLE_BASE}/translations.json`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Catalog request failed (HTTP ${res.status})`);
  const catalog = await res.json();
  // The stored abbreviation is derived from the name at download time, so match
  // installed state by translation name (stable) rather than abbreviation.
  const installed = new Set(listVersions().map((v) => String(v.name).toLowerCase()));
  return Object.values(catalog)
    .map((v) => {
      const license = v.distribution_license || 'Unknown';
      return {
        abbrev: v.abbreviation,               // catalog code — unique selection key + download slug
        name: v.translation,
        language: v.language || v.lang || '',
        license,
        restricted: /copyright|non[-\s]?commercial|\bnc\b|[-\s]nd\b|permission|sword format/i.test(license),
        installed: installed.has(String(v.translation || '').toLowerCase()),
      };
    })
    .sort((a, b) =>
      (a.language === 'English' ? 0 : 1) - (b.language === 'English' ? 0 : 1) ||
      (a.language || '').localeCompare(b.language || '') ||
      (a.name || '').localeCompare(b.name || ''));
}

// Download one version by abbrev, normalize to canonical books, and import it.
// Returns { id, name, count } or { already: true, name } if it's already present.
export async function downloadOnlineVersion(abbrev) {
  const slug = String(abbrev || '').toLowerCase();
  if (!slug) throw new Error('No version specified.');
  const res = await fetch(`${GETBIBLE_BASE}/${encodeURIComponent(slug)}.json`, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const raw = await res.json();

  const verses = [];
  for (const book of raw.books || []) {
    const canonical = BOOKS.find((b) => b.num === book.nr);
    const bookName = canonical?.name || book.name;
    for (const ch of book.chapters || []) {
      for (const v of ch.verses || []) {
        const text = cleanVerseText(v.text);
        if (text) verses.push({ book_num: book.nr, book_name: bookName, chapter: ch.chapter, verse: v.verse, text });
      }
    }
  }
  if (!verses.length) throw new Error('No verses found in downloaded file.');

  const name = raw.translation || abbrev;
  const ab = deriveAbbrev(name);
  if (listVersions().some((v) => String(v.name).toLowerCase() === String(name).toLowerCase())) {
    return { already: true, name };
  }
  return importVersion({ name, abbrev: ab, language: raw.language || null, verses });
}
