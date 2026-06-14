// Pure scoring + precision-gating for content matching. No model/Electron deps,
// so it is unit-testable. Vectors are assumed L2-normalized (the embedder
// normalizes on output), so cosine similarity is a plain dot product.

export function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function l2normalize(vec) {
  let s = 0;
  for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] * inv;
  return out;
}

// Rank candidates by cosine to the query vector. `candidates` is
// [{ vec, ...meta }]; returns the same objects with a `score`, sorted desc.
export function rankByCosine(queryVec, candidates) {
  return candidates
    .map((c) => ({ ...c, score: dot(queryVec, c.vec) }))
    .sort((a, b) => b.score - a.score);
}

// Default precision gates. Content matches only surface when the operator can
// trust them, so we require an absolute score, a margin over the runner-up, and
// a minimum quoted length. Tunable per-install via the manager config.
export const DEFAULT_GATES = {
  minScore: 0.62,     // absolute cosine floor
  minMargin: 0.05,    // top must beat 2nd-best by this
  minWords: 6,        // shorter quotes are too ambiguous
};

// Decide whether the top ranked hit is trustworthy enough to surface.
// `ranked` is the output of rankByCosine; `wordCount` is the query length.
// Returns { ok, hit, score, margin, reason }.
export function gate(ranked, wordCount, gates = DEFAULT_GATES) {
  const g = { ...DEFAULT_GATES, ...gates };
  if (!ranked.length) return { ok: false, reason: 'no-candidates' };
  if (wordCount < g.minWords) return { ok: false, hit: ranked[0], reason: 'too-short' };
  const top = ranked[0];
  const margin = top.score - (ranked[1]?.score ?? 0);
  if (top.score < g.minScore) return { ok: false, hit: top, score: top.score, margin, reason: 'low-score' };
  if (margin < g.minMargin) return { ok: false, hit: top, score: top.score, margin, reason: 'low-margin' };
  return { ok: true, hit: top, score: top.score, margin, reason: 'ok' };
}
