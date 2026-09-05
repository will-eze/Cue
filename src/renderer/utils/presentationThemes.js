// Presentation theme-pack model.
//
// A presentation THEME is a layout-agnostic visual style — tokens only (background,
// scrim, fonts, colours, flags). It is stored in the `themes` table (category
// 'presentation') as style_json = { kind:'pres-theme', ...tokens }. A LAYOUT is a
// theme-agnostic structural recipe (which text roles appear and where).
//
//   slide = buildThemeSlide(tokens, layoutId)   →  composed elements (§21 shape)
//
// so any theme renders any layout, and a deck can be re-skinned by swapping tokens
// (reskinSlide) — each composed element is tagged with its `role` so re-theming maps
// fonts/colours/background back on cleanly. Pure data (no React) — shared by the
// PresentationEditor (new-slide modal + apply-theme) and the ThemeSettings preview.

let _uid = 0;
const eid = () => `pt_${Date.now().toString(36)}_${(_uid++).toString(36)}`;

export function isThemeTokens(sj) {
  return !!(sj && typeof sj === 'object' && sj.kind === 'pres-theme');
}

// ── One look, any surface ────────────────────────────────────────────────────
// A theme is a single "look" — there is no song vs scripture vs presentation
// theme. Songs & scripture consume the text-style shape (DEFAULT_STYLE: fontFamily
// /color/textShadow/bgCss/ltBar/accent…); presentations consume the token shape
// above. These two converters let ANY stored theme be applied to ANY surface, so
// the library is one flat set of looks.

// Presentation tokens → a song/scripture text style (so a token theme can style a
// lyric slide or a verse). Colours collapse to the title colour; the display font
// leads; a gradient bg becomes bgCss; the accent rides along for the lower third.
export function presTokensToStyle(tokens) {
  const t = tokens || {};
  const style = {
    fontFamily: t.display || t.body || 'Inter',
    color: t.title || '#ffffff',
    uppercase: !!t.titleUpper,
  };
  if (typeof t.bg === 'string' && t.bg) style.bgCss = t.bg;
  if (t.scrim) style.bgScrim = t.scrim;
  if (t.treatment) style.treatment = t.treatment; // designed legibility/grade layer (§5)
  if (t.accent) style.accent = { enabled: true, color: t.accent };
  return style;
}

// A song/scripture text style → presentation tokens (so a look applies to a deck).
// Media backgrounds ride separately (bgMedia in buildThemeSlide/reskinSlide); only a
// gradient/solid bgCss maps to tokens.bg here.
export function styleToPresTokens(style) {
  const s = style || {};
  const font = s.fontFamily || 'Inter';
  const color = s.color || '#ffffff';
  const accent = s.accent?.color || '#4d8eff';
  return {
    kind: 'pres-theme',
    bg: (typeof s.bgCss === 'string' && s.bgCss) ? s.bgCss : null,
    scrim: s.bgScrim || 0,
    display: font, body: font, quoteFont: font,
    title: color, sub: color, bodyColor: color,
    accent, accentText: '#0a0e1a', kicker: accent,
    titleUpper: !!s.uppercase, sectionUpper: !!s.uppercase, serif: false,
    bgRef: s.bgRef || undefined,
    treatment: s.treatment || undefined, // designed legibility/grade layer (§5)
  };
}

// Normalise any stored theme style_json into the text-style shape songs/scripture
// need — passes a text style through untouched, converts a token theme. Used by the
// live cascade + every text-surface preview so one theme renders anywhere.
export function normalizeLookStyle(styleObj) {
  return isThemeTokens(styleObj) ? presTokensToStyle(styleObj) : (styleObj || null);
}

// Normalise any stored theme style_json into presentation tokens — passes a token
// theme through untouched, converts a text-style look.
export function normalizeToPresTokens(styleObj) {
  if (!styleObj) return { ...PLAIN_THEME };
  return isThemeTokens(styleObj) ? styleObj : styleToPresTokens(styleObj);
}

