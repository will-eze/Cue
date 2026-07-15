import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useModalGuard } from '../utils/modalGuard';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FormattingToolbar, renderTextContent, buildDecorationCss, buildBoxFillCss } from './SongEditor';
import { buildSnapTargets, snapMove, snapResizeBox, SnapGuides } from '../utils/snapping';
import MediaPickerModal from './MediaPickerModal';
import UndoRedoButtons from './UndoRedoButtons';
import useEditHistory, { useUndoRedoKeys } from '../utils/useEditHistory';
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
    const shadowCss = shadow?.enabled
      ? `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}`
      : 'none';
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
        justifyContent: s.verticalAlign === 'top' ? 'flex-start' : s.verticalAlign === 'bottom' ? 'flex-end' : 'center',
        ...buildBoxFillCss(s.boxFill) }}>
        <div style={{ width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontFamily: s.fontFamily || undefined,
          fontSize: (s.fontSize ?? 48) + 'px',
          textAlign: s.align || 'center',
          fontWeight: s.bold ? 700 : 400,
          fontStyle: s.italic ? 'italic' : 'normal',
          textDecoration: buildDecorationCss(s),
          textTransform: s.uppercase ? 'uppercase' : 'none',
          color: s.color || '#ffffff',
          lineHeight: s.lineSpacing ? String(s.lineSpacing) : '1.25',
          letterSpacing: s.letterSpacing ? `${s.letterSpacing}em` : undefined,
          textShadow: shadowCss,
          WebkitTextStroke: s.textStroke?.enabled ? `${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}` : undefined,
        }} dangerouslySetInnerHTML={{ __html: renderTextContent(el.text || '', null, s) }} />
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

