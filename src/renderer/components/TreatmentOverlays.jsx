// Theme TREATMENT layer — the designed legibility + grade stack that sits between
// the background and the text (§5 of plan/theme-redesign.md). One coordinated set of
// overlays turns a flat "font on a wash" into a composed, commercial-looking slide:
//
//   directional scrim · vignette · film grain · colour grade/tint · frosted glass panel
//
// The pure builders here are MIRRORED VERBATIM in src/output/fullscreen.js (the plain-
// DOM output template can't import from the renderer, same rule as programFit()). Keep
// the two in exact sync or preview stops matching output. Ken Burns motion on stills is
// output-only (fullscreen.css keyframes); previews render the still frame.
//
// Back-compat: a theme with only the legacy flat `bgScrim` (no `treatment`) resolves to
// a flat black scrim of that strength — pixel-identical to the old single #scrim div.

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

// Tiny fractal-noise tile as a data-URI, blended over the frame for film grain.
export const GRAIN_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Build the CSS `background` value for the directional legibility scrim.
function scrimBackground(shape, strength) {
  const s = clamp01(strength);
  if (s <= 0 || shape === 'none') return null;
  const a = (x) => `rgba(0,0,0,${+(s * x).toFixed(3)})`;
  switch (shape) {
    case 'bottom': return `linear-gradient(to top, ${a(1)} 0%, ${a(0.55)} 26%, rgba(0,0,0,0) 60%)`;
    case 'top':    return `linear-gradient(to bottom, ${a(1)} 0%, ${a(0.55)} 26%, rgba(0,0,0,0) 60%)`;
    case 'radial': return `radial-gradient(125% 95% at 50% 62%, rgba(0,0,0,0) 34%, ${a(1)} 100%)`;
    case 'flat':
    default:       return a(1);
  }
}

// Ordered list of overlay descriptors { key, css } — each an absolutely-positioned
// inset:0 div, painted over the background and under the text/content layer. Resolution-
// independent (gradients + a tiled noise), so a small preview and a 4K output match.
export function treatmentLayers(style) {
  const s = style || {};
  const t = s.treatment || {};
  const layers = [];

  // Colour grade / tint — blends with the background so stock reads as "branded".
  if (t.tint && t.tint.color && clamp01(t.tint.amount) > 0) {
    layers.push({ key: 'tint', css: {
      position: 'absolute', inset: 0, pointerEvents: 'none',
      background: t.tint.color, opacity: clamp01(t.tint.amount),
      mixBlendMode: t.tint.blend || 'soft-light',
    } });
  }

  // Directional legibility scrim. `treatment.scrim` (shape) supersedes the legacy flat
  // `bgScrim`; when only bgScrim is present it degrades to a flat scrim of that strength.
  const shape = t.scrim || (s.bgScrim ? 'flat' : 'none');
  const strength = t.scrimStrength != null ? t.scrimStrength : (s.bgScrim || 0);
  const scr = scrimBackground(shape, strength);
  if (scr) layers.push({ key: 'scrim', css: { position: 'absolute', inset: 0, pointerEvents: 'none', background: scr } });

  // Vignette — edge darkening that pulls the eye to the centred text.
  if (clamp01(t.vignette) > 0) {
    layers.push({ key: 'vignette', css: {
      position: 'absolute', inset: 0, pointerEvents: 'none',
      background: `radial-gradient(130% 130% at 50% 50%, rgba(0,0,0,0) 52%, rgba(0,0,0,${clamp01(t.vignette)}) 100%)`,
    } });
  }

  // Film grain — a faint tiled noise, overlay-blended.
  if (clamp01(t.grain) > 0) {
    layers.push({ key: 'grain', css: {
      position: 'absolute', inset: 0, pointerEvents: 'none',
      backgroundImage: GRAIN_URI, backgroundSize: '160px 160px',
      opacity: clamp01(t.grain) * 0.5, mixBlendMode: 'overlay',
    } });
  }

  return layers;
}

// Does the style carry any treatment beyond a legacy flat scrim? (Cheap gate.)
export function hasTreatment(style) {
  const t = style && style.treatment;
  if (!t) return false;
  return !!((t.scrim && t.scrim !== 'none') || t.vignette || t.grain
    || (t.tint && t.tint.amount) || (t.glass && t.glass.enabled) || (t.kenBurns && t.kenBurns !== 'none'));
}

// Frosted "glass" panel behind the text box — a backdrop-blurred, tinted, rounded card
// for legibility on busy photos. Returns an inline-style object to merge onto the text
// container, or null. `scale` shrinks the px blur/radius for small previews so they read
// like the full-size output. When glass is enabled it supersedes the plain boxFill panel.
export function glassBoxStyle(style, scale = 1) {
  const g = style && style.treatment && style.treatment.glass;
  if (!g || !g.enabled) return null;
  const blur = Math.max(0, (g.blur != null ? g.blur : 18)) * scale;
  const radius = Math.round((g.radius != null ? g.radius : 22) * scale);
  const pad = Math.round((g.pad != null ? g.pad : 40) * scale);
  const tint = g.tint || '#0a0e1a';
  const op = g.opacity != null ? g.opacity : 0.28;
  const r = parseInt(tint.slice(1, 3), 16) || 0;
  const gg = parseInt(tint.slice(3, 5), 16) || 0;
  const b = parseInt(tint.slice(5, 7), 16) || 0;
  return {
    background: `rgba(${r},${gg},${b},${op})`,
    backdropFilter: `blur(${blur}px) saturate(1.1)`,
    WebkitBackdropFilter: `blur(${blur}px) saturate(1.1)`,
    borderRadius: radius + 'px',
    padding: pad + 'px',
    border: '1px solid rgba(255,255,255,0.08)',
  };
}

// React overlay stack — drops the treatment layers into a preview's background box.
// Render it as a sibling above <background> and below the text layer.
export default function TreatmentOverlays({ style }) {
  const layers = treatmentLayers(style);
  if (!layers.length) return null;
  return layers.map((l) => <div key={l.key} style={l.css} />);
}
