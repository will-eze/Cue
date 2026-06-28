// Song import — parses external song files into Cue's section model.
//
// Supported formats (auto-detected per file):
//   • OpenLyrics XML  — the de-facto open standard (OpenLP and others export it).
//   • ChordPro         — {directives} + inline [Chord] tokens.
//   • Plain text       — header-delimited (Verse 1 / Chorus / [Bridge] …) or
//                        blank-line-delimited blocks.
//
// One file = one song. Parsing is pure (no DB writes) so the renderer can show a
// preview/confirm step before committing. XML is parsed with regex to match the
// project convention in db/bible-import.js (no XML dependency in the tree).

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// The only section types song_sections.type allows (schema CHECK constraint).
const ALLOWED_TYPES = new Set(['verse', 'chorus', 'refrain', 'bridge', 'pre-chorus', 'tag', 'intro', 'outro']);

// Slide-break marker stored inline in a section's content — splits one logical
// section into variable-size display parts. MUST match SLIDE_BREAK in the renderer
// (src/renderer/utils/sectionLabels.js). Symbol-only, so it stays invisible to the
// song FTS index and the lyric matchers.
const SLIDE_BREAK = '⁂';

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&'); // ampersand last so it doesn't double-decode
}

function stripTags(s) {
  return String(s ?? '').replace(/<[^>]+>/g, '');
}

// ── OpenLyrics ───────────────────────────────────────────────────────────────

// Verse name attribute → Cue section type. OpenLyrics uses single-letter codes
// (v1, c, b, p, e…) optionally suffixed with numbers/letters.
function openLyricsType(name) {
  const n = String(name || '').toLowerCase();
  if (n.startsWith('c')) return 'chorus';
  if (n.startsWith('p')) return 'pre-chorus';
  if (n.startsWith('b')) return 'bridge';
  if (n.startsWith('r')) return 'refrain';
  if (n.startsWith('i')) return 'intro';
  if (n.startsWith('e') || n.startsWith('o')) return 'outro';
  if (n.startsWith('t')) return 'tag';
  return 'verse';
}

// <lines> body → plain text. <br/> become newlines; chords/comments/tags dropped.
function openLyricsLines(xml) {
  return decodeEntities(
    xml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/line>/gi, '\n')              // legacy <line> form
      .replace(/<comment\b[\s\S]*?<\/comment>/gi, '')
      .replace(/<[^>]+>/g, '')                  // chord, tag, etc.
  ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseOpenLyrics(raw, fallbackTitle) {
  const propsM = /<properties\b[\s\S]*?<\/properties>/i.exec(raw);
  const props = propsM ? propsM[0] : '';

  const titleM = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(props);
  const title = titleM ? decodeEntities(stripTags(titleM[1])).trim() : '';

  const authors = [];
  const authRe = /<author\b[^>]*>([\s\S]*?)<\/author>/gi;
  let am;
  while ((am = authRe.exec(props))) {
    const a = decodeEntities(stripTags(am[1])).trim();
    if (a) authors.push(a);
  }

  const copyM = /<copyright\b[^>]*>([\s\S]*?)<\/copyright>/i.exec(props);
  let copyright = copyM ? decodeEntities(stripTags(copyM[1])).trim() : '';
  const ccliM = /<ccliNo\b[^>]*>([\s\S]*?)<\/ccliNo>/i.exec(props);
  if (ccliM) {
    const c = decodeEntities(stripTags(ccliM[1])).trim();
    if (c) copyright = (copyright ? copyright + ' · ' : '') + 'CCLI ' + c;
  }

  const lyricsM = /<lyrics\b[\s\S]*?<\/lyrics>/i.exec(raw);
  const lyrics = lyricsM ? lyricsM[0] : raw;

  const sections = [];
  const verseRe = /<verse\b([^>]*)>([\s\S]*?)<\/verse>/gi;
  let vm;
  while ((vm = verseRe.exec(lyrics))) {
    const nameM = /name\s*=\s*"([^"]*)"/i.exec(vm[1]);
    const type = openLyricsType(nameM ? nameM[1] : 'v');
    const linesRe = /<lines\b[^>]*>([\s\S]*?)<\/lines>/gi;
    const chunks = [];
    let lm;
    while ((lm = linesRe.exec(vm[2]))) chunks.push(openLyricsLines(lm[1]));
    let content = chunks.filter(Boolean).join('\n\n');
    if (!content) content = openLyricsLines(vm[2]); // no <lines> wrapper
    if (content.trim()) sections.push({ type, content: content.trim() });
  }

  if (!sections.length) throw new Error('No verses found in OpenLyrics file.');
  return {
    title: title || fallbackTitle,
    author: authors.join(', ') || null,
    copyright: copyright || null,
    sections,
  };
}

