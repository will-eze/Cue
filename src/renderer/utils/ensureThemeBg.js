// Assigning a theme that carries a photo/video background (a `bgRef` from the media
// library) as a default / rundown / item look must DOWNLOAD that media first. The live
// theme cascade resolves a theme's background from its `background_path`, which stays
// null until the bgRef is fetched — so without this the newly-assigned theme renders a
// BLACK background until the media happens to be downloaded some other way.
//
// Resolve it here, showing a spinner toast ONLY when a real download will happen —
// gradient/solid themes (no bgRef) and already-cached themes are instant no-ops, so a
// normal assignment never flashes a spinner. Returns the resolved theme (or the input).
export async function ensureThemeBg(theme, toast) {
  if (!theme || !theme.id) return theme;
  let needs = false;
  try {
    const st = theme.style_json ? JSON.parse(theme.style_json) : null;
    needs = !theme.background_id && !theme.background_path && !!(st && st.bgRef);
  } catch { needs = false; }
  if (!needs) return theme;

  const p = window.cue.themes.resolveBackground(theme.id);
  if (toast && toast.promise) {
    return toast.promise(p, {
      pending: `Downloading “${theme.name}” background…`,
      success: `“${theme.name}” background ready`,
      error: `Couldn’t download “${theme.name}” background`,
    });
  }
  try { return await p; } catch { return theme; }
}