// One interactive element on the canvas: click to select, drag to move,
// corner handles to resize, double-click text to edit in place. Drags smart-snap
// (shared utils/snapping.js) to the canvas edges/centre/thirds and every sibling
// element's edges/centres — hold Alt to bypass. Guides render at the canvas level
// via onGuides so they span the whole slide.
function EditableElement({ el, others, selected, editing, scale, canvasRef, onSelect, onChange, onGuides, onStartEdit, onEndEdit }) {
  const drag = useRef(null);
  const textEditRef = useRef(null);

  // Seed contenteditable content and focus on edit-mode entry.
  // el.text intentionally excluded — we read it once on entry; user edits freely until blur.
  useEffect(() => {
    if (!editing || !textEditRef.current) return;
    textEditRef.current.innerHTML = (el.text || '').replace(/\n/g, '<br>');
    textEditRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(textEditRef.current);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Two-way sync: when el.text changes from the Inspector textarea while in canvas
  // edit mode, push the new value into the contenteditable (only if not focused, so
  // we never overwrite the user's in-progress typing).
  useEffect(() => {
    if (!textEditRef.current || document.activeElement === textEditRef.current) return;
    textEditRef.current.innerHTML = (el.text || '').replace(/\n/g, '<br>');
  }, [el.text]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    const cw = canvasRef.current?.offsetWidth || 1;
    const ch = canvasRef.current?.offsetHeight || 1;
    const dxPct = ((e.clientX - d.startX) / cw) * 100;
    const dyPct = ((e.clientY - d.startY) / ch) * 100;
    const free = e.altKey; // Alt/Option = free positioning (no snap)
    if (d.mode === 'move') {
      const snapped = snapMove({ x: d.x0 + dxPct, y: d.y0 + dyPct, w: d.w0, h: d.h0 }, d.targets, { free, grid: 0 });
      onGuides?.(snapped.guides);
      onChange({ ...el, x: clamp(snapped.x, -50, 100), y: clamp(snapped.y, -50, 100) });
    } else {
      let { x0, y0, w0, h0 } = d;
      let x = x0, y = y0, w = w0, h = h0;
      if (d.mode.includes('e')) w = Math.max(2, w0 + dxPct);
      if (d.mode.includes('s')) h = Math.max(1, h0 + dyPct);
      if (d.mode.includes('w')) { w = Math.max(2, w0 - dxPct); x = x0 + dxPct; }
      if (d.mode.includes('n')) { h = Math.max(1, h0 - dyPct); y = y0 + dyPct; }
      const hx = d.mode.includes('e') ? 1 : d.mode.includes('w') ? 0 : 0.5;
      const hy = d.mode.includes('s') ? 1 : d.mode.includes('n') ? 0 : 0.5;
      const { box, guides } = snapResizeBox({ x, y, w, h }, hx, hy, d.targets, { free, min: 1 });
      onGuides?.(guides);
      onChange({ ...el, ...box });
    }
  }, [el, onChange, onGuides, canvasRef]);

  const endDrag = useCallback(() => {
    drag.current = null;
    onGuides?.([]);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onPointerMove, onGuides]);

  function startDrag(e, mode) {
    e.stopPropagation();
    onSelect();
    drag.current = {
      mode, startX: e.clientX, startY: e.clientY, x0: el.x, y0: el.y, w0: el.w, h0: el.h,
      targets: buildSnapTargets({ others: others || [] }),
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  }

  function handleDoubleClick(e) {
    if (el.type !== 'text') return;
    e.stopPropagation();
    onStartEdit();
  }

  function handleTextBlur() {
    if (!textEditRef.current) return;
    onChange({ ...el, text: textEditRef.current.innerText.trimEnd() });
    onEndEdit();
  }

  const s = el.style || {};
  const shadow = s.textShadow;
  const shadowCss = shadow?.enabled
    ? `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}`
    : 'none';

  return (
    <div
      onPointerDown={editing ? (e) => e.stopPropagation() : (e) => startDrag(e, 'move')}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        opacity: el.opacity != null ? el.opacity : 1, zIndex: el.z != null ? el.z : 0,
        cursor: editing ? 'text' : 'move',
        outline: editing
          ? `${2 / scale}px solid rgba(255,255,255,0.75)`
          : selected ? `${2 / scale}px solid #4d8eff` : `${1 / scale}px dashed rgba(255,255,255,0.35)`,
        outlineOffset: 0, boxSizing: 'border-box',
      }}
    >
      {el.type === 'text' && editing ? (
        // key="edit" forces React to unmount this subtree (not reuse its DOM nodes)
        // when switching to the static path, preventing the stale innerHTML from the
        // useEffect appearing as a ghost text node alongside the new dangerouslySetInnerHTML child.
        <div key="edit" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
          justifyContent: s.verticalAlign === 'top' ? 'flex-start' : s.verticalAlign === 'bottom' ? 'flex-end' : 'center',
          ...buildBoxFillCss(s.boxFill) }}>
          <div
            ref={textEditRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={handleTextBlur}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); textEditRef.current?.blur(); }
              e.stopPropagation(); // keep editor-level Delete/Backspace from firing
            }}
            style={{
              width: '100%', outline: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              fontFamily: s.fontFamily || undefined,
              fontSize: (s.fontSize ?? 48) + 'px',
              textAlign: s.align || 'center',
              fontWeight: s.bold ? 700 : 400,
              fontStyle: s.italic ? 'italic' : 'normal',
              textDecoration: buildDecorationCss(s),
              textTransform: s.uppercase ? 'uppercase' : 'none',
              color: s.color || '#ffffff',
              lineHeight: s.lineSpacing ? String(s.lineSpacing) : '1.25',
              letterSpacing: s.letterSpacing ? `${s.letterSpacing}em` : undefined,
              textShadow: shadowCss,
              WebkitTextStroke: s.textStroke?.enabled ? `${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}` : undefined,
              caretColor: '#4d8eff',
            }}
          />
        </div>
      ) : (
        <div key="static" style={{ width: '100%', height: '100%', pointerEvents: 'none', overflow: 'hidden' }}>{elementInner(el)}</div>
      )}
      {selected && !editing && HANDLES.map((h) => (
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
  useModalGuard();
  const fonts = useFonts();
  // Undoable working document: title + the slides array (each slide's elements).
  // Slide selection (cur) and element selection (selId) are ephemeral UI, kept out
  // of history. setTitle coalesces typing; setSlides is per-call (structural edits
  // are discrete steps, continuous element drags coalesce via patchElement's tag).
  const doc = useEditHistory({
    title: 'Untitled Presentation',
    slides: [{ _key: newId(), label: null, background_id: null, background_path: null, elements: [] }],
  });
  const { title, slides } = doc.state;
  const setTitle = (value) => doc.set((d) => ({ ...d, title: value }), 'title');
  const setSlides = (updater, coalesce) =>
    doc.set((d) => ({ ...d, slides: typeof updater === 'function' ? updater(d.slides) : updater }), coalesce);
  useUndoRedoKeys(doc.undo, doc.redo);
  const [cur, setCur] = useState(0);
  const [selId, setSelId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [guides, setGuides] = useState([]); // smart-snap guide lines during an element drag
  const [picker, setPicker] = useState(null); // 'element' | 'background'
  const [ctxMenu, setCtxMenu] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newSlideOpen, setNewSlideOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [downloadingBg, setDownloadingBg] = useState(false);
  const canvasRef = useRef(null);
  const [scale, setScale] = useState(0.4);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!presentationId) return;
    window.cue.presentations.get(presentationId).then((p) => {
      if (!p) return;
      // Seed via reset() so the DB hydrate is the baseline, not the first undo step.
      doc.reset({
        title: p.title,
        slides: (p.slides && p.slides.length ? p.slides : [{ elements: [] }]).map((s) => ({
          _key: newId(), label: s.label || null, background_id: s.background_id || null,
          background_path: s.background_path || null, elements: s.elements || [],
        })),
      });
    });
  }, [presentationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!canvasRef.current) return;
    const update = () => { if (canvasRef.current) setScale(canvasRef.current.offsetWidth / NATIVE_W); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  // Clamp current-slide index — an undo/redo that changes the slide count must not
  // leave `cur` dangling past the end (slides[cur] would be undefined).
  const curClamped = Math.min(cur, slides.length - 1);
  if (curClamped !== cur) setCur(curClamped);
  const slide = slides[curClamped];
  const selected = slide?.elements.find((e) => e.id === selId) || null;

  function patchSlide(patch, coalesce) {
    setSlides((arr) => arr.map((s, i) => (i === curClamped ? { ...s, ...patch } : s)), coalesce);
  }
  // Element edits coalesce by element id so a continuous canvas drag/resize collapses
  // to a single undo step (the move-end), not one per mousemove frame.
  function patchElement(next) {
    patchSlide({ elements: slide.elements.map((e) => (e.id === next.id ? next : e)) }, `el:${next.id}`);
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
  function duplicateSelected() {
    if (!selected) return;
    const copy = { ...selected, id: newId(), x: selected.x + 2, y: selected.y + 2 };
    patchSlide({ elements: [...slide.elements, copy] });
    setSelId(copy.id);
  }
  // Align the selected element against the slide edges/centre (PowerPoint-style).
  function alignSelected(axis, where) {
    if (!selected) return;
    if (axis === 'h') {
      const x = where === 'left' ? 0 : where === 'right' ? 100 - selected.w : (100 - selected.w) / 2;
      patchElement({ ...selected, x });
    } else {
      const y = where === 'top' ? 0 : where === 'bottom' ? 100 - selected.h : (100 - selected.h) / 2;
      patchElement({ ...selected, y });
    }
  }

  // Add a slide composed from a theme × layout. Photo-backed themes (bgRef) resolve
  // their background via IPC before building so the image element carries a real mediaId.
  // The modal closes immediately; a download toast shows while waiting.
  async function addThemedSlide(themeEntry, layoutId) {
    setNewSlideOpen(false);
    setSelId(null);
    const nextIdx = slides.length;
    const needsDl = themeEntry?.tokens?.bgRef && !themeEntry.background_id && themeEntry.id !== '__plain';
    if (needsDl) setDownloadingBg(true);
    try {
      const bgMedia = await resolveThemeBg(themeEntry);
      const elements = buildThemeSlide(themeEntry.tokens, layoutId, bgMedia);
      setSlides((arr) => [...arr, { _key: newId(), label: null, background_id: null, background_path: null, elements }]);
      setCur(nextIdx);
    } finally {
      if (needsDl) setDownloadingBg(false);
    }
  }
  // Add a slide from a saved presentation template (uses the template's elements directly).
  async function addTemplateSlide(templateId) {
    setNewSlideOpen(false);
    const tpl = await window.cue.presentationTemplates.get(templateId);
    if (!tpl) return;
    const nextIdx = slides.length;
    const els = Array.isArray(tpl.elements) ? tpl.elements.map((e) => ({ ...e, id: newId() })) : [];
    setSlides((arr) => [...arr, { _key: newId(), label: tpl.name || null, background_id: tpl.background_id || null, background_path: tpl.background_path || null, elements: els }]);
    setCur(nextIdx);
  }

  // Re-skin existing slides with a theme: this slide, or the whole deck.
  async function applyTheme(themeEntry, scope) {
    const needsDl = themeEntry?.tokens?.bgRef && !themeEntry.background_id && themeEntry.id !== '__plain';
    if (needsDl) setDownloadingBg(true);
    try {
      const bgMedia = await resolveThemeBg(themeEntry);
      if (scope === 'all') setSlides((arr) => arr.map((s) => ({ ...s, elements: reskinSlide(themeEntry.tokens, s.elements, bgMedia) })));
      else patchSlide({ elements: reskinSlide(themeEntry.tokens, slide.elements, bgMedia) });
    } finally {
      if (needsDl) setDownloadingBg(false);
    }
    setApplyOpen(false);
  }
  // Resolve a photo-backed theme's bgRef → { id, path } (downloads on first use).
  // Returns null for gradient/plain themes (no async work needed).
  async function resolveThemeBg(themeEntry) {
    if (!themeEntry?.tokens?.bgRef || themeEntry.id === '__plain') return null;
    if (themeEntry.background_id) return { id: themeEntry.background_id, path: themeEntry.background_path };
    try {
      const resolved = await window.cue.themes.resolveBackground(themeEntry.id);
      return resolved?.background_id ? { id: resolved.background_id, path: resolved.background_path } : null;
    } catch (err) {
      console.warn('[pres-theme] background resolve failed:', err?.message);
      return null;
    }
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

  // Esc closes; Delete removes, arrows nudge (Shift = coarse), ⌘/Ctrl+D duplicates
  // the selected element (all suppressed while typing).
  useEffect(() => {
    const onKey = (e) => {
      const t = document.activeElement?.tagName;
      const typing = t === 'INPUT' || t === 'TEXTAREA' || document.activeElement?.isContentEditable;
      if (e.key === 'Escape') { if (!picker) onClose(); return; }
      const mod = e.metaKey || e.ctrlKey;
      // ⌘S saves & closes from anywhere in the editor (standard app behavior).
      if (mod && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (!saving) save(); return; }
      // ⌘B/I/U toggle bold/italic/underline on the selected text element — works
      // even while its label field is focused (a plain input has no inline format).
      if (mod && !e.altKey && selected?.type === 'text' && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        const prop = e.key.toLowerCase() === 'b' ? 'bold' : e.key.toLowerCase() === 'i' ? 'italic' : 'underline';
        const st = selected.style || {};
        patchElement({ ...selected, style: { ...st, [prop]: !st[prop] } });
        return;
      }
      if (!selected || typing) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      if (e.key === 'd' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); duplicateSelected(); return; }
      const step = e.shiftKey ? 2 : 0.5;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (dx || dy) { e.preventDefault(); patchElement({ ...selected, x: selected.x + dx, y: selected.y + dy }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex flex-col">
      {downloadingBg && (
        <div className="fixed bottom-6 right-6 z-[80] bg-surface-container-high border border-outline-variant/30 rounded-lg px-md py-sm text-label-sm text-on-surface-variant flex items-center gap-sm shadow-xl pointer-events-none">
          <span className="material-symbols-outlined text-[16px] text-primary animate-spin">progress_activity</span>
          Downloading background…
        </div>
      )}
      {/* Header — two rows. Row 1 is a draggable titlebar strip that clears the
          macOS traffic lights; the action buttons are nodrag so they stay clickable.
          The title input lives in row 2, below the traffic-light zone. */}
      <div className="shrink-0 bg-surface-container-high border-b border-outline-variant/30">
        <div className="titlebar-drag flex items-center justify-end gap-sm h-10 px-lg">
          <div className="titlebar-nodrag flex items-center gap-sm">
            <UndoRedoButtons undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
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
            <AddBtn icon="bookmark_add" label="Save as Template" onClick={() => setSaveTemplateOpen(true)} />
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-lg overflow-hidden">
            <div ref={canvasRef} onPointerDown={() => { setSelId(null); setEditingId(null); }}
              className="relative bg-black shadow-2xl ring-1 ring-white/10 overflow-hidden"
              style={{ width: '100%', maxWidth: 'min(100%, calc((100vh - 200px) * 16 / 9))', aspectRatio: '16 / 9' }}>
              {slide?.background_path && <img src={mediaUrl(slide.background_path)} className="absolute inset-0 w-full h-full object-cover pointer-events-none" alt="" />}
              {/* Fixed 1920×1080 stage scaled to fit — keeps px font sizes WYSIWYG with
                  the live output (#slide-elements) + the operator monitor. */}
              <div style={{ position: 'absolute', top: 0, left: 0, width: NATIVE_W, height: NATIVE_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                {slide && [...slide.elements].sort((a, b) => (a.z || 0) - (b.z || 0)).map((el) => (
                  <EditableElement key={el.id} el={el} selected={el.id === selId} editing={el.id === editingId}
                    others={slide.elements.filter((o) => o.id !== el.id)} onGuides={setGuides}
                    scale={scale} canvasRef={canvasRef}
                    onSelect={() => {
                      // Commit any active inline edit before changing selection
                      if (editingId !== null && editingId !== el.id) {
                        const active = document.activeElement;
                        if (active?.contentEditable === 'true') active.blur();
                      }
                      setSelId(el.id);
                    }}
                    onChange={patchElement}
                    onStartEdit={() => { setSelId(el.id); setEditingId(el.id); }}
                    onEndEdit={() => setEditingId(null)}
                  />
                ))}
              </div>
              {/* Smart-snap guide lines — rendered at canvas level (unscaled) so they
                  stay 1px crisp; % positions match the 1920×1080 stage exactly. */}
              <SnapGuides guides={guides} zIndex={60} />
            </div>
          </div>
        </div>

        {/* Inspector */}
        <div className="w-80 shrink-0 border-l border-outline-variant/30 bg-surface-container-low overflow-y-auto">
          {selected ? (
            <Inspector el={selected} fonts={fonts} onChange={patchElement} onDelete={deleteSelected}
              onFront={bringToFront} onBack={sendToBack} onDuplicate={duplicateSelected}
              onAlign={alignSelected} onReplaceImage={() => setPicker('element')} />
          ) : (
            <div className="p-md flex flex-col gap-md">
              <div className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">
                {slide?.elements.length || 0} element{slide?.elements.length === 1 ? '' : 's'} · click to select
              </div>
              <label className="flex flex-col gap-xs">
                <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Slide label</span>
                <input
                  type="text"
                  value={slide?.label || ''}
                  onChange={(e) => patchSlide({ label: e.target.value.trim() || null })}
                  placeholder="e.g. Verse 1, Title slide…"
                  className="bg-surface-container-lowest border border-outline-variant/40 rounded px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary"
                />
              </label>
            </div>
          )}
        </div>
      </div>

      {newSlideOpen && <NewSlideModal currentElements={slide?.elements} onAdd={addThemedSlide} onAddTemplate={addTemplateSlide} onClose={() => setNewSlideOpen(false)} />}
      {applyOpen && <ApplyThemeModal hasSlide={!!slide} onApply={applyTheme} onClose={() => setApplyOpen(false)} />}
      {saveTemplateOpen && slide && (
        <SaveTemplateModal elements={slide.elements} backgroundId={slide.background_id} onClose={() => setSaveTemplateOpen(false)} />
      )}
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

// Build StaticSlide props for a theme preview tile. Photo themes use either the
// locally-downloaded path (cue-media://) or the Unsplash thumb URL (HTTPS, CSP-allowed)
// as the background. When a photo background URL is available, the gradient bgShape
// element is filtered out so it doesn't cover the photo.
function themePreviewProps(themeEntry, layoutId) {
  const hasBgUrl = themeEntry.background_path || themeEntry.bg_thumb;
  return {
    elements: hasBgUrl
      ? buildThemeSlide(themeEntry.tokens, layoutId).filter((e) => e.role !== 'background')
      : buildThemeSlide(themeEntry.tokens, layoutId),
    backgroundPath: themeEntry.background_path || null,
    backgroundRaw: themeEntry.background_path ? null : (themeEntry.bg_thumb || null),
  };
}

// Load built-in presentation themes (themes table, category 'presentation') and
// parse their token style_json. Also fetches the background library item list so
// photo-backed themes can show their Unsplash thumbnail in the picker without a
// download — following the same pattern as ThemeSettings.
// Returns [{ id, name, tokens, background_id, background_path, bg_thumb }].
function usePresentationThemes() {
  const [themes, setThemes] = useState([]);
  useEffect(() => {
    Promise.all([
      window.cue.themes.list(),
      window.cue.backgrounds?.list?.().catch(() => []),
    ]).then(([list, bgItems]) => {
      const thumbMap = {};
      for (const it of (bgItems || [])) if (it.thumb) thumbMap[it.id] = it.thumb;
      const out = [];
      for (const t of (list || [])) {
        if ((t.category || 'song') !== 'presentation') continue;
        let tokens = null;
        try { tokens = typeof t.style_json === 'string' ? JSON.parse(t.style_json) : t.style_json; } catch {}
        if (!tokens) continue;
        const bgThumb = tokens.bgRef ? (thumbMap[tokens.bgRef] || null) : null;
        out.push({ id: t.id, name: t.name, tokens, background_id: t.background_id ?? null, background_path: t.background_path ?? null, bg_thumb: bgThumb });
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

// Small modal to name and save the current slide as a named template.
function SaveTemplateModal({ elements, backgroundId, onClose }) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  useEscape(onClose);

  async function doSave() {
    if (!name.trim()) return;
    await window.cue.presentationTemplates.create({ name: name.trim(), elements, background_id: backgroundId || null });
    setSaved(true);
    setTimeout(onClose, 1000);
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onMouseDown={onClose}>
      <div className="w-80 bg-surface-container-low border border-outline-variant/30 rounded-xl shadow-2xl p-md flex flex-col gap-sm" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface flex items-center gap-xs">
          <span className="material-symbols-outlined text-primary text-[18px]">bookmark_add</span>Save as Template
        </h3>
        {saved ? (
          <p className="text-body-sm text-tertiary flex items-center gap-xs">
            <span className="material-symbols-outlined text-[16px]">check_circle</span>Saved!
          </p>
        ) : (
          <>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') onClose(); }}
              placeholder="Template name…"
              className="w-full px-sm py-xs bg-surface-container-lowest border border-outline-variant/50 rounded text-body-sm text-on-surface outline-none focus:border-primary"
            />
            <div className="flex gap-xs justify-end">
              <button onClick={onClose} className="px-md py-xs text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface cursor-pointer rounded transition-colors">Cancel</button>
              <button onClick={doSave} disabled={!name.trim()}
                className="px-md py-xs text-label-sm font-label-sm bg-primary-container text-on-primary rounded cursor-pointer hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// New-slide modal: pick a theme (left rail, incl. "No theme") → see it across every
// layout as tiles (right) → click a theme×layout tile to add that slide. Defaults the
// selected theme to the deck's current one (detected from the active slide) so adding
// slides stays within the chosen theme pack — the rail still lets you switch.
function NewSlideModal({ currentElements, onAdd, onAddTemplate, onClose }) {
  const themes = usePresentationThemes();
  const [templates, setTemplates] = useState([]);
  const [query, setQuery] = useState('');
  const [selId, setSelId] = useState('__plain');
  const seeded = useRef(false);
  useEscape(onClose);

  useEffect(() => {
    window.cue.presentationTemplates.list().then(setTemplates);
  }, []);

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
          {/* Theme + Templates rail */}
          <div className="w-60 shrink-0 border-r border-outline-variant/30 overflow-y-auto custom-scrollbar p-sm flex flex-col gap-xs">
            {templates.length > 0 && (
              <>
                <p className="text-[9px] font-label-sm uppercase tracking-widest text-on-surface-variant/50 px-xs pt-xs pb-[2px]">My Templates</p>
                {templates.map((tpl) => {
                  const tid = `__tpl_${tpl.id}`;
                  const els = Array.isArray(tpl.elements) ? tpl.elements : (() => { try { return JSON.parse(tpl.elements_json || '[]'); } catch { return []; } })();
                  return (
                    <button key={tid} onClick={() => setSelId(tid)}
                      className={`flex items-center gap-sm p-xs rounded-lg border text-left transition-colors ${selId === tid ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-surface-variant'}`}>
                      <div className="w-24 shrink-0">
                        <StaticSlide elements={els} />
                      </div>
                      <span className="text-label-sm font-mono text-on-surface truncate min-w-0">{tpl.name}</span>
                    </button>
                  );
                })}
                <div className="h-px bg-outline-variant/20 my-xs" />
                <p className="text-[9px] font-label-sm uppercase tracking-widest text-on-surface-variant/50 px-xs pb-[2px]">Themes</p>
              </>
            )}
            {list.map((t) => (
              <button key={t.id} onClick={() => setSelId(t.id)}
                className={`flex items-center gap-sm p-xs rounded-lg border text-left transition-colors ${t.id === selId ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-surface-variant'}`}>
                <div className="w-24 shrink-0"><StaticSlide {...themePreviewProps(t, 'title')} /></div>
                <span className="text-label-sm font-mono text-on-surface truncate min-w-0">{t.name}</span>
              </button>
            ))}
          </div>
          {/* Right panel: template preview OR layout tiles */}
          {selId.startsWith('__tpl_') ? (() => {
            const tplId = Number(selId.replace('__tpl_', ''));
            const tpl = templates.find((t) => t.id === tplId);
            if (!tpl) return null;
            const els = Array.isArray(tpl.elements) ? tpl.elements : (() => { try { return JSON.parse(tpl.elements_json || '[]'); } catch { return []; } })();
            return (
              <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-lg flex flex-col items-center justify-center gap-lg">
                <p className="text-[10px] font-label-sm uppercase tracking-widest text-on-surface-variant/60">{tpl.name} · template</p>
                <div className="w-full max-w-md">
                  <StaticSlide elements={els} />
                </div>
                <button
                  onClick={() => onAddTemplate(tplId)}
                  className="px-lg py-sm bg-primary-container text-on-primary text-label-sm font-label-sm rounded-lg cursor-pointer hover:brightness-110 active:scale-95 transition-all">
                  Use Template
                </button>
              </div>
            );
          })() : (
            <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-lg">
              <p className="text-[10px] font-label-sm uppercase tracking-widest text-on-surface-variant/60 mb-sm">{sel?.name} · pick a layout</p>
              <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                {PRES_LAYOUTS.map((l) => (
                  <div key={l.id} role="button" tabIndex={0}
                    onClick={() => onAdd(sel, l.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(sel, l.id); } }}
                    className="bg-surface-container border border-outline-variant/30 rounded-xl overflow-hidden flex flex-col cursor-pointer hover:border-primary/50 hover:ring-1 hover:ring-primary/30 active:scale-[0.99] transition-all">
                    <div className="p-sm pb-0"><StaticSlide {...themePreviewProps(sel, l.id)} /></div>
                    <div className="px-md py-sm"><span className="text-label-sm font-mono text-on-surface truncate">{l.name}</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                onClick={() => onApply(t, scope)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onApply(t, scope); } }}
                className="bg-surface-container border border-outline-variant/30 rounded-xl overflow-hidden flex flex-col cursor-pointer hover:border-primary/50 hover:ring-1 hover:ring-primary/30 active:scale-[0.99] transition-all">
                <div className="p-sm pb-0"><StaticSlide {...themePreviewProps(t, 'title-sub')} /></div>
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
function Inspector({ el, fonts, onChange, onDelete, onFront, onBack, onDuplicate, onAlign, onReplaceImage }) {
  const set = (k, v) => onChange({ ...el, [k]: v });
  const num = (k, v) => onChange({ ...el, [k]: v === '' ? 0 : Number(v) });
  return (
    <div className="flex flex-col">
      <div className="px-md py-sm border-b border-outline-variant/30 flex items-center gap-sm">
        <span className="material-symbols-outlined text-[16px] text-primary">{el.type === 'text' ? 'title' : el.type === 'image' ? 'image' : 'shapes'}</span>
        <span className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface">{el.type}</span>
        <button onClick={onDuplicate} title="Duplicate element (⌘/Ctrl+D)" className="ml-auto text-on-surface-variant hover:text-on-surface hover:bg-surface-variant rounded p-1 transition-colors">
          <span className="material-symbols-outlined text-[16px]">content_copy</span>
        </button>
        <button onClick={onDelete} title="Delete element" className="text-error hover:bg-error-container/20 rounded p-1 transition-colors">
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
              hasSelection={() => false} execCmd={() => {}} previewTemplate="lowerthird" simple />
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
        {/* Align on slide — snap the element to the slide edges / centre lines. */}
        <Row label="Align">
          <div className="flex gap-[2px]">
            {[
              { axis: 'h', where: 'left',   icon: 'align_horizontal_left',   t: 'Align left edge' },
              { axis: 'h', where: 'center', icon: 'align_horizontal_center', t: 'Centre horizontally' },
              { axis: 'h', where: 'right',  icon: 'align_horizontal_right',  t: 'Align right edge' },
              { axis: 'v', where: 'top',    icon: 'align_vertical_top',      t: 'Align top edge' },
              { axis: 'v', where: 'middle', icon: 'align_vertical_center',   t: 'Centre vertically' },
              { axis: 'v', where: 'bottom', icon: 'align_vertical_bottom',   t: 'Align bottom edge' },
            ].map(({ axis, where, icon, t }) => (
              <button key={`${axis}-${where}`} title={t} onClick={() => onAlign(axis, where)}
                className="p-1 rounded text-on-surface-variant hover:bg-surface-variant hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined text-[15px]">{icon}</span>
              </button>
            ))}
          </div>
        </Row>
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