// ── Plain text / ChordPro ─────────────────────────────────────────────────────

// A guitar-chord token in square brackets, e.g. [C] [G7] [Am] [D/F#] [Bbmaj7].
// Deliberately NOT matching section headers like [Chorus] / [Verse 1] / [Bridge]
// (those start with a non-chord letter or have trailing words), so headers survive.
const CHORD_RE = /\[[A-G][#b]?(?:maj|min|sus|dim|aug|add|m|M)?\d*(?:\/[A-G][#b]?)?\]/g;

// Performance / voice-part directives EasyWorship users place on their own line —
// "All", "All - Unison", "Men:", "(Women)", "Soprano", "Instrumental", "x2". These
// caption WHO sings or HOW, never lyric content, so EW import drops them from the
// text. Real section headers ("Chorus", "Verse 2") are claimed by matchHeader
// first and survive as the section's type/label; this list is only the residue
// that has no place in Cue's section vocabulary.
const NONLYRIC_TOKENS = new Set([
  'all', 'unison', 'solo', 'duet', 'trio', 'everyone', 'group', 'together',
  'men', 'man', 'male', 'women', 'woman', 'female', 'ladies', 'lady',
  'boys', 'boy', 'girls', 'girl', 'kids', 'child', 'children', 'youth', 'adults',
  'soprano', 'sopranos', 'alto', 'altos', 'tenor', 'tenors', 'bass', 'basses',
  'baritone', 'descant', 'harmony', 'melody', 'part', 'parts',
  'lead', 'leader', 'worship leader', 'cantor', 'choir', 'chorale',
  'congregation', 'people', 'response', 'call',
  'spoken', 'sung', 'shout', 'whisper', 'hum', 'humming', 'clap', 'clapping',
  'instrumental', 'interlude', 'musical', 'music', 'ending',
  'vamp', 'reprise', 'modulation', 'repeat', 'optional', 'echo',
  'acapella', 'acappella', 'a cappella', 'spontaneous', 'adlib', 'ad lib', 'ad-lib',
]);

// True when a whole line is a performance/voice-part directive rather than lyric.
// Conservative: directives are short, and every separator-delimited part must be a
// known token (or a bare number), so multi-word lyrics like "Men and women of God"
// stay put. Used only by the EW importer (stripAnnotations) — callers that want the
// historic paste behaviour leave it off.
function isNonLyricLine(line) {
  let t = String(line || '').trim();
  if (!t || t.length > 40) return false;                 // real lyric lines run longer
  const wrap = /^\(([^()]*)\)$|^\[([^\[\]]*)\]$/.exec(t); // unwrap "(All)" / "[Men]"
  if (wrap) t = (wrap[1] ?? wrap[2]).trim();
  // Drop a trailing repeat count: "x2", "(x2)", "2x", "(3 times)", "(repeat all)".
  t = t.replace(/[\s(]*(?:x\s*\d+|\d+\s*x|\d+\s*times?|repeat(?:\s*all)?)[\s)]*$/i, '').trim();
  if (!t) return true;                                   // line was only a multiplier
  t = t.replace(/[.,:;!?]+$/g, '').trim();
  if (!t) return false;
  const parts = t.split(/\s*[-–—/:|]\s*|\s+&\s+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => {
    const w = p.toLowerCase().replace(/\s*\d+$/, '').trim();  // "men 2" → "men"
    return NONLYRIC_TOKENS.has(w) || NONLYRIC_TOKENS.has(p.toLowerCase()) || /^\d+$/.test(p);
  });
}

// Header / blank-line section parser. Ported from SongEditor.jsx's Paste Song
// parser so file import and paste behave identically. `stripAnnotations` (EW only)
// additionally drops performance/voice-part directive lines (see isNonLyricLine)
// so e.g. "All - Unison" never reaches the lyric text, while a true "Chorus"
// header is still consumed by matchHeader and becomes the section type.
function parseSections(rawText, { stripAnnotations = false } = {}) {
  if (!rawText.trim()) return [];
  let lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const KW = 'verse|chorus|bridge|pre[-\\s]?chorus|prechorus|tag|intro|outro|refrain';
  const HEADER_PATTERNS = [
    new RegExp('^\\[(.{1,40}?)\\]\\s*:?\\s*$'),
    new RegExp(`^(${KW})\\s*\\d*[a-z]?\\s*:$`, 'i'),
    new RegExp(`^(${KW})\\s*\\d*[a-z]?$`, 'i'),
    // EW: a known section word trailed by a directive — "Verse 1 - All",
    // "Chorus (Men)", "Chorus: Women", "Verse 1a Solo- Devine" (voice-part words
    // between the number and the separator) — keeps the section word, drops the rest.
    ...(stripAnnotations ? [new RegExp(`^(${KW})\\s*\\d*[a-z]?(?:\\s+[A-Za-z][A-Za-z'']*){0,4}\\s*[-–—:/(].*$`, 'i')] : []),
  ];
  const TYPE_MAP = {
    verse: 'verse', v: 'verse', chorus: 'chorus', ch: 'chorus', refrain: 'refrain',
    bridge: 'bridge', br: 'bridge', 'pre-chorus': 'pre-chorus', 'pre chorus': 'pre-chorus',
    prechorus: 'pre-chorus', tag: 'tag', intro: 'intro', outro: 'outro',
    ending: 'outro', end: 'outro', vamp: 'tag', interlude: 'bridge',
  };
  function matchHeader(line) {
    const t = line.trim();
    if (!t || t.length > 60) return null;
    for (const re of HEADER_PATTERNS) { const m = t.match(re); if (m) return (m[1] ?? m[0]).replace(/:?\s*$/, '').trim(); }
    return null;
  }
  // EW: drop directive lines up front (a header still wins, so it's preserved),
  // so both the section loop and the headerless fallback below see clean text.
  if (stripAnnotations) lines = lines.filter((l) => matchHeader(l) || !isNonLyricLine(l));
  function labelToType(label) {
    const l = label.toLowerCase().replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
    const base = l.replace(/\s*\d+$/, '').trim();
    return TYPE_MAP[base] || TYPE_MAP[l] || 'verse';
  }
  const TRAILING_TAG_RE = new RegExp(`\\s*\\[(${KW}|ch|br|v)\\s*\\d*\\]\\s*$`, 'i');
  function cleanLine(line) {
    return line.trim().replace(TRAILING_TAG_RE, '').replace(/^\s*[\[\(]?\d+[\]\)\.:]?\s+/, '');
  }
  const sections = [];
  let currentType = null, currentLines = [], hasHeaders = false, prevBlank = true;
  function flush() {
    while (currentLines.length && !currentLines[0].trim()) currentLines.shift();
    while (currentLines.length && !currentLines[currentLines.length - 1].trim()) currentLines.pop();
    const content = currentLines.join('\n').trim();
    if (content) sections.push({ type: currentType || 'verse', content });
    currentLines = []; currentType = null;
  }
  for (const line of lines) {
    const isBlank = !line.trim();
    const headerLabel = matchHeader(line);
    if (headerLabel) { flush(); currentType = labelToType(headerLabel); hasHeaders = true; prevBlank = true; continue; }
    if (/^\s*\d+[.):]?\s*$/.test(line)) { prevBlank = true; continue; }
    if (prevBlank && !isBlank) {
      const m = line.match(/^\s*(\d{1,2})[.)]?\s+(.+)$/);
      if (m) { flush(); currentType = 'verse'; hasHeaders = true; currentLines.push(cleanLine(m[2])); prevBlank = false; continue; }
    }
    if (isBlank) { currentLines.push(''); prevBlank = true; }
    else { currentLines.push(cleanLine(line)); prevBlank = false; }
  }
  flush();
  if (!hasHeaders) return lines.join('\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((content) => ({ type: 'verse', content }));
  return sections;
}

function parseTextOrChordPro(raw, fallbackTitle) {
  let title = '', author = '', copyright = '', ccli = '';
  const dirRe = /^\s*\{\s*([a-z_]+)\s*:?\s*([\s\S]*?)\s*\}\s*$/i;
  const out = [];
  for (const line of raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const d = dirRe.exec(line);
    if (d) {
      const key = d[1].toLowerCase();
      const val = d[2].trim();
      if (key === 'title' || key === 't') title = title || val;
      else if (['subtitle', 'st', 'artist', 'composer', 'author'].includes(key)) author = author || val;
      else if (key === 'copyright') copyright = copyright || val;
      else if (['ccli', 'ccli_no', 'cclino'].includes(key)) ccli = ccli || val;
      else if (key === 'start_of_chorus' || key === 'soc') out.push('Chorus');
      else if (key === 'start_of_verse' || key === 'sov') out.push('Verse');
      else if (['end_of_chorus', 'eoc', 'end_of_verse', 'eov'].includes(key)) out.push('');
      // {comment}/{c}/{key}/{tempo}/etc. — dropped
      continue;
    }
    out.push(line.replace(CHORD_RE, '')); // strip inline chords; harmless on plain text
  }
  if (ccli) copyright = (copyright ? copyright + ' · ' : '') + 'CCLI ' + ccli;
  const sections = parseSections(out.join('\n'));
  if (!sections.length) throw new Error('No lyrics found in file.');
  return {
    title: title || fallbackTitle,
    author: author || null,
    copyright: copyright || null,
    sections,
  };
}

// ── EasyWorship (SQLite + RTF) ────────────────────────────────────────────────

// Windows-1252 high range (0x80–0x9F) — the encoding EasyWorship emits in \'xx
// escapes. Outside this range, byte value == Unicode code point (Latin-1).
const CP1252 = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

// Control destinations whose text content is never lyrics — skipped wholesale.
// (colortbl is NOT in this set: it is handled specially below so \cf colour
// references can resolve to hex when recovering formatting runs.)
const RTF_SKIP_DEST = new Set([
  'fonttbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer',
  'pnseclvl', 'listtable', 'revtbl', 'generator', 'datastore', 'themedata',
  'colorschememapping', 'latentstyles', 'rsidtbl',
]);

// Resolve a colour-table index to a #rrggbb string, or null when output should
// defer to the template: index 0 (auto/default), an unknown index, or the
// near-universal EW defaults black/white — emitting those as runs would fight
// Cue's theme on every slide.
function resolveRtfColour(palette, idx) {
  if (!idx || idx < 0 || idx >= palette.length) return null;
  const hex = palette[idx];
  if (!hex) return null;
  const lc = hex.toLowerCase();
  return (lc === '#000000' || lc === '#ffffff') ? null : hex;
}

// RTF → { text, styles }. `text` is identical to the old plain-text output;
// `styles` is a parallel array — one entry per UTF-16 code unit of `text` —
// each { bold, italic, underline, color } (color = hex or null). Newlines/tabs
// carry the current style so a multi-line emphasised block stays one run.
// Tracks \b \i \ul (scoped to RTF {…} groups via the brace stack) and \cf,
// parsing \colortbl so \cf resolves. \fs/\f (size/family) are intentionally
// ignored — EW absolute metrics fight Cue's template/theme-driven sizing.
function rtfToRich(rtf) {
  if (!rtf) return { text: '', styles: [] };
  let out = '';
  const styles = [];
  const palette = [];         // colour table; index 0 == auto
  const cur = { b: false, i: false, u: false, cf: 0 };
  const stack = [];
  let ignore = false;         // current destination produces no text
  let ucSkip = 1;             // \uc — chars to skip after each \u
  let skip = 0;               // remaining unicode-fallback chars to swallow
  let inColorTbl = false;     // inside \colortbl — collect triplets, emit no text
  let colorTblDepth = -1;     // brace depth at which \colortbl opened
  let trip = {};              // colour triplet being accumulated
  let i = 0;
  const n = rtf.length;

  const snap = () => ({ bold: cur.b, italic: cur.i, underline: cur.u, color: resolveRtfColour(palette, cur.cf) });
  const emit = (s) => { out += s; const st = snap(); for (let k = 0; k < s.length; k++) styles.push(st); };

  while (i < n) {
    const c = rtf[i];

    if (c === '{') { stack.push({ ignore, ucSkip, style: { ...cur } }); i++; continue; }
    if (c === '}') {
      const s = stack.pop();
      if (s) { ignore = s.ignore; ucSkip = s.ucSkip; cur.b = s.style.b; cur.i = s.style.i; cur.u = s.style.u; cur.cf = s.style.cf; }
      if (inColorTbl && stack.length < colorTblDepth) inColorTbl = false;
      i++; continue;
    }

    if (c === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (skip > 0) skip--; else if (!ignore) emit(next);
        i += 2; continue;
      }
      if (next === '*') { ignore = true; i += 2; continue; } // ignorable destination
      if (next === "'") {
        const code = parseInt(rtf.substr(i + 2, 2), 16);
        i += 4;
        if (skip > 0) { skip--; continue; }
        if (!ignore && !isNaN(code)) emit(CP1252[code] ?? String.fromCharCode(code));
        continue;
      }
      const m = /^\\([a-z]+)(-?\d+)?[ ]?/i.exec(rtf.slice(i));
      if (m) {
        const word = m[1].toLowerCase();
        const param = m[2] != null ? parseInt(m[2], 10) : null;
        i += m[0].length;
        if (inColorTbl) {
          if (word === 'red') trip.r = param ?? 0;
          else if (word === 'green') trip.g = param ?? 0;
          else if (word === 'blue') trip.b = param ?? 0;
          continue;
        }
        if (word === 'par' || word === 'line' || word === 'sect') { if (!ignore) emit('\n'); }
        else if (word === 'tab') { if (!ignore) emit('\t'); }
        else if (word === 'uc') { ucSkip = param ?? 1; }
        else if (word === 'u' && param != null) {
          if (!ignore) emit(String.fromCodePoint(param < 0 ? param + 65536 : param));
          skip = ucSkip;
        }
        else if (word === 'b') cur.b = param !== 0;        // \b on, \b0 off
        else if (word === 'i') cur.i = param !== 0;
        else if (word === 'ul') cur.u = param !== 0;       // \ul on, \ul0 off
        else if (word === 'ulnone') cur.u = false;
        else if (word === 'cf') cur.cf = param ?? 0;
        else if (word === 'plain') { cur.b = cur.i = cur.u = false; cur.cf = 0; }
        else if (word === 'colortbl') { ignore = true; inColorTbl = true; colorTblDepth = stack.length; trip = {}; }
        else if (RTF_SKIP_DEST.has(word)) { ignore = true; }
        continue;
      }
      i++; continue; // stray backslash
    }

    if (inColorTbl && c === ';') {
      palette.push(('r' in trip || 'g' in trip || 'b' in trip)
        ? '#' + [trip.r, trip.g, trip.b].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('')
        : null);                                            // bare ';' == auto entry
      trip = {};
      i++; continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; } // RTF line breaks aren't content
    if (skip > 0) { skip--; i++; continue; }
    if (!ignore) emit(c);
    i++;
  }
  return { text: out, styles };
}

