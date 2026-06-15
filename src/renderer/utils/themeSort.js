// Shared theme grouping/ordering: built-in MEDIA themes first, built-in
// gradient/text themes next, then the user's CUSTOM themes (kind 0/1/2).
export function themeKind(theme) {
  if (!theme.builtin) return 2;
  let style = {};
  try { style = theme.style_json ? JSON.parse(theme.style_json) : {}; } catch {}
  return (style.bgRef || theme.background_id) ? 0 : 1;
}

// Returns [{ t, kind }] sorted media → gradient → custom (stable within a group).
export function sortThemes(themes) {
  return themes
    .map((t) => ({ t, kind: themeKind(t) }))
    .sort((a, b) => a.kind - b.kind
      || (a.t.sort_order ?? 0) - (b.t.sort_order ?? 0)
      || a.t.name.localeCompare(b.t.name));
}
