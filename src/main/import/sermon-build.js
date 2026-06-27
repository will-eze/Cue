// Sermon → Slides — the DB-aware half: take the structure plan from
// sermon-import.js, resolve each scripture reference to verse text from Cue's
// Bible, lay out every slide's elements on the 1920×1080 canvas, apply the chosen
// theme (text style + background), and create a native presentation.

import { buildSermonStructure, extractText } from './sermon-import.js';
import * as bible from '../db/bible.js';
import * as themes from '../db/themes.js';
import * as presentations from '../db/presentations.js';
import { get as getSetting } from '../db/settings.js';

// Text-style keys worth inheriting from a theme onto a slide's text elements.
// fontSize / align / uppercase are set PER ROLE below (a theme's 116px lyric size
// would blow out a bullet list), and bgCss/ltBar/bgRef aren't text properties.
const INHERIT_KEYS = ['fontFamily', 'color', 'letterSpacing', 'lineSpacing', 'textShadow', 'textStroke', 'bold', 'italic'];

function baseTextStyle(themeStyle) {
  const out = {};
  for (const k of INHERIT_KEYS) if (themeStyle[k] != null) out[k] = themeStyle[k];
  return out;
}

let _eid = 0;
const nextId = () => `el_${Date.now().toString(36)}_${_eid++}`;

function textEl(text, box, style) {
  return { id: nextId(), type: 'text', ...box, rotation: 0, opacity: 1, text, style };
}

// Resolve a passage and split it into one-or-more scripture slides, chunking long
// passages by combined text length so a multi-verse reading stays readable.
function scriptureSlides(slide, versionId, baseStyle) {
  const passage = versionId ? bible.resolvePassage(versionId, slide.reference, 1) : null;
  const refStyle = { ...baseStyle, align: 'center', fontSize: 30, italic: true, uppercase: false, bold: false };

  // No Bible / verse not found → a clean reference-only slide (graceful fallback).
  if (!passage || !passage.verses?.length) {
    return [{
      role: 'scripture',
      elements: [textEl(slide.reference, { x: 8, y: 38, w: 84, h: 24 }, { ...baseStyle, align: 'center', fontSize: 64, bold: true, uppercase: false })],
    }];
  }

  const verses = passage.verses;
  const multi = verses.length > 1;
  const groups = [];
  let cur = [], curLen = 0;
  for (const v of verses) {
    const piece = (multi ? `${v.verse} ` : '') + v.text;
    if (cur.length && curLen + piece.length > 360) { groups.push(cur); cur = []; curLen = 0; }
    cur.push({ ...v, piece });
    curLen += piece.length;
  }
  if (cur.length) groups.push(cur);

  return groups.map((g) => {
    const body = g.map((v) => v.piece).join('  ');
    const first = g[0].verse, last = g[g.length - 1].verse;
    const ref = (multi
      ? `${passage.bookName} ${passage.verses[0].chapter}:${first}${last !== first ? '-' + last : ''}`
      : passage.reference) + (passage.versionAbbrev ? ` (${passage.versionAbbrev})` : '');
    // Verse text shrinks a touch for longer readings.
    const fs = body.length > 220 ? 38 : 46;
    return {
      role: 'scripture',
      elements: [
        textEl(body, { x: 8, y: 12, w: 84, h: 64 }, { ...baseStyle, align: 'center', verticalAlign: 'center', fontSize: fs, uppercase: false }),
        textEl(ref, { x: 8, y: 82, w: 84, h: 10 }, refStyle),
      ],
    };
  });
}