// Recover Cue formatting from the styled RTF source for one final section.
// Sound because the entire EW pipeline (per-line trim, blank-run collapse,
// parseSections/cleanLine, chord strip) only ever DELETES characters — so the
// cleaned `content` is always a subsequence of `srcText`, and a greedy
// two-pointer walk maps each surviving char back to its source style. Attributes
// uniform across the whole section are promoted to section-level style; only
// intra-section variation becomes runs. Returns a style_json STRING, or null
// when nothing was captured (preserving the all-default ⇒ null invariant).
function deriveStyleJson(content, srcText, srcStyles) {
  if (!content) return null;
  const cs = new Array(content.length);
  let p = 0;
  for (let k = 0; k < content.length; k++) {
    const ch = content[k];
    // The slide-break marker is injected after the fact (it's not in the RTF
    // source), so it has no style and must not advance the source pointer — else
    // the subsequence alignment derails for every char after it.
    if (ch === SLIDE_BREAK) { cs[k] = null; continue; }
    while (p < srcText.length && srcText[p] !== ch) p++;
    cs[k] = p < srcText.length ? srcStyles[p] : null;
    p++;
  }
  // Promote attributes uniform across every non-whitespace char to section level.
  const nz = [];
  for (let k = 0; k < content.length; k++) if (!/\s/.test(content[k]) && cs[k]) nz.push(cs[k]);
  if (!nz.length) return null;
  const base = {};
  if (nz.every((s) => s.bold)) base.bold = true;
  if (nz.every((s) => s.italic)) base.italic = true;
  if (nz.every((s) => s.underline)) base.underline = true;
  const c0 = nz[0].color;
  if (c0 && nz.every((s) => s.color === c0)) base.color = c0;
  // Residual (non-promoted) formatting → coalesced runs over content offsets.
  const runs = [];
  let run = null;
  for (let k = 0; k < content.length; k++) {
    const s = cs[k];
    const r = s ? {
      bold: s.bold && !base.bold,
      italic: s.italic && !base.italic,
      underline: s.underline && !base.underline,
      color: s.color && s.color !== base.color ? s.color : null,
    } : null;
    const active = r && (r.bold || r.italic || r.underline || r.color);
    if (!active) { if (run) { runs.push(run); run = null; } continue; }
    const key = `${r.bold}|${r.italic}|${r.underline}|${r.color || ''}`;
    if (run && run._key === key) { run.end = k + 1; continue; }
    if (run) runs.push(run);
    run = { start: k, end: k + 1, _key: key };
    if (r.bold) run.bold = true;
    if (r.italic) run.italic = true;
    if (r.underline) run.underline = true;
    if (r.color) run.color = r.color;
  }
  if (run) runs.push(run);
  runs.forEach((r) => delete r._key);
  if (!Object.keys(base).length && !runs.length) return null;
  return JSON.stringify(runs.length ? { ...base, runs } : base);
}

