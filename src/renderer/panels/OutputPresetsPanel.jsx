import React, { useState, useEffect, useCallback } from 'react';
import { diffOutputPreset } from '../utils/outputPresetDiff';

// Output Presets — save & recall the OUTPUT RIG (which channels are on, their display /
// NDI assignment, Stream Studio, background/stage config). A SEPARATE feature from Scenes
// (which recall the live LOOK — graphics/program/audio). Authoring flow is CAPTURE: set
// the outputs up the way you want, snapshot them, tick which layers the preset manages.
// Recall replays the snapshot through the same window.cue.* IPC the settings UI uses.

const LAYERS = [
  { id: 'channels',     label: 'Channels on/off',   icon: 'power_settings_new',  def: true,  hint: 'Which output channels are enabled' },
  { id: 'displaysNdi',  label: 'Displays & NDI',    icon: 'desktop_windows',     def: true,  hint: 'Screen assignments, NDI size/fps/audio, output type' },
  { id: 'stream',       label: 'Stream Studio',     icon: 'sensors',             def: false, hint: 'Stream Studio layout + RTMP config' },
  { id: 'stageLayouts', label: 'Stage Layouts',     icon: 'dashboard_customize', def: true,  hint: 'Per-channel stage / confidence screen layout (the applied stage preset)' },
  { id: 'backgrounds',  label: 'Backgrounds & Logo',icon: 'wallpaper',           def: false, hint: 'Global background / logo defaults' },
];
const LAYER_LABEL = Object.fromEntries(LAYERS.map((l) => [l.id, l.label]));

const defaultIncludes = () => Object.fromEntries(LAYERS.map((l) => [l.id, l.def]));
const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const countOn = (data) => (data?.channels || []).filter((c) => c.active).length;

// ── Recall: replay a captured snapshot onto the live outputs ────────────────────────
async function applyOutputPreset(data, inc, onBgChanged, currentChannels) {
  // 1+2. Channel fields — combine `active` + Displays/NDI fields into ONE update per
  // channel so a single syncChannel rebuilds the window once (not twice).
  const updates = new Map(); // id -> partial channel row
  const merge = (id, f) => updates.set(id, { ...(updates.get(id) || {}), ...f });
  if (inc.channels) for (const c of (data.channels || [])) merge(c.id, { active: c.active ? 1 : 0 });
  if (inc.displaysNdi) for (const c of (data.displaysNdi?.channels || [])) {
    merge(c.id, {
      template: c.template, type: c.type,
      ndi_width: c.ndi_width, ndi_height: c.ndi_height, ndi_fps: c.ndi_fps, ndi_audio_muted: c.ndi_audio_muted,
    });
  }
  // Only update a channel whose fields ACTUALLY change — an unchanged channels.update
  // still triggers syncChannel, which tears down and recreates the (fullscreen) output
  // window for nothing. Skipping no-ops avoids the needless window churn (and the macOS
  // fullscreen-race flicker) when recalling a preset whose rig is already live.
  const curById = new Map((currentChannels || []).map((c) => [c.id, c]));
  for (const [id, fields] of updates) {
    const cur = curById.get(id);
    if (cur && Object.entries(fields).every(([k, v]) => cur[k] === v)) continue;
    // Tolerate a stale snapshot (e.g. a channel deleted since capture) — a single failed
    // call shouldn't abort the rest of the recall.
    try { await window.cue.output.channels.update(id, fields); } catch {}
  }

  // Monitor (display) reconciliation — only for channels this preset captured.
  if (inc.displaysNdi && data.displaysNdi) {
    const capturedIds = new Set((data.displaysNdi.channels || []).map((c) => c.id));
    await reconcileMonitors(data.displaysNdi.monitors || [], capturedIds);
  }

  // 3. Stream Studio + RTMP config.
  if (inc.stream && data.stream) {
    if (data.stream.studio) await window.cue.output.stream.setStudio(data.stream.studio);
    if (data.stream.config) await window.cue.output.stream.setConfig(data.stream.config);
  }

  // 4. Global background/logo defaults + per-channel stage layout — SEPARATE layers so a
  // preset can recall stage layouts (the applied stage preset) WITHOUT also overriding the
  // global background/logo defaults. Data is still captured together under `backgroundsStage`.
  // (`?? *.backgroundsStage` tolerates a pre-split snapshot that used one combined toggle.)
  const bs = data.backgroundsStage;
  const incBackgrounds = inc.backgrounds ?? inc.backgroundsStage;
  const incStage = inc.stageLayouts ?? inc.backgroundsStage;
  if (bs && (incBackgrounds || incStage)) {
    if (incBackgrounds) {
      const s = bs.settings || {};
      await window.cue.settings.setGlobalBackground('song', s.global_bg_song_id ?? null);
      await window.cue.settings.setGlobalBackground('scripture', s.global_bg_scripture_id ?? null);
      await window.cue.settings.setGlobalBackground('slide', s.global_bg_slide_id ?? null);
      await window.cue.settings.setGlobalLogo(s.global_logo_id ?? null);
      onBgChanged?.();
    }
    if (incStage) {
      for (const st of (bs.stage || [])) {
        if (st.layout) await window.cue.output.stage.setLayout(st.channel_id, st.layout);
      }
    }
  }
}

