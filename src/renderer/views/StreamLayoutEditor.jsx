import React, { useState, useCallback, useRef, useEffect } from 'react';

// ── Stream Layout Editor ──────────────────────────────────────────────────────
// A WYSIWYG editor for the free-form stream composition. The two layers — the camera
// FEED and the Cue PROGRAM — are drag/resizable boxes on a 16:9 canvas that renders
// each layer's TRUE on-screen appearance, so the canvas is an exact stand-in for the
// encoded frame:
//   • feed    — fills its box, cropping (cover) or letterboxing (contain).
//   • program — a designed 16:9 surface, either letterboxed-and-centred ('fit', the
//               default — lyrics never distort) or stretched to the box ('fill').
// Edits apply live to the compositor on change (debounced); Save stores a named preset.

export const DEFAULT_LAYOUT = {
  feed:    { visible: true,  x: 0, y: 0, w: 100, h: 100, fit: 'cover' }, // cover | contain
  program: { visible: false, x: 0, y: 0, w: 100, h: 100, fit: 'fit' },   // fit | fill
  front: 'program',
  lyricsOverFeed: false,
};

// The program's actual rendered rect inside its box (letterbox), all in % of the FRAME.
// MUST stay identical to programFit() in src/output/stream-feed.js so editor == output.
export function programFit(b) {
  const f = Math.min(b.w, b.h) / 100;
  const left = b.x + (b.w - 100 * f) / 2;
  const top = b.y + (b.h - 100 * f) / 2;
  return { left, top, f, w: 100 * f, h: 100 * f };
}

// One-click arrangements. Each returns a complete layout; `fit` choices carry over.
const corner = (w = 33, m = 4) => ({ x: 100 - w - m, y: 100 - w - m, w, h: w }); // 16:9 inset, bottom-right
const prog = (box, l) => ({ visible: true, fit: l.program.fit, ...box });
const cam = (box, l) => ({ visible: true, fit: l.feed.fit, ...box });
export const TEMPLATES = [
  { id: 'camera',  name: 'Full Camera',  icon: 'videocam',
    make: (l) => ({ ...DEFAULT_LAYOUT, feed: cam({ x: 0, y: 0, w: 100, h: 100 }, l), program: { ...DEFAULT_LAYOUT.program, visible: false }, lyricsOverFeed: l.lyricsOverFeed }) },
  { id: 'program', name: 'Full Program', icon: 'subtitles',
    make: (l) => ({ ...DEFAULT_LAYOUT, feed: { ...DEFAULT_LAYOUT.feed, visible: false }, program: prog({ x: 0, y: 0, w: 100, h: 100 }, l), front: 'program', lyricsOverFeed: false }) },
  { id: 'pip-cam', name: 'PiP Camera',   icon: 'picture_in_picture',
    make: (l) => ({ feed: cam(corner(), l), program: prog({ x: 0, y: 0, w: 100, h: 100 }, l), front: 'feed', lyricsOverFeed: false }) },
  { id: 'pip-prog', name: 'PiP Program', icon: 'picture_in_picture_alt',
    make: (l) => ({ feed: cam({ x: 0, y: 0, w: 100, h: 100 }, l), program: prog(corner(), l), front: 'program', lyricsOverFeed: false }) },
  { id: 'side',    name: 'Side by Side', icon: 'splitscreen_right',
    make: (l) => ({ feed: cam({ x: 0, y: 0, w: 50, h: 100 }, l), program: prog({ x: 50, y: 0, w: 50, h: 100 }, l), front: 'program', lyricsOverFeed: false }) },
  { id: 'stack',   name: 'Top / Bottom', icon: 'splitscreen',
    make: (l) => ({ feed: cam({ x: 0, y: 0, w: 100, h: 50 }, l), program: prog({ x: 0, y: 50, w: 100, h: 50 }, l), front: 'program', lyricsOverFeed: false }) },
];

