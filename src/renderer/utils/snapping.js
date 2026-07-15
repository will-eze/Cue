import React from 'react';

// ── Shared smart-snap ─────────────────────────────────────────────────────────
// The auto-align engine born in StageLayoutEditor, generalised so every canvas
// editor (stage layout, presentation slides, song text box, graphics boxes)
// aligns the same way: boxes in % of a 16:9 frame snap to the frame edges,
// centre lines, thirds, an optional safe-area rectangle and the edges/centres
// of sibling elements. Matches are surfaced as guide lines (render with
// <SnapGuides/>) so the operator sees WHY the box stuck. Holding Alt/Option
// during a drag bypasses snapping entirely (free positioning).

export const SNAP_THRESHOLD = 1.4; // snap radius (% of frame)
export const GRID_STEP = 0.5;      // fallback grid when nothing is near

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Build vertical/horizontal target lines for one drag. Call once on drag start.
//  - frame edges (0/100), centre (50) and thirds
//  - `contentBox` {x,y,w,h}: its edges + centre (the safe area, when the editor has one)
//  - `others` [{x,y,w,h}]: each sibling's edges + centre on both axes
export function buildSnapTargets({ others = [], contentBox = null, thirds = true } = {}) {
  const vT = [0, 50, 100];
  const hT = [0, 50, 100];
  if (thirds) { vT.push(33.333, 66.667); hT.push(33.333, 66.667); }
  if (contentBox) {
    vT.push(contentBox.x, contentBox.x + contentBox.w / 2, contentBox.x + contentBox.w);
    hT.push(contentBox.y, contentBox.y + contentBox.h / 2, contentBox.y + contentBox.h);
  }
  for (const o of others) {
    vT.push(o.x, o.x + o.w / 2, o.x + o.w);
    hT.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { vT, hT };
}

// Snap a single value to the nearest target line within the threshold; null if none.
export function snapVal(val, targets, threshold = SNAP_THRESHOLD) {
  let best = null, bestD = threshold;
  for (const t of targets) { const d = Math.abs(val - t); if (d < bestD) { bestD = d; best = t; } }
  return best;
}

// Snap any of a box's candidate lines (left/centre/right or top/middle/bottom) to
// the nearest target; returns { off, line } of the closest hit, or null.
export function snapAxis(cands, targets, threshold = SNAP_THRESHOLD) {
  let off = null, bestD = threshold, line = null;
  for (const v of cands) for (const t of targets) {
    const d = Math.abs(v - t);
    if (d < bestD) { bestD = d; off = t - v; line = t; }
  }
  return off == null ? null : { off, line };
}

// Snap a whole-box move. Given the freely-dragged position {x,y,w,h}, snap each
// axis independently (edges + centre as candidates) and fall back to the grid.
// Returns { x, y, guides } — guides is [{axis:'v'|'h', pos}] for the hit lines.
// Pass `free: true` (Alt held) to skip snapping AND the grid.
export function snapMove({ x, y, w, h }, { vT, hT }, { free = false, grid = GRID_STEP } = {}) {
  const guides = [];
  if (!free) {
    const sv = snapAxis([x, x + w / 2, x + w], vT);
    if (sv) { x += sv.off; guides.push({ axis: 'v', pos: sv.line }); }
    else if (grid) x = Math.round(x / grid) * grid;
    const sh = snapAxis([y, y + h / 2, y + h], hT);
    if (sh) { y += sh.off; guides.push({ axis: 'h', pos: sh.line }); }
    else if (grid) y = Math.round(y / grid) * grid;
  }
  return { x, y, guides };
}

// Snap one moving edge during a resize. `val` is the edge's current position on
// its axis; returns { val, guide } (guide null when nothing snapped or free).
export function snapEdge(val, targets, axis, { free = false } = {}) {
  if (free) return { val, guide: null };
  const s = snapVal(val, targets);
  return s == null ? { val, guide: null } : { val: s, guide: { axis, pos: s } };
}

// Snap the moving edge(s) of a PowerPoint-style handle resize (hx/hy: 0 = left/top
// edge moving, 1 = right/bottom edge moving, 0.5 = axis not resizing). Takes the
// already-resized box and pulls the moving edges onto nearby target lines.
// Returns { box, guides }.
export function snapResizeBox(box, hx, hy, { vT, hT }, { free = false, min = 5 } = {}) {
  const b = { ...box };
  const guides = [];
  if (!free) {
    if (hx === 0) {
      const right = b.x + b.w;
      const s = snapVal(b.x, vT);
      if (s != null) { b.x = Math.min(s, right - min); b.w = right - b.x; guides.push({ axis: 'v', pos: s }); }
    } else if (hx === 1) {
      const s = snapVal(b.x + b.w, vT);
      if (s != null) { b.w = Math.max(min, s - b.x); guides.push({ axis: 'v', pos: s }); }
    }
    if (hy === 0) {
      const bottom = b.y + b.h;
      const s = snapVal(b.y, hT);
      if (s != null) { b.y = Math.min(s, bottom - min); b.h = bottom - b.y; guides.push({ axis: 'h', pos: s }); }
    } else if (hy === 1) {
      const s = snapVal(b.y + b.h, hT);
      if (s != null) { b.h = Math.max(min, s - b.y); guides.push({ axis: 'h', pos: s }); }
    }
  }
  return { box: b, guides };
}

// Arrow-key nudge for a selected box: plain = fine step, Shift = coarse step.
// Returns a {x,y} patch or null when the key isn't an arrow.
export function nudgeFromKey(e, box, { fine = 0.5, coarse = 2 } = {}) {
  const step = e.shiftKey ? coarse : fine;
  let dx = 0, dy = 0;
  if (e.key === 'ArrowLeft') dx = -step;
  else if (e.key === 'ArrowRight') dx = step;
  else if (e.key === 'ArrowUp') dy = -step;
  else if (e.key === 'ArrowDown') dy = step;
  else return null;
  const r = (n) => Math.round(n * 10) / 10;
  return {
    x: r(clamp(box.x + dx, 0, 100 - box.w)),
    y: r(clamp(box.y + dy, 0, 100 - box.h)),
  };
}

// Guide lines overlay — render inside the (relative, %-addressed) canvas element.
// Lines use the primary (preview-blue) token, matching the stage editor.
export function SnapGuides({ guides, zIndex = 150 }) {
  if (!guides || !guides.length) return null;
  return guides.map((g, i) => g.axis === 'v'
    ? React.createElement('div', {
        key: `v${i}`,
        className: 'absolute top-0 bottom-0 bg-primary pointer-events-none',
        style: { left: `calc(${g.pos}% - 0.5px)`, width: 1, zIndex },
      })
    : React.createElement('div', {
        key: `h${i}`,
        className: 'absolute left-0 right-0 bg-primary pointer-events-none',
        style: { top: `calc(${g.pos}% - 0.5px)`, height: 1, zIndex },
      }));
}
