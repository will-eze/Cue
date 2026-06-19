// Unit tests for stage scheduled-message logic. Run with:
//   node src/shared/stage-schedule.test.mjs
import {
  resolveAnchors, collides, overlapIds, resolveActive, pruneExpired, nextPruneDelay,
} from './stage-schedule.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };

const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN;
const NOW = new Date(2026, 5, 19, 10, 0, 0, 0).getTime(); // local 2026-06-19 10:00:00.000

// ── resolveAnchors: countdown (afterSeconds) ─────────────────────────────────
{
  const r = resolveAnchors({ afterSeconds: 15 }, NOW);
  ok('afterSeconds 15 → +15s', r.showAt === NOW + 15 * SEC);
  ok('afterSeconds no clear → clearAt null', r.clearAt === null);
}
{
  const r = resolveAnchors({ afterSeconds: 0 }, NOW);
  ok('afterSeconds 0 → immediate (== now)', r.showAt === NOW);
}
{
  const r = resolveAnchors({ afterSeconds: 90, clearAfter: 30 }, NOW);
  ok('clearAfter 30 → clearAt = showAt + 30s', r.clearAt === NOW + 90 * SEC + 30 * SEC);
}
{
  const r = resolveAnchors({ afterSeconds: 90, clearAfter: 0 }, NOW);
  ok('clearAfter 0 → never (null)', r.clearAt === null);
}

// ── resolveAnchors: wall-clock (atHour/atMinute) ─────────────────────────────
{
  const r = resolveAnchors({ atHour: 11, atMinute: 30 }, NOW);
  ok('at 11:30 (future today) → today 11:30', r.showAt === new Date(2026, 5, 19, 11, 30, 0, 0).getTime());
}
{
  const r = resolveAnchors({ atHour: 9, atMinute: 0 }, NOW);
  ok('at 09:00 (past today) → tomorrow 09:00', r.showAt === new Date(2026, 5, 20, 9, 0, 0, 0).getTime());
}
{
  // Exactly "now" counts as past (<=) → rolls to next day, never schedules in the past.
  const r = resolveAnchors({ atHour: 10, atMinute: 0 }, NOW);
  ok('at exactly now → next day (no past schedule)', r.showAt === NOW + 24 * HOUR);
}
{
  const r = resolveAnchors({ atHour: 23, atMinute: 59, clearAfter: 60 }, NOW);
  ok('wall-clock + clearAfter applies to resolved showAt', r.clearAt === r.showAt + 60 * SEC);
}

// ── resolveAnchors: degenerate / missing inputs ──────────────────────────────
{
  const r = resolveAnchors({}, NOW);
  ok('no timing info → immediate', r.showAt === NOW && r.clearAt === null);
}
{
  const r = resolveAnchors(undefined, NOW);
  ok('undefined spec → immediate, no throw', r.showAt === NOW && r.clearAt === null);
}

// ── collides ─────────────────────────────────────────────────────────────────
const m = (id, showAt, clearAt = null) => ({ id, showAt, clearAt });
{
  // The original bug: two open-ended messages in sequence are NOT a collision.
  const a = m(1, NOW), b = m(2, NOW + 5 * MIN);
  ok('two open-ended in sequence → no collision', collides(a, b) === false);
  ok('collides is symmetric (open-ended)', collides(b, a) === false);
}
{
  const a = m(1, NOW), b = m(2, NOW); // identical start
  ok('same showAt → collision', collides(a, b) === true);
}
{
  // earlier clears at +5m, later starts at +3m → cuts it short → collision
  const a = m(1, NOW, NOW + 5 * MIN), b = m(2, NOW + 3 * MIN);
  ok('later starts inside explicit clear window → collision', collides(a, b) === true);
  ok('collides symmetric (cut-short)', collides(b, a) === true);
}
{
  // later starts exactly AT earlier's clearAt → windows touch but don't overlap,
  // and the starts differ so the same-start rule doesn't apply either.
  const a = m(1, NOW, NOW + 5 * MIN), b = m(2, NOW + 5 * MIN);
  ok('boundary touch (clearAt == next showAt) → no collision', collides(a, b) === false);
}
{
  // later starts after earlier fully cleared → no collision
  const a = m(1, NOW, NOW + 2 * MIN), b = m(2, NOW + 5 * MIN);
  ok('later starts after earlier cleared → no collision', collides(a, b) === false);
}
{
  // earlier open-ended, later has a clear window → still just replacement, no collision
  const a = m(1, NOW), b = m(2, NOW + 3 * MIN, NOW + 9 * MIN);
  ok('earlier open-ended + later windowed → no collision', collides(a, b) === false);
}