const MIN = 8; // smallest box edge (%)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function StreamLayoutEditor({ initial, presetId, presetName, onApply, onSaved, onDeleted, onClose }) {
  const [layout, setLayout] = useState(() => withFit(initial || DEFAULT_LAYOUT));
  const [name, setName] = useState(presetName || '');
  const [sel, setSel] = useState(layout.program.visible && !layout.feed.visible ? 'program' : 'feed');
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const applyTimer = useRef(null);

  // Apply live to the compositor as the layout changes, DEBOUNCED — a drag updates state
  // ~60×/s and each apply persists to settings + repaints the offscreen window, so a
  // trailing timer keeps the live monitor in sync without hammering SQLite. The canvas
  // itself is WYSIWYG, so it stays responsive regardless.
  useEffect(() => {
    clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(() => onApply?.(layout), 100);
    return () => clearTimeout(applyTimer.current);
  }, [layout, onApply]);

  const setLayer = useCallback((kind, patch) => setLayout((l) => ({ ...l, [kind]: { ...l[kind], ...patch } })), []);

  // ── Pointer drag / resize on the canvas ─────────────────────────────────────
  const onPointerDown = (e, kind, handle) => {
    e.preventDefault(); e.stopPropagation();
    setSel(kind);
    dragRef.current = { kind, handle, rect: canvasRef.current.getBoundingClientRect(), startX: e.clientX, startY: e.clientY, box: { ...layout[kind] } };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current; if (!d) return;
    const dx = ((e.clientX - d.startX) / d.rect.width) * 100;
    const dy = ((e.clientY - d.startY) / d.rect.height) * 100;
    let { x, y, w, h } = d.box;
    if (d.handle === 'move') {
      x = clamp(x + dx, 0, 100 - w);
      y = clamp(y + dy, 0, 100 - h);
    } else {
      if (d.handle.includes('e')) w = clamp(w + dx, MIN, 100 - x);
      if (d.handle.includes('s')) h = clamp(h + dy, MIN, 100 - y);
      if (d.handle.includes('w')) { const nx = clamp(x + dx, 0, x + w - MIN); w += x - nx; x = nx; }
      if (d.handle.includes('n')) { const ny = clamp(y + dy, 0, y + h - MIN); h += y - ny; y = ny; }
    }
    const r = (n) => Math.round(n * 10) / 10;
    setLayer(d.kind, { x: r(x), y: r(y), w: r(w), h: r(h) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  const applyTemplate = (tpl) => { const next = withFit(tpl.make(layout)); setLayout(next); setSel(next.feed.visible ? 'feed' : 'program'); };

  async function save(asNew) {
    setBusy(true);
    const res = await window.cue.output.stream.savePreset({ id: asNew ? undefined : (presetId || undefined), name: name.trim() || 'Untitled Layout', layout });
    setBusy(false);
    onSaved?.(res, layout);
  }
  async function del() {
    if (!presetId) return;
    setBusy(true);
    const list = await window.cue.output.stream.deletePreset(presetId);
    setBusy(false);
    onDeleted?.(list);
  }

  const layers = [
    { kind: 'feed',    label: 'Camera Feed', icon: 'videocam',  primary: true },
    { kind: 'program', label: 'Cue Program', icon: 'subtitles', primary: false },
  ];
  // Render order: the `front` layer is drawn last so it sits on top.
  const drawOrder = [...layers].sort((a, b) => (a.kind === layout.front ? 1 : 0) - (b.kind === layout.front ? 1 : 0));

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-lg" onMouseDown={onClose}>
      <div className="w-full max-w-[1040px] max-h-full bg-surface-container-low border border-outline-variant/40 rounded-xl shadow-2xl flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-sm px-lg h-12 border-b border-outline-variant/30 shrink-0">
          <span className="material-symbols-outlined text-[18px] text-primary">dashboard_customize</span>
          <span className="text-label-md font-label-md font-bold uppercase tracking-[0.05em]">{presetId ? 'Edit Layout' : 'New Layout'}</span>
          <button onClick={onClose} className="ml-auto text-on-surface-variant hover:text-on-surface cursor-pointer"><span className="material-symbols-outlined text-[18px]">close</span></button>
        </div>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Canvas + templates */}
          <div className="flex-1 min-w-0 p-lg flex flex-col gap-md overflow-y-auto custom-scrollbar">
            <div ref={canvasRef} className="relative w-full bg-black rounded-lg overflow-hidden border border-outline-variant/40 select-none shrink-0" style={{ aspectRatio: '16 / 9' }}>
              {/* faint frame guides */}
              <div className="absolute inset-0 pointer-events-none opacity-[0.06]" style={{ backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)', backgroundSize: '33.333% 33.333%' }} />
              {drawOrder.filter((ly) => layout[ly.kind].visible).map((ly) => (
                <LayerBox key={ly.kind} meta={ly} box={layout[ly.kind]} front={layout.front === ly.kind}
                  selected={sel === ly.kind} onSelect={() => setSel(ly.kind)} onPointerDown={onPointerDown} />
              ))}
              {layout.lyricsOverFeed && (
                <div className="absolute left-0 right-0 bottom-0 h-[26%] bg-gradient-to-t from-black/85 via-black/50 to-transparent flex items-end justify-center pb-3 pointer-events-none z-[40]">
                  <span className="text-white/80 text-[11px] uppercase tracking-widest">Lyrics lower-third</span>
                </div>
              )}
              {!layout.feed.visible && !layout.program.visible && (
                <div className="absolute inset-0 flex items-center justify-center text-on-surface-variant/40 text-label-sm uppercase tracking-widest">Both layers hidden</div>
              )}
            </div>

            <div>
              <p className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline mb-xs">Quick layouts</p>
              <div className="grid grid-cols-3 gap-xs">
                {TEMPLATES.map((t) => (
                  <button key={t.id} onClick={() => applyTemplate(t)}
                    className="flex items-center justify-center gap-xs h-9 rounded-lg text-label-sm font-label-sm font-bold uppercase tracking-[0.03em] bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant/60 cursor-pointer transition-all active:scale-95">
                    <span className="material-symbols-outlined text-[16px]">{t.icon}</span>{t.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Inspector */}
          <div className="w-[268px] shrink-0 border-l border-outline-variant/30 bg-surface-container-low p-md space-y-md overflow-y-auto custom-scrollbar">
            <label className="block">
              <span className="text-label-sm font-label-sm text-on-surface-variant">Preset name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Worship — Side by Side"
                className="mt-xs w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary" />
            </label>

            {layers.map((ly) => {
              const b = layout[ly.kind];
              const fitOpts = ly.kind === 'feed' ? [['cover', 'Fill'], ['contain', 'Fit']] : [['fit', 'Fit'], ['fill', 'Stretch']];
              return (
                <div key={ly.kind} className={`rounded-lg border p-sm space-y-sm cursor-pointer transition-colors ${sel === ly.kind ? 'border-primary/50 bg-primary/[0.05]' : 'border-outline-variant/30 hover:border-outline-variant/50'}`} onClick={() => setSel(ly.kind)}>
                  <div className="flex items-center gap-xs">
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant">{ly.icon}</span>
                    <span className="text-label-sm font-label-sm font-bold uppercase tracking-[0.04em] flex-1">{ly.label}</span>
                    <button onClick={(e) => { e.stopPropagation(); setLayer(ly.kind, { visible: !b.visible }); }} title={b.visible ? 'Hide layer' : 'Show layer'}
                      className={`cursor-pointer ${b.visible ? 'text-tertiary' : 'text-on-surface-variant/40'}`}>
                      <span className="material-symbols-outlined text-[18px]">{b.visible ? 'visibility' : 'visibility_off'}</span>
                    </button>
                  </div>
                  {b.visible && (
                    <>
                      <div className="grid grid-cols-4 gap-[4px]">
                        {['x', 'y', 'w', 'h'].map((k) => (
                          <label key={k} className="flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
                            <span className="text-[9px] uppercase text-on-surface-variant/50">{k}</span>
                            <input type="number" value={Math.round(b[k])} min={0} max={100}
                              onChange={(e) => { const v = clamp(Number(e.target.value) || 0, 0, 100); const lim = (k === 'w') ? Math.min(v, 100 - b.x) : (k === 'h') ? Math.min(v, 100 - b.y) : (k === 'x') ? Math.min(v, 100 - b.w) : Math.min(v, 100 - b.h); setLayer(ly.kind, { [k]: lim }); }}
                              className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-[2px] py-[2px] text-[11px] text-center tabular-nums text-on-surface outline-none focus:border-primary" />
                          </label>
                        ))}
                      </div>
                      <div className="flex items-center gap-xs" onClick={(e) => e.stopPropagation()}>
                        <span className="text-[9px] uppercase text-on-surface-variant/50 w-6">Fit</span>
                        <div className="flex bg-surface-container-lowest border border-outline-variant/40 rounded overflow-hidden">
                          {fitOpts.map(([id, lbl]) => (
                            <button key={id} onClick={() => setLayer(ly.kind, { fit: id })}
                              className={`px-sm h-6 text-[10px] uppercase tracking-wide cursor-pointer ${b.fit === id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>{lbl}</button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            <div className="flex items-center gap-xs">
              <span className="text-label-sm font-label-sm text-on-surface-variant flex-1">On top</span>
              <div className="flex bg-surface-container-lowest border border-outline-variant/40 rounded overflow-hidden">
                {[['feed', 'Camera'], ['program', 'Program']].map(([id, lbl]) => (
                  <button key={id} onClick={() => setLayout((l) => ({ ...l, front: id }))}
                    className={`px-sm h-6 text-[10px] uppercase tracking-wide cursor-pointer ${layout.front === id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>{lbl}</button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-sm cursor-pointer select-none">
              <input type="checkbox" checked={!!layout.lyricsOverFeed} onChange={(e) => setLayout((l) => ({ ...l, lyricsOverFeed: e.target.checked }))} className="accent-primary w-4 h-4 cursor-pointer" />
              <span className="text-body-sm text-on-surface">Lyrics as lower-third band</span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-sm px-lg h-14 border-t border-outline-variant/30 shrink-0">
          {presetId && (
            <button onClick={del} disabled={busy} className="flex items-center gap-xs h-9 px-md rounded-lg text-label-sm font-label-sm font-bold uppercase text-error hover:bg-error/10 cursor-pointer disabled:opacity-40">
              <span className="material-symbols-outlined text-[16px]">delete</span>Delete
            </button>
          )}
          <div className="ml-auto flex items-center gap-sm">
            <button onClick={onClose} className="h-9 px-md rounded-lg text-label-sm font-label-sm font-bold uppercase text-on-surface-variant hover:text-on-surface cursor-pointer">Cancel</button>
            {presetId && (
              <button onClick={() => save(true)} disabled={busy} className="h-9 px-md rounded-lg text-label-sm font-label-sm font-bold uppercase bg-surface-container-high border border-outline-variant/40 text-on-surface hover:border-outline-variant/70 cursor-pointer disabled:opacity-40">Save as New</button>
            )}
            <button onClick={() => save(false)} disabled={busy} className="h-9 px-md rounded-lg text-label-sm font-label-sm font-bold uppercase bg-primary text-on-primary hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40">
              {busy ? 'Saving…' : presetId ? 'Save' : 'Save Preset'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Ensure both layers carry a fit value (older presets / templates may omit it).
function withFit(l) {
  return {
    ...l,
    feed: { fit: 'cover', ...l.feed },
    program: { fit: 'fit', ...l.program },
  };
}

// A draggable/resizable layer on the canvas. The OUTER rect is the manipulable box; the
// INNER rect shows the layer's true rendered content (feed crop / program letterbox) so
// the canvas matches the encoded frame exactly.
function LayerBox({ meta, box, selected, front, onSelect, onPointerDown }) {
  const accent = meta.primary ? 'border-primary' : 'border-on-surface/70';
  const handles = ['nw', 'ne', 'sw', 'se'];
  const hPos = {
    nw: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
    ne: 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
    sw: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
    se: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
  };

  // Inner content rect, in % of the BOX.
  let inner = { left: 0, top: 0, w: 100, h: 100 };
  if (!meta.primary && box.fit !== 'fill') {
    const f = programFit(box);
    inner = { left: (f.left - box.x) / box.w * 100, top: (f.top - box.y) / box.h * 100, w: f.w / box.w * 100, h: f.h / box.h * 100 };
  }
  const fill = meta.primary ? 'rgba(59,130,246,0.16)' : 'rgba(226,232,240,0.14)';

  return (
    <div
      className={`absolute border-2 ${accent} ${selected ? 'opacity-100' : 'opacity-80 hover:opacity-95'}`}
      style={{ left: box.x + '%', top: box.y + '%', width: box.w + '%', height: box.h + '%', zIndex: (front ? 20 : 10) + (selected ? 4 : 0) }}
      onPointerDown={(e) => onPointerDown(e, meta.kind, 'move')}
      onClick={onSelect}
    >
      {/* content rect (true rendered region) */}
      <div className="absolute flex items-start" style={{ left: inner.left + '%', top: inner.top + '%', width: inner.w + '%', height: inner.h + '%', background: fill, outline: meta.primary ? 'none' : '1px dashed rgba(255,255,255,0.25)', outlineOffset: '-1px' }}>
        <div className={`flex items-center gap-1 m-1 px-1 rounded pointer-events-none ${meta.primary ? 'text-primary' : 'text-on-surface'}`} style={{ background: 'rgba(0,0,0,0.35)' }}>
          <span className="material-symbols-outlined text-[13px]">{meta.icon}</span>
          <span className="text-[10px] font-bold uppercase tracking-wide whitespace-nowrap">{meta.label}</span>
        </div>
      </div>
      {selected && handles.map((h) => (
        <div key={h} onPointerDown={(e) => onPointerDown(e, meta.kind, h)} className={`absolute w-3 h-3 rounded-sm bg-primary border border-white/80 ${hPos[h]}`} style={{ zIndex: 30 }} />
      ))}
    </div>
  );
}
