// Tests for the shared written-reference grammar. node --experimental-detect-module ...
import { parseScriptureRef as P, scanScriptureRefs, segmentContains, passageLabel, paginateVerses, groupLabel, matchBooks } from './scripture-ref.js';
import { lookupBook } from '../main/db/bible-books.js';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`✗ ${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
};
const ref = (s) => P(s)?.ref ?? null;
const scan = (s) => scanScriptureRefs(s).map((r) => r.ref);

// typed references (were null before: bible.js had a second, narrower parser)
eq('bare two numbers', ref('1 cor 13 4-7'), '1 Corinthians 13:4-7');
eq('comma list', ref('John 3:16-18,20'), 'John 3:16-18,20');
eq('cross-chapter', ref('Gen 1:1-2:3'), 'Genesis 1:1-2:3');
eq('roman prefix + dot sep', ref('II Timothy 3.16'), '2 Timothy 3:16');
eq('en dash', ref('John 3:16–18'), 'John 3:16-18');
eq('trailing translation', P('John 3:16 NIV')?.translation, 'NIV');
eq('trailing translation ref', ref('John 3:16 NIV'), 'John 3:16');
eq('paren translation', ref('Rev 22:20-21 (ESV)'), 'Revelation 22:20-21');
eq('First John', ref('First John 4:8'), '1 John 4:8');
eq('1st Corinthians', ref('1st Corinthians 13'), '1 Corinthians 13');
eq('Revelations', ref('Revelations 22:1'), 'Revelation 22:1');
eq('Song of Songs', ref('Song of Songs 2:1'), 'Song of Solomon 2:1');
eq('Jude 5 is verse', ref('Jude 5'), 'Jude 1:5');
eq('3 John 4 is verse', ref('3 John 4'), '3 John 1:4');
eq('Philemon range', ref('Philemon 6-8'), 'Philemon 1:6-8');
eq('Jude 1:14-15 keeps chapter', ref('Jude 1:14-15'), 'Jude 1:14-15');
eq('v separator', ref('John 3v16'), 'John 3:16');
eq('no space', ref('john3:16'), 'John 3:16');
eq('verse part letter', ref('John 3:16a'), 'John 3:16');
eq('abbreviated range 105-6', ref('Ps 119:105-6'), 'Psalms 119:105-106');
eq('reversed range collapses', ref('John 3:16-2'), 'John 3:16');
eq('chapter range', ref('Psalm 23-24'), 'Psalms 23-24');
eq('semicolon chapter list', ref('Matthew 5:3-12;7:1'), 'Matthew 5:3-12; 7:1');
eq('mid-typing trailing dash', ref('Psalms 23:1-'), 'Psalms 23:1');
eq('verse 0 rejected', ref('John 3:0'), null);
eq('trailing prose rejected', ref('John 3:16 is great'), null);
eq('unknown book', ref('bogus 3:16'), null);
// ambiguous prefixes no longer resolve to the first book in canonical order
eq('"jo" is ambiguous', lookupBook('jo'), null);
eq('"ju" is ambiguous', lookupBook('ju'), null);
eq('"philipp" still prefix-resolves', lookupBook('philipp')?.name, 'Philippians');

// scanning prose
eq('"I am 30 years old" is not Amos', scan('I am 30 years old and so 5 people'), []);
eq('short abbrev with verse is fine', scan('Is 53:5 then Am 3:3'), ['Isaiah 53:5', 'Amos 3:3']);
eq('cross-chapter not truncated', scan('Heb 11:1-12:2 reads'), ['Hebrews 11:1-12:2']);
eq('list not truncated', scan('Read John 3:16-18,20 today'), ['John 3:16-18,20']);
eq('First John not John', scan('First John 4:8, II Tim 3.16'), ['1 John 4:8', '2 Timothy 3:16']);
eq('sentence-end dot is not a verse separator', scan('Psalm 23. 5 minutes later'), ['Psalms 23']);
eq('"John 3. 16 people"', scan('John 3. 16 people came'), ['John 3']);
eq('single-chapter in prose', scan('See Jude 5 and 3 John 4.'), ['Jude 1:5', '3 John 1:4']);
eq('"1 John" not "John"', scan('the 1 John 3:16 text'), ['1 John 3:16']);
eq('index/end', (() => { const r = scanScriptureRefs('see John 3:16 now')[0]; return [r.index, r.end]; })(), [4, 13]);

// passage helpers
const segs = P('John 3:16-18,20').segments;
eq('segmentContains in', [16, 17, 18, 20].every((v) => segmentContains(segs[0], 3, v) || segmentContains(segs[1], 3, v)), true);
eq('segmentContains gap', segs.some((g) => segmentContains(g, 3, 19)), false);
const rows = (c, a, b) => Array.from({ length: b - a + 1 }, (_, i) => ({ chapter: c, verse: a + i }));
eq('label clamps to chapter length', passageLabel('John', P('John 3:30-99').segments, rows(3, 30, 36)), 'John 3:30-36');
eq('label list', passageLabel('John', segs, [...rows(3, 16, 18), { chapter: 3, verse: 20 }]), 'John 3:16-18,20');
eq('label cross-chapter', passageLabel('Genesis', P('Gen 1:30-2:2').segments, [...rows(1, 30, 31), ...rows(2, 1, 2)]), 'Genesis 1:30-2:2');
eq('label whole chapter', passageLabel('Psalms', P('Psalm 23').segments, rows(23, 1, 6)), 'Psalms 23:1-6');
eq('label single', passageLabel('John', P('John 3:16').segments, rows(3, 16, 16)), 'John 3:16');

// chapter-only false positives for book names that are everyday words
eq('Mark minutes', scan('We waited Mark 5 minutes ago.'), []);
eq('Mark 5 minutes ago', scan('Mark 5 minutes ago'), []);
eq('Acts weeks', scan('Acts 2 weeks later'), []);
eq('Job at office', scan('Job 1 at the office'), []);
eq('Numbers through', scan('Numbers 5 through 8 of the list'), []);
eq('Mark ver', scan('Mark 5:3 minutes ago'), ['Mark 5:3']);
eq('Read John 3', scan('Read John 3'), ['John 3']);
eq('(Romans 8)', scan('(Romans 8)'), ['Romans 8']);
eq('Psalm 23 any', scan('Psalm 23 says it well'), ['Psalms 23']);
eq('in Acts 2.', scan('as we see in Acts 2.'), ['Acts 2']);
eq('(Mark 5)', scan('the story (Mark 5) is long'), ['Mark 5']);
eq('Ruth alone line', scan('Ruth 1\nthen text'), ['Ruth 1']);
eq('John 3 tells', scan('John 3 tells us'), ['John 3']);
eq('John 3, comma', scan('In John 3, Nicodemus'), ['John 3']);
eq('bare John 3 mid prose', scan('I think John 3 is great'), []);

// verse pagination
const vs = [1, 2, 3, 4].map((n) => ({ chapter: 1, verse: n, text: 'x'.repeat(150) }));
const groups = paginateVerses(vs, 360);
eq('paginate groups', groups.map((g) => g.map((v) => v.verse)), [[1, 2], [3, 4]]);
const xch = paginateVerses([{ chapter: 1, verse: 31, text: 'a' }, { chapter: 2, verse: 1, text: 'b' }, { chapter: 2, verse: 2, text: 'c' }]);
eq('cross-chapter verse numbers', xch[0].map((v) => v.piece), ['31 a', '2:1 b', '2 c']);
eq('one huge verse gets its own slide', paginateVerses([{ chapter: 1, verse: 1, text: 'y'.repeat(900) }, { chapter: 1, verse: 2, text: 'z' }]).length, 2);
eq('group label', groupLabel('Genesis', [{ chapter: 1, verse: 31 }, { chapter: 2, verse: 1 }]), 'Genesis 1:31-2:1');
eq('group label same chapter', groupLabel('John', [{ chapter: 3, verse: 16 }, { chapter: 3, verse: 17 }]), 'John 3:16-17');

// Scriptures-tab book search
import { BOOKS } from '../main/db/bible-books.js';
const rowsAll = BOOKS.map((b) => ({ book_num: b.num, book_name: b.name }));
const mb = (q) => matchBooks(q, rowsAll).matches.map((r) => r.book_name);
eq('jn → John first', mb('jn')[0], 'John');
eq('jn exact', matchBooks('jn', rowsAll).exact, true);
eq('1 cor', mb('1 cor')[0], '1 Corinthians');
eq('1cor', mb('1cor')[0], '1 Corinthians');
eq('II Cor', mb('II Cor')[0], '2 Corinthians');
eq('ps → Psalms', mb('ps')[0], 'Psalms');
eq('rev → Revelation', mb('rev')[0], 'Revelation');
eq('song of songs', mb('song of songs')[0], 'Song of Solomon');
eq('phil exact is Philippians', mb('phil')[0], 'Philippians');
eq('jo ambiguous lists several', mb('jo').slice().sort(), ['Job', 'Joel', 'John', 'Jonah', 'Joshua']);
eq('jo not exact', matchBooks('jo', rowsAll).exact, false);
eq('gen unique prefix', mb('gen'), ['Genesis']);
eq('1 j lists the 1/2/3-prefix Johns', mb('1 j'), ['1 John']);
eq('empty = all', mb('').length, 66);
eq('corinth contains', mb('corinth'), ['1 Corinthians', '2 Corinthians']);
eq('is stays Isaiah', mb('is')[0], 'Isaiah');
eq('zzz none', mb('zzz'), []);

console.log(`scripture-ref: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
