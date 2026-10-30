// Unit tests for the shared lyrics → sections parser. Run with:
//   node --experimental-detect-module src/shared/lyrics-parse.test.mjs
import { parseLyrics, parseHeaderLine, isDirectiveLine } from './lyrics-parse.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`, extra !== undefined ? JSON.stringify(extra) : ''); } };
const types = (r) => r.sections.map((s) => s.type).join(',');
const allText = (r) => r.sections.map((s) => s.content).join('\n');

// ── Header recognition: annotated / decorated forms ─────────────────────────
const HEADERS = [
  ['Verse 1', 'verse', 1], ['Verse 1:', 'verse', 1], ['VERSE 2', 'verse', 2], ['[Chorus]', 'chorus', null],
  ['Verse 1 — Mary', 'verse', 1], ['Verse 1 - Mary', 'verse', 1], ['Verse 1 – Mary & John', 'verse', 1],
  ['Verse 1: Mary', 'verse', 1], ['Verse 1 (Mary)', 'verse', 1], ['Verse 1 Mary', 'verse', 1],
  ['Mary - Verse 1', 'verse', 1], ['Mary & John: Chorus', 'chorus', null], ['(Mary) Verse 2', 'verse', 2],
  ['*Verse 1*', 'verse', 1], ['**CHORUS**', 'chorus', null], ['_Bridge_', 'bridge', null],
  ['*Verse 1 - Mary*', 'verse', 1], ['--- Chorus ---', 'chorus', null], ['## Verse 2', 'verse', 2],
  ['V1', 'verse', 1], ['V2:', 'verse', 2], ['Vs. 3', 'verse', 3], ['Ch', 'chorus', null], ['C1', 'chorus', 1],
  ['Pre-Chorus', 'pre-chorus', null], ['Pre Chorus 2', 'pre-chorus', 2], ['Prechorus', 'pre-chorus', null],
  ['Chorus x2', 'chorus', null], ['Chorus (x2)', 'chorus', null], ['Chorus 2x', 'chorus', null],
  ['Chorus (Men) x2', 'chorus', null], ['Chorus - All', 'chorus', null], ['Chorus – Unison', 'chorus', null],
  ['Verse One', 'verse', 1], ['1st Verse', 'verse', 1], ['Second Verse', 'verse', 2], ['Verse II', 'verse', 2],
  ['Middle 8', 'bridge', null], ['Bridge', 'bridge', null], ['Bridge:', 'bridge', null], ['Tag', 'tag', null],
  ['Vamp', 'tag', null], ['Ending', 'outro', null], ['Outro', 'outro', null], ['Intro', 'intro', null],
  ['Refrain', 'refrain', null], ['Repeat Chorus', 'chorus', null], ['Back to the chorus', 'chorus', null],
  ['Chorus again', 'chorus', null], ['(Repeat Chorus)', 'chorus', null], ['Verse 1a Solo- Devine', 'verse', 1],
  ['Verse 2 (sung by Mary and the choir)', 'verse', 2], ['Post-Chorus', 'tag', null], ['Channel', 'pre-chorus', null],
  ['Verse 1 - Mary/Esther', 'verse', 1], ['VERSE 1 [ADA]', 'verse', 1],
];
for (const [line, type, num] of HEADERS) {
  const h = parseHeaderLine(line);
  ok(`header: ${line}`, h && h.type === type && (num == null || h.num === num), h);
}

// Misspelt keywords on header-shaped lines.
for (const [line, type] of [['Chrous:', 'chorus'], ['[Vrese 2]', 'verse'], ['Corus 2', 'chorus'], ['Brigde:', 'bridge'], ['Refrian:', 'refrain']]) {
  const h = parseHeaderLine(line);
  ok(`typo header: ${line}`, h && h.type === type, h);
}
for (const line of ['Close to You', 'Verses:', 'Course of life:']) {
  const h = parseHeaderLine(line);
  ok(`typo guard: ${line}`, line === 'Verses:' ? !!h : h === null, h);
}

