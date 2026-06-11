// Build the bundled GHS (Gospel Hymns and Songs) hymnal seed from the source CSV
// (number → title map, Windows-1252) + the per-number lyric text files.
//
// Output: resources/ghs/ghs-hymnal.json — { items: [{ number, name, lyrics }] }.
// Run once when the source material changes:  node scripts/build-ghs.mjs <csv> <lyricsDir>
// Defaults to the files under ./temp used during development.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const csvPath    = process.argv[2] || path.join(root, 'temp', 'GHS Name and Numbers(Sheet1).csv');
const lyricsDir  = process.argv[3] || path.join(root, 'temp', 'lyrics');
const outDir     = path.join(root, 'resources', 'ghs');
const outFile    = path.join(outDir, 'ghs-hymnal.json');

// Windows-1252 high range (0x80–0x9F) — smart quotes/dashes the CSV uses.
const CP1252 = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};
function decodeCp1252(buf) {
  let out = '';
  for (const b of buf) out += b < 0x80 ? String.fromCharCode(b) : (CP1252[b] ?? String.fromCharCode(b));
  return out;
}

// number → name, taking the Title-Case column (col1). That column uses "/" where
// the title has a comma ("Holy/ Holy/ Holy" → "Holy, Holy, Holy").
function loadNames() {
  const text = decodeCp1252(fs.readFileSync(csvPath));
  const names = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^GHS\s+(\d+)\s*,([^,]*)/i.exec(line);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    const name = m[2].trim().replace(/\s*\/\s*/g, ', ').replace(/\s+/g, ' ').trim();
    if (num && name) names.set(num, name);
  }
  return names;
}

function main() {
  const names = loadNames();
  const items = [];
  for (const file of fs.readdirSync(lyricsDir)) {
    const m = /GHS\s*(\d+)\.txt$/i.exec(file);
    if (!m) continue;
    const number = parseInt(m[1], 10);
    const lyrics = fs.readFileSync(path.join(lyricsDir, file), 'utf8').replace(/\r\n/g, '\n').trim();
    items.push({ number, name: names.get(number) || null, lyrics });
  }
  items.sort((a, b) => a.number - b.number);

  const missingName = items.filter((i) => !i.name).map((i) => i.number);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ items }, null, 0));
  console.log(`Wrote ${items.length} GHS hymns → ${path.relative(root, outFile)}`);
  if (missingName.length) console.warn(`  ${missingName.length} without a CSV name: ${missingName.join(', ')}`);
}

main();
