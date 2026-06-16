// Lexical verse index — fast, embedding-free localization of a VERBATIM quote.
//
// For the common case (the minister is *reading* the words), semantic embedding is
// overkill and far too slow to run on partial transcripts. The Bible is a fixed
// corpus and verses are lexically distinctive, so 3–5 content words usually pin one
// verse. This builds an in-memory inverted index over the active translation's
// ~31k verses and matches a spoken window against it in microseconds — no worker
// round-trip, cheap enough to run on every interim hypothesis.
//
// It is a REGENERABLE derived cache, same policy as the embedding blob (and
// thumbnails): held only in memory, never persisted/backed up, rebuilt whenever the
// verse count changes. content-match.js tries this FIRST and only falls back to the
// MiniLM semantic path for genuine paraphrase (see its header). Scoring is idf-
// weighted query-coverage with a runner-up margin + distinctive-overlap floor, so a
// generic phrase ("and it came to pass") can't localize a single verse.

import { getDb } from '../db/schema.js';

// Distinctive content tokens (≥4 chars, non-stopword) only — the same idea as
// content-match's lexical-anchor guard, widened. Common function words carry no
// localizing signal and would blow up the candidate set.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'unto', 'his', 'her', 'him', 'they', 'them',
  'their', 'you', 'your', 'are', 'was', 'were', 'this', 'but', 'not', 'all', 'who',
  'shall', 'will', 'have', 'has', 'had', 'from', 'into', 'out', 'about', 'which',
  'what', 'when', 'then', 'there', 'here', 'our', 'one', 'now', 'also', 'because',
  'said', 'saith', 'come', 'came', 'went', 'unto', 'upon', 'thee', 'thou', 'thine',
  'these', 'those', 'them', 'were', 'been', 'being', 'over', 'than', 'such', 'each',
]);

function tokenize(text) {
  const out = [];
  for (const t of String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (t.length >= 4 && !STOPWORDS.has(t)) out.push(t);
  }
  return out;
}

// idx = { versionId, count, verses:[{ref,bookNum,chapter,verse,tokens:Set}],
//         postings:Map<token,number[]>, df:Map<token,number>, N }
let idx = null;

function verseCount(versionId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM bible_verses WHERE version_id = ?').get(versionId)?.n ?? 0;
}

export function isBuilt(versionId) {
  return !!idx && idx.versionId === versionId && idx.count === verseCount(versionId);
}

// Build the inverted index in memory. Cheap (~one pass over the verse table); lazy
// on first match for a translation, rebuilt if the active version/verse-count moves.
export function build(versionId) {
  if (isBuilt(versionId)) return;
  const rows = getDb().prepare(
    `SELECT book_name, book_num, chapter, verse, text
       FROM bible_verses WHERE version_id = ?
       ORDER BY book_num, chapter, verse`,
  ).all(versionId);

  const verses = [];
  const postings = new Map();
  const df = new Map();
  rows.forEach((r, i) => {
    const set = new Set(tokenize(r.text));
    verses.push({
      ref: `${r.book_name} ${r.chapter}:${r.verse}`,
      bookNum: r.book_num, chapter: r.chapter, verse: r.verse, tokens: set,
    });
    for (const t of set) {
      let pl = postings.get(t);
      if (!pl) { pl = []; postings.set(t, pl); }
      pl.push(i);
      df.set(t, (df.get(t) || 0) + 1);
    }
  });
  idx = { versionId, count: rows.length, verses, postings, df, N: rows.length || 1 };
}

function idf(token) {
  const d = idx.df.get(token) || 0;
  return d > 0 ? Math.log((idx.N + 1) / (d + 0.5)) : 0;
}

// Match a spoken window against the index. Returns the same shape as
// content-match.match: { ok, method:'lexical', hit:{ref,bookNum,chapter,verse,
// versionId}, score, margin } or { ok:false, reason }. `score` is the idf-weighted
// fraction of the query's distinctive information that the matched verse covers.
export function match(versionId, text, gates = {}) {
  const minWords  = gates.lexicalMinWords  ?? 4;
  const minShared = gates.lexicalMinShared ?? 3;
  const minScore  = gates.lexicalMinScore  ?? 0.5;
  const minMargin = gates.lexicalMinMargin ?? 0.08;

  build(versionId);
  if (!isBuilt(versionId)) return { ok: false, reason: 'not-built' };

  const qTokens = [...new Set(tokenize(text))];
  if (qTokens.length < minWords) return { ok: false, reason: 'too-short' };

  const qIdf = new Map(qTokens.map((t) => [t, idf(t)]));
  const totalIdf = [...qIdf.values()].reduce((a, b) => a + b, 0);
  if (totalIdf <= 0) return { ok: false, reason: 'no-distinctive' };

  // Gather candidates from the RAREST query tokens (most localizing), skipping
  // very common ones whose posting lists would dominate. Cap the candidate set so
  // an unlucky common token can't make this O(corpus).
  const CAP = 4000;
  const common = idx.N * 0.08;
  const rarest = [...qTokens].sort((a, b) => (idx.df.get(a) || 0) - (idx.df.get(b) || 0));
  const cand = new Set();
  for (const t of rarest) {
    const pl = idx.postings.get(t);
    if (!pl || pl.length > common) continue;
    for (const i of pl) { cand.add(i); if (cand.size >= CAP) break; }
    if (cand.size >= CAP) break;
  }
  // Fallback: every query token was common — still try, just bounded.
  if (!cand.size) {
    for (const t of rarest) {
      const pl = idx.postings.get(t);
      if (pl) for (const i of pl) { cand.add(i); if (cand.size >= CAP) break; }
      if (cand.size >= CAP) break;
    }
  }
  if (!cand.size) return { ok: false, reason: 'no-candidate' };

  let best = null, second = null;
  for (const i of cand) {
    const v = idx.verses[i];
    let shared = 0, sIdf = 0;
    for (const t of qTokens) if (v.tokens.has(t)) { shared++; sIdf += qIdf.get(t); }
    if (shared < minShared) continue;
    const score = sIdf / totalIdf;
    if (!best || score > best.score) { second = best; best = { i, score, shared }; }
    else if (!second || score > second.score) { second = { i, score, shared }; }
  }
  if (!best) return { ok: false, reason: 'no-candidate' };

  const margin = best.score - (second?.score ?? 0);
  if (best.score < minScore) return { ok: false, reason: 'low-score', score: best.score, margin };
  if (margin < minMargin)    return { ok: false, reason: 'low-margin', score: best.score, margin };

  const v = idx.verses[best.i];
  return {
    ok: true, method: 'lexical', score: best.score, margin,
    hit: { ref: v.ref, bookNum: v.bookNum, chapter: v.chapter, verse: v.verse, versionId },
  };
}

export function dispose() { idx = null; }