// ── Lyric lines that must NOT be read as headers ────────────────────────────
const LYRICS = [
  'Bridge over troubled water', 'Verse by verse I read Your word', 'Way maker, miracle worker',
  'C\'mon and praise Him', 'B-I-B-L-E', 'Lift Jesus higher', 'Lift Him up', 'Chorus of angels singing loud',
  'Tag, you\'re it', 'End of the road', 'Amazing grace how sweet the sound', 'C', 'Intro to the King of glory',
  'Time is filled with swift transition', 'Building on the rock',
];
for (const line of LYRICS) ok(`not a header: ${line}`, parseHeaderLine(line) === null, parseHeaderLine(line));

// Inline header + lyric: the lyric survives as the section's first line.
{
  const h = parseHeaderLine('Chorus: Way maker, miracle worker');
  ok('inline header keeps lyric tail', h && h.type === 'chorus' && /Way maker, miracle worker/.test(h.tail || ''), h);
}

// ── The choir case: names on headers never reach lyrics ─────────────────────
{
  const text = `Verse 1 — Mary
You are here, moving in our midst
I worship You, I worship You

Chorus — All
Way maker, miracle worker
Promise keeper, light in the darkness

Verse 2 — Mary
You are here, touching every heart

Mary - Chorus

Bridge (John & Esther)
Even when I don't see it, You're working`;
  const r = parseLyrics(text);
  ok('choir: types', types(r) === 'verse,chorus,verse,bridge', types(r));
  ok('choir: no singer names in lyrics', !/Mary|John|Esther|— All/.test(allText(r)), allText(r));
  ok('choir: "Mary - Chorus" with no body = repeat of chorus', JSON.stringify(r.arrangement) === '[0,1,2,1,3]', r.arrangement);
  ok('choir: names learned', r.names.includes('mary') && r.names.includes('john'), r.names);
}

// Speaker cue lines + speaker prefixes on lyric lines.
{
  const text = `Verse 1 - Ada
Ada: I lift my hands
All: To the King of kings
Men:
Holy, holy
(Women)
Worthy is the Lamb
Leader: Hallelujah`;
  const r = parseLyrics(text);
  ok('speaker: prefixes stripped', allText(r) === 'I lift my hands\nTo the King of kings\nHoly, holy\nWorthy is the Lamb\nHallelujah', allText(r));
}

// WhatsApp-formatted choir message with bold headers and emphasis.
{
  const text = `*WAY MAKER*

*Verse 1 (Sopranos)*
You are here moving in our midst

*Chorus x2*
_Way maker, miracle worker_`;
  const r = parseLyrics(text, { detectTitle: true });
  ok('whatsapp: title detected', r.title === 'WAY MAKER', r.title);
  ok('whatsapp: types', types(r) === 'verse,chorus', types(r));
  ok('whatsapp: emphasis stripped', r.sections[1]?.content === 'Way maker, miracle worker', r.sections[1]);
}

// Repeat directives with no body + chorus written out twice → arrangement, no dupes.
{
  const text = `Verse 1
Line a

Chorus
Chorus line

Verse 2
Line b

Repeat Chorus

Bridge
Bridge line

Chorus
Chorus line`;
  const r = parseLyrics(text);
  ok('repeat: no duplicated chorus section', r.sections.length === 4, r.sections);
  ok('repeat: arrangement', JSON.stringify(r.arrangement) === '[0,1,2,1,3,1]', r.arrangement);
}

// No repeats → no arrangement (natural order).
{
  const r = parseLyrics('Verse 1\nA\n\nChorus\nB');
  ok('no repeats → arrangement null', r.arrangement === null);
}

// Headerless paste: a block that recurs is the chorus.
{
  const r = parseLyrics('Line one\nLine two\n\nHoly holy\nHoly holy\n\nLine three\nLine four\n\nHoly holy\nHoly holy');
  ok('headerless: recurring block = chorus', types(r) === 'verse,chorus,verse', types(r));
  ok('headerless: arrangement', JSON.stringify(r.arrangement) === '[0,1,2,1]', r.arrangement);
}

