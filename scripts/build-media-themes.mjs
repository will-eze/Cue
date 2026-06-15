// Phase 1b Layer 2 — 20 built-in MEDIA themes.
//
// Like the gradient themes (build-themes.mjs) but the background is a curated
// Background-Library item referenced by `style.bgRef` (its manifest `file` id),
// NOT a bundled file or bgCss. Resolved lazily on apply (download → media_asset →
// theme.background_id) — see db/themes.js resolveThemeBackground + Option A.
//
// Legibility = option A (a strong drop shadow); backgrounds are chosen dark/moody
// so white text reads without a scrim. Writes resources/themes/media-NN-*.json,
// seeded by name (seedBundledThemes), sort_order 20+ (after the gradients).
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'themes');
mkdirSync(OUT, { recursive: true });

// Strong shadow for legibility on photos (heavier than the gradient themes').
const S = (a = 0.85, blur = 24) => ({ enabled: true, x: 0, y: 2, blur, color: `rgba(0,0,0,${a})` });
// Near-black lower-third fade so lyrics read over any media in lowerthird mode.
const BAR = (rgb = '6,8,12') => ({ css: `linear-gradient(to top, rgba(${rgb},0.94) 0%, rgba(${rgb},0.82) 70%, rgba(${rgb},0) 100%)` });

const THEMES = [
  { name: 'Summit',         bgRef: 'library/unsplash-v7daTKlZzaw.jpg',                 style: { fontFamily: 'Cinzel', color: '#ffffff', uppercase: true, fontSize: 84, letterSpacing: 0.06, textShadow: S(0.8, 26) } },
  { name: 'Evensong',       bgRef: 'library/unsplash-CO-rNFAVsRU.jpg',                 style: { fontFamily: 'Cormorant Garamond', italic: true, color: '#f3f6fa', fontSize: 92, textShadow: S() } },
  // (Drifting / Candlelight / First Light / Vigil reassigned below to darker,
  //  text-legible backgrounds after a readability review — 2026-06-15.)
  { name: 'Stillwater',     bgRef: 'library/unsplash-X6-_XS6rxhQ.jpg',                 style: { fontFamily: 'Jost', color: '#ffffff', fontSize: 78, letterSpacing: 0.01, textShadow: S() } },
  { name: 'Nightfall Ridge',bgRef: 'library/pexels-13423306.mp4',                      style: { fontFamily: 'Marcellus', color: '#eef2ff', fontSize: 82, textShadow: S(0.9) } },
  { name: 'Vigil',          bgRef: 'library/unsplash-phIFdC6lA4E.jpg',                 style: { fontFamily: 'EB Garamond', italic: true, color: '#f7eede', fontSize: 88, textShadow: S(0.9) } },
  { name: 'Emberlight',     bgRef: 'library/coverr-bokeh-lit-candle-ssevqevlcp.mp4',   style: { fontFamily: 'Cormorant Garamond', color: '#f8ecd6', fontSize: 90, textShadow: S(0.9) } },
  { name: 'Aurora Deep',    bgRef: 'library/unsplash-PUhss7IwnQc.jpg',                 style: { fontFamily: 'Poppins', bold: true, color: '#ffffff', fontSize: 74, textShadow: S() } },
  { name: 'Constellation',  bgRef: 'library/unsplash-R49cUgaQ0mk.jpg',                 style: { fontFamily: 'Jost', color: '#eaf0ff', fontSize: 78, letterSpacing: 0.02, textShadow: S(0.8) } },
  { name: 'Highland Mist',  bgRef: 'library/unsplash-ugnrXk1129g.jpg',                 style: { fontFamily: 'Lora', color: '#ffffff', fontSize: 80, textShadow: S() } },
  { name: 'Goldfall',       bgRef: 'library/unsplash-NCb50hjk-pQ.jpg',                 style: { fontFamily: 'DM Serif Display', color: '#fdf3df', fontSize: 86, textShadow: S(0.9) } },
  { name: 'Drifting',       bgRef: 'library/unsplash-Za2_FgJ4Nws.jpg',                 style: { fontFamily: 'Overpass', color: '#ffffff', fontSize: 76, textShadow: S() } },
  { name: 'Tidewatch',      bgRef: 'library/unsplash-gJILnne_HFg.jpg',                 style: { fontFamily: 'Barlow Condensed', uppercase: true, bold: true, color: '#ffffff', fontSize: 96, letterSpacing: 0.02, textShadow: S() } },
  { name: 'Snowfall',       bgRef: 'library/pexels-26081684.mp4',                      style: { fontFamily: 'Marcellus', color: '#ffffff', fontSize: 82, textShadow: S(0.8) } },
  { name: 'Winter Vigil',   bgRef: 'library/unsplash-mGU0TVjsfnU.jpg',                 style: { fontFamily: 'Cinzel', color: '#eef4ff', uppercase: true, fontSize: 80, letterSpacing: 0.05, textShadow: S(0.85) } },
  { name: 'Jubilee',        bgRef: 'library/pexels-19033583.mp4',                      style: { fontFamily: 'Bebas Neue', uppercase: true, color: '#ffffff', fontSize: 112, letterSpacing: 0.04, textShadow: S() } },
  { name: 'Festal Lights',  bgRef: 'library/pixabay-138193.mp4',                       style: { fontFamily: 'Poppins', bold: true, color: '#fff6e9', fontSize: 76, textShadow: S(0.9) } },
  { name: 'Wilderness',     bgRef: 'library/unsplash-4cloovdyuvw.jpg',                 style: { fontFamily: 'Marcellus', color: '#f7eedd', fontSize: 84, textShadow: S(0.85) } },
  { name: 'Candlelight',    bgRef: 'library/unsplash-2qP_xM2mWCY.jpg',                 style: { fontFamily: 'Cormorant Garamond', italic: true, color: '#f8ecd6', fontSize: 92, textShadow: S(0.9) } },
  { name: 'First Light',    bgRef: 'library/unsplash-vkdTGW1tyWY.jpg',                 style: { fontFamily: 'Cormorant Garamond', color: '#fdf6ea', fontSize: 90, textShadow: S(0.95, 30), bgScrim: 0.25 } },
  { name: 'Deep Calm',      bgRef: 'library/unsplash-G9i_plbfDgk.jpg',                 style: { fontFamily: 'Jost', color: '#ffffff', fontSize: 78, letterSpacing: 0.01, textShadow: S() } },
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
THEMES.forEach((t, i) => {
  const theme = {
    name: t.name,
    category: 'song',
    sort_order: 20 + i,
    style: { ...t.style, bgRef: t.bgRef, ltBar: BAR() },
  };
  const file = join(OUT, `media-${String(i + 1).padStart(2, '0')}-${slug(t.name)}.json`);
  writeFileSync(file, JSON.stringify(theme, null, 2) + '\n');
});
console.log(`Wrote ${THEMES.length} media themes to resources/themes/`);
