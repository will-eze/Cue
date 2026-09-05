// Resolve the final style for a song/scripture slide from its own section style and
// the effective theme style. This is the single rule shared by the output payload
// (OperatorView.buildPayload) and the operator monitors (PreviewLivePanel) so preview
// always matches output.
//
// A section's style_json can hold two very different things:
//   • a full BAKED base look (an older "apply theme" wrote font/colour/shadow/bg…),
//   • only CONTENT-level bits — inline `runs` (per-character bold/colour ranges) and a
//     `textBox` — which belong to the item, not the theme.
//
// Content-level bits overlay the theme's base look; a baked base look wins outright
// (until "Reset to theme" strips it). So a song that was never themed, or was reset,
// inherits the live theme while keeping any inline formatting — matching §2's rule
// "content edits are not the theme."
const CONTENT_ONLY_KEYS = new Set(['runs', 'textBox']);

export function mergeSlideStyle(sectionStyle, themeStyle) {
  const hasBaseLook = sectionStyle && Object.keys(sectionStyle).some((k) => !CONTENT_ONLY_KEYS.has(k));
  if (hasBaseLook) return sectionStyle;          // explicit baked look wins
  if (!themeStyle) return sectionStyle || null;  // no theme → whatever the section had (runs-only, or null)
  const merged = { ...themeStyle };              // inherit the theme base, keep content bits on top
  if (sectionStyle?.runs?.length) merged.runs = sectionStyle.runs;
  if (sectionStyle?.textBox) merged.textBox = sectionStyle.textBox;
  return merged;
}