// Headerless stays the historic blank-line split.
{
  const r = parseLyrics('Line a\nLine b\n\nLine c\nLine d');
  ok('headerless basic', r.sections.length === 2 && r.sections[1].content === 'Line c\nLine d');
}

// Chords: chord-only lines and inline [G] chords removed.
{
  const r = parseLyrics('Verse 1\nG       D        Em    C\nAmazing [G]grace how [C]sweet the sound\nD/F#  G\nThat saved a wretch');
  ok('chords stripped', allText(r) === 'Amazing grace how sweet the sound\nThat saved a wretch', allText(r));
}

// SongSelect footer → metadata, not lyrics.
{
  const text = `Verse 1
You are here

CCLI Song # 7115744
Osinachi Okoro
© 2016 Integrity Music Europe
For use solely with the SongSelect® Terms of Use. All rights reserved. www.ccli.com
CCLI License # 123456`;
  const r = parseLyrics(text);
  ok('ccli: lyrics clean', allText(r) === 'You are here', allText(r));
  ok('ccli: copyright', /© 2016 Integrity/.test(r.copyright || '') && /CCLI 7115744/.test(r.copyright || ''), r.copyright);
  ok('ccli: author', r.author === 'Osinachi Okoro', r.author);
}

// Musician metadata lines dropped.
{
  const r = parseLyrics('Key: G\nTempo: 72\nCapo 2\nVerse 1\nTime is filled with swift transition');
  ok('meta lines dropped, lyric kept', allText(r) === 'Time is filled with swift transition', allText(r));
}

// Hymn-style numbered stanzas still work.
{
  const r = parseLyrics('1. Amazing grace how sweet the sound\nThat saved a wretch like me\n\n2. Twas grace that taught\nMy heart to fear');
  ok('hymn numbered stanzas', r.sections.length === 2 && r.sections[0].content.startsWith('Amazing grace'), r.sections);
}

// Title above the first header (paste flows only).
{
  const r = parseLyrics('Goodness of God - Bethel Music\n\nVerse 1\nI love You Lord', { detectTitle: true });
  ok('title + author from top line', r.title === 'Goodness of God' && r.author === 'Bethel Music', [r.title, r.author]);
  ok('title not a verse', r.sections.length === 1 && r.sections[0].content === 'I love You Lord', r.sections);
  const r2 = parseLyrics('Goodness of God\n\nVerse 1\nI love You Lord');
  ok('no detectTitle → leading line kept as verse', r2.sections.length === 2, r2.sections);
}

{
  const r = parseLyrics('Brand New Song - Ada\nVerse 1 — Ada\nWalking through the valley', { detectTitle: true });
  ok('singer on title line is not the author', r.title === 'Brand New Song' && r.author === null, [r.title, r.author]);
}

// Directive line detection.
ok('directive: All', isDirectiveLine('All'));
ok('directive: Men & Women:', isDirectiveLine('Men & Women:'));
ok('directive: x2', isDirectiveLine('(x2)'));
ok('directive: Mary: (speaker cue)', isDirectiveLine('Mary:'));
ok('directive: learned name', isDirectiveLine('Mary', new Set(['mary'])));
ok('not directive: lyric', !isDirectiveLine('Men and women of God arise'));
ok('not directive: Hallelujah', !isDirectiveLine('Hallelujah'));

// Subsequence invariant (EasyWorship style recovery): every section's chars appear in order in the source.
{
  const src = 'Verse 1 - Mary\nAda: I [G]lift my hands\n*To the King*\n\nChorus x2\nHoly holy';
  const r = parseLyrics(src);
  const isSubseq = (needle, hay) => { let i = 0; for (const ch of hay) if (ch === needle[i]) i++; return i === needle.length; };
  ok('subsequence invariant', r.sections.every((s) => isSubseq(s.content, src)), r.sections);
}

console.log(`lyrics-parse: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
