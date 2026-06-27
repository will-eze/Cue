// Sermon → Slides — turn a sermon document (PDF/.docx/.txt/.md) into a native
// Cue presentation: a title slide, one slide per point (heading + bullet
// sub-points), and scripture references broken out onto their own slides with the
// full verse text pulled from Cue's Bible.
//
// This file is the OFFLINE, rule-based half: text extraction (txt/md/docx) and the
// structure heuristic. Both `buildSermonStructure` and `findScriptureRefs` are pure
// (no DB, no Electron) so they unit-test in plain Node. PDF text is extracted in
// the renderer (pdfjs needs a DOM) and fed straight to buildSermonStructure via the
// generate IPC. The verse-resolve + theme + presentation build lives in
// sermon-build.js.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { BOOKS, lookupBook } from '../db/bible-books.js';

// ── Text extraction ───────────────────────────────────────────────────────────

function decodeXmlEntities(s) {
  return String(s ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

// Minimal ZIP reader (a .docx is a ZIP) using Node's built-in zlib — no new
// dependency. Walks the central directory to locate word/document.xml, inflates it
// (DEFLATE or stored), then reduces the WordprocessingML to plain text: each
// paragraph/<w:br> becomes a newline, <w:tab> a tab, everything else stripped.
function readDocxText(buf) {
  // Locate the End Of Central Directory record (signature 0x06054b50) by scanning
  // back from the end (its trailing comment is almost always empty for office files).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0x10000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .docx (no ZIP directory found).');
  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central-directory offset

  let entry = null;
  for (let n = 0; n < cdCount && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + fnLen);
    if (name === 'word/document.xml') { entry = { method, compSize, localOff }; break; }
    p += 46 + fnLen + extraLen + commentLen;
  }
  if (!entry) throw new Error('No word/document.xml inside the .docx.');

  // Local header: data begins after the (variable) filename + extra fields.
  const lo = entry.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('Corrupt .docx local header.');
  const lfn = buf.readUInt16LE(lo + 26);
  const lex = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + lfn + lex;
  const raw = buf.subarray(start, start + entry.compSize);
  const xml = (entry.method === 0 ? raw : zlib.inflateRawSync(raw)).toString('utf8');

  const text = xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(text);
}

// Extract plain text from a sermon file. PDFs are handled in the renderer (pdfjs);
// this covers the formats main can read directly.
export function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt' || ext === '.text' || ext === '.md' || ext === '.markdown') {
    return fs.readFileSync(filePath, 'utf8');
  }
  if (ext === '.docx') {
    return readDocxText(fs.readFileSync(filePath));
  }
  if (ext === '.pdf') {
    throw new Error('PDF text is extracted in the renderer; call generate with text.');
  }
  if (ext === '.doc') {
    throw new Error('Legacy .doc isn’t supported — save it as .docx, PDF, or text.');
  }
  throw new Error(`Unsupported file type: ${ext || 'unknown'}`);
}

// ── Scripture reference detection ─────────────────────────────────────────────

// One big alternation of every book name + abbreviation, longest-first so
// "Song of Solomon" wins over "Song" and "1 John" over "John". Built once.
const BOOK_ALT = (() => {
  const toks = new Set();
  for (const b of BOOKS) {
    toks.add(b.name);
    for (const a of b.abbrevs) toks.add(a);
  }
  return [...toks]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    .join('|');
})();

// Matches "John 3:16", "John 3:16-18", "1 Cor 13", "Ps. 23:1", "Rev 21:1–4".
const REF_RE = new RegExp(
  `\\b(${BOOK_ALT})\\.?\\s+(\\d{1,3})(?:\\s*[:.]\\s*(\\d{1,3})(?:\\s*[-–—]\\s*(\\d{1,3}))?)?`,
  'gi'
);

// A scripture reference sitting at the very END of a line (optionally introduced by a
// dash/colon) — used to peel the anchor ref off a main-point heading ("… SINNERS Jude 1:14-15").
const TRAILING_REF_RE = new RegExp(
  `\\s*[-–—:]?\\s*(?:${BOOK_ALT})\\.?\\s+\\d{1,3}(?:\\s*[:.]\\s*\\d{1,3}[a-z]?(?:\\s*[-–—]\\s*\\d{1,3}[a-z]?)?)?\\s*$`,
  'i'
);

