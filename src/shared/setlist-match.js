// Set list → library songs. Pure: the library is injected (see matchSetList), so
// main (db/songs.js, SQLite + FTS5) and the unit tests share every line of logic.
//
// What operators actually paste is rarely a clean column of titles:
//
//   PRAISE (fast)                       ← segment header, not a song
//   1. Way Maker - Mary (Key: E)        ← title + leader + key
//   Goodness of God                     ← no number, no blank line between
//   Imela x2
//
//   WORSHIP:
//   As the deer panteth for the water   ← first LYRIC line, not the title
//   So my soul longeth after thee
//   Verse 2 — Ada                       ← choir lyrics with singer names
//   …
//
// The old matcher treated every blank-line BLOCK as one song, so a list grouped
// under "Praise / Worship / Offering" collapsed to one entry per group (13 songs →
// 3), and a pasted song whose verses were blank-line separated became several
// entries. Here segmentation starts at the finest safe grain (lines), marks each
// boundary HARD (a list number, a segment header) or SOFT, and lets LIBRARY
// EVIDENCE decide soft boundaries: two units that hit the same song, or a line
// that continues the previous unit's song lyrics, merge; a line with its own
// confident match splits. Only then is each final entry matched with its full text.

import { parseHeaderLine, isDirectiveLine, parseLyrics } from './lyrics-parse.js';

// ── Text normalisation (shared with db/songs.js search()) ────────────────────

