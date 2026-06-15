import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FormattingToolbar } from './SongEditor';
import MediaPickerModal from './MediaPickerModal';
import { useFonts } from '../utils/fonts';
import { mediaUrl } from '../utils/mediaUrl';
import { StaticSlide } from './SlideElements';
import { PRES_LAYOUTS, PLAIN_THEME, buildThemeSlide, reskinSlide, detectThemeId } from '../utils/presentationThemes';

const NATIVE_W = 1920;
const NATIVE_H = 1080;
let _eid = 0;
const newId = () => `el_${Date.now()}_${_eid++}`;

// ── Element factories ────────────────────────────────────────────────────────
function newTextElement() {
  return { id: newId(), type: 'text', x: 15, y: 38, w: 70, h: 24, rotation: 0, opacity: 1, z: 1,
    text: 'New text', style: { align: 'center', verticalAlign: 'center', color: '#ffffff', fontSize: 72 } };
}
function newImageElement(asset) {
  return { id: newId(), type: 'image', x: 30, y: 25, w: 40, h: 50, rotation: 0, opacity: 1, z: 1,
    mediaId: asset.id, path: asset.path, mediaType: asset.type, fit: 'contain' };
}
function newShapeElement(shape) {
  if (shape === 'line') return { id: newId(), type: 'shape', shape: 'line', x: 20, y: 50, w: 60, h: 1, rotation: 0, opacity: 1, z: 0, stroke: { color: '#ffffff', width: 4 } };
  return { id: newId(), type: 'shape', shape, x: 35, y: 35, w: 30, h: 30, rotation: 0, opacity: 1, z: 0, fill: '#4d8eff', stroke: { color: '', width: 0 }, radius: shape === 'rect' ? 8 : 0 };
}

// ── Static element renderer (parallel to fullscreen.js renderElements + the
// monitor's PresentationCanvas — the editor keeps its own copy by design). ──────
function elementInner(el) {
  if (el.type === 'text') {
    const s = el.style || {};
    const shadow = s.textShadow;
    const shadowCss = shadow
      ? (shadow.enabled ? `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}` : 'none')
      : '0 2px 16px rgba(0,0,0,0.8)';
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: s.verticalAlign === 'top' ? 'flex-start' : s.verticalAlign === 'bottom' ? 'flex-end' : 'center' }}>
        <div style={{ width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontFamily: s.fontFamily || undefined,
          fontSize: (s.fontSize ?? 48) + 'px',
          textAlign: s.align || 'center',
          fontWeight: s.bold ? 700 : 400,
          fontStyle: s.italic ? 'italic' : 'normal',
          textDecoration: s.underline ? 'underline' : 'none',
          textTransform: s.uppercase ? 'uppercase' : 'none',
          color: s.color || '#ffffff',
          lineHeight: s.lineSpacing ? String(s.lineSpacing) : '1.25',
          letterSpacing: s.letterSpacing ? `${s.letterSpacing}em` : undefined,
          textShadow: shadowCss,
          WebkitTextStroke: s.textStroke?.enabled ? `${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}` : undefined,
        }}>{el.text}</div>
      </div>
    );
  }
  if (el.type === 'image' && el.path) {
    const fit = el.fit === 'cover' ? 'cover' : 'contain';
    const isVideo = el.mediaType === 'video' || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(el.path);
    return isVideo
      ? <video src={mediaUrl(el.path)} style={{ width: '100%', height: '100%', objectFit: fit }} autoPlay loop muted />
      : <img src={mediaUrl(el.path)} style={{ width: '100%', height: '100%', objectFit: fit }} alt="" />;
  }
  if (el.type === 'shape') {
    const stroke = el.stroke || {};
    const shapeStyle = el.shape === 'line'
      ? { background: stroke.color || el.fill || '#fff' }
      : { background: el.fill || 'transparent',
          border: (stroke.color && stroke.width) ? `${stroke.width}px solid ${stroke.color}` : undefined,
          borderRadius: el.shape === 'ellipse' ? '50%' : (el.radius ? `${el.radius}px` : undefined) };
    return <div style={{ width: '100%', height: '100%', ...shapeStyle }} />;
  }
  return null;
}

