// Unit tests for the sermon parser. Pure logic + the docx ZIP reader — no Electron.
//   node --experimental-detect-module src/main/import/sermon-import.test.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { findScriptureRefs, buildSermonStructure, extractText } from './sermon-import.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };
const eq = (label, got, want) => ok(`${label} (got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

// ── scripture reference detection ─────────────────────────────────────────────
{
  const refs = findScriptureRefs('As it says in John 3:16 and also Romans 8:28-30, and Psalm 23.');
  eq('refs found in order', refs.map((r) => r.ref), ['John 3:16', 'Romans 8:28-30', 'Psalms 23']);
}
{
  const refs = findScriptureRefs('Paul (1 Cor 13) and again 1 Corinthians 13:4-7.');
  eq('abbrev + range dedupe distinct', refs.map((r) => r.ref), ['1 Corinthians 13', '1 Corinthians 13:4-7']);
}
ok('no false positive on plain prose', findScriptureRefs('I have 3 points and 2 reasons today.').length === 0);
{
  const refs = findScriptureRefs('Ps. 23:1 is the verse.');
  eq('abbrev with dot', refs.map((r) => r.ref), ['Psalms 23:1']);
}

// ── structure heuristic ───────────────────────────────────────────────────────
{
  const sermon = [
    'The Power of Grace',
    '',
    '1. Grace Saves',
    'We are saved by grace through faith.',
    'It is the gift of God, see Ephesians 2:8.',
    '',
    '2. Grace Sustains',
    '- Daily mercies',
    '- Strength in weakness',
    '',
    'John 3:16',
  ].join('\n');
  const { title, slides } = buildSermonStructure(sermon);
  eq('title detected', title, 'The Power of Grace');
  ok('first slide is title', slides[0].role === 'title' && slides[0].title === 'The Power of Grace');
  ok('has a point slide titled "1. Grace Saves"', slides.some((s) => s.role === 'point' && /Grace Saves/.test(s.title || '')));
  ok('bullets captured under heading 2', slides.some((s) => (s.bullets || []).includes('Daily mercies')));
  ok('scripture slide for Ephesians 2:8', slides.some((s) => s.role === 'scripture' && s.reference === 'Ephesians 2:8'));
  ok('scripture slide for standalone John 3:16', slides.some((s) => s.role === 'scripture' && s.reference === 'John 3:16'));
  ok('reference is not left as a bullet', !slides.some((s) => (s.bullets || []).some((b) => /John 3:16/.test(b))));
}
{
  // Headingless prose still yields content slides (not just a title).
  const { slides } = buildSermonStructure('Just a single paragraph of thoughts. With two sentences here.', { title: 'Notes' });
  ok('headingless prose produces >1 slide', slides.length > 1);
  ok('title respected when supplied', slides[0].title === 'Notes');
}

{
  // A markdown "# Title" first line must NOT also produce a duplicate heading slide.
  const md = '# Walking in Faith\n\n## Trust God\nLean not on your own understanding.\n';
  const { title, slides } = buildSermonStructure(md);
  eq('markdown title stripped', title, 'Walking in Faith');
  ok('no duplicate title heading slide', slides.filter((s) => (s.title || '') === 'Walking in Faith').length === 1);
  ok('subheading became a point', slides.some((s) => s.role === 'point' && s.title === 'Trust God'));
}

{
  // Three-tier outline (DCLM/Deeper-Life style): TITLE → numbered ALL-CAPS main points
  // with an anchor ref → parenthesised "(i)/(ii)" sub-points with a reference list.
  const sermon = [
    'Expository Bible Study – Jude Series                 01/09/2025',
    'THE INFALLIBLE REVELATION OF FINAL JUDGMENT',
    'Jude 1:14-16',
    '',
    '“And Enoch also…” (Jude 1:14-16). Jude wrote earnestly about contending for the faith.',
    '',
    '1.  DIVINE REVELATION OF THE FIERY JUDGMENT',
    '    Jude 1:14-15',
    '',
    '(i) Enoch’s Revelation of Fiery Judgment – Genesis 5:22-24; Amos 3:3. Enoch walked',
    'with God and was taken away.',
    '',
    '(ii) Early Revelation of Fierce Judgment – Deuteronomy 33:2; Psalm 7:11. God revealed',
    'judgment to Moses.',
    '',
    '2.  DIRECT REVELATION OF FUTURE JUDGMENT',
    '    Jude 1:15',
    '',
    '(i) Fearful Judgment Awaiting the Ungodly – Hebrews 10:29-31; Luke 12:4-5. Many sin.',
    '',
    'Quotes from Pastor',
    'The apostates always think of their own gain.',
    '',
    'A Call to a Decision',
    'Say this prayer of faith for salvation.',
  ].join('\n');
  const { title, slides } = buildSermonStructure(sermon);
  eq('outline title detected', title, 'THE INFALLIBLE REVELATION OF FINAL JUDGMENT');
  ok('title slide carries anchor subtitle', slides[0].role === 'title' && slides[0].subtitle === 'Jude 1:14-16');
  ok('no standalone verse slides at all', !slides.some((s) => s.role === 'scripture'));
  ok('main point is a title-styled point with anchor', slides.some((s) => s.role === 'point' && /DIVINE REVELATION/.test(s.title) && s.subtitle === 'Jude 1:14-15'));
  ok('sub-point content slide', slides.some((s) => s.role === 'heading' && /Enoch’s Revelation of Fiery Judgment/.test(s.title)));
  ok('sub-point content slide shows its number', slides.some((s) => s.role === 'heading' && s.marker === '(i)'));
  ok('reference line carries parent anchor + sub-point refs', slides.some((s) => s.role === 'heading' && /Jude 1:14-15/.test(s.caption || '') && /Genesis 5:22-24/.test(s.caption || '') && /Amos 3:3/.test(s.caption || '')));
  ok('sub-point teaching prose becomes bullets', slides.some((s) => s.role === 'heading' && (s.bullets || []).some((b) => /walked with God/.test(b))));
  ok('reference text is not left inside a bullet', !slides.some((s) => (s.bullets || []).some((b) => /Genesis 5:22-24|Amos 3:3/.test(b))));
  ok('boiler-plate footer dropped', !slides.some((s) => /apostates|prayer of faith/i.test(s.title || s.caption || '')));
  ok('three main points', slides.filter((s) => s.role === 'point').length === 2);
  ok('teaching prose is not a title', !slides.some((s) => /walked with God|Many sin/.test(s.title || '')));
}

{
  // The special case: a quoted verse followed by its bracketed reference. The verbatim
  // quote is dropped from the content; the reference attaches to the preceding sentence.
  const sermon = [
    'JUDGMENT REVEALED',
    'Jude 1:14',
    '',
    'Introductory thoughts about the theme of divine judgment in the scriptures.',
    '',
    '1.  REVELATION OF JUDGMENT',
    '    Jude 1:14',
    '',
    '(i) Enoch’s Revelation of Fiery Judgment – Genesis 5:22-24. Enoch walked with God.',
    '',
    '(ii) Early Revelation of Fierce Judgment against Sin – Deuteronomy 33:2; Daniel 7:9-10; '
      + 'Psalm 7:11. The revelation of judgment dates way back to the time Enoch lived on the earth. '
      + 'God also revealed judgment to Moses, the prophet of Israel. “And he said, The Lord came from '
      + 'Sinai, and rose up from Seir unto them: from his right hand went a fiery law for them.” '
      + '(Deuteronomy 33:2). This was the revelation of God to Moses about the coming judgment. '
      + '“I beheld till the thrones were cast down, and the Ancient of days did sit.” (Daniel 7:9-10). '
      + 'God will judge every man according to His word.',
  ].join('\n');
  const { slides } = buildSermonStructure(sermon);
  const h = slides.find((s) => s.role === 'heading' && /Early Revelation/.test(s.title || ''));
  ok('special-case: a content slide exists', !!h);
  ok('special-case: no verse slides', !slides.some((s) => s.role === 'scripture'));
  ok('special-case: ref line = parent anchor + sub refs', /Jude 1:14/.test(h.caption || '') && /Deuteronomy 33:2/.test(h.caption || '') && /Daniel 7:9-10/.test(h.caption || ''));
  const allBullets = slides.filter((s) => s.role === 'heading').flatMap((s) => s.bullets || []);
  ok('special-case: verbatim quote text is dropped', !allBullets.some((b) => /came from\s+Sinai|thrones were cast down/.test(b)));
  ok('special-case: commentary sentence keeps its bracketed ref', allBullets.some((b) => /prophet of Israel\.\s*\(Deuteronomy 33:2\)/.test(b)));
  ok('special-case: standalone commentary stays its own bullet', allBullets.some((b) => /^The revelation of judgment dates way back/.test(b)));
  ok('special-case: one bullet per sentence (no fragments)', allBullets.every((b) => /[.!?)]\s*$/.test(b) || /\)$/.test(b)));
}

{
  // The REAL PDF shape: structure is delimited by the "1." / "(i)" MARKERS, not blank
  // lines (a PDF doesn't reliably emit them). Sub-points are wrapped across visual rows
  // with NO blank line between them; the main-point heading and its anchor passage are on
  // separate lines; ref lists carry comma-verse syntax ("Amos 3:3,7"). The bug this guards:
  // each wrapped row becoming its own bullet, and the ref list leaking into the content box.
  const sermon = [
    'Expository & Systematic Bible Study – Jude Series',
    '01/09/2025',
    'THE INFALLIBLE REVELATION OF THE FULL AND FINAL JUDGMENT',
    'Jude 1:14-16',
    '“And Enoch also, the seventh from Adam, prophesied of these, saying, Behold, the',
    'Lord cometh.” (Jude 1:14-16). Jude had been writing earnestly about contending',
    'for the faith.',
    '1.   DIVINE REVELATION OF THE FIERY JUDGMENT AGAINST SINNERS',
    '     Jude 1:14-15',
    '(i) Enoch’s Revelation of Fiery Judgment against Sinners – Jude 1:14-15a;',
    'Genesis 5:22-24; Amos 3:3,7; Hebrews 11:5-6. Enoch was the seventh man from',
    'Adam in his generation. “And Enoch also, the seventh from Adam, prophesied',
    'of these, saying, Behold, the Lord cometh” (Jude 1:14-15a). We see Enoch’s',
    'brief history in the first book of the Bible.',
    '(ii) Early Revelation of Fierce Judgment against Sin – Deuteronomy 33:2; Amos 3:1-2.',
    'God revealed judgment to Moses, the prophet of Israel. “And he said, The Lord came',
    'from Sinai.” (Deuteronomy 33:2). This was the revelation of God to Moses.',
    'Quotes from Pastor (Dr.) W. F. Kumuyi',
    'The apostates always think of their own gain.',
  ].join('\n');
  const { title, slides } = buildSermonStructure(sermon);
  eq('pdf: title detected', title, 'THE INFALLIBLE REVELATION OF THE FULL AND FINAL JUDGMENT');
  ok('pdf: title slide anchor subtitle', slides[0].role === 'title' && slides[0].subtitle === 'Jude 1:14-16');
  ok('pdf: intro slide included (quote dropped)', slides.some((s) => s.title === 'Introduction'
    && (s.bullets || []).some((b) => /^Jude had been writing earnestly/.test(b))
    && !(s.bullets || []).some((b) => /Lord cometh/.test(b))));
  ok('pdf: main-point divider with anchor', slides.some((s) => s.role === 'point' && /DIVINE REVELATION/.test(s.title) && s.subtitle === 'Jude 1:14-15'));

  const enoch = slides.find((s) => s.role === 'heading' && /Enoch’s Revelation/.test(s.title || ''));
  ok('pdf: sub-point content slide exists', !!enoch);
  ok('pdf: parent point on subtitle line', /Divine Revelation of the Fiery Judgment/.test(enoch.subtitle || ''));
  ok('pdf: marker shown', enoch.marker === '(i)');
  ok('pdf: ref line = anchor + sub refs (comma-verse kept)',
    /Jude 1:14-15/.test(enoch.caption) && /Genesis 5:22-24/.test(enoch.caption)
    && /Amos 3:3,7/.test(enoch.caption) && /Hebrews 11:5-6/.test(enoch.caption));
  ok('pdf: ref list NOT leaked into content', !(enoch.bullets || []).some((b) => /Genesis 5:22-24|Hebrews 11:5-6/.test(b)));

  const allB = slides.filter((s) => s.role === 'heading').flatMap((s) => s.bullets || []);
  ok('pdf: whole sentences, no wrapped fragments', allB.every((b) => /[.!?)]\s*$/.test(b)));
  ok('pdf: sentence reassembled across wrapped rows',
    allB.some((b) => /^Enoch was the seventh man from Adam in his generation\./.test(b)));
  ok('pdf: verbatim quote dropped, ref kept on prev sentence',
    allB.some((b) => /generation\.\s*\(Jude 1:14-15a\)$/.test(b)) && !allB.some((b) => /Lord cometh with ten/.test(b)));
  ok('pdf: footer dropped', !slides.some((s) => (s.bullets || []).some((b) => /apostates always think/.test(b))));
}

// ── docx ZIP reader ───────────────────────────────────────────────────────────
{
  // Build a minimal valid .docx (a ZIP holding word/document.xml) in memory.
  const xml = '<?xml version="1.0"?><w:document><w:body>'
    + '<w:p><w:r><w:t>Hope in Christ</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Read Romans 5:1 today.</w:t></w:r></w:p>'
    + '</w:body></w:document>';
  const docx = buildDocx('word/document.xml', xml);
  const tmp = path.join(os.tmpdir(), `cue-sermon-test-${Date.now()}.docx`);
  fs.writeFileSync(tmp, docx);
  try {
    const text = extractText(tmp);
    ok('docx text extracted', /Hope in Christ/.test(text) && /Romans 5:1/.test(text));
    ok('docx paragraphs became newlines', /Hope in Christ\s*\n\s*Read Romans/.test(text));
  } finally { fs.unlinkSync(tmp); }
}

// Minimal single-entry ZIP writer (DEFLATE) — just enough for the reader under test.
function buildDocx(name, content) {
  const nameBuf = Buffer.from(name, 'utf8');
  const data = Buffer.from(content, 'utf8');
  const comp = zlib.deflateRawSync(data);
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);      // version needed
  local.writeUInt16LE(0, 6);       // flags
  local.writeUInt16LE(8, 8);       // method = deflate
  local.writeUInt16LE(0, 10);      // time
  local.writeUInt16LE(0, 12);      // date
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  const localPart = Buffer.concat([local, nameBuf, comp]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);    // extra
  central.writeUInt16LE(0, 32);    // comment
  central.writeUInt16LE(0, 34);    // disk
  central.writeUInt16LE(0, 36);    // internal attrs
  central.writeUInt32LE(0, 38);    // external attrs
  central.writeUInt32LE(0, 42);    // local header offset
  const centralPart = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16); // central dir offset = after local part
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localPart, centralPart, eocd]);
}

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

console.log(`\nsermon-import: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