async function reconcileMonitors(presetMonitors, capturedIds) {
  const current = await window.cue.output.monitors.list(); // all rows (carry ids)
  const curByCh = new Map();
  for (const m of current) { (curByCh.get(m.channel_id) || curByCh.set(m.channel_id, []).get(m.channel_id)).push(m); }
  const desByCh = new Map();
  for (const m of presetMonitors) {
    if (!capturedIds.has(m.channel_id) || m.active === 0) continue;
    (desByCh.get(m.channel_id) || desByCh.set(m.channel_id, []).get(m.channel_id)).push(m);
  }
  for (const chId of capturedIds) {
    const cur = curByCh.get(chId) || [];
    const des = desByCh.get(chId) || [];
    const desSet = new Set(des.map((m) => String(m.display_bounds)));
    const curSet = new Set(cur.map((m) => String(m.display_bounds)));
    for (const m of cur) if (!desSet.has(String(m.display_bounds))) {
      try { await window.cue.output.monitors.delete(m.id); } catch {}
    }
    for (const m of des) if (!curSet.has(String(m.display_bounds))) {
      try { await window.cue.output.monitors.create(chId, { display_bounds: m.display_bounds, label: m.label }); } catch {}
    }
  }
}

export default function OutputPresetsPanel({ onBackgroundDefaultChanged }) {
  const [presets, setPresets] = useState([]);
  const [editor, setEditor] = useState(null);   // {} = new, row = edit, null = closed
  const [confirm, setConfirm] = useState(null);  // { preset, data, inc, reasons }
  const [appliedId, setAppliedId] = useState(null);

  const load = useCallback(() => { window.cue.outputPresets.list().then(setPresets); }, []);
  useEffect(() => { load(); }, [load]);

  async function doApply(preset, data, inc, currentChannels) {
    await applyOutputPreset(data, inc, onBackgroundDefaultChanged, currentChannels);
    setAppliedId(preset.id);
    setTimeout(() => setAppliedId((id) => (id === preset.id ? null : id)), 1400);
  }

  // Recall — safe by default; only prompt when the change would disrupt a live output.
  async function take(preset) {
    const data = safeParse(preset.data_json) || {};
    const inc = safeParse(preset.includes_json) || {};
    const [currentChannels, currentMonitors, liveState] = await Promise.all([
      window.cue.output.channels.list(),
      window.cue.output.monitors.list(),
      window.cue.output.getState(),
    ]);
    const { disruptive, reasons } = diffOutputPreset({ data, includes: inc, currentChannels, currentMonitors, liveState });
    if (disruptive) { setConfirm({ preset, data, inc, reasons, currentChannels }); return; }
    doApply(preset, data, inc, currentChannels);
  }

  async function remove(preset) { await window.cue.outputPresets.delete(preset.id); load(); }
  function onSaved() { setEditor(null); load(); }

  return (
    <div className="flex flex-col h-full bg-surface-container-low min-h-0">
      <div className="flex items-center gap-sm px-md h-11 border-b border-outline-variant/30 shrink-0">
        <span className="material-symbols-outlined text-[18px] text-primary shrink-0">tune</span>
        <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant shrink-0">Output Presets</span>
        <span className="text-[10px] font-mono text-on-surface-variant/50 normal-case tracking-normal ml-xs min-w-0 truncate">save &amp; recall your output rig</span>
        <button onClick={() => setEditor({})}
          className="ml-auto shrink-0 flex items-center gap-xs px-md py-xs rounded text-label-sm font-label-sm bg-primary text-on-primary font-bold hover:brightness-110 cursor-pointer">
          <span className="material-symbols-outlined text-[14px]">add</span> New Preset
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-md min-h-0">
        {presets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-xl gap-sm text-outline-variant">
            <span className="material-symbols-outlined text-4xl">tune</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">No output presets yet</span>
            <span className="text-body-md text-on-surface-variant/60 max-w-[440px] text-center">
              Set your output channels the way you want (which are on, their screens, NDI, stream),
              then capture them into a preset to re-rig your outputs in one tap.
            </span>
            <button onClick={() => setEditor({})} className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-primary hover:underline cursor-pointer">Create one</button>
          </div>
        ) : (
          <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {presets.map((p) => (
              <PresetCard key={p.id} preset={p} applied={appliedId === p.id}
                onTake={() => take(p)} onEdit={() => setEditor(p)} onDelete={() => remove(p)} />
            ))}
          </div>
        )}
      </div>

      {editor && <PresetEditor preset={editor.id ? editor : null} onClose={() => setEditor(null)} onSaved={onSaved} />}
      {confirm && (
        <ConfirmDisruptive
          reasons={confirm.reasons}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const c = confirm; setConfirm(null); doApply(c.preset, c.data, c.inc, c.currentChannels); }}
        />
      )}
    </div>
  );
}