// Read an EasyWorship song library. The picked file is either Songs.db or
// SongWords.db; its sibling is resolved in the same folder. Lyrics (RTF) live in
// SongWords.word keyed by song.rowid. Returns one preview row per song.
function parseEasyWorship(dbPath) {
  const dir = path.dirname(dbPath);
  const sibling = (name) => {
    // Case-insensitive sibling lookup (EasyWorship casing varies by platform).
    const target = name.toLowerCase();
    const hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === target);
    return hit ? path.join(dir, hit) : path.join(dir, name);
  };
  const songsPath = path.basename(dbPath).toLowerCase() === 'songwords.db' ? sibling('Songs.db') : dbPath;
  const wordsPath = path.basename(dbPath).toLowerCase() === 'songwords.db' ? dbPath : sibling('SongWords.db');

  if (!fs.existsSync(songsPath)) throw new Error('Songs.db not found beside the selected file.');
  if (!fs.existsSync(wordsPath)) throw new Error('SongWords.db not found beside the selected file.');

  const songsDb = new Database(songsPath, { readonly: true, fileMustExist: true });
  const wordsDb = new Database(wordsPath, { readonly: true, fileMustExist: true });
  try {
    const words = new Map();
    for (const row of wordsDb.prepare('SELECT song_id, words FROM word').all()) {
      words.set(row.song_id, row.words);
    }
    // Plain SELECT only — the song table's title/author/etc. columns carry a custom
    // UTF8_U_CI collation that isn't registered in this SQLite build, so any SQL
    // comparison/ORDER BY on them throws "no such collation sequence". Retrieval
    // doesn't invoke the collation; we sort by title in JS afterwards.
    const songs = songsDb.prepare(
      'SELECT rowid, title, author, copyright, administrator FROM song'
    ).all();
    songs.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }));

    return songs.map((s) => {
      const rtf = words.get(s.rowid);
      // EasyWorship pads lines with leading tabs / trailing spaces — trim per line
      // (worship lyrics never rely on indentation) and collapse blank-line runs so
      // the header/blank-block parser sees clean section boundaries. `rawText` +
      // `styles` keep the un-trimmed source for run recovery: every transform
      // below only deletes chars, so each section's content stays a subsequence
      // of rawText and deriveStyleJson can re-align it (see deriveStyleJson).
      const { text: rawText, styles } = rtf ? rtfToRich(rtf) : { text: '', styles: [] };
      const text = rawText
        ? rawText.split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
        : '';
      const sections = text ? parseSections(text, { stripAnnotations: true }) : [];
      const copyright = [s.copyright, s.administrator].map((x) => (x || '').trim()).filter(Boolean).join(' · ') || null;
      return {
        ok: sections.length > 0,
        file: 'EasyWorship',
        format: 'EasyWorship',
        title: (s.title || '').trim() || 'Untitled',
        author: (s.author || '').trim() || null,
        copyright,
        sections: sections.map((x) => {
          // EasyWorship keeps a verse's multiple slides as blank-line-separated
          // stanzas under one header. Turn each internal blank line into a slide
          // break so the section imports as variable-size parts (one slide per
          // stanza) instead of a single oversized slide.
          const content = x.content.replace(/\n[ \t]*\n+/g, `\n${SLIDE_BREAK}\n`);
          return {
            type: ALLOWED_TYPES.has(x.type) ? x.type : 'verse',
            content,
            style_json: deriveStyleJson(content, rawText, styles),
          };
        }),
        error: sections.length ? undefined : 'No lyrics found for this song.',
      };
    });
  } finally {
    songsDb.close();
    wordsDb.close();
  }
}

