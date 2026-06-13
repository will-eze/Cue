// Unit tests for content-match scoring/gating. Run with:
//   node src/main/scripture-detect/match-score.test.mjs
import { l2normalize, rankByCosine, gate, DEFAULT_GATES } from './match-score.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };

const v = (...xs) => l2normalize(Float32Array.from(xs));

// John 3:16-ish embeds near the query; a generic verse sits far away.
const cands = [
  { ref: 'John 3:16', vec: v(1, 0.9, 0.1) },
  { ref: 'Gen 1:1',   vec: v(0.1, 0.1, 1) },
  { ref: 'Ps 23:1',   vec: v(0.2, 0.0, 0.9) },
];
const query = v(1, 0.85, 0.05);

const ranked = rankByCosine(query, cands);
ok('top candidate is John 3:16', ranked[0].ref === 'John 3:16');
ok('ranked descending', ranked[0].score >= ranked[1].score);

const g = gate(ranked, 10);
ok('confident match passes gate', g.ok && g.hit.ref === 'John 3:16');

// Too-short quote is rejected even with a strong score.
ok('short quote rejected', gate(ranked, 3).ok === false);

// Generic sentence: all candidates similar + low → no confident match.
const flat = [
  { ref: 'A', vec: v(1, 1, 1) },
  { ref: 'B', vec: v(1, 1, 0.98) },
];
const flatQ = v(0.4, 0.4, 0.4);
const fg = gate(rankByCosine(flatQ, flat), 10, { minScore: 0.95, minMargin: 0.1 });
ok('low-margin generic rejected', fg.ok === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