// Find scripture references in `text`, de-duplicated in order of first appearance.
// Returns [{ ref, bookNum, bookName, chapter, vStart, vEnd, index }].
export function findScriptureRefs(text) {
  const out = [];
  const seen = new Set();
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text || ''))) {
    const book = lookupBook(m[1]);
    if (!book) continue;
    const chapter = parseInt(m[2], 10);
    const vStart = m[3] ? parseInt(m[3], 10) : null;
    const vEnd = m[4] ? parseInt(m[4], 10) : vStart;
    const ref = vStart == null
      ? `${book.name} ${chapter}`
      : (vEnd && vEnd !== vStart ? `${book.name} ${chapter}:${vStart}-${vEnd}` : `${book.name} ${chapter}:${vStart}`);
    const key = ref.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ref, bookNum: book.num, bookName: book.name, chapter, vStart, vEnd, index: m.index });
  }
  return out;
}

// ── Structure heuristic ───────────────────────────────────────────────────────

const BULLET_RE = /^\s*(?:[-–—*•·▪◦]|\d{1,2}[.)]|[a-z][.)]|[IVXLC]{1,4}[.)])\s+/i;

function isMarkdownHeading(line) {
  return /^\s{0,3}#{1,6}\s+\S/.test(line);
}

function isBoldOnly(line) {
  const m = /^\s*\*\*(.+?)\*\*\s*:?\s*$/.exec(line) || /^\s*__(.+?)__\s*:?\s*$/.exec(line);
  return m ? m[1].trim() : null;
}

// A "point" heading: a short, title-ish line. Numbered/roman points, a trailing
// colon, or a short Title-Case / ALL-CAPS line. Deliberately conservative so body
// prose isn't mistaken for headings.
function headingText(line) {
  const t = line.trim();
  if (!t) return null;
  if (isMarkdownHeading(line)) return t.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s*#*\s*$/, '').trim();
  const bold = isBoldOnly(line);
  if (bold) return bold;
  if (t.length > 70) return null;
  // Numbered / roman / lettered point: "1. The Cross", "II) Grace", "First,".
  const pt = /^(?:(?:point|part|step)\s+)?(?:\d{1,2}|[IVXLC]{1,4}|[A-Z])[.):]\s+(.+)$/i.exec(t);
  if (pt) return t.replace(/\s*[:]\s*$/, '');
  if (/^(first|second|third|fourth|fifth|sixth|seventh|finally|lastly|conclusion|introduction)\b[\s,:.-]/i.test(t)) return t.replace(/[,:.]$/, '');
  // Trailing-colon label (no sentence punctuation inside): "The Promise:".
  if (/:\s*$/.test(t) && !/[.!?]/.test(t.slice(0, -1))) return t.replace(/:\s*$/, '');
  // Short ALL-CAPS line (≥3 letters, not a scripture ref handled elsewhere).
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 3 && t === t.toUpperCase() && t.length <= 50) return t.replace(/[:]\s*$/, '');
  return null;
}

