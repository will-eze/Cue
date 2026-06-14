// Spoken-number normalization for the scripture reference parser.
//
// ASR emits chapter/verse numbers as WORDS ("john chapter three verse sixteen"),
// and book ordinals as words too ("first corinthians"). This converts runs of
// English number words into digit tokens in-place, leaving everything else
// untouched, so the reference grammar downstream only ever sees digits.
//
// Scope is deliberately small: chapter/verse numbers and 1/2/3-book ordinals.
// Handles units, teens, tens, "hundred", ordinals ("third", "twenty-first"),
// and hyphenated compounds ("twenty-three"). NOT applied to the content-match
// path — only the reference path — so ordinary speech is never digit-mangled.

const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const ORDINAL_UNITS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50,
  sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90, hundredth: 100,
};

const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

// Classify a token to a value + place so the accumulator knows whether a new
// word should COMBINE with the running number ("twenty"+"three" → 23) or START a
// fresh one ("three"+"sixteen" → 3, 16, i.e. chapter 3 verse 16).
function categorize(tok) {
  if (tok in UNITS) { const v = UNITS[tok]; return { v, cat: v < 10 ? 'unit' : 'teen' }; }
  if (tok in TENS) return { v: TENS[tok], cat: 'ten' };
  if (tok in ORDINAL_UNITS) {
    const v = ORDINAL_UNITS[tok];
    if (v === 100) return { v, cat: 'scale100' };
    return { v, cat: v < 10 ? 'unit' : v < 20 ? 'teen' : 'ten' };
  }
  return undefined;
}

export const NUMBER_WORDS = new Set([
  ...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(ORDINAL_UNITS),
  'hundred', 'thousand', 'and',
]);

// Convert spoken-number runs in `text` to digit tokens. Returns a normalized,
// lowercased, space-separated string. Hyphens inside compounds are split first
// ("twenty-first" → "twenty first") so each component is one token.
export function wordsToNumbers(text) {
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/(?<!\d)[-–](?!\d)/g, ' ') // split hyphenated compounds, but keep numeric ranges ("16-18")
    .replace(/[^\p{L}\p{N}\s:-]/gu, ' ')  // keep letters/digits/colon/range-hyphen
    .split(/\s+/)
    .filter(Boolean);

  const out = [];
  let total = 0, current = 0, saw = false;

  const emit = () => {
    if (saw) out.push(String(total + current));
    total = 0; current = 0; saw = false;
  };

  for (const tok of tokens) {
    if (tok === 'hundred') {
      current = (current || 1) * 100; saw = true; continue;
    }
    if (tok === 'thousand') {
      total += (current || 1) * 1000; current = 0; saw = true; continue;
    }
    if (tok === 'and' && saw) continue;   // "one hundred and nineteen" connector

    const c = categorize(tok);
    if (!c) { emit(); out.push(tok); continue; }
    if (c.cat === 'scale100') { current = (current || 1) * 100; saw = true; continue; }

    if (c.cat === 'ten') {
      // A tens word only combines onto a hundreds base ("one hundred twenty").
      if (current % 100 === 0 && current !== 0) current += c.v;
      else { emit(); current = c.v; saw = true; }
    } else {
      // unit/teen combines onto a hundreds base, or a unit onto a bare tens word.
      const canCombine = current !== 0 && (
        current % 100 === 0 ||
        (c.cat === 'unit' && current >= 20 && current <= 90 && current % 10 === 0)
      );
      if (canCombine) current += c.v;
      else { emit(); current = c.v; saw = true; }
    }
  }
  emit();
  return out.join(' ');
}
