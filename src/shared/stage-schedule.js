// Pure scheduling logic for stage confidence-monitor messages.
//
// No electron / DOM / Node deps so it is unit-testable in plain `node` and shared
// by BOTH the main process (anchor resolution + pruning) and the operator renderer
// (live preview + collision flags) — guaranteeing the operator's preview resolves
// to exactly the same instants main will use. The plain-DOM output template
// (`src/output/stage.js`) cannot import (it loads as a classic <script>), so it
// mirrors `resolveActive()` inline — keep the two in sync.
//
// A scheduled message is `{ id, text, showAt, clearAt }` where showAt/clearAt are
// absolute epoch-ms anchors and `clearAt === null` means open-ended (no auto-clear;
// it shows until a later message replaces it or the operator clears the bar).

// Resolve a schedule request to absolute epoch-ms anchors.
//   spec: { afterSeconds?, atHour?, atMinute?, clearAfter? }
//     afterSeconds — show this many seconds from `now` (countdown mode)
//     atHour/atMinute — next occurrence of that wall-clock time (0-23 / 0-59)
//     clearAfter — seconds after showAt to auto-clear (falsy/0 = never)
//   now: epoch ms (injectable for testing/determinism)
// Returns { showAt, clearAt }.
export function resolveAnchors(spec, now) {
  const { afterSeconds, atHour, atMinute, clearAfter } = spec || {};
  let showAt;
  if (afterSeconds != null && afterSeconds >= 0) {
    showAt = now + afterSeconds * 1000;
  } else if (atHour != null && atMinute != null) {
    const d = new Date(now);
    d.setHours(atHour, atMinute, 0, 0);
    showAt = d.getTime();
    if (showAt <= now) showAt += 24 * 3600 * 1000; // already past today → next day
  } else {
    showAt = now; // no timing info → immediate
  }
  const clearAt = (clearAfter != null && clearAfter > 0) ? showAt + clearAfter * 1000 : null;
  return { showAt, clearAt };
}

// The effective end of a message's display window for collision purposes.
const winEnd = (m) => (m.clearAt == null ? Infinity : m.clearAt);

// True when two scheduled messages genuinely conflict for the single stage bar:
//   • they start at the exact same instant (one fully hides the other), OR
//   • a later message starts INSIDE an earlier one's explicit clear window,
//     cutting the earlier one short.
// An open-ended message simply replaced by a later one is normal sequencing, NOT a
// collision — so it must not be flagged. Symmetric in a/b.
export function collides(a, b) {
  if (a.showAt === b.showAt) return true;
  const earlier = a.showAt < b.showAt ? a : b;
  const later   = a.showAt < b.showAt ? b : a;
  return earlier.clearAt != null && later.showAt < winEnd(earlier);
}

// The set of ids that collide with at least one other scheduled message.
export function overlapIds(scheduled) {
  const ids = new Set();
  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      if (collides(scheduled[i], scheduled[j])) {
        ids.add(scheduled[i].id);
        ids.add(scheduled[j].id);
      }
    }
  }
  return ids;
}

// Which scheduled message occupies the bar at `now`: it must be active
// (showAt <= now < clearAt); among active messages the latest-starting wins, ties
// broken by id (scheduled-later). Returns the message object, or null if none.
export function resolveActive(scheduled, now) {
  let best = null;
  for (const m of scheduled) {
    if (now < m.showAt) continue;
    if (m.clearAt != null && now >= m.clearAt) continue;
    if (!best || m.showAt > best.showAt || (m.showAt === best.showAt && m.id > best.id)) best = m;
  }
  return best;
}

// Drop messages whose clearAt has passed (<= now). Open-ended and future-clearing
// messages are kept. Returns a new array (does not mutate).
export function pruneExpired(scheduled, now) {
  return scheduled.filter((m) => m.clearAt == null || m.clearAt > now);
}

// ms until the next clearAt boundary strictly in the future, or null if there is
// no future auto-clear to wait on.
export function nextPruneDelay(scheduled, now) {
  const next = scheduled
    .map((m) => m.clearAt)
    .filter((t) => t != null && t > now)
    .sort((a, b) => a - b)[0];
  return next == null ? null : Math.max(0, next - now);
}
