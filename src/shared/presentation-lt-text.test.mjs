import assert from 'node:assert/strict';
import { extractLtText, resolveSlideLt, paginateLt, resolveLtPages, pagesToText, normaliseLt, ltDefaults } from './presentation-lt-text.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };
const txt = (text, x, y, extra = {}) => ({ id: 'e' + n + x + y, type: 'text', x, y, w: 80, h: 10, text, style: {}, ...extra });

// Real sermon-build output shape (sermon-build.js heading role): NO `role` on elements.
const sermonHeading = [
  txt('Main point: Faith', 6, 5, { style: { fontSize: 28, italic: true } }),
  txt('(i)  Faith comes by hearing', 6, 13, { style: { fontSize: 40, bold: true } }),
  txt('Romans 10:17', 6, 25, { style: { fontSize: 24, italic: true } }),
  txt('First bullet.\nSecond bullet.', 8, 32, { style: { fontSize: 34, listStyle: 'disc' } }),
];
// Sermon title slide (title 90 + subtitle 42).
const sermonTitle = [
  txt('The Good Shepherd', 6, 24, { style: { fontSize: 90, bold: true } }),
  txt('John 10:1-18', 8, 68, { style: { fontSize: 42, italic: true } }),
];
const imageOnly = [{ id: 'i', type: 'image', mediaId: 4, x: 0, y: 0, w: 100, h: 100 }];

