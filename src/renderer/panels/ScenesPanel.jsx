import React, { useState, useEffect, useCallback } from 'react';

// Scenes — one-press multi-output state recall (feature-roadmap #11). A scene is a
// declarative snapshot of the service-independent output layers (broadcast-graphics
// overlay + program action + program audio). The intended authoring flow is CAPTURE,
// not hand-building: set the live output up the way you want, then snapshot it.

const PROGRAM_OPTS = [
  { id: 'none',    label: 'Leave',   icon: 'remove',        hint: 'Program layer untouched' },
  { id: 'content', label: 'Content', icon: 'subtitles',     hint: 'Show the live slide (logo off)' },
  { id: 'clear',   label: 'Clear',   icon: 'block',         hint: 'Blank the text, keep background' },
  { id: 'logo',    label: 'Logo',    icon: 'image',         hint: 'Show the logo bug' },
];
const AUDIO_OPTS = [
  { id: 'leave',  label: 'Leave',  icon: 'remove' },
  { id: 'mute',   label: 'Mute',   icon: 'volume_off' },
  { id: 'unmute', label: 'Unmute', icon: 'volume_up' },
];
const KIND_LABEL = { nameTitle: 'Name / Title', ticker: 'Ticker', custom: 'Custom HTML', countdown: 'Countdown' };
const TARGET_LABEL = { screen: 'In-Room', ndi: 'Online' };

const audioToWire = (a) => (a === 'mute' ? 1 : a === 'unmute' ? 0 : null);
const audioFromRow = (m) => (m == null ? 'leave' : m ? 'mute' : 'unmute');

// Flatten an overlay snapshot { nameTitle:{screen,ndi}, … } into chips describing each
// live graphic per destination kind — the readable summary of what a scene will restore.
function overlayChips(overlay) {
  if (!overlay) return null;
  const chips = [];
  for (const kind of ['nameTitle', 'ticker', 'custom', 'countdown']) {
    const slot = overlay[kind];
    if (!slot) continue;
    for (const dest of ['screen', 'ndi']) {
      const v = slot[dest];
      if (!v) continue;
      const detail = kind === 'nameTitle' ? (v.name || v.title || '')
        : kind === 'ticker' ? (v.text || '')
        : kind === 'countdown' ? (v.label || v.mode || '')
        : (v.label || 'HTML');
      chips.push({ key: `${kind}-${dest}`, kind, dest, detail });
    }
  }
  return chips;
}

export default function ScenesPanel() {
  const [scenes, setScenes] = useState([]);
  const [editor, setEditor] = useState(null); // {} = new, scene row = edit, null = closed

  const load = useCallback(() => { window.cue.scenes.list().then(setScenes); }, []);
  useEffect(() => { load(); }, [load]);

  // Notify OperatorView (number-key recall) that the scene set changed.
  const notifyChanged = () => window.dispatchEvent(new Event('cue:scenes-changed'));

  function take(scene) { window.cue.scenes.apply(scene); }

  async function remove(scene) {
    if (!confirm(`Delete scene "${scene.name}"?`)) return;
    await window.cue.scenes.delete(scene.id);
    load(); notifyChanged();
  }

  async function onSaved() { setEditor(null); load(); notifyChanged(); }

  return (
    <div className="flex flex-col h-full bg-surface-container-low min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-sm px-md h-11 border-b border-outline-variant/30 shrink-0">
        <span className="material-symbols-outlined text-[18px] text-primary">bolt</span>
        <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Scenes</span>
        <span className="text-[10px] font-mono text-on-surface-variant/50 normal-case tracking-normal ml-xs">one-press output state recall</span>
        <button onClick={() => setEditor({})}
          className="ml-auto flex items-center gap-xs px-md py-xs rounded text-label-sm font-label-sm bg-primary text-on-primary font-bold hover:brightness-110 cursor-pointer">
          <span className="material-symbols-outlined text-[14px]">add</span> New Scene
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-md min-h-0">
        {scenes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-xl gap-sm text-outline-variant">
            <span className="material-symbols-outlined text-4xl">bolt</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">No scenes yet</span>
            <span className="text-body-md text-on-surface-variant/60 max-w-[420px] text-center">
              Set the live output the way you want (lower-third, ticker, logo, mute), then capture it
              into a scene and bind a number key for instant recall.
            </span>
            <button onClick={() => setEditor({})} className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-primary hover:underline cursor-pointer">Create one</button>
          </div>
        ) : (
          <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {scenes.map((s) => (
              <SceneCard key={s.id} scene={s} onTake={() => take(s)} onEdit={() => setEditor(s)} onDelete={() => remove(s)} />
            ))}
          </div>
        )}
      </div>

      {editor && <SceneEditor scene={editor.id ? editor : null} onClose={() => setEditor(null)} onSaved={onSaved} />}
    </div>
  );
}

