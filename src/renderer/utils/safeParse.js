// Never-throwing JSON parse for DB JSON columns (style_json, elements_json, …).
// Returns the value unchanged if it is already an object, `fallback` on
// null/empty/invalid input.
export function safeParse(json, fallback = null) {
  if (json == null) return fallback;
  if (typeof json === 'object') return json;
  if (typeof json !== 'string' || json.trim() === '') return fallback;
  try {
    const v = JSON.parse(json);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

export default safeParse;
