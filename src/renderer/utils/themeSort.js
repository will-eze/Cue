// Shared theme grouping/ordering: curated flagship COLLECTIONS lead (kind -1), then
// built-in MEDIA themes, built-in gradient/text themes, then the user's CUSTOM themes.
export function themeKind(theme) {
  if (!theme.builtin) return 2;
  let style = {};
  try { style = theme.style_json ? JSON.parse(theme.style_json) : {}; } catch {}
  if (style.collection) return -1; // flagship Collections (art-directed) lead the gallery
  return (style.bgRef || theme.background_id) ? 0 : 1;
}

// A theme is "curated" (shown by default) if it's the user's own, or a built-in
// tagged as a flagship Collection. Legacy built-ins (the pre-Collections packs) are
// hidden from browsing unless the user opts to show them — they still exist in the DB
// and resolve normally, so any default/override pointing at one keeps working.
export function isCuratedTheme(theme) {
  if (!theme.builtin) return true;
  try { return !!JSON.parse(theme.style_json || '{}').collection; } catch { return false; }
}

// Filter a theme list for browsing. `showLegacy` reveals the hidden legacy built-ins;
// `keepIds` always includes specific ids (e.g. the currently-selected theme) so a
// selection pointing at a hidden legacy theme still renders as selected.
export function filterBrowseThemes(themes, { showLegacy = false, keepIds = [] } = {}) {
  if (showLegacy) return themes;
  const keep = new Set(keepIds.filter((v) => v != null).map(Number));
  return themes.filter((t) => isCuratedTheme(t) || keep.has(Number(t.id)));
}

// Returns [{ t, kind }] sorted media → gradient → custom (stable within a group).
export function sortThemes(themes) {
  return themes
    .map((t) => ({ t, kind: themeKind(t) }))
    .sort((a, b) => a.kind - b.kind
      || (a.t.sort_order ?? 0) - (b.t.sort_order ?? 0)
      || a.t.name.localeCompare(b.t.name));
}