t('image-only slide yields empty', () => {
  assert.deepEqual(extractLtText(imageOnly), { title: '', body: '', text: '' });
  assert.equal(resolveSlideLt({ elements: imageOnly }, 'auto').text, '');
});
t('sermon slide without roles: largest font is the heading, reading order for body', () => {
  const r = extractLtText(sermonHeading);
  assert.equal(r.title, '(i)  Faith comes by hearing');
  assert.equal(r.body, 'Main point: Faith\nRomans 10:17\nFirst bullet.\nSecond bullet.');
});
t('sermon title slide', () => {
  const r = extractLtText(sermonTitle);
  assert.equal(r.title, 'The Good Shepherd');
  assert.equal(r.text, 'The Good Shepherd\nJohn 10:1-18');
});
t('theme-composed slide: roles win, kicker dropped, shapes ignored', () => {
  const els = [
    { type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 100, role: 'accent' },
    txt('PART ONE', 8, 28, { role: 'kicker', style: { fontSize: 26 } }),
    txt('Grace', 8, 37, { role: 'title', style: { fontSize: 20 } }),
    txt('Amazing', 8, 60, { role: 'body', style: { fontSize: 90 } }),
  ];
  const r = extractLtText(els);
  assert.equal(r.title, 'Grace');
  assert.equal(r.body, 'Amazing');
});
t('similar sizes and no roles: no heading', () => {
  const r = extractLtText([txt('A', 5, 5, { style: { fontSize: 40 } }), txt('B', 5, 30, { style: { fontSize: 42 } })]);
  assert.equal(r.title, '');
  assert.equal(r.text, 'A\nB');
});
t('single text element is never a heading', () => {
  const r = extractLtText([txt('Only', 5, 5, { style: { fontSize: 90 } })]);
  assert.equal(r.title, ''); assert.equal(r.text, 'Only');
});
t('reading order: y then x', () => {
  const r = extractLtText([txt('right', 50, 10), txt('left', 5, 10), txt('top', 5, 2)]);
  assert.equal(r.text, 'top\nleft\nright');
});
t('strips ⁂, markup, blank lines, whitespace-only elements', () => {
  const r = extractLtText([txt('  a⁂\n\n\n<b>b</b>  ', 5, 5), txt('   ', 5, 20)]);
  assert.equal(r.text, 'a\nb');
});
t('garbage input never throws', () => {
  assert.equal(extractLtText(null).text, '');
  assert.equal(extractLtText([null, 3, {}]).text, '');
  assert.equal(resolveSlideLt(null, 'auto').text, '');
  assert.equal(resolveSlideLt({ lt_json: '{bad', elements: sermonTitle }, 'auto').mode, 'auto');
});
t('resolveSlideLt: deck default, override, custom, hide', () => {
  const s = { elements: sermonTitle };
  assert.equal(resolveSlideLt(s, 'hide').mode, 'hide');
  assert.equal(resolveSlideLt(s, 'hide').text, '');
  assert.equal(resolveSlideLt({ ...s, lt_json: '{"mode":"auto"}' }, 'hide').text, 'The Good Shepherd\nJohn 10:1-18');
  const c = resolveSlideLt({ ...s, lt_json: JSON.stringify({ mode: 'custom', text: 'Hello\n\nWorld' }) }, 'auto');
  assert.deepEqual([c.mode, c.text], ['custom', 'Hello\nWorld']);
  const blank = resolveSlideLt({ ...s, lt_json: { mode: 'custom', text: '  ' } }, 'auto');
  assert.deepEqual([blank.mode, blank.title], ['auto', 'The Good Shepherd']);
  assert.equal(resolveSlideLt({ ...s, lt_json: '{"mode":"hide"}' }, 'auto').text, '');
});
t('empty heading is skipped, not shown as blank title', () => {
  const r = extractLtText([txt('   ', 5, 5, { role: 'title' }), txt('Body here', 5, 20)]);
  assert.deepEqual([r.title, r.text], ['', 'Body here']);
});
t('title repeated in body is not shown twice', () => {
  const r = extractLtText([txt('Grace Alone', 5, 5, { role: 'title' }), txt('grace alone\nIt is a gift', 5, 20)]);
  assert.equal(r.text, 'Grace Alone\nIt is a gift');
});
t('back-to-back duplicated text boxes collapse', () => {
  assert.equal(extractLtText([txt('Same line', 5, 5), txt('Same line', 5, 6)]).text, 'Same line');
});
t('mixed bullet markers normalise to one glyph', () => {
  const r = extractLtText([txt('•One\n-  Two\n– Three\n*  Four\n•\n-5 degrees\nwell-known', 5, 5)]);
  assert.equal(r.text, '• One\n• Two\n• Three\n• Four\n-5 degrees\nwell-known');
});
t('very long body is passed through whole (band shrinks/clips it)', () => {
  const long = 'word '.repeat(400).trim();
  assert.equal(extractLtText([txt(long, 5, 5)]).text, long);
});