function PresetCard({ preset, applied, onTake, onEdit, onDelete }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const inc = safeParse(preset.includes_json) || {};
  const data = safeParse(preset.data_json) || {};
  const layers = LAYERS.filter((l) => inc[l.id]);
  const on = countOn(data);
  const total = (data.channels || []).length;

  return (
    <div className="group flex flex-col rounded-lg border border-outline-variant/30 bg-surface-container hover:border-outline-variant/60 transition-colors overflow-hidden">
      <div className="flex items-center gap-sm px-md pt-md">
        <div className="flex-1 min-w-0">
          <div className="text-body-lg text-on-surface font-medium truncate">{preset.name}</div>
        </div>
        <div className="flex items-center gap-xs opacity-0 group-hover:opacity-100 transition-opacity">
          {confirmingDelete ? (
            <>
              <span className="text-[10px] font-mono text-error uppercase tracking-[0.04em] shrink-0">Delete?</span>
              <button onClick={() => { setConfirmingDelete(false); onDelete(); }}
                className="text-[10px] font-mono text-error hover:text-error/70 cursor-pointer uppercase tracking-[0.04em] border border-error/40 px-sm py-[2px] rounded transition-colors">Yes</button>
              <button onClick={() => setConfirmingDelete(false)}
                className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.04em] transition-colors">No</button>
            </>
          ) : (
            <>
              <button onClick={onEdit} title="Edit" className="w-6 h-6 flex items-center justify-center rounded text-on-surface-variant hover:text-primary cursor-pointer">
                <span className="material-symbols-outlined text-[15px]">edit</span>
              </button>
              <button onClick={() => setConfirmingDelete(true)} title="Delete" className="w-6 h-6 flex items-center justify-center rounded text-on-surface-variant hover:text-error cursor-pointer">
                <span className="material-symbols-outlined text-[15px]">delete</span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="px-md py-sm flex flex-wrap gap-xs min-h-[2.2rem]">
        {inc.channels && total > 0 && (
          <span className="flex items-center gap-xs px-sm py-[2px] rounded bg-tertiary/10 border border-tertiary/30 text-tertiary text-[10px] font-label-sm uppercase tracking-[0.04em]">
            <span className="material-symbols-outlined text-[12px]">power_settings_new</span>{on}/{total} on
          </span>
        )}
        {layers.filter((l) => l.id !== 'channels').map((l) => (
          <span key={l.id} className="flex items-center gap-xs px-sm py-[2px] rounded bg-surface-container-high text-on-surface-variant text-[10px] font-label-sm uppercase tracking-[0.04em]">
            <span className="material-symbols-outlined text-[12px]">{l.icon}</span>{l.label}
          </span>
        ))}
        {layers.length === 0 && (
          <span className="px-sm py-[2px] rounded text-on-surface-variant/40 text-[10px] font-label-sm uppercase tracking-[0.04em]">Empty preset</span>
        )}
      </div>

      <div className="px-md pb-md">
        <button onClick={onTake}
          className={`w-full px-md py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold cursor-pointer transition-colors ${
            applied ? 'bg-tertiary text-on-tertiary' : 'bg-tertiary-container text-on-tertiary hover:brightness-110'
          }`}>
          {applied ? 'Recalled ✓' : 'Recall'}
        </button>
      </div>
    </div>
  );
}

function PresetEditor({ preset, onClose, onSaved }) {
  const [name, setName] = useState(preset?.name || '');
  const [includes, setIncludes] = useState(() => ({ ...defaultIncludes(), ...(preset ? safeParse(preset.includes_json) : {}) }));
  const [data, setData] = useState(() => (preset ? safeParse(preset.data_json) : null));
  const [captured, setCaptured] = useState(!!preset);
  const [busy, setBusy] = useState(false);

  const allOn = LAYERS.every((l) => includes[l.id]);
  const toggleAll = () => setIncludes(Object.fromEntries(LAYERS.map((l) => [l.id, !allOn])));

  // Snapshot the LIVE output rig into the preset — the core authoring action.
  async function captureNow() {
    setBusy(true);
    try {
      const [channels, monitors, studio, config, gS, gSc, gSl, gLogo] = await Promise.all([
        window.cue.output.channels.list(),
        window.cue.output.monitors.list(),
        window.cue.output.stream.getStudio(),
        window.cue.output.stream.getConfig(),
        window.cue.settings.get('global_bg_song_id'),
        window.cue.settings.get('global_bg_scripture_id'),
        window.cue.settings.get('global_bg_slide_id'),
        window.cue.settings.get('global_logo_id'),
      ]);
      const stage = [];
      for (const ch of channels) {
        if (ch.template === 'stage') stage.push({ channel_id: ch.id, layout: await window.cue.output.stage.getLayout(ch.id) });
      }
      setData({
        channels: channels.map((c) => ({ id: c.id, name: c.name, active: c.active })),
        displaysNdi: {
          channels: channels.map((c) => ({
            id: c.id, name: c.name, template: c.template, type: c.type,
            ndi_width: c.ndi_width, ndi_height: c.ndi_height, ndi_fps: c.ndi_fps, ndi_audio_muted: c.ndi_audio_muted,
          })),
          monitors: monitors.map((m) => ({ channel_id: m.channel_id, display_bounds: m.display_bounds, label: m.label, active: m.active })),
        },
        stream: { studio, config },
        backgroundsStage: {
          settings: { global_bg_song_id: gS, global_bg_scripture_id: gSc, global_bg_slide_id: gSl, global_logo_id: gLogo },
          stage,
        },
      });
      setCaptured(true);
    } finally { setBusy(false); }
  }

  // Auto-capture on open for a NEW preset so there's a snapshot immediately — otherwise
  // Save stays disabled (no data) until you press Capture, which made it look dead.
  useEffect(() => { if (!preset) captureNow(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const payload = { name: name.trim() || 'Output Preset', includes, data: data || {} };
    if (preset?.id) await window.cue.outputPresets.update(preset.id, payload);
    else await window.cue.outputPresets.create(payload);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-lg" onMouseDown={onClose}>
      <div className="w-full max-w-[520px] bg-surface-container-high rounded-xl border border-outline-variant/40 flex flex-col max-h-full overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-sm px-lg h-12 border-b border-outline-variant/30 shrink-0">
          <span className="material-symbols-outlined text-[18px] text-primary">tune</span>
          <span className="text-label-md font-label-sm uppercase tracking-[0.05em] text-on-surface">{preset ? 'Edit Output Preset' : 'New Output Preset'}</span>
          <button onClick={onClose} className="ml-auto text-on-surface-variant/60 hover:text-on-surface cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-lg flex flex-col gap-lg min-h-0">
          {/* Capture */}
          <div className="flex flex-col gap-xs">
            <button onClick={captureNow} disabled={busy}
              className="flex items-center justify-center gap-sm px-md py-sm rounded-lg border border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 cursor-pointer disabled:opacity-50">
              <span className="material-symbols-outlined text-[18px]">photo_camera</span>
              <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold">{captured ? 'Re-capture current output' : 'Capture current output'}</span>
            </button>
            <div className="text-[11px] font-mono text-on-surface-variant/50">
              {captured ? <span className="text-tertiary">Snapshotted the current output rig.</span> : 'Snapshot which channels are on, their displays/NDI, stream and background settings.'}
            </div>
          </div>

          {/* Name */}
          <label className="flex flex-col gap-xs">
            <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Live Broadcast"
              className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary" />
          </label>

          {/* Layer include checklist */}
          <div className="flex flex-col gap-sm">
            <div className="flex items-center">
              <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Include layers</span>
              <button onClick={toggleAll} className="ml-auto text-[10px] font-mono uppercase tracking-[0.04em] text-primary hover:underline cursor-pointer">
                {allOn ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="rounded-lg border border-outline-variant/30 bg-surface-container divide-y divide-outline-variant/20">
              {LAYERS.map((l) => (
                <label key={l.id} className="flex items-start gap-sm px-md py-sm cursor-pointer">
                  <input type="checkbox" checked={!!includes[l.id]} onChange={(e) => setIncludes((s) => ({ ...s, [l.id]: e.target.checked }))}
                    className="accent-primary w-4 h-4 cursor-pointer mt-[2px]" />
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant mt-[1px]">{l.icon}</span>
                  <span className="flex flex-col">
                    <span className="text-body-md text-on-surface">{l.label}</span>
                    <span className="text-[11px] font-mono text-on-surface-variant/50">{l.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Channel preview */}
          {includes.channels && data?.channels?.length > 0 && (
            <div className="flex flex-col gap-xs">
              <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Channels in this preset</span>
              <div className="rounded-lg border border-outline-variant/30 bg-surface-container p-md flex flex-wrap gap-xs">
                {data.channels.map((c) => (
                  <span key={c.id} className={`flex items-center gap-xs px-sm py-[2px] rounded text-[10px] font-label-sm uppercase tracking-[0.04em] ${
                    c.active ? 'bg-tertiary/10 border border-tertiary/30 text-tertiary' : 'bg-surface-container-high text-on-surface-variant/60'
                  }`}>
                    <span className="material-symbols-outlined text-[12px]">{c.active ? 'check_circle' : 'radio_button_unchecked'}</span>
                    <span className="truncate max-w-[120px] normal-case tracking-normal">{c.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-sm px-lg h-14 border-t border-outline-variant/30 shrink-0">
          <button onClick={onClose} className="ml-auto px-md py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant hover:text-on-surface cursor-pointer">Cancel</button>
          <button onClick={save} disabled={!name.trim() || !captured}
            className="px-lg py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold bg-primary text-on-primary hover:brightness-110 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Save</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDisruptive({ reasons, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 p-lg" onMouseDown={onCancel}>
      <div className="w-full max-w-[420px] bg-surface-container-high rounded-xl border border-secondary/40 flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-sm px-lg h-12 border-b border-outline-variant/30 shrink-0">
          <span className="material-symbols-outlined text-[18px] text-secondary">warning</span>
          <span className="text-label-md font-label-sm uppercase tracking-[0.05em] text-on-surface">Reconfigure live output?</span>
        </div>
        <div className="p-lg flex flex-col gap-sm">
          <span className="text-body-md text-on-surface-variant">This preset changes outputs that are currently on air:</span>
          <ul className="flex flex-col gap-xs">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-center gap-sm text-body-md text-on-surface">
                <span className="material-symbols-outlined text-[14px] text-secondary">arrow_right</span>{r}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-sm px-lg h-14 border-t border-outline-variant/30 shrink-0">
          <button onClick={onCancel} className="ml-auto px-md py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant hover:text-on-surface cursor-pointer">Cancel</button>
          <button onClick={onConfirm}
            className="px-lg py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold bg-secondary text-on-secondary hover:brightness-110 cursor-pointer">Reconfigure</button>
        </div>
      </div>
    </div>
  );
}