// "No theme" — neutral tokens with no baked background (the slide's own background_id
// / global slide background / black shows through), matching the plain blank layouts.
export const PLAIN_THEME = { kind: 'pres-theme', bg: null, display: 'Inter', body: 'Inter',
  title: '#ffffff', sub: '#c2c6d6', bodyColor: '#ffffff', accent: '#4d8eff', accentText: '#ffffff', kicker: '#4d8eff' };

// ── Layout recipes (structure only; styled from tokens at build time) ────────────
const DEFAULT_TEXT = {
  title: 'Title', subtitle: 'Subtitle', body: 'Body text goes here — add your points on this slide.',
  section: 'Section', kicker: 'KICKER', statement: 'Your statement goes here',
  quote: '“A quote goes here.”', attribution: '— Attribution',
  verse: '“For God so loved the world, that he gave his only Son.”', reference: 'JOHN 3:16',
  col: 'Column text goes here.',
};

// Each layout is a list of specs: text roles, an accent bar, or an accent line.
export const PRES_LAYOUTS = [
  { id: 'title', name: 'Title', specs: [
    { t: 'text', role: 'title', box: { x: 8, y: 38, w: 84, h: 20 }, size: 96 },
  ] },
  { id: 'title-sub', name: 'Title + Subtitle', specs: [
    { t: 'text', role: 'title', box: { x: 8, y: 33, w: 84, h: 18 }, size: 88 },
    { t: 'text', role: 'subtitle', box: { x: 14, y: 56, w: 72, h: 12 }, size: 44 },
  ] },
  { id: 'kicker-title', name: 'Kicker + Title', specs: [
    { t: 'text', role: 'kicker', box: { x: 8, y: 28, w: 84, h: 8 }, size: 26, align: 'left', valign: 'center' },
    { t: 'text', role: 'title', box: { x: 8, y: 37, w: 84, h: 20 }, size: 84, align: 'left', valign: 'center' },
    { t: 'line', box: { x: 8, y: 62, w: 22 } },
  ] },
  { id: 'title-body', name: 'Title + Body', specs: [
    { t: 'text', role: 'title', box: { x: 8, y: 8, w: 84, h: 16 }, size: 68, align: 'left', valign: 'center' },
    { t: 'text', role: 'body', box: { x: 8, y: 28, w: 84, h: 64 }, size: 42, align: 'left', valign: 'top' },
  ] },
  { id: 'section', name: 'Section Header', specs: [
    { t: 'accent', box: { x: 0, y: 40, w: 100, h: 20 } },
    { t: 'text', role: 'section', box: { x: 8, y: 40, w: 84, h: 20 }, size: 88, onAccent: true },
  ] },
  { id: 'statement', name: 'Statement', specs: [
    { t: 'text', role: 'statement', box: { x: 8, y: 28, w: 84, h: 44 }, size: 66 },
  ] },
  { id: 'quote', name: 'Quote', specs: [
    { t: 'text', role: 'quote', box: { x: 12, y: 26, w: 76, h: 36 }, size: 60 },
    { t: 'text', role: 'attribution', box: { x: 14, y: 66, w: 72, h: 10 }, size: 28 },
  ] },
  { id: 'scripture', name: 'Scripture', specs: [
    { t: 'text', role: 'verse', box: { x: 10, y: 24, w: 80, h: 42 }, size: 54 },
    { t: 'text', role: 'reference', box: { x: 14, y: 70, w: 72, h: 8 }, size: 30 },
  ] },
  { id: 'two-column', name: 'Two Column', specs: [
    { t: 'text', role: 'title', box: { x: 8, y: 8, w: 84, h: 14 }, size: 58, align: 'left', valign: 'center' },
    { t: 'text', role: 'col', box: { x: 8, y: 28, w: 40, h: 64 }, size: 36, align: 'left', valign: 'top', text: 'Column one — first set of points.' },
    { t: 'text', role: 'col', box: { x: 52, y: 28, w: 40, h: 64 }, size: 36, align: 'left', valign: 'top', text: 'Column two — second set of points.' },
  ] },
  { id: 'blank', name: 'Blank', specs: [] },
];

