// A pragmatic WCAG contrast estimate for a theme, so the Studio can warn when body
// text won't clear ≥4.5:1 (§5.1). It's an ESTIMATE: for gradient/solid themes it uses
// the lightest colour stop (the worst spot for light text) darkened by the scrim; for
// photo/video themes the real pixels are unknown, so it reports against the treated
// worst case and flags itself as approximate.

function parseHex(hex) {
  if (!hex || typeof hex !== 'string') return null;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relLuminance({ r, g, b }) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const l1 = relLuminance(a), l2 = relLuminance(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const blend = (c, t, amt) => ({ r: c.r + (t.r - c.r) * amt, g: c.g + (t.g - c.g) * amt, b: c.b + (t.b - c.b) * amt });

// Returns { ratio, aa, aaa, approx } or null if it can't be estimated.
export function themeContrast(style) {
  if (!style) return null;
  const text = parseHex(style.color) || { r: 255, g: 255, b: 255 };

  let bg;
  let approx = false;
  const hexes = (typeof style.bgCss === 'string' ? (style.bgCss.match(/#[0-9a-fA-F]{3,8}/g) || []) : [])
    .map(parseHex).filter(Boolean);
  if (hexes.length) {
    // Worst case for light text = the LIGHTEST stop.
    bg = hexes.reduce((a, c) => (relLuminance(c) > relLuminance(a) ? c : a), hexes[0]);
  } else {
    // Photo/video theme — unknown pixels; assume a mid-tone worst case.
    bg = { r: 130, g: 130, b: 130 };
    approx = true;
  }

  // Treatment darkens the background behind text: scrim (toward black) + colour grade.
  const t = style.treatment || {};
  const scrim = clamp01(t.scrimStrength != null ? t.scrimStrength : style.bgScrim);
  if (scrim > 0) bg = blend(bg, { r: 0, g: 0, b: 0 }, scrim * 0.8);
  if (t.tint && t.tint.color && clamp01(t.tint.amount) > 0) {
    const tc = parseHex(t.tint.color);
    if (tc) bg = blend(bg, tc, clamp01(t.tint.amount) * 0.6);
  }
  if (t.glass && t.glass.enabled) {
    const gt = parseHex(t.glass.tint) || { r: 10, g: 14, b: 26 };
    bg = blend(bg, gt, clamp01(t.glass.opacity != null ? t.glass.opacity : 0.28));
    approx = true; // a blurred panel over unknown pixels
  }

  const r = ratio(text, bg);
  return { ratio: r, aa: r >= 4.5, aaa: r >= 7, approx };
}
