// Shared written-scripture-reference grammar (pure, no DB, no Electron).
//
// ONE parser for references that are TYPED or WRITTEN ("1 Cor 13 4-7", "II Timothy 3.16",
// "Gen 1:1-2:3", "John 3:16-18,20", "Jude 5", "John 3:16 NIV"):
//   • parseScriptureRef(text)   — a whole string is one reference (bible:resolve / typed UI)
//   • scanScriptureRefs(text)   — find references inside prose (sermon import)
// The SPOKEN/ASR parser (scripture-detect/reference-parser.js) is deliberately separate
// (it works on digitised word tokens with fuzzy book matching).
//
// A parsed reference is a list of SEGMENTS, each { chapter, vStart, endChapter, vEnd }:
//   vStart === null            → whole chapter(s) chapter..endChapter
//   endChapter === chapter     → verses vStart..vEnd of one chapter
//   endChapter  >  chapter     → cross-chapter range chapter:vStart – endChapter:vEnd
// Single-chapter books (Obadiah, Philemon, 2/3 John, Jude): a lone number is the VERSE
// ("Jude 5" → Jude 1:5).

import { BOOKS, lookupBook } from '../main/db/bible-books.js';

export const SINGLE_CHAPTER_BOOKS = new Set([31, 57, 63, 64, 65]);

// Two-letter-or-shorter abbreviations that are NOT everyday words may stand on a bare
// chapter ("Ps 23"); every other short token ("Is", "Am", "So", "Ex", "He"…) only counts
// when a chapter:verse backs it — otherwise "I am 30 years old" becomes Amos 30.
const SAFE_SHORT = new Set(['ps', 'jn', 'mt', 'mk', 'lk', 'gn', 'lv', 'nm', 'dt', 'jg', 'rm',
  'rv', 'hb', 'jl', 'jb', 'hg', 'zp', 'zc', 'ml', 'mr', 'jr', 'dn']);

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Book matching ─────────────────────────────────────────────────────────────

const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
const ORD_ST = { 1: '1st', 2: '2nd', 3: '3rd' };
const ORD_WORD = { 1: 'first', 2: 'second', 3: 'third' };

// Every spelling of every book as a regex alternation (longest first). Numbered books also
// accept Roman ("II Timothy"), "1st/2nd/3rd" and "First/Second/Third" prefixes.
const BOOK_PAT = (() => {
  const alts = new Map(); // regex source → sort weight
  const add = (src, w) => { if (!alts.has(src) || alts.get(src) < w) alts.set(src, w); };
  const numbered = new Map(); // `${d}|${rest}` → true
  for (const b of BOOKS) {
    for (const t of [b.name, ...b.abbrevs]) {
      const tl = String(t).toLowerCase().trim();
      const nm = /^([123])\s*(.+)$/.exec(tl);
      if (nm) {
        numbered.set(`${nm[1]}|${nm[2]}`, true);
      } else {
        add(esc(t).replace(/\s+/g, '\\s+'), t.length);
      }
    }
  }
  for (const key of numbered.keys()) {
    const [d, rest] = key.split('|');
    const body = esc(rest).replace(/\s+/g, '\\s+');
    const w = rest.length + 2;
    add(`${d}\\.?\\s*${body}`, w);
    if (rest.length >= 2) {
      add(`${ORD_ST[d]}\\.?\\s*${body}`, w + 3);
      add(`${ROMAN[d]}(?:\\.\\s*|\\s+)${body}`, w + 1);
      add(`${ORD_WORD[d]}\\s+${body}`, w + 5);
    }
  }
  return [...alts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s).join('|');
})();

// Normalise a matched book spelling to something lookupBook understands.
function normBookText(raw) {
  let s = String(raw).toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:first|1st)\s*(?=[a-z])/, '1 ')
    .replace(/^(?:second|2nd)\s*(?=[a-z])/, '2 ')
    .replace(/^(?:third|3rd)\s*(?=[a-z])/, '3 ')
    .replace(/^iii\s+(?=[a-z])/, '3 ')
    .replace(/^ii\s+(?=[a-z])/, '2 ')
    .replace(/^i\s+(?=[a-z])/, '1 ');
  return s;
}

const isShortAmbiguous = (norm) => {
  const compact = norm.replace(/[\s\d]/g, '');
  return compact.length <= 2 && !SAFE_SHORT.has(compact);
};

// ── Body (chapter / verse) grammar ────────────────────────────────────────────

const DASHES = /[‐-―−]/g;
const isDigit = (c) => c >= '0' && c <= '9';