function SceneCard({ scene, onTake, onEdit, onDelete }) {
  const overlay = scene.overlay_json ? safeParse(scene.overlay_json) : null;
  const chips = overlayChips(overlay);
  const program = PROGRAM_OPTS.find((p) => p.id === scene.program) || PROGRAM_OPTS[0];
  const audio = audioFromRow(scene.audio_muted);

  return (
    <div className="group flex flex-col rounded-lg border border-outline-variant/30 bg-surface-container hover:border-outline-variant/60 transition-colors overflow-hidden">
      <div className="flex items-center gap-sm px-md pt-md">
        {scene.hotkey && (
          <span className="shrink-0 w-7 h-7 flex items-center justify-center rounded bg-primary/15 text-primary text-body-md font-mono font-bold">{scene.hotkey}</span>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-body-lg text-on-surface font-medium truncate">{scene.name}</div>
        </div>
        <div className="flex items-center gap-xs opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} title="Edit" className="w-6 h-6 flex items-center justify-center rounded text-on-surface-variant hover:text-primary cursor-pointer">
            <span className="material-symbols-outlined text-[15px]">edit</span>
          </button>
          <button onClick={onDelete} title="Delete" className="w-6 h-6 flex items-center justify-center rounded text-on-surface-variant hover:text-error cursor-pointer">
            <span className="material-symbols-outlined text-[15px]">delete</span>
          </button>
        </div>
      </div>

      {/* What the scene sets */}
      <div className="px-md py-sm flex flex-wrap gap-xs min-h-[2.2rem]">
        {program.id !== 'none' && (
          <span className="flex items-center gap-xs px-sm py-[2px] rounded bg-surface-container-high text-on-surface-variant text-[10px] font-label-sm uppercase tracking-[0.04em]">
            <span className="material-symbols-outlined text-[12px]">{program.icon}</span>{program.label}
          </span>
        )}
        {audio !== 'leave' && (
          <span className="flex items-center gap-xs px-sm py-[2px] rounded bg-surface-container-high text-on-surface-variant text-[10px] font-label-sm uppercase tracking-[0.04em]">
            <span className="material-symbols-outlined text-[12px]">{audio === 'mute' ? 'volume_off' : 'volume_up'}</span>{audio}
          </span>
        )}
        {chips && chips.length === 0 && (
          <span className="px-sm py-[2px] rounded bg-surface-container-high text-on-surface-variant/70 text-[10px] font-label-sm uppercase tracking-[0.04em]">Hide all graphics</span>
        )}
        {chips && chips.map((c) => (
          <span key={c.key} className="flex items-center gap-xs px-sm py-[2px] rounded bg-tertiary/10 border border-tertiary/30 text-tertiary text-[10px] font-label-sm uppercase tracking-[0.04em] max-w-full">
            <span className="truncate">{KIND_LABEL[c.kind]}</span>
            <span className="opacity-60">· {TARGET_LABEL[c.dest]}</span>
          </span>
        ))}
        {!chips && program.id === 'none' && audio === 'leave' && (
          <span className="px-sm py-[2px] rounded text-on-surface-variant/40 text-[10px] font-label-sm uppercase tracking-[0.04em]">Empty scene</span>
        )}
      </div>

      <div className="px-md pb-md">
        <button onClick={onTake}
          className="w-full px-md py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold bg-tertiary-container text-on-tertiary hover:brightness-110 cursor-pointer">
          Take
        </button>
      </div>
    </div>
  );
}

function SceneEditor({ scene, onClose, onSaved }) {
  const [name, setName] = useState(scene?.name || '');
  const [hotkey, setHotkey] = useState(scene?.hotkey || '');
  const [program, setProgram] = useState(scene?.program || 'none');
  const [audio, setAudio] = useState(audioFromRow(scene?.audio_muted));
  const [manageOverlay, setManageOverlay] = useState(scene ? !!scene.overlay_json : true);
  const [overlay, setOverlay] = useState(scene?.overlay_json ? safeParse(scene.overlay_json) : null);
  const [captured, setCaptured] = useState(false);

  // Snapshot the LIVE output state into the scene — the core authoring action. Fills the
  // overlay, the program action (from displayMode) and the audio (from the transport).
  async function captureNow() {
    const st = await window.cue.output.getState();
    setOverlay(st.overlay || { nameTitle: { screen: null, ndi: null }, ticker: { screen: null, ndi: null }, custom: { screen: null, ndi: null }, countdown: { screen: null, ndi: null } });
    setManageOverlay(true);
    const dm = st.displayMode;
    setProgram(dm === 'logo' ? 'logo' : dm === 'cleared' ? 'clear' : dm === 'content' ? 'content' : 'none');
    if (st.transport?.active) setAudio(st.transport.muted ? 'mute' : 'unmute');
    setCaptured(true);
  }

  function buildPayload() {
    return {
      name: name.trim() || 'Scene',
      hotkey: hotkey || null,
      program,
      audio_muted: audioToWire(audio),
      overlay: manageOverlay ? (overlay || {}) : null,
    };
  }

  async function save() {
    const payload = buildPayload();
    if (scene?.id) await window.cue.scenes.update(scene.id, payload);
    else await window.cue.scenes.create(payload);
    onSaved();
  }

  // Apply the in-progress scene to the live output without saving — a dry run.
  function testNow() { window.cue.scenes.apply(buildPayload()); }

  const chips = manageOverlay ? overlayChips(overlay) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-lg" onMouseDown={onClose}>
      <div className="w-full max-w-[520px] bg-surface-container-high rounded-xl border border-outline-variant/40 flex flex-col max-h-full overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-sm px-lg h-12 border-b border-outline-variant/30 shrink-0">
          <span className="material-symbols-outlined text-[18px] text-primary">bolt</span>
          <span className="text-label-md font-label-sm uppercase tracking-[0.05em] text-on-surface">{scene ? 'Edit Scene' : 'New Scene'}</span>
          <button onClick={onClose} className="ml-auto text-on-surface-variant/60 hover:text-on-surface cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-lg flex flex-col gap-lg min-h-0">
          {/* Capture */}
          <button onClick={captureNow}
            className="flex items-center justify-center gap-sm px-md py-sm rounded-lg border border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">photo_camera</span>
            <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold">Capture current output</span>
          </button>
          {captured && <div className="text-[11px] font-mono text-tertiary -mt-sm">Snapshotted the live output state.</div>}

          {/* Name + hotkey */}
          <div className="flex gap-md">
            <label className="flex-1 flex flex-col gap-xs">
              <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="To Break"
                className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-xs w-28">
              <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Hotkey</span>
              <select value={hotkey} onChange={(e) => setHotkey(e.target.value)}
                className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm h-9 text-body-md text-on-surface focus:outline-none focus:border-primary cursor-pointer">
                <option value="">None</option>
                {['1','2','3','4','5','6','7','8','9'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
          </div>

          {/* Program action */}
          <div className="flex flex-col gap-xs">
            <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Program layer</span>
            <Segmented opts={PROGRAM_OPTS} value={program} onChange={setProgram} />
            <span className="text-[11px] font-mono text-on-surface-variant/50">{PROGRAM_OPTS.find((p) => p.id === program)?.hint}</span>
          </div>

          {/* Audio */}
          <div className="flex flex-col gap-xs">
            <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Program audio</span>
            <Segmented opts={AUDIO_OPTS} value={audio} onChange={setAudio} />
          </div>

          {/* Overlay */}
          <div className="flex flex-col gap-sm">
            <label className="flex items-center gap-sm cursor-pointer">
              <input type="checkbox" checked={manageOverlay} onChange={(e) => setManageOverlay(e.target.checked)}
                className="accent-primary w-4 h-4 cursor-pointer" />
              <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Recall graphics overlay</span>
            </label>
            {manageOverlay && (
              <div className="rounded-lg border border-outline-variant/30 bg-surface-container p-md flex flex-wrap gap-xs min-h-[2.6rem] items-center">
                {!chips ? (
                  <span className="text-[11px] font-mono text-on-surface-variant/50">Capture the live output to snapshot graphics, or save now to recall an empty overlay (hide all).</span>
                ) : chips.length === 0 ? (
                  <span className="px-sm py-[2px] rounded bg-surface-container-high text-on-surface-variant/70 text-[10px] font-label-sm uppercase tracking-[0.04em]">Hide all graphics</span>
                ) : chips.map((c) => (
                  <span key={c.key} className="flex items-center gap-xs px-sm py-[2px] rounded bg-tertiary/10 border border-tertiary/30 text-tertiary text-[10px] font-label-sm uppercase tracking-[0.04em] max-w-full">
                    <span className="truncate">{KIND_LABEL[c.kind]}</span><span className="opacity-60">· {TARGET_LABEL[c.dest]}</span>
                    {c.detail && <span className="opacity-50 normal-case tracking-normal truncate max-w-[110px]">{c.detail}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-sm px-lg h-14 border-t border-outline-variant/30 shrink-0">
          <button onClick={testNow}
            className="flex items-center gap-xs px-md py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] bg-surface-container border border-outline-variant/40 text-on-surface-variant hover:text-on-surface cursor-pointer">
            <span className="material-symbols-outlined text-[14px]">play_arrow</span> Test
          </button>
          <button onClick={onClose} className="ml-auto px-md py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant hover:text-on-surface cursor-pointer">Cancel</button>
          <button onClick={save} disabled={!name.trim()}
            className="px-lg py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold bg-primary text-on-primary hover:brightness-110 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Save</button>
        </div>
      </div>
    </div>
  );
}

function Segmented({ opts, value, onChange }) {
  return (
    <div className="flex items-center gap-[2px] bg-surface-container-lowest rounded-lg p-[3px]">
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)}
            className={`flex-1 flex items-center justify-center gap-xs px-sm py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.04em] transition-colors cursor-pointer ${
              active ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
            }`}>
            <span className="material-symbols-outlined text-[14px]">{o.icon}</span>{o.label}
          </button>
        );
      })}
    </div>
  );
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
