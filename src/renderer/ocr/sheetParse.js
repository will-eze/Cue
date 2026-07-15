// Turn raw sheet-music OCR lines into a structured song: { title, author, copyright,
// sections:[{type,content}] }. Pure + deterministic so it's unit-tested (sheetParse.test.mjs)
// against representative OCR output — the Florence-2 model can't run headless.
//
// Sheet music is hard OCR: lyrics sit UNDER the staves broken into syllables ("A- maz- ing
// grace"), verses are prefixed with "1." / "2.", and the page is littered with musical noise
// (chord symbols, tempo/dynamics words, measure numbers). We drop the obvious noise, rejoin
// syllables, pull title/attribution/copyright off the top, then split the remaining lyrics
// into sections on verse numbers + section keywords. It is INTENTIONALLY conservative — the
// operator reviews everything in the Song Editor, so we favour keeping real lyrics over
// aggressive cleanup.

// Section keywords → the editor's SECTION_TYPES (SongEditor.jsx).
const TYPE_MAP = {
  verse: 'verse', chorus: 'chorus', refrain: 'refrain', bridge: 'bridge',
  'pre-chorus': 'pre-chorus', prechorus: 'pre-chorus', 'pre chorus': 'pre-chorus',
  tag: 'tag', intro: 'intro', outro: 'outro', coda: 'tag', ending: 'outro',
};
const KW = 'verse|chorus|refrain|bridge|pre[-\\s]?chorus|prechorus|tag|intro|outro|coda|ending';
// A whole line that is JUST a section header, optionally numbered/coloned: "Chorus", "Verse 2:", "Refrain".
const SECTION_LINE_RE = new RegExp(`^\\s*(${KW})\\s*(\\d{1,2})?\\s*[:.\\-]?\\s*$`, 'i');
// A header that leads a line but has lyric text after it: "Chorus: Amazing grace…".
const SECTION_LEAD_RE = new RegExp(`^\\s*(${KW})\\s*(\\d{1,2})?\\s*[:.\\-]\\s+(\\S.*)$`, 'i');
// A verse number leading a lyric line: "1. Amazing grace", "2) 'Twas grace".
const VERSE_NUM_RE = /^\s*(\d{1,2})\s*[.)]\s+(\S.*)$/;

const COPYRIGHT_RE = /©|®|\bcopyright\b|\bccli\b|\ball rights reserved\b|\bpublic domain\b|\badmin\b|\.com\b|\bmusic\s+services\b/i;
// Attribution: "Words: John Newton", "Music by …", "Text and tune…", "arr. …".
const ATTRIB_RE = /\b(words|music|lyrics|text|tune|melody|arr\.?|arranged|composed|author|traditional)\b/i;
const ATTRIB_LEAD_RE = /^\s*(words|music|lyrics|text|tune|arr\.?)\b/i;
// A composition/publication year — the tell-tale of a composer credit line ("John Newton, 1779").
const YEAR_RE = /\b(1[5-9]\d\d|20\d\d)\b/;

// In the header region (after the title, before lyrics start), a line is a credit rather
// than a lyric when it names an attribution keyword, carries a year, or is just a short
// name/tag. Everything above the first staff's lyrics on a hymn sheet is metadata.
function looksLikeCredit(t) {
  if (ATTRIB_RE.test(t) || YEAR_RE.test(t)) return true;
  return t.split(/\s+/).length <= 4;
}

