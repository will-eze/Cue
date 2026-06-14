// Spoken scripture-reference parser.
//
// Turns a transcript fragment ("turn to first corinthians thirteen verse four")
// into a structured reference ("1 Corinthians 13:4") the EXISTING
// bible.resolvePassage()/bible.resolve IPC can resolve. Pure + dependency-light
// (only bible-books.js) so it is unit-testable under plain node.
//
// Pipeline:
//   1. wordsToNumbers() — spoken numbers → digits.
//   2. Scan tokens for a book (reusing lookupBook, with a small Levenshtein
//      fallback for ASR mishears: "filipinos" → Philippians, "romance" → Romans).
//   3. Parse the trailing chapter[:verse[-verse]] grammar.
//   4. Score confidence so the manager can gate weak hits.
//
// Dedupe/cooldown is the manager's job; this function is stateless.

import { BOOKS, lookupBook } from '../db/bible-books.js';
import { wordsToNumbers } from './numbers.js';

const VERSE_KEYWORDS = new Set(['verse', 'verses', 'v', 'vs', 'vv']);
const RANGE_WORDS = new Set(['to', 'through', 'thru', 'until']);

// Single-chapter books: a lone number is the VERSE, not the chapter ("Jude nine"
// → Jude 1:9; "Philemon verse six" → Philemon 1:6). bookNum per bible-books.js.
const SINGLE_CHAPTER = new Set([31, 57, 63, 64, 65]); // Obadiah, Philemon, 2 John, 3 John, Jude

// Short abbreviations that are also common English words — accepting them as a
// book on their own produces constant false positives in running speech. We only
// honor these when an explicit "chapter"/"verse"/colon cue backs them up.
const AMBIGUOUS_SHORT = new Set(['is', 'am', 'so', 'ho', 'ac', 'or', 'on', 'no']);

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// A rough phonetic skeleton: ph→f, drop non-leading vowels, collapse doubles.
// Lets "filipinos" and "philippians" land on the same key ("flpns") so heavy
// ASR mishears still resolve when raw edit distance is too large.
function skeleton(w) {
  const s = String(w).toLowerCase().replace(/ph/g, 'f').replace(/[^a-z]/g, '');
  if (!s) return '';
  return (s[0] + s.slice(1).replace(/[aeiou]/g, '')).replace(/(.)\1+/g, '$1');
}

