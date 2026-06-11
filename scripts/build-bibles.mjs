// Build bundled Bible seed files from the public getbible.net v2 API.
//
//   node scripts/build-bibles.mjs
//
// Emits resources/bible/<abbrev>.json in Cue's normalized seed format:
//   { name, abbrev, language, verses: [{ book_num, book_name, chapter, verse, text }] }
//
// Book numbering/names are normalized to the canonical 66-book Protestant order
// in src/main/db/bible-books.js so free-text references resolve consistently
// across translations. Both KJV and WEB are public domain.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'resources', 'bible');

// abbrev → display metadata. Source: https://api.getbible.net/v2/<abbrev>.json
const SOURCES = [
  { abbrev: 'kjv', name: 'King James Version', language: 'English' },
  { abbrev: 'web', name: 'World English Bible', language: 'English' },
];

// Canonical 66-book Protestant order — mirrors src/main/db/bible-books.js so
// references resolve consistently. Index 0 = book_num 1.
const BOOK_NAMES = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians',
  '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];
const byNum = new Map(BOOK_NAMES.map((name, i) => [i + 1, name]));

function cleanText(s) {
  return String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function fetchTranslation(abbrev) {
  const url = `https://api.getbible.net/v2/${abbrev}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${abbrev}: HTTP ${res.status}`);
  return res.json();
}

function normalize(raw) {
  const verses = [];
  for (const book of raw.books) {
    const bookNum = book.nr;
    const bookName = byNum.get(bookNum) || book.name;
    for (const ch of book.chapters) {
      for (const v of ch.verses) {
        const text = cleanText(v.text);
        if (text) verses.push({ book_num: bookNum, book_name: bookName, chapter: ch.chapter, verse: v.verse, text });
      }
    }
  }
  return verses;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const src of SOURCES) {
    process.stdout.write(`Fetching ${src.abbrev}… `);
    const raw = await fetchTranslation(src.abbrev);
    const verses = normalize(raw);
    const payload = { name: src.name, abbrev: src.abbrev.toUpperCase(), language: src.language, verses };
    const outPath = path.join(OUT_DIR, `${src.abbrev}.json`);
    fs.writeFileSync(outPath, JSON.stringify(payload));
    console.log(`${verses.length} verses → ${path.relative(path.join(__dirname, '..'), outPath)}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
