// Parsers that normalize common free Bible file formats into:
//   { name, abbrev, language, verses: [{ book_num, book_name, chapter, verse, text }] }
//
// Supported:
//   • thiagobodruk JSON  — [{ name, abbrev, chapters: [[v1,v2,...], ...] }, ...]
//   • flat verse JSON    — [{ book_name|book, chapter, verse, text }, ...]  (also {verses:[...]})
//   • Zefania XML        — <BIBLEBOOK bnumber bname><CHAPTER cnumber><VERS vnumber>text</VERS>
//
// Free translations in these formats: github.com/thiagobodruk/bible (JSON),
// github.com/scrollmapper/bible_databases, zefania-sharp (Zefania XML).

import fs from 'fs';
import path from 'path';
import { BOOKS, lookupBook } from './bible-books.js';

function cleanText(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, '')   // strip any inline markup
    .replace(/\s+/g, ' ')
    .trim();
}

// ── thiagobodruk: array of books, each with a chapters array-of-arrays ───────
function parseBookArrayJson(data) {
  const verses = [];
  data.forEach((book, bi) => {
    const resolved = lookupBook(book.name) || lookupBook(book.abbrev);
    const bookNum = resolved?.num ?? bi + 1;
    const bookName = resolved?.name ?? (book.name || `Book ${bi + 1}`);
    (book.chapters || []).forEach((chapter, ci) => {
      chapter.forEach((text, vi) => {
        const t = cleanText(text);
        if (t) verses.push({ book_num: bookNum, book_name: bookName, chapter: ci + 1, verse: vi + 1, text: t });
      });
    });
  });
  return verses;
}

// ── flat list of verse objects ──────────────────────────────────────────────
function parseFlatJson(rows) {
  const verses = [];
  for (const r of rows) {
    const rawBook = r.book_name ?? r.book ?? r.b ?? r.name;
    const resolved = typeof rawBook === 'string' ? lookupBook(rawBook) : null;
    const bookNum = resolved?.num
      ?? (Number.isFinite(+rawBook) ? +rawBook : null)
      ?? (r.book_num ?? null);
    const bookEntry = bookNum ? BOOKS.find((b) => b.num === bookNum) : null;
    const bookName = resolved?.name ?? bookEntry?.name ?? (typeof rawBook === 'string' ? rawBook : `Book ${bookNum}`);
    const chapter = +(r.chapter ?? r.c ?? r.chap);
    const verse = +(r.verse ?? r.v ?? r.verseNumber);
    const text = cleanText(r.text ?? r.t ?? r.content);
    if (bookNum && chapter && verse && text) {
      verses.push({ book_num: bookNum, book_name: bookName, chapter, verse, text });
    }
  }
  return verses;
}

function parseJson(raw) {
  const data = JSON.parse(raw);
  if (Array.isArray(data) && data.length && Array.isArray(data[0]?.chapters)) {
    return parseBookArrayJson(data);
  }
  const rows = Array.isArray(data) ? data : Array.isArray(data?.verses) ? data.verses : null;
  if (rows) return parseFlatJson(rows);
  throw new Error('Unrecognized JSON Bible structure.');
}

// ── Zefania XML ───────────────────────────────────────────────────────────────
function parseZefania(raw) {
  const verses = [];
  const bookRe = /<BIBLEBOOK\b([^>]*)>([\s\S]*?)<\/BIBLEBOOK>/gi;
  const chapRe = /<CHAPTER\b([^>]*)>([\s\S]*?)<\/CHAPTER>/gi;
  const versRe = /<VERS\b([^>]*)>([\s\S]*?)<\/VERS>/gi;
  const attr = (s, name) => {
    const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(s);
    return m ? m[1] : null;
  };

  let bm;
  while ((bm = bookRe.exec(raw))) {
    const battr = bm[1];
    const bname = attr(battr, 'bname');
    const bnumber = parseInt(attr(battr, 'bnumber'), 10);
    const resolved = lookupBook(bname) || (bnumber ? BOOKS.find((b) => b.num === bnumber) : null);
    const bookNum = resolved?.num ?? bnumber;
    const bookName = resolved?.name ?? bname;
    if (!bookNum || !bookName) continue;

    let cm;
    chapRe.lastIndex = 0;
    while ((cm = chapRe.exec(bm[2]))) {
      const cnumber = parseInt(attr(cm[1], 'cnumber'), 10);
      let vm;
      versRe.lastIndex = 0;
      while ((vm = versRe.exec(cm[2]))) {
        const vnumber = parseInt(attr(vm[1], 'vnumber'), 10);
        const text = cleanText(vm[2]);
        if (cnumber && vnumber && text) {
          verses.push({ book_num: bookNum, book_name: bookName, chapter: cnumber, verse: vnumber, text });
        }
      }
    }
  }
  return verses;
}

// Parse a file into a normalized version payload. `meta` overrides name/abbrev.
export function parseBibleFile(filePath, meta = {}) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  const looksXml = ext === '.xml' || /^\s*<\?xml|<XMLBIBLE|<BIBLEBOOK/i.test(raw.slice(0, 500));

  const verses = looksXml ? parseZefania(raw) : parseJson(raw);
  if (!verses.length) throw new Error('No verses found in file.');

  const base = path.basename(filePath, ext);
  return {
    name: meta.name || base,
    abbrev: meta.abbrev || base.slice(0, 8).toUpperCase(),
    language: meta.language || null,
    verses,
  };
}
