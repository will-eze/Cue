// Authors the built-in PRESENTATION themes → resources/themes/presentation-NN-*.json
// (category 'presentation'). A presentation theme is a layout-agnostic visual style —
// TOKENS only (style_json = { kind:'pres-theme', ...tokens }). The renderer composes
// any layout from a theme via buildThemeSlide() (utils/presentationThemes.js), so a
// theme applies to every slide layout and a deck can be re-skinned by swapping tokens.
// seedBundledThemes() seeds these by name (upserts), so re-running converts older
// element-based presentation themes of the same name in place.
//
//   node scripts/build-presentation-themes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'themes');

// tokens: bg (css), scrim?, display/body/quoteFont (font families), title/sub/bodyColor/
// accent/accentText/kicker (colours), titleUpper/sectionUpper/serif (flags).
const THEMES = [
  { name: 'Midnight Title', t: { bg: 'linear-gradient(135deg,#0b1220,#1b2b4a)', display: 'Inter', body: 'Inter', title: '#ffffff', sub: '#9fb6d6', bodyColor: '#cdd9ee', accent: '#4d8eff', accentText: '#02132e', kicker: '#7fb0ff' } },
  { name: 'Pure Light', t: { bg: 'linear-gradient(160deg,#f5f7fb,#dbe4f0)', display: 'Montserrat', body: 'Montserrat', title: '#0a0e1a', sub: '#41506a', bodyColor: '#2a3650', accent: '#1d4ed8', accentText: '#ffffff', kicker: '#1d4ed8' } },
  { name: 'Gold Serif', t: { bg: 'linear-gradient(180deg,#16130d,#241c10)', display: 'Cormorant Garamond', body: 'EB Garamond', quoteFont: 'Cormorant Garamond', title: '#f4ecd8', sub: '#cbb892', bodyColor: '#e6dcc4', accent: '#d4b478', accentText: '#1a1206', kicker: '#d4b478', serif: true } },
  { name: 'Bold Section', t: { bg: 'linear-gradient(120deg,#0a0e1a,#04343a)', display: 'Oswald', body: 'Inter', title: '#ffffff', sub: '#8fe9da', bodyColor: '#cfeee7', accent: '#00e0c6', accentText: '#04141a', kicker: '#00e0c6', titleUpper: true, sectionUpper: true } },
  { name: 'Sunset Quote', t: { bg: 'linear-gradient(135deg,#3a1020,#7a2a12)', display: 'Oswald', body: 'Inter', quoteFont: 'Cormorant Garamond', title: '#ffffff', sub: '#ffd0b0', bodyColor: '#ffe3d0', accent: '#ffce6b', accentText: '#3a1208', kicker: '#ffce6b' } },
  { name: 'Teal Minimal', t: { bg: 'linear-gradient(160deg,#04242a,#0a3a44)', display: 'Inter', body: 'Inter', title: '#ffffff', sub: '#7fe0d0', bodyColor: '#bfe9e0', accent: '#16e0a3', accentText: '#04241f', kicker: '#5fe0c8' } },
  { name: 'Mono Tech', t: { bg: '#0a0e12', display: 'Inter', body: 'JetBrains Mono', title: '#ffffff', sub: '#9fb6d6', bodyColor: '#c3d0e0', accent: '#5fd0ff', accentText: '#02141c', kicker: '#5fd0ff' } },
  { name: 'Scripture Slide', t: { bg: 'linear-gradient(180deg,#0c1424,#0a0f1a)', display: 'Cormorant Garamond', body: 'Inter', quoteFont: 'Cormorant Garamond', title: '#ffffff', sub: '#9bc4ff', bodyColor: '#d6e2f5', accent: '#7cc0ff', accentText: '#02132e', kicker: '#9bc4ff', serif: true } },
  { name: 'Announcement', t: { bg: 'linear-gradient(120deg,#102a5c,#1d4ed8)', display: 'Oswald', body: 'Inter', title: '#ffffff', sub: '#cfe0ff', bodyColor: '#e3ecff', accent: '#ffd166', accentText: '#1a1205', kicker: '#ffd166', titleUpper: true } },
  { name: 'Cinematic', t: { bg: 'radial-gradient(circle at 50% 38%,#1c1c1c,#000000)', display: 'Cinzel', body: 'Inter', quoteFont: 'Cormorant Garamond', title: '#f4ecd8', sub: '#c9c2b0', bodyColor: '#d8d2c4', accent: '#d4b478', accentText: '#1a1206', kicker: '#d4b478', serif: true } },
  { name: 'Royal Blue', t: { bg: 'linear-gradient(140deg,#0a1a4a,#2a4bd0)', display: 'Poppins', body: 'Inter', title: '#ffffff', sub: '#c7d4ff', bodyColor: '#e0e8ff', accent: '#ffffff', accentText: '#0a1a4a', kicker: '#bcd0ff' } },
  { name: 'Forest Green', t: { bg: 'linear-gradient(160deg,#06120c,#103a22)', display: 'Archivo', body: 'Inter', title: '#ffffff', sub: '#9fd8b5', bodyColor: '#cfeede', accent: '#43e97b', accentText: '#04241a', kicker: '#7af0a8' } },
  { name: 'Slate', t: { bg: 'linear-gradient(160deg,#10141c,#222a38)', display: 'Inter', body: 'Inter', title: '#f2f5fa', sub: '#9aa6bd', bodyColor: '#c3ccdc', accent: '#6e8cff', accentText: '#0a0e1a', kicker: '#9fb0e0' } },
  { name: 'Crimson', t: { bg: 'linear-gradient(135deg,#1a0608,#7a0f1a)', display: 'Oswald', body: 'Inter', title: '#ffffff', sub: '#ffb3b8', bodyColor: '#ffd6d9', accent: '#ff3b4e', accentText: '#2a0408', kicker: '#ff8a93', titleUpper: true } },
  { name: 'Aurora', t: { bg: 'linear-gradient(135deg,#06121f,#0a2f4a 55%,#103a44)', display: 'Jost', body: 'Inter', title: '#ffffff', sub: '#9fe0ff', bodyColor: '#d0eefb', accent: '#38f9d7', accentText: '#042422', kicker: '#7fe9ff' } },
  { name: 'Desert Sand', t: { bg: 'linear-gradient(160deg,#1c1408,#3a2a14)', display: 'Marcellus', body: 'EB Garamond', quoteFont: 'Cormorant Garamond', title: '#f6ecd6', sub: '#d8c79a', bodyColor: '#e8dcc0', accent: '#e0a64e', accentText: '#1c1206', kicker: '#e0a64e', serif: true } },
  { name: 'Charcoal', t: { bg: '#16181d', display: 'Bebas Neue', body: 'Inter', title: '#ffffff', sub: '#aab2c0', bodyColor: '#cdd3de', accent: '#ffb020', accentText: '#1a1205', kicker: '#ffb020' } },
  { name: 'Deep Ocean', t: { bg: 'linear-gradient(180deg,#021a2e,#063a52)', display: 'Lora', body: 'Inter', quoteFont: 'Lora', title: '#eaf6ff', sub: '#8fc8e6', bodyColor: '#cbe6f3', accent: '#34c6e0', accentText: '#02202c', kicker: '#7fd6ec', serif: true } },
  { name: 'Berry', t: { bg: 'linear-gradient(135deg,#240a2e,#5a1a6e)', display: 'Poppins', body: 'Inter', title: '#ffffff', sub: '#e6b8ff', bodyColor: '#f0d8ff', accent: '#ff5edb', accentText: '#2a0a30', kicker: '#ff9ae8' } },
  { name: 'Spring Mint', t: { bg: 'linear-gradient(160deg,#0a221c,#13443a)', display: 'Jost', body: 'Inter', title: '#ffffff', sub: '#9fe6cf', bodyColor: '#cdeede', accent: '#43e9c0', accentText: '#04241c', kicker: '#7af0d8' } },
];

fs.mkdirSync(OUT, { recursive: true });
// Clear any prior presentation-*.json (the old element-based set) so none linger.
for (const f of fs.readdirSync(OUT)) {
  if (/^presentation-.*\.json$/i.test(f)) fs.unlinkSync(path.join(OUT, f));
}

let n = 0;
for (const { name, t } of THEMES) {
  n += 1;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const theme = { name, category: 'presentation', sort_order: 60 + n, style: { kind: 'pres-theme', ...t } };
  const file = path.join(OUT, `presentation-${String(n).padStart(2, '0')}-${slug}.json`);
  fs.writeFileSync(file, JSON.stringify(theme, null, 2) + '\n');
}
console.log(`${n} presentation themes → ${OUT}`);