// Split a body blob into bullet points. Honours existing bullet markers / line
// breaks; falls back to sentence-splitting a wall-of-text paragraph.
function toBullets(lines) {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return [];
  const hasMarkers = cleaned.some((l) => BULLET_RE.test(l));
  let bullets;
  if (hasMarkers) {
    bullets = [];
    for (const l of cleaned) {
      if (BULLET_RE.test(l)) bullets.push(l.replace(BULLET_RE, '').trim());
      else if (bullets.length) bullets[bullets.length - 1] += ' ' + l; // wrapped continuation
      else bullets.push(l);
    }
  } else if (cleaned.length > 1) {
    bullets = cleaned;                                   // one line = one bullet
  } else {
    // A single paragraph — split into sentences so it isn't one giant block.
    bullets = cleaned[0].split(/(?<=[.!?])\s+(?=[A-Z“"])/).map((s) => s.trim()).filter(Boolean);
  }
  return bullets.filter((b) => b.length);
}

const MAX_BULLETS = 5;       // per point slide
const MAX_BULLET_CHARS = 160; // hard-wrap an over-long bullet onto its own slide group
const MAX_SLIDES = 150;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ── Hierarchical (outline) structure ──────────────────────────────────────────
// Many sermons (e.g. Deeper-Life Bible-study outlines) follow a strict three-tier
// shape: a TITLE, numbered MAIN POINTS ("1." / "2." …, usually ALL CAPS, each with an
// anchor reference), and parenthesised SUB-POINTS ("(i)" / "(ii)" …) that carry a
// teaching heading + a list of study references. When that shape is detected we build
// a faithful deck: a title slide, a title-styled slide per main point, a heading slide
// per sub-point (with its reference list), and a full verse slide per reference. Plain
// prose (the preacher's commentary) and the trailing boiler-plate are dropped.

const SUBPOINT_RE  = /^\s*\(\s*([ivxlcdm]{1,6}|[a-z]|\d{1,2})\s*\)\s*/i;
const MAINPOINT_RE = /^\s*(\d{1,2})\s*[.)]\s+(\S.*)$/;
// Trailing boiler-plate that isn't preaching content (quotes block, altar call, prayer,
// share links, footnote, video link). Everything from the first match on is dropped.
const FOOTER_RE = /^(?:quotes?\s+from\b|a\s+call\s+to\s+a\s+decision\b|connect\s+with\b|watch\s+the\s+gs\b|note\s*:|prayer\s+(?:of|for)\b|further\s+(?:reading|study)\b)/i;

function detectSermonTitle(lines) {
  for (let i = 0; i < Math.min(lines.length, 16); i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (MAINPOINT_RE.test(t) || SUBPOINT_RE.test(t)) break; // reached the body
    const letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length < 12 || t.length > 110) continue;
    const uppers = t.replace(/[^A-Z]/g, '').length;
    if (uppers / letters.length >= 0.8 && !findScriptureRefs(t).length) return t;
  }
  return null;
}

// The numeric tail of a reference: "14", "3:16", "5:22-24", "3:3,7", "1:14-15a" — a
// chapter, an optional verse (with letter suffix), and optional range/comma lists.
const REF_TAIL = `\\d{1,3}(?:\\s*[:.]\\s*\\d{1,3}[a-z]?(?:\\s*[-–—]\\s*\\d{1,3}[a-z]?)?(?:\\s*,\\s*\\d{1,3}[a-z]?(?:\\s*[-–—]\\s*\\d{1,3}[a-z]?)?)*)?`;

// A scripture reference written INLINE in brackets, e.g. "(Deuteronomy 33:2)",
// "(Amos 3:3,7)" or "(see Daniel 7:9-10)" — recognises a verse citation that follows a
// quoted verse.
const PAREN_REF_SRC = `\\(\\s*(?:see\\s+)?(?:${BOOK_ALT})\\.?\\s*${REF_TAIL}\\s*\\)`;
const PAREN_REF_RE = new RegExp(`^${PAREN_REF_SRC}\\.?$`, 'i');
// A verbatim quoted verse immediately followed by its bracketed reference. We drop the
// quote itself (it's the Bible text) but KEEP the reference, so it can ride on the
// commentary sentence the quote was illustrating.
const QUOTE_THEN_REF_RE = new RegExp(`[“"][^“”"]*[”"]\\s*(${PAREN_REF_SRC})`, 'gi');
// A reference anchored at the START of a string — used to consume a sub-point's leading
// reference LIST one item at a time (separated by ";").
const REFLIST_ITEM_RE = new RegExp(`^(${BOOK_ALT})\\.?\\s+(${REF_TAIL})`, 'i');

// Canonicalise a matched book + numeric tail into a display reference, normalising the
// internal spacing (and en/em dashes) so "Amos  3:3, 7" → "Amos 3:3,7".
function formatRefItem(bookTok, tail) {
  const book = lookupBook(bookTok);
  if (!book) return null;
  const t = String(tail).replace(/\s+/g, '').replace(/[–—]/g, '-');
  return `${book.name} ${t}`;
}

// Pull the leading reference LIST off a sub-point body. The list runs from the start as
// "Book c:v; Book c:v; …" and ends at the first non-reference token (the start of the
// preacher's prose, usually glued on by a ". "). Returns { refs, body }.
function consumeRefList(rest) {
  const refs = [];
  let s = String(rest || '').trim();
  while (true) {
    const m = REFLIST_ITEM_RE.exec(s);
    if (!m) break;
    const ref = formatRefItem(m[1], m[2]);
    if (!ref) break;
    refs.push(ref);
    s = s.slice(m[0].length);
    const sep = /^\s*;\s*/.exec(s);     // ";" → another ref follows
    if (sep) { s = s.slice(sep[0].length); continue; }
    break;                              // ". " / prose → the list has closed
  }
  s = s.replace(/^\s*[.;,–—-]+\s*/, '').trim();
  return { refs: dedupRefs(refs), body: s };
}

// A numbered MAIN-point marker: returns { num, rest } when a line begins with "1." / "2)"
// AND either stands alone (heading on the following line) or is followed by an ALL-CAPS-ish
// heading. Conservative so a numbered prose sentence ("1. We must pray.") isn't mistaken.
function mainMarker(line) {
  const m = /^\s*(\d{1,2})[.)]\s*(.*)$/.exec(line);
  if (!m) return null;
  const rest = m[2].trim();
  if (!rest) return { num: m[1], rest: '' };
  const core = rest.replace(TRAILING_REF_RE, '');
  const letters = core.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return null;
  const uppers = core.replace(/[^A-Z]/g, '').length;
  return uppers / letters.length >= 0.6 ? { num: m[1], rest } : null;
}

