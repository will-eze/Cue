// Presentation → lower-third text. Pure (no DB, no DOM) so the operator payload
// builder, the editor preview and the unit tests all share one extraction.
//
// A presentation slide is a free-form canvas of elements. A lower third has one
// text band, so we flatten the slide's text elements into `title` + `body`:
//   - only non-empty TEXT elements count (images/shapes carry no words, so a
//     rasterised PPTX slide yields '' and the band stays blank);
//   - reading order = top to bottom (y), then left to right (x);
//   - role `kicker` is decorative and dropped;
//   - heading = an element with a heading role (title/section/statement/quote/verse),
//     else — with 2+ text elements and no roles (sermon-built / hand-made slides) —
//     the one with a CLEARLY larger font size, else none.
//   - plain text only: the `⁂` slide-break marker and any run markup are stripped.

const HEADING_ROLES = ['title', 'section', 'statement', 'quote', 'verse'];
const DROP_ROLES = ['kicker'];
// "Clearly largest": the biggest font must beat the runner-up by this factor, so a
// slide of similar-sized text boxes does not promote an arbitrary one to heading.
const HEADING_SIZE_RATIO = 1.15;

function cleanText(t) {
  return String(t ?? '')
    .replace(/⁂/g, '')
    .replace(/<[^>]*>/g, '')           // stray markup (HTML-ish runs)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')          // collapse blank lines
    .trim();
}

// Uniform bullet glyph: "•Point", "-  Point", "– Point", "* Point" all become "• Point" so a mix of
// hand-typed markers reads consistently; a bare marker line is dropped. A hyphen/dash only counts as
// a marker when followed by whitespace ("-5 degrees" and "well-known" are left alone).
const BULLET_LEAD = /^\s*(?:[•·▪◦‣●○*]\s*|[-–—]\s+)/;
function normLines(text) {
  return text.split('\n').map((l) => {
    if (!BULLET_LEAD.test(l)) return l.trim();
    const body = l.replace(BULLET_LEAD, '').trim();
    return body ? '• ' + body : '';
  }).filter(Boolean);
}
const sameLine = (a, b) => a.replace(/^•\s*/, '').replace(/\s+/g, ' ').toLowerCase()
  === b.replace(/^•\s*/, '').replace(/\s+/g, ' ').toLowerCase();

