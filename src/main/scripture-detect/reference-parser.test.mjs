// Unit tests for the spoken-reference parser. Pure logic, no Electron — run with:
//   node src/main/scripture-detect/reference-parser.test.mjs
import { parseReferences, bestReference } from './reference-parser.js';
import { wordsToNumbers } from './numbers.js';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (ok) pass++; else { fail++; console.error(`✗ ${label}\n    got:  ${got}\n    want: ${want}`); }
};

// ── number normalization ─────────────────────────────────────────────────────
eq('num sixteen', wordsToNumbers('sixteen'), '16');
eq('num twenty three', wordsToNumbers('twenty three'), '23');
eq('num twenty-first', wordsToNumbers('twenty-first'), '21');
eq('num one hundred nineteen', wordsToNumbers('one hundred nineteen'), '119');
eq('num keeps words', wordsToNumbers('john chapter three verse sixteen'), 'john chapter 3 verse 16');

// ── reference parsing ────────────────────────────────────────────────────────
const ref = (s) => bestReference(s)?.ref ?? null;

eq('first corinthians thirteen verse four',
   ref('turn to first corinthians thirteen verse four'), '1 Corinthians 13:4');
eq('john chapter three sixteen',
   ref('john chapter three sixteen'), 'John 3:16');
eq('john 3:16 digit form',
   ref('john 3:16'), 'John 3:16');
eq('psalm twenty three (whole chapter)',
   ref('let us read psalm twenty three'), 'Psalms 23');
eq('fuzzy filipinos four six',
   ref('filipinos four six'), 'Philippians 4:6');
eq('fuzzy romance five eight',
   ref('romance five eight'), 'Romans 5:8');
eq('range john 3:16-18',
   ref('john three sixteen through eighteen'), 'John 3:16-18');
eq('second timothy three sixteen',
   ref('second timothy three sixteen'), '2 Timothy 3:16');

// ── false-positive guard: ambiguous short words without a cue ─────────────────
eq('"this is 3 people" → no ref',
   ref('this is 3 people in the room'), null);

// confidence: explicit cue beats bare
const cued = bestReference('john chapter three verse sixteen');
const bare = bestReference('john three sixteen');
eq('cued ≥ bare confidence', cued.confidence >= bare.confidence, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