// Build the element array for a title / main-point / sub-point-heading / bullet slide.
function contentSlide(slide, baseStyle) {
  const centre = { align: 'center', verticalAlign: 'center' };

  // Sermon title — large centred title with the anchor passage beneath it.
  if (slide.role === 'title') {
    const els = [textEl(slide.title || 'Sermon',
      { x: 6, y: slide.subtitle ? 24 : 32, w: 88, h: 42 },
      { ...baseStyle, ...centre, fontSize: 90, bold: true, uppercase: false })];
    if (slide.subtitle) els.push(textEl(slide.subtitle,
      { x: 8, y: 68, w: 84, h: 12 },
      { ...baseStyle, align: 'center', fontSize: 42, italic: true, bold: false, uppercase: false }));
    return els;
  }

  // Sub-point content slide — top to bottom: the parent main point (subtitle), the
  // sub-point heading (+ its "(i)" number), the reference line (parent anchor + this
  // sub-point's refs), then the exposition as a left-aligned box of one-sentence bullets.
  // Each zone is optional (a point preamble has no sub-heading; the intro has no subtitle).
  if (slide.role === 'heading') {
    const els = [];
    let y = 5;
    if (slide.subtitle) {
      els.push(textEl(slide.subtitle,
        { x: 6, y, w: 88, h: 7 },
        { ...baseStyle, align: 'center', verticalAlign: 'center', fontSize: 28, italic: true, bold: false, uppercase: false }));
      y += 8;
    }
    if (slide.title) {
      const head = (slide.marker ? `${slide.marker}  ` : '') + slide.title;
      els.push(textEl(head,
        { x: 6, y, w: 88, h: 11 },
        { ...baseStyle, align: 'center', verticalAlign: 'center', fontSize: 40, bold: true, uppercase: false }));
      y += 12;
    }
    if (slide.caption) {
      els.push(textEl(slide.caption,
        { x: 6, y, w: 88, h: 6 },
        { ...baseStyle, align: 'center', verticalAlign: 'center', fontSize: 24, italic: true, bold: false, uppercase: false }));
      y += 7;
    }
    if (slide.bullets && slide.bullets.length) {
      const bullets = slide.bullets.join('\n');
      els.push(textEl(bullets,
        { x: 8, y: y + 1, w: 84, h: 95 - (y + 1) },
        { ...baseStyle, align: 'left', verticalAlign: 'top', fontSize: 34, uppercase: false, lineSpacing: baseStyle.lineSpacing || 1.3, listStyle: 'disc', bulletSpacing: 0.15 }));
    }
    return els;
  }

  // Main point (subtitle) — a title-styled slide + anchor ref.
  if (slide.role === 'point' && !(slide.bullets && slide.bullets.length)) {
    const els = [textEl(slide.title || '',
      { x: 6, y: slide.subtitle ? 28 : 32, w: 88, h: 42 },
      { ...baseStyle, ...centre, fontSize: 68, bold: true, uppercase: false })];
    if (slide.subtitle) els.push(textEl(slide.subtitle,
      { x: 8, y: 68, w: 84, h: 12 },
      { ...baseStyle, align: 'center', fontSize: 38, italic: true, bold: false, uppercase: false }));
    return els;
  }

  // Generic point with bullets (flat single-tier docs / markdown headings).
  const els = [];
  const hasHeading = !!slide.title;
  if (hasHeading) {
    els.push(textEl(slide.title,
      { x: 8, y: 9, w: 84, h: 16 },
      { ...baseStyle, align: 'left', verticalAlign: 'center', fontSize: 60, bold: true }));
  }
  const bullets = (slide.bullets || []).join('\n');
  if (bullets) {
    els.push(textEl(bullets,
      hasHeading ? { x: 10, y: 28, w: 80, h: 64 } : { x: 10, y: 14, w: 80, h: 72 },
      { ...baseStyle, align: 'left', verticalAlign: 'top', fontSize: 40, uppercase: false, lineSpacing: baseStyle.lineSpacing || 1.3, listStyle: 'disc', bulletSpacing: 0.15 }));
  }
  return els;
}

// Generate a presentation from a sermon. opts: { text?, filePath?, title, themeId,
// versionId }. PDFs arrive as `text` (extracted in the renderer); txt/md/docx as a
// `filePath` that main reads here. Returns { id, slideCount, title }.
export async function generateSermonPresentation(opts = {}) {
  const { themeId } = opts;
  const text = opts.text && String(opts.text).trim()
    ? opts.text
    : (opts.filePath ? extractText(opts.filePath) : '');
  if (!text || !String(text).trim()) throw new Error('No readable text was found in the document.');

  const structure = buildSermonStructure(text, { title: opts.title });

  // Resolve the theme (download a media-backed theme's asset if it's lazy).
  let theme = null;
  if (themeId) {
    try { await themes.resolveThemeBackground(themeId); } catch { /* keep going with no bg */ }
    theme = themes.get(themeId);
  }
  let themeStyle = {};
  try { themeStyle = theme?.style_json ? JSON.parse(theme.style_json) : {}; } catch { themeStyle = {}; }
  const baseStyle = baseTextStyle(themeStyle);

  // Background: theme bgCss → full-bleed shape; else media background_id (theme's,
  // or the global slide default) → slide.background_id. Text sits above either.
  const bgCss = themeStyle.bgCss || null;
  const mediaBgId = bgCss ? null : (theme?.background_id || getSetting('global_bg_slide_id') || null);

  const versionId = opts.versionId || (bible.listVersions()[0]?.id ?? null);

  const built = [];
  for (const s of structure.slides) {
    const slidesForPlan = s.role === 'scripture'
      ? scriptureSlides(s, versionId, baseStyle)
      : [{ role: s.role, elements: contentSlide(s, baseStyle) }];
    built.push(...slidesForPlan);
  }

  const slides = built.map((b, i) => {
    const elements = [];
    if (bgCss) {
      elements.push({ id: `bg_${i}`, type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, z: 0, fill: bgCss });
    }
    // Lift content above the background shape.
    for (const el of b.elements) elements.push({ ...el, z: (el.z || 0) + 1 });
    const label = { scripture: 'Scripture', title: 'Title', point: 'Point', heading: 'Heading' }[b.role] || null;
    return { label, background_id: mediaBgId, elements };
  });

  const id = presentations.create({ title: structure.title, slides });
  return { id, slideCount: slides.length, title: structure.title };
}