// A token that is a bare chord symbol (C, Gm7, D/F#, Bbmaj7, F♯).
const CHORD_RE = /^[A-G](#|b|♯|♭)?(m|maj|min|dim|aug|sus|add|M)?\d{0,2}(\/[A-G](#|b|♯|♭)?)?$/;
// Whole-line musical direction / dynamics / tempo noise.
const MUSIC_NOISE_RE = /^(allegro|andante|moderato|adagio|vivace|largo|larghetto|lento|presto|grave|maestoso|cantabile|dolce|legato|staccato|rit\.?|ritard\.?|ritardando|accel\.?|accelerando|rall\.?|cresc\.?|decresc\.?|dim\.?|fine|coda|segno|capo|d\.?\s?c\.?|d\.?\s?s\.?|al\s+fine|al\s+coda|tempo|rubato|a\s+tempo|mp|mf|pp|ppp|ff|fff|fp|sfz|unison|solo|tutti|refrain\s+only|[0-9]+\s*=\s*[0-9]+|q\s*=\s*[0-9]+)\.?$/i;

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// A line worth keeping as lyric/metadata content (drop musical noise, bare numbers, single
// glyphs, chord-only lines).
function isNoiseLine(line) {
  const t = norm(line);
  if (!t) return true;
  if (/^[^A-Za-z]+$/.test(t)) return true;           // no letters at all (measure numbers, bar counts, symbols)
  if (t.length <= 1) return true;                    // stray single glyph
  if (MUSIC_NOISE_RE.test(t)) return true;
  const tokens = t.split(/\s+/);
  // A line that is entirely chord symbols (and short) is a chord row, not lyrics.
  if (tokens.length <= 8 && tokens.every((w) => CHORD_RE.test(w))) return true;
  return false;
}

// Rejoin syllables split across notes: "A- maz- ing" → "Amazing", and end-of-line hyphens.
// Only merges when a lowercase letter follows the hyphen (a real syllable break); leaves
// "self-" + capitalised/next-word alone as best it can. Lossy by nature — reviewed in-editor.
function rejoinSyllables(text) {
  return String(text || '')
    // "A- maz- ing" AND the typeset "A - maz - ing" form → "Amazing" (space before the
    // hyphen is optional; a space after + a lowercase next char marks a syllable break).
    .replace(/([A-Za-z])\s*-\s+(?=[a-z])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

function labelToType(kw, num) {
  const base = String(kw || '').toLowerCase().replace(/\s+/g, ' ').replace(/-/g, '-').trim();
  const type = TYPE_MAP[base] || TYPE_MAP[base.replace(/\s/g, '')] || 'verse';
  return { type, num: num ? Number(num) : null };
}

/**
 * @param {Array<string|{text:string}>} rawLines  OCR lines in reading order (top→bottom).
 * @returns {{title:string, author:string, copyright:string, sections:{type:string,content:string}[]}}
 */
export function structureSheet(rawLines) {
  const lines = (rawLines || [])
    .map((l) => (typeof l === 'string' ? l : l && l.text) || '')
    .map(norm)
    .filter(Boolean);

  let title = '';
  const authorLines = [];
  const copyrightLines = [];
  const body = []; // lyric lines that survive metadata extraction

  let seenLyric = false; // once true, later lines are lyrics even if they look attributional
  for (const raw of lines) {
    const t = norm(raw);
    if (isNoiseLine(t)) continue;

    if (COPYRIGHT_RE.test(t)) { copyrightLines.push(t); continue; }

    const isStructural = VERSE_NUM_RE.test(t) || SECTION_LINE_RE.test(t) || SECTION_LEAD_RE.test(t);

    // Header region: everything before the first lyric/structural line is metadata —
    // the first line is the title, the rest are credits (composer, arranger, year, tune).
    if (!seenLyric && !isStructural) {
      if (!title) { title = t; continue; }
      if (looksLikeCredit(t)) { authorLines.push(t); continue; }
      // A long, sentence-like line with the title + credits behind it → lyrics have begun.
    }

    seenLyric = true;
    body.push(t);
  }

  // ── Split the body into sections ──────────────────────────────────────────
  const sections = [];
  let cur = null; // { type, num, lines: [] }
  const push = () => {
    if (!cur) return;
    const content = rejoinSyllables(cur.lines.join('\n')).replace(/\n{2,}/g, '\n').trim();
    if (content) sections.push({ type: cur.type, content });
    cur = null;
  };
  const start = (type, num, firstLine) => {
    push();
    cur = { type, num, lines: [] };
    if (firstLine) cur.lines.push(firstLine);
  };

  for (const line of body) {
    const secLead = line.match(SECTION_LEAD_RE);
    const secLine = line.match(SECTION_LINE_RE);
    const vNum = line.match(VERSE_NUM_RE);
    if (secLead) {
      const { type, num } = labelToType(secLead[1], secLead[2]);
      start(type, num, secLead[3]);
    } else if (secLine) {
      const { type, num } = labelToType(secLine[1], secLine[2]);
      start(type, num, null);
    } else if (vNum) {
      start('verse', Number(vNum[1]), vNum[2]);
    } else {
      if (!cur) cur = { type: 'verse', num: null, lines: [] };
      cur.lines.push(line);
    }
  }
  push();

  return {
    title: title || '',
    author: authorLines.join('\n').trim(),
    copyright: copyrightLines.join('\n').trim(),
    sections,
  };
}

export default structureSheet;
