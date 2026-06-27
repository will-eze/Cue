import React, { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';

// ── Stage Layout Editor ───────────────────────────────────────────────────────
// A WYSIWYG editor for the free-form stage/confidence display. Elements are
// drag/resizable boxes on a 16:9 canvas (each box in % of the 1920×1080 frame) that
// renders a faithful stand-in of its on-screen appearance, so the canvas matches the
// stage output. Controlled component: `value` is the layout, `onChange` fires on every
// edit (the parent debounces the live apply to the channel). Mirrors the drag/resize
// math + handle pattern of StreamLayoutEditor, generalised from 2 fixed layers to an
// arbitrary element list.

const MIN = 5;     // smallest box edge (%)
const SNAP = 1.4;  // snap threshold (% of frame) for edge/centre alignment
const GRID = 0.5;  // fallback grid step when no smart-snap target is near
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const newId = () => 'el_' + Math.random().toString(36).slice(2, 9);

// Snap a single value to the nearest target line within SNAP; returns the target or null.
function snapVal(val, targets) {
  let best = null, bestD = SNAP;
  for (const t of targets) { const d = Math.abs(val - t); if (d < bestD) { bestD = d; best = t; } }
  return best;
}
// Snap any of a box's candidate lines (left/centre/right, or top/middle/bottom) to the
// nearest target; returns the {offset, line} of the closest hit, or null.
function snapAxis(cands, targets) {
  let off = null, bestD = SNAP, line = null;
  for (const v of cands) for (const t of targets) { const d = Math.abs(v - t); if (d < bestD) { bestD = d; off = t - v; line = t; } }
  return off == null ? null : { off, line };
}

// Largest 16:9 box (px) that fits the measured container — keeps the whole stage frame
// on screen (incl. the bottom row) regardless of the panel's height.
function useFitBox(ref, ratio = 16 / 9) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const compute = () => {
      const cw = el.clientWidth, ch = el.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      let w = cw, h = w / ratio;
      if (h > ch) { h = ch; w = h * ratio; }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, ratio]);
  return box;
}

// Per-type metadata: palette label/icon, spawn defaults, and whether more than one is
// allowed (current/next text bind a single live slot — extra copies just duplicate it).
export const ELEMENT_CATALOG = {
  currentText:    { label: 'Current Slide',   icon: 'subtitles',     defaults: { w: 100, h: 50, align: 'center', color: '#ffffff', fit: 'auto', fontPx: 88, showRef: true } },
  nextText:       { label: 'Next Slide',      icon: 'skip_next',     defaults: { w: 100, h: 18, label: '', color: 'rgba(255,255,255,0.4)', fontPx: 26 } },
  clock:          { label: 'Clock',           icon: 'schedule',      defaults: { w: 33,  h: 12, label: '', hour12: true, showSeconds: true, fontPx: 48 } },
  timer:          { label: 'Timer',           icon: 'timer',         defaults: { w: 34,  h: 12, label: '', showBar: true, fontPx: 48 } },
  elapsedTimer:   { label: 'Elapsed',         icon: 'timelapse',     defaults: { w: 33,  h: 12, label: '', fontPx: 48 } },
  videoCountdown: { label: 'Video Countdown', icon: 'smart_display', defaults: { w: 33,  h: 12, label: '', fontPx: 48 } },
  message:        { label: 'Message Bar',     icon: 'campaign',      defaults: { w: 100, h: 10, align: 'center', fontPx: 36 } },
  staticText:     { label: 'Static Text',     icon: 'text_fields',   defaults: { w: 30,  h: 10, text: 'Label', fontPx: 32, color: '#e2e2e8', align: 'center' } },
};
const TYPE_ORDER = ['currentText', 'nextText', 'clock', 'timer', 'elapsedTimer', 'videoCountdown', 'message', 'staticText'];

// One element with fresh id: catalog defaults, then the template's box + overrides.
const mkEl = (type, x, y, w, h, extra) => ({ id: newId(), type, ...ELEMENT_CATALOG[type].defaults, x, y, w, h, ...(extra || {}) });

