// Lyrics → song sections. The ONE parser behind every "turn a blob of lyric text
// into Verse/Chorus/…" path: Song Editor → Paste, file import (plain text /
// ChordPro / EasyWorship / GHS), the web lyric scraper, and the set-list matcher's
// "create this song from the pasted lyrics" flow. Pure (no DOM, no Node), so the
// renderer and main both import it and it unit-tests in plain node.
//
// The input is whatever the choir sends: WhatsApp-bold headers ("*Verse 1*"),
// singer names glued onto section labels ("Verse 1 — Mary", "Mary: Chorus",
// "CHORUS (Mary & John) x2"), voice-part directives on their own line ("All",
// "Men:", "Leader:"), chord-only lines, SongSelect/CCLI footers, and "Repeat
// chorus" placeholders instead of the chorus written out again. None of that is
// lyric text — it must never reach a slide.
//
// INVARIANT (EasyWorship run recovery, songs-import.js deriveStyleJson): every
// transform here only DELETES characters from a line or drops whole lines — never
// rewrites or inserts text — so each section's content stays a subsequence of the
// source. Don't add a transform that substitutes characters.

const SLIDE_BREAK_CHAR = '⁂';

export const SECTION_TYPES = ['verse', 'chorus', 'refrain', 'bridge', 'pre-chorus', 'tag', 'intro', 'outro'];

// Section keyword → type. Order is irrelevant; KEYWORD_RE sorts longest-first.
// `ambiguous` keywords are ordinary English words ("bridge", "end", "build"), so a
// line starting with one is only a header when the rest of the line is clearly an
// annotation (a number, a separator, a repeat marker) — "Bridge over troubled
// water" stays a lyric.
const KEYWORDS = {
  verse: 'verse', verses: 'verse', vs: 'verse', vrs: 'verse', v: 'verse', stanza: 'verse',
  chorus: 'chorus', cho: 'chorus', chor: 'chorus', chr: 'chorus', ch: 'chorus', c: 'chorus', hook: 'chorus',
  refrain: 'refrain', ref: 'refrain',
  'pre-chorus': 'pre-chorus', 'pre chorus': 'pre-chorus', prechorus: 'pre-chorus', 'pre-ch': 'pre-chorus',
  'pre ch': 'pre-chorus', pre: 'pre-chorus', pc: 'pre-chorus', channel: 'pre-chorus', lift: 'pre-chorus', build: 'pre-chorus',
  bridge: 'bridge', br: 'bridge', brg: 'bridge', b: 'bridge', 'middle 8': 'bridge', 'middle eight': 'bridge', interlude: 'bridge',
  breakdown: 'bridge', 'instrumental bridge': 'bridge',
  tag: 'tag', vamp: 'tag', 'post-chorus': 'tag', 'post chorus': 'tag', postchorus: 'tag', chant: 'tag', 'ad lib': 'tag', adlib: 'tag',
  intro: 'intro', introduction: 'intro',
  outro: 'outro', ending: 'outro', end: 'outro', coda: 'outro', finale: 'outro',
};
const AMBIGUOUS = new Set(['bridge', 'end', 'build', 'lift', 'channel', 'hook', 'chant', 'breakdown', 'stanza', 'pre', 'ref', 'b', 'c', 'v', 'pc', 'tag', 'ending', 'intro']);
// Single letters ("C", "B") double as chord names — only a header with a number,
// a colon, or brackets around it ("V1", "C:", "[B]").
const SINGLE_LETTER = new Set(['v', 'c', 'b']);

const KW_LOOKUP = new Map(Object.entries(KEYWORDS).map(([k, t]) => [k.replace(/[-\s]/g, ''), [k, t]]));
const KW_ALT = Object.keys(KEYWORDS).sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/[-]/g, '[-\\s]?').replace(/ /g, '[-\\s]?')).join('|');
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, last: null, final: null,
  i: 1, ii: 2, iii: 3, iv: 4, vi: 6, vii: 7 };
const NUM_ALT = '\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|iii|ii|iv|vii|vi|i';

// "[2nd ] Verse[.] [2|two|II][a]" then the rest of the line.
const CORE_RE = new RegExp(
  `^(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+|(first|second|third|fourth|fifth|sixth|last|final)\\s+)?` +
  `(${KW_ALT})\\.?(?![a-z])\\s*(?:#\\s*)?(${NUM_ALT})?(?![a-z]{2})([a-wyz])?(?![a-z])\\s*(.*)$`, 'i');