function sizeOf(el) {
  const n = Number(el && el.style && el.style.fontSize);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function extractLtText(elements) {
  const list = (Array.isArray(elements) ? elements : [])
    .filter((e) => e && e.type === 'text' && !DROP_ROLES.includes(e.role))
    .map((e, i) => ({ e, i, lines: normLines(cleanText(e.text)) }))
    .map((x) => ({ ...x, text: x.lines.join('\n') }))
    .filter((x) => x.text)
    .sort((a, b) => {
      const ay = Number(a.e.y) || 0, by = Number(b.e.y) || 0;
      if (ay !== by) return ay - by;
      const ax = Number(a.e.x) || 0, bx = Number(b.e.x) || 0;
      return ax !== bx ? ax - bx : a.i - b.i;
    });
  if (!list.length) return { title: '', body: '', text: '' };

  let head = list.find((x) => HEADING_ROLES.includes(x.e.role));
  if (!head && list.length >= 2) {
    const sorted = [...list].sort((a, b) => sizeOf(b.e) - sizeOf(a.e));
    const top = sizeOf(sorted[0].e), next = sizeOf(sorted[1].e);
    if (top > 0 && top >= next * HEADING_SIZE_RATIO) head = sorted[0];
  }
  const title = head ? head.text : '';
  // Body lines: drop any line that merely repeats the title (title duplicated in a body box),
  // and collapse back-to-back identical lines (duplicated text boxes).
  const bodyLines = [];
  for (const x of list) {
    if (x === head) continue;
    for (const l of x.lines) {
      if (title && sameLine(l, title)) continue;
      if (bodyLines.length && sameLine(bodyLines[bodyLines.length - 1], l)) continue;
      bodyLines.push(l);
    }
  }
  const body = bodyLines.join('\n');
  return { title, body, text: [title, body].filter(Boolean).join('\n') };
}

// ─── Per-slide lower-third settings (lt_json) ───────────────────────────────────
// { mode: 'inherit'|'auto'|'custom'|'hide', text?, maxLines?, maxChars?, title?: 'auto'|'none'|'custom', titleText? }
// Every field is optional; absent = default. Old rows ({mode:'auto'|'custom'|'hide', text?}) keep working.
export const LT_DEFAULT_MAX_LINES = 2;
export const LT_DEFAULT_MAX_CHARS = 42;
export const LT_LIMITS = { maxLines: [1, 4], maxChars: [20, 80], text: 4000, titleText: 200 };
export const PAGE_BREAK = '⁂';

const clampInt = (v, [lo, hi], fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function parseLtJson(v) {
  let o = v;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
  return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
}

// Validate + normalise (shared by main's save path and the editor). Returns a plain object or null
// (null = nothing set = inherit everything).
export function normaliseLt(v) {
  const o = parseLtJson(v);
  if (!o) return null;
  const mode = ['inherit', 'auto', 'custom', 'hide'].includes(o.mode) ? o.mode : null;
  const out = {};
  if (mode && mode !== 'inherit') out.mode = mode;
  else if (!mode && (o.maxLines == null && o.maxChars == null && o.title == null)) return null;
  else out.mode = 'inherit';
  if (out.mode === 'custom') out.text = String(o.text ?? '').replace(/\r\n?/g, '\n').slice(0, LT_LIMITS.text);
  if (o.maxLines != null) { const n = clampInt(o.maxLines, LT_LIMITS.maxLines, 0); if (n) out.maxLines = n; }
  if (o.maxChars != null) { const n = clampInt(o.maxChars, LT_LIMITS.maxChars, 0); if (n) out.maxChars = n; }
  if (['auto', 'none', 'custom'].includes(o.title)) out.title = o.title;
  if (out.title === 'custom') out.titleText = String(o.titleText ?? '').replace(/\s+/g, ' ').trim().slice(0, LT_LIMITS.titleText);
  if (out.mode === 'inherit' && Object.keys(out).length === 1) return null;
  return out;
}

// Normalise the global defaults (settings strings or numbers) to ints within limits.
export function ltDefaults(s) {
  return {
    maxLines: clampInt(s && s.maxLines, LT_LIMITS.maxLines, LT_DEFAULT_MAX_LINES),
    maxChars: clampInt(s && s.maxChars, LT_LIMITS.maxChars, LT_DEFAULT_MAX_CHARS),
  };
}

// ─── Paginator ──────────────────────────────────────────────────────────────────
const SENTENCE_END = /[.?!…]["'”’)\]]*$/;
const CLAUSE_END = /[,;:—–]["'”’)\]]*$/;
const ABBREV = /^(?:mr|mrs|ms|dr|st|vs|v|cf|no|vol|ch|chap|rev|gen|ex|exod|lev|num|deut|josh|judg|sam|chr|neh|ps|prov|eccl|isa|jer|lam|ezek|dan|hos|obad|mic|nah|hab|zeph|hag|zech|mal|matt|rom|cor|gal|eph|phil|col|thess|tim|heb|jas|pet|rev|e\.g|i\.e)\.$/i;
function endRank(word) {
  if (SENTENCE_END.test(word)) {
    const bare = word.replace(/["'”’)\]]+$/, '');
    if (/\.$/.test(bare) && (ABBREV.test(bare) || /^\d+\.$/.test(bare))) return 0;
    return 3;
  }
  if (CLAUSE_END.test(word)) return 2;
  return 1;
}

// Break one source line into word tokens. A bullet "• " glues to its first word.
function tokenise(text) {
  const out = [];
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let bulletId = 0;
  for (const raw of lines) {
    const line = raw.replace(/<[^>]*>/g, '').replace(/[ \t ]+/g, ' ').trim();
    if (!line) continue;
    const isBullet = /^[•·▪◦‣●○]\s*/.test(line);
    const body = isBullet ? line.replace(/^[•·▪◦‣●○]\s*/, '') : line;
    const words = body.split(' ').filter(Boolean);
    if (!words.length) continue;
    if (isBullet) bulletId++;
    words.forEach((w, i) => out.push({
      w: i === 0 && isBullet ? '• ' + w : w,
      lineStart: i === 0,
      bullet: isBullet ? bulletId : 0,
    }));
  }
  return out;
}

// Greedy layout of words[from, to) into lines of <= maxChars. Returns [{ a, b }] word ranges.
function layout(words, from, to, maxChars) {
  const lines = [];
  let a = from, len = 0;
  for (let i = from; i < to; i++) {
    const wl = words[i].w.length;
    if (i > a && (words[i].lineStart || len + 1 + wl > maxChars)) { lines.push({ a, b: i }); a = i; len = 0; }
    len = i === a ? wl : len + 1 + wl;
  }
  if (to > a) lines.push({ a, b: to });
  return lines;
}

// Same number of lines as the greedy layout, but at the narrowest width that still gives that many
// lines, so a wrapped line does not strand one or two words ("of God") on its own.
function balance(words, a, b, maxChars) {
  const base = layout(words, a, b, maxChars);
  if (base.length < 2) return base;
  let lo = 1; for (let i = a; i < b; i++) lo = Math.max(lo, words[i].w.length);
  for (let w = Math.min(lo, maxChars); w < maxChars; w++) {
    const t = layout(words, a, b, w);
    if (t.length === base.length) return t;
  }
  return base;
}

const textOf = (words, a, b) => words.slice(a, b).map((x) => x.w).join(' ');

function paginateWords(words, maxLines, maxChars) {
  const n = words.length;
  // Total laid-out lines per bullet (alone), to know whether a bullet "fits on a page".
  const bulletLines = new Map();
  for (let i = 0; i < n; i++) {
    const id = words[i].bullet;
    if (!id || bulletLines.has(id)) continue;
    let j = i; while (j < n && words[j].bullet === id) j++;
    bulletLines.set(id, layout(words, i, j, maxChars).length);
  }
  const insideFitBullet = (c) => c > 0 && c < n && words[c].bullet && words[c - 1].bullet === words[c].bullet
    && bulletLines.get(words[c].bullet) <= maxLines;

  const ranges = [];
  let from = 0;
  while (from < n) {
    const lines = layout(words, from, n, maxChars);
    if (lines.length <= maxLines) { ranges.push([from, n]); break; }
    const page = lines.slice(0, maxLines);
    const pageEnd = page[page.length - 1].b;
    // Choose where the page ends. Each candidate cut costs: how mid-phrase it is (sentence end 0,
    // clause end / manual line end 15, anywhere else 80) + how much of the page it leaves empty
    // (up to 100) + 40 if it strands a tiny widow on the last line. Never splits a bullet that fits.
    let cut = pageEnd, bestCost = Infinity;
    for (let c = pageEnd; c > from; c--) {
      if (insideFitBullet(c)) continue;
      const hard = c < n && words[c].lineStart;
      let r = Math.max(endRank(words[c - 1].w), hard ? 2 : 0);
      if (r === 0) r = 1;
      if (c !== pageEnd && r < 2) continue;
      let chars = 0;
      for (let i = from; i < c; i++) chars += words[i].w.length + 1;
      // Judge the widow on the BALANCED layout — that is how the page airs. Measuring the greedy
      // layout made a clean clause end ("…with open / hands,") look like a widow and lose to a
      // mid-phrase cut ("…in the freedom it").
      const pl = balance(words, from, c, maxChars);
      const lastLen = pl.length ? textOf(words, pl[pl.length - 1].a, pl[pl.length - 1].b).length : 0;
      // A page must not end on the start of a NEW sentence: if it already holds a sentence end and
      // the words after it do not themselves finish a sentence, end at that earlier sentence instead.
      let fragment = false;
      if (r !== 3) for (let e = c - 1; e > from; e--) if (endRank(words[e - 1].w) === 3) { fragment = true; break; }
      const cost = (fragment ? 70 : 0) + (r === 3 ? 0 : r === 2 ? 15 : 80)
        + 100 * Math.max(0, 1 - chars / (maxLines * maxChars))
        + (pl.length > 1 && lastLen < 8 ? 40 : 0);
      if (cost < bestCost) { bestCost = cost; cut = c; }
    }
    if (cut <= from) cut = Math.max(from + 1, pageEnd);
    ranges.push([from, cut]);
    from = cut;
  }
  // Orphan: a last page of one or two short continuation words takes words back from the previous
  // page until it has three (so "your life." never airs alone), when that stays within maxLines.
  if (ranges.length >= 2) {
    const [a, b] = ranges[ranges.length - 1];
    const prev = ranges[ranges.length - 2];
    const k = b - a, m = 3 - k;
    if (k <= 2 && !words[a].lineStart && textOf(words, a, b).length <= 18 && prev[1] - prev[0] >= m + 2) {
      const moved = words.slice(prev[1] - m, prev[1]);
      const cutAt = prev[1] - m;
      if (!moved.some((x) => x.lineStart) && !insideFitBullet(cutAt)
        && layout(words, prev[0], cutAt, maxChars).length <= maxLines
        && layout(words, cutAt, b, maxChars).length <= maxLines) {
        prev[1] = cutAt; ranges[ranges.length - 1] = [cutAt, b];
      }
    }
  }
  return ranges;
}

// Text -> pages of short lines. `⁂` on a line of its own = page break; newline = line break;
// everything else flows greedily to maxChars (only at spaces). A page that would exceed maxLines
// is split at the best boundary (sentence > clause > word). Pure and deterministic.
export function paginateLt(text, opts) {
  const { maxLines, maxChars } = ltDefaults(opts);
  const segs = String(text ?? '').replace(/\r\n?/g, '\n').split(/^[ \t]*⁂[ \t]*$/m);
  const pages = [];
  for (const seg of segs) {
    const words = tokenise(seg.replace(/⁂/g, ''));
    if (!words.length) continue;
    let first = true;
    for (const [a, b] of paginateWords(words, maxLines, maxChars)) {
      const lines = balance(words, a, b, maxChars).map((l) => textOf(words, l.a, l.b));
      // `manual`: this page starts after a ⁂ page break (vs an automatic split). `overflow`: a
      // line is wider than maxChars because one word is longer than the line.
      pages.push({ lines, overflow: lines.some((l) => l.length > maxChars), manual: first && pages.length > 0 });
      first = false;
    }
  }
  return pages;
}

// Serialise pages back to editable text: lines as written, `⁂` on its own line between pages.
export function pagesToText(pages) {
  return (pages || []).map((p) => (p.lines || []).join('\n')).join('\n' + PAGE_BREAK + '\n');
}

// Resolve one slide against the deck default. `slide.lt_json` is the stored JSON
// string (or object); null/invalid = inherit `deckMode` ('auto'|'hide').
// Returns { mode: 'auto'|'custom'|'hide', title, text }. Custom with blank text
// falls back to auto. A hidden slide, or one with no text at all, returns text ''.
// (`text` keeps page-break markers for custom text; extra fields carry the lt options.)
export function resolveSlideLt(slide, deckMode) {
  const o = parseLtJson(slide && slide.lt_json);
  const own = o && ['auto', 'custom', 'hide'].includes(o.mode) ? o : null;
  const opts = o || {};
  let mode = own ? own.mode : (deckMode === 'hide' ? 'hide' : 'auto');
  if (mode === 'hide') return { mode: 'hide', title: '', text: '', body: '', opts };
  const ex = extractLtText(slide && slide.elements);
  if (mode === 'custom') {
    const custom = String(own.text ?? '').replace(/\r\n?/g, '\n').replace(/<[^>]*>/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
    if (custom.replace(/⁂/g, '').trim()) return { mode: 'custom', title: titleFor(opts, 'custom', ex.title), text: custom, body: custom, opts };
    mode = 'auto';
  }
  const tm = opts.title === 'none' || opts.title === 'custom' || opts.title === 'auto' ? opts.title : 'auto';
  const title = titleFor(opts, 'auto', ex.title);
  // Title 'none' keeps the heading as ordinary first content, so no words are lost.
  const body = tm === 'none' ? ex.text : ex.body;
  return { mode, title, text: [title, body].filter(Boolean).join('\n'), body, opts };
}

function titleFor(opts, mode, heading) {
  const tm = opts.title;
  if (tm === 'none') return '';
  if (tm === 'custom') return String(opts.titleText ?? '').trim();
  if (tm === 'auto') return heading || '';
  return mode === 'auto' ? (heading || '') : '';
}

// The one function the editor preview AND the operator payload both use, so preview == air.
// `deck` = presentation row ({lt_mode}) or a mode string; `settings` = {maxLines, maxChars} defaults.
export function resolveLtPages(slide, deck, settings) {
  const deckMode = deck && typeof deck === 'object' ? deck.lt_mode : deck;
  const r = resolveSlideLt(slide, deckMode);
  const d = ltDefaults(settings);
  const maxLines = clampInt(r.opts.maxLines, LT_LIMITS.maxLines, d.maxLines);
  const maxChars = clampInt(r.opts.maxChars, LT_LIMITS.maxChars, d.maxChars);
  if (r.mode === 'hide') return { mode: 'hide', title: '', pages: [], maxLines, maxChars };
  const pages = paginateLt(r.body, { maxLines, maxChars });
  if (!pages.length) return { mode: r.mode, title: '', pages: [], maxLines, maxChars };
  return { mode: r.mode, title: r.title || '', pages, maxLines, maxChars };
}
