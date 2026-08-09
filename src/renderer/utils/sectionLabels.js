// Display labels for song sections, with verse/chorus numbering.
//
// A section type is numbered only when it repeats within the song: a song with
// three verses shows "Verse 1 / Verse 2 / Verse 3", but a single chorus stays
// "Chorus" (no stray "1"). This mirrors ProPresenter / EasyWorship and is the
// single source of truth for section labels across the operator slide list, the
// song editor, the stage / confidence display, and the network remote.
//
// Numbering is derived purely from the ordered section list — there is no stored
// number — so it always stays correct as sections are added, removed, or
// reordered. Non-song slides (scripture references, media) pass through unchanged.

const FULL = {
  verse: 'Verse', chorus: 'Chorus', refrain: 'Refrain', bridge: 'Bridge',
  'pre-chorus': 'Pre-Chorus', tag: 'Tag', intro: 'Intro', outro: 'Outro',
  slide: 'Slide', media: 'Media',
};

// Abbreviated forms for narrow columns (e.g. the operator slide rail).
const ABBR = { ...FULL, 'pre-chorus': 'Pre-Ch' };

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// Returns the ordinal number for each slide (1, 2, 3…) within its section type,
// or null when that type appears only once. Parallel to `slides`. This is the
// core "number only when repeated" rule that both the labels and the song
// editor's badge derive from.
export function sectionOrdinals(slides) {
  const list = Array.isArray(slides) ? slides : [];
  const totals = {};
  for (const s of list) {
    const t = s?.type || '';
    if (t) totals[t] = (totals[t] || 0) + 1;
  }
  const seen = {};
  return list.map((s) => {
    const t = s?.type || '';
    if (!t) return null;
    seen[t] = (seen[t] || 0) + 1;
    return totals[t] > 1 ? seen[t] : null;
  });
}

// Returns an array of display labels, one per slide, parallel to `slides`.
// Pass { abbrev: true } for the short forms.
export function sectionLabels(slides, { abbrev = false } = {}) {
  const list = Array.isArray(slides) ? slides : [];
  const map = abbrev ? ABBR : FULL;
  const nums = sectionOrdinals(list);
  return list.map((s, i) => {
    const t = s?.type || '';
    if (!t) return 'Section';
    const base = map[t] || cap(t);
    return nums[i] != null ? `${base} ${nums[i]}` : base;
  });
}

// Single label for the slide at `index` within `slides`.
export function sectionLabelAt(slides, index, opts) {
  return sectionLabels(slides, opts)[index] ?? '';
}

// ── Variable-size section splitting ─────────────────────────────────────────
//
// An operator can split one long section (e.g. "Verse 1") into several display
// slides while it stays ONE logical section in the library. The split point is a
// break marker stored inline in the section's `content` — the asterism glyph
// (U+2042) on its own line. It is symbol-only, so it is invisible to the song FTS
// index (unicode61 tokenizer) and to the paste-list matcher (which strips
// non-alphanumerics): nothing downstream needs to know about it except the slide
// builder here and the song editor that inserts it.

export const SLIDE_BREAK = '⁂'; // ⁂

// Split a section's content into display parts on the break marker. Each part is
// trimmed of surrounding blank lines; empty parts are dropped. A section always
// yields at least one part (so it never vanishes), and a section with no marker
// yields exactly one part — i.e. unchanged behaviour for existing songs.
export function splitSectionContent(content) {
  const parts = String(content ?? '')
    .split(SLIDE_BREAK)
    .map((p) => p.replace(/^\s*\n|\n\s*$/g, '').trim())
    .filter((p) => p.length > 0);
  return parts.length ? parts : [''];
}

// ── Max-lines auto-pagination ────────────────────────────────────────────────
//
// A theme (or a song's own style_json) can cap how many AUTHORED lines a single
// display slide shows via `style_json.maxLines`. Overflow paginates: the content
// is split on newlines and re-chunked into groups of at most `maxLines` lines.
// Counting is by typed line breaks (deterministic) — NOT visual wrapping, which
// depends on live output geometry the operator doesn't have.
//
// Runs AFTER splitSectionContent so a manual `⁂` break wins the boundary and each
// resulting part is then capped. A falsy / <1 cap (or no overflow) leaves the
// content unchanged, so existing songs behave exactly as before.
export function splitByMaxLines(content, maxLines) {
  const cap = Number(maxLines);
  if (!Number.isFinite(cap) || cap < 1) return [String(content ?? '')];
  const lines = String(content ?? '').split('\n');
  if (lines.length <= cap) return [String(content ?? '')];
  const chunks = [];
  for (let i = 0; i < lines.length; i += cap) {
    chunks.push(lines.slice(i, i + cap).join('\n'));
  }
  return chunks.length ? chunks : [String(content ?? '')];
}