// ── overlapIds ───────────────────────────────────────────────────────────────
{
  // user's reported scenario: nothing should be flagged
  const list = [m(1, NOW), m(2, NOW + 4 * MIN)];
  ok('open-ended pair → empty overlap set', overlapIds(list).size === 0);
}
{
  const list = [
    m(1, NOW, NOW + 5 * MIN), // cut short by 2
    m(2, NOW + 3 * MIN),      // starts inside 1's window
    m(3, NOW + 30 * MIN),     // far away, clean
  ];
  const ids = overlapIds(list);
  ok('only the genuinely conflicting pair is flagged', ids.has(1) && ids.has(2) && !ids.has(3));
  ok('overlap set size is 2', ids.size === 2);
}
{
  ok('empty schedule → empty overlap set', overlapIds([]).size === 0);
}

// ── resolveActive ────────────────────────────────────────────────────────────
{
  ok('nothing scheduled → null', resolveActive([], NOW) === null);
}
{
  const list = [m(1, NOW + 1 * MIN)];
  ok('before showAt → null', resolveActive(list, NOW) === null);
  ok('at exactly showAt → active (inclusive)', resolveActive(list, NOW + 1 * MIN)?.id === 1);
}
{
  const list = [m(1, NOW, NOW + 2 * MIN)];
  ok('within window → active', resolveActive(list, NOW + 1 * MIN)?.id === 1);
  ok('at exactly clearAt → not active (exclusive)', resolveActive(list, NOW + 2 * MIN) === null);
}
{
  // overlapping: the later-starting one wins
  const list = [m(1, NOW, NOW + 10 * MIN), m(2, NOW + 3 * MIN, NOW + 6 * MIN)];
  ok('overlap → later start wins', resolveActive(list, NOW + 4 * MIN)?.id === 2);
  ok('after the inner one clears → falls back to the outer', resolveActive(list, NOW + 7 * MIN)?.id === 1);
}
{
  // identical showAt → higher id wins (scheduled later)
  const list = [m(5, NOW), m(9, NOW), m(2, NOW)];
  ok('tie on showAt → highest id wins', resolveActive(list, NOW + 1)?.id === 9);
}
{
  // open-ended chain: latest start always shows
  const list = [m(1, NOW), m(2, NOW + 5 * MIN)];
  ok('open-ended chain before 2nd → 1st shows', resolveActive(list, NOW + 1 * MIN)?.id === 1);
  ok('open-ended chain after 2nd → 2nd replaces', resolveActive(list, NOW + 6 * MIN)?.id === 2);
}

// ── pruneExpired ─────────────────────────────────────────────────────────────
{
  const list = [
    m(1, NOW - 10 * MIN, NOW - 1 * MIN), // already cleared
    m(2, NOW, NOW + 5 * MIN),            // clears in future
    m(3, NOW),                           // open-ended
  ];
  const kept = pruneExpired(list, NOW);
  ok('expired removed, future + open-ended kept', kept.length === 2 && kept.some((x) => x.id === 2) && kept.some((x) => x.id === 3));
  ok('does not mutate input', list.length === 3);
}
{
  const list = [m(1, NOW - MIN, NOW)]; // clearAt exactly now
  ok('clearAt == now → pruned', pruneExpired(list, NOW).length === 0);
}

// ── nextPruneDelay ───────────────────────────────────────────────────────────
{
  ok('no clears → null', nextPruneDelay([m(1, NOW)], NOW) === null);
}
{
  const list = [m(1, NOW, NOW + 9 * MIN), m(2, NOW, NOW + 2 * MIN), m(3, NOW)];
  ok('returns soonest future clear', nextPruneDelay(list, NOW) === 2 * MIN);
}
{
  const list = [m(1, NOW, NOW - MIN)]; // already past
  ok('past clears ignored → null', nextPruneDelay(list, NOW) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