// ── GHS hymnal (bundled) ──────────────────────────────────────────────────────

// Convert the bundled GHS hymnal items ({ number, name, lyrics }) into preview
// rows. Title is "GHS N - Name"; every row carries the 'GHS' tag so it lands in
// the GHS folder while still appearing under All Songs.
export function parseGhsItems(items) {
  return (items || []).map((it) => {
    const title = `GHS ${it.number}${it.name ? ' - ' + it.name : ''}`;
    const text = (it.lyrics || '').split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const sections = text ? parseSections(text) : [];
    return {
      ok: sections.length > 0,
      file: `GHS ${it.number}`,
      format: 'GHS',
      title,
      author: null,
      copyright: null,
      tags: ['GHS'],
      sections: sections.map((s) => ({ type: ALLOWED_TYPES.has(s.type) ? s.type : 'verse', content: s.content })),
      error: sections.length ? undefined : 'No lyrics found.',
    };
  });
}

// First 16 bytes as latin1 — used to sniff SQLite without reading a binary DB as UTF-8.
function fileHead(fp) {
  const fd = fs.openSync(fp, 'r');
  try { const buf = Buffer.alloc(16); fs.readSync(fd, buf, 0, 16, 0); return buf.toString('latin1'); }
  finally { fs.closeSync(fd); }
}

