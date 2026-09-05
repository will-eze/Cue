import { normalizeLookStyle } from './presentationThemes';

// Build a searchable text blob for a theme so the picker matches by MOOD/character, not
// just name — e.g. "serif", "video", "gradient", "dark", "glass", "grain", "collection".
// Derived from the theme itself (font, background type, treatment, colour), so no themes
// need hand-tagging. Cached on the theme object to avoid re-parsing on every keystroke.
const SERIF = ['garamond', 'lora', 'playfair', 'cinzel', 'marcellus', 'cormorant', 'serif', 'newsreader', 'spectral', 'crimson', 'cardo', 'alegreya'];
const DISPLAY = ['bebas', 'oswald', 'archivo', 'anton', 'staatliches', 'fjalla', 'teko', 'unbounded', 'fraunces'];
const SCRIPT = ['dancing', 'caveat', 'sacramento', 'great vibes', 'parisienne', 'kalam'];

export function themeSearchText(theme) {
  if (!theme) return '';
  if (theme.__searchText) return theme.__searchText;
  const parts = [String(theme.name || '')];
  let st = {};
  try { st = theme.style_json ? JSON.parse(theme.style_json) : {}; } catch { st = {}; }
  const norm = normalizeLookStyle(st) || st;

  const font = String(norm.fontFamily || '').toLowerCase();
  if (font) {
    parts.push(font);
    if (SERIF.some((s) => font.includes(s))) parts.push('serif elegant reverent');
    else if (DISPLAY.some((s) => font.includes(s))) parts.push('display bold condensed impact');
    else if (SCRIPT.some((s) => font.includes(s))) parts.push('script handwritten');
    else parts.push('sans clean modern');
  }

  if (st.bgRef) parts.push(/\.(mp4|webm|mov|m4v)/i.test(st.bgRef) ? 'video motion' : 'photo image');
  else if (st.bgCss) parts.push('gradient solid');

  const t = norm.treatment || {};
  if (t.glass && t.glass.enabled) parts.push('frosted glass panel');
  if (t.grain) parts.push('film grain texture');
  const darkTreat = (t.scrimStrength || norm.bgScrim || 0) >= 0.4 || (t.vignette || 0) >= 0.35;
  if (darkTreat) parts.push('dark moody cinematic');
  if (t.kenBurns && t.kenBurns !== 'none') parts.push('motion');

  // Light vs dark by the text colour (light text ⇒ dark theme, and vice-versa).
  const col = String(norm.color || '#ffffff').toLowerCase();
  parts.push(/#[0-4]/.test(col) ? 'light bright airy' : 'dark');

  if (st.collection) parts.push('collection curated flagship');
  if (theme.builtin) parts.push('built-in'); else parts.push('custom mine');

  const text = parts.join(' ').toLowerCase();
  try { Object.defineProperty(theme, '__searchText', { value: text, enumerable: false }); } catch { /* frozen */ }
  return text;
}
