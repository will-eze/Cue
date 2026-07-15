// Detect whether applying an output preset would DISRUPT currently-live output — i.e.
// close or reassign a window that's on air. Recall is SAFE by default; OutputPresetsPanel
// only prompts for confirmation when this returns disruptive:true. "Safe" changes
// (enabling a channel, NDI param tweaks, stream/stage/background config) never trip it.
//
// Disruptive iff outputs are currently live AND the preset would:
//   (a) disable a channel that is currently active,
//   (b) reassign/remove a screen channel's displays (monitor display_bounds change), or
//   (c) change a channel's template or type (forces a window rebuild).

export function diffOutputPreset({ data, includes, currentChannels, currentMonitors, liveState }) {
  const reasons = [];
  const live = !!(liveState && liveState.outputsEnabled && (liveState.activeWindows || 0) > 0);
  if (!live) return { disruptive: false, reasons };

  const chById = new Map((currentChannels || []).map((c) => [c.id, c]));

  // (a) channel active → inactive
  if (includes?.channels && Array.isArray(data?.channels)) {
    for (const p of data.channels) {
      const cur = chById.get(p.id);
      if (cur && cur.active && !p.active) reasons.push(`“${cur.name}” will be turned off`);
    }
  }

  if (includes?.displaysNdi && data?.displaysNdi) {
    // (c) template/type change on an active channel
    for (const p of (data.displaysNdi.channels || [])) {
      const cur = chById.get(p.id);
      if (!cur || !cur.active) continue;
      if (p.template !== cur.template || p.type !== cur.type) {
        reasons.push(`“${cur.name}” output type/template will change`);
      }
    }
    // (b) display reassignment on an active screen channel
    const curByCh = groupBounds(currentMonitors);
    const presetByCh = groupBounds(data.displaysNdi.monitors);
    const capturedIds = new Set((data.displaysNdi.channels || []).map((c) => c.id));
    for (const chId of capturedIds) {
      const cur = chById.get(chId);
      if (!cur || !cur.active) continue;
      const curSet = curByCh.get(chId) || new Set();
      const presetSet = presetByCh.get(chId) || new Set();
      if (!setsEqual(curSet, presetSet)) reasons.push(`“${cur.name}” display assignment will change`);
    }
  }

  return { disruptive: reasons.length > 0, reasons };
}

function groupBounds(monitors) {
  const map = new Map();
  for (const m of (monitors || [])) {
    if (m.active === 0) continue;
    if (!map.has(m.channel_id)) map.set(m.channel_id, new Set());
    map.get(m.channel_id).add(String(m.display_bounds));
  }
  return map;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