function readInt(s, i) {
  let j = i;
  while (j < s.length && isDigit(s[j]) && j - i < 3) j++;
  if (j === i || isDigit(s[j] || '')) return null; // none, or 4+ digits
  return { n: parseInt(s.slice(i, j), 10), end: j };
}

// A verse number may carry a part-letter ("16a", "17b") — consume it if not a word start.
function skipPart(s, i) {
  if (/^[a-d](?![A-Za-z])/.test(s.slice(i, i + 2))) return i + 1;
  return i;
}

// "Ps 119:105-6" means 105-106; a reversed range with no such reading is dropped to a
// single verse rather than producing an empty query.
function fixEnd(start, end) {
  if (end >= start) return end;
  const sl = String(start), el = String(end);
  if (el.length < sl.length) {
    const exp = parseInt(sl.slice(0, sl.length - el.length) + el, 10);
    if (exp >= start) return exp;
  }
  return start;
}

// Parse a verse list beginning at `i` (the first verse number) for `chapter`.
// opts.loose also accepts ", 20" with a space (typed input). Returns { segments, end }.
function parseVerseList(s, i, chapter, opts) {
  const segments = [];
  let ch = chapter;
  let first = true;
  for (;;) {
    let c = ch, v = readInt(s, i);
    if (!v) return first ? null : { segments, end: i };
    // "3:19" inside a list = new chapter (only after the first item).
    let vStart = v.n, p = v.end;
    if (!first) {
      const cm = /^\s*:\s*(\d{1,3})(?!\d)/.exec(s.slice(p));
      if (cm) { c = v.n; vStart = parseInt(cm[1], 10); p += cm[0].length; }
    }
    p = skipPart(s, p);
    let seg = { chapter: c, vStart, endChapter: c, vEnd: vStart };
    const rm = /^\s*-\s*(?=\d)/.exec(s.slice(p));
    if (rm) {
      const e = readInt(s, p + rm[0].length);
      if (e) {
        let q = e.end;
        const xm = !opts.single && /^\s*:\s*(\d{1,3})(?!\d)/.exec(s.slice(q));
        if (xm && e.n > c) {            // cross-chapter: "1:1-2:3"
          seg.endChapter = e.n; seg.vEnd = parseInt(xm[1], 10); q += xm[0].length;
        } else {
          seg.vEnd = fixEnd(vStart, e.n);
        }
        p = skipPart(s, q);
      }
    }
    if (seg.vStart < 1 || seg.vEnd < 1 || seg.chapter < 1) return first ? null : { segments, end: i };
    segments.push(seg);
    ch = seg.endChapter;
    first = false;
    // Continuation: ",20" (tight), ", 20" (typed), ", 3:19" or "; 7:1" (chapter:verse).
    const cont = /^(\s*[,;]\s*)(?=\d)/.exec(s.slice(p));
    if (!cont) return { segments, end: p };
    const tight = !/\s$/.test(cont[1]) && cont[1].trim() === ',';
    const after = p + cont[0].length;
    const isCV = /^\d{1,3}\s*:\s*\d/.test(s.slice(after));
    if (cont[1].includes(';')) {
      if (!isCV) return { segments, end: p };
    } else if (!(tight || isCV || opts.loose)) {
      return { segments, end: p };
    }
    i = after;
  }
}

// Parse chapter/verse after a book. Returns { segments, end, explicitVerse } or null.
// opts: { single, loose }
function parseBody(s, pos, opts) {
  let i = pos;
  while (/[ \t ]/.test(s[i] || '')) i++;
  const kw = /^(?:chapters?|chap|ch)\.?\s*(?=\d)/i.exec(s.slice(i));
  if (kw) i += kw[0].length;
  const n1 = readInt(s, i);
  if (!n1) return null;
  const rest = s.slice(n1.end);

  if (opts.single) {
    const cm = /^\s*:\s*(?=\d)/.exec(rest);
    if (cm) {
      const r = parseVerseList(s, n1.end + cm[0].length, n1.n, opts);
      return r && { ...r, explicitVerse: true };
    }
    const r = parseVerseList(s, i, 1, opts);
    return r && { ...r, explicitVerse: true };
  }

  let m;
  if ((m = /^\s*:\s*(?=\d)/.exec(rest)) || (m = /^\.(?=\d)/.exec(rest))
    || (m = /^\s*(?:verses?|vv|vs|v)\.?\s*(?=\d)/i.exec(rest))) {
    const r = parseVerseList(s, n1.end + m[0].length, n1.n, opts);
    if (r) return { ...r, explicitVerse: true };
  }
  if ((m = /^\s*-\s*(\d{1,3})(?![\d:])/.exec(rest))) {
    const e = parseInt(m[1], 10);
    if (e > n1.n) {
      return { segments: [{ chapter: n1.n, vStart: null, endChapter: e, vEnd: null }], end: n1.end + m[0].length, explicitVerse: false };
    }
  }
  if (opts.loose && (m = /^\s+(?=\d)/.exec(rest))) {
    const r = parseVerseList(s, n1.end + m[0].length, n1.n, opts);
    if (r) return { ...r, explicitVerse: true };
  }
  if (n1.n < 1) return null;
  return { segments: [{ chapter: n1.n, vStart: null, endChapter: n1.n, vEnd: null }], end: n1.end, explicitVerse: false };
}