// ── Paginator ────────────────────────────────────────────────────────────────
const flat = (pages) => pages.map((p) => p.lines);
const O = { maxLines: 2, maxChars: 42 };
t('empty / whitespace text has no pages', () => {
  assert.deepEqual(paginateLt('', O), []);
  assert.deepEqual(paginateLt('  \n \n⁂\n  ', O), []);
  assert.deepEqual(paginateLt(null, O), []);
});
t('short text is one page, one line', () => {
  assert.deepEqual(flat(paginateLt('Welcome home', O)), [['Welcome home']]);
});
t('lines never exceed maxChars (except one long word) and wrap only at spaces', () => {
  const text = 'Grace is not a reward for good behaviour, it is a gift freely given to people who have nothing to offer in return.';
  for (const p of paginateLt(text, O)) for (const l of p.lines) assert.ok(l.length <= 42, l);
  assert.equal(paginateLt(text, O).flatMap((p) => p.lines).join(' ').replace(/\s+/g, ' '), text);
});
t('words are never lost or split, whatever the settings', () => {
  const text = 'We did not earn it and we cannot lose it, because it rests on what Christ has done and not on what we do. So come as you are.';
  for (const maxLines of [1, 2, 3, 4]) for (const maxChars of [20, 30, 42, 80]) {
    const out = paginateLt(text, { maxLines, maxChars });
    assert.equal(out.flatMap((p) => p.lines).join(' '), text, `${maxLines}/${maxChars}`);
    for (const p of out) assert.ok(p.lines.length <= maxLines, `${maxLines}/${maxChars}`);
  }
});
t('a full page ends at a sentence end rather than mid-phrase', () => {
  const text = 'God is good all the time. He keeps every promise he has made to us and he never changes at all.';
  const pages = flat(paginateLt(text, { maxLines: 2, maxChars: 30 }));
  assert.ok(pages.length >= 2);
  assert.ok(pages[0].join(' ').endsWith('time.'), JSON.stringify(pages));
});
t('falls back to a clause boundary when there is no sentence end', () => {
  const text = 'Because he lives, we live also, and because he reigns we have hope for tomorrow and every day after';
  const pages = flat(paginateLt(text, { maxLines: 2, maxChars: 24 }));
  assert.ok(pages[0].join(' ').endsWith(','), JSON.stringify(pages));
});
t('abbreviations and verse numbers do not count as sentence ends', () => {
  const text = 'See Rom. 10:17 and then read what follows because faith comes by hearing the message of Christ';
  const pages = flat(paginateLt(text, { maxLines: 1, maxChars: 24 }));
  assert.ok(!pages[0].join(' ').endsWith('Rom.'), JSON.stringify(pages));
});
t('manual page break splits pages and is exact', () => {
  const pages = flat(paginateLt('First page\nsecond line\n⁂\nSecond page', O));
  assert.deepEqual(pages, [['First page', 'second line'], ['Second page']]);
});
t('manual line breaks are kept even when the lines would fit together', () => {
  assert.deepEqual(flat(paginateLt('a\nb', O)), [['a', 'b']]);
});
t('a segment taller than maxLines is still capped', () => {
  const pages = flat(paginateLt('one\ntwo\nthree', O));
  for (const p of pages) assert.ok(p.length <= 2);
  assert.equal(pages.flat().join(' '), 'one two three');
});
t('a word longer than maxChars gets its own line, unsplit, and is flagged', () => {
  const long = 'Supercalifragilisticexpialidocious_and_more_letters_here';
  const pages = paginateLt(`See ${long} now`, { maxLines: 3, maxChars: 20 });
  const lines = pages.flatMap((p) => p.lines);
  assert.ok(lines.includes(long));
  assert.ok(pages.some((p) => p.overflow));
  assert.ok(!paginateLt('short words only', O)[0].overflow);
});
t('bullets start their own line and never split across pages when they fit', () => {
  const text = '• Faith begins with listening to the word of God\n• Obedience follows even when the way is unclear to us\n• Trust grows slowly';
  const pages = flat(paginateLt(text, O));
  for (const p of pages) {
    const first = p.filter((l) => l.startsWith('• ')).length;
    assert.ok(first >= 1);
  }
  // Each bullet's words stay together on one page.
  for (const needle of ['Faith', 'Obedience', 'Trust']) {
    const where = pages.map((p, i) => p.some((l) => l.includes(needle)) ? i : -1).filter((i) => i >= 0);
    assert.equal(where.length, 1);
  }
  assert.equal(pages.flat().filter((l) => l.startsWith('• ')).length, 3);
});
t('a bullet too long for any page may split but keeps all words', () => {
  const text = '• ' + 'alpha beta gamma delta epsilon '.repeat(6).trim();
  const pages = paginateLt(text, { maxLines: 1, maxChars: 30 });
  assert.ok(pages.length > 1);
  assert.equal(pages.flatMap((p) => p.lines).join(' '), text);
});
t('orphan: the last page is not a single short word when a word can move back', () => {
  const text = 'He is the God who sees us and knows our names, and he never leaves us alone, amen';
  for (const maxChars of [24, 28, 30, 34, 38]) {
    const pages = flat(paginateLt(text, { maxLines: 2, maxChars }));
    const last = pages[pages.length - 1].join(' ');
    assert.ok(last.split(' ').length >= 2 || pages.length === 1, `${maxChars}: ${JSON.stringify(pages)}`);
  }
});
t('whitespace, tabs, CRLF and markup are collapsed', () => {
  assert.deepEqual(flat(paginateLt('  a \t b\r\n<b>c</b>  ', O)), [['a b', 'c']]);
});
t('deterministic: same input, same output', () => {
  const text = 'Faith, hope and love. These three remain; but the greatest of these is love. Pursue love and desire spiritual gifts.';
  assert.deepEqual(paginateLt(text, O), paginateLt(text, O));
  assert.deepEqual(paginateLt(text, { maxLines: '2', maxChars: '42' }), paginateLt(text, O));
});
t('pagesToText round-trips through paginateLt', () => {
  const pages = paginateLt('Grace is not a reward for good behaviour, it is a gift freely given to people who have nothing to offer in return.', O);
  assert.deepEqual(flat(paginateLt(pagesToText(pages), O)), flat(pages));
});
t('ltDefaults clamps', () => {
  assert.deepEqual(ltDefaults({ maxLines: 99, maxChars: 5 }), { maxLines: 4, maxChars: 20 });
  assert.deepEqual(ltDefaults({}), { maxLines: 2, maxChars: 42 });
  assert.deepEqual(ltDefaults({ maxLines: 'x' }), { maxLines: 2, maxChars: 42 });
});
t('normaliseLt validates and clamps; old rows survive', () => {
  assert.equal(normaliseLt(null), null);
  assert.equal(normaliseLt('{bad'), null);
  assert.equal(normaliseLt({ mode: 'inherit' }), null);
  assert.deepEqual(normaliseLt('{"mode":"auto"}'), { mode: 'auto' });
  assert.deepEqual(normaliseLt({ mode: 'custom', text: 'x' }), { mode: 'custom', text: 'x' });
  assert.deepEqual(normaliseLt({ mode: 'auto', maxLines: 9, maxChars: 3, title: 'none' }), { mode: 'auto', maxLines: 4, maxChars: 20, title: 'none' });
  assert.deepEqual(normaliseLt({ mode: 'inherit', maxLines: 3 }), { mode: 'inherit', maxLines: 3 });
  assert.equal(normaliseLt({ mode: 'custom', text: 'x'.repeat(9000) }).text.length, 4000);
  assert.deepEqual(normaliseLt({ mode: 'auto', title: 'custom', titleText: '  A   B ' }), { mode: 'auto', title: 'custom', titleText: 'A B' });
});

