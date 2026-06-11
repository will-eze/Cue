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

// Header / blank-line section parser. Ported from SongEditor.jsx's Paste Song
// parser so file import and paste behave identically.
function parseSections(rawText) {
  if (!rawText.trim()) return [];
  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const KW = 'verse|chorus|bridge|pre[-\\s]?chorus|prechorus|tag|intro|outro|refrain';
  const HEADER_PATTERNS = [
    new RegExp('^\\[(.{1,40}?)\\]\\s*:?\\s*$'),
    new RegExp(`^(${KW})\\s*\\d*\\s*:$`, 'i'),
    new RegExp(`^(${KW})\\s*\\d*$`, 'i'),
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
  if (!hasHeaders) return rawText.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).map((content) => ({ type: 'verse', content }));
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
const RTF_SKIP_DEST = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer',
  'pnseclvl', 'listtable', 'revtbl', 'generator', 'datastore', 'themedata',
  'colorschememapping', 'latentstyles', 'rsidtbl',
]);

// Minimal RTF → plain text. Handles \par/\line as newlines, \tab, \'xx (cp1252),
// \uN unicode (+\uc skip), ignorable {\* …} groups, and font/colour/style tables.
// Every other control word is silently dropped. Good enough for EasyWorship word
// bodies, which are flat paragraph lists.
function rtfToText(rtf) {
  if (!rtf) return '';
  let out = '';
  const stack = [];
  let ignore = false;   // current destination produces no text
  let ucSkip = 1;       // \uc — chars to skip after each \u
  let skip = 0;         // remaining unicode-fallback chars to swallow
  let i = 0;
  const n = rtf.length;

  while (i < n) {
    const c = rtf[i];

    if (c === '{') { stack.push({ ignore, ucSkip }); i++; continue; }
    if (c === '}') { const s = stack.pop(); if (s) { ignore = s.ignore; ucSkip = s.ucSkip; } i++; continue; }

    if (c === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (skip > 0) skip--; else if (!ignore) out += next;
        i += 2; continue;
      }
      if (next === '*') { ignore = true; i += 2; continue; } // ignorable destination
      if (next === "'") {
        const code = parseInt(rtf.substr(i + 2, 2), 16);
        i += 4;
        if (skip > 0) { skip--; continue; }
        if (!ignore && !isNaN(code)) out += CP1252[code] ?? String.fromCharCode(code);
        continue;
      }
      const m = /^\\([a-z]+)(-?\d+)?[ ]?/i.exec(rtf.slice(i));
      if (m) {
        const word = m[1].toLowerCase();
        const param = m[2] != null ? parseInt(m[2], 10) : null;
        i += m[0].length;
        if (word === 'par' || word === 'line' || word === 'sect') { if (!ignore) out += '\n'; }
        else if (word === 'tab') { if (!ignore) out += '\t'; }
        else if (word === 'uc') { ucSkip = param ?? 1; }
        else if (word === 'u' && param != null) {
          if (!ignore) out += String.fromCodePoint(param < 0 ? param + 65536 : param);
          skip = ucSkip;
        }
        else if (RTF_SKIP_DEST.has(word)) { ignore = true; }
        continue;
      }
      i++; continue; // stray backslash
    }

    if (c === '\r' || c === '\n') { i++; continue; } // RTF line breaks aren't content
    if (skip > 0) { skip--; i++; continue; }
    if (!ignore) out += c;
    i++;
  }
  return out;
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
      // the header/blank-block parser sees clean section boundaries.
      const text = rtf
        ? rtfToText(rtf).split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
        : '';
      const sections = text ? parseSections(text) : [];
      const copyright = [s.copyright, s.administrator].map((x) => (x || '').trim()).filter(Boolean).join(' · ') || null;
      return {
        ok: sections.length > 0,
        file: 'EasyWorship',
        format: 'EasyWorship',
        title: (s.title || '').trim() || 'Untitled',
        author: (s.author || '').trim() || null,
        copyright,
        sections: sections.map((x) => ({ type: ALLOWED_TYPES.has(x.type) ? x.type : 'verse', content: x.content })),
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