// Ready-made starting layouts the operator can pick from. Each returns a complete,
// fresh layout (new element ids). Boxes are inset ~2.5% from the frame edges with ~1.5%
// gutters between them, so every preset looks intentional (not full-bleed).
export const TEMPLATES = [
  { id: 'classic', name: 'Classic', icon: 'dashboard', make: () => ({ elements: [
    mkEl('clock', 2.5, 2.5, 30.5, 12), mkEl('timer', 34.5, 2.5, 31, 12), mkEl('videoCountdown', 67, 2.5, 30.5, 12),
    mkEl('currentText', 2.5, 16, 95, 54), mkEl('nextText', 2.5, 71.5, 95, 14), mkEl('message', 2.5, 87.5, 95, 10),
  ] }) },
  { id: 'lyrics', name: 'Lyrics Focus', icon: 'subtitles', make: () => ({ elements: [
    mkEl('currentText', 2.5, 2.5, 95, 76, { showRef: true }), mkEl('nextText', 2.5, 80, 95, 17.5),
  ] }) },
  { id: 'minimal', name: 'Minimal', icon: 'crop_square', make: () => ({ elements: [
    mkEl('currentText', 2.5, 2.5, 95, 70), mkEl('nextText', 2.5, 74, 95, 23.5),
  ] }) },
  { id: 'speaker', name: 'Speaker', icon: 'record_voice_over', make: () => ({ elements: [
    mkEl('clock', 2.5, 2.5, 46.5, 14), mkEl('elapsedTimer', 51, 2.5, 46.5, 14),
    mkEl('currentText', 2.5, 18, 95, 61), mkEl('message', 2.5, 80.5, 95, 17),
  ] }) },
  { id: 'countdown', name: 'Countdown', icon: 'timer', make: () => ({ elements: [
    mkEl('clock', 2.5, 2.5, 46.5, 36), mkEl('timer', 51, 2.5, 46.5, 36, { showBar: true }),
    mkEl('currentText', 2.5, 40, 95, 57.5),
  ] }) },
  { id: 'musician', name: 'Musician', icon: 'music_note', make: () => ({ elements: [
    mkEl('currentText', 2.5, 2.5, 95, 53), mkEl('nextText', 2.5, 57, 95, 22),
    mkEl('clock', 2.5, 80.5, 46.5, 17), mkEl('timer', 51, 80.5, 46.5, 17),
  ] }) },
];