// ── Formatting ────────────────────────────────────────────────────────────────

// Canonical display form: "John 3:16-18,20", "Genesis 1:1-2:3", "Psalms 23", "Psalms 23-24".
export function formatRef(bookName, segments) {
  let out = '';
  let lastCh = null;
  segments.forEach((g, idx) => {
    let piece;
    if (g.vStart == null) {
      piece = g.endChapter > g.chapter ? `${g.chapter}-${g.endChapter}` : `${g.chapter}`;
      out += (idx ? '; ' : '') + piece;
      lastCh = null;
      return;
    }
    const sameChAsPrev = idx > 0 && lastCh === g.chapter;
    if (g.endChapter > g.chapter) piece = `${g.chapter}:${g.vStart}-${g.endChapter}:${g.vEnd}`;
    else if (g.vEnd !== g.vStart) piece = `${sameChAsPrev ? '' : g.chapter + ':'}${g.vStart}-${g.vEnd}`;
    else piece = `${sameChAsPrev ? '' : g.chapter + ':'}${g.vStart}`;
    out += idx ? (sameChAsPrev ? ',' : '; ') + piece : piece;
    lastCh = g.endChapter;
  });
  return `${bookName} ${out}`;
}

function build(book, segments, extra = {}) {
  const f = segments[0];
  return {
    bookNum: book.num,
    bookName: book.name,
    segments,
    chapter: f.chapter,
    endChapter: f.endChapter,
    vStart: f.vStart,
    vEnd: f.vStart == null ? null : f.vEnd,
    ref: formatRef(book.name, segments),
    ...extra,
  };
}

// ── Public: whole-string parse (typed) ────────────────────────────────────────

const BOOK_STICKY = new RegExp(`^\\s*(${BOOK_PAT})\\.?`, 'iu');
const LOOSE_BOOK = /^\s*((?:[123]|iii|ii|i|1st|2nd|3rd|first|second|third)?\.?\s*[A-Za-z][A-Za-z.]*(?:\s+[A-Za-z]+)*?)\s*\.?\s*(?=\d)/i;

// Parse a typed reference. Returns
//   { bookNum, bookName, segments, chapter, endChapter, vStart, vEnd, ref, translation } | null
// `translation` is a trailing version tag ("NIV", "KJV") if one was typed.
export function parseScriptureRef(input) {
  const s = String(input ?? '').replace(DASHES, '-').replace(/ /g, ' ');
  if (!s.trim()) return null;
  let book = null, bodyPos = 0;
  const m = BOOK_STICKY.exec(s);
  if (m) {
    const b = lookupBook(normBookText(m[1]));
    // Reject "John" matching the front of "Johnson"-like input: the body must follow.
    if (b) { book = b; bodyPos = m[0].length; }
  }
  if (!book) {
    const lm = LOOSE_BOOK.exec(s);
    if (lm) {
      const b = lookupBook(normBookText(lm[1]));
      if (b) { book = b; bodyPos = lm[0].length; }
    }
  }
  if (!book) return null;
  const body = parseBody(s, bodyPos, { single: SINGLE_CHAPTER_BOOKS.has(book.num), loose: true });
  if (!body) return null;
  const tail = s.slice(body.end).replace(/^\s*-\s*$/, ''); // "Psalms 23:1-" (mid-typing)
  let translation = null;
  if (tail.trim()) {
    const tm = /^\s*[(\[]?\s*([A-Za-z][A-Za-z0-9]{1,9})\s*[)\]]?\s*$/.exec(tail);
    if (!tm) return null;
    translation = tm[1].toUpperCase();
  }
  return build(book, body.segments, { translation });
}

