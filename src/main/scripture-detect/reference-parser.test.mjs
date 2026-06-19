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

// ── natural-language bare "<book> <chapter> <verse>" (no cue word) ────────────
// Ministers commonly speak "Genesis one one" / "Psalms twenty thirteen" with no
// "chapter"/"verse" cue. These must resolve AND clear the 0.6 detection floor.
eq('bare genesis 1 1', ref('genesis 1 1'), 'Genesis 1:1');
eq('bare psalms 20 13', ref('psalms 20 13'), 'Psalms 20:13');
eq('spoken genesis one one', ref('genesis one one'), 'Genesis 1:1');
eq('spoken psalms twenty thirteen', ref('psalms twenty thirteen'), 'Psalms 20:13');

const bareClears = (s) => (bestReference(s)?.confidence ?? 0) >= 0.6;
eq('bare pair clears floor', bareClears('genesis 1 1'), true);

// A mis-heard book name riding a complete chapter+verse reference must still fire
// (as a suggestion). This is the real ASR case: "Genisis 1 1", "filipinos 4 6".
eq('fuzzy genisis 1 1 resolves', ref('genisis 1 1'), 'Genesis 1:1');
eq('fuzzy genisis 1 1 clears floor', bareClears('genisis 1 1'), true);
eq('fuzzy filipinos 4 6 clears floor', bareClears('filipinos 4 6'), true);

// …but a fuzzy book with only a chapter (no verse) stays below the floor, so a
// stray mis-heard word followed by one number can't masquerade as a reference.
eq('fuzzy bare chapter-only stays below floor',
   (bestReference('filipinos four')?.confidence ?? 0) < 0.6, true);

// An uncertain book ID (abbrev / fuzzy) on a complete reference is a SUGGESTION,
// never auto-air: 'jon'/'act' are everyday words. Must clear 0.6 but stay < 0.8.
const band = (s) => { const c = bestReference(s)?.confidence ?? 0; return c >= 0.6 && c < 0.8; };
eq('abbrev jon 3 16 suggests (not auto)', band('jon 3 16'), true);
eq('abbrev act 2 38 suggests (not auto)', band('act 2 38'), true);
eq('fuzzy genisis 1 1 suggests (not auto)', band('genisis 1 1'), true);
// An exact name on a complete reference DOES reach the auto-air tier.
eq('exact genesis 1 1 reaches auto tier',
   (bestReference('genesis 1 1')?.confidence ?? 0) >= 0.8, true);

// ── false-positive guard: ambiguous short words without a cue ─────────────────
eq('"this is 3 people" → no ref',
   ref('this is 3 people in the room'), null);

// confidence: explicit cue beats bare
const cued = bestReference('john chapter three verse sixteen');
const bare = bestReference('john three sixteen');
eq('cued ≥ bare confidence', cued.confidence >= bare.confidence, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