// Performance / voice-part directive words: WHO sings or HOW. A line made only of
// these (plus names and repeat counts) is a directive, never lyric.
const ROLE_TOKENS = new Set([
  'all', 'unison', 'solo', 'duet', 'trio', 'everyone', 'everybody', 'group', 'together', 'tutti',
  'men', 'man', 'male', 'males', 'women', 'woman', 'female', 'females', 'ladies', 'lady', 'gents', 'guys',
  'boys', 'boy', 'girls', 'girl', 'kids', 'child', 'children', 'youth', 'adults',
  'soprano', 'sopranos', 'alto', 'altos', 'tenor', 'tenors', 'bass', 'basses', 'baritone', 'baritones',
  'descant', 'harmony', 'harmonies', 'melody', 'part', 'parts', 'voices', 'voice', 'backing', 'bv', 'bvs',
  'lead', 'leader', 'leaders', 'worship leader', 'song leader', 'cantor', 'choir', 'chorale', 'band', 'team',
  'congregation', 'cong', 'people', 'response', 'call', 'caller', 'responder',
  'spoken', 'speak', 'sung', 'shout', 'whisper', 'hum', 'humming', 'clap', 'clapping',
  'instrumental', 'instrumentals', 'interlude', 'musical', 'music', 'ending', 'intro', 'outro',
  'vamp', 'reprise', 'modulation', 'modulate', 'key change', 'repeat', 'optional', 'echo',
  'acapella', 'acappella', 'a cappella', 'spontaneous', 'adlib', 'ad lib', 'ad-lib', 'free worship',
  'slow', 'slowly', 'soft', 'softly', 'loud', 'build', 'building', 'fast', 'faster', 'up tempo', 'uptempo',
  'drums', 'drums only', 'keys', 'keys only', 'piano', 'guitar', 'only', 'twice', 'again', 'x2', 'x3', 'x4',
  'pause', 'stop', 'break', 'hold', 'ritard', 'rit', 'fine', 'end', 'segue', 'medley', 'tag',
]);
// The subset of ROLE_TOKENS that is unambiguous on its own: nobody sings a line
// that is just "Sopranos" or "Unison". Everything else in ROLE_TOKENS ("echo",
// "hold", "people", "again", "end"…) is an ordinary lyric word and only counts as a
// cue when the line is explicitly marked as one — wrapped in ( ) / [ ] or ending ":".
const STRONG_CUES = new Set([
  'all', 'unison', 'solo', 'duet', 'trio', 'quartet', 'tutti', 'men', 'women', 'ladies', 'gents',
  'soprano', 'sopranos', 'alto', 'altos', 'tenor', 'tenors', 'bass', 'basses', 'baritone', 'baritones', 'descant',
  'leader', 'worship leader', 'song leader', 'cantor', 'choir', 'chorale', 'congregation', 'cong', 'bv', 'bvs',
  'instrumental', 'instrumentals', 'interlude', 'vamp', 'reprise', 'modulation', 'key change',
  'acapella', 'acappella', 'a cappella', 'adlib', 'ad lib', 'ad-lib', 'spontaneous', 'free worship', 'humming', 'clapping',
]);

// Glue words allowed inside an annotation ("sung by Mary and the choir").
const ANNOTATION_GLUE = new Set(['and', 'the', 'by', 'with', 'led', 'lead', 'sung', 'sang', 'sings', 'then', 'on', 'of', 'to', 'in', 'only', 'from', 'for', 'at', 'a', 'times', 'time']);

const REPEAT_RE = /^(?:\(?\s*(?:x\s*\d+|\d+\s*x|[*×]\s*\d+|\d+\s*times?|twice|thrice|again|repeat(?:ed)?(?:\s*all)?)\s*\)?[\s,.]*)+$/i;
const REPEAT_PREFIX_RE = /^(?:repeat(?:\s+the)?|back\s+to(?:\s+the)?|go\s+(?:back\s+)?to(?:\s+the)?|sing(?:\s+the)?|then(?:\s+the)?|and(?:\s+the)?|return\s+to(?:\s+the)?)\s+/i;
const REPEAT_SUFFIX_RE = /\s*\(?\s*(?:x\s*\d+|\d+\s*x|[*×]\s*\d+|\d+\s*times?|twice|thrice|again|repeat(?:ed)?)\s*\)?\s*$/i;

const ZW_RE = /[​-‍⁠﻿]/g;
// A guitar-chord token, bare or bracketed: C, G7, Am, D/F#, Bbmaj7, Csus4, F#m7b5.
const CHORD_TOKEN = '[A-G](?:#|b|♯|♭)?(?:maj|min|sus|dim|aug|add|m|M|°|ø|\\+)?\\d*(?:(?:sus|add|maj|b|#)\\d+)*(?:\\/[A-G](?:#|b|♯|♭)?)?';
const CHORD_ONLY_RE = new RegExp(`^(?:\\s*(?:\\[?${CHORD_TOKEN}\\]?|[|/\\-.]|N\\.?C\\.?|x\\d))+\\s*$`);
const INLINE_CHORD_RE = new RegExp(`\\[${CHORD_TOKEN}\\]`, 'g');