// ── Chapter-only false-positive guard ─────────────────────────────────────────
// A book whose name is also an everyday word or first name ("Mark 5 minutes ago",
// "Acts 2 weeks", "Job 1 at the office", "Numbers 5 through 8 of the list") is only taken
// on a bare chapter when the surroundings back it. A chapter:verse reference is never
// subject to this. Genuine whole-chapter references still pass: "Read John 3", "(Romans 8)",
// "Psalm 23" (Psalms is not a common word), "John 3, where…", a ref alone on its line.
const COMMON_WORD_BOOKS = new Set([4, 6, 7, 8, 9, 10, 11, 12, 18, 27, 29, 32, 17, 41, 42, 40, 43, 44, 54, 55,
  56, 59, 60, 61, 62, 63, 64, 65, 30]);
const CTX_BEFORE = new Set(['in', 'see', 'read', 'reading', 'from', 'cf', 'compare', 'to', 'at', 'and', 'or',
  'also', 'of', 'with', 'per', 'via', 'through', 'text', 'passage', 'turn', 'open', 'verse', 'chapter']);
// Next word that continues ordinary prose after the number → not a reference.
const NOT_REF_NEXT = new Set(['minute', 'minutes', 'min', 'mins', 'second', 'seconds', 'sec', 'secs', 'hour', 'hours',
  'hr', 'hrs', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years', 'time', 'times', 'oclock',
  'am', 'pm', 'percent', 'people', 'men', 'women', 'persons', 'person', 'kids', 'children', 'years-old',
  'things', 'items', 'ways', 'steps', 'points', 'reasons', 'more', 'less', 'ago', 'later', 'earlier', 'of', 'out',
  'through', 'to', 'until', 'till', 'versus', 'vs', 'or', 'at', 'in', 'on', 'for', 'by', 'off', 'up', 'down',
  'dollars', 'pounds', 'miles', 'feet', 'times', 'hundred', 'thousand', 'million', 'plus', 'x', 'pieces']);
const NEXT_SUPPORT = new Set(['says', 'said', 'tells', 'told', 'reads', 'records', 'describes', 'shows', 'teaches']);