// A line that is essentially nothing but scripture reference(s) — the anchor passage that
// sits on its own line under a main-point heading ("Jude 1:14-15").
function isRefOnlyLine(t) {
  if (!findScriptureRefs(t).length) return false;
  const leftover = String(t).replace(REF_RE, '').replace(/[^A-Za-z]/g, '');
  return leftover.length <= 2;
}

// Minor words kept lower-case when softening an ALL-CAPS heading into a Title-Case subtitle.
const TITLE_MINOR = new Set(['of', 'the', 'and', 'against', 'for', 'in', 'to', 'with', 'a',
  'an', 'but', 'or', 'nor', 'on', 'at', 'by', 'from', 'as']);

// Soften an ALL-CAPS main-point heading into Title Case for the secondary subtitle line.
// Mixed-case text is left untouched (it already carries its own casing/proper nouns).
function titleCaseFromCaps(s) {
  if (!s || /[a-z]/.test(s)) return s;
  return s.toLowerCase().split(/\s+/)
    .map((w, i) => (i > 0 && TITLE_MINOR.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function dedupRefs(arr) {
  const out = [], seen = new Set();
  for (const r of arr) {
    if (!r) continue;
    const k = r.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
}

// Turn a body of sermon prose into one bullet PER SENTENCE. A verbatim quoted verse that
// is followed by its bracketed reference is collapsed to just that reference, which then
// rides on the preceding commentary sentence ("a sentence references the verse after it").
function bodyToBullets(text) {
  if (!text) return [];
  const s = String(text).replace(QUOTE_THEN_REF_RE, ' $1').replace(/\s+/g, ' ').trim();
  const parts = s.split(/(?<=[.!?])\s+(?=[“"(A-Z])/).map((x) => x.trim()).filter(Boolean);
  const bullets = [];
  for (const part of parts) {
    // A bare parenthetical reference merges onto the previous sentence's bullet (the
    // commentary the dropped quote was illustrating). With no preceding bullet it's the
    // passage citation itself (e.g. the intro's main ref) — that lives on the reference
    // line, so drop it rather than open the slide with a lone "(Jude 1:14-16)".
    if (PAREN_REF_RE.test(part)) {
      // Tidy a PDF-wrapped citation ("(Jonah 3:4- 10)" → "(Jonah 3:4-10)") and attach it.
      const ref = part.replace(/\.\s*$/, '').replace(/\s*([:,–—-])\s*/g, '$1');
      if (bullets.length) bullets[bullets.length - 1] += ' ' + ref;
      continue;
    }
    if (part.replace(/[^A-Za-z]/g, '').length < 3) continue; // skip punctuation-only crumbs
    bullets.push(part);
  }
  return bullets;
}

// Pack sentence bullets onto content slides without overflowing the box: estimate each
// bullet's rendered line count (+ a small inter-bullet gap) and start a new slide before
// it would spill. The reference line + heading are repeated on each continuation slide.
// The content box runs from ~33%→95% of a 1080-tall canvas (~670px) at 34px/1.3 line
// spacing ≈ 15 rendered lines, so the budget below stays just under that.
const CONTENT_CHARS_PER_LINE = 95;
const CONTENT_LINES_PER_SLIDE = 14;
const CONTENT_MAX_BULLETS = 11;

function chunkBullets(bullets) {
  const out = [];
  let cur = [], lines = 0;
  for (const b of bullets) {
    const cost = Math.max(1, Math.ceil(b.length / CONTENT_CHARS_PER_LINE)) + 0.3;
    if (cur.length && (lines + cost > CONTENT_LINES_PER_SLIDE || cur.length >= CONTENT_MAX_BULLETS)) {
      out.push(cur); cur = []; lines = 0;
    }
    cur.push(b); lines += cost;
  }
  if (cur.length) out.push(cur);
  return out.length ? out : [[]];
}

// Pull the teaching heading, the leading reference LIST, and the exposition bullets out of
// a sub-point body. The heading is the text before the " – "; the reference list is the run
// of refs right after it (these feed the slide's reference line); everything after is the
// preacher's exposition, rendered one bullet per sentence by bodyToBullets.
function parseSubpoint(body) {
  let heading, rest;
  const dashIdx = body.search(/\s[–—-]\s/);
  if (dashIdx >= 0) {
    heading = body.slice(0, dashIdx).trim();
    rest = body.slice(dashIdx).replace(/^\s*[–—-]\s*/, '').trim();
  } else {
    const m = body.match(/^(.{3,90}?[.!?])(?:\s|$)/);
    if (m) { heading = m[1].replace(/[.!?]+$/, '').trim(); rest = body.slice(m[0].length).trim(); }
    else { heading = body.slice(0, 90).trim(); rest = body.slice(90).trim(); }
  }

  const { refs, body: prose } = consumeRefList(rest);
  return { heading: heading || body.slice(0, 80).trim(), refs, bullets: bodyToBullets(prose) };
}

// Segment the body (everything from the first main-point marker) into main points, each
// with its heading line(s), anchor reference, point preamble (commentary between the
// heading and the first sub-point), and parenthesised sub-points. Driven by the "1." /
// "(i)" MARKERS — never by blank lines, which PDFs don't emit reliably — so a sub-point's
// PDF-wrapped lines are gathered into ONE blob before sentence-splitting (the fix for the
// "every wrapped line became its own bullet" fragmentation).
function segmentMainPoints(bodyLines) {
  const mains = [];
  let cur = null, curSub = null, mode = null;     // mode: 'mainhead' | 'preamble' | 'sub'
  const flushSub = () => { if (cur && curSub) { cur.subs.push(curSub); curSub = null; } };
  const flushMain = () => { flushSub(); if (cur) { mains.push(cur); cur = null; } };

  for (const line of bodyLines) {
    const t = line.trim();
    if (!t) continue;
    if (FOOTER_RE.test(t)) break;                 // trailing boiler-plate → stop entirely

    const mm = mainMarker(line);
    if (mm) {
      flushMain();
      cur = { num: mm.num, headingLines: mm.rest ? [mm.rest] : [], anchor: null, preamble: [], subs: [] };
      mode = 'mainhead';
      continue;
    }
    if (SUBPOINT_RE.test(t)) { flushSub(); curSub = { lines: [t] }; mode = 'sub'; continue; }
    // The anchor passage on its own line under the main heading.
    if (cur && mode === 'mainhead' && !cur.anchor && isRefOnlyLine(t)) {
      const r = findScriptureRefs(t);
      if (r.length) { cur.anchor = r[0].ref; mode = 'preamble'; continue; }
    }
    if (curSub) { curSub.lines.push(t); continue; }
    if (cur && mode === 'mainhead') { cur.headingLines.push(t); continue; } // heading wrap
    if (cur && mode === 'preamble') { cur.preamble.push(t); continue; }
    // Stray text before the first main point is handled as the intro, not here.
  }
  flushMain();
  return mains;
}

function buildHierarchical(rawText, opts = {}) {
  const norm = String(rawText || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const lines = norm.split('\n').map((l) => l.replace(/[ \t]+$/, ''));

  // The body begins at the first main-point marker ("1."); everything above is the head
  // region (series banner, title, main passage, and the introductory commentary).
  let firstMain = -1;
  for (let i = 0; i < lines.length; i++) { if (mainMarker(lines[i])) { firstMain = i; break; } }
  const headLines = firstMain >= 0 ? lines.slice(0, firstMain) : lines.slice();
  const bodyLines = firstMain >= 0 ? lines.slice(firstMain) : [];

  let title = (opts.title || '').trim() || detectSermonTitle(headLines) || '';

  // Main reference — the standalone passage line near the top that the sermon expounds.
  let mainRef = null, mainRefIdx = -1;
  for (let i = 0; i < Math.min(headLines.length, 16); i++) {
    const t = headLines[i].trim().replace(/^[“"(]+|[”")]+$/g, '');
    if (!t) continue;
    const r = findScriptureRefs(t);
    if (r.length && t.length - r[0].ref.length <= 4) { mainRef = r[0].ref; mainRefIdx = i; break; }
  }

  // Introductory commentary — head-region prose after the main-passage line (the opening
  // quote is dropped, its ref rides the first commentary sentence per the special case).
  const introBullets = mainRefIdx >= 0
    ? bodyToBullets(headLines.slice(mainRefIdx + 1).join(' '))
    : [];

  if (!title) title = 'Sermon';
  // Title slide carries the main passage as its subtitle — no standalone verse slides; the
  // deck is title → (intro) → main-point divider + sub-point content slides.
  const slides = [{ role: 'title', title, subtitle: mainRef }];

  if (opts.includeIntro !== false && introBullets.length) {
    chunkBullets(introBullets).forEach((ch, ci) => slides.push({
      role: 'heading', subtitle: null,
      title: ci === 0 ? 'Introduction' : 'Introduction (cont.)',
      caption: mainRef, bullets: ch,
    }));
  }

  for (const mp of segmentMainPoints(bodyLines)) {
    if (slides.length > MAX_SLIDES) break;
    let heading = mp.headingLines.join(' ').replace(/\s+/g, ' ').trim();
    let anchor = mp.anchor;
    // A heading that carries its anchor inline ("… AGAINST ALL Jude 1:15") rather than on
    // its own line — peel the trailing ref off.
    if (!anchor) {
      const tr = heading.match(TRAILING_REF_RE);
      if (tr) { const ar = findScriptureRefs(tr[0]); if (ar.length) { anchor = ar[0].ref; heading = heading.replace(TRAILING_REF_RE, '').trim(); } }
    }
    const subtitle = `${mp.num}. ${titleCaseFromCaps(heading)}`;

    // Main-point divider slide (faithful ALL-CAPS title) + anchor subtitle.
    slides.push({ role: 'point', title: `${mp.num}. ${heading}`, subtitle: anchor });

    // Point preamble — commentary between the heading and the first sub-point.
    const preBullets = bodyToBullets(mp.preamble.join(' '));
    if (preBullets.length) {
      chunkBullets(preBullets).forEach((ch) => slides.push({
        role: 'heading', subtitle, title: null, caption: anchor, bullets: ch,
      }));
    }

    // Sub-points → content slides: parent point (subtitle) on top, the "(i)" heading below
    // it, the reference line (anchor + the sub-point's refs), then one-sentence-per bullets.
    for (const sub of mp.subs) {
      if (slides.length > MAX_SLIDES) break;
      const subText = sub.lines.join(' ').replace(/\s+/g, ' ').trim();
      const mk = subText.match(SUBPOINT_RE);
      const marker = mk && mk[1] ? `(${mk[1].toLowerCase()})` : null;
      const parsed = parseSubpoint(subText.replace(SUBPOINT_RE, '').trim());
      const refLine = dedupRefs([anchor, ...parsed.refs]).join('   ·   ') || null;
      chunkBullets(parsed.bullets).forEach((ch, ci) => slides.push({
        role: 'heading', subtitle, marker,
        title: ci === 0 ? parsed.heading : `${parsed.heading} (cont.)`,
        caption: refLine, bullets: ch,
      }));
    }
  }

  return { title, slides: slides.slice(0, MAX_SLIDES) };
}

// Build the slide plan from raw sermon text. Returns:
//   { title, slides: [ {role, title?, subtitle?, caption?, bullets?, reference?} ] }
// Scripture slides carry only `reference` here; sermon-build.js resolves the verse
// text. Pure + deterministic.
export function buildSermonStructure(rawText, opts = {}) {
  // Detect the three-tier outline shape (≥2 parenthesised sub-points) and, if present,
  // build the faithful hierarchical deck. Otherwise fall through to the flat heuristic.
  {
    // Count parenthesised sub-point markers by LINE (PDFs don't reliably blank-line-separate
    // them, so a paragraph-based count under-detects the outline shape).
    const subCount = String(rawText || '').replace(/\r\n?/g, '\n').split('\n')
      .filter((l) => SUBPOINT_RE.test(l.trim())).length;
    if (subCount >= 2) return buildHierarchical(rawText, opts);
  }

  const text = String(rawText || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const lines = text.split('\n');

  // Title: caller-supplied wins; else the first substantial non-reference line.
  let title = (opts.title || '').trim();
  const refsAll = findScriptureRefs(text);
  const refSet = new Set(refsAll.map((r) => r.ref.toLowerCase()));
  if (!title) {
    for (const l of lines) {
      const t = l.replace(/^\s{0,3}#{1,6}\s+/, '').trim();
      if (t && t.length <= 90 && !findScriptureRefs(t).length) { title = t; break; }
    }
  }
  title = title || 'Sermon';

  const slides = [{ role: 'title', title }];
  const usedRefs = new Set();

  // Emit scripture slides for every distinct ref in a chunk of text, in order.
  const emitRefsIn = (blob) => {
    for (const r of findScriptureRefs(blob)) {
      const key = r.ref.toLowerCase();
      if (usedRefs.has(key)) continue;
      usedRefs.add(key);
      slides.push({ role: 'scripture', reference: r.ref, bookNum: r.bookNum, chapter: r.chapter, vStart: r.vStart, vEnd: r.vEnd });
    }
  };

  // Walk the document as heading-delimited sections. Lines before the first
  // heading (other than the title line) form an opening section with no heading.
  let curHeading = null;
  let body = [];
  let titleConsumed = false;
  let emittedAny = false;

  const flush = () => {
    const bodyText = body.join('\n');
    const bullets = toBullets(body).filter((b) => !refSet.has(b.toLowerCase()));
    if (curHeading) {
      // Split any monster bullet into its own slide group; cap bullets per slide.
      const groups = chunk(bullets, MAX_BULLETS);
      if (!groups.length) {
        slides.push({ role: 'point', title: curHeading, bullets: [] });
      } else {
        groups.forEach((g, i) => slides.push({
          role: 'point',
          title: i === 0 ? curHeading : `${curHeading} (cont.)`,
          bullets: g.map((b) => (b.length > MAX_BULLET_CHARS ? b.slice(0, MAX_BULLET_CHARS).trimEnd() + '…' : b)),
        }));
      }
      emitRefsIn(curHeading + '\n' + bodyText);
      emittedAny = true;
    } else if (bullets.length) {
      // Headingless prose — group into untitled point slides.
      chunk(bullets, MAX_BULLETS).forEach((g) => slides.push({ role: 'point', bullets: g }));
      emitRefsIn(bodyText);
      emittedAny = true;
    }
    body = [];
  };

  for (const line of lines) {
    const t = line.trim();
    // Skip the line that IS the title (compare with markdown/heading marks stripped,
    // so "# The Power of Grace" doesn't also become a duplicate heading slide).
    if (!titleConsumed && t && t.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s*#*\s*$/, '').trim() === title) {
      titleConsumed = true; continue;
    }
    // A standalone scripture-reference line becomes a scripture slide directly.
    const lineRefs = findScriptureRefs(t);
    const isRefLine = lineRefs.length && t.length <= 40 && lineRefs[0].ref.length >= t.length - 6;
    const h = isRefLine ? null : headingText(line);
    if (h) { flush(); curHeading = h; continue; }
    if (isRefLine) { flush(); emitRefsIn(t); continue; }
    body.push(line);
    if (slides.length > MAX_SLIDES) break;
  }
  flush();

  // Nothing structured (e.g. a single blob with no headings or refs) → at least
  // chunk the whole text so the deck isn't just a title slide.
  if (!emittedAny && !usedRefs.size) {
    const bullets = toBullets(lines);
    chunk(bullets, MAX_BULLETS).forEach((g) => slides.push({ role: 'point', bullets: g }));
  }

  return { title, slides: slides.slice(0, MAX_SLIDES) };
}