// Metadata lines that ride along with pasted lyrics (SongSelect / CCLI footers,
// musician charts). Captured into song metadata, never kept as lyric.
const META_LINE_RES = [
  /^(?:key|original key|song key|capo|tempo|bpm|time\s+signature|meter|time sig)\s*[:\-–]\s*\S.{0,30}$/i,
  /^(?:original\s+)?key\s+(?:of\s+)?[A-G](?:#|b|♯|♭)?m?(?:\s*(?:major|minor))?\s*$/i,
  /^(?:capo\s+\d{1,2}|tempo\s+\d{2,3})\b.{0,20}$/i,
  /^\d{2,3}\s*bpm$/i,
  /^for use solely with the songselect/i,
  /^(?:all rights reserved|used by permission|www\.ccli\.com|songselect)/i,
  /^ccli\s*(?:licen[cs]e|lic\.?)\s*(?:#|no\.?|number)?\s*:?\s*\d+/i,
  /^\(?\s*(?:words|music|lyrics|written|composed)(?:\s+(?:and|&)\s+music)?\s+by\s+[A-Z].{0,80}$/,
];
const CCLI_SONG_RE = /^ccli\s*(?:song)?\s*(?:#|no\.?|number)?\s*:?\s*(\d{3,})\s*$/i;
const COPYRIGHT_RE = /^(?:©|\(c\)|copyright\b)/i;

function stripInvisible(s) {
  return String(s ?? '').replace(ZW_RE, '').replace(/ /g, ' ');
}

// Peel formatting wrappers a header is often typed in: WhatsApp/markdown
// emphasis (*Verse 1*, _Chorus_, **Bridge**), heading hashes, rule dashes
// ("--- Chorus ---", "== V1 =="), bullets, and enclosing brackets.
function unwrap(line) {
  let t = stripInvisible(line).trim();
  let wrapped = false;
  for (let guard = 0; guard < 4; guard++) {
    const before = t;
    t = t.replace(/^[#>•▪►➤◆●\-–—=~*_\s]+/, '').replace(/[\-–—=~*_\s]+$/, '').trim();
    const m = /^\[(.*)\]$|^\((.*)\)$|^\{(.*)\}$|^<(.*)>$/.exec(t);
    if (m) { t = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim(); wrapped = true; }
    if (t === before) break;
  }
  // A lone trailing colon belongs to the header, not the annotation.
  t = t.replace(/\s*:\s*$/, '').trim();
  return { text: t, wrapped };
}

// Misspelt section words ("Chrous:", "Vrese 2", "Corus") — only the long, unambiguous
// keywords, within edit distance 2 (1 for 5-letter words), and only on a short
// header-shaped line (colon / brackets / number), so ordinary lyric words never match.
const FUZZY_KW = { verse: 'verse', chorus: 'chorus', bridge: 'bridge', refrain: 'refrain', prechorus: 'pre-chorus' };
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
function fuzzyKeyword(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 4) return null;
  for (const [k, t] of Object.entries(FUZZY_KW)) {
    if (w === k) return t;
    const tol = k.length <= 5 ? 1 : 2;
    if (Math.abs(w.length - k.length) <= tol && editDistance(w, k) <= tol) return t;
  }
  return null;
}

function isCapWord(w) { return /^[A-ZÀ-Þ][\p{L}'’.\-]*$/u.test(w); }

// Classify the text that FOLLOWS a section keyword. Returns
//   { kind: 'none' }                       nothing after it
//   { kind: 'annotation', names, repeat }  singer names / directives / "x2"
//   { kind: 'lyric', text }                the first lyric line ("Chorus: Way maker…")
//   null                                   not a header at all ("Bridge over troubled water")
function classifyRest(rest, { hasNum, ambiguous, sep }) {
  let r = rest.trim();
  if (!r) return { kind: 'none', names: [], repeat: false };
  let repeat = false;
  if (REPEAT_SUFFIX_RE.test(r)) { repeat = true; r = r.replace(REPEAT_SUFFIX_RE, '').trim(); }
  if (REPEAT_RE.test(r)) return { kind: 'annotation', names: [], repeat: true };
  // Unwrap a parenthesised annotation: "(Mary)", "(Men) x2".
  r = r.replace(/^[(\[]\s*|\s*[)\]]$/g, '').trim();
  r = r.replace(/^[-–—:|/,]\s*/, '').trim();
  if (!r) return { kind: 'annotation', names: [], repeat };
  if (REPEAT_RE.test(r)) return { kind: 'annotation', names: [], repeat: true };

  const words = r.replace(/[(),;]/g, ' ').split(/\s+|\s*[&+\/]\s*/).filter(Boolean);
  const names = [];
  let lyricish = 0;
  for (const w of words) {
    const lw = w.toLowerCase().replace(/[.:!?]+$/, '');
    if (!lw) continue;
    if (ROLE_TOKENS.has(lw) || ANNOTATION_GLUE.has(lw) || /^x?\d+x?$/.test(lw) || /^\d+(?:st|nd|rd|th)$/.test(lw)) continue;
    if (isCapWord(w) && w.length <= 20) { names.push(w.replace(/[.:!?,]+$/, '')); continue; }
    lyricish++;
  }
  // Pure annotation: names / roles / repeat counts only, short.
  if (lyricish === 0 && words.length <= 8) {
    // An ambiguous keyword with a bare name and no number or separator ("Bridge
    // Street") is too risky to call a header.
    if (ambiguous && !hasNum && !sep && names.length && words.length === names.length) return null;
    return { kind: 'annotation', names, repeat };
  }
  // Explicit "Header: lyric text" — the rest is the first line of the section.
  if (sep === ':' || sep === '-' || sep === '–' || sep === '—' || sep === '|') {
    if (words.length >= 3 || lyricish >= 2) return { kind: 'lyric', text: rest.trim().replace(/^[-–—:|]\s*/, ''), repeat: false };
  }
  return null;
}

// Parse one line as a section header. Returns null for a lyric line, else
//   { type, num, names, repeat, wrapped, tail }   tail = inline first lyric line
export function parseHeaderLine(line) {
  const raw = stripInvisible(line).trim();
  if (!raw || raw.length > 90) return null;
  const { text, wrapped } = unwrap(raw);
  if (!text) return null;

  // Repeat-placeholder phrasing: "Repeat Chorus", "Back to the chorus", "Chorus again".
  let body = text;
  let repeat = false;
  if (REPEAT_PREFIX_RE.test(body)) {
    const stripped = body.replace(REPEAT_PREFIX_RE, '');
    if (CORE_RE.test(stripped)) { body = stripped; repeat = true; }
  }

  let m = CORE_RE.exec(body);
  let leadNames = [];
  if (!m) {
    // Name-first form: "Mary - Verse 1", "Mary & John: Chorus", "(Mary) Verse 2", "Men – Chorus".
    const nf = /^\(?([\p{L}'’.]+(?:\s*(?:&|and|\+|,|\/)\s*[\p{L}'’.]+|\s+[\p{L}'’.]+){0,3})\)?\s*(?:[-–—:|/]\s*|\s+)(.+)$/u.exec(body);
    if (nf) {
      const nameWords = nf[1].split(/\s*(?:&|and|\+|,|\/)\s*|\s+/).filter(Boolean);
      const allNames = nameWords.every((w) => isCapWord(w) || ROLE_TOKENS.has(w.toLowerCase()));
      const inner = CORE_RE.exec(nf[2].trim());
      if (allNames && inner) {
        const innerRest = classifyRest(inner[6] || '', { hasNum: !!inner[4], ambiguous: true, sep: null });
        if (innerRest && innerRest.kind !== 'lyric') {
          m = inner;
          leadNames = nameWords.filter((w) => isCapWord(w) && !ROLE_TOKENS.has(w.toLowerCase()));
        }
      }
    }
    if (!m) {
      // Typo'd header: "Chrous:", "[Vrese 2]", "Corus x2".
      const fm = /^([A-Za-z]{4,12})\s*(\d{1,2})?\s*(.*)$/.exec(body);
      const looksHeader = wrapped || /:\s*$/.test(raw) || (fm && fm[2]);
      const ft = fm && looksHeader ? fuzzyKeyword(fm[1]) : null;
      if (ft) {
        const cls = classifyRest(fm[3] || '', { hasNum: !!fm[2], ambiguous: true, sep: null });
        if (cls && cls.kind !== 'lyric') {
          return { type: ft, num: fm[2] ? Number(fm[2]) : null, names: cls.names || [], repeat: !!cls.repeat, wrapped, tail: null };
        }
      }
      return null;
    }
  }

  const hit = KW_LOOKUP.get(m[3].toLowerCase().replace(/[-\s]/g, ''));
  if (!hit) return null;
  const [kwKey, type] = hit;

  const numStr = m[4] ? m[4].toLowerCase() : null;
  const ordStr = m[1] || (m[2] ? m[2].toLowerCase() : null);
  let num = null;
  if (numStr) num = /^\d+$/.test(numStr) ? Number(numStr) : (NUM_WORDS[numStr] ?? null);
  else if (ordStr) num = /^\d+$/.test(ordStr) ? Number(ordStr) : (NUM_WORDS[ordStr] ?? null);
  // A roman "i"/"v" right after the keyword is really ambiguous with a letter
  // suffix ("Verse 1a") — only trust it as a number when it stands alone.
  const letter = m[5] || '';
  const rest = m[6] || '';
  const sepM = /^\s*([-–—:|/(])/.exec(rest);
  const sep = sepM ? sepM[1] : null;
  const hasNum = num != null || !!letter;
  const isSingle = SINGLE_LETTER.has(kwKey);
  // Bare single letter: only "[V]" / "C:" with nothing else on the line.
  if (isSingle && !hasNum && (rest.trim() || !(wrapped || /:\s*$/.test(raw)))) return null;
  // A bare ambiguous word as the whole line ("End", "Bridge") is still a header —
  // that's how charts write it — but a multi-letter lowercase lyric is not.
  const cls = classifyRest(rest, { hasNum, ambiguous: AMBIGUOUS.has(kwKey), sep });
  if (!cls) return null;
  // A header with inline lyric text must look deliberate: "Chorus:" form.
  if (cls.kind === 'lyric' && isSingle && !hasNum) return null;
  return {
    type,
    num,
    names: [...leadNames, ...(cls.names || [])],
    repeat: repeat || !!cls.repeat,
    wrapped,
    tail: cls.kind === 'lyric' ? cls.text : null,
  };
}

// "Solo - Tammi", "Duet – Tammi & Mary", "Lead: John", "All (Choir)", "Tammi - Solo":
// a voice-part word plus 1–3 capitalised names, nothing else. Returns the names
// (lowercased) or null. Lyrics never have this shape: "All - Glory to God" fails
// because "to" isn't a capitalised name, "Solo" alone is caught elsewhere.
const VOICE_PARTS = new Set(['solo', 'duet', 'trio', 'quartet', 'lead', 'leader', 'all', 'choir', 'call', 'response',
  'men', 'women', 'ladies', 'gents', 'sopranos', 'soprano', 'altos', 'alto', 'tenors', 'tenor', 'bass', 'basses',
  'unison', 'harmony', 'cantor', 'worship leader', 'song leader', 'backing', 'bv', 'bvs', 'kids', 'youth', 'congregation']);
// Capitalised words that are lyrics, not singers ("Leader: Hallelujah").
const WORSHIP_WORDS = new Set(['faith', 'hope', 'joy', 'mercy', 'peace', 'light', 'life', 'truth', 'heaven', 'zion', 'israel', 'hallelujah', 'halleluyah', 'alleluia', 'amen', 'hosanna', 'jesus', 'lord', 'god', 'christ',
  'father', 'spirit', 'holy', 'glory', 'praise', 'worthy', 'yahweh', 'jehovah', 'emmanuel', 'immanuel', 'king', 'saviour',
  'savior', 'messiah', 'redeemer', 'abba', 'adonai', 'elohim', 'oh', 'yes', 'yeah', 'thank', 'thanks', 'grace', 'love', 'jah']);
export function roleWithNames(line) {
  const t = stripInvisible(line).trim().replace(/[.:;,!]+\s*$/, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 48) return null;
  const parts = t.split(/\s*[-–—:|([\]]\s*/).map((x) => x.replace(/[)\]]/g, '').trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  let role = false;
  const names = [];
  for (const part of parts) {
    if (VOICE_PARTS.has(part.toLowerCase())) { role = true; continue; }
    const ws = part.split(/\s*(?:&|\+|,|\/)\s*|\s+and\s+|\s+/).filter(Boolean);
    if (!ws.length || ws.length > 4 || !ws.every((w) => isCapWord(w) && w.length <= 20
      && !ROLE_TOKENS.has(w.toLowerCase()) && !WORSHIP_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')))) return null;
    names.push(...ws.map((w) => w.toLowerCase().replace(/[.']+$/, '')));
  }
  return role ? names : null; // [] = voice parts only ("All (Choir)")
}

// True when a whole line is a performance/voice-part directive rather than
// lyric: "All", "Men:", "(Women)", "Leader - Mary", "x2", "Mary & John:".
// `names` = singer names learned from this paste's headers.
export function isDirectiveLine(line, names = new Set()) {
  const raw = stripInvisible(line).trim();
  if (!raw || raw.length > 48) return false;
  // Explicitly marked as a note: the whole line in ( ) / [ ], or ending with ":".
  const marked = /^[(\[].*[)\]]$/.test(raw) || /:\s*$/.test(raw);
  const { text } = unwrap(raw);
  let t = text;
  if (!t) return true;
  // Repeat counts. Bare "again" / "twice" are lyric words — only as marked notes.
  if (/^\(?\s*(?:x\s*\d+|\d+\s*x|[*×]\s*\d+|\d+\s*times?|repeat(?:\s*all)?)\s*\)?$/i.test(t)) return true;
  if (marked && REPEAT_RE.test(t)) return true;
  t = t.replace(REPEAT_SUFFIX_RE, '').trim().replace(/[.,;!?]+$/, '').trim();
  if (!t) return marked; // a bare "Again" / "Twice" is a lyric
  const isName = (w) => names.has(w) && !WORSHIP_WORDS.has(w);
  const parts = t.split(/\s*[-–—/:|,]\s*|\s+(?:&|and|\+)\s+|\s*&\s*/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return false;
  // Unmarked: every part must be a clear cue word or a known singer ("All",
  // "All - Unison", "Men & Women", "Mary & John"). Marked: ordinary role words and
  // glue are allowed too ("(echo)", "(sung by the men)", "Leader:").
  const partOk = (p) => {
    const lw = p.toLowerCase().replace(/\s*\d+$/, '').trim();
    if (/^\d+$/.test(lw)) return true;
    if (STRONG_CUES.has(lw) || isName(lw)) return true;
    if (!marked) return false;
    const ws = lw.split(/\s+/);
    return ROLE_TOKENS.has(lw) || ws.every((w) => ROLE_TOKENS.has(w) || ANNOTATION_GLUE.has(w) || isName(w))
      && ws.some((w) => ROLE_TOKENS.has(w) || isName(w));
  };
  if (parts.every(partOk)) return true;
  if (roleWithNames(t)) return true;
  // "Mary:" / "Mary & John:" alone on a line — a speaker cue (1–3 capitalised
  // words + colon), unless the words are worship words ("Lord:", "Hallelujah:").
  if (/:\s*$/.test(raw)) {
    const words = t.split(/\s+|\s*&\s*/).filter(Boolean);
    if (words.length <= 3 && words.every((w) => (isCapWord(w) && !WORSHIP_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, ''))) || ANNOTATION_GLUE.has(w.toLowerCase()))
      && words.some((w) => isCapWord(w))) return true;
  }
  return false;
}

// Strip a speaker cue glued to the front of a lyric line ("Mary: You are here",
// "Leader: Way maker", "(Men) Miracle worker") and trailing "(Mary)". Only known
// roles or names learned from this paste's headers — never an arbitrary capitalised
// word, since "Lord: …" style lyric lines exist.
function stripSpeaker(line, names) {
  const known = (s) => s.split(/\s*(?:&|and|\+|,|\/)\s*/).filter(Boolean).every((w) => {
    const lw = w.toLowerCase().trim();
    return STRONG_CUES.has(lw) || (names.has(lw) && !WORSHIP_WORDS.has(lw));
  });
  let out = line;
  let m = /^\s*([\p{L}'’]+(?:\s*(?:&|and|\+|,|\/)\s*[\p{L}'’]+){0,3})\s*:\s+(?=\S)/u.exec(out);
  if (m && known(m[1])) out = out.slice(m[0].length);
  m = /^\s*[(\[]([^()\[\]]{1,30})[)\]]\s+(?=\S)/.exec(out);
  if (m && known(m[1])) out = out.slice(m[0].length);
  m = /\s+[(\[]([^()\[\]]{1,30})[)\]]\s*$/.exec(out);
  if (m && known(m[1])) out = out.slice(0, m.index);
  return out;
}

// Length of a known speaker cue at the start of a lyric line ("Tammi: ", "(Men) "),
// 0 when none. Same rule as stripSpeaker, as a prefix length (for range removal).
function speakerPrefixLen(line, names) {
  const before = line.length;
  const stripped = stripSpeaker(line, names);
  return line.endsWith(stripped) && stripped.length < before && stripped.trim() ? before - stripped.length : 0;
}

// Names of singers a stored song's text reveals: role + name lines ("Solo - Tammi").
export function singerNamesIn(texts) {
  const names = new Set();
  for (const t of texts) for (const line of String(t || '').split('\n')) {
    const rn = roleWithNames(line);
    if (rn) rn.forEach((n) => names.add(n));
    const h = parseHeaderLine(line);
    if (h) h.names.forEach((n) => names.add(n.toLowerCase()));
  }
  return names;
}

// Clean ONE stored section: drop whole cue lines ("Solo - Tammi", "All:", "x2") and
// known speaker prefixes ("Tammi: …"), remapping style-run offsets so formatting
// stays on the same words. Delete-only. Returns null when nothing changes, else
// { content, runs, removed: [text] }. Used by the library "Clean up singer notes".
export function cleanSectionText(content, runs = [], names = new Set()) {
  const src = String(content || '');
  const lines = src.split('\n');
  const cuts = [];
  const removed = [];
  let pos = 0;
  for (const line of lines) {
    const start = pos;
    const end = pos + line.length;
    pos = end + 1;
    if (!line.trim() || line.includes(SLIDE_BREAK_CHAR)) continue;
    if (parseHeaderLine(line) && !roleWithNames(line)) continue; // a real section label is not ours to delete
    if (isDirectiveLine(line, names)) { cuts.push([start, Math.min(end + 1, src.length)]); removed.push(line.trim()); continue; }
    const n = speakerPrefixLen(line, names);
    if (n) { cuts.push([start, start + n]); removed.push(line.slice(0, n).trim()); }
  }
  if (!cuts.length) return null;
  const map = new Array(src.length + 1);
  let out = '';
  let ci = 0;
  for (let i = 0; i < src.length; i++) {
    map[i] = out.length;
    while (ci < cuts.length && i >= cuts[ci][1]) ci++;
    if (!(ci < cuts.length && i >= cuts[ci][0] && i < cuts[ci][1])) out += src[i];
  }
  map[src.length] = out.length;
  const lead = out.match(/^\n*/)[0].length;
  const text = out.slice(lead).replace(/\n+$/, '');
  const newRuns = (runs || [])
    .map((r) => ({
      ...r,
      start: Math.max(0, map[Math.min(Math.max(0, r.start), src.length)] - lead),
      end: Math.min(text.length, map[Math.min(Math.max(0, r.end), src.length)] - lead),
    }))
    .filter((r) => r.end > r.start);
  return { content: text, runs: newRuns, removed };
}

// Strip WhatsApp/markdown emphasis wrapping a whole lyric line: "*Way maker*".
function stripEmphasis(line) {
  const m = /^(\s*)([*_~]{1,2})(\S(?:.*\S)?)\2(\s*)$/.exec(line);
  return m ? m[1] + m[3] + m[4] : line;
}

const TRAILING_TAG_RE = new RegExp(`\\s*\\[(?:${KW_ALT})\\s*\\d*\\]\\s*$`, 'i');

function cleanLyricLine(line, names) {
  let t = stripInvisible(line).replace(INLINE_CHORD_RE, '').replace(/[ \t]+$/g, '');
  t = stripEmphasis(t).trim();
  t = t.replace(TRAILING_TAG_RE, '');
  t = stripSpeaker(t, names);
  t = t.replace(/^\s*[\[\(]?\d+[\]\)\.:]?\s+/, '');
  return t.trim();
}

function normKey(s) {
  return String(s || '').toLowerCase().replace(/['’‘ʼ´`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Parse lyric text into sections.
//   opts.title    — known song title; a leading line repeating it is dropped.
// Returns { sections: [{type, content}], arrangement: number[]|null,
//           title, author, copyright, names }
//   arrangement   — played order as 0-based section positions, only when the
//                   paste implied repeats ("Repeat Chorus", a chorus written out
//                   twice). null = natural order.
//   title         — a title line found above the first header ("WAY MAKER - Sinach").
export function parseLyrics(rawText, opts = {}) {
  const empty = { sections: [], arrangement: null, title: null, author: null, copyright: null, ccli: null, names: [] };
  const src = String(rawText ?? '').replace(/\r\n?/g, '\n');
  if (!src.trim()) return empty;
  let lines = src.split('\n');

  // ── Pass 1: metadata footer + learn singer names from annotated headers. ──
  let copyright = null, ccli = null, author = null;
  const names = new Set();
  const keep = [];
  for (let i = 0; i < lines.length; i++) {
    const t = stripInvisible(lines[i]).trim();
    const cm = CCLI_SONG_RE.exec(t);
    if (cm) {
      ccli = cm[1];
      // SongSelect: "CCLI Song # 123" is followed by the writers line, then ©.
      const nxt = stripInvisible(lines[i + 1] || '').trim();
      if (nxt && !COPYRIGHT_RE.test(nxt) && nxt.length < 120 && !/ccli/i.test(nxt)) { author = nxt; i++; }
      continue;
    }
    if (COPYRIGHT_RE.test(t) && t.length < 200) { copyright = copyright || t; continue; }
    if (META_LINE_RES.some((re) => re.test(t))) continue;
    if (t && CHORD_ONLY_RE.test(t) && /[A-G]/.test(t)) continue;
    const h = parseHeaderLine(lines[i]);
    if (h) for (const n of h.names) names.add(n.toLowerCase());
    else { const rn = roleWithNames(lines[i]); if (rn) rn.forEach((n) => names.add(n)); }
    keep.push(lines[i]);
  }
  lines = keep;

  // ── Pass 2: walk lines into sections. ──
  const raw = []; // { type, num, lines[], explicit, repeatOf? }
  let cur = null;
  let hasHeaders = false;
  let prevBlank = true;
  let preamble = [];       // lines before the first header (possible title)
  let sawHeader = false;
  const start = (type, num, explicit) => {
    cur = { type, num, lines: [], explicit, repeatFlag: false };
    raw.push(cur);
  };
  for (const line of lines) {
    const isBlank = !stripInvisible(line).trim();
    const h = isBlank ? null : parseHeaderLine(line);
    if (h) {
      hasHeaders = true; sawHeader = true;
      start(h.type, h.num, true);
      cur.repeatFlag = h.repeat;
      if (h.tail) { const c = cleanLyricLine(h.tail, names); if (c) cur.lines.push(c); }
      prevBlank = true;
      continue;
    }
    if (!isBlank && isDirectiveLine(line, names)) continue;
    if (/^\s*\d+[.):]?\s*$/.test(line)) { prevBlank = true; continue; }
    if (prevBlank && !isBlank) {
      // Hymn-style numbered stanza: "1. Amazing grace…" starts verse N.
      const m = stripInvisible(line).match(/^\s*(\d{1,2})[.)]?\s+(.+)$/);
      if (m) {
        hasHeaders = true; sawHeader = true;
        start('verse', Number(m[1]), true);
        const c = cleanLyricLine(m[2], names);
        if (c) cur.lines.push(c);
        prevBlank = false;
        continue;
      }
    }
    if (!sawHeader) { preamble.push(line); prevBlank = isBlank; continue; }
    if (isBlank) { cur.lines.push(''); prevBlank = true; }
    else { const c = cleanLyricLine(line, names); if (c) cur.lines.push(c); prevBlank = false; }
  }

  // Split the pre-header text into blank-line blocks of cleaned lines.
  const preBlocks = [];
  {
    let b = [];
    for (const l of preamble) {
      if (!stripInvisible(l).trim()) { if (b.length) { preBlocks.push(b); b = []; } continue; }
      const c = cleanLyricLine(l, names);
      if (c) b.push(c);
    }
    if (b.length) preBlocks.push(b);
  }

  // A lone short line above the lyrics ("WAY MAKER – Sinach") is the title, not a
  // verse — only when the caller asks (paste flows); file import keeps every line.
  let title = null;
  if (preBlocks.length && opts.title && normKey(preBlocks[0][0]) === normKey(opts.title)) {
    preBlocks[0].shift();
    if (!preBlocks[0].length) preBlocks.shift();
  } else if (opts.detectTitle && preBlocks.length && preBlocks[0].length === 1
      && (preBlocks.length > 1 || raw.length > 0)) {
    const t = preBlocks[0][0];
    if (t.length <= 70 && !/[,;]$/.test(t)) {
      const parts = unwrap(t).text.split(/\s+[-–—|]\s+|\s+by\s+/i);
      title = parts[0].trim() || null;
      // "Title – Ada" where Ada sings a verse is the leader, not the songwriter.
      const who = (parts[1] || '').trim();
      const isSinger = who && who.split(/\s*(?:&|and|,|\/)\s*/).every((w) => names.has(w.toLowerCase()));
      if (who && !author && who.length <= 60 && !isSinger) author = who;
      preBlocks.shift();
    }
  }

  if (hasHeaders) {
    // Lyrics before the first header become a leading verse.
    const leftover = preBlocks.flatMap((bl, i) => (i ? ['', ...bl] : bl));
    if (leftover.length) raw.unshift({ type: 'verse', num: null, lines: leftover, explicit: false, repeatFlag: false });
  } else {
    // Headerless: blank-line blocks. A block that recurs verbatim is the chorus.
    const counts = new Map();
    for (const bl of preBlocks) { const k = normKey(bl.join(' ')); counts.set(k, (counts.get(k) || 0) + 1); }
    for (const bl of preBlocks) {
      const k = normKey(bl.join(' '));
      raw.push({ type: counts.get(k) > 1 ? 'chorus' : 'verse', num: null, lines: bl, explicit: false, repeatFlag: false });
    }
  }

  // ── Pass 3: trim, resolve empty headers into repeats, dedupe identical repeats. ──
  const sections = [];
  const order = [];      // arrangement (positions into `sections`)
  const byKey = new Map(); // `${type}|${normalized content}` → position
  let implied = false;
  for (const r of raw) {
    while (r.lines.length && !r.lines[0]) r.lines.shift();
    while (r.lines.length && !r.lines[r.lines.length - 1]) r.lines.pop();
    const content = r.lines.reduce((acc, l) => (l === '' && acc[acc.length - 1] === '' ? acc : [...acc, l]), []).join('\n').trim();
    if (!content) {
      // Header with no lyrics ("Chorus", "Repeat Chorus x2") = sing that section again.
      if (!r.explicit) continue;
      let target = -1;
      for (let i = sections.length - 1; i >= 0; i--) {
        const s = sections[i];
        if (s.type !== r.type) continue;
        if (r.num != null && s._num != null && s._num !== r.num) continue;
        target = i; break;
      }
      if (target >= 0) { order.push(target); implied = true; }
      continue;
    }
    const k = `${r.type}|${normKey(content)}`;
    if (byKey.has(k)) { order.push(byKey.get(k)); implied = true; continue; }
    byKey.set(k, sections.length);
    order.push(sections.length);
    sections.push({ type: r.type, content, _num: r.num });
  }

  return {
    sections: sections.map(({ type, content }) => ({ type, content })),
    arrangement: implied && sections.length ? order : null,
    title,
    author,
    copyright: copyright ? (ccli ? `${copyright} · CCLI ${ccli}` : copyright) : (ccli ? `CCLI ${ccli}` : null),
    ccli,
    names: [...names],
  };
}

// Back-compat shape: just the sections.
export function parseLyricSections(rawText, opts) {
  return parseLyrics(rawText, opts).sections;
}