t('a new sentence never starts as a trailing fragment at a page end', () => {
  const text = 'Grace is not a reward for good behaviour, it is a gift freely given to people who have nothing to offer in return. We did not earn it and we cannot lose it, because it rests on what Christ has done and not on what we do. So come as you are, receive it with open hands, and then live in the freedom it brings to every part of your life.';
  const pages = flat(paginateLt(text, O)).map((p) => p.join(' '));
  assert.equal(pages.join(' '), text);
  pages.forEach((pg, i) => {
    if (i === pages.length - 1) return;
    const m = pg.match(/[.?!]\s+(\S.*)$/); // text after a mid-page sentence end
    if (m) assert.ok(/[.?!]["”']?$/.test(pg), `fragment at page end: ${pg}`);
  });
  assert.ok(pages.some((pg) => pg.endsWith('what we do.')), JSON.stringify(pages));
  // A clause end that only LOOKS like a widow under the greedy layout ("…with open / hands,")
  // must still beat a mid-phrase cut ("…in the freedom it").
  assert.ok(pages.some((pg) => pg.endsWith('with open hands,')), JSON.stringify(pages));
  assert.ok(!pages.some((pg) => pg.endsWith('freedom it')), JSON.stringify(pages));
});
t('bullet and quote behaviour unchanged', () => {
  const b = flat(paginateLt('Three things we learn from Peter:\n• Faith begins with listening to the word of God\n• Obedience follows even when the way is unclear to us', O));
  assert.deepEqual(b, [['Three things we learn from Peter:'], ['• Faith begins with', 'listening to the word of God'], ['• Obedience follows even when', 'the way is unclear to us']]);
  const q = flat(paginateLt('"For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life."\nJohn 3:16', O));
  assert.equal(q.length, 3); assert.deepEqual(q[2], ['John 3:16']);
});

// ── resolveLtPages ───────────────────────────────────────────────────────────
const para = 'Grace is not a reward for good behaviour, it is a gift freely given to people who have nothing to offer in return.';
const sermon = [
  txt('Amazing Grace', 6, 5, { style: { fontSize: 60, bold: true } }),
  txt(para, 6, 30, { style: { fontSize: 30 } }),
];
t('auto: heading repeats as the title of every page; body is paged', () => {
  const r = resolveLtPages({ elements: sermon }, 'auto', O);
  assert.equal(r.mode, 'auto'); assert.equal(r.title, 'Amazing Grace');
  assert.ok(r.pages.length >= 2);
  assert.equal(r.pages.flatMap((p) => p.lines).join(' '), para);
});
t('title none keeps the heading as ordinary first content', () => {
  const r = resolveLtPages({ elements: sermon, lt_json: { mode: 'auto', title: 'none' } }, 'auto', O);
  assert.equal(r.title, '');
  assert.equal(r.pages[0].lines[0], 'Amazing Grace');
});
t('title custom uses titleText; custom mode defaults to no title', () => {
  const a = resolveLtPages({ elements: sermon, lt_json: { mode: 'auto', title: 'custom', titleText: 'Sunday' } }, 'auto', O);
  assert.equal(a.title, 'Sunday');
  const c = resolveLtPages({ elements: sermon, lt_json: { mode: 'custom', text: 'Hello\n⁂\nWorld' } }, 'auto', O);
  assert.deepEqual([c.mode, c.title, flat(c.pages)], ['custom', '', [['Hello'], ['World']]]);
  const c2 = resolveLtPages({ elements: sermon, lt_json: { mode: 'custom', text: 'Hello', title: 'auto' } }, 'auto', O);
  assert.equal(c2.title, 'Amazing Grace');
});
t('per-slide maxLines/maxChars override the defaults', () => {
  const r = resolveLtPages({ elements: sermon, lt_json: { mode: 'auto', maxLines: 1, maxChars: 30 } }, 'auto', O);
  assert.equal(r.maxLines, 1); assert.equal(r.maxChars, 30);
  for (const p of r.pages) { assert.equal(p.lines.length, 1); assert.ok(p.lines[0].length <= 30); }
});
t('hide, image-only, blank custom', () => {
  assert.deepEqual(resolveLtPages({ elements: sermon }, { lt_mode: 'hide' }, O).pages, []);
  assert.equal(resolveLtPages({ elements: sermon, lt_json: { mode: 'auto' } }, 'hide', O).pages.length > 0, true);
  assert.deepEqual(resolveLtPages({ elements: imageOnly }, 'auto', O).pages, []);
  assert.equal(resolveLtPages({ elements: sermon, lt_json: { mode: 'custom', text: ' ⁂ ' } }, 'auto', O).mode, 'auto');
  assert.deepEqual(resolveLtPages(null, 'auto', O).pages, []);
});
t('resolveLtPages is deterministic and uses defaults when settings are missing', () => {
  const a = resolveLtPages({ elements: sermon }, 'auto'), b = resolveLtPages({ elements: sermon }, 'auto', {});
  assert.deepEqual(a, b);
  assert.equal(a.maxLines, 2); assert.equal(a.maxChars, 42);
});
console.log(`presentation-lt-text: ${n} tests passed`);
