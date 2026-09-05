// Per-viewer theme favourites — a lightweight "pin the 2–3 themes I actually use"
// convenience, so localStorage is exactly right (private to this machine, survives
// reloads, never needs to sync). Ids are stored as numbers.
const KEY = 'cue_theme_favs';

export function getThemeFavs() {
  try { return new Set((JSON.parse(localStorage.getItem(KEY) || '[]') || []).map(Number)); }
  catch { return new Set(); }
}

export function toggleThemeFav(id) {
  const s = getThemeFavs();
  const n = Number(id);
  s.has(n) ? s.delete(n) : s.add(n);
  try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* private mode */ }
  return s;
}