// ── Token → role style ───────────────────────────────────────────────────────────
const HEADING_ROLES = new Set(['title', 'section', 'statement', 'kicker']);
const UPPER_ROLES = new Set(['kicker', 'reference', 'attribution']);
const SERIF_ROLES = new Set(['quote', 'verse']);

function roleStyle(tokens, role, sp = {}) {
  const t = tokens || {};
  const heading = HEADING_ROLES.has(role);
  let font = heading ? (t.display || 'Inter') : (t.body || 'Inter');
  if (SERIF_ROLES.has(role)) font = t.quoteFont || t.display || 'Cormorant Garamond';

  let color;
  if (sp.onAccent) color = t.accentText || '#0a0e1a';
  else if (role === 'subtitle') color = t.sub || t.bodyColor || '#c2c6d6';
  else if (role === 'body' || role === 'col') color = t.bodyColor || '#e6ebf5';
  else if (role === 'kicker' || role === 'attribution' || role === 'reference') color = t.kicker || t.accent || '#9fb6d6';
  else color = t.title || '#ffffff'; // title/section/statement/quote/verse

  const upper = UPPER_ROLES.has(role) || (role === 'title' && t.titleUpper) || (role === 'section' && (t.sectionUpper || t.titleUpper));
  return {
    fontFamily: font,
    fontSize: sp.size ?? 48,
    color,
    bold: heading ? (t.serif ? false : true) : false,
    italic: SERIF_ROLES.has(role),
    uppercase: !!upper,
    align: sp.align || 'center',
    verticalAlign: sp.valign || 'center',
    letterSpacing: upper ? 0.16 : 0,
    lineSpacing: (role === 'body' || role === 'col' || role === 'quote' || role === 'verse') ? 1.3 : 1.12,
  };
}

const bgShape = (fill) => ({ id: eid(), type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 100, z: 0, rotation: 0, opacity: 1, fill: fill || '#0a0e12', stroke: { color: '', width: 0 }, radius: 0, role: 'background' });
const bgImageEl = (mediaId, path) => ({ id: eid(), type: 'image', x: 0, y: 0, w: 100, h: 100, z: 0, rotation: 0, opacity: 1, fit: 'cover', mediaId, path: path || null, role: 'background' });
const scrimShape = (op) => ({ id: eid(), type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 100, z: 1, rotation: 0, opacity: Math.max(0, Math.min(1, op)), fill: '#000000', stroke: { color: '', width: 0 }, radius: 0, role: 'scrim' });

function specElement(sp, tokens, z) {
  if (sp.t === 'accent') {
    return { id: eid(), type: 'shape', shape: 'rect', ...sp.box, z, rotation: 0, opacity: 1, fill: tokens.accent || '#4d8eff', stroke: { color: '', width: 0 }, radius: 0, role: 'accent' };
  }
  if (sp.t === 'line') {
    return { id: eid(), type: 'shape', shape: 'line', x: sp.box.x, y: sp.box.y, w: sp.box.w, h: 1, z, rotation: 0, opacity: 1, fill: '', stroke: { color: tokens.accent || '#4d8eff', width: 3 }, role: 'accent' };
  }
  return { id: eid(), type: 'text', x: sp.box.x, y: sp.box.y, w: sp.box.w, h: sp.box.h, z, rotation: 0, opacity: 1,
    role: sp.role, text: sp.text || DEFAULT_TEXT[sp.role] || '', style: roleStyle(tokens, sp.role, sp) };
}

