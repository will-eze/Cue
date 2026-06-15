// Phase 1c — 10 built-in SCRIPTURE themes (category: 'scripture').
//
// Same theme/style model as the song themes, but tuned for verse display:
// readable serif at a smaller size with generous line spacing, plus a styled
// reference line carried in `style.refStyle` (the ScriptureEditor applies it to
// the reference, the verse style to the body). Background = a `bgRef`
// background-library item (Option A, resolved on apply). Legibility = option A
// (strong shadow) with a light scrim on the brighter dawn/desert clips.
//
// Seeded by name like all bundled themes (seedBundledThemes), sort_order 40+.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'themes');
mkdirSync(OUT, { recursive: true });

const S = (a = 0.85, blur = 22) => ({ enabled: true, x: 0, y: 2, blur, color: `rgba(0,0,0,${a})` });
const BAR = { css: 'linear-gradient(to top, rgba(6,8,12,0.94) 0%, rgba(6,8,12,0.82) 70%, rgba(6,8,12,0) 100%)' };
// Reference-line style: smaller, dimmer, right-aligned (a verse citation).
const REF = (font, extra = {}) => ({
  fontFamily: font, fontSize: 34, color: 'rgba(255,255,255,0.82)',
  align: 'right', italic: true, textShadow: S(0.8, 14), ...extra,
});

// verse: { fontFamily, fontSize~56, color, lineSpacing, italic?, textShadow }
const THEMES = [
  { name: 'Sacred Text',  bgRef: 'library/unsplash-A_wwo4UM-L4.jpg',                  verse: { fontFamily: 'Cormorant Garamond', fontSize: 60, color: '#fdfaf2' }, ref: 'Cormorant Garamond' },
  { name: 'Wilderness',   bgRef: 'library/pixabay-204680.mp4',         scrim: 0.30,   verse: { fontFamily: 'Marcellus', fontSize: 54, color: '#ffffff' }, ref: 'Marcellus' },
  { name: 'Desert Dawn',  bgRef: 'library/pexels-10872797.mp4',        scrim: 0.32,   verse: { fontFamily: 'EB Garamond', italic: true, fontSize: 58, color: '#fdf3e6' }, ref: 'EB Garamond' },
  { name: 'Ancient Hills',bgRef: 'library/pexels-35573592.mp4',        scrim: 0.20,   verse: { fontFamily: 'Lora', fontSize: 52, color: '#f4f6fb' }, ref: 'Lora' },
  { name: 'Starlight',    bgRef: 'library/unsplash-phIFdC6lA4E.jpg',                  verse: { fontFamily: 'Cormorant Garamond', fontSize: 60, color: '#eef2ff' }, ref: 'Cormorant Garamond' },
  { name: 'Deep Night',   bgRef: 'library/unsplash-X8o-P23flgI.jpg',                  verse: { fontFamily: 'EB Garamond', fontSize: 56, color: '#f3f4fa' }, ref: 'EB Garamond' },
  { name: 'Misty Vale',   bgRef: 'library/coverr-the-mountains-in-the-fog-llj1bha8qn.mp4', scrim: 0.22, verse: { fontFamily: 'Lora', fontSize: 52, color: '#ffffff' }, ref: 'Lora' },
  { name: 'Quiet Wood',   bgRef: 'library/coverr-dark-forest-nuemaprau7.mp4',         verse: { fontFamily: 'Cormorant Garamond', fontSize: 58, color: '#f1f7f2' }, ref: 'Cormorant Garamond' },
  { name: 'Constellations',bgRef: 'library/unsplash-R49cUgaQ0mk.jpg',                 verse: { fontFamily: 'Marcellus', fontSize: 54, color: '#eaf0ff' }, ref: 'Marcellus' },
  { name: 'Stillness',    bgRef: 'library/pexels-13423306.mp4',                       verse: { fontFamily: 'Cormorant Garamond', italic: true, fontSize: 60, color: '#eef3ff' }, ref: 'Cormorant Garamond' },
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
THEMES.forEach((t, i) => {
  const style = {
    ...t.verse,
    lineSpacing: 1.35,
    textShadow: S(),
    bgRef: t.bgRef,
    ...(t.scrim ? { bgScrim: t.scrim } : {}),
    ltBar: BAR,
    refStyle: REF(t.ref),
  };
  const theme = { name: t.name, category: 'scripture', sort_order: 40 + i, style };
  writeFileSync(join(OUT, `scripture-${String(i + 1).padStart(2, '0')}-${slug(t.name)}.json`),
    JSON.stringify(theme, null, 2) + '\n');
});
console.log(`Wrote ${THEMES.length} scripture themes to resources/themes/`);
