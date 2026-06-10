import { getDb } from './schema.js';
import { lookupBook } from './bible-books.js';
import { parseBibleFile } from './bible-import.js';

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
