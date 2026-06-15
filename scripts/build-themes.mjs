// Authors the bundled song-theme pack as resources/themes/*.json (one file per
// theme), consumed by seedBundledThemes() in src/main/db/themes.js on first run.
//
//   node scripts/build-themes.mjs
//
// Each theme carries a §8 section style. Backgrounds are ORIGINAL CSS gradients/
// solids in `style.bgCss` (fullscreen) and `style.ltBar.css` (lower-third bar) —
// zero licensing/attribution exposure, no media asset. Fonts are all bundled
// free/OFL families (src/fonts). Photo-dependent reference looks are deferred to
// the Phase 1b curated-media library, not embedded here.
//
// Style shape (only set what differs from template defaults):
//   align, bold, italic, uppercase, fontFamily, fontSize, color, lineSpacing,
//   letterSpacing, verticalAlign, textShadow{enabled,x,y,blur,color},
//   textStroke{enabled,width,color}, textBox{x,y,w,h}, ltBar{color,opacity,solid,css},
//   bgCss

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'resources', 'themes');

// Soft drop shadow for legibility on busy gradients (dark themes).
const SHADOW = { enabled: true, x: 0, y: 2, blur: 28, color: 'rgba(0,0,0,0.55)' };
// A translucent bottom bar fade — pass a base rgb, get a lowerthird.css-style fade.
const barFade = (rgb) =>
  `linear-gradient(to top, rgba(${rgb},0.92) 0%, rgba(${rgb},0.7) 65%, rgba(${rgb},0) 100%)`;

