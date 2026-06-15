// Downloads the free/OFL display font families used by the bundled theme packs
// from the Google Fonts css2 API into src/fonts/ as woff2, and prints the
// @font-face blocks to paste into src/fonts/fonts.css.
//
// Only free (OFL / Apache) families are listed here. Commercial faces
// (Futura PT, Termina) are intentionally excluded — see plan/themes-references/
// theme-fonts.txt. VCR OSD Mono + BonvenoCF are NOT on Google Fonts and are
// handled separately (pending freeware-license verification).
//
//   node scripts/build-fonts.mjs              # download + emit CSS
//
// Already-bundled families (Inter, Montserrat, Lato, Oswald, Playfair Display,
// EB Garamond) are skipped except where we add an italic the pack needs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'src', 'fonts');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// family: Google Fonts family name (spaces → '+')
// file:   filename stem for the woff2 (matches existing convention, e.g. PlayfairDisplay)
// axes:   the css2 axis query, e.g. 'wght@400;700' or 'ital,wght@0,400;1,400' or 'ital@1'
const FAMILIES = [
  // ── Sans-serif ──────────────────────────────────────────────────────────
  { family: 'Archivo',          file: 'Archivo',          axes: 'wght@400;700' },
  { family: 'Barlow Condensed', file: 'BarlowCondensed',  axes: 'wght@400;700' },
  { family: 'Bebas Neue',       file: 'BebasNeue',        axes: 'wght@400' },
  { family: 'Jost',             file: 'Jost',             axes: 'wght@400;700' },
  { family: 'Overpass',         file: 'Overpass',         axes: 'wght@400;700' },
  { family: 'Poppins',          file: 'Poppins',          axes: 'wght@400;700' },
  { family: 'Roboto',           file: 'Roboto',           axes: 'wght@400;700' },
  // ── Serif ───────────────────────────────────────────────────────────────
  { family: 'Cinzel',             file: 'Cinzel',           axes: 'wght@400;700' },
  { family: 'Cormorant Garamond', file: 'CormorantGaramond', axes: 'ital,wght@0,400;0,700;1,400' },
  { family: 'DM Serif Display',   file: 'DMSerifDisplay',   axes: 'ital@0;1' },
  { family: 'Lora',               file: 'Lora',             axes: 'wght@400;700' },
  { family: 'Marcellus',          file: 'Marcellus',        axes: 'wght@400' },
  { family: 'Rakkas',             file: 'Rakkas',           axes: 'wght@400' },
  // ── Script / display ──────────────────────────────────────────────────────
  { family: 'Atma',           file: 'Atma',          axes: 'wght@400;700' },
  { family: 'Dancing Script', file: 'DancingScript', axes: 'wght@400;700' },
  { family: 'DynaPuff',       file: 'DynaPuff',      axes: 'wght@400;700' },
  { family: 'Playpen Sans',   file: 'PlaypenSans',   axes: 'wght@400;700' },
  // ── Italics to round out already-bundled serifs the pack uses ─────────────
  { family: 'EB Garamond',    file: 'EBGaramond',    axes: 'ital@1', italicOnly: true },
];

const weightName = (w) => (Number(w) >= 700 ? 'Bold' : 'Regular');

async function fetchCss(family, axes) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${axes}&display=block`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`css2 ${family}: ${res.status}`);
  return res.text();
}

// Parse @font-face blocks → [{ weight, style, url, latin }]. css2 splits each
// weight into several blocks by unicode-range (cyrillic, greek, latin-ext,
// latin…); `latin` flags the basic-latin block (covers U+0000-00FF = ASCII +
// Latin-1 accents), which is the one we want to bundle.
function parseFaces(css) {
  const faces = [];
  const re = /@font-face\s*{([^}]*)}/g;
  let m;
  while ((m = re.exec(css))) {
    const body = m[1];
    const weight = (body.match(/font-weight:\s*(\d+)/) || [])[1] || '400';
    const style = /font-style:\s*italic/.test(body) ? 'italic' : 'normal';
    const url = (body.match(/url\(([^)]+\.woff2)\)/) || [])[1];
    const range = (body.match(/unicode-range:\s*([^;]+)/) || [])[1] || '';
    const latin = /U\+0000-00FF/.test(range) || range === '';
    if (url) faces.push({ weight, style, url, latin });
  }
  return faces;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`woff2 ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

const cssBlocks = [];

for (const f of FAMILIES) {
  let css;
  try { css = await fetchCss(f.family, f.axes); }
  catch (e) { console.error('SKIP', f.family, e.message); continue; }
  const faces = parseFaces(css);
  // Keep only the basic-latin block per weight+style (the alphabet we ship).
  const seen = new Set();
  for (const face of faces) {
    if (!face.latin) continue;
    const key = `${face.weight}-${face.style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const italic = face.style === 'italic';
    const stem = `${f.file}-${weightName(face.weight)}${italic ? 'Italic' : ''}`;
    const fname = `${stem}.woff2`;
    try {
      const bytes = await download(face.url, path.join(OUT_DIR, fname));
      console.log(`  ${fname}  ${(bytes / 1024).toFixed(0)}KB`);
    } catch (e) { console.error('  FAIL', fname, e.message); continue; }
    cssBlocks.push(
      `@font-face {\n  font-family: '${f.family}';\n  src: url('${fname}') format('woff2');\n` +
      `  font-weight: ${face.weight};\n  font-style: ${face.style};\n  font-display: block;\n}`
    );
  }
}

fs.writeFileSync(path.join(OUT_DIR, '_generated-faces.css'), cssBlocks.join('\n\n') + '\n');
console.log(`\nWrote ${cssBlocks.length} @font-face blocks → src/fonts/_generated-faces.css`);