function chapterOnlyHasContext(s, start, end) {
  const lineEnd = s.indexOf('\n', end);
  const after = s.slice(end, lineEnd < 0 ? s.length : lineEnd);
  const w = /^[ \t]*([A-Za-z][A-Za-z'’-]*)/.exec(after);
  const next = w ? w[1].toLowerCase() : null;
  if (next && NOT_REF_NEXT.has(next)) return false;
  // supporting context after: end of line / closing bracket / sentence punctuation / says…
  if (/^[ \t]*(?:$|[.,;:!?)\]}”"'’])/.test(after) || (next && NEXT_SUPPORT.has(next))) return true;
  // supporting context before: opening bracket, or a lead-in word
  const lineStart = s.lastIndexOf('\n', start - 1) + 1;
  const before = s.slice(lineStart, start);
  if (/[(\[{“"]\s*$/.test(before)) return true;
  const pw = /([A-Za-z]+)\.?\s*$/.exec(before);
  return !!(pw && CTX_BEFORE.has(pw[1].toLowerCase()));
}

// ── Public: scan prose ────────────────────────────────────────────────────────

// Find references in running text, in order. Each: parse fields + { index, end }.
// Not deduplicated (callers dedupe as they need).
export function scanScriptureRefs(text) {
  const s = String(text ?? '').replace(DASHES, '-');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${BOOK_PAT})\\.?`, 'giu');
  const out = [];
  let m;
  while ((m = re.exec(s))) {
    const norm = normBookText(m[1]);
    const book = lookupBook(norm);
    if (!book) continue;
    const body = parseBody(s, m.index + m[0].length, { single: SINGLE_CHAPTER_BOOKS.has(book.num), loose: false });
    if (!body) { re.lastIndex = m.index + m[0].length; continue; }
    if (isShortAmbiguous(norm) && !body.explicitVerse) { re.lastIndex = m.index + m[0].length; continue; }
    if (!body.explicitVerse && COMMON_WORD_BOOKS.has(book.num) && !chapterOnlyHasContext(s, m.index, body.end)) {
      re.lastIndex = m.index + m[0].length; continue;
    }
    out.push(build(book, body.segments, { index: m.index, end: body.end }));
    re.lastIndex = body.end;
  }
  return out;
}

// ── Passage helpers (pure, used by db/bible.js and sermon-build.js) ───────────

// Does verse (chapter, verse) fall inside the segment?
export function segmentContains(g, chapter, verse) {
  if (chapter < g.chapter || chapter > g.endChapter) return false;
  if (g.vStart == null) return true;
  if (chapter === g.chapter && verse < g.vStart) return false;
  if (chapter === g.endChapter && verse > g.vEnd) return false;
  return true;
}

// Label for the verses actually found (clamped to the real chapter lengths), e.g.
// "John 3:16-18,20", "Genesis 1:1-2:3", "Psalms 23:1-6". rows: [{chapter, verse}] sorted.
export function passageLabel(bookName, segments, rows) {
  const clamped = [];
  for (const g of segments) {
    const hit = rows.filter((r) => segmentContains(g, r.chapter, r.verse));
    if (!hit.length) continue;
    const a = hit[0], b = hit[hit.length - 1];
    clamped.push({ chapter: a.chapter, vStart: a.verse, endChapter: b.chapter, vEnd: b.verse });
  }
  if (!clamped.length) return bookName;
  return formatRef(bookName, clamped);
}

// Greedy split of verses into slides by combined text length. A verse is never split
// (one over-long verse gets a slide to itself). Returns [[{chapter,verse,text,piece}…]…].
export function paginateVerses(verses, maxChars = 360) {
  const multi = verses.length > 1;
  const groups = [];
  let cur = [], len = 0;
  let prevCh = null;
  for (const v of verses) {
    // A bare verse number is ambiguous once the passage crosses a chapter ("31 … 1 …"), so
    // the first verse after a chapter change is numbered "2:1".
    const num = prevCh != null && v.chapter !== prevCh ? `${v.chapter}:${v.verse}` : `${v.verse}`;
    prevCh = v.chapter;
    const piece = (multi ? `${num} ` : '') + v.text;
    if (cur.length && len + piece.length > maxChars) { groups.push(cur); cur = []; len = 0; }
    cur.push({ ...v, piece });
    len += piece.length;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// "Book c:a-b" (or "c1:a-c2:b" when the group crosses a chapter) for one slide's verses.
export function groupLabel(bookName, group) {
  const a = group[0], b = group[group.length - 1];
  if (a.chapter !== b.chapter) return `${bookName} ${a.chapter}:${a.verse}-${b.chapter}:${b.verse}`;
  return `${bookName} ${a.chapter}:${a.verse}${b.verse !== a.verse ? '-' + b.verse : ''}`;
}

// ── Book-name search (Scriptures tab autocomplete) ────────────────────────────

const compactKey = (t) => String(t ?? '').toLowerCase().replace(/\./g, '').replace(/\s+/g, '');
// "1 cor" / "1cor" / "i cor" / "First Cor" / "II Tim" → "1cor" / "2tim" (spaces are ignored
// when comparing). A Roman numeral only counts when separated ("is" must stay "is").
function normQuery(q) {
  let s = String(q ?? '').toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:first|1st)\s*(?=[a-z])/, '1').replace(/^(?:second|2nd)\s*(?=[a-z])/, '2')
    .replace(/^(?:third|3rd)\s*(?=[a-z])/, '3')
    .replace(/^iii\s+(?=[a-z])/, '3').replace(/^ii\s+(?=[a-z])/, '2').replace(/^i\s+(?=[a-z])/, '1');
  return s.replace(/\s+/g, '');
}

// Rank the stored book rows ({ book_num, book_name }) against what the operator typed.
// Tiers: 0 exact name/abbreviation ("jn", "ps", "1 cor", "song of songs"), 1 name prefix,
// 2 abbreviation prefix (2+ chars), 3 name contains (only when nothing matches from the start). Within a tier, canonical order.
// Returns { matches, exact } — `exact` is true when the best tier is an exact hit
// (safe to commit); an ambiguous short prefix ("jo", "ph") yields several candidates and
// exact=false so the caller shows them all instead of guessing.
export function matchBooks(query, rows) {
  const q = normQuery(query);
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!q) return { matches: list, exact: false };
  const byNum = new Map(BOOKS.map((b) => [b.num, b]));
  const scored = [];
  for (const r of list) {
    const canon = byNum.get(r.book_num);
    const name = compactKey(r.book_name);
    const abbrevs = canon ? [compactKey(canon.name), ...canon.abbrevs.map(compactKey)] : [];
    let tier = null;
    if (name === q || abbrevs.includes(q)) tier = 0;
    else if (name.startsWith(q) || (canon && compactKey(canon.name).startsWith(q))) tier = 1;
    else if (q.length >= 2 && abbrevs.some((a) => a.startsWith(q))) tier = 2;
    else if (name.includes(q)) tier = 3;
    if (tier != null) scored.push({ r, tier });
  }
  if (!scored.length) return { matches: [], exact: false };
  const best = Math.min(...scored.map((x) => x.tier));
  // "contains" is only a last resort when nothing matches from the start.
  const keep = best === 3 ? scored : scored.filter((x) => x.tier < 3);
  keep.sort((a, b) => a.tier - b.tier || (a.r.book_num - b.r.book_num));
  return { matches: keep.map((x) => x.r), exact: best === 0 };
}