// Read the max-lines cap off a section's style_json (a JSON string or object).
// Null / unparseable / absent → 0 (unlimited).
export function maxLinesOf(section) {
  const sj = section?.style_json;
  if (!sj) return 0;
  let style = sj;
  if (typeof sj === 'string') {
    try { style = JSON.parse(sj); } catch { return 0; }
  }
  const n = Number(style?.maxLines);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── Arrangements ─────────────────────────────────────────────────────────────
//
// A song can carry a played ORDER of its sections (ProPresenter-style
// arrangement, e.g. V1 C V2 C B C C): `songs.arrangement_json`, a JSON array of
// 0-based section POSITIONS with repeats allowed. Null/empty/invalid = natural
// order. Positions rather than ids because a song save rewrites its sections
// (ids churn); the editor serializes both together so positions stay aligned.

// Resolve an arrangement (JSON string or array of indices) against the natural
// section list. Stale/out-of-range entries are dropped; an arrangement that
// resolves to nothing falls back to the natural order so a song never vanishes.
export function applyArrangement(sections, arrangement) {
  const list = Array.isArray(sections) ? sections : [];
  let idxs = arrangement;
  if (typeof idxs === 'string') {
    try { idxs = JSON.parse(idxs); } catch { idxs = null; }
  }
  if (!Array.isArray(idxs) || !idxs.length) return list;
  const out = idxs
    .map((n) => list[Number(n)])
    .filter(Boolean);
  return out.length ? out : list;
}

// Expand an ordered section list into the flat slide list the operator navigates,
// splitting any section that carries break markers into its parts. Labels are
// computed at the SECTION level first (so a verse split into 3 parts is still one
// "Verse 1", not "Verse 1/2/3") and shared across that section's parts. Each part
// inherits the section's fields (type, style_json, …) plus part metadata.
//
// `arrangement` (optional) reorders/repeats sections for playback. Labels are
// ALWAYS derived from the natural list so a chorus repeated by the arrangement
// stays "Chorus" (or "Chorus 2" = the second distinct chorus), never gaining a
// new number per repeat. Keys carry the arranged position so repeats stay unique.
//
// `opts.songMaxLines` / `opts.globalMaxLines` supply the max-lines cascade for
// auto-pagination (most-specific-wins): a section's own theme-applied
// `style_json.maxLines` → the song's explicit per-song cap (Song Editor, forces
// every section) → the global `song_max_lines` default → 0 (unlimited). The
// per-song cap intentionally overrides a theme's section cap so "set N in the
// editor" adjusts all slides; the global is only the fallback for songs that set
// neither. All are 0-safe (0 = unset), so existing songs are unchanged.
export function expandSongSections(sections, arrangement, opts = {}) {
  const list = Array.isArray(sections) ? sections : [];
  const songMaxLines   = Number(opts.songMaxLines)   > 0 ? Number(opts.songMaxLines)   : 0;
  const globalMaxLines = Number(opts.globalMaxLines) > 0 ? Number(opts.globalMaxLines) : 0;
  const labels     = sectionLabels(list);
  const labelsAbbr = sectionLabels(list, { abbrev: true });
  const labelIdx   = new Map(list.map((sec, i) => [sec, i]));
  const ordered = applyArrangement(list, arrangement);
  const out = [];
  ordered.forEach((sec, oi) => {
    const si = labelIdx.get(sec) ?? 0;
    // Manual `⁂` breaks first, then auto-paginate each part by the section's
    // max-lines cap. _partIndex/_partCount span the FINAL combined slide list so a
    // section that expands to N slides is numbered 1..N under one shared label.
    const cap = songMaxLines || maxLinesOf(sec) || globalMaxLines;
    const parts = splitSectionContent(sec?.content)
      .flatMap((part) => splitByMaxLines(part, cap));
    parts.forEach((content, pi) => {
      out.push({
        ...sec,
        content,
        _label:     labels[si],
        _labelAbbr: labelsAbbr[si],
        _partIndex: pi,
        _partCount: parts.length,
        _key: `${oi}-${sec?.id ?? si}-${pi}`,
      });
    });
  });
  return out;
}