export function norm(s) {
  // Apostrophes are STRIPPED first (not spaced) so "God's" → "gods" and matches an
  // input that dropped the apostrophe. Then punctuation → spaces, runs collapsed
  // (incl. NBSP / word-joiners pasted lists are full of).
  return String(s || '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’‘ʼ´`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Function words that say nothing about WHICH song this is.
export const STOP = new Set((
  'the a an and or of to in on at is are was were be been am i you he she it we they ' +
  'my your his her our their me him us them this that these those there here for with ' +
  'as so but if then than oh yeah na la will shall would could unto thee thy thou o ' +
  'into onto from by up down out all not no yes do does did have has had'
).split(' '));

export function words(s) { return norm(s).split(' ').filter(Boolean); }
export function distinctive(s) { return words(s).filter((w) => w.length >= 3 && !STOP.has(w)); }

// Safe FTS5 MATCH expression: distinctive prefix tokens OR'd, capped.
export function ftsQuery(text) {
  let toks = [...new Set(distinctive(text))];
  if (!toks.length) toks = [...new Set(words(text))];
  if (!toks.length) return '';
  return toks.slice(0, 16).map((t) => t + '*').join(' OR ');
}

// Longest contiguous run of snippet words appearing verbatim in the song text.
export function longestPhrase(query, songNorm) {
  const qw = words(query);
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

// Rank FTS hits by phrase + coverage against full lyrics. `rows` are per-section
// hits { id, title, author, bm }; `textOf(id)` returns the song's lyric text.
export function rankByOverlap(query, label, rows, textOf) {
  const bySong = new Map();
  for (const r of rows) { const p = bySong.get(r.id); if (!p || r.bm < p.bm) bySong.set(r.id, r); }
  const top = [...bySong.values()].sort((a, b) => a.bm - b.bm).slice(0, 8);
  const qWords = new Set(distinctive(query || label));
  const qTitleWords = new Set(distinctive(label));
  const scored = top.map((r) => {
    const songNorm = norm(`${r.title}\n${textOf(r.id)}`);
    const songWords = new Set(songNorm.split(' ').filter(Boolean));
    const cov = qWords.size ? [...qWords].filter((w) => songWords.has(w)).length / qWords.size : 0;
    const titleCov = qTitleWords.size ? [...qTitleWords].filter((w) => songWords.has(w)).length / qTitleWords.size : 0;
    const phrase = longestPhrase(query || label, songNorm);
    const score = Math.max(cov, titleCov) + (phrase >= 4 ? 0.4 : phrase >= 3 ? 0.25 : phrase >= 2 ? 0.1 : 0);
    return { id: r.id, title: r.title, author: r.author, cov, titleCov, phrase, score };
  });
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  return scored;
}

// ── Line cleaning ─────────────────────────────────────────────────────────────

const ZW = /[​-‍⁠﻿]/g;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

// Set-list segment labels ("Worship", "Praise Session", "Offertory hymn"). A line
// made only of these words (plus dates/times/numbers/fillers) captions a group.
const SEGMENT_WORDS = new Set((
  'worship praise praises adoration offering offertory communion altar call prayer prayers intercession ' +
  'thanksgiving consecration dedication sermon message preaching announcements welcome opening closing ' +
  'benediction recessional processional fast slow medium mid tempo uptempo song songs hymn hymns medley ' +
  'special ministration ministrations choir session sessions segment set setlist list order service ' +
  'morning evening night vigil sunday saturday monday tuesday wednesday thursday friday first second third ' +
  'main youth children kids congregational response responsive introit doxology anthem solo selection ' +
  'selections before after during the of for and & time section part devotion devotional lead leader ' +
  'leading led by worship-leader team band rehearsal practice today tonight week this next'
).split(/\s+/));
const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*$/;

export function isSegmentHeader(line) {
  const rawT = stripListMarker(line).trim();
  // "Hymn 47" is a hymn reference; "Hymn 1:" (with a colon) is a slot label.
  if (hymnKey(rawT) && !/:\s*$/.test(rawT)) return false;
  // Who's leading rides along in brackets: "PRAISE SESSION (Bro. Mike)".
  const t = norm(rawT.replace(/\s*[(\[][^)\]]*[)\]]\s*/g, ' ').replace(/\s*[:\-–—]\s*$/, ''));
  if (!t) return false;
  const ws = t.split(' ');
  if (ws.length > 8) return false;
  let segmentWords = 0;
  for (const w of ws) {
    if (SEGMENT_WORDS.has(w)) { segmentWords++; continue; }
    if (/^\d+(st|nd|rd|th)?$/.test(w) || MONTHS.test(w) || /^(am|pm|mins?|minutes?)$/.test(w)) continue;
    return false;
  }
  // "Hymn" alone or "Song 3" is a slot label; needs at least one real segment word.
  return segmentWords > 0;
}

// "Opening hymn: Great Is Thy Faithfulness" → the title after the label.
function splitSegmentPrefix(line) {
  const m = /^(.{2,40}?)\s*[:–—]\s*(\S.*)$|^(.{2,40}?)\s+-\s+(\S.*)$/.exec(line);
  if (!m) return null;
  const head = m[1] ?? m[3];
  const tail = m[2] ?? m[4];
  return isSegmentHeader(head) && !isSegmentHeader(tail) ? tail : null;
}

// Leading list markers: "1.", "1)", "(1)", "#1", "1 -", "1:", "Song 1:", "•", "-", "*".
const LIST_MARKER_RE = /^\s*(?:(?:song|no\.?|number|item|hymn)\s*)?(?:[#(\[]?\s*\d{1,3}\s*[.):\]\-–—]|#\s*\d{1,3}\b|[•▪►➤◆●○◦·▶→⁃]|[-–—*+](?=\s))\s*/i;
function stripListMarker(line) {
  return String(line || '').replace(LIST_MARKER_RE, '');
}
// "1. Title" / "2) Title" / "#3 Title" / "Song 4: Title" — counts as a hard entry start.
const NUMBERED_RE = /^\s*(?:(?:song|no\.?|number|item)\s*)?(?:[#(\[]?\s*\d{1,3}\s*[.):\]\-–—]|#\s*\d{1,3}\b|\d{1,3}\s+(?=[A-Za-z])|[•▪►➤◆●○◦·▶→⁃]|[-–—*+]\s+(?=[A-Za-z0-9"“'‘]))\s*\S/i;

// Musical / logistics annotations that trail a title.
const KEY_RE = /\b(?:key(?:\s+of)?\s*[:\-]?\s*|in\s+(?=[A-G](?:#|b|♯|♭)?m?\b))[A-G](?:#|b|♯|♭)?m?(?:\s*(?:major|minor|maj|min))?\b/gi;
const BRACKETED_RE = /\s*[(\[{]([^()\[\]{}]{0,60})[)\]}]\s*/g;
const REPEAT_TAIL_RE = /\s*(?:\(?\s*(?:x\s*\d+|\d+\s*x|[*×]\s*\d+|\d+\s*times?|twice|repeat)\s*\)?)\s*$/i;
const TIME_RE = /\s*\(?\b\d{1,2}\s*(?:mins?|minutes?|m)\b\)?/gi;
const BPM_RE = /\s*\(?\b\d{2,3}\s*bpm\b\)?/gi;
const TEMPO_WORDS_RE = /\s*\(?\b(?:fast|slow|medium|uptempo|up-tempo|mid[-\s]?tempo|acoustic|acapella|a cappella|instrumental|medley)\b\)?\s*$/i;

// Clean one pasted line into a title query + alternative readings to try.
// Never throws; returns { text, variants[], parts[] } where parts are medley pieces.
export function cleanTitleLine(line) {
  let t = String(line || '').replace(ZW, '').replace(/ /g, ' ').replace(EMOJI, ' ').trim();
  t = stripListMarker(t).trim();
  // WhatsApp/markdown emphasis
  t = t.replace(/^[*_~]+|[*_~]+$/g, '').trim();
  t = t.replace(/^(?:title|song|hymn)\s*[:\-–]\s*/i, '');
  const seg = splitSegmentPrefix(t);
  if (seg) t = seg;
  // Quoted titles: “Way Maker” – Mary
  const q = /^["“”'‘’](.+?)["“”'‘’](?:\s|$)(.*)$/.exec(t);
  const quoted = q ? q[1].trim() : null;

  const variants = [];
  const push = (v) => {
    const c = String(v || '').replace(/\s+/g, ' ').replace(/^[\s\-–—:|,.]+|[\s\-–—:|,]+$/g, '').trim();
    if (c && norm(c) && !variants.some((x) => norm(x) === norm(c))) variants.push(c);
  };
  if (quoted) push(quoted);

  let base = t
    .replace(KEY_RE, ' ')
    .replace(BPM_RE, ' ')
    .replace(TIME_RE, ' ');
  for (let i = 0; i < 3; i++) base = base.replace(REPEAT_TAIL_RE, '').replace(TEMPO_WORDS_RE, '');
  base = base.replace(/\s+/g, ' ').trim();
  const noBrackets = base.replace(BRACKETED_RE, ' ').replace(/\s+/g, ' ').trim();

  // "Title - Leader", "Leader - Title", "Title by Artist", "Title | Artist", "Title — led by Mary".
  const ledBy = noBrackets.replace(/\s*[-–—,:|]?\s*(?:led|lead|sung|sang|ministered)\s+by\s+.*$/i, '').trim();
  const pieces = ledBy.split(/\s+[-–—|]\s+|\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
  const byM = /^(.*\S)\s+by\s+([A-Z][\p{L}'’.\-]*(?:\s+[A-Z&][\p{L}'’.\-]*){0,3})$/u.exec(ledBy);

  if (ledBy !== noBrackets) push(ledBy);
  push(noBrackets);
  if (byM) push(byM[1]);
  if (pieces.length > 1) { push(pieces[0]); push(pieces[pieces.length - 1]); pieces.slice(1, -1).forEach(push); }
  push(base);         // keep bracket content: "Imela (Thank You)" is often the real title
  push(t);

  // Medleys: "Way Maker / Goodness of God", "Medley: A + B", "A & B (medley)".
  let parts = [];
  const medleyText = noBrackets.replace(/^medley\s*[:\-–]\s*/i, '');
  if (/\s+\/\s+|\s+\+\s+|\s*;\s*/.test(medleyText) || /^medley\b/i.test(t) || /\bmedley\b/i.test(line)) {
    parts = medleyText.split(/\s+\/\s+|\s+\+\s+|\s*;\s*|\s+&\s+|\s*,\s*/).map((p) => p.trim()).filter((p) => norm(p).length >= 3);
    if (parts.length < 2) parts = [];
  }
  return { text: variants[0] || t, variants, parts };
}

// A line shaped like a title (short, not mid-sentence) vs a lyric line.
export function isTitleShaped(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  const ws = words(t);
  if (ws.length === 0 || ws.length > 8) return false;
  if (/[,;]\s*$/.test(t)) return false;
  if (/^[a-z]/.test(stripListMarker(t).trim())) return false; // lyrics often continue lowercase
  return true;
}

// Stricter: a short line that would make sense as a whole title (≤ 6 words).
function isTitleShapedStrict(line) {
  return isTitleShaped(line) && words(stripListMarker(line)).length <= 6;
}

// ── Segmentation ─────────────────────────────────────────────────────────────

// Turn raw paste into UNITS: [{ lines[], boundary: 'hard'|'gap'|'line', lyricMode }].
// boundary describes the edge BEFORE the unit: 'hard' (list number / segment
// header / first unit), 'gap' (blank line), 'line' (adjacent line, no blank).
export function segmentSetList(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  const numberedCount = lines.filter((l) => NUMBERED_RE.test(l.replace(ZW, ''))).length;
  const numbered = numberedCount >= 2;

  // Learn singer names from annotated section headers so "Mary:" lines drop too.
  const names = new Set();
  for (const l of lines) { const h = parseHeaderLine(l); if (h) h.names.forEach((n) => names.add(n.toLowerCase())); }

  const units = [];
  let cur = null;
  let gap = false;
  let nextHard = true;
  let lineNo = 0;
  const open = (boundary, first) => {
    cur = { lines: first != null ? [first] : [], boundary: nextHard ? 'hard' : boundary, lyricMode: false, numbered: false, start: lineNo };
    units.push(cur);
    nextHard = false;
  };

  for (let i = 0; i < lines.length; i++) {
    lineNo = i;
    const rawLine = lines[i].replace(ZW, '').replace(/ /g, ' ');
    const t = rawLine.trim();
    if (!t) { gap = true; continue; }

    // Section headers ("Verse 1 — Mary", "*Chorus*") put us inside a song's lyrics.
    const h = parseHeaderLine(t);
    if (h && !NUMBERED_RE.test(t)) {
      if (!cur || (gap && !cur.lyricMode && !cur.lines.length)) open('gap');
      cur.lyricMode = true;
      if (h.tail) cur.lines.push(h.tail);
      gap = false;
      continue;
    }
    if (isDirectiveLine(t, names) && !NUMBERED_RE.test(t)) continue;

    // "Worship", "PRAISE SESSION:", "Sunday 26th Oct" — hard separator, never a song.
    if (isSegmentHeader(t) && !NUMBERED_RE.test(t)) {
      nextHard = true; gap = false;
      cur = null;
      continue;
    }

    if (NUMBERED_RE.test(t)) {
      // A list number starts an entry — but hymn stanzas are numbered too ("1. …",
      // "2. …"), so it's a 'number' edge: merged back only when the library says
      // it's the same song.
      open('number', t);
      if (cur.boundary !== 'hard') cur.boundary = 'number';
      cur.numbered = true;
      gap = false;
      continue;
    }

    if (!cur) { open(gap ? 'gap' : 'line', t); gap = false; continue; }

    if (cur.lyricMode) {
      // Inside a pasted song: everything continues it, unless a blank line is
      // followed by a title-shaped line that itself opens a new song (the next line
      // is a section header, or a numbered list's next title).
      const nextLine = (lines.slice(i + 1).find((l) => l.trim()) || '').trim();
      const nextIsHeader = !!parseHeaderLine(nextLine) && !NUMBERED_RE.test(nextLine);
      if (gap && isTitleShaped(t) && (nextIsHeader || !numbered)) { open('gap', t); if (nextIsHeader) cur.boundary = cur.boundary === 'hard' ? 'hard' : 'title'; }
      else cur.lines.push(t);
      gap = false;
      continue;
    }

    if (numbered && cur.numbered && !gap) {
      // "1. Way Maker" then an un-numbered lyric/subtitle line → same entry.
      cur.lines.push(t);
      continue;
    }

    open(gap ? 'gap' : 'line', t);
    gap = false;
  }
  // Each unit's raw source span (headers, blank lines and all) — what "create this
  // song" re-parses, since the segmenter consumed the section headers.
  const kept = units.filter((u) => u.lines.length || u.lyricMode);
  kept.forEach((u, k) => {
    const end = k + 1 < kept.length ? kept[k + 1].start : lines.length;
    u.source = lines.slice(u.start, end).join('\n').replace(/\n+$/, '');
  });
  return kept.map((u) => ({ ...u, names }));
}

// ── Library index + matching ─────────────────────────────────────────────────

function trigrams(s) {
  const t = `  ${s} `;
  const out = new Set();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}
function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const g of a) if (b.has(g)) n++;
  return (2 * n) / (a.size + b.size);
}

// Title forms a library song answers to: "GHS 12 - Blessed Assurance" answers to
// "blessed assurance", "ghs 12", "hymn 12"; "Imela (Thank You)" to "imela" too.
function titleKeys(title) {
  const keys = new Set();
  const n = norm(title);
  if (n) keys.add(n);
  const ghs = /^\s*(ghs|mhb|ss&s|sss|hymn|h)\s*#?\s*(\d{1,4})\s*(?:[-–—:.]\s*)?(.*)$/i.exec(title || '');
  if (ghs) {
    if (ghs[3]) keys.add(norm(ghs[3]));
    keys.add(`${norm(ghs[1])} ${ghs[2]}`);
  }
  const noParen = norm(String(title || '').replace(/\s*[(\[][^)\]]*[)\]]\s*/g, ' '));
  if (noParen) keys.add(noParen);
  const paren = /[(\[]([^)\]]+)[)\]]/.exec(title || '');
  if (paren && norm(paren[1]).split(' ').length >= 2) keys.add(norm(paren[1]));
  return [...keys].filter(Boolean);
}

// Build the in-memory title / first-line index once per paste.
// songs: [{ id, title, author, firstLines: string[] }]
export function buildIndex(songs) {
  const byKey = new Map();         // normalised title key → [song]
  const byFirstLine = new Map();   // normalised first line → [song]
  const entries = [];              // { song, key, grams, kind: 'title'|'line' }
  const add = (map, k, s) => { const a = map.get(k); if (a) { if (!a.includes(s)) a.push(s); } else map.set(k, [s]); };
  for (const s of songs) {
    for (const k of titleKeys(s.title)) { add(byKey, k, s); entries.push({ song: s, key: k, grams: trigrams(k), kind: 'title' }); }
    for (const fl of s.firstLines || []) {
      const k = norm(fl);
      if (k.split(' ').length < 3) continue;
      add(byFirstLine, k, s);
      entries.push({ song: s, key: k, grams: trigrams(k), kind: 'line' });
    }
  }
  return { byKey, byFirstLine, entries, songs };
}

const slim = (s) => (s ? { id: s.id, title: s.title, author: s.author ?? null } : null);
const RANK = { exact: 3, high: 2, low: 1, none: 0 };

// Hymn-number references: "GHS 12", "Hymn 12", "H12", "MHB 45".
function hymnKey(text) {
  const m = /^\s*(ghs|mhb|ss&s|sss|hymn|h)\s*(?:no\.?|number|#)?\s*(\d{1,4})\b/i.exec(text || '');
  return m ? `${norm(m[1])} ${m[2]}` : null;
}

// Title-ish lookup for one short line: exact title → hymn number → first line →
// fuzzy title/first-line. Returns { song, confidence, score, via } | null.
function lookupTitle(variants, index) {
  for (const v of variants) {
    const hk = hymnKey(v);
    if (hk) {
      const hit = index.byKey.get(hk) || (hk.startsWith('hymn ') || hk.startsWith('h ') ? index.byKey.get(`ghs ${hk.split(' ')[1]}`) : null);
      if (hit && hit.length) return { song: hit[0], others: hit.slice(1), confidence: 'exact', score: 2, via: 'number', variant: v };
    }
  }
  for (const v of variants) {
    const k = norm(v);
    const hit = index.byKey.get(k);
    if (hit && hit.length) return { song: hit[0], others: hit.slice(1), confidence: 'exact', score: 2, via: 'title', variant: v };
  }
  for (const v of variants) {
    const k = norm(v);
    if (k.split(' ').length < 3) continue;
    const hit = index.byFirstLine.get(k);
    if (hit && hit.length) return { song: hit[0], others: hit.slice(1), confidence: 'high', score: 1.6, via: 'firstline', variant: v };
  }
  // Fuzzy: trigram Dice against every title key / first line. Typos ("Goodnes of
  // God"), dropped words ("Great is thy faithfulness lord").
  // Best score per SONG (a title hit edges out an equal first-line hit), then the
  // margin to the runner-up song decides how sure we are.
  const perSong = new Map();
  for (const v of variants.slice(0, 4)) {
    const k = norm(v);
    if (k.length < 4) continue;
    const g = trigrams(k);
    for (const e of index.entries) {
      let d = dice(g, e.grams);
      // A query that is a long-enough prefix of a first line ("As the deer panteth") counts.
      if (e.kind === 'line' && k.split(' ').length >= 4 && e.key.startsWith(k)) d = Math.max(d, 0.9);
      if (e.kind === 'title') d += 0.02;
      const p = perSong.get(e.song.id);
      if (!p || d > p.d) perSong.set(e.song.id, { d, song: e.song, kind: e.kind, variant: v });
    }
  }
  const ranked = [...perSong.values()].sort((a, b) => b.d - a.d);
  const best = ranked[0];
  const second = ranked[1];
  if (!best) return null;
  const margin = best.d - (second ? second.d : 0);
  const others = ranked.slice(1, 3).filter((r) => r.d >= 0.6).map((r) => r.song);
  if (best.d >= 0.86 && margin >= 0.04) return { song: best.song, others, confidence: 'high', score: 1.2 + best.d / 2, via: 'fuzzy', variant: best.variant, kind: best.kind };
  if (best.d >= 0.72) return { song: best.song, others, confidence: 'low', score: best.d, via: 'fuzzy', variant: best.variant, kind: best.kind };
  return null;
}

// Full-text tier: FTS recall + phrase/coverage rank (the historic lyric matcher).
function lookupText(query, label, lib) {
  const expr = ftsQuery(query || label);
  if (!expr) return null;
  let rows = [];
  try { rows = lib.fts(expr) || []; } catch { rows = []; }
  if (!rows.length) return null;
  const scored = rankByOverlap(query || label, label, rows, lib.textOf);
  const top = scored[0];
  if (!top) return null;
  const second = scored[1];
  const margin = second ? top.score - second.score : top.score;
  let confidence;
  if (top.phrase >= 4 || top.cov >= 0.7 || top.titleCov >= 0.85) confidence = 'high';
  else if (top.phrase >= 2 || top.cov >= 0.35 || top.titleCov >= 0.5) confidence = 'low';
  else confidence = 'none';
  if (confidence === 'high' && top.phrase < 4 && margin < 0.08) confidence = 'low';
  return { song: top, others: scored.slice(1, 4), confidence, score: top.score, scored, via: 'lyrics' };
}

// Match one unit of text. `titleLine` is the line treated as a title (may be null
// for a lyric-only snippet); `query` is everything.
function matchUnit(titleLine, query, lib) {
  const cleaned = titleLine ? cleanTitleLine(titleLine) : { text: '', variants: [], parts: [] };
  const t = cleaned.variants.length ? lookupTitle(cleaned.variants, lib.index) : null;
  const queryClean = query || cleaned.text;
  const x = queryClean ? lookupText(queryClean, cleaned.text || queryClean, lib) : null;
  let best = t;
  if (x && x.confidence !== 'none' && (!best || RANK[x.confidence] > RANK[best.confidence]
      || (RANK[x.confidence] === RANK[best.confidence] && best.via === 'fuzzy' && x.song.phrase >= 3 && !(best.kind === 'title' && best.score >= 0.9)))) best = x;
  // Several pasted lyric lines that share no phrase with the song (only scattered
  // common words — "good", "valley") is a song we don't have, not a fuzzy match.
  if (best && best.via === 'lyrics' && best.confidence === 'low' && best.song.phrase < 3 && words(queryClean).length >= 8) best = null;
  // A title hit corroborated by the lyrics is beyond doubt.
  if (t && x && x.song && t.song.id === x.song.id && t.confidence === 'low' && x.confidence !== 'none') best = { ...t, confidence: 'high' };
  const altPool = [...(best?.others || []), ...((x?.scored || []).map((s) => s))];
  const seen = new Set(best ? [best.song.id] : []);
  const alternates = [];
  for (const s of altPool) { if (!s || seen.has(s.id)) continue; seen.add(s.id); alternates.push(slim(s)); if (alternates.length >= 3) break; }
  if (!best || best.confidence === 'none') {
    return { match: null, confidence: 'none', alternates: (x?.scored || []).slice(0, 3).map(slim), cleaned, score: 0, via: null };
  }
  return { match: slim(best.song), confidence: best.confidence, alternates, cleaned, score: best.score, via: best.via, variant: best.variant || null };
}

// Is `line` a continuation of song `songId`'s lyrics (it appears in them)?
function continues(line, songId, lib) {
  if (!songId) return false;
  const songNorm = norm(`${lib.titleOf ? lib.titleOf(songId) : ''}\n${lib.textOf(songId)}`);
  const ws = words(line);
  if (!ws.length) return false;
  const phrase = longestPhrase(line, songNorm);
  if (phrase >= Math.min(4, ws.length) && phrase >= 2) return true;
  const d = distinctive(line);
  if (d.length >= 2) {
    const sw = new Set(songNorm.split(' '));
    return d.filter((w) => sw.has(w)).length / d.length >= 0.75;
  }
  return false;
}

// Main entry. lib = {
//   songs: [{ id, title, author, firstLines[] }],   // whole library, for the title index
//   fts(expr) → [{ id, title, author, bm }],        // FTS5 MATCH over title+lyrics
//   textOf(id) → string,                            // all lyric text of a song
// }
// Returns rows: [{ input, query, lines, lyrics, match, alternates, confidence,
//                  duplicateOf, title }]
export function matchSetList(raw, lib) {
  const index = lib.index || buildIndex(lib.songs || []);
  const L = { ...lib, index, titleOf: (id) => (index.songs.find((s) => s.id === id)?.title || '') };
  const units = segmentSetList(raw);

  // 1. Match each unit on its own (lyric-mode units use their whole text).
  const unitMatches = units.map((u) => {
    const first = u.lines[0] || '';
    const titleLine = u.lyricMode && !isTitleShaped(first) ? null : first;
    return matchUnit(titleLine, u.lines.join('\n'), L);
  });

  // 2. Resolve soft boundaries with library evidence → groups of units.
  const groups = [];
  units.forEach((u, i) => {
    const m = unitMatches[i];
    const prev = groups[groups.length - 1];
    if (!prev || u.boundary === 'hard') { groups.push({ units: [u], matches: [m] }); return; }
    const pm = prev.matches[0];
    const prevSong = pm.match?.id;
    const prevLyric = prev.units.some((x) => x.lyricMode);
    const text = u.lines.join(' ');
    // A numbered line that is a stanza of the previous song (hymn "2. Summer and
    // winter…") rejoins it; it must read as lyric, not as the next title.
    const lyricContinuation = prevSong && !isTitleShapedStrict(u.lines[0]) && continues(text, prevSong, L);
    let merge;
    if (u.boundary === 'number' || u.boundary === 'title') merge = !!(prevSong && (m.match?.id === prevSong && m.via === 'lyrics' && !isTitleShapedStrict(u.lines[0]) || lyricContinuation));
    else if (prevSong && m.match?.id === prevSong) merge = true;                    // same song
    else if (prevSong && continues(text, prevSong, L)) merge = true;                // lyric under its title
    else if (m.confidence === 'exact' || m.confidence === 'high') merge = false;    // its own song
    else if (u.lyricMode) merge = false;                                            // a new pasted song
    else if (u.boundary === 'line' && (!isTitleShaped(u.lines[0]) || !isTitleShaped(prev.units[prev.units.length - 1].lines.slice(-1)[0]))) merge = true; // lyric run
    else if (u.boundary === 'gap' && prevLyric && !isTitleShaped(u.lines[0])) merge = true;
    else merge = false;                                                             // list of (unknown) titles
    if (merge) { prev.units.push(u); prev.matches.push(m); }
    else groups.push({ units: [u], matches: [m] });
  });

  // 3. Final match per group (medley lines expand to one row per part).
  const rows = [];
  for (const g of groups) {
    const lines = g.units.flatMap((u) => u.lines);
    const lyrics = g.units.some((u) => u.lyricMode) || lines.length > 2;
    const first = lines[0] || '';
    const titleLine = isTitleShaped(first) || !lyrics ? first : null;
    const query = lines.join('\n');
    let m = g.units.length === 1 ? g.matches[0] : matchUnit(titleLine, query, L);
    // Keep the confident first-unit title hit if the merged text muddied it.
    if (g.units.length > 1 && RANK[g.matches[0].confidence] > RANK[m.confidence]) m = g.matches[0];

    // Medley: "Way Maker / Goodness of God" → one row per part that matches a title.
    if (!lyrics && m.cleaned?.parts?.length >= 2 && m.confidence !== 'exact') {
      const partRows = m.cleaned.parts.map((p) => ({ p, r: matchUnit(p, p, L) }));
      if (partRows.filter(({ r }) => RANK[r.confidence] >= RANK.high).length >= 2) {
        for (const { p, r } of partRows) rows.push(makeRow(p, p, [p], false, r));
        continue;
      }
    }
    const label = labelFor(lines, titleLine, m, g.units[0]);
    rows.push(makeRow(label, query, lines, lyrics, m, g.units.map((u) => u.source).join('\n')));
  }

  // 4. Flag duplicates (same song twice) so the operator notices.
  const firstIdx = new Map();
  rows.forEach((r, i) => {
    if (!r.match) return;
    if (firstIdx.has(r.match.id)) r.duplicateOf = firstIdx.get(r.match.id);
    else firstIdx.set(r.match.id, i);
  });
  return rows;
}

function labelFor(lines, titleLine, m, unit) {
  const src = titleLine || lines[0] || '';
  if (m.variant) return m.variant;
  const cleaned = m.cleaned?.variants?.length ? m.cleaned : cleanTitleLine(src);
  return (cleaned.variants[0] || stripListMarker(src).trim() || src).replace(/^[^\p{L}\p{N}"'(“‘]+/u, '').trim() || (unit?.lyricMode ? 'Pasted lyrics' : src);
}

function makeRow(label, query, lines, lyrics, m, source) {
  // A not-found entry that carried lyrics: pre-parse them so "Create new song" opens
  // the editor already split into sections, titled from the paste.
  let parsed = null;
  if (!m.match && lyrics) {
    // Strip the list marker off the title line or "3. Brand New Song" reads as a
    // hymn-style numbered stanza.
    const src = (source || lines.join('\n')).replace(/^\s*\n*/, '').replace(/^[^\n]*/, (l) => stripListMarker(l));
    const p = parseLyrics(src, { detectTitle: true });
    parsed = { title: p.title || label, author: p.author, copyright: p.copyright, sections: p.sections, arrangement: p.arrangement };
  }
  return {
    input: parsed?.title || label,
    query,
    lines,
    lyrics,
    match: m.match,
    alternates: m.alternates || [],
    confidence: m.confidence,
    via: m.via || null,
    duplicateOf: null,
    parsed,
  };
}
