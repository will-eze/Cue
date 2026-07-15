// Unit tests for the sheet-music OCR structuring parser. Run: node src/renderer/ocr/sheetParse.test.mjs
// The Florence-2 model can't run headless, so these feed representative OCR line output
// (syllable splits, chord rows, tempo noise, verse numbers, a Chorus label) and assert the
// structured song that autopopulates the Song Editor.
import assert from 'node:assert';
import { structureSheet } from './sheetParse.js';

let pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

// ── 1. Amazing Grace: title, attribution, chord/tempo noise, numbered verses ──
test('extracts title, author, numbered verses; drops chords & tempo', () => {
  const lines = [
    'Amazing Grace',
    'Words: John Newton',
    'Music: American melody',
    'Moderato',            // tempo noise → dropped
    'G        C      G',   // chord row → dropped
    '76',                  // measure number → dropped
    "1. A- maz- ing grace! how sweet the sound",
    'That saved a wretch like me!',
    'I once was lost, but now am found,',
    'Was blind, but now I see.',
    "2. 'Twas grace that taught my heart to fear,",
    'And grace my fears re- lieved;',
    '© Public Domain',
  ];
  const r = structureSheet(lines);
  assert.strictEqual(r.title, 'Amazing Grace');
  assert.match(r.author, /John Newton/);
  assert.match(r.copyright, /Public Domain/i);
  assert.strictEqual(r.sections.length, 2, `got ${r.sections.length} sections`);
  assert.strictEqual(r.sections[0].type, 'verse');
  // Syllables rejoined, verse number stripped.
  assert.strictEqual(r.sections[0].content.split('\n')[0], 'Amazing grace! how sweet the sound');
  assert.match(r.sections[1].content, /'Twas grace that taught/);
  assert.match(r.sections[1].content, /fears relieved/); // "re- lieved" rejoined
  // No chord/tempo/number leaked into lyrics.
  assert.doesNotMatch(r.sections.map((s) => s.content).join('\n'), /Moderato|^76$/m);
});

// ── 1b. Real single-underlay hymn (matches test-fixtures/sheet-music/amazing-grace.png):
//        title, a bare composer+year credit (no "by" keyword), one continuous lyric line. ──
test('handles a bare composer credit and un-numbered single-underlay lyrics', () => {
  const lines = [
    'AMAZING GRACE',
    'John Newton, 1779',   // no keyword — caught by the year heuristic, not leaked into lyrics
    'A - maz - ing grace! How sweet the sound, That saved a wretch like me! I',
    "once was lost, but now I'm found, was blind, but now I see.",
  ];
  const r = structureSheet(lines);
  assert.strictEqual(r.title, 'AMAZING GRACE');
  assert.match(r.author, /John Newton, 1779/);
  assert.strictEqual(r.sections.length, 1);
  assert.strictEqual(r.sections[0].type, 'verse');
  assert.doesNotMatch(r.sections[0].content, /John Newton/); // credit didn't leak
  assert.match(r.sections[0].content, /^Amazing grace! How sweet/); // syllables rejoined
});

// ── 2. Explicit Chorus / Verse labels ──
test('splits on Chorus and Verse keyword labels', () => {
  const lines = [
    'Blessed Assurance',
    'Verse 1',
    'Blessed assurance, Jesus is mine!',
    'Oh, what a foretaste of glory divine!',
    'Chorus',
    'This is my story, this is my song,',
    'Praising my Saviour all the day long.',
    'Verse 2',
    'Perfect submission, perfect delight,',
  ];
  const r = structureSheet(lines);
  assert.strictEqual(r.title, 'Blessed Assurance');
  const types = r.sections.map((s) => s.type);
  assert.deepStrictEqual(types, ['verse', 'chorus', 'verse']);
  assert.match(r.sections[1].content, /This is my story/);
});

// ── 3. Inline "Chorus:" header with lyric on the same line ──
test('keeps lyric text that trails a section header', () => {
  const r = structureSheet([
    'How Great Thou Art',
    '1. O Lord my God, when I in awesome wonder',
    'Chorus: Then sings my soul, my Saviour God, to Thee',
    'How great Thou art, how great Thou art!',
  ]);
  const chorus = r.sections.find((s) => s.type === 'chorus');
  assert.ok(chorus, 'chorus section present');
  assert.match(chorus.content, /^Then sings my soul/);
});

// ── 4. No headers at all → one verse, still usable ──
test('falls back to a single verse when nothing is labelled', () => {
  const r = structureSheet([
    'Doxology',
    'Praise God from whom all blessings flow',
    'Praise Him all creatures here below',
  ]);
  assert.strictEqual(r.title, 'Doxology');
  assert.strictEqual(r.sections.length, 1);
  assert.strictEqual(r.sections[0].type, 'verse');
  assert.strictEqual(r.sections[0].content.split('\n').length, 2);
});

// ── 5. Never explodes on empty / all-noise input ──
test('empty and noise-only input yield no sections, no throw', () => {
  assert.deepStrictEqual(structureSheet([]).sections, []);
  const r = structureSheet(['G7', 'C/E', '4', 'mf', '••']);
  assert.strictEqual(r.sections.length, 0);
  assert.strictEqual(r.title, '');
});

console.log(`\n${pass} passed`);
