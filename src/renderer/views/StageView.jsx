import React, { useState, useEffect, useCallback, useRef } from 'react';
import StageLayoutEditor from '../components/StageLayoutEditor.jsx';

// ── Stage Display view ────────────────────────────────────────────────────────
// A first-class top-bar view (like Stream) for designing the WYSIWYG stage/confidence
// monitor. Each output channel of template 'stage' has its OWN layout (a presenter
// monitor and a musician monitor can differ); edits apply live (debounced) to that
// channel's open window(s) and the operator's confidence preview. Reusable named layouts
// are saved as presets (global) and can be applied to any channel.

// Compare two layouts by element composition (highlight the active preset).
const layoutEq = (a, b) => {
  if (!a || !b) return false;
  const sig = (l) => JSON.stringify((l.elements || []).map((e) => ({ ...e, id: undefined })));
  return sig(a) === sig(b);
};

export default function StageView() {
  const [channels, setChannels] = useState(null);   // null = loading
  const [channelId, setChannelId] = useState(null);
  const [layout, setLayout] = useState(null);
  const [presets, setPresets] = useState([]);
  const [presetName, setPresetName] = useState('');
  const [saving, setSaving] = useState(false);
  const applyTimer = useRef(null);
  const dirty = useRef(false);

  // Load stage channels + presets on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      const all = await window.cue.output.channels.list();
      if (!alive) return;
      const stage = (all || []).filter((c) => c.template === 'stage');
      setChannels(stage);
      setChannelId((prev) => prev ?? (stage[0] ? stage[0].id : null));
      setPresets(await window.cue.output.stage.getPresets());
    })();
    return () => { alive = false; };
  }, []);

  // Load the selected channel's layout whenever it changes.
  useEffect(() => {
    if (channelId == null) { setLayout(null); return; }
    let alive = true;
    dirty.current = false;
    window.cue.output.stage.getLayout(channelId).then((l) => { if (alive) setLayout(l); });
    return () => { alive = false; };
  }, [channelId]);

  // Push edits live to the channel, DEBOUNCED — a drag updates ~60×/s and each apply
  // persists to SQLite + repaints the stage window; a trailing timer keeps the live
  // monitor in sync without hammering. The canvas itself is WYSIWYG, so it stays snappy.
  const onChange = useCallback((next) => {
    setLayout(next);
    dirty.current = true;
    clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(() => {
      if (channelId != null) window.cue.output.stage.setLayout(channelId, next);
    }, 120);
  }, [channelId]);

  useEffect(() => () => clearTimeout(applyTimer.current), []);

  const refreshPresets = useCallback(async () => setPresets(await window.cue.output.stage.getPresets()), []);

  async function savePreset() {
    const name = presetName.trim();
    if (!name || !layout) return;
    setSaving(true);
    await window.cue.output.stage.savePreset({ name, layout });
    setSaving(false);
    setPresetName('');
    refreshPresets();
  }
  async function deletePreset(id) {
    setPresets(await window.cue.output.stage.deletePreset(id));
  }
  function applyPreset(p) {
    onChange({ elements: p.layout.elements.map((e) => ({ ...e })) });
  }

  // ── Empty state — no stage channels yet ─────────────────────────────────────
  if (channels && channels.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-sm text-center px-lg">
        <span className="material-symbols-outlined text-[40px] text-on-surface-variant/40">desktop_windows</span>
        <p className="text-headline-sm font-headline-sm text-on-surface">No stage displays yet</p>
        <p className="text-body-md text-on-surface-variant max-w-md">
          Add an output channel with the <span className="text-on-surface font-semibold">Stage Display</span> template in
          Settings → Output, then design its layout here.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-lg gap-md overflow-hidden">
      {/* Header — title + channel selector */}
      <div className="flex items-center gap-md shrink-0">
        <div className="flex items-center gap-sm">
          <span className="material-symbols-outlined text-[20px] text-primary">dashboard_customize</span>
          <h1 className="text-headline-sm font-headline-sm font-bold text-on-surface">Stage Display</h1>
        </div>
        {channels && channels.length > 0 && (
          <label className="flex items-center gap-sm ml-auto">
            <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline">Channel</span>
            <select value={channelId ?? ''} onChange={(e) => setChannelId(Number(e.target.value))}
              className="bg-surface-container-high border border-outline-variant/40 rounded-lg px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary cursor-pointer">
              {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {/* Editor */}
      {layout ? (
        <StageLayoutEditor value={layout} onChange={onChange} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-on-surface-variant/40 text-label-sm uppercase tracking-widest">Loading layout…</div>
      )}

      {/* Preset rail */}
      <div className="shrink-0 bg-surface-container border border-outline-variant/30 rounded-xl p-md space-y-sm">
        <div className="flex items-center gap-sm">
          <p className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline">Saved Layouts</p>
          <div className="ml-auto flex items-center gap-xs">
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="New preset name…"
              onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
              className="w-48 bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-sm text-on-surface outline-none focus:border-primary" />
            <button onClick={savePreset} disabled={!presetName.trim() || saving}
              className="flex items-center gap-xs h-8 px-md rounded-lg text-label-sm font-label-sm font-bold uppercase tracking-[0.03em] bg-primary text-on-primary hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40">
              <span className="material-symbols-outlined text-[15px]">bookmark_add</span>{saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {presets.length > 0 ? (
          <div className="flex flex-wrap gap-xs">
            {presets.map((p) => {
              const active = layout && layoutEq(p.layout, layout);
              return (
                <div key={p.id} className={`group flex items-center rounded-lg border overflow-hidden ${active ? 'border-primary/60 bg-primary/15' : 'border-outline-variant/30 bg-surface-container-high'}`}>
                  <button onClick={() => applyPreset(p)}
                    className={`pl-sm pr-xs h-8 text-label-sm font-label-sm font-bold uppercase tracking-[0.03em] cursor-pointer ${active ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>{p.name}</button>
                  <button onClick={() => deletePreset(p.id)} title="Delete preset"
                    className="px-xs h-8 text-on-surface-variant/50 hover:text-error cursor-pointer"><span className="material-symbols-outlined text-[14px]">close</span></button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-body-sm text-on-surface-variant/60">Design a layout above, name it, and Save to reuse it on any stage channel.</p>
        )}
      </div>
    </div>
  );
}
