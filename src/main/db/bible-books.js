// Canonical 66-book Protestant ordering with common abbreviations.
// Used to assign book_num for import formats that don't carry one, and to
// resolve free-text references ("1 Jn 2:1") to a stored book.

export const BOOKS = [
  { num: 1,  name: 'Genesis',         abbrevs: ['gen', 'ge', 'gn'] },
  { num: 2,  name: 'Exodus',          abbrevs: ['exo', 'ex', 'exod'] },
  { num: 3,  name: 'Leviticus',       abbrevs: ['lev', 'le', 'lv'] },
  { num: 4,  name: 'Numbers',         abbrevs: ['num', 'nu', 'nm', 'nb'] },
  { num: 5,  name: 'Deuteronomy',     abbrevs: ['deu', 'dt', 'deut'] },
  { num: 6,  name: 'Joshua',          abbrevs: ['jos', 'jsh', 'josh'] },
  { num: 7,  name: 'Judges',          abbrevs: ['jdg', 'jg', 'judg'] },
  { num: 8,  name: 'Ruth',            abbrevs: ['rut', 'ru', 'rth'] },
  { num: 9,  name: '1 Samuel',        abbrevs: ['1sa', '1sam', '1s', '1 sam'] },
  { num: 10, name: '2 Samuel',        abbrevs: ['2sa', '2sam', '2s', '2 sam'] },
  { num: 11, name: '1 Kings',         abbrevs: ['1ki', '1kgs', '1k', '1 kgs'] },
  { num: 12, name: '2 Kings',         abbrevs: ['2ki', '2kgs', '2k', '2 kgs'] },
  { num: 13, name: '1 Chronicles',    abbrevs: ['1ch', '1chr', '1 chr'] },
  { num: 14, name: '2 Chronicles',    abbrevs: ['2ch', '2chr', '2 chr'] },
  { num: 15, name: 'Ezra',            abbrevs: ['ezr', 'ez'] },
  { num: 16, name: 'Nehemiah',        abbrevs: ['neh', 'ne'] },
  { num: 17, name: 'Esther',          abbrevs: ['est', 'es', 'esth'] },
  { num: 18, name: 'Job',             abbrevs: ['job', 'jb'] },
  { num: 19, name: 'Psalms',          abbrevs: ['psa', 'ps', 'psalm', 'pss', 'psm'] },
  { num: 20, name: 'Proverbs',        abbrevs: ['pro', 'pr', 'prov', 'prv'] },
  { num: 21, name: 'Ecclesiastes',    abbrevs: ['ecc', 'ec', 'eccl', 'qoh'] },
  { num: 22, name: 'Song of Solomon', abbrevs: ['sng', 'so', 'song', 'sos', 'canticles', 'cant'] },
  { num: 23, name: 'Isaiah',          abbrevs: ['isa', 'is'] },
  { num: 24, name: 'Jeremiah',        abbrevs: ['jer', 'je', 'jr'] },
  { num: 25, name: 'Lamentations',    abbrevs: ['lam', 'la'] },
  { num: 26, name: 'Ezekiel',         abbrevs: ['ezk', 'eze', 'ezek'] },
  { num: 27, name: 'Daniel',          abbrevs: ['dan', 'da', 'dn'] },
  { num: 28, name: 'Hosea',           abbrevs: ['hos', 'ho'] },
  { num: 29, name: 'Joel',            abbrevs: ['joe', 'jl', 'joel'] },
  { num: 30, name: 'Amos',            abbrevs: ['amo', 'am'] },
  { num: 31, name: 'Obadiah',         abbrevs: ['oba', 'ob', 'obad'] },
  { num: 32, name: 'Jonah',           abbrevs: ['jon', 'jnh'] },
  { num: 33, name: 'Micah',           abbrevs: ['mic', 'mc'] },
  { num: 34, name: 'Nahum',           abbrevs: ['nam', 'na', 'nah'] },
  { num: 35, name: 'Habakkuk',        abbrevs: ['hab', 'hb'] },
  { num: 36, name: 'Zephaniah',       abbrevs: ['zep', 'zp', 'zeph'] },
  { num: 37, name: 'Haggai',          abbrevs: ['hag', 'hg'] },
  { num: 38, name: 'Zechariah',       abbrevs: ['zec', 'zc', 'zech'] },
  { num: 39, name: 'Malachi',         abbrevs: ['mal', 'ml'] },
  { num: 40, name: 'Matthew',         abbrevs: ['mat', 'mt', 'matt'] },
  { num: 41, name: 'Mark',            abbrevs: ['mrk', 'mk', 'mr'] },
  { num: 42, name: 'Luke',            abbrevs: ['luk', 'lk', 'lu'] },
  { num: 43, name: 'John',            abbrevs: ['jhn', 'jn', 'joh'] },
  { num: 44, name: 'Acts',            abbrevs: ['act', 'ac'] },
  { num: 45, name: 'Romans',          abbrevs: ['rom', 'ro', 'rm'] },
  { num: 46, name: '1 Corinthians',   abbrevs: ['1co', '1cor', '1 cor'] },
  { num: 47, name: '2 Corinthians',   abbrevs: ['2co', '2cor', '2 cor'] },
  { num: 48, name: 'Galatians',       abbrevs: ['gal', 'ga'] },
  { num: 49, name: 'Ephesians',       abbrevs: ['eph', 'ephes'] },
  { num: 50, name: 'Philippians',     abbrevs: ['php', 'phil', 'pp'] },
  { num: 51, name: 'Colossians',      abbrevs: ['col', 'co'] },
  { num: 52, name: '1 Thessalonians', abbrevs: ['1th', '1thess', '1 thess', '1 thes'] },
  { num: 53, name: '2 Thessalonians', abbrevs: ['2th', '2thess', '2 thess', '2 thes'] },
  { num: 54, name: '1 Timothy',       abbrevs: ['1ti', '1tim', '1 tim'] },
  { num: 55, name: '2 Timothy',       abbrevs: ['2ti', '2tim', '2 tim'] },
  { num: 56, name: 'Titus',           abbrevs: ['tit', 'ti'] },
  { num: 57, name: 'Philemon',        abbrevs: ['phm', 'phlm', 'philem'] },
  { num: 58, name: 'Hebrews',         abbrevs: ['heb', 'he'] },
  { num: 59, name: 'James',           abbrevs: ['jas', 'jm', 'jam'] },
  { num: 60, name: '1 Peter',         abbrevs: ['1pe', '1pet', '1 pet', '1pt'] },
  { num: 61, name: '2 Peter',         abbrevs: ['2pe', '2pet', '2 pet', '2pt'] },
  { num: 62, name: '1 John',          abbrevs: ['1jn', '1jo', '1 jn', '1 jhn', '1joh'] },
  { num: 63, name: '2 John',          abbrevs: ['2jn', '2jo', '2 jn', '2 jhn', '2joh'] },
  { num: 64, name: '3 John',          abbrevs: ['3jn', '3jo', '3 jn', '3 jhn', '3joh'] },
  { num: 65, name: 'Jude',            abbrevs: ['jud', 'jde'] },
  { num: 66, name: 'Revelation',      abbrevs: ['rev', 're', 'rv', 'apocalypse'] },
];

const norm = (s) => String(s || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

// Lookup index: normalized name and every abbrev → book record.
const INDEX = (() => {
  const m = new Map();
  for (const b of BOOKS) {
    m.set(norm(b.name), b);
    m.set(norm(b.name).replace(/\s+/g, ''), b);
    for (const a of b.abbrevs) {
      m.set(norm(a), b);
      m.set(norm(a).replace(/\s+/g, ''), b);
    }
  }
  return m;
})();

// Resolve a free-text book name/abbrev to a canonical BOOKS record, or null.
export function lookupBook(input) {
  const n = norm(input);
  if (!n) return null;
  if (INDEX.has(n)) return INDEX.get(n);
  const compact = n.replace(/\s+/g, '');
  if (INDEX.has(compact)) return INDEX.get(compact);
  // Prefix fallback — "philipp" → Philippians, "psa" already covered above.
  for (const b of BOOKS) {
    const bn = norm(b.name);
    if (bn.startsWith(n) || bn.replace(/\s+/g, '').startsWith(compact)) return b;
  }
  return null;
}