// Compose a slide's elements for a theme × layout. Background is either a full-bleed
// gradient/solid shape (gradient themes) or a media image element (photo themes when
// bgMedia = {id, path} is provided). Photo themes fall back to tokens.bg gradient for
// previews rendered before the background has been downloaded.
export function buildThemeSlide(tokens, layoutId, bgMedia) {
  const layout = PRES_LAYOUTS.find((l) => l.id === layoutId) || PRES_LAYOUTS[0];
  const els = [];
  if (bgMedia) {
    els.push(bgImageEl(bgMedia.id, bgMedia.path));
  } else if (tokens?.bg) {
    els.push(bgShape(tokens.bg)); // gradient theme, or photo-theme preview fallback
  }
  if (tokens?.scrim) els.push(scrimShape(tokens.scrim));
  let z = 2;
  for (const sp of layout.specs) els.push(specElement(sp, tokens || {}, z++));
  return els;
}

// Best-effort: identify which theme a slide's composed elements were built from, by
// matching the baked background (gradient fill or photo mediaId) plus accent/font as
// tiebreakers. Returns the matching theme id, or null when there's no confident match.
// Lets the new-slide picker default to the deck's current theme.
// `themes` = [{ id, name, tokens, background_id? }].
export function detectThemeId(elements, themes) {
  if (!Array.isArray(themes) || !themes.length) return null;
  const els = elements || [];
  const bgEl = els.find((e) => e.role === 'background');
  const accentEl = els.find((e) => e.role === 'accent');
  const textEl = els.find((e) => e.type === 'text' && e.role);
  const bgFill = bgEl?.type === 'shape' ? (bgEl.fill ?? null) : null;
  const bgMediaId = bgEl?.type === 'image' ? bgEl.mediaId : null;
  const accent = accentEl ? (accentEl.fill || accentEl.stroke?.color || null) : null;
  const font = textEl?.style?.fontFamily || null;
  let best = null, bestScore = 0;
  for (const t of themes) {
    const tk = t.tokens || {};
    let score = 0;
    if (bgMediaId && t.background_id && Number(t.background_id) === Number(bgMediaId)) score += 3;
    else if (bgFill && tk.bg && tk.bg === bgFill) score += 2;
    if (accent && tk.accent && tk.accent === accent) score += 1;
    if (font && (tk.display === font || tk.body === font)) score += 1;
    if (score > bestScore) { bestScore = score; best = t.id; }
  }
  return bestScore > 0 ? best : null;
}

// Re-skin existing slide elements with a theme's tokens: swap the background (gradient
// or photo), recolour accents, and restyle role-tagged text while PRESERVING content,
// sizes and positions. Untagged (hand-made) elements are left untouched.
// bgMedia = { id, path } when the theme is photo-backed and has been resolved.
export function reskinSlide(tokens, elements, bgMedia) {
  let hasBg = false;
  const out = (elements || []).map((el) => {
    if (el.role === 'background') {
      hasBg = true;
      if (bgMedia) return bgImageEl(bgMedia.id, bgMedia.path);
      if (tokens.bg) return bgShape(tokens.bg); // gradient theme replaces any bg
      return el; // no bg change (PLAIN_THEME, or photo theme not yet resolved)
    }
    if (el.role === 'scrim') return { ...el, opacity: Math.max(0, Math.min(1, tokens.scrim || 0)) };
    if (el.role === 'accent') {
      return el.type === 'shape' && el.shape === 'line'
        ? { ...el, stroke: { ...(el.stroke || {}), color: tokens.accent || '#4d8eff' } }
        : { ...el, fill: tokens.accent || '#4d8eff' };
    }
    if (el.type === 'text' && el.role) {
      const rs = roleStyle(tokens, el.role, { size: el.style?.fontSize, align: el.style?.align, valign: el.style?.verticalAlign, onAccent: el.role === 'section' });
      return { ...el, style: { ...el.style, fontFamily: rs.fontFamily, color: rs.color, italic: rs.italic, uppercase: rs.uppercase, letterSpacing: rs.letterSpacing } };
    }
    return el;
  });
  if (!hasBg) {
    if (bgMedia) out.unshift(bgImageEl(bgMedia.id, bgMedia.path));
    else if (tokens.bg) out.unshift(bgShape(tokens.bg));
  }
  return out;
}
