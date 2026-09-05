// Generate tiny per-font PREVIEW subsets so the font picker can render each
// downloadable family in its OWN typeface before the full font is downloaded.
//
//   node scripts/gen-font-previews.mjs
//
// For each family in src/main/fonts-catalog.js it fetches the 400-weight woff2 from
// @fontsource and subsets it (with `pyftsubset` from fonttools) down to just the glyphs
// needed for the family name + the picker's sample line, writing
// resources/font-previews/<id>.woff2 (~2-4 KB each). Those ship in the app; the picker
// loads them via fonts:previewCss (db/fonts.js buildPreviewFontCss).
//
// Requires fonttools:  pip install fonttools brotli
// Re-run whenever fonts-catalog.js changes. Safe to run repeatedly (idempotent).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'resources', 'font-previews');
const SAMPLE = 'The quick brown fox 0123'; // must match FontSettings.jsx SAMPLE

function havePyftsubset() {
  try { execFileSync('pyftsubset', ['--help'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const { FONT_CATALOG, fontsourceUrl } = await import('../src/main/fonts-catalog.js');

if (!havePyftsubset()) {
  console.error('✗ pyftsubset not found. Install fonttools:  pip install fonttools brotli');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-fontprev-'));
let ok = 0, fail = 0;

for (const f of FONT_CATALOG) {
  const text = SAMPLE + ' ' + f.family;
  const chars = [...new Set(text.split(''))].join('');
  const weight = f.weights.includes(400) ? 400 : f.weights[0];
  try {
    const res = await fetch(fontsourceUrl(f.id, weight));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const src = path.join(tmp, `${f.id}.woff2`);
    fs.writeFileSync(src, Buffer.from(await res.arrayBuffer()));
    execFileSync('pyftsubset', [
      src, `--text=${chars}`, '--flavor=woff2', '--layout-features=*',
      `--output-file=${path.join(OUT, `${f.id}.woff2`)}`,
    ], { stdio: 'ignore' });
    ok++;
    process.stdout.write(`✓ ${f.family}\n`);
  } catch (err) {
    fail++;
    process.stdout.write(`✗ ${f.family} — ${err.message}\n`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nDone: ${ok} previews written to resources/font-previews/${fail ? `, ${fail} failed` : ''}.`);