// category + sort_order are assigned by array position below (all 'song' in 1a).
const THEMES = [
  // ── Bold / condensed impact ─────────────────────────────────────────────
  {
    name: 'Headline',
    style: {
      fontFamily: 'Bebas Neue', color: '#ffffff', uppercase: true, fontSize: 116,
      letterSpacing: 0.04, lineSpacing: 0.95, textShadow: { ...SHADOW, blur: 18 },
      bgCss: 'radial-gradient(circle at 50% 38%, #17191f 0%, #0a0a0c 72%)',
      ltBar: { css: 'linear-gradient(to top, rgba(8,8,10,0.94) 0%, rgba(8,8,10,0.82) 70%, rgba(8,8,10,0) 100%)' },
    },
  },
  {
    name: 'Nightfall',
    style: {
      fontFamily: 'Oswald', color: '#eaf2ff', uppercase: true, fontSize: 88,
      letterSpacing: 0.03, textShadow: { enabled: true, x: 0, y: 2, blur: 30, color: 'rgba(2,12,30,0.7)' },
      bgCss: 'radial-gradient(circle at 50% 30%, #15315e 0%, #0a1730 55%, #050a18 100%)',
      ltBar: { css: barFade('8,18,40') },
    },
  },
  {
    name: 'Banner',
    style: {
      fontFamily: 'Barlow Condensed', color: '#f6e7c6', uppercase: true, fontSize: 92, bold: true,
      letterSpacing: 0.02, textShadow: SHADOW,
      bgCss: 'linear-gradient(135deg, #7a1020 0%, #b22234 50%, #5e0d18 100%)',
      ltBar: { color: '#3c0810', opacity: 0.9, solid: true },
    },
  },
  // ── Geometric / clean sans ───────────────────────────────────────────────
  {
    name: 'Aurora',
    style: {
      fontFamily: 'Poppins', color: '#ffffff', bold: true, fontSize: 78,
      textShadow: { enabled: true, x: 0, y: 2, blur: 30, color: 'rgba(40,10,70,0.5)' },
      bgCss: 'linear-gradient(120deg, #b14cf0 0%, #c84ce0 32%, #7a5cf0 64%, #4a90e2 100%)',
      ltBar: { css: barFade('60,24,110') },
    },
  },
  {
    name: 'Tide',
    style: {
      fontFamily: 'Montserrat', color: '#ffffff', fontSize: 76, textShadow: SHADOW,
      bgCss: 'linear-gradient(135deg, #0a2540 0%, #155e63 60%, #0d7377 100%)',
      ltBar: { css: barFade('8,28,52') },
    },
  },
  {
    name: 'Meadow',
    style: {
      fontFamily: 'Jost', color: '#ffffff', fontSize: 78, textShadow: SHADOW,
      bgCss: 'linear-gradient(160deg, #1e5631 0%, #2e8b57 55%, #6ab04c 100%)',
      ltBar: { css: barFade('14,48,30') },
    },
  },
  {
    name: 'Clean Slate',
    style: {
      fontFamily: 'Archivo', color: '#f2f4f8', fontSize: 76, textShadow: SHADOW,
      bgCss: 'linear-gradient(150deg, #2b2f36 0%, #1a1d22 100%)',
      ltBar: { color: '#101216', opacity: 0.88, solid: true },
    },
  },
  {
    name: 'Open Air', // light theme — dark text on a daytime sky
    style: {
      fontFamily: 'Overpass', color: '#13314f', fontSize: 76, bold: true,
      textShadow: { enabled: false }, textStroke: { enabled: false },
      bgCss: 'linear-gradient(180deg, #bfe1ff 0%, #e3f2ff 60%, #ffffff 100%)',
      ltBar: { css: 'linear-gradient(to top, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.6) 70%, rgba(255,255,255,0) 100%)' },
    },
  },
  {
    name: 'Signal',
    style: {
      fontFamily: 'Roboto', color: '#eafffb', fontSize: 76, textShadow: SHADOW,
      bgCss: '#0f3d3e',
      ltBar: { color: '#08302f', opacity: 0.9, solid: true },
    },
  },
  // ── High-contrast / display serif ─────────────────────────────────────────
  {
    name: 'Sanctuary',
    style: {
      fontFamily: 'Playfair Display', color: '#f3ead7', fontSize: 78, letterSpacing: 0.01,
      textShadow: { enabled: true, x: 0, y: 2, blur: 30, color: 'rgba(0,0,0,0.6)' },
      bgCss: 'radial-gradient(circle at 50% 35%, #2a2a5e 0%, #14143a 55%, #07071a 100%)',
      ltBar: { css: barFade('12,12,40') },
    },
  },
  {
    name: 'Noel',
    style: {
      fontFamily: 'DM Serif Display', color: '#f0e7d2', fontSize: 80,
      textShadow: { enabled: true, x: 0, y: 2, blur: 28, color: 'rgba(0,0,0,0.6)' },
      bgCss: 'radial-gradient(circle at 50% 30%, #1a4a35 0%, #0d2a1f 60%, #061410 100%)',
      ltBar: { css: barFade('8,32,24') },
    },
  },
  {
    name: 'Cathedral',
    style: {
      fontFamily: 'Cinzel', color: '#e8c878', uppercase: true, fontSize: 60, letterSpacing: 0.08,
      textShadow: { enabled: true, x: 0, y: 2, blur: 26, color: 'rgba(0,0,0,0.65)' },
      bgCss: 'radial-gradient(circle at 50% 40%, #6e5018 0%, #3b2a0c 55%, #140d03 100%)',
      ltBar: { css: barFade('20,13,3') },
    },
  },
  {
    name: 'Crimson',
    style: {
      fontFamily: 'Marcellus', color: '#f2e3d0', uppercase: true, fontSize: 74, letterSpacing: 0.04,
      textShadow: { enabled: true, x: 0, y: 2, blur: 28, color: 'rgba(0,0,0,0.6)' },
      bgCss: 'radial-gradient(circle at 50% 35%, #8e1b2b 0%, #4d0d16 60%, #1c0508 100%)',
      ltBar: { css: barFade('28,5,8') },
    },
  },
  // ── Refined / elegant serif ────────────────────────────────────────────────
  {
    name: 'Daybreak',
    style: {
      fontFamily: 'Cormorant Garamond', color: '#fff6ef', italic: true, fontSize: 88,
      textShadow: { enabled: true, x: 0, y: 2, blur: 26, color: 'rgba(60,30,40,0.45)' },
      bgCss: 'linear-gradient(180deg, #e98a7a 0%, #d96f8f 40%, #9b6fb0 75%, #6a7fc0 100%)',
      ltBar: { css: barFade('120,60,90') },
    },
  },
  {
    name: 'Linen', // light theme — warm ivory with deep brown serif
    style: {
      fontFamily: 'EB Garamond', color: '#4a3b2a', fontSize: 80,
      textShadow: { enabled: false },
      bgCss: 'linear-gradient(160deg, #f7f1e6 0%, #efe6d4 100%)',
      ltBar: { css: 'linear-gradient(to top, rgba(247,241,230,0.92) 0%, rgba(247,241,230,0.6) 70%, rgba(247,241,230,0) 100%)' },
    },
  },
  {
    name: 'Manuscript',
    style: {
      fontFamily: 'Lora', color: '#f4f6fa', fontSize: 70, lineSpacing: 1.3, textShadow: SHADOW,
      bgCss: 'linear-gradient(160deg, #3a4a63 0%, #28344a 100%)',
      ltBar: { css: barFade('14,22,38') },
    },
  },
  {
    name: 'Vesper',
    style: {
      fontFamily: 'Cormorant Garamond', color: '#efeaff', fontSize: 84, letterSpacing: 0.02,
      textShadow: { enabled: true, x: 0, y: 2, blur: 28, color: 'rgba(0,0,0,0.55)' },
      bgCss: 'linear-gradient(160deg, #3b3a6b 0%, #2a2350 50%, #160f30 100%)',
      ltBar: { css: barFade('22,16,48') },
    },
  },
  // ── Warm / sunset ────────────────────────────────────────────────────────
  {
    name: 'Ember',
    style: {
      fontFamily: 'Playfair Display', color: '#fbe6c8', uppercase: true, fontSize: 74, letterSpacing: 0.02,
      textShadow: { enabled: true, x: 0, y: 2, blur: 28, color: 'rgba(40,8,0,0.6)' },
      bgCss: 'radial-gradient(circle at 50% 45%, #e8821e 0%, #b23a12 45%, #5e1408 100%)',
      ltBar: { css: barFade('40,10,4') },
    },
  },
  {
    name: 'Sundown',
    style: {
      fontFamily: 'Montserrat', color: '#ffffff', bold: true, fontSize: 76,
      textShadow: { enabled: true, x: 0, y: 2, blur: 30, color: 'rgba(50,10,40,0.5)' },
      bgCss: 'linear-gradient(160deg, #ff8a4c 0%, #ff5e7e 45%, #8b4bc7 100%)',
      ltBar: { css: barFade('70,20,60') },
    },
  },
  // ── Script / special occasion ──────────────────────────────────────────────
  {
    name: 'Grace', // light, soft — Dancing Script for short special-occasion text
    style: {
      fontFamily: 'Dancing Script', color: '#6a4a6e', fontSize: 96, bold: true,
      textShadow: { enabled: false },
      bgCss: 'linear-gradient(160deg, #f6dfe8 0%, #e7d4f0 55%, #d8e0f5 100%)',
      ltBar: { css: 'linear-gradient(to top, rgba(246,223,232,0.92) 0%, rgba(246,223,232,0.6) 70%, rgba(246,223,232,0) 100%)' },
    },
  },
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

fs.mkdirSync(OUT, { recursive: true });
// Clear stale generated files so renames don't leave orphans.
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.json'))) fs.unlinkSync(path.join(OUT, f));

THEMES.forEach((t, i) => {
  const out = { name: t.name, category: t.category || 'song', sort_order: i, style: t.style };
  const fname = `${String(i).padStart(2, '0')}-${slug(t.name)}.json`;
  fs.writeFileSync(path.join(OUT, fname), JSON.stringify(out, null, 2) + '\n');
  console.log('  ', fname);
});
console.log(`\nWrote ${THEMES.length} theme JSON files → resources/themes/`);