// Fuzzy book match for a single mis-heard word (e.g. "philippines", "filipinos").
// First a tight Levenshtein pass against full names / last words, then a phonetic
// skeleton pass for bigger mishears. Comparison targets include the last word of
// multi-word names ("corinthians", "thessalonians").
function fuzzyBook(word) {
  if (!word || word.length < 4) return null;
  const targets = (b) => [b.name.toLowerCase(), b.name.toLowerCase().split(' ').pop()];

  let best = null, bestDist = Infinity;
  for (const b of BOOKS) for (const cand of targets(b)) {
    const d = levenshtein(word, cand);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  if (bestDist <= (word.length >= 7 ? 2 : 1)) return best;

  const sk = skeleton(word);
  if (sk.length >= 3) {
    let pBest = null, pDist = Infinity;
    for (const b of BOOKS) for (const cand of targets(b)) {
      const d = levenshtein(sk, skeleton(cand));
      if (d < pDist) { pDist = d; pBest = b; }
    }
    if (pDist <= 1) return pBest;
  }
  return null;
}

const isNum = (t) => /^\d+$/.test(t);
// A numeric token, possibly already in "ch:verse" or "ch:verse-end" form.
const parseNumToken = (t) => {
  const m = /^(\d+)(?::(\d+))?(?:-(\d+))?$/.exec(t);
  if (!m) return null;
  return { n: +m[1], v: m[2] != null ? +m[2] : null, e: m[3] != null ? +m[3] : null };
};

// Try to match a book starting at token index i. Returns
// { book, nextIdx, source: 'name'|'abbrev'|'fuzzy', short } or null. Prefers the
// longest span (so "song of solomon" beats "song").
function matchBookAt(tokens, i) {
  let best = null;
  const consider = (raw, span, source) => {
    const book = source === 'fuzzy' ? fuzzyBook(raw) : lookupBook(raw);
    if (!book) return;
    if (!best || span > best.span) {
      best = { book, span, source, short: raw.replace(/\s+/g, '').length <= 2 };
    }
  };
  // Optional leading 1/2/3 ordinal already digitized ("1 corinthians", "2 john").
  const numPrefix = /^[123]$/.test(tokens[i]);
  for (let len = 3; len >= 1; len--) {
    const end = i + len;
    if (end > tokens.length) continue;
    const raw = tokens.slice(i, end).join(' ');
    if (/\d/.test(raw) && !numPrefix) continue;          // names don't contain digits…
    if (numPrefix && len === 1) continue;                // "1" alone isn't a book
    consider(raw, len, lookupBook(raw) ? 'name' : null); // exact (name or abbrev)
  }
  if (!best) {
    // Fuzzy: single word, or number-prefixed single word.
    consider(tokens[i], 1, 'fuzzy');
    if (numPrefix && i + 1 < tokens.length) consider(`${tokens[i]} ${tokens[i + 1]}`, 2, 'fuzzy');
  }
  if (!best) return null;
  // Tag exact matches as name vs abbrev for scoring.
  if (best.source === 'name') {
    const raw = tokens.slice(i, i + best.span).join(' ');
    best.source = raw.length >= 4 ? 'name' : 'abbrev';
  }
  return { book: best.book, nextIdx: i + best.span, source: best.source, short: best.short };
}

// Parse chapter[:verse[-end]] beginning at index i. Tolerates "chapter"/"verse"
// keyword cues and the bare two-number form ("john 3 16" → 3:16).
function parseNumbers(tokens, i, singleChapter = false) {
  let idx = i;
  let hadChapterKw = false, hadVerseCue = false;
  if (tokens[idx] === 'chapter') { hadChapterKw = true; idx++; }

  // Single-chapter book with no explicit chapter: the number(s) are the verse,
  // chapter is implicitly 1. ("jude 9" → 1:9, "philemon verse 6" → 1:6.)
  if (singleChapter && !hadChapterKw) {
    if (VERSE_KEYWORDS.has(tokens[idx])) { hadVerseCue = true; idx++; }
    const vt = parseNumToken(tokens[idx] || '');
    if (!vt) return null;
    idx++;
    let vStart = vt.n, vEnd = vt.e;
    if (vEnd == null && RANGE_WORDS.has(tokens[idx])) {
      const et = parseNumToken(tokens[idx + 1] || '');
      if (et) { vEnd = et.n; idx += 2; }
    }
    return { chapter: 1, vStart, vEnd, nextIdx: idx, hadChapterKw, hadVerseCue: true };
  }

  const first = parseNumToken(tokens[idx] || '');
  if (!first) return null;
  idx++;
  let chapter = first.n, vStart = first.v, vEnd = first.e;
  if (first.v != null) hadVerseCue = true;

  if (vStart == null) {
    // Optional explicit verse cue.
    if (VERSE_KEYWORDS.has(tokens[idx])) { hadVerseCue = true; idx++; }
    const vt = parseNumToken(tokens[idx] || '');
    if (vt && vt.v == null) { vStart = vt.n; vEnd = vt.e; idx++; }
  }
  if (vStart != null && vEnd == null) {
    // Range: "4 to 6" / "4 through 6" (hyphen form already captured in the token).
    if (RANGE_WORDS.has(tokens[idx])) {
      const et = parseNumToken(tokens[idx + 1] || '');
      if (et) { vEnd = et.n; idx += 2; }
    }
  }
  return { chapter, vStart, vEnd, nextIdx: idx, hadChapterKw, hadVerseCue };
}

function scoreConfidence({ source, short, nums }) {
  let c = 0.6;
  if (source === 'name') c += 0.2;
  if (source === 'fuzzy') c -= 0.2;
  const hadCue = nums.hadChapterKw || nums.hadVerseCue;
  if (hadCue) c += 0.2;
  if (nums.vStart != null) c += 0.1;
  if (short && !hadCue) c -= 0.4;      // bare "am 3" etc.
  return Math.max(0, Math.min(1, c));
}

function buildRefString(book, nums) {
  const base = `${book.name} ${nums.chapter}`;
  if (nums.vStart == null) return base;
  if (nums.vEnd != null && nums.vEnd !== nums.vStart) return `${base}:${nums.vStart}-${nums.vEnd}`;
  return `${base}:${nums.vStart}`;
}

// Parse all references in a transcript fragment. Returns an array (usually 0–1)
// of { ref, bookNum, bookName, chapter, vStart, vEnd, confidence, source }.
export function parseReferences(rawText) {
  const norm = wordsToNumbers(rawText);
  const tokens = norm.split(/\s+/).filter(Boolean);
  const results = [];
  let i = 0;
  while (i < tokens.length) {
    const bm = matchBookAt(tokens, i);
    if (!bm) { i++; continue; }
    const nums = parseNumbers(tokens, bm.nextIdx, SINGLE_CHAPTER.has(bm.book.num));
    if (!nums) { i = bm.nextIdx; continue; }
    // Reject ambiguous short abbrevs unless an explicit cue backs them.
    const cued = nums.hadChapterKw || nums.hadVerseCue;
    const rawTok = tokens.slice(i, bm.nextIdx).join('');
    if (AMBIGUOUS_SHORT.has(rawTok) && !cued) { i = bm.nextIdx; continue; }

    results.push({
      ref: buildRefString(bm.book, nums),
      bookNum: bm.book.num,
      bookName: bm.book.name,
      chapter: nums.chapter,
      vStart: nums.vStart,
      vEnd: nums.vEnd,
      confidence: scoreConfidence({ source: bm.source, short: bm.short, nums }),
      source: bm.source,
    });
    i = nums.nextIdx;
  }
  return results;
}

// Convenience: the single best (highest-confidence, latest) reference, or null.
export function bestReference(rawText) {
  const all = parseReferences(rawText);
  if (!all.length) return null;
  return all.reduce((a, b) => (b.confidence >= a.confidence ? b : a));
}