// Parse a raw lyric blob (scraped from the web, or pasted) into Cue sections,
// reusing the SAME header/blank-line parser as file import + Paste Song so a
// scraped song splits into verses/chorus/etc. exactly like every other path.
// Returns [{ type, content }]; an empty array when nothing usable parsed.
export function parseLyricsToSections(rawText) {
  const text = String(rawText || '')
    .replace(/\r\n?/g, '\n')
    .split('\n').map((l) => l.replace(/[ \t]+$/g, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return [];
  return parseSections(text).map((s) => ({
    type: ALLOWED_TYPES.has(s.type) ? s.type : 'verse',
    content: s.content,
  }));
}

// ── Public API ────────────────────────────────────────────────────────────────

// Parse each file into a preview object. Never throws — a per-file failure is
// reported as { ok:false, error } so one bad file doesn't abort the batch.
export function parseSongFiles(filePaths) {
  const results = [];
  for (const fp of (filePaths || [])) {
    const fallbackTitle = path.basename(fp).replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled';
    try {
      const ext = path.extname(fp).toLowerCase();
      // EasyWorship libraries are SQLite — one file expands to many song rows.
      if (ext === '.db' || fileHead(fp).startsWith('SQLite format 3')) {
        results.push(...parseEasyWorship(fp));
        continue;
      }
      const raw = fs.readFileSync(fp, 'utf8');
      const looksXml = ext === '.xml' || /^\s*<\?xml|<song\b/i.test(raw.slice(0, 500));
      let parsed, format;
      if (looksXml) {
        if (!/<lyrics\b|<verse\b|openlyrics/i.test(raw)) throw new Error('Not an OpenLyrics file.');
        parsed = parseOpenLyrics(raw, fallbackTitle);
        format = 'OpenLyrics';
      } else {
        parsed = parseTextOrChordPro(raw, fallbackTitle);
        format = /^\s*\{[a-z_]+\s*:|\[[A-G][#b]?(?:maj|min|sus|dim|aug|add|m|M)?\d*\]/im.test(raw) ? 'ChordPro' : 'Text';
      }
      parsed.sections = parsed.sections.map((s) => ({
        type: ALLOWED_TYPES.has(s.type) ? s.type : 'verse',
        content: s.content,
      }));
      results.push({ ok: true, file: path.basename(fp), format, ...parsed });
    } catch (e) {
      results.push({ ok: false, file: path.basename(fp), format: null, title: fallbackTitle, author: null, copyright: null, sections: [], error: e.message });
    }
  }
  return results;
}