export default function StageLayoutEditor({ value, onChange }) {
  const elements = (value && value.elements) || [];
  const [sel, setSel] = useState(null);          // selected element id
  const [addOpen, setAddOpen] = useState(false);
  const [guides, setGuides] = useState([]);      // active alignment guides during a drag
  const canvasRef = useRef(null);
  const fitRef = useRef(null);
  const dragRef = useRef(null);
  const addRef = useRef(null);
  const box = useFitBox(fitRef);

  // Keep a live clock for the WYSIWYG clock preview.
  const [clock, setClock] = useState('');
  useEffect(() => {
    const fmt = () => setClock(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
    fmt();
    const id = setInterval(fmt, 1000);
    return () => clearInterval(id);
  }, []);

  // Close the add menu on an outside click.
  useEffect(() => {
    if (!addOpen) return;
    const onDown = (e) => { if (addRef.current && !addRef.current.contains(e.target)) setAddOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [addOpen]);

  const setElements = useCallback((next) => onChange({ ...value, elements: next }), [onChange, value]);
  const patchEl = useCallback((id, patch) => setElements(elements.map((e) => (e.id === id ? { ...e, ...patch } : e))), [elements, setElements]);

  const selEl = elements.find((e) => e.id === sel) || null;

  // ── Pointer drag / resize on the canvas ─────────────────────────────────────
  const onPointerDown = (e, id, handle) => {
    e.preventDefault(); e.stopPropagation();
    setSel(id);
    const b = elements.find((el) => el.id === id);
    if (!b) return;
    // Build snap target lines once per drag: canvas edges + thirds + every OTHER element's
    // left/centre/right (vertical) and top/middle/bottom (horizontal).
    const vT = [0, 50, 100, 33.333, 66.667], hT = [0, 50, 100, 33.333, 66.667];
    for (const o of elements) {
      if (o.id === id) continue;
      vT.push(o.x, o.x + o.w / 2, o.x + o.w);
      hT.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    dragRef.current = { id, handle, rect: canvasRef.current.getBoundingClientRect(), startX: e.clientX, startY: e.clientY, box: { ...b }, vT, hT };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current; if (!d) return;
    const dx = ((e.clientX - d.startX) / d.rect.width) * 100;
    const dy = ((e.clientY - d.startY) / d.rect.height) * 100;
    let { x, y, w, h } = d.box;
    const g = [];
    if (d.handle === 'move') {
      x += dx; y += dy;
      const sv = snapAxis([x, x + w / 2, x + w], d.vT);
      if (sv) { x += sv.off; g.push({ axis: 'v', pos: sv.line }); } else x = Math.round(x / GRID) * GRID;
      const sh = snapAxis([y, y + h / 2, y + h], d.hT);
      if (sh) { y += sh.off; g.push({ axis: 'h', pos: sh.line }); } else y = Math.round(y / GRID) * GRID;
      x = clamp(x, 0, 100 - w);
      y = clamp(y, 0, 100 - h);
    } else {
      if (d.handle.includes('e')) { w = clamp(w + dx, MIN, 100 - x); const s = snapVal(x + w, d.vT); if (s != null) { w = clamp(s - x, MIN, 100 - x); g.push({ axis: 'v', pos: s }); } }
      if (d.handle.includes('s')) { h = clamp(h + dy, MIN, 100 - y); const s = snapVal(y + h, d.hT); if (s != null) { h = clamp(s - y, MIN, 100 - y); g.push({ axis: 'h', pos: s }); } }
      if (d.handle.includes('w')) { let nx = clamp(x + dx, 0, x + w - MIN); const s = snapVal(nx, d.vT); if (s != null) { nx = clamp(s, 0, x + w - MIN); g.push({ axis: 'v', pos: nx }); } w += x - nx; x = nx; }
      if (d.handle.includes('n')) { let ny = clamp(y + dy, 0, y + h - MIN); const s = snapVal(ny, d.hT); if (s != null) { ny = clamp(s, 0, y + h - MIN); g.push({ axis: 'h', pos: ny }); } h += y - ny; y = ny; }
    }
    const r = (n) => Math.round(n * 10) / 10;
    setGuides(g);
    patchEl(d.id, { x: r(x), y: r(y), w: r(w), h: r(h) });
  };
  const onPointerUp = () => {
    dragRef.current = null;
    setGuides([]);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  const addElement = (type) => {
    const def = ELEMENT_CATALOG[type].defaults;
    const w = def.w, h = def.h;
    const newEl = { id: newId(), type, x: Math.round((100 - w) / 2), y: Math.round((100 - h) / 2), w, h, ...def };
    setElements([...elements, newEl]);
    setSel(newEl.id);
    setAddOpen(false);
  };
  const removeEl = (id) => { setElements(elements.filter((e) => e.id !== id)); if (sel === id) setSel(null); };
  const applyTemplate = (tpl) => { const next = tpl.make(); onChange({ ...value, elements: next.elements }); setSel(null); };

  return (
    <div className="flex-1 min-h-0 flex gap-md overflow-hidden">
      {/* Canvas + palette */}
      <div className="flex-1 min-w-0 flex flex-col gap-sm overflow-hidden">
        <div className="flex items-center gap-sm shrink-0 flex-wrap">
          <div className="relative" ref={addRef}>
            <button onClick={() => setAddOpen((v) => !v)}
              className="flex items-center gap-xs h-9 px-md rounded-lg text-label-sm font-label-sm font-bold uppercase tracking-[0.03em] bg-primary text-on-primary hover:brightness-110 active:scale-95 transition-all cursor-pointer">
              <span className="material-symbols-outlined text-[16px]">add</span>Add Element
            </button>
            {addOpen && (
              <div className="absolute z-30 mt-xs w-56 bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl py-xs">
                {TYPE_ORDER.map((t) => (
                  <button key={t} onClick={() => addElement(t)}
                    className="w-full flex items-center gap-sm px-md h-9 text-left text-body-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest cursor-pointer">
                    <span className="material-symbols-outlined text-[16px]">{ELEMENT_CATALOG[t].icon}</span>{ELEMENT_CATALOG[t].label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="w-px h-6 bg-outline-variant/40" />
          {/* Ready-made starting layouts */}
          {TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => applyTemplate(t)} title={`Apply “${t.name}” layout`}
              className="flex items-center gap-xs h-8 px-sm rounded-lg text-label-sm font-label-sm font-bold uppercase tracking-[0.03em] bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant/60 cursor-pointer transition-all active:scale-95">
              <span className="material-symbols-outlined text-[15px]">{t.icon}</span>{t.name}
            </button>
          ))}
        </div>

        {/* Fit area — sizes the 16:9 canvas to the largest box that fits (keeps the whole
            frame, incl. the bottom row, on screen). */}
        <div ref={fitRef} className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
          <div ref={canvasRef} className="relative bg-[#0c0e12] rounded-lg overflow-hidden border border-outline-variant/40 select-none"
            style={{ width: box.w || '100%', height: box.h || undefined, aspectRatio: box.w ? undefined : '16 / 9' }}
            onPointerDown={() => setSel(null)}>
            {/* faint thirds grid */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.06]" style={{ backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)', backgroundSize: '33.333% 33.333%' }} />
            {elements.map((el, i) => (
              <ElementBox key={el.id} el={el} z={i + 1} selected={sel === el.id} clock={clock}
                onSelect={() => setSel(el.id)} onPointerDown={onPointerDown} />
            ))}
            {/* Alignment guides (only while dragging) */}
            {guides.map((g, i) => g.axis === 'v'
              ? <div key={i} className="absolute top-0 bottom-0 bg-primary pointer-events-none" style={{ left: `calc(${g.pos}% - 0.5px)`, width: 1, zIndex: 150 }} />
              : <div key={i} className="absolute left-0 right-0 bg-primary pointer-events-none" style={{ top: `calc(${g.pos}% - 0.5px)`, height: 1, zIndex: 150 }} />)}
            {elements.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-on-surface-variant/40 text-label-sm uppercase tracking-widest">No elements — add one or pick a layout</div>
            )}
          </div>
        </div>
      </div>

      {/* Inspector */}
      <div className="w-[280px] shrink-0 border-l border-outline-variant/30 pl-md overflow-y-auto custom-scrollbar">
        {!selEl ? (
          <p className="text-body-sm text-on-surface-variant/60 mt-sm">Select an element to edit its position and appearance, or add one.</p>
        ) : (
          <Inspector el={selEl} patch={(p) => patchEl(selEl.id, p)} onRemove={() => removeEl(selEl.id)} />
        )}
      </div>
    </div>
  );
}

// ── Canvas element box (drag/resize + WYSIWYG content) ────────────────────────
function ElementBox({ el, z, selected, clock, onSelect, onPointerDown }) {
  const handles = ['nw', 'ne', 'sw', 'se'];
  const hPos = {
    nw: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
    ne: 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
    sw: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
    se: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
  };
  return (
    <div
      className={`absolute border ${selected ? 'border-primary' : 'border-white/20 hover:border-white/40'}`}
      style={{ left: el.x + '%', top: el.y + '%', width: el.w + '%', height: el.h + '%', zIndex: z + (selected ? 100 : 0), containerType: 'size' }}
      onPointerDown={(e) => onPointerDown(e, el.id, 'move')}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      <ElementContent el={el} clock={clock} />
      {selected && handles.map((h) => (
        <div key={h} onPointerDown={(e) => onPointerDown(e, el.id, h)} className={`absolute w-3 h-3 rounded-sm bg-primary border border-white/80 ${hPos[h]}`} style={{ zIndex: 200 }} />
      ))}
    </div>
  );
}

// flex justify value for an element's horizontal alignment.
const justify = (a) => (a === 'left' ? 'flex-start' : a === 'right' ? 'flex-end' : 'center');

// A faithful (approximate) stand-in for how the element renders on the stage output.
function ElementContent({ el, clock }) {
  const bar = (label, value, valColor) => (
    <div className="w-full h-full flex flex-col justify-center gap-[2px] bg-[#1a1c20] overflow-hidden px-1" style={{ alignItems: justify(el.align) }}>
      {label && <div className="text-[8px] font-medium uppercase tracking-[0.2em] text-[#424754] truncate max-w-full">{label}</div>}
      <div className="font-bold tabular-nums leading-none" style={{ color: valColor, fontSize: (el.fit ?? 'auto') !== 'auto' ? `${el.fontPx}px` : 'clamp(10px,4cqw,40px)' }}>{value}</div>
    </div>
  );
  switch (el.type) {
    case 'clock':          return bar(el.label, el.hour12 === false ? '13:45' + (el.showSeconds === false ? '' : ':00') : '01:45' + (el.showSeconds === false ? '' : ':00') + ' PM', '#adc6ff');
    case 'timer':          return (
      <div className="w-full h-full flex flex-col justify-center gap-[2px] bg-[#1a1c20] px-1" style={{ alignItems: justify(el.align) }}>
        {el.label && <div className="text-[8px] font-medium uppercase tracking-[0.2em] text-[#424754] truncate">{el.label}</div>}
        <div className="font-bold tabular-nums leading-none text-[#c2c6d6]" style={{ fontSize: (el.fit ?? 'auto') !== 'auto' ? `${el.fontPx}px` : 'clamp(10px,4cqw,40px)' }}>05:00</div>
        {el.showBar !== false && <div className="w-[65%] h-[3px] rounded-full bg-white/10 overflow-hidden"><div className="h-full w-[60%] bg-[#a40217]" /></div>}
      </div>
    );
    case 'elapsedTimer':   return bar(el.label, '02:30', '#c2c6d6');
    case 'videoCountdown': return bar(el.label, '--:--', '#4ae176');
    case 'message':        return (
      <div className="w-full h-full flex items-center bg-[#1a1c20] px-2" style={{ justifyContent: justify(el.align) }}>
        <span className="text-[8px] font-medium uppercase tracking-[0.14em] text-white/25">No Messages</span>
      </div>
    );
    case 'currentText':    return (
      <div className="w-full h-full relative flex items-center justify-center bg-[#0c0e12] overflow-hidden px-2">
        {el.showRef !== false && <div className="absolute top-1 left-0 right-0 text-center text-[9px] font-semibold text-[#adc6ff] truncate px-2">John 3:16 (NIV)</div>}
        <div className="w-full font-bold leading-tight" style={{ color: el.color || '#fff', textAlign: el.align || 'center', fontSize: 'clamp(12px, 9cqw, 90px)' }}>Current slide text</div>
      </div>
    );
    case 'nextText':       return (
      <div className="w-full h-full flex items-baseline gap-2 bg-[#0c0e12] px-2 overflow-hidden">
        {el.label && <span className="text-[8px] font-medium uppercase tracking-[0.18em] text-[#4d8eff] whitespace-nowrap shrink-0">{el.label}</span>}
        <span className="flex-1 min-w-0" style={{ color: el.color || 'rgba(255,255,255,0.4)', textAlign: el.align || 'left', fontSize: (el.fit ?? 'auto') !== 'auto' ? `${el.fontPx}px` : 'clamp(9px,2.5cqw,26px)' }}>Next slide preview…</span>
      </div>
    );
    case 'staticText':     return (
      <div className="w-full h-full flex items-center overflow-hidden px-1" style={{ justifyContent: el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center', color: el.color || '#e2e2e8', textAlign: el.align || 'center', fontSize: (el.fit ?? 'auto') !== 'auto' ? `${el.fontPx}px` : 'clamp(10px, 3cqw, 36px)', fontWeight: 600 }}>
        {el.text || 'Label'}
      </div>
    );
    default: return null;
  }
}

// ── Inspector (type-specific controls) ────────────────────────────────────────
function Inspector({ el, patch, onRemove }) {
  const meta = ELEMENT_CATALOG[el.type] || { label: el.type, icon: 'widgets' };
  const numField = (k) => (
    <label key={k} className="flex flex-col items-center">
      <span className="text-[9px] uppercase text-on-surface-variant/50">{k}</span>
      <input type="number" value={Math.round(el[k])} min={0} max={100}
        onChange={(e) => { const v = clamp(Number(e.target.value) || 0, 0, 100); const lim = (k === 'w') ? Math.min(v, 100 - el.x) : (k === 'h') ? Math.min(v, 100 - el.y) : (k === 'x') ? Math.min(v, 100 - el.w) : Math.min(v, 100 - el.h); patch({ [k]: lim }); }}
        className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-[2px] py-[2px] text-[11px] text-center tabular-nums text-on-surface outline-none focus:border-primary" />
    </label>
  );
  return (
    <div className="space-y-md pt-sm">
      <div className="flex items-center gap-xs">
        <span className="material-symbols-outlined text-[18px] text-primary">{meta.icon}</span>
        <span className="text-label-md font-label-md font-bold uppercase tracking-[0.04em] flex-1">{meta.label}</span>
        <button onClick={onRemove} title="Remove element" className="text-error/80 hover:text-error cursor-pointer">
          <span className="material-symbols-outlined text-[18px]">delete</span>
        </button>
      </div>

      <div>
        <p className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline mb-xs">Position &amp; size (%)</p>
        <div className="grid grid-cols-4 gap-[4px]">{['x', 'y', 'w', 'h'].map(numField)}</div>
      </div>

      <TypeControls el={el} patch={patch} />
    </div>
  );
}

const ALIGNS = [['left', 'format_align_left'], ['center', 'format_align_center'], ['right', 'format_align_right']];

function TypeControls({ el, patch }) {
  const Row = ({ children }) => <div className="flex items-center gap-sm">{children}</div>;
  const Label = ({ children }) => <span className="text-body-sm text-on-surface-variant flex-1">{children}</span>;
  const textInput = (key, placeholder) => (
    <input value={el[key] ?? ''} placeholder={placeholder} onChange={(e) => patch({ [key]: e.target.value })}
      className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-sm text-on-surface outline-none focus:border-primary" />
  );
  const colorInput = (key) => (
    <input type="color" value={toHex(el[key])} onChange={(e) => patch({ [key]: e.target.value })}
      className="w-8 h-7 bg-transparent border border-outline-variant/30 rounded cursor-pointer" />
  );
  const numInput = (key) => (
    <input type="number" value={Number(el[key]) || 0} min={6} max={400} onChange={(e) => patch({ [key]: clamp(Number(e.target.value) || 0, 6, 400) })}
      className="w-16 bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[4px] text-body-sm text-center tabular-nums text-on-surface outline-none focus:border-primary" />
  );
  const toggle = (key, label, def = false) => (
    <label className="flex items-center gap-sm cursor-pointer select-none">
      <input type="checkbox" checked={el[key] ?? def} onChange={(e) => patch({ [key]: e.target.checked })} className="accent-primary w-4 h-4 cursor-pointer" />
      <span className="text-body-sm text-on-surface">{label}</span>
    </label>
  );
  const alignToggle = () => (
    <Row><Label>Align</Label>
      <div className="flex bg-surface-container-lowest border border-outline-variant/40 rounded overflow-hidden">
        {ALIGNS.map(([id, icon]) => (
          <button key={id} onClick={() => patch({ align: id })} className={`px-sm h-7 cursor-pointer ${((el.align || 'center') === id) ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>
            <span className="material-symbols-outlined text-[15px]">{icon}</span>
          </button>
        ))}
      </div>
    </Row>
  );
  const labelField = () => (
    <label className="block"><span className="text-body-sm text-on-surface-variant">Label</span>{textInput('label', 'Caption')}</label>
  );

  const fitToggle = () => (<>
    <Row><Label>Auto-fit text</Label>
      <input type="checkbox" checked={(el.fit ?? 'auto') === 'auto'}
        onChange={(e) => patch({ fit: e.target.checked ? 'auto' : 'fixed' })}
        className="accent-primary w-4 h-4 cursor-pointer" />
    </Row>
    {(el.fit ?? 'auto') !== 'auto' && <Row><Label>Font size (px)</Label>{numInput('fontPx')}</Row>}
  </>);

  // Type-specific controls below the universal Align (rendered once, for every element).
  const extras = () => {
    switch (el.type) {
      case 'currentText': return (<>
        <Row><Label>Colour</Label>{colorInput('color')}</Row>
        {fitToggle()}
        {toggle('showRef', 'Show scripture reference', true)}
      </>);
      case 'nextText': return (<>
        {labelField()}
        <Row><Label>Colour</Label>{colorInput('color')}</Row>
        {fitToggle()}
      </>);
      case 'clock': return (<>
        {labelField()}
        {fitToggle()}
        {toggle('hour12', '12-hour clock', true)}
        {toggle('showSeconds', 'Show seconds', true)}
      </>);
      case 'timer': return (<>
        {labelField()}
        {fitToggle()}
        {toggle('showBar', 'Show progress bar', true)}
      </>);
      case 'elapsedTimer':
      case 'videoCountdown': return (<>
        {labelField()}
        {fitToggle()}
      </>);
      case 'message': return (
        <Row><Label>Font size (px)</Label>{numInput('fontPx')}</Row>
      );
      case 'staticText': return (<>
        <label className="block"><span className="text-body-sm text-on-surface-variant">Text</span>{textInput('text', 'Label')}</label>
        <Row><Label>Colour</Label>{colorInput('color')}</Row>
        {fitToggle()}
      </>);
      default: return null;
    }
  };
  return (<div className="space-y-sm">{alignToggle()}{extras()}</div>);
}

// Coerce any CSS colour (incl. rgba) to a #rrggbb the native colour input accepts.
function toHex(c) {
  if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return c;
  const m = typeof c === 'string' && c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(',').map((n) => clamp(parseInt(n, 10) || 0, 0, 255));
    return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  return '#ffffff';
}