const HANDLES = [
  { k: 'nw', cx: 0, cy: 0 }, { k: 'ne', cx: 1, cy: 0 },
  { k: 'sw', cx: 0, cy: 1 }, { k: 'se', cx: 1, cy: 1 },
];

// One interactive element on the canvas: click to select, drag body to move,
// corner handles to resize. Positions are % of the 1920×1080 canvas.
function EditableElement({ el, selected, scale, canvasRef, onSelect, onChange }) {
  const drag = useRef(null);

  const onPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    const cw = canvasRef.current?.offsetWidth || 1;
    const ch = canvasRef.current?.offsetHeight || 1;
    const dxPct = ((e.clientX - d.startX) / cw) * 100;
    const dyPct = ((e.clientY - d.startY) / ch) * 100;
    if (d.mode === 'move') {
      onChange({ ...el, x: clamp(d.x0 + dxPct, -50, 100), y: clamp(d.y0 + dyPct, -50, 100) });
    } else {
      let { x0, y0, w0, h0 } = d;
      let x = x0, y = y0, w = w0, h = h0;
      if (d.mode.includes('e')) w = Math.max(2, w0 + dxPct);
      if (d.mode.includes('s')) h = Math.max(1, h0 + dyPct);
      if (d.mode.includes('w')) { w = Math.max(2, w0 - dxPct); x = x0 + dxPct; }
      if (d.mode.includes('n')) { h = Math.max(1, h0 - dyPct); y = y0 + dyPct; }
      onChange({ ...el, x, y, w, h });
    }
  }, [el, onChange, canvasRef]);

  const endDrag = useCallback(() => {
    drag.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onPointerMove]);

  function startDrag(e, mode) {
    e.stopPropagation();
    onSelect();
    drag.current = { mode, startX: e.clientX, startY: e.clientY, x0: el.x, y0: el.y, w0: el.w, h0: el.h };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  }

  return (
    <div
      onPointerDown={(e) => startDrag(e, 'move')}
      style={{
        position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        opacity: el.opacity != null ? el.opacity : 1, zIndex: el.z != null ? el.z : 0,
        cursor: 'move', outline: selected ? `${2 / scale}px solid #4d8eff` : `${1 / scale}px dashed rgba(255,255,255,0.35)`,
        outlineOffset: 0, boxSizing: 'border-box',
      }}
    >
      <div style={{ width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden' }}>{elementInner(el)}</div>
      {selected && HANDLES.map((h) => (
        <div key={h.k}
          onPointerDown={(e) => startDrag(e, h.k)}
          style={{ position: 'absolute', left: `calc(${h.cx * 100}% - ${6 / scale}px)`, top: `calc(${h.cy * 100}% - ${6 / scale}px)`,
            width: 12 / scale, height: 12 / scale, background: '#4d8eff', border: `${2 / scale}px solid #fff`, borderRadius: 2 / scale,
            cursor: `${h.k}-resize` }} />
      ))}
    </div>
  );
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

// ── Slide sidebar thumbnail (sortable) ───────────────────────────────────────
function SlideThumb({ slide, idx, active, onClick, onContext }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide._key });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const bg = slide.background_path;
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      onClick={onClick} onContextMenu={onContext}
      className={`shrink-0 rounded border cursor-pointer overflow-hidden transition-all ${active ? 'border-primary ring-1 ring-primary/40' : 'border-outline-variant/30 hover:border-outline-variant/60'}`}>
      <div className="flex items-stretch">
        <div className="w-6 flex items-center justify-center text-[10px] font-label-sm text-on-surface-variant bg-surface-container-high">{idx + 1}</div>
        <div className="relative bg-black" style={{ width: 132, height: 132 * (NATIVE_H / NATIVE_W) }}>
          {bg && <img src={mediaUrl(bg)} className="absolute inset-0 w-full h-full object-cover" alt="" />}
          <div className="absolute inset-0" style={{ transform: `scale(${132 / NATIVE_W})`, transformOrigin: 'top left', width: NATIVE_W, height: NATIVE_H }}>
            {[...(slide.elements || [])].sort((a, b) => (a.z || 0) - (b.z || 0)).map((el) => (
              <div key={el.id} style={{ position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
                transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, opacity: el.opacity ?? 1, overflow: 'hidden' }}>
                {elementInner(el)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PresentationEditor({ presentationId, onClose, onSave }) {
  const fonts = useFonts();
  const [title, setTitle] = useState('Untitled Presentation');
  const [slides, setSlides] = useState([{ _key: newId(), label: null, background_id: null, background_path: null, elements: [] }]);
  const [cur, setCur] = useState(0);
  const [selId, setSelId] = useState(null);
  const [picker, setPicker] = useState(null); // 'element' | 'background'
  const [ctxMenu, setCtxMenu] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newSlideOpen, setNewSlideOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const canvasRef = useRef(null);
  const [scale, setScale] = useState(0.4);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!presentationId) return;
    window.cue.presentations.get(presentationId).then((p) => {
      if (!p) return;
      setTitle(p.title);
      setSlides((p.slides && p.slides.length ? p.slides : [{ elements: [] }]).map((s) => ({
        _key: newId(), label: s.label || null, background_id: s.background_id || null,
        background_path: s.background_path || null, elements: s.elements || [],
      })));
    });
  }, [presentationId]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const update = () => { if (canvasRef.current) setScale(canvasRef.current.offsetWidth / NATIVE_W); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  const slide = slides[cur];
  const selected = slide?.elements.find((e) => e.id === selId) || null;

  function patchSlide(patch) {
    setSlides((arr) => arr.map((s, i) => (i === cur ? { ...s, ...patch } : s)));
  }
  function patchElement(next) {
    patchSlide({ elements: slide.elements.map((e) => (e.id === next.id ? next : e)) });
  }
  function addElement(el) {
    patchSlide({ elements: [...slide.elements, el] });
    setSelId(el.id);
  }
  function deleteSelected() {
    if (!selected) return;
    patchSlide({ elements: slide.elements.filter((e) => e.id !== selected.id) });
    setSelId(null);
  }
  function bringToFront() {
    if (!selected) return;
    const maxZ = Math.max(0, ...slide.elements.map((e) => e.z || 0));
    patchElement({ ...selected, z: maxZ + 1 });
  }
  function sendToBack() {
    if (!selected) return;
    const minZ = Math.min(0, ...slide.elements.map((e) => e.z || 0));
    patchElement({ ...selected, z: minZ - 1 });
  }

  // Add a slide composed from a theme × layout (buildThemeSlide bakes the theme's
  // background as a full-bleed gradient shape — fully offline — and tags each element
  // with its role so the deck can be re-skinned later). PLAIN_THEME = "No theme".
  function addThemedSlide(tokens, layoutId) {
    const elements = buildThemeSlide(tokens, layoutId);
    setSlides((arr) => [...arr, { _key: newId(), label: null, background_id: null, background_path: null, elements }]);
    setCur(slides.length);
    setSelId(null);
    setNewSlideOpen(false);
  }
  // Re-skin existing slides with a theme: this slide, or the whole deck.
  function applyTheme(tokens, scope) {
    if (scope === 'all') setSlides((arr) => arr.map((s) => ({ ...s, elements: reskinSlide(tokens, s.elements) })));
    else patchSlide({ elements: reskinSlide(tokens, slide.elements) });
    setApplyOpen(false);
  }
  function duplicateSlide(i) {
    const src = slides[i];
    const copy = { ...src, _key: newId(), elements: src.elements.map((e) => ({ ...e, id: newId() })) };
    setSlides((arr) => [...arr.slice(0, i + 1), copy, ...arr.slice(i + 1)]);
    setCur(i + 1);
  }
  function deleteSlide(i) {
    if (slides.length === 1) { patchSlideAt(i, { elements: [], background_id: null, background_path: null }); return; }
    setSlides((arr) => arr.filter((_, idx) => idx !== i));
    setCur((c) => Math.max(0, c >= i ? c - 1 : c));
  }
  function patchSlideAt(i, patch) { setSlides((arr) => arr.map((s, idx) => (idx === i ? { ...s, ...patch } : s))); }

  function handleSlideDragEnd(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oi = slides.findIndex((s) => s._key === active.id);
    const ni = slides.findIndex((s) => s._key === over.id);
    setSlides((arr) => arrayMove(arr, oi, ni));
    setCur(ni);
  }

  function onPickMedia(asset) {
    if (picker === 'element') addElement(newImageElement(asset));
    else if (picker === 'background') patchSlide({ background_id: asset.id, background_path: asset.path });
    setPicker(null);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        title,
        slides: slides.map((s) => ({ label: s.label, background_id: s.background_id, elements: s.elements })),
      };
      if (presentationId) await window.cue.presentations.update(presentationId, payload);
      else await window.cue.presentations.create(payload);
      onSave?.();
    } finally { setSaving(false); }
  }

  // Esc closes; Delete removes selected element (unless typing).
  useEffect(() => {
    const onKey = (e) => {
      const t = document.activeElement?.tagName;
      const typing = t === 'INPUT' || t === 'TEXTAREA' || document.activeElement?.isContentEditable;
      if (e.key === 'Escape') { if (!picker) onClose(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !typing) { e.preventDefault(); deleteSelected(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex flex-col">
      {/* Header — two rows. Row 1 is a draggable titlebar strip that clears the
          macOS traffic lights; the action buttons are nodrag so they stay clickable.
          The title input lives in row 2, below the traffic-light zone. */}
      <div className="shrink-0 bg-surface-container-high border-b border-outline-variant/30">
        <div className="titlebar-drag flex items-center justify-end gap-sm h-10 px-lg">
          <div className="titlebar-nodrag flex items-center gap-sm">
            <button onClick={onClose} className="px-md py-xs rounded text-label-sm font-label-sm text-on-surface-variant hover:bg-surface-variant transition-colors">Cancel</button>
            <button onClick={save} disabled={saving}
              className="bg-tertiary-container text-on-tertiary px-lg py-xs rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-md px-lg pb-sm">
          <span className="material-symbols-outlined text-primary">slideshow</span>
          <input
            className="bg-surface-container-lowest border border-outline-variant/50 rounded-lg px-md py-xs text-on-surface text-body-md focus:outline-none focus:border-primary w-80"
            value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Presentation title" />
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Slide sidebar */}
        <div className="w-44 shrink-0 border-r border-outline-variant/30 bg-surface-container-low flex flex-col">
          <div className="flex-1 overflow-y-auto p-sm flex flex-col gap-sm">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSlideDragEnd}>
              <SortableContext items={slides.map((s) => s._key)} strategy={verticalListSortingStrategy}>
                {slides.map((s, i) => (
                  <SlideThumb key={s._key} slide={s} idx={i} active={i === cur}
                    onClick={() => { setCur(i); setSelId(null); }}
                    onContext={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, i }); }} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          <div className="m-sm">
            <button onClick={() => setNewSlideOpen(true)}
              className="w-full bg-surface-container border border-outline-variant/40 text-on-surface px-md py-xs rounded text-label-sm font-label-sm hover:bg-surface-container-high transition-colors flex items-center justify-center gap-xs">
              <span className="material-symbols-outlined text-[14px]">add</span> Slide
            </button>
          </div>
        </div>

        {/* Canvas + add toolbar */}
        <div className="flex-1 min-w-0 flex flex-col bg-background">
          <div className="flex items-center gap-xs px-md h-11 border-b border-outline-variant/30 bg-surface-container-low shrink-0">
            <AddBtn icon="title" label="Text" onClick={() => addElement(newTextElement())} />
            <AddBtn icon="image" label="Image" onClick={() => setPicker('element')} />
            <AddBtn icon="rectangle" label="Rect" onClick={() => addElement(newShapeElement('rect'))} />
            <AddBtn icon="circle" label="Ellipse" onClick={() => addElement(newShapeElement('ellipse'))} />
            <AddBtn icon="horizontal_rule" label="Line" onClick={() => addElement(newShapeElement('line'))} />
            <div className="w-px h-5 bg-outline-variant/40 mx-xs" />
            <AddBtn icon="wallpaper" label="Background" onClick={() => setPicker('background')} />
            {slide?.background_path && <AddBtn icon="hide_image" label="Clear BG" onClick={() => patchSlide({ background_id: null, background_path: null })} />}
            <div className="ml-auto" />
            <AddBtn icon="palette" label="Apply Theme" onClick={() => setApplyOpen(true)} />
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-lg overflow-hidden">
            <div ref={canvasRef} onPointerDown={() => setSelId(null)}
              className="relative bg-black shadow-2xl ring-1 ring-white/10 overflow-hidden"
              style={{ width: '100%', maxWidth: 'min(100%, calc((100vh - 200px) * 16 / 9))', aspectRatio: '16 / 9' }}>
              {slide?.background_path && <img src={mediaUrl(slide.background_path)} className="absolute inset-0 w-full h-full object-cover pointer-events-none" alt="" />}
              {/* Fixed 1920×1080 stage scaled to fit — keeps px font sizes WYSIWYG with
                  the live output (#slide-elements) + the operator monitor. */}
              <div style={{ position: 'absolute', top: 0, left: 0, width: NATIVE_W, height: NATIVE_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                {slide && [...slide.elements].sort((a, b) => (a.z || 0) - (b.z || 0)).map((el) => (
                  <EditableElement key={el.id} el={el} selected={el.id === selId} scale={scale} canvasRef={canvasRef}
                    onSelect={() => setSelId(el.id)} onChange={patchElement} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Inspector */}
        <div className="w-80 shrink-0 border-l border-outline-variant/30 bg-surface-container-low overflow-y-auto">
          {selected ? (
            <Inspector el={selected} fonts={fonts} onChange={patchElement} onDelete={deleteSelected}
              onFront={bringToFront} onBack={sendToBack} onReplaceImage={() => setPicker('element')} />
          ) : (
            <div className="p-md text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">
              Select an element to edit · {slide?.elements.length || 0} element(s)
            </div>
          )}
        </div>
      </div>

      {newSlideOpen && <NewSlideModal currentElements={slide?.elements} onAdd={addThemedSlide} onClose={() => setNewSlideOpen(false)} />}
      {applyOpen && <ApplyThemeModal hasSlide={!!slide} onApply={applyTheme} onClose={() => setApplyOpen(false)} />}
      {picker && <MediaPickerModal onSelect={onPickMedia} onClose={() => setPicker(null)} />}
      {ctxMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setCtxMenu(null)} />
          <div className="fixed z-[61] bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl py-xs text-label-sm font-label-sm min-w-36"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <MenuItem onClick={() => { duplicateSlide(ctxMenu.i); setCtxMenu(null); }}>Duplicate Slide</MenuItem>
            <MenuItem danger onClick={() => { deleteSlide(ctxMenu.i); setCtxMenu(null); }}>Delete Slide</MenuItem>
          </div>
        </>, document.body)}
    </div>,
    document.body
  );
}

function AddBtn({ icon, label, onClick }) {
  return (
    <button onClick={onClick} title={label}
      className="flex items-center gap-xs px-sm py-1 rounded text-label-sm font-label-sm text-on-surface-variant hover:bg-surface-variant hover:text-on-surface transition-colors">
      <span className="material-symbols-outlined text-[16px]">{icon}</span>{label}
    </button>
  );
}
function MenuItem({ children, onClick, danger }) {
  return <button onClick={onClick} className={`block w-full text-left px-md py-xs hover:bg-surface-variant transition-colors ${danger ? 'text-error' : 'text-on-surface'}`}>{children}</button>;
}

// Load built-in presentation themes (themes table, category 'presentation') and
// parse their token style_json. Returns [{ id, name, tokens }].
function usePresentationThemes() {
  const [themes, setThemes] = useState([]);
  useEffect(() => {
    window.cue.themes.list().then((list) => {
      const out = [];
      for (const t of (list || [])) {
        if ((t.category || 'song') !== 'presentation') continue;
        let tokens = null;
        try { tokens = typeof t.style_json === 'string' ? JSON.parse(t.style_json) : t.style_json; } catch {}
        if (tokens) out.push({ id: t.id, name: t.name, tokens });
      }
      setThemes(out);
    }).catch(() => {});
  }, []);
  return themes;
}

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

// New-slide modal: pick a theme (left rail, incl. "No theme") → see it across every
// layout as tiles (right) → click a theme×layout tile to add that slide. Defaults the
// selected theme to the deck's current one (detected from the active slide) so adding
// slides stays within the chosen theme pack — the rail still lets you switch.
function NewSlideModal({ currentElements, onAdd, onClose }) {
  const themes = usePresentationThemes();
  const [query, setQuery] = useState('');
  const [selId, setSelId] = useState('__plain');
  const seeded = useRef(false);
  useEscape(onClose);

  // Once themes load, default the selection to the deck's current theme (one-shot, so
  // it doesn't fight the user's own rail clicks afterward).
  useEffect(() => {
    if (seeded.current || !themes.length) return;
    seeded.current = true;
    const id = detectThemeId(currentElements, themes);
    if (id) setSelId(id);
  }, [themes, currentElements]);

  const all = [{ id: '__plain', name: 'No theme', tokens: PLAIN_THEME }, ...themes];
  const q = query.trim().toLowerCase();
  const list = q ? all.filter((t) => t.name.toLowerCase().includes(q)) : all;
  const sel = all.find((t) => t.id === selId) || all[0];

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-background/90 flex flex-col" onMouseDown={onClose}>
      <div className="flex-1 min-h-0 flex flex-col m-lg bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0 gap-md">
          <h3 className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em] flex items-center gap-sm shrink-0">
            <span className="material-symbols-outlined text-primary text-[20px]">grid_view</span>New slide
          </h3>
          <div className="flex-1 max-w-sm relative">
            <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant/60 text-[18px]">search</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="Search themes…"
              className="w-full pl-[34px] pr-sm py-xs text-body-sm bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary/50" />
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface cursor-pointer flex items-center shrink-0">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 min-h-0 flex">
          {/* Theme rail */}
          <div className="w-60 shrink-0 border-r border-outline-variant/30 overflow-y-auto custom-scrollbar p-sm flex flex-col gap-xs">
            {list.map((t) => (
              <button key={t.id} onClick={() => setSelId(t.id)}
                className={`flex items-center gap-sm p-xs rounded-lg border text-left transition-colors ${t.id === selId ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-surface-variant'}`}>
                <div className="w-24 shrink-0"><StaticSlide elements={buildThemeSlide(t.tokens, 'title')} /></div>
                <span className="text-label-sm font-mono text-on-surface truncate min-w-0">{t.name}</span>
              </button>
            ))}
          </div>
          {/* Layout tiles for the selected theme */}
          <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-lg">
            <p className="text-[10px] font-label-sm uppercase tracking-widest text-on-surface-variant/60 mb-sm">{sel?.name} · pick a layout</p>
            <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {PRES_LAYOUTS.map((l) => (
                <div key={l.id} role="button" tabIndex={0}
                  onClick={() => onAdd(sel.tokens, l.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(sel.tokens, l.id); } }}
                  className="bg-surface-container border border-outline-variant/30 rounded-xl overflow-hidden flex flex-col cursor-pointer hover:border-primary/50 hover:ring-1 hover:ring-primary/30 active:scale-[0.99] transition-all">
                  <div className="p-sm pb-0"><StaticSlide elements={buildThemeSlide(sel.tokens, l.id)} /></div>
                  <div className="px-md py-sm"><span className="text-label-sm font-mono text-on-surface truncate">{l.name}</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Apply-theme modal: re-skin this slide or the whole deck with a theme (preserves
// content + positions; swaps background, fonts, colours by element role).
function ApplyThemeModal({ hasSlide, onApply, onClose }) {
  const themes = usePresentationThemes();
  const [scope, setScope] = useState('slide');
  useEscape(onClose);
  const choices = [{ id: '__plain', name: 'No theme', tokens: PLAIN_THEME }, ...themes];

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-background/90 flex flex-col" onMouseDown={onClose}>
      <div className="flex-1 min-h-0 flex flex-col m-lg bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0 gap-md">
          <h3 className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em] flex items-center gap-sm shrink-0">
            <span className="material-symbols-outlined text-primary text-[20px]">palette</span>Apply a theme
          </h3>
          <div className="flex items-center gap-[2px] bg-surface-container rounded-lg p-[3px]">
            {[{ id: 'slide', label: 'This slide' }, { id: 'all', label: 'All slides' }].map((s) => (
              <button key={s.id} onClick={() => setScope(s.id)} disabled={s.id === 'slide' && !hasSlide}
                className={`px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] transition-colors cursor-pointer disabled:opacity-30 ${scope === s.id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>
                {s.label}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface cursor-pointer flex items-center shrink-0">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-lg custom-scrollbar">
          <p className="text-[10px] font-label-sm uppercase tracking-widest text-on-surface-variant/60 mb-sm">
            Re-skins {scope === 'all' ? 'every slide' : 'the current slide'} — keeps your text & positions.
          </p>
          <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {choices.map((t) => (
              <div key={t.id} role="button" tabIndex={0}
                onClick={() => onApply(t.tokens, scope)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onApply(t.tokens, scope); } }}
                className="bg-surface-container border border-outline-variant/30 rounded-xl overflow-hidden flex flex-col cursor-pointer hover:border-primary/50 hover:ring-1 hover:ring-primary/30 active:scale-[0.99] transition-all">
                <div className="p-sm pb-0"><StaticSlide elements={buildThemeSlide(t.tokens, 'title-sub')} /></div>
                <div className="px-md py-sm"><span className="text-label-sm font-mono text-on-surface truncate">{t.name}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Per-type element inspector. Text reuses SongEditor's FormattingToolbar (simple
// mode, no element-box controls) plus a textarea + v-align; shapes get fill/stroke;
// images a fit toggle. Common geometry/arrange controls at the bottom.
function Inspector({ el, fonts, onChange, onDelete, onFront, onBack, onReplaceImage }) {
  const set = (k, v) => onChange({ ...el, [k]: v });
  const num = (k, v) => onChange({ ...el, [k]: v === '' ? 0 : Number(v) });
  return (
    <div className="flex flex-col">
      <div className="px-md py-sm border-b border-outline-variant/30 flex items-center gap-sm">
        <span className="material-symbols-outlined text-[16px] text-primary">{el.type === 'text' ? 'title' : el.type === 'image' ? 'image' : 'shapes'}</span>
        <span className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface">{el.type}</span>
        <button onClick={onDelete} title="Delete element" className="ml-auto text-error hover:bg-error-container/20 rounded p-1 transition-colors">
          <span className="material-symbols-outlined text-[16px]">delete</span>
        </button>
      </div>

      {el.type === 'text' && (
        <div className="p-sm flex flex-col gap-sm">
          <textarea
            className="bg-surface-container-lowest border border-outline-variant/50 rounded-lg px-sm py-xs text-on-surface text-body-md focus:outline-none focus:border-primary resize-none"
            rows={3} value={el.text || ''} onChange={(e) => set('text', e.target.value)} placeholder="Text…" />
          <div className="overflow-x-auto">
            <FormattingToolbar style={el.style || {}} onChange={(s) => set('style', s)} fonts={fonts}
              hasSelection={false} execCmd={() => {}} previewTemplate="lowerthird" simple />
          </div>
          <VAlign style={el.style || {}} onChange={(s) => set('style', s)} />
        </div>
      )}

      {el.type === 'image' && (
        <div className="p-sm flex flex-col gap-sm">
          <Row label="Fit">
            <Seg options={[['contain', 'Contain'], ['cover', 'Cover']]} value={el.fit || 'contain'} onChange={(v) => set('fit', v)} />
          </Row>
          <button onClick={onReplaceImage} className="bg-surface-container border border-outline-variant/40 text-on-surface px-md py-xs rounded text-label-sm font-label-sm hover:bg-surface-container-high transition-colors">
            Replace image…
          </button>
        </div>
      )}

      {el.type === 'shape' && el.shape !== 'line' && (
        <div className="p-sm flex flex-col gap-sm">
          <Row label="Fill"><Color value={el.fill || '#000000'} onChange={(v) => set('fill', v)} /></Row>
          <Row label="Border"><Color value={el.stroke?.color || '#000000'} onChange={(v) => set('stroke', { ...(el.stroke || {}), color: v })} /></Row>
          <Row label="Border w"><Num value={el.stroke?.width ?? 0} onChange={(v) => set('stroke', { ...(el.stroke || {}), width: Number(v) })} /></Row>
          {el.shape === 'rect' && <Row label="Radius"><Num value={el.radius ?? 0} onChange={(v) => set('radius', Number(v))} /></Row>}
        </div>
      )}
      {el.type === 'shape' && el.shape === 'line' && (
        <div className="p-sm flex flex-col gap-sm">
          <Row label="Colour"><Color value={el.stroke?.color || '#ffffff'} onChange={(v) => set('stroke', { ...(el.stroke || {}), color: v })} /></Row>
        </div>
      )}

      {/* Common geometry + arrange */}
      <div className="p-sm border-t border-outline-variant/30 flex flex-col gap-sm">
        <div className="grid grid-cols-4 gap-xs">
          <Field label="X" value={Math.round(el.x)} onChange={(v) => num('x', v)} />
          <Field label="Y" value={Math.round(el.y)} onChange={(v) => num('y', v)} />
          <Field label="W" value={Math.round(el.w)} onChange={(v) => num('w', v)} />
          <Field label="H" value={Math.round(el.h)} onChange={(v) => num('h', v)} />
        </div>
        <div className="grid grid-cols-2 gap-xs">
          <Field label="Rotate" value={el.rotation || 0} onChange={(v) => num('rotation', v)} />
          <Field label="Opacity" value={el.opacity ?? 1} step={0.05} onChange={(v) => set('opacity', clamp(Number(v || 0), 0, 1))} />
        </div>
        <div className="flex gap-xs">
          <button onClick={onBack} className="flex-1 bg-surface-container border border-outline-variant/40 text-on-surface px-sm py-xs rounded text-label-sm font-label-sm hover:bg-surface-container-high transition-colors">Send back</button>
          <button onClick={onFront} className="flex-1 bg-surface-container border border-outline-variant/40 text-on-surface px-sm py-xs rounded text-label-sm font-label-sm hover:bg-surface-container-high transition-colors">Bring front</button>
        </div>
      </div>
    </div>
  );
}

function VAlign({ style, onChange }) {
  const cur = style.verticalAlign || 'center';
  const opts = [['top', 'vertical_align_top'], ['center', 'vertical_align_center'], ['bottom', 'vertical_align_bottom']];
  return (
    <Row label="V-Align">
      <div className="flex gap-xs">
        {opts.map(([v, icon]) => (
          <button key={v} onClick={() => onChange({ ...style, verticalAlign: v })}
            className={`p-1 rounded transition-colors ${cur === v ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:bg-surface-variant'}`}>
            <span className="material-symbols-outlined text-[16px]">{icon}</span>
          </button>
        ))}
      </div>
    </Row>
  );
}
function Row({ label, children }) {
  return <div className="flex items-center justify-between gap-sm"><span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wide">{label}</span>{children}</div>;
}
function Field({ label, value, onChange, step = 1 }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-label-sm text-on-surface-variant uppercase tracking-wide">{label}</span>
      <input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-surface-container-lowest border border-outline-variant/50 rounded px-1 py-1 text-on-surface text-label-sm w-full focus:outline-none focus:border-primary" />
    </label>
  );
}
function Num({ value, onChange }) {
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)}
    className="bg-surface-container-lowest border border-outline-variant/50 rounded px-sm py-xs text-on-surface text-label-sm w-20 focus:outline-none focus:border-primary" />;
}
function Color({ value, onChange }) {
  return <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-8 h-8 rounded cursor-pointer bg-transparent" />;
}
function Seg({ options, value, onChange }) {
  return (
    <div className="flex rounded overflow-hidden border border-outline-variant/40">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-sm py-1 text-label-sm font-label-sm transition-colors ${value === v ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:bg-surface-variant'}`}>{label}</button>
      ))}
    </div>
  );
}
