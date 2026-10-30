import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import MediaPickerModal from './MediaPickerModal';
import { useModalGuard } from '../utils/modalGuard';
import ThemePickerModal from './ThemePickerModal';
import UndoRedoButtons from './UndoRedoButtons';
import useEditHistory, { useUndoRedoKeys } from '../utils/useEditHistory';
import { useToast } from './Toast';
import { mediaUrl } from '../utils/mediaUrl';
import { sectionOrdinals, sectionLabels, SLIDE_BREAK } from '../utils/sectionLabels';
import { parseLyrics, parseHeaderLine, singerNamesIn, cleanSectionText } from '../../shared/lyrics-parse.js';
import { normalizeLookStyle } from '../utils/presentationThemes';
import TreatmentOverlays, { glassBoxStyle } from './TreatmentOverlays';
import { useFonts } from '../utils/fonts';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { buildSnapTargets, snapMove, snapResizeBox, SnapGuides } from '../utils/snapping';

// ─── Constants ─────────────────────────────────────────────────────────────

const SECTION_TYPES = ['verse', 'chorus', 'refrain', 'bridge', 'pre-chorus', 'tag', 'intro', 'outro'];
const FONT_SIZES    = [18, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 112, 128, 144, 160];

export const DEFAULT_STYLE = {
  fontFamily:       null,
  fontSize:         null,
  color:            null,
  bold:             false,
  italic:           false,
  underline:        false,
  strikethrough:    false,
  uppercase:        false,
  align:            'center',
  verticalAlign:    'center',
  lineSpacing:      null,
  letterSpacing:    null,
  textShadow:       null,
  textStroke:       null,
  textBox:          null,
  boxFill:          null,  // {enabled,color,opacity,radius,pad} — fill panel behind the text box
  ltBar:            null,
  // Lower-third role overrides. A theme (or song) can style the lower third
  // independently of the fullscreen look — e.g. drop the shadow on the overlay
  // while keeping it on the fullscreen slide. Any key PRESENT here overrides the
  // matching fullscreen value; absent = inherit. See resolveLtStyle().
  lt:               null,  // { textShadow?, fontFamily?, color?, uppercase?, ... }
  // Accent — one colour that shows as a rule on the lower third; can be turned off.
  accent:           null,  // { enabled: bool, color: '#rrggbb' }
  listStyle:        null,  // null|'disc'|'decimal'
  bulletSpacing:    null,  // em — gap after each bullet item
  paragraphSpacing: null,  // em — gap between \n\n-separated blocks
};

// Which fullscreen style fields the lower-third role may override. Kept in sync
// with output/lowerthird.js resolveLtStyle (that file can't import from here).
export const LT_OVERRIDE_KEYS = [
  'fontFamily', 'color', 'uppercase', 'align', 'bold', 'italic',
  'letterSpacing', 'lineSpacing', 'textShadow', 'textStroke', 'fontSize',
];

// Resolve the effective lower-third text style: base fullscreen style with any
// `style.lt` overrides applied on top. Runs and every non-overridden field are
// inherited unchanged. Returns the base object untouched when there are no
// overrides. Mirrored verbatim (plain JS) in output/lowerthird.js.
export function resolveLtStyle(style) {
  if (!style || !style.lt) return style;
  const out = { ...style };
  for (const k of LT_OVERRIDE_KEYS) if (k in style.lt) out[k] = style.lt[k];
  return out;
}

// The accent rule shown beneath the lower-third text when the theme enables it.
// Authored at 1920×1080 scale; the preview/monitor scale it with the canvas.
export function accentRuleStyle(accent) {
  if (!accent || !accent.enabled) return null;
  return {
    width: '160px', height: '6px', borderRadius: '3px',
    background: accent.color || '#e7c98a',
    margin: '18px auto 0',
    alignSelf: 'center',
  };
}

const TEXTBOX_PRESETS = [
  { label: 'Full',   value: null },
  { label: 'Top',    value: { x: 5, y: 4,  w: 90, h: 30 } },
  { label: 'Middle', value: { x: 5, y: 35, w: 90, h: 30 } },
  { label: 'Bottom', value: { x: 5, y: 60, w: 90, h: 35 } },
  { label: 'L3',     value: { x: 5, y: 68, w: 90, h: 27 } },
];

let keyCounter = 0;
const newKey = () => `k${++keyCounter}`;

// In-editor rendering of a slide split. Storage keeps the canonical ⁂ marker in
// `content`; the contenteditable shows it as a styled, atomic (contenteditable
// =false) "slide break" divider. The element is self-contained (inline styles, no
// external CSS) and tagged `data-break` so extractContentAndRuns() can convert it
// back to the marker on read-back.
const SLIDE_BREAK_HTML =
  '<div data-break="1" contenteditable="false" ' +
  'style="display:flex;align-items:center;gap:8px;margin:10px 2px;user-select:none;cursor:default;">' +
  '<span style="flex:1;height:1px;background:rgba(173,198,255,0.35);"></span>' +
  '<span style="font:700 8px/1 ui-monospace,monospace;letter-spacing:0.12em;text-transform:uppercase;color:rgba(173,198,255,0.7);">▾ slide break ▾</span>' +
  '<span style="flex:1;height:1px;background:rgba(173,198,255,0.35);"></span>' +
  '</div>';

// Wrap renderWithRuns for the editor: swap the canonical ⁂ marker (and any <br>
// renderWithRuns put around its blank line) for the visual divider.
function renderEditorHtml(content, runs) {
  return renderWithRuns(content || '', runs || []).replace(/(?:<br>)?⁂(?:<br>)?/g, SLIDE_BREAK_HTML);
}

// ─── Core helpers (exported for output windows) ────────────────────────────

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// `scale` (default 1) multiplies inline run font sizes — used by the lower-third
// preview to mirror the global L3 font scale; all other callers leave it at 1.
export function renderWithRuns(text, runs, scale = 1) {
  if (!text) return '';
  if (!runs || runs.length === 0) return esc(text).replace(/\n/g, '<br>');
  const sorted = [...runs].sort((a, b) => a.start - b.start);
  let html = '', pos = 0;
  for (const run of sorted) {
    const s = Math.min(Math.max(0, run.start), text.length);
    const e = Math.min(Math.max(s, run.end), text.length);
    if (pos < s) html += esc(text.slice(pos, s)).replace(/\n/g, '<br>');
    const st = [];
    if (run.bold)       st.push('font-weight:700');
    if (run.italic)     st.push('font-style:italic');
    const deco = [run.underline && 'underline', run.strikethrough && 'line-through'].filter(Boolean).join(' ');
    if (deco)           st.push(`text-decoration:${deco}`);
    if (run.color)      st.push(`color:${run.color}`);
    if (run.fontFamily) st.push(`font-family:${String(run.fontFamily).replace(/"/g, "'")}`);
    if (run.fontSize)   st.push(`font-size:${Number(run.fontSize) * scale}px`);
    const inner = esc(text.slice(s, e)).replace(/\n/g, '<br>');
    html += st.length ? `<span style="${st.join(';')}">${inner}</span>` : inner;
    pos = e;
  }
  if (pos < text.length) html += esc(text.slice(pos)).replace(/\n/g, '<br>');
  return html;
}

// Full text renderer that handles list-style and paragraph-spacing on top of renderWithRuns.
// Used by SlidePreview, LowerThirdPreview and any consumer that should honour these style props.
// The contenteditable editor always works with plain text; these styles only affect preview/output.
export function renderTextContent(text, runs, style = {}, scale = 1) {
  const { listStyle, bulletSpacing, paragraphSpacing } = style || {};

  if (listStyle && listStyle !== 'none') {
    const tag = listStyle === 'decimal' ? 'ol' : 'ul';
    const lines = (text || '').split('\n');
    let curPos = 0;
    const items = [];
    for (const line of lines) {
      const lineStart = curPos;
      const lineEnd = curPos + line.length;
      curPos += line.length + 1;
      if (!line.trim()) continue;
      const lineRuns = (runs || [])
        .filter((r) => r.end > lineStart && r.start < lineEnd)
        .map((r) => ({ ...r, start: Math.max(0, r.start - lineStart), end: Math.min(line.length, r.end - lineStart) }));
      const bsStyle = bulletSpacing ? `margin-bottom:${bulletSpacing}em` : '';
      items.push(`<li style="${bsStyle}">${renderWithRuns(line, lineRuns, scale)}</li>`);
    }
    return `<${tag} style="padding-left:1.5em;margin:0;list-style-type:${listStyle}">${items.join('')}</${tag}>`;
  }

  if (paragraphSpacing) {
    const parts = (text || '').split('\n\n');
    let curPos = 0;
    return parts.map((para, i) => {
      const paraStart = curPos;
      curPos += para.length + 2;
      const paraRuns = (runs || [])
        .filter((r) => r.end > paraStart && r.start < paraStart + para.length)
        .map((r) => ({ ...r, start: Math.max(0, r.start - paraStart), end: Math.min(para.length, r.end - paraStart) }));
      const mbStyle = i < parts.length - 1 ? `margin-bottom:${paragraphSpacing}em` : '';
      return `<div style="${mbStyle}">${renderWithRuns(para, paraRuns, scale)}</div>`;
    }).join('');
  }

  return renderWithRuns(text, runs, scale);
}

function extractContentAndRuns(el) {
  let text = '';
  const runs = [];
  function walk(node, style) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const start = text.length;
      text += node.textContent;
      if (Object.keys(style).length && node.textContent.length) runs.push({ start, end: text.length, ...style });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === 'BR') { text += '\n'; return; }
    // Slide-break divider → canonical marker on its own line. Atomic: never recurse
    // into its label/rule spans.
    if (node.dataset && node.dataset.break) {
      if (text.length && !text.endsWith('\n')) text += '\n';
      text += SLIDE_BREAK + '\n';
      return;
    }
    const s = { ...style };
    if (tag === 'B' || tag === 'STRONG') s.bold = true;
    if (tag === 'I' || tag === 'EM')     s.italic = true;
    if (tag === 'U')                      s.underline = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.strikethrough = true;
    if (tag === 'SPAN') {
      const cs = node.style;
      if (cs.fontWeight === 'bold' || cs.fontWeight === '700') s.bold = true;
      if (cs.fontStyle === 'italic')                          s.italic = true;
      if (cs.textDecoration?.includes('underline'))           s.underline = true;
      if (cs.textDecoration?.includes('line-through'))        s.strikethrough = true;
      if (cs.color)      s.color = cs.color;
      if (cs.fontFamily) s.fontFamily = cs.fontFamily;
      if (cs.fontSize)   s.fontSize = parseInt(cs.fontSize);
    }
    if (tag === 'DIV' && node !== el && text.length > 0 && !text.endsWith('\n')) text += '\n';
    for (const child of node.childNodes) walk(child, s);
  }
  walk(el, {});
  return { text: text.trimEnd(), runs };
}

export function styleIsDefault(s) {
  if (!s) return true;
  return !s.fontFamily && !s.fontSize && !s.color && !s.bold && !s.italic &&
    !s.underline && !s.strikethrough && !s.uppercase && (!s.align || s.align === 'center') &&
    (!s.verticalAlign || s.verticalAlign === 'center') &&
    !s.lineSpacing && !s.letterSpacing && !s.textShadow && !s.textStroke && !s.textBox && !s.boxFill && !s.ltBar &&
    !s.lt && !s.accent && (!s.bgSpeed || s.bgSpeed === 1) && !s.treatment &&
    !s.bgCss && !s.bgScrim && !s.listStyle && !s.bulletSpacing && !s.paragraphSpacing;
}

function serializeSection(type, text, runs, style) {
  const hasRuns  = runs && runs.length > 0;
  const hasStyle = !styleIsDefault(style);
  if (!hasStyle && !hasRuns) return { type, content: text, style_json: null };
  const { runs: _r, ...base } = style;
  return { type, content: text, style_json: JSON.stringify({ ...base, runs: hasRuns ? runs : undefined }) };
}

// Split the editor's working text+runs into display parts on the ⁂ break marker,
// rebasing each run's character offsets into its part so the preview styles the
// part correctly. Empty parts (leading/trailing/back-to-back markers) are dropped;
// a section with no marker yields exactly one part. Mirrors splitSectionContent()
// in utils/sectionLabels.js, but offset-aware so runs survive.
function splitForPreview(text, runs) {
  const raw = text || '';
  const allRuns = runs || [];
  const bounds = [];
  let start = 0, idx;
  while ((idx = raw.indexOf(SLIDE_BREAK, start)) !== -1) {
    bounds.push([start, idx]);
    start = idx + SLIDE_BREAK.length;
  }
  bounds.push([start, raw.length]);

  const parts = [];
  for (const [s, e] of bounds) {
    const seg = raw.slice(s, e);
    const lead = seg.length - seg.replace(/^\s+/, '').length;
    const trail = seg.length - seg.replace(/\s+$/, '').length;
    const ts = s + lead, te = e - trail;
    if (te <= ts) continue;                       // empty part
    const partRuns = [];
    for (const r of allRuns) {
      const rs = Math.max(r.start, ts), re = Math.min(r.end, te);
      if (re > rs) partRuns.push({ ...r, start: rs - ts, end: re - ts });
    }
    parts.push({ text: raw.slice(ts, te), runs: partRuns });
  }
  return parts.length ? parts : [{ text: '', runs: [] }];
}

function buildShadowCss(shadow) {
  if (!shadow) return '0 2px 16px rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.6)';
  if (!shadow.enabled) return 'none';
  return `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}`;
}

function buildStrokeCss(stroke) {
  if (!stroke || !stroke.enabled) return undefined;
  return `${stroke.width ?? 2}px ${stroke.color ?? '#000000'}`;
}

// underline + strikethrough combine into one text-decoration value.
export function buildDecorationCss(s) {
  const deco = [s?.underline && 'underline', s?.strikethrough && 'line-through'].filter(Boolean).join(' ');
  return deco || 'none';
}

// Fill panel behind the text box (legibility on busy backgrounds) — colour at
// opacity, rounded corners, inner padding. px values are authored 1920×1080 space.
export function buildBoxFillCss(bf) {
  if (!bf || !bf.enabled) return {};
  const c = bf.color || '#000000';
  const r = parseInt(c.slice(1, 3), 16) || 0;
  const g = parseInt(c.slice(3, 5), 16) || 0;
  const b = parseInt(c.slice(5, 7), 16) || 0;
  return {
    background: `rgba(${r},${g},${b},${bf.opacity ?? 0.5})`,
    borderRadius: `${bf.radius ?? 0}px`,
    padding: `${bf.pad ?? 24}px`,
  };
}

// Build a CSS style object for an attribution/reference line from a style_json
// subset (font/size/colour/align/weight/etc). Used by the scripture reference,
// which is stylable; `null` style falls back to the caller's base + defaultAlign.
// Font/colour props of a reference style (no layout) — shared by the editor's
// draggable reference target and copyrightCss.
export function copyrightFontCss(cs) {
  const o = {};
  if (!cs) return o;
  if (cs.fontFamily)    o.fontFamily = cs.fontFamily;
  if (cs.fontSize)      o.fontSize = `${cs.fontSize}px`;
  if (cs.color)         o.color = cs.color;
  if (cs.bold)          o.fontWeight = 700;
  if (cs.italic)        o.fontStyle = 'italic';
  if (cs.underline || cs.strikethrough) o.textDecoration = buildDecorationCss(cs);
  if (cs.uppercase)     o.textTransform = 'uppercase';
  if (cs.letterSpacing) o.letterSpacing = `${cs.letterSpacing}em`;
  if (cs.textShadow?.enabled) o.textShadow = `${cs.textShadow.x ?? 0}px ${cs.textShadow.y ?? 2}px ${cs.textShadow.blur ?? 16}px ${cs.textShadow.color ?? '#000'}`;
  if (cs.textStroke?.enabled) o.WebkitTextStroke = `${cs.textStroke.width ?? 2}px ${cs.textStroke.color ?? '#000'}`;
  return o;
}

export function copyrightCss(cs, defaultAlign = 'center', allowPos = true) {
  const align = cs?.align || defaultAlign;
  // Symmetric horizontal inset so left- and right-aligned references sit the same
  // distance from the screen edge (lower-third callers reset this — the bar pads).
  const css = { textAlign: align, paddingLeft: '60px', paddingRight: '60px', ...copyrightFontCss(cs) };
  // Free positioning (fullscreen only): anchor at x%,y% top-left, single line.
  if (allowPos && cs?.pos) {
    css.left = `${cs.pos.x}%`;
    css.top = `${cs.pos.y}%`;
    css.right = 'auto';
    css.bottom = 'auto';
    css.paddingLeft = 0;
    css.paddingRight = 0;
    css.whiteSpace = 'nowrap';
    css.textAlign = cs.align || 'left';
  }
  return css;
}

function buildBarBg(ltBar) {
  if (!ltBar) return 'transparent';
  if (ltBar.css) return ltBar.css;
  const c  = ltBar.color   ?? '#000000';
  const op = ltBar.opacity ?? 0.8;
  const r  = parseInt(c.slice(1, 3), 16) || 0;
  const g  = parseInt(c.slice(3, 5), 16) || 0;
  const b  = parseInt(c.slice(5, 7), 16) || 0;
  if (ltBar.solid) return `rgba(${r},${g},${b},${op})`;
  return `linear-gradient(to top, rgba(${r},${g},${b},${op}) 0%, rgba(${r},${g},${b},${(op * 0.7).toFixed(2)}) 70%, transparent 100%)`;
}

// ─── Song parser ───────────────────────────────────────────────────────────
// Shared with file import / scraper / set-list create: src/shared/lyrics-parse.js.

// ─── Slide Preview ─────────────────────────────────────────────────────────

const SLIDE_W = 1920;
const SLIDE_H = 1080;

// Fixed "content window" — the safe area inset from the screen edges. The text box
// can be dragged/resized anywhere on screen, but object-align snaps it within this.
const CONTENT_BOX = { x: 5, y: 5, w: 90, h: 90 };
const MIN_BOX = 5; // minimum text-box size (%)

const clampPct = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

// 8 resize handles (PowerPoint-style). hx/hy: which edges move (0=left/top, 1=right/bottom, 0.5=none).
const TB_HANDLES = [
  { hx: 0,   hy: 0,   cursor: 'nwse-resize' },
  { hx: 0.5, hy: 0,   cursor: 'ns-resize' },
  { hx: 1,   hy: 0,   cursor: 'nesw-resize' },
  { hx: 1,   hy: 0.5, cursor: 'ew-resize' },
  { hx: 1,   hy: 1,   cursor: 'nwse-resize' },
  { hx: 0.5, hy: 1,   cursor: 'ns-resize' },
  { hx: 0,   hy: 1,   cursor: 'nesw-resize' },
  { hx: 0,   hy: 0.5, cursor: 'ew-resize' },
];

// Resize a box (%) by dragging a handle: the opposite edge stays fixed.
function resizeBox(s, hx, hy, dx, dy) {
  let { x, y, w, h } = s;
  if (hx === 1) w += dx; else if (hx === 0) { x += dx; w -= dx; }
  if (hy === 1) h += dy; else if (hy === 0) { y += dy; h -= dy; }
  if (w < MIN_BOX) { if (hx === 0) x = s.x + s.w - MIN_BOX; w = MIN_BOX; }
  if (h < MIN_BOX) { if (hy === 0) y = s.y + s.h - MIN_BOX; h = MIN_BOX; }
  x = clampPct(x, 0, 100); y = clampPct(y, 0, 100);
  w = clampPct(w, MIN_BOX, 100 - x); h = clampPct(h, MIN_BOX, 100 - y);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

// Snap targets for the text box: frame edges/centre/thirds + the safe-area lines.
const TB_SNAP_TARGETS = buildSnapTargets({ contentBox: CONTENT_BOX });

// A muted looping background <video> that honours a playback `speed` (theme
// bgSpeed, default 1× = normal). Mirrors output/fullscreen.js so previews match.
export function BgVideo({ src, speed = 1, style, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const apply = () => { try { v.playbackRate = Math.max(0.1, Math.min(2, Number(speed) || 1)); } catch {} };
    apply();
    v.addEventListener('loadedmetadata', apply);
    return () => v.removeEventListener('loadedmetadata', apply);
  }, [speed, src]);
  return <video ref={ref} src={src} style={style} className={className} autoPlay loop muted playsInline />;
}

export function SlidePreview({ text, runs, style, backgroundPath, copyright, copyrightAlign, copyrightStyle, onTextBoxChange, onRefPosChange, onCanvasTextChange }) {
  const wrapRef  = useRef(null);
  const [scale, setScale] = useState(0.5);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const [isEditing, setIsEditing] = useState(false);
  const [hovered, setHovered] = useState(false); // reveal the safe-area guide only on hover
  const [guides, setGuides] = useState([]); // smart-snap guide lines during a drag
  const textEditRef = useRef(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const update = () => { if (wrapRef.current) setScale(wrapRef.current.offsetWidth / SLIDE_W); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!isEditing || !textEditRef.current) return;
    textEditRef.current.innerText = text || '';
    textEditRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(textEditRef.current);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCanvasBlur() {
    if (!textEditRef.current || !onCanvasTextChange) { setIsEditing(false); return; }
    onCanvasTextChange(textEditRef.current.innerText.trimEnd());
    setIsEditing(false);
  }

  // Drag: pointer delta → native px (÷ scale) → percent. onMove(dx%, dy%, startSnapshot, ev)
  // — ev exposes altKey so a drag can bypass smart-snap (free positioning).
  function startDrag(e, start, onMove) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const sc = scaleRef.current || 1;
    const move = (ev) => {
      const dx = ((ev.clientX - sx) / sc) / SLIDE_W * 100;
      const dy = ((ev.clientY - sy) / sc) / SLIDE_H * 100;
      onMove(dx, dy, start, ev);
    };
    const up = () => {
      setGuides([]);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const tbDraggable  = !!onTextBoxChange;
  const refDraggable = !!onRefPosChange;

  // Reference preview style: free-positioned at pos, else content-width anchored to
  // the bottom band by align (visually matches the output, and is a small drag target).
  const refAlign = copyrightStyle?.align || (copyrightAlign === 'right' ? 'right' : 'center');
  const refStyleObj = {
    position: 'absolute', zIndex: 4, whiteSpace: 'nowrap',
    color: 'rgba(255,255,255,0.7)', fontSize: '20px', textShadow: '0 1px 6px rgba(0,0,0,0.8)',
    cursor: refDraggable ? 'move' : 'default', pointerEvents: refDraggable ? 'auto' : 'none',
    ...copyrightFontCss(copyrightStyle),
  };
  if (copyrightStyle?.pos) {
    refStyleObj.left = `${copyrightStyle.pos.x}%`;
    refStyleObj.top = `${copyrightStyle.pos.y}%`;
  } else {
    refStyleObj.bottom = '40px';
    if (refAlign === 'right') refStyleObj.right = '60px';
    else if (refAlign === 'left') refStyleObj.left = '60px';
    else { refStyleObj.left = '50%'; refStyleObj.transform = 'translateX(-50%)'; }
  }

  const tb  = style?.textBox || { x: 5, y: 5, w: 90, h: 90 };
  const tbL = (tb.x / 100) * SLIDE_W;
  const tbT = (tb.y / 100) * SLIDE_H;
  const tbW = (tb.w / 100) * SLIDE_W;
  const tbH = (tb.h / 100) * SLIDE_H;

  const textBoxCss = {
    position:       'absolute',
    left:           `${tbL}px`,
    top:            `${tbT}px`,
    width:          `${tbW}px`,
    height:         `${tbH}px`,
    display:        'flex',
    flexDirection:  'column',
    justifyContent: style?.verticalAlign === 'top' ? 'flex-start' : style?.verticalAlign === 'bottom' ? 'flex-end' : 'center',
    overflow:       'hidden',
    boxSizing:      'border-box',
    // Frosted glass panel (treatment.glass) supersedes the plain boxFill. Native px so
    // the canvas transform:scale shrinks it to match output (like fontSize).
    ...(glassBoxStyle(style, 1) || buildBoxFillCss(style?.boxFill)),
  };

  const textCss = {
    fontFamily:          style?.fontFamily || undefined,
    fontSize:            `${style?.fontSize ?? 72}px`,
    fontWeight:          style?.bold ? 700 : 400,
    fontStyle:           style?.italic ? 'italic' : 'normal',
    textDecoration:      buildDecorationCss(style),
    color:               style?.color || '#ffffff',
    textAlign:           style?.align || 'center',
    lineHeight:          style?.lineSpacing ? String(style.lineSpacing) : '1.25',
    letterSpacing:       style?.letterSpacing ? `${style.letterSpacing}em` : undefined,
    textTransform:       style?.uppercase ? 'uppercase' : 'none',
    textShadow:          buildShadowCss(style?.textShadow),
    WebkitTextStroke:    buildStrokeCss(style?.textStroke),
    whiteSpace:          'pre-wrap',
    wordBreak:           'break-word',
    width:               '100%',
  };

  const rendered = renderTextContent(text || '', runs || [], style);

  return (
    <div
      ref={wrapRef}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}
    >
      {/* Smart-snap guide lines — % positions map 1:1 onto the 16:9 wrapper. */}
      <SnapGuides guides={guides} zIndex={40} />
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div style={{ width: `${SLIDE_W}px`, height: `${SLIDE_H}px`, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
          {/* Background — media asset wins; else a media theme's remote thumb
              (bgThumb, preview-only); else a theme's CSS gradient/solid (bgCss). */}
          {backgroundPath ? (
            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
              {/\.(mp4|webm|mov)$/i.test(backgroundPath)
                ? <BgVideo src={mediaUrl(backgroundPath)} speed={style?.bgSpeed} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <img src={mediaUrl(backgroundPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />}
            </div>
          ) : style?.bgThumb ? (
            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
              <img src={style.bgThumb} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
            </div>
          ) : style?.bgCss ? (
            <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: style.bgCss }} />
          ) : null}
          {/* Theme treatment stack (directional scrim, vignette, grain, grade) — mirrors
              output/fullscreen.js. No z-index so the grade blends with the bg above. */}
          <TreatmentOverlays style={style} />
          {/* Content window guide — safe area. Only while editable AND hovered, so a
              finished-looking preview (theme cards, monitors, read-only) stays clean. */}
          {tbDraggable && hovered && (
            <div style={{
              position: 'absolute',
              left: `${(CONTENT_BOX.x / 100) * SLIDE_W}px`, top: `${(CONTENT_BOX.y / 100) * SLIDE_H}px`,
              width: `${(CONTENT_BOX.w / 100) * SLIDE_W}px`, height: `${(CONTENT_BOX.h / 100) * SLIDE_H}px`,
              border: '1px dashed rgba(255,255,255,0.18)', boxSizing: 'border-box', zIndex: 1, pointerEvents: 'none',
            }} />
          )}

          {/* Text box content */}
          <div style={{ ...textBoxCss, zIndex: 2 }}>
            {isEditing ? (
              <div
                key="edit"
                ref={textEditRef}
                contentEditable
                suppressContentEditableWarning
                onBlur={handleCanvasBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); textEditRef.current?.blur(); }
                  e.stopPropagation();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{ ...textCss, outline: `${2 / scale}px solid rgba(255,255,255,0.75)`, caretColor: '#4d8eff', cursor: 'text' }}
              />
            ) : (
              <div key="static" style={textCss} dangerouslySetInnerHTML={{ __html: rendered }} />
            )}
          </div>

          {/* Text box selection frame (drag body to move) + resize handles */}
          {tbDraggable && !isEditing && (
            <div
              onPointerDown={(e) => startDrag(
                e,
                { x: tb.x, y: tb.y, w: tb.w, h: tb.h },
                (dx, dy, s, ev) => {
                  // Smart-snap to frame edges/centre/thirds + safe area (Alt = free).
                  const snapped = snapMove({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }, TB_SNAP_TARGETS, { free: ev?.altKey, grid: 0 });
                  setGuides(snapped.guides);
                  onTextBoxChange({
                    x: Math.round(clampPct(snapped.x, 0, 100 - s.w)),
                    y: Math.round(clampPct(snapped.y, 0, 100 - s.h)),
                    w: s.w, h: s.h,
                  });
                },
              )}
              onDoubleClick={onCanvasTextChange ? () => setIsEditing(true) : undefined}
              style={{
                position: 'absolute', left: `${tbL}px`, top: `${tbT}px`, width: `${tbW}px`, height: `${tbH}px`,
                border: '2px solid rgba(173,198,255,0.8)', boxSizing: 'border-box', zIndex: 3, cursor: 'move',
              }}
            >
              {TB_HANDLES.map((hnd, i) => {
                const hs = 14 / scale; // counter-scale so handles stay a constant visual size
                return (
                  <div
                    key={i}
                    onPointerDown={(e) => { e.stopPropagation(); startDrag(e, { x: tb.x, y: tb.y, w: tb.w, h: tb.h }, (dx, dy, s, ev) => {
                      const sized = resizeBox(s, hnd.hx, hnd.hy, dx, dy);
                      const { box: snapped, guides: g } = snapResizeBox(sized, hnd.hx, hnd.hy, TB_SNAP_TARGETS, { free: ev?.altKey, min: MIN_BOX });
                      setGuides(g);
                      onTextBoxChange({ x: Math.round(snapped.x), y: Math.round(snapped.y), w: Math.round(snapped.w), h: Math.round(snapped.h) });
                    }); }}
                    style={{
                      position: 'absolute', left: `${hnd.hx * 100}%`, top: `${hnd.hy * 100}%`,
                      width: hs, height: hs, transform: 'translate(-50%, -50%)',
                      background: '#adc6ff', border: '1px solid #0c0e12', borderRadius: 2, cursor: hnd.cursor, zIndex: 5,
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Copyright / reference — draggable; converts bottom-anchor → free position */}
          {copyright && (
            <div
              onPointerDown={refDraggable ? (e) => {
                let start;
                if (copyrightStyle?.pos) start = { x: copyrightStyle.pos.x, y: copyrightStyle.pos.y };
                else {
                  const wr = wrapRef.current.getBoundingClientRect();
                  const er = e.currentTarget.getBoundingClientRect();
                  start = { x: (er.left - wr.left) / scale / SLIDE_W * 100, y: (er.top - wr.top) / scale / SLIDE_H * 100 };
                }
                startDrag(e, start, (dx, dy, s) => onRefPosChange({ x: Math.round(clampPct(s.x + dx, 0, 100)), y: Math.round(clampPct(s.y + dy, 0, 100)) }));
              } : undefined}
              style={refStyleObj}
            >
              {copyright}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Lower Third Preview ──────────────────────────────────────────────────
// Matches lowerthird.css: transparent body, gradient bar anchored to bottom.

export function LowerThirdPreview({ text, runs, style, copyright, copyrightAlign, copyrightStyle }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    if (!wrapRef.current) return;
    const update = () => { if (wrapRef.current) setScale(wrapRef.current.offsetWidth / SLIDE_W); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Lower third gets its own resolved style (fullscreen look + any `lt` overrides).
  const s = resolveLtStyle(style);
  const accentCss = accentRuleStyle(s?.accent);

  // Approximate the output's lt.maxLines auto-shrink (output measures precisely; here we
  // scale by authored line count so the editor shows the cap working).
  const ltMax = Number(style?.lt?.maxLines) || 0;
  const ltLineCount = (text || '').split('\n').filter((l) => l.trim()).length || 1;
  const ltShrink = (ltMax > 0 && ltLineCount > ltMax) ? (ltMax / ltLineCount) : 1;

  const textCss = {
    fontFamily:       s?.fontFamily || undefined,
    fontSize:         `${(s?.fontSize ?? 48) * ltShrink}px`,
    fontWeight:       s?.bold ? 700 : 400,
    fontStyle:        s?.italic ? 'italic' : 'normal',
    textDecoration:   buildDecorationCss(s),
    color:            s?.color || '#ffffff',
    textAlign:        s?.align || 'center',
    lineHeight:       s?.lineSpacing ? String(s.lineSpacing) : '1.2',
    letterSpacing:    s?.letterSpacing ? `${s.letterSpacing}em` : undefined,
    textTransform:    s?.uppercase ? 'uppercase' : 'none',
    textShadow:       buildShadowCss(s?.textShadow) || '0 2px 8px rgba(0,0,0,0.6)',
    WebkitTextStroke: buildStrokeCss(s?.textStroke),
    whiteSpace:       'pre-wrap',
    wordBreak:        'break-word',
  };

  const copyrightStyleCss = {
    color: 'rgba(255,255,255,0.7)',
    fontSize: '18px',
    marginTop: '4px',
    ...copyrightCss(copyrightStyle, copyrightAlign === 'right' ? 'right' : 'left', false),
    paddingLeft: undefined, paddingRight: undefined, // lower-third bar has its own horizontal padding
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#111', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
      {/* Checkerboard to show transparency of the lower-third bar */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 0,
        backgroundImage: 'repeating-conic-gradient(#1a1a1a 0% 25%, #222 0% 50%)',
        backgroundSize: '20px 20px',
      }} />
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 1 }}>
        <div style={{ width: `${SLIDE_W}px`, height: `${SLIDE_H}px`, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
          {/* Lower third — form (band/box/pill/none) + anchor mirror output/lowerthird.js. */}
          {(() => {
            const form = style?.lt?.form || 'band';
            const anchor = style?.lt?.anchor || 'bottom';
            const barBg = buildBarBg(s?.ltBar);
            const isBoxed = form === 'box' || form === 'pill';
            const anchorCss = anchor === 'top' ? { top: 0, bottom: 'auto', justifyContent: 'flex-start' }
              : anchor === 'center' ? { top: 0, bottom: 0, justifyContent: 'center' }
              : { top: 'auto', bottom: 0, justifyContent: 'flex-end' };
            const alignItems = isBoxed ? (s?.align === 'left' ? 'flex-start' : s?.align === 'right' ? 'flex-end' : 'center') : undefined;
            const boxCss = isBoxed ? { display: 'inline-block', width: 'auto', background: barBg, padding: form === 'pill' ? '0.35em 1.1em' : '0.4em 0.85em', borderRadius: form === 'pill' ? '999px' : '16px' } : {};
            return (
              <div style={{
                position: 'absolute', left: 0, right: 0, ...anchorCss,
                padding: '24px 60px 32px',
                background: (form === 'none' || isBoxed) ? 'transparent' : barBg,
                minHeight: '160px',
                display: 'flex', flexDirection: 'column', alignItems,
                zIndex: 1,
              }}>
                <div style={{ ...textCss, ...boxCss }} dangerouslySetInnerHTML={{ __html: renderTextContent(text || '', runs || [], s) }} />
                {accentCss && <div style={accentCss} />}
                {copyright && <div style={copyrightStyleCss}>{copyright}</div>}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── Formatting Toolbar ────────────────────────────────────────────────────

function Divider() {
  return <div className="w-px h-5 bg-outline-variant/40 flex-shrink-0 mx-0.5" />;
}

function ToolBtn({ active, title, onMouseDown, children, className = '' }) {
  return (
    <button
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onMouseDown?.(); }}
      className={`h-6 min-w-[24px] px-1 flex items-center justify-center rounded transition-colors flex-shrink-0 cursor-pointer text-[12px] font-mono
        ${active ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant'} ${className}`}
    >{children}</button>
  );
}

function ColorSwatch({ value, onChange, title }) {
  return (
    <div className="relative flex-shrink-0" title={title}>
      <div className="w-6 h-6 rounded border border-outline-variant/50 cursor-pointer overflow-hidden" style={{ background: value || '#ffffff' }}>
        <input type="color" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value)}
          className="opacity-0 absolute inset-0 w-full h-full cursor-pointer" />
      </div>
    </div>
  );
}

function NumInput({ value, onChange, min, max, step = 0.1, width = 'w-12', placeholder }) {
  return (
    <input
      type="number" value={value ?? ''} min={min} max={max} step={step}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      onFocus={(e) => e.target.select()}
      className={`${width} bg-surface-container-lowest border border-outline-variant/40 text-on-surface text-[11px] rounded px-1 h-6 outline-none focus:border-primary text-center`}
    />
  );
}

// A toolbar submenu: compact trigger button + a portal-anchored popover panel.
// Portalled (fixed position from the trigger rect) so it never clips inside a
// narrow/overflow toolbar host (e.g. the presentation inspector). The trigger
// lights up while open OR when its group holds non-default styling, so advanced
// settings stay discoverable without permanent toolbar real estate.
function ToolMenu({ icon, label, title, active, width = 264, children }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({
        left: Math.min(Math.max(8, r.left), window.innerWidth - width - 8),
        top: Math.min(r.bottom + 4, window.innerHeight - 60),
      });
    };
    place();
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // Capture-phase Escape so closing the menu never also closes the host editor
    // (whose own Escape listener sits in the bubble phase on document).
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
    };
  }, [open, width]);

  return (
    <>
      <button
        ref={btnRef}
        title={title || label}
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        className={`h-6 px-1.5 flex items-center gap-[3px] rounded transition-colors flex-shrink-0 cursor-pointer text-[11px] font-mono tracking-[0.04em]
          ${open || active ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant'}`}
      >
        {icon && <span className="material-symbols-outlined text-[13px]">{icon}</span>}
        {label}
        <span className="material-symbols-outlined text-[13px] -mr-1">arrow_drop_down</span>
      </button>
      {open && createPortal(
        <div ref={panelRef}
          className="fixed z-[90] bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl p-md flex flex-col gap-sm max-h-[70vh] overflow-y-auto custom-scrollbar"
          style={{ left: pos.left, top: pos.top, width }}>
          {children}
        </div>,
        document.body
      )}
    </>
  );
}

function MenuRow({ label, children }) {
  return (
    <div className="flex items-center gap-sm min-h-6">
      <span className="text-[11px] font-mono text-on-surface-variant/60 flex-1">{label}</span>
      {children}
    </div>
  );
}

function MenuSection({ children }) {
  return (
    <div className="flex items-center gap-sm pt-xs first:pt-0">
      <span className="text-[11px] font-mono font-bold text-on-surface-variant">{children}</span>
      <span className="flex-1 h-px bg-outline-variant/30" />
    </div>
  );
}

// One-click shadow looks — each writes a complete textShadow config, tweakable after.
const SHADOW_PRESETS = [
  { id: 'soft', label: 'Soft', v: { enabled: true, color: '#000000', blur: 24, x: 0, y: 4 } },
  { id: 'hard', label: 'Hard', v: { enabled: true, color: '#000000', blur: 2, x: 3, y: 3 } },
  { id: 'glow', label: 'Glow', v: { enabled: true, color: '#ffffff', blur: 30, x: 0, y: 0 } },
];

export function FormattingToolbar({ style, onChange, fonts, hasSelection, execCmd, previewTemplate, simple = false, allowBoxFill = true }) {
  const set = (prop, val) => onChange({ ...style, [prop]: val });

  const shadow = style.textShadow;
  const stroke = style.textStroke;
  const fill   = style.boxFill;
  const tb     = style.textBox || { x: 5, y: 5, w: 90, h: 90 };

  const shadowEnabled = shadow?.enabled ?? false;
  const strokeEnabled = stroke?.enabled ?? false;
  const fillEnabled   = fill?.enabled ?? false;

  function toggleShadow() {
    if (!shadow) onChange({ ...style, textShadow: { enabled: true, color: '#000000', blur: 16, x: 0, y: 2 } });
    else onChange({ ...style, textShadow: { ...shadow, enabled: !shadow.enabled } });
  }
  function toggleStroke() {
    if (!stroke) onChange({ ...style, textStroke: { enabled: true, color: '#000000', width: 2 } });
    else onChange({ ...style, textStroke: { ...stroke, enabled: !stroke.enabled } });
  }
  function toggleBoxFill() {
    if (!fill) onChange({ ...style, boxFill: { enabled: true, color: '#000000', opacity: 0.5, radius: 16, pad: 32 } });
    else onChange({ ...style, boxFill: { ...fill, enabled: !fill.enabled } });
  }

  // Submenu triggers light up when their group holds non-default styling.
  const spacingActive = !!(style.lineSpacing || style.paragraphSpacing || style.letterSpacing || style.bulletSpacing);
  const effectsActive = shadowEnabled || strokeEnabled || !!style.bgScrim;
  const listActive    = !!style.listStyle;
  const boxActive     = !!style.textBox || fillEnabled;
  function setTb(prop, val) {
    const cur = style.textBox || { ...CONTENT_BOX };
    onChange({ ...style, textBox: { ...cur, [prop]: Number(val) } });
  }

  // Object align: snap the text box within the fixed content window (keeps its size).
  function objAlign(axis, where) {
    const b = style.textBox || { ...CONTENT_BOX };
    if (axis === 'h') {
      const x = where === 'left' ? CONTENT_BOX.x
        : where === 'right' ? CONTENT_BOX.x + CONTENT_BOX.w - b.w
        : CONTENT_BOX.x + (CONTENT_BOX.w - b.w) / 2;
      onChange({ ...style, textBox: { ...b, x: Math.round(Math.max(0, Math.min(x, 100 - b.w))) } });
    } else {
      const y = where === 'top' ? CONTENT_BOX.y
        : where === 'bottom' ? CONTENT_BOX.y + CONTENT_BOX.h - b.h
        : CONTENT_BOX.y + (CONTENT_BOX.h - b.h) / 2;
      onChange({ ...style, textBox: { ...b, y: Math.round(Math.max(0, Math.min(y, 100 - b.h))) } });
    }
  }

  const row = 'flex items-center gap-1 px-md py-1.5 flex-wrap';

  return (
    <div className="border-b border-outline-variant/30 bg-surface-container">
      {/* Row 1: Font + basic style + alignment */}
      <div className={row}>
        {/* Font family */}
        <select
          value={style.fontFamily || ''}
          onChange={(e) => set('fontFamily', e.target.value || null)}
          className="bg-surface-container-high text-on-surface text-[12px] rounded px-1.5 h-6 border border-outline-variant/50 w-32 outline-none focus:border-primary cursor-pointer flex-shrink-0"
        >
          <option value="">Default Font</option>
          {(() => {
            // Group by category; bundled fonts first within each so the shipped,
            // pixel-identical faces sit at the top of the list.
            const GROUPS = [
              { key: 'custom',     label: 'My Fonts' },
              { key: 'sans-serif', label: 'Sans-serif' },
              { key: 'serif',      label: 'Serif' },
              { key: 'slab',       label: 'Slab' },
              { key: 'display',    label: 'Display' },
              { key: 'script',     label: 'Script' },
              { key: 'monospace',  label: 'Monospace' },
            ];
            return GROUPS.map(({ key, label }) => {
              const items = fonts
                .filter((f) => (f.category || 'sans-serif') === key)
                .sort((a, b) => (b.bundled ? 1 : 0) - (a.bundled ? 1 : 0));
              if (!items.length) return null;
              return (
                <optgroup key={key} label={label}>
                  {items.map((f) => (
                    <option key={f.family} value={f.family}>{f.label}{f.bundled ? '' : ' ·'}</option>
                  ))}
                </optgroup>
              );
            });
          })()}
        </select>

        {/* Font size — free entry (any px) with the preset ladder as a datalist,
            so operators can both type an exact size and pick a common one. */}
        <input
          type="number" list="cue-font-sizes" min={6} max={500} step={1}
          value={style.fontSize ?? ''}
          placeholder="Size"
          title="Font size (px) — type any value or pick a preset"
          onChange={(e) => set('fontSize', e.target.value === '' ? null : Number(e.target.value))}
          onBlur={(e) => { const v = e.target.value; if (v !== '') set('fontSize', Math.max(6, Math.min(500, Number(v) || 6))); }}
          onFocus={(e) => e.target.select()}
          className="bg-surface-container-high text-on-surface text-[12px] rounded px-1 h-6 border border-outline-variant/50 w-[58px] outline-none focus:border-primary flex-shrink-0 text-center"
        />
        <datalist id="cue-font-sizes">{FONT_SIZES.map((s) => <option key={s} value={s} />)}</datalist>

        {/* Text color */}
        <ColorSwatch value={style.color || '#ffffff'} onChange={(v) => set('color', v)} title="Text colour" />

        <Divider />

        {/* Bold */}
        <ToolBtn active={style.bold} title="Bold" onMouseDown={() => {
          if (hasSelection()) execCmd('bold');
          else set('bold', !style.bold);
        }} className="font-bold">B</ToolBtn>

        {/* Italic */}
        <ToolBtn active={style.italic} title="Italic" onMouseDown={() => {
          if (hasSelection()) execCmd('italic');
          else set('italic', !style.italic);
        }} className="italic">I</ToolBtn>

        {/* Underline */}
        <ToolBtn active={style.underline} title="Underline" onMouseDown={() => {
          if (hasSelection()) execCmd('underline');
          else set('underline', !style.underline);
        }} className="underline">U</ToolBtn>

        {/* Strikethrough */}
        <ToolBtn active={style.strikethrough} title="Strikethrough" onMouseDown={() => {
          if (hasSelection()) execCmd('strikeThrough');
          else set('strikethrough', !style.strikethrough);
        }} className="line-through">S</ToolBtn>

        {/* Uppercase */}
        <ToolBtn active={style.uppercase} title="Uppercase" onMouseDown={() => set('uppercase', !style.uppercase)}>
          AA
        </ToolBtn>

        <Divider />

        {/* H-Align */}
        {[
          { v: 'left',    icon: '≡', label: 'Align left' },
          { v: 'center',  icon: '≡', label: 'Align centre' },
          { v: 'right',   icon: '≡', label: 'Align right' },
          { v: 'justify', icon: '≡', label: 'Justify' },
        ].map(({ v, icon, label: lbl }, i) => (
          <ToolBtn key={v} active={style.align === v} title={lbl} onMouseDown={() => set('align', v)}>
            <svg width="12" height="10" viewBox="0 0 12 10" fill="currentColor">
              {i === 0 && (<><rect x="0" y="0" width="12" height="1.5" rx=".7"/><rect x="0" y="4" width="8" height="1.5" rx=".7"/><rect x="0" y="8" width="10" height="1.5" rx=".7"/></>)}
              {i === 1 && (<><rect x="0" y="0" width="12" height="1.5" rx=".7"/><rect x="2" y="4" width="8" height="1.5" rx=".7"/><rect x="1" y="8" width="10" height="1.5" rx=".7"/></>)}
              {i === 2 && (<><rect x="0" y="0" width="12" height="1.5" rx=".7"/><rect x="4" y="4" width="8" height="1.5" rx=".7"/><rect x="2" y="8" width="10" height="1.5" rx=".7"/></>)}
              {i === 3 && (<><rect x="0" y="0" width="12" height="1.5" rx=".7"/><rect x="0" y="4" width="12" height="1.5" rx=".7"/><rect x="0" y="8" width="12" height="1.5" rx=".7"/></>)}
            </svg>
          </ToolBtn>
        ))}

        {!simple && <Divider />}

        {/* V-Align */}
        {!simple && [
          { v: 'top',    icon: '⬆', label: 'Align top' },
          { v: 'center', icon: '⊟', label: 'Align middle' },
          { v: 'bottom', icon: '⬇', label: 'Align bottom' },
        ].map(({ v, icon, label: lbl }) => (
          <ToolBtn key={v} active={style.verticalAlign === v} title={lbl} onMouseDown={() => set('verticalAlign', v)}>
            {icon}
          </ToolBtn>
        ))}

        {!styleIsDefault(style) && (
          <>
            <Divider />
            <ToolBtn title="Reset all styles" onMouseDown={() => onChange({ ...DEFAULT_STYLE })}>
              <span className="text-[11px] text-error/70 hover:text-error">Reset</span>
            </ToolBtn>
          </>
        )}
      </div>

      {/* Row 2: organised submenus — advanced styling grouped ProPresenter-style so
          the frequent controls above stay one click away. Each trigger lights up
          when its group holds non-default styling, so nothing hides silently. */}
      <div className={`${row} border-t border-outline-variant/20`}>

        <ToolMenu icon="format_line_spacing" label="Spacing" active={spacingActive} title="Line, paragraph and letter spacing">
          <MenuRow label="Line height">
            <NumInput value={style.lineSpacing} onChange={(v) => set('lineSpacing', v)} min={0.5} max={4} step={0.05} width="w-14" placeholder="1.25" />
          </MenuRow>
          <MenuRow label="Paragraph gap (em)">
            <NumInput value={style.paragraphSpacing} onChange={(v) => set('paragraphSpacing', v)} min={0} max={4} step={0.05} width="w-14" placeholder="0" />
          </MenuRow>
          <MenuRow label="Letter tracking (em)">
            <NumInput value={style.letterSpacing} onChange={(v) => set('letterSpacing', v)} min={-0.2} max={1} step={0.01} width="w-14" placeholder="0" />
          </MenuRow>
        </ToolMenu>

        <ToolMenu icon="blur_on" label="Effects" active={effectsActive} title="Shadow, outline and background scrim">
          <MenuSection>Shadow</MenuSection>
          <MenuRow label="Enabled">
            <ToolBtn active={shadowEnabled} title="Toggle text shadow" onMouseDown={toggleShadow}>{shadowEnabled ? 'On' : 'Off'}</ToolBtn>
          </MenuRow>
          <MenuRow label="Preset">
            <div className="flex gap-[3px]">
              {SHADOW_PRESETS.map((p) => (
                <ToolBtn key={p.id} title={`${p.label} shadow`} onMouseDown={() => onChange({ ...style, textShadow: { ...p.v } })}>{p.label}</ToolBtn>
              ))}
            </div>
          </MenuRow>
          {shadowEnabled && shadow && (
            <>
              <MenuRow label="Colour">
                <ColorSwatch value={shadow.color || '#000000'} onChange={(v) => onChange({ ...style, textShadow: { ...shadow, color: v } })} title="Shadow colour" />
              </MenuRow>
              <MenuRow label="Blur">
                <NumInput value={shadow.blur ?? 16} onChange={(v) => onChange({ ...style, textShadow: { ...shadow, blur: v } })} min={0} max={100} step={1} width="w-14" />
              </MenuRow>
              <MenuRow label="Offset X / Y">
                <div className="flex gap-[3px]">
                  <NumInput value={shadow.x ?? 0} onChange={(v) => onChange({ ...style, textShadow: { ...shadow, x: v } })} min={-50} max={50} step={1} width="w-12" />
                  <NumInput value={shadow.y ?? 2} onChange={(v) => onChange({ ...style, textShadow: { ...shadow, y: v } })} min={-50} max={50} step={1} width="w-12" />
                </div>
              </MenuRow>
            </>
          )}
          <MenuSection>Outline</MenuSection>
          <MenuRow label="Enabled">
            <ToolBtn active={strokeEnabled} title="Toggle text outline" onMouseDown={toggleStroke}>{strokeEnabled ? 'On' : 'Off'}</ToolBtn>
          </MenuRow>
          {strokeEnabled && stroke && (
            <>
              <MenuRow label="Colour">
                <ColorSwatch value={stroke.color || '#000000'} onChange={(v) => onChange({ ...style, textStroke: { ...stroke, color: v } })} title="Outline colour" />
              </MenuRow>
              <MenuRow label="Width">
                <NumInput value={stroke.width ?? 2} onChange={(v) => onChange({ ...style, textStroke: { ...stroke, width: v } })} min={0.5} max={20} step={0.5} width="w-14" />
              </MenuRow>
            </>
          )}
          {/* Background scrim — darken the background (transparent → black) for
              legibility on bright displays. Fullscreen only; lower-third has its bar. */}
          {previewTemplate !== 'lowerthird' && (
            <>
              <MenuSection>Background scrim</MenuSection>
              <MenuRow label={`Darken · ${Math.round((style.bgScrim ?? 0) * 100)}%`}>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={style.bgScrim ?? 0}
                  onChange={(e) => set('bgScrim', Number(e.target.value) || null)}
                  className="w-24 accent-primary cursor-pointer"
                  title="Background scrim (transparent → black)"
                />
              </MenuRow>
            </>
          )}
        </ToolMenu>

        <ToolMenu icon="format_list_bulleted" label="List" active={listActive} title="Bullet / numbered list">
          <MenuRow label="Style">
            <div className="flex gap-[3px]">
              <ToolBtn active={!style.listStyle} title="No list" onMouseDown={() => set('listStyle', null)}>None</ToolBtn>
              <ToolBtn active={style.listStyle === 'disc'} title="Unordered bullet list" onMouseDown={() => set('listStyle', 'disc')}>
                <span className="material-symbols-outlined text-[13px]">format_list_bulleted</span>
              </ToolBtn>
              <ToolBtn active={style.listStyle === 'decimal'} title="Numbered list" onMouseDown={() => set('listStyle', 'decimal')}>
                <span className="material-symbols-outlined text-[13px]">format_list_numbered</span>
              </ToolBtn>
            </div>
          </MenuRow>
          {style.listStyle && (
            <MenuRow label="Item gap (em)">
              <NumInput value={style.bulletSpacing} onChange={(v) => set('bulletSpacing', v)} min={0} max={4} step={0.05} width="w-14" placeholder="0" />
            </MenuRow>
          )}
        </ToolMenu>

        {/* Text box — object-align in the safe area, precise X/Y/W/H, fill panel. */}
        {!simple && previewTemplate !== 'lowerthird' && (
          <ToolMenu icon="crop_free" label="Box" active={boxActive} width={280} title="Text box position, size and fill">
            <MenuSection>Position &amp; size</MenuSection>
            <MenuRow label="Align in safe area">
              <div className="flex gap-[2px]">
                {[
                  { axis: 'h', where: 'left',   icon: 'align_horizontal_left',   t: 'Align box left' },
                  { axis: 'h', where: 'center', icon: 'align_horizontal_center', t: 'Centre box horizontally' },
                  { axis: 'h', where: 'right',  icon: 'align_horizontal_right',  t: 'Align box right' },
                  { axis: 'v', where: 'top',    icon: 'align_vertical_top',      t: 'Align box top' },
                  { axis: 'v', where: 'middle', icon: 'align_vertical_center',   t: 'Centre box vertically' },
                  { axis: 'v', where: 'bottom', icon: 'align_vertical_bottom',   t: 'Align box bottom' },
                ].map(({ axis, where, icon, t }) => (
                  <ToolBtn key={`${axis}-${where}`} title={t} onMouseDown={() => objAlign(axis, where)}>
                    <span className="material-symbols-outlined text-[13px]">{icon}</span>
                  </ToolBtn>
                ))}
              </div>
            </MenuRow>
            <MenuRow label="Fill safe area">
              <ToolBtn title="Size the box to the full content window" onMouseDown={() => set('textBox', { ...CONTENT_BOX })}>Fit</ToolBtn>
            </MenuRow>
            <MenuRow label="X / Y (%)">
              <div className="flex gap-[3px]">
                <NumInput value={tb.x} onChange={(v) => setTb('x', v)} min={0} max={100} step={1} width="w-12" />
                <NumInput value={tb.y} onChange={(v) => setTb('y', v)} min={0} max={100} step={1} width="w-12" />
              </div>
            </MenuRow>
            <MenuRow label="W / H (%)">
              <div className="flex gap-[3px]">
                <NumInput value={tb.w} onChange={(v) => setTb('w', v)} min={1} max={100} step={1} width="w-12" />
                <NumInput value={tb.h} onChange={(v) => setTb('h', v)} min={1} max={100} step={1} width="w-12" />
              </div>
            </MenuRow>
            {allowBoxFill && (
              <>
                <MenuSection>Box fill</MenuSection>
                <MenuRow label="Fill panel behind text">
                  <ToolBtn active={fillEnabled} title="Toggle a colour panel behind the text box (legibility on busy backgrounds)" onMouseDown={toggleBoxFill}>
                    {fillEnabled ? 'On' : 'Off'}
                  </ToolBtn>
                </MenuRow>
                {fillEnabled && fill && (
                  <>
                    <MenuRow label="Colour">
                      <ColorSwatch value={fill.color || '#000000'} onChange={(v) => onChange({ ...style, boxFill: { ...fill, color: v } })} title="Fill colour" />
                    </MenuRow>
                    <MenuRow label="Opacity">
                      <NumInput value={fill.opacity ?? 0.5} onChange={(v) => onChange({ ...style, boxFill: { ...fill, opacity: v } })} min={0} max={1} step={0.05} width="w-14" />
                    </MenuRow>
                    <MenuRow label="Corner radius (px)">
                      <NumInput value={fill.radius ?? 16} onChange={(v) => onChange({ ...style, boxFill: { ...fill, radius: v } })} min={0} max={200} step={1} width="w-14" />
                    </MenuRow>
                    <MenuRow label="Padding (px)">
                      <NumInput value={fill.pad ?? 32} onChange={(v) => onChange({ ...style, boxFill: { ...fill, pad: v } })} min={0} max={200} step={1} width="w-14" />
                    </MenuRow>
                  </>
                )}
              </>
            )}
          </ToolMenu>
        )}

        {/* Reference position — fullscreen reference styling only (drag in preview or set X/Y) */}
        {simple && previewTemplate !== 'lowerthird' && (
          <ToolMenu icon="place_item" label="Position" active={!!style.pos} title="Reference anchor / free position">
            <MenuRow label="Anchor">
              <div className="flex gap-[3px]">
                <ToolBtn active={!style.pos} title="Anchor to bottom" onMouseDown={() => set('pos', null)}>Bottom</ToolBtn>
                <ToolBtn active={!!style.pos} title="Free position (drag in preview)" onMouseDown={() => set('pos', style.pos || { x: 50, y: 90 })}>Free</ToolBtn>
              </div>
            </MenuRow>
            {style.pos && (
              <MenuRow label="X / Y (%)">
                <div className="flex gap-[3px]">
                  <NumInput value={style.pos.x} onChange={(v) => set('pos', { ...style.pos, x: Number(v) })} min={0} max={100} step={1} width="w-12" />
                  <NumInput value={style.pos.y} onChange={(v) => set('pos', { ...style.pos, y: Number(v) })} min={0} max={100} step={1} width="w-12" />
                </div>
              </MenuRow>
            )}
            <p className="text-[11px] font-mono text-on-surface-variant/60 leading-relaxed m-0">In Free mode, drag the reference anywhere in the preview.</p>
          </ToolMenu>
        )}

        {/* Gradient bar — lower third only */}
        {!simple && previewTemplate === 'lowerthird' && (
          <ToolMenu icon="gradient" label="Bar" active={!!style.ltBar} title="Lower-third gradient bar">
            <MenuRow label="Enabled">
              <ToolBtn active={!!style.ltBar} title="Toggle gradient bar" onMouseDown={() => {
                onChange({ ...style, ltBar: style.ltBar ? null : { color: '#000000', opacity: 0.8, solid: false } });
              }}>
                {style.ltBar ? 'On' : 'Off'}
              </ToolBtn>
            </MenuRow>
            {style.ltBar && (
              <>
                <MenuRow label="Colour">
                  <ColorSwatch value={style.ltBar.color || '#000000'} onChange={(v) => onChange({ ...style, ltBar: { ...style.ltBar, color: v } })} title="Bar colour" />
                </MenuRow>
                <MenuRow label="Opacity">
                  <NumInput value={style.ltBar.opacity ?? 0.8} onChange={(v) => onChange({ ...style, ltBar: { ...style.ltBar, opacity: Number(v) } })} min={0} max={1} step={0.05} width="w-14" />
                </MenuRow>
                <MenuRow label="Solid (no fade)">
                  <ToolBtn active={!!style.ltBar.solid} title="Solid bar (no fade to transparent)" onMouseDown={() => onChange({ ...style, ltBar: { ...style.ltBar, solid: !style.ltBar.solid } })}>
                    {style.ltBar.solid ? 'On' : 'Off'}
                  </ToolBtn>
                </MenuRow>
              </>
            )}
          </ToolMenu>
        )}
      </div>
    </div>
  );
}

// ─── Section sidebar item ─────────────────────────────────────────────────

const TYPE_COLORS = {
  chorus: 'text-primary bg-primary/10 border-primary/40',
  refrain: 'text-primary bg-primary/10 border-primary/40',
  bridge: 'text-tertiary bg-tertiary/10 border-tertiary/40',
  default: 'text-on-surface-variant bg-surface-variant/30 border-outline-variant/30',
};

// ── Arrangement panel (played order of sections, ProPresenter-style) ─────────
// A compact list at the bottom of the sections sidebar. Entries reference
// sections by _key (repeats allowed) and are draggable to reorder; ids are
// position-composed (`i:key`) so repeated sections stay individually sortable.
function SortableArrangementRow({ rid, label, typeColor, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rid });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="group flex items-center gap-1.5 px-sm py-[3px] border-b border-outline-variant/10"
    >
      <button
        className="cursor-grab text-on-surface-variant/60 hover:text-on-surface-variant flex-shrink-0 transition-colors"
        {...attributes} {...listeners} tabIndex={-1}
      >
        <svg width="7" height="10" viewBox="0 0 7 10" fill="currentColor">
          <circle cx="1.5" cy="1.5" r="1.2"/><circle cx="5.5" cy="1.5" r="1.2"/>
          <circle cx="1.5" cy="5" r="1.2"/><circle cx="5.5" cy="5" r="1.2"/>
          <circle cx="1.5" cy="8.5" r="1.2"/><circle cx="5.5" cy="8.5" r="1.2"/>
        </svg>
      </button>
      <span className={`text-label-sm font-semibold truncate flex-1 rounded px-sm ${typeColor}`}>
        {label}
      </span>
      <button
        onClick={onRemove}
        tabIndex={-1}
        title="Remove from arrangement"
        className="opacity-0 group-hover:opacity-100 text-on-surface-variant/60 hover:text-error transition-all cursor-pointer flex items-center"
      >
        <span className="material-symbols-outlined text-[12px]">close</span>
      </button>
    </div>
  );
}

function ArrangementPanel({ sections, arrangement, onChange }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const labels = sectionLabels(sections);
  const byKey = new Map(sections.map((s, i) => [s._key, { label: labels[i], color: TYPE_COLORS[s.type] || TYPE_COLORS.default }]));
  const active = Array.isArray(arrangement) && arrangement.length > 0;
  const rows = active
    ? arrangement.map((k, i) => ({ rid: `${i}:${k}`, key: k, ...(byKey.get(k) || { label: 'Removed', color: 'text-on-surface-variant/60' }) }))
    : [];

  function onDragEnd({ active: a, over }) {
    if (!over || a.id === over.id) return;
    const oi = rows.findIndex((r) => r.rid === a.id);
    const ni = rows.findIndex((r) => r.rid === over.id);
    if (oi < 0 || ni < 0) return;
    onChange(arrayMove([...arrangement], oi, ni));
  }

  // Collapsed by default to a one-line summary ("V1 · C · V2 · C · B") so the lyrics
  // keep the room; expand to reorder / repeat.
  const [open, setOpen] = useState(false);
  const short = (l) => l.replace(/^Verse /, 'V').replace(/^Chorus ?/, 'C').replace(/^Pre-Chorus ?/, 'PC').replace(/^Bridge ?/, 'B').replace(/^Refrain ?/, 'R');
  const summary = (active ? rows.map((r) => r.label) : labels).map(short).join(' · ');

  return (
    <div className={`border-t border-outline-variant/30 bg-surface-container/40 flex flex-col flex-shrink-0 ${open ? 'max-h-[40%]' : ''}`}>
      <div className="px-md py-sm flex items-center gap-sm flex-shrink-0">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-xs min-w-0 flex-1 text-left cursor-pointer group/arr"
          title="The order sections play live. Repeats allowed — e.g. V1 C V2 C B C C."
        >
          <span className="material-symbols-outlined text-[18px] text-on-surface-variant">{open ? 'expand_more' : 'chevron_right'}</span>
          <span className="text-body-md text-on-surface shrink-0">Play order</span>
          <span className="text-label-sm text-on-surface-variant truncate tabular-nums group-hover/arr:text-on-surface">
            {summary || '—'}{active ? '' : ' (as written)'}
          </span>
        </button>
        {active ? (
          <button
            onClick={() => onChange(null)}
            title="Back to the natural section order"
            className="shrink-0 text-label-sm text-on-surface-variant hover:text-error cursor-pointer transition-colors"
          >
            Reset
          </button>
        ) : (
          <button
            onClick={() => { onChange(sections.map((s) => s._key)); setOpen(true); }}
            disabled={!sections.length}
            title="Create a custom played order (starts from the natural order)"
            className="shrink-0 text-label-sm text-primary hover:text-primary/80 cursor-pointer transition-colors disabled:opacity-40"
          >
            Customise
          </button>
        )}
      </div>
      {active && open && (
        <>
          <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={rows.map((r) => r.rid)} strategy={verticalListSortingStrategy}>
                {rows.map((r, i) => (
                  <SortableArrangementRow
                    key={r.rid}
                    rid={r.rid}
                    label={r.label}
                    typeColor={r.color}
                    onRemove={() => {
                      const next = arrangement.filter((_, j) => j !== i);
                      onChange(next.length ? next : null);
                    }}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          <select
            value=""
            onChange={(e) => { const k = e.target.value; if (k) onChange([...arrangement, k]); }}
            className="mx-md my-sm text-label-sm text-primary bg-surface-container-lowest border border-outline-variant/40 rounded-md px-sm h-7 outline-none cursor-pointer flex-shrink-0"
          >
            <option value="">+ Add a section to the play order…</option>
            {sections.map((s, i) => (
              <option key={s._key} value={s._key} className="bg-surface-container text-on-surface normal-case font-normal">{labels[i]}</option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

// ─── Continuous song document (EasyWorship-style) ───────────────────────────
// The whole song is ONE contentEditable. Each section starts with a non-editable
// header line (slide number + label, `data-head` carrying the section's _key and
// type); the editable text up to the next header is that section's lyrics. A ⁂
// slide break inside a section renders as a numbered, non-editable `data-break`
// line, so every display slide gets its own number like EasyWorship's Words pane.
// DOM → sections on every input (extractSongSections); sections → DOM only on
// load / structural edits / undo (renderSongHtml), so typing never loses the caret.

const HEAD_TONE = {
  chorus: 'text-primary', refrain: 'text-primary', 'pre-chorus': 'text-primary',
  bridge: 'text-tertiary', tag: 'text-tertiary',
};

function headHtml(sec, label) {
  const tone = HEAD_TONE[sec.type] || 'text-on-surface';
  return `<div data-head="1" data-key="${esc(sec._key)}" data-type="${esc(sec.type)}" contenteditable="false" `
    + `class="flex items-baseline gap-sm pt-[10px] pb-[1px] select-none cursor-pointer group/head" title="Change type, move or delete this section">`
    + `<span data-num class="w-6 shrink-0 text-right text-[11px] tabular-nums text-on-surface-variant/70"></span>`
    + `<span data-label class="text-[12px] font-semibold ${tone} group-hover/head:underline">${esc(label)}</span>`
    + `<span class="material-symbols-outlined text-[14px] leading-none text-on-surface-variant/60 opacity-0 group-hover/head:opacity-100">expand_more</span>`
    + `</div>`;
}

// A slide break as the editor shows it: the next slide's number in the gutter.
const EDITOR_BREAK_HTML =
  '<div data-break="1" contenteditable="false" class="flex items-center gap-sm pt-[8px] pb-[1px] -ml-8 select-none">'
  + '<span data-num class="w-6 shrink-0 text-right text-[11px] tabular-nums text-on-surface-variant/70"></span>'
  + '<span class="text-[11px] italic text-on-surface-variant/60">continues</span>'
  + '<span class="flex-1 h-px bg-outline-variant/30"></span>'
  + '</div>';

function bodyInnerHtml(content, runs) {
  const html = renderWithRuns(content || '', runs || []).replace(/(?:<br>)?⁂(?:<br>)?/g, EDITOR_BREAK_HTML);
  return html || '<br>';
}

// Selector for a section's header (keys are app-generated, but quote-escape anyway).
// Not CSS.escape: this file imports dnd-kit's `CSS`, which shadows the global.
const headSel = (key) => `[data-head][data-key="${String(key).replace(/["\\]/g, '\\$&')}"]`;

function renderSongHtml(sections) {
  const labels = sectionLabels(sections);
  return sections.map((sec, i) =>
    headHtml(sec, labels[i]) + `<div data-body="1" class="pl-8">${bodyInnerHtml(sec.content, sec.runs)}</div>`
  ).join('');
}

// Walk the editor: every data-head opens a section; all following nodes up to the
// next head are its body. Fields other than type/content/runs (id, style_json…) are
// carried over from the previous state by _key.
function extractSongSections(root, prev = []) {
  const prevByKey = new Map(prev.map((p) => [p._key, p]));
  const out = [];
  let cur = null;
  let buf = [];
  const flush = () => {
    if (!cur) return;
    const tmp = document.createElement('div');
    for (const n of buf) tmp.appendChild(n.cloneNode(true));
    const { text, runs } = extractContentAndRuns(tmp);
    out.push({ ...(prevByKey.get(cur._key) || {}), _key: cur._key, type: cur.type, content: text, runs });
    buf = [];
  };
  for (const node of root.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && node.dataset?.head) {
      flush();
      cur = { _key: node.dataset.key, type: node.dataset.type || 'verse' };
      continue;
    }
    if (!cur) continue; // ensureLeadHead() guarantees a head first
    buf.push(node);
  }
  flush();
  return out;
}

// Number every slide (heads + breaks, in document order) and refresh the labels
// (Verse 1 / Verse 2 numbering follows the live section list).
function renumberSong(root, sections) {
  let n = 0;
  for (const el of root.querySelectorAll('[data-head],[data-break]')) {
    n += 1;
    const num = el.querySelector('[data-num]');
    if (num) num.textContent = String(n);
  }
  const labels = sectionLabels(sections);
  root.querySelectorAll('[data-head]').forEach((h, i) => {
    const l = h.querySelector('[data-label]');
    if (l && labels[i] && l.textContent !== labels[i]) l.textContent = labels[i];
  });
}

// Lines typed/pasted as a section name on their own ("Chorus", "Verse 2 — Mary")
// become a new section, EasyWorship-style. Uses the shared header parser.
// Only sections in `onlyKeys` (the one just edited) are scanned, so an Enter in one
// section never restructures header-like lines elsewhere in an existing song.
function splitOnHeaderLines(sections, newKeyFn, onlyKeys) {
  let changed = false;
  let caretKey = null;
  const added = []; // [afterKey, newKey] — new sections join the play order after their source
  const out = [];
  for (const sec of sections) {
    if (onlyKeys && !onlyKeys.has(sec._key)) { out.push(sec); continue; }
    const lines = (sec.content || '').split('\n');
    let cur = { ...sec, content: '', runs: [] };
    let curStart = 0;       // char offset (in sec.content) where cur's text begins
    let acc = [];
    let offset = 0;
    const close = (endOffset) => {
      const text = acc.join('\n');
      const lead = text.match(/^\n*/)[0].length;
      const trimmed = text.replace(/^\n+/, '').replace(/\n+$/, '');
      const base = curStart + lead;
      cur.content = trimmed;
      cur.runs = (sec.runs || [])
        .filter((r) => r.end > base && r.start < base + trimmed.length)
        .map((r) => ({ ...r, start: Math.max(0, r.start - base), end: Math.min(trimmed.length, r.end - base) }));
      out.push(cur);
    };
    lines.forEach((line, i) => {
      const h = line.trim() && line.trim().length <= 40 && !line.includes(SLIDE_BREAK) ? parseHeaderLine(line) : null;
      if (h && !h.tail) {
        close(offset);
        changed = true;
        const prevKey = cur._key;
        cur = { _key: newKeyFn(), type: h.type, content: '', runs: [] };
        caretKey = cur._key;
        added.push([prevKey, cur._key]);
        acc = [];
        curStart = offset + line.length + 1;
      } else {
        acc.push(line);
      }
      offset += line.length + 1;
    });
    close(offset);
  }
  return { sections: out, changed, caretKey, added };
}

// ─── Paste view ───────────────────────────────────────────────────────────

function PasteView({ onParse, onCancel }) {
  const [text, setText] = useState('');
  return (
    <div className="flex flex-col gap-md p-lg flex-1">
      <p className="text-body-sm text-on-surface-variant leading-relaxed">
        Paste the song exactly as it was sent. Section labels like{' '}
        <span className="text-on-surface font-medium">Verse 1 — Mary</span>,{' '}
        <span className="text-on-surface font-medium">*Chorus x2*</span> or{' '}
        <span className="text-on-surface font-medium">Repeat Chorus</span> become sections; singer names,
        "All / Men / Leader" cues, chords and CCLI footers are removed.
      </p>
      <textarea
        autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={12}
        placeholder={"[Verse 1]\nAmazing grace, how sweet the sound\n\n[Chorus]\nPraise the Lord..."}
        className="w-full bg-surface-container-lowest text-on-surface text-body-sm rounded-lg px-md py-sm border border-outline-variant/50 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 resize-none font-mono leading-relaxed flex-1"
      />
      <div className="flex gap-sm">
        <button onClick={() => { const p = parseLyrics(text, { detectTitle: true }); if (p.sections.length) onParse(p); }}
          disabled={!text.trim()}
          className="px-lg h-8 text-label-sm font-mono bg-primary text-on-primary disabled:opacity-40 rounded-lg transition-colors cursor-pointer">
          Import Sections
        </button>
        <button onClick={onCancel}
          className="px-lg h-8 text-label-sm font-mono text-on-surface-variant hover:text-on-surface cursor-pointer rounded-lg hover:bg-surface-variant transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────

export default function SongEditor({ song, onClose, onSave }) {
  useModalGuard();
  const toast = useToast();
  // Undoable working document: the song fields, sections, style, background, lock
  // and tag selection. Ephemeral UI (active section, preview, modals, saving) stays
  // in plain useState below. Lyric edits flush into `sections` via history (coalesced
  // per section) on input; undo/redo then re-renders the contentEditable DOM.
  const doc = useEditHistory({
    title: '', author: '', copyright: '', sections: [],
    style: { ...DEFAULT_STYLE }, songBackground: null, bgLocked: false, selectedTagIds: [],
    arrangement: null, // played section order as _keys with repeats; null = natural
    maxLines: 0,       // per-song max lines/slide (0 = inherit the global default)
  });
  const { title, author, copyright, sections, style, songBackground, bgLocked, selectedTagIds, arrangement, maxLines } = doc.state;
  const field = (name, coalesce) => (updater) =>
    doc.set((d) => ({ ...d, [name]: typeof updater === 'function' ? updater(d[name]) : updater }), coalesce);
  const setTitle        = field('title', 'title');
  const setAuthor       = field('author', 'author');
  const setCopyright    = field('copyright', 'copyright');
  const setStyle        = field('style', 'style');
  const setSongBackground = field('songBackground');
  const setBgLocked     = field('bgLocked');
  const setSelectedTagIds = field('selectedTagIds');
  const setSections = (updater, coalesce) =>
    doc.set((d) => ({ ...d, sections: typeof updater === 'function' ? updater(d.sections) : updater }), coalesce);
  const setArrangement = (updater) =>
    doc.set((d) => ({ ...d, arrangement: typeof updater === 'function' ? updater(d.arrangement) : updater }));
  const setMaxLines = field('maxLines');
  const [domSyncTick, setDomSyncTick] = useState(0); // bumped on undo/redo to re-render the active section's DOM
  const handleUndo = useCallback(() => { doc.undo(); setDomSyncTick((t) => t + 1); }, [doc.undo]);
  const handleRedo = useCallback(() => { doc.redo(); setDomSyncTick((t) => t + 1); }, [doc.redo]);
  useUndoRedoKeys(handleUndo, handleRedo);

  const [allTags, setAllTags]     = useState([]);
  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [activeSectionKey, setActiveSectionKey] = useState(null);
  const [previewContent, setPreviewContent] = useState({ text: '', runs: [] });
  const [previewPart, setPreviewPart]       = useState(0); // which split part the preview shows
  const [globalBg, setGlobalBg]             = useState(null);  // live global song default (preview/badge fallback)
  const [showBgPicker, setShowBgPicker]     = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [bgLoading, setBgLoading]           = useState(false); // media-theme bg downloading
  const [showPaste, setShowPaste]         = useState(false);
  const [showMeta, setShowMeta]           = useState(true);
  const [previewTemplate, setPreviewTemplate] = useState('fullscreen'); // 'fullscreen' | 'lowerthird'
  const [saving, setSaving]               = useState(false);
  const [saveError, setSaveError]         = useState('');
  const [themeList, setThemeList]         = useState([]);

  const editorRef    = useRef(null);
  const sectionsRef  = useRef([]);
  const activeKeyRef = useRef(null);
  // Names set lists have used for this song (Paste Song List corrections).
  const [aliases, setAliases] = useState([]);
  useEffect(() => {
    if (!song?.id || !window.cue.songs.listAliases) { setAliases([]); return; }
    window.cue.songs.listAliases(song.id).then((a) => setAliases(Array.isArray(a) ? a : [])).catch(() => setAliases([]));
  }, [song?.id]);
  const sidebarRef   = useRef(null);   // lyrics document scroller
  const caretTarget  = useRef(null);   // { key, atEnd } — where to put the caret after a re-render
  const scanHeaders  = useRef(false);  // next input came from Enter/paste → look for typed section names
  const [headMenu, setHeadMenu] = useState(null); // { key, x, y } section menu from a header click
  const fonts        = useFonts();
  const sensors      = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Keep sectionsRef in sync
  useEffect(() => { sectionsRef.current = sections; }, [sections]);
  useEffect(() => { activeKeyRef.current = activeSectionKey; }, [activeSectionKey]);

  // Keep the active section visible as it changes (wheel/click), since the wheel
  // handler suppresses native list scrolling.
  useEffect(() => {
    if (!activeSectionKey || !sidebarRef.current) return;
    sidebarRef.current
      .querySelector(`[data-section-key="${activeSectionKey}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeSectionKey]);

  // Themes a song can adopt. Every theme is one portable look — any of them applies
  // to a song (its style normalises to the text shape). Graphics presets are separate.
  useEffect(() => {
    window.cue.themes.list()
      .then((list) => setThemeList((list || []).filter((t) => (t.category || 'song') !== 'graphic')))
      .catch(() => {});
  }, []);

  // The live global song background — shown as the preview fallback (and badged
  // "Global") when this song has no background of its own and isn't locked.
  useEffect(() => {
    window.cue.settings.get('global_bg_song_id')
      .then((id) => (id ? window.cue.media.get(id) : null))
      .then((bg) => setGlobalBg(bg ? { id: bg.id, path: bg.path } : null))
      .catch(() => {});
  }, []);

  async function handleLoadTheme(themeId) {
    const theme = themeList.find((t) => t.id === Number(themeId));
    if (!theme) return;
    try {
      const raw = theme.style_json ? JSON.parse(theme.style_json) : null;
      if (!raw) return;
      // Normalise any theme shape (incl. a presentation token theme) into the song
      // text style — one look applies to any content.
      const themeStyle = normalizeLookStyle(raw);
      const nextStyle = { ...DEFAULT_STYLE, ...themeStyle };
      // Loading a theme is explicit and ONE undo step — its background replaces the
      // current one. (A bgRef download applies the style now and the bg after fetch.)
      if (theme.background_id && theme.background_path) {
        doc.set((d) => ({ ...d, style: nextStyle, songBackground: { id: theme.background_id, path: theme.background_path, filename: theme.background_filename } }));
      } else if (raw.bgRef) {
        // Media theme whose background isn't downloaded yet — resolve the
        // background-library item (download → media asset), same as applyTo*.
        doc.set((d) => ({ ...d, style: nextStyle }));
        setBgLoading(true);
        try {
          const asset = await window.cue.backgrounds.download(raw.bgRef);
          setSongBackground({ id: asset.id, path: asset.path, filename: asset.filename });
        } catch {
          // Style applied, but the background couldn't be fetched — surface it
          // instead of silently leaving the old background in place.
          toast.error(`Couldn't download “${theme.name}” background`);
        }
        finally { setBgLoading(false); }
      } else if (themeStyle.bgCss) {
        // A CSS-gradient theme carries its background in the style; clear any media
        // background so the gradient (style.bgCss) actually shows.
        doc.set((d) => ({ ...d, style: nextStyle, songBackground: null }));
      } else {
        doc.set((d) => ({ ...d, style: nextStyle }));
      }
    } catch {}
  }

  // Load song data
  useEffect(() => {
    window.cue.tags.list().then(setAllTags);
    if (song?.id) {
      window.cue.songs.get(song.id).then((s) => {
        const firstStyled = (s.sections || []).find((sec) => sec.style_json);
        let st = { ...DEFAULT_STYLE };
        if (firstStyled) {
          const { runs: _r, ...base } = JSON.parse(firstStyled.style_json);
          st = { ...DEFAULT_STYLE, ...base };
        }
        const mapped = (s.sections || []).map((sec) => {
          const parsed = sec.style_json ? JSON.parse(sec.style_json) : {};
          return { ...sec, _key: String(sec.id), content: sec.content || '', runs: parsed.runs || [] };
        });
        // Stored arrangement is 0-based positions; hydrate to section _keys so it
        // survives in-session reorders and is re-serialized to positions on save.
        let arr = null;
        try {
          const idxs = s.arrangement_json ? JSON.parse(s.arrangement_json) : null;
          if (Array.isArray(idxs)) {
            arr = idxs.map((n) => mapped[Number(n)]?._key).filter(Boolean);
            if (!arr.length) arr = null;
          }
        } catch { arr = null; }
        // Seed via reset() so the DB hydrate is the baseline, not an undo step.
        doc.reset({
          title: s.title, author: s.author || '', copyright: s.copyright || '',
          sections: mapped, style: st,
          songBackground: (s.default_background_id && s.background_path)
            ? { id: s.default_background_id, path: s.background_path, filename: s.background_filename } : null,
          bgLocked: !!s.background_locked,
          selectedTagIds: (s.tags || []).map((t) => t.id),
          arrangement: arr,
          maxLines: Number(s.max_lines) > 0 ? Number(s.max_lines) : 0,
        });
        if (mapped.length) setActiveSectionKey(mapped[0]._key);
        setDomSyncTick((t) => t + 1);
      });
    } else {
      // New song — optionally seed title/lyrics from a prefill (e.g. the Paste
      // Song List modal creating a song it couldn't find in the library).
      const seeded = (song?.prefillSections || []).filter((s) => (s.content || '').trim());
      const mapped = seeded.length
        ? seeded.map((s) => ({ _key: newKey(), type: s.type || 'verse', content: s.content, runs: [] }))
        : [{ _key: newKey(), type: 'verse', content: '', runs: [] }];
      doc.reset({
        title: song?.prefillTitle || '', author: song?.prefillAuthor || '', copyright: song?.prefillCopyright || '',
        sections: mapped, style: { ...DEFAULT_STYLE }, songBackground: null, bgLocked: false, selectedTagIds: [],
        // Played order implied by the source paste (positions into prefillSections).
        arrangement: seeded.length && Array.isArray(song?.prefillArrangement)
          ? song.prefillArrangement.map((i) => mapped[i]?._key).filter(Boolean)
          : null,
        maxLines: 0,
      });
      setActiveSectionKey(mapped[0]._key);
      setDomSyncTick((t) => t + 1);
    }
  }, [song?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving && !showBgPicker) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving, showBgPicker]);

  // ── Continuous editor: state → DOM ─────────────────────────────────────
  // Re-render the whole song document from `sections` — on load, after structural
  // edits (type change, move, delete, split, paste-import) and undo/redo, all of
  // which bump domSyncTick. Ordinary typing never re-renders (DOM → state only).
  // Layout effect + synchronous caret placement: keystrokes typed right after a
  // structural edit (e.g. "Chorus" + Enter, then straight on typing) must land in
  // the new section, not wherever innerHTML reset the selection.
  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    root.innerHTML = renderSongHtml(sections);
    renumberSong(root, sections);
    const tgt = caretTarget.current;
    caretTarget.current = null;
    if (tgt) {
      const head = root.querySelector(headSel(tgt.key));
      const body = head?.nextElementSibling;
      if (body) {
        root.focus({ preventScroll: true });
        const r = document.createRange();
        r.selectNodeContents(body);
        r.collapse(tgt.atEnd !== true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        head.scrollIntoView({ block: 'nearest' });
      }
    }
    syncActiveFromSelection();
  }, [domSyncTick, showPaste]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Which slide is the caret in? → preview + highlight frame ───────────
  // The block = the last head/break at or before the caret. Its section drives the
  // preview; the number of breaks since the head picks the preview part.
  const [activeFrame, setActiveFrame] = useState(null); // { top, height } in editor px
  function syncActiveFromSelection() {
    const root = editorRef.current;
    if (!root) return;
    const sel = window.getSelection();
    const anchor = sel && sel.rangeCount ? sel.anchorNode : null;
    if (!anchor || !root.contains(anchor)) return;
    const blocks = [...root.querySelectorAll('[data-head],[data-break]')];
    let bi = -1;
    blocks.forEach((b, i) => {
      if (b === anchor || b.contains(anchor) || (b.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)) bi = i;
    });
    if (bi < 0) return;
    let hi = bi;
    while (hi > 0 && !blocks[hi].dataset.head) hi--;
    const head = blocks[hi];
    if (!head?.dataset.head) return;
    const key = head.dataset.key;
    if (key !== activeKeyRef.current) setActiveSectionKey(key);
    setPreviewPart(bi - hi);
    // offsetTop is relative to the editor (position:relative); the frame lives in the
    // editor's wrapper, so add the editor's own offset within it.
    const base = root.offsetTop;
    const top = base + blocks[bi].offsetTop;
    const next = blocks[bi + 1];
    const bottom = base + (next ? next.offsetTop : root.offsetHeight);
    setActiveFrame({ top: top + 2, height: Math.max(24, bottom - top) });
  }
  useEffect(() => {
    let raf = 0;
    const onSel = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(syncActiveFromSelection); };
    document.addEventListener('selectionchange', onSel);
    // Layout shifts (window resize, details panel toggled, fonts loading, text
    // reflowing above) move the blocks — keep the frame glued to them.
    const ro = typeof ResizeObserver !== 'undefined' && editorRef.current ? new ResizeObserver(onSel) : null;
    if (ro) ro.observe(editorRef.current);
    return () => { document.removeEventListener('selectionchange', onSel); cancelAnimationFrame(raf); ro?.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview follows the active section's (live) content.
  useEffect(() => {
    const sec = sections.find((x) => x._key === activeSectionKey) || sections[0];
    setPreviewContent({ text: sec?.content || '', runs: sec?.runs || [] });
  }, [sections, activeSectionKey]);

  // Structural edits: update state, then re-render the document with the caret in `key`.
  // `added` = [afterKey, newKey] pairs: with a custom play order, a new section
  // plays right after each occurrence of the section it was created from — or it
  // would silently never reach the screen.
  function restructure(updater, key, atEnd, added = []) {
    doc.set((d) => {
      const nd = updater(d);
      const keys = new Set(nd.sections.map((x) => x._key));
      let arr = Array.isArray(nd.arrangement) ? nd.arrangement.filter((k) => keys.has(k)) : nd.arrangement;
      for (const [after, k] of added) {
        if (!Array.isArray(arr) || arr.includes(k)) continue;
        const out = [];
        let placed = false;
        for (const x of arr) { out.push(x); if (x === after) { out.push(k); placed = true; } }
        arr = placed ? out : [...out, k];
      }
      return { ...nd, arrangement: Array.isArray(arr) && !arr.length ? null : arr };
    });
    if (key) caretTarget.current = { key, atEnd };
    setDomSyncTick((t) => t + 1);
  }

  // ── Editor input: DOM → state ───────────────────────────────────────────
  function ensureLeadHead(root) {
    const first = root.firstChild;
    if (first && first.nodeType === Node.ELEMENT_NODE && first.dataset?.head) return;
    if (!root.textContent.trim() && !root.querySelector('[data-head]')) return;
    const holder = document.createElement('div');
    holder.innerHTML = headHtml({ _key: newKey(), type: 'verse' }, 'Verse');
    root.insertBefore(holder.firstChild, root.firstChild);
  }

  function handleEditorInput() {
    const root = editorRef.current;
    if (!root) return;
    ensureLeadHead(root);
    let next = extractSongSections(root, sectionsRef.current);
    if (scanHeaders.current) {
      scanHeaders.current = false;
      // Scan only what this keystroke/paste changed.
      const prevByKey = new Map(sectionsRef.current.map((x) => [x._key, x.content]));
      const touched = new Set(next.filter((x) => prevByKey.get(x._key) !== x.content).map((x) => x._key));
      const here = caretSectionKey(root);
      if (here) touched.add(here); // Enter only adds a (trimmed) trailing newline
      const r = splitOnHeaderLines(next, newKey, touched);
      if (r.changed) { restructure((d) => ({ ...d, sections: r.sections }), r.caretKey, false, r.added); return; }
    }
    const keys = new Set(next.map((x) => x._key));
    doc.set((d) => {
      const arr = Array.isArray(d.arrangement) ? d.arrangement.filter((k) => keys.has(k)) : d.arrangement;
      return { ...d, sections: next, arrangement: Array.isArray(arr) && !arr.length ? null : arr };
    }, 'lyrics');
    renumberSong(root, next);
    syncActiveFromSelection();
  }

  function handleEditorPaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    // A whole song (it has section names) goes through the full lyrics parser —
    // sections, singer notes / chords / CCLI stripped, repeats → play order.
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const headerLines = lines.filter((l) => { const h = l.trim() && l.trim().length <= 60 ? parseHeaderLine(l) : null; return h && !h.tail; }).length;
    if (headerLines >= 1 && lines.filter((l) => l.trim()).length >= 3) { pasteWholeSong(text); return; }
    // A pasted line that is a section name ("Chorus") splits into a new section.
    if (/\n/.test(text)) scanHeaders.current = true;
    document.execCommand('insertText', false, text);
  }

  // Pasted song → sections. Into an empty song it becomes the song (incl. play order
  // and title/author/copyright when those are blank); otherwise the new sections go
  // after the section the caret is in (replacing it if that one is empty).
  function pasteWholeSong(text) {
    const root = editorRef.current;
    const p = parseLyrics(text, { detectTitle: true });
    if (!p.sections.length) { document.execCommand('insertText', false, text); return; }
    const mapped = p.sections.map((x) => ({ _key: newKey(), type: x.type, content: x.content, runs: [] }));
    const cur = root ? extractSongSections(root, sectionsRef.current) : sectionsRef.current;
    const empty = cur.every((x) => !(x.content || '').trim());
    const fill = (d) => ({
      title: d.title.trim() ? d.title : (p.title || d.title),
      author: d.author.trim() ? d.author : (p.author || d.author),
      copyright: d.copyright.trim() ? d.copyright : (p.copyright || d.copyright),
    });
    if (empty) {
      doc.set((d) => ({
        ...d, ...fill(d), sections: mapped,
        arrangement: Array.isArray(p.arrangement) ? p.arrangement.map((i) => mapped[i]?._key).filter(Boolean) : null,
      }));
      caretTarget.current = { key: mapped[0]._key };
      setDomSyncTick((t) => t + 1);
    } else {
      const at = root ? caretSectionKey(root) : null;
      let idx = cur.findIndex((x) => x._key === at);
      if (idx < 0) idx = cur.length - 1;
      const replace = cur[idx] && !(cur[idx].content || '').trim();
      const list = [...cur];
      list.splice(replace ? idx : idx + 1, replace ? 1 : 0, ...mapped);
      const anchorKey = replace ? cur[idx - 1]?._key : cur[idx]?._key;
      const added = mapped.map((m, i) => [i === 0 ? anchorKey : mapped[i - 1]._key, m._key]).filter(([a]) => a);
      restructure((d) => ({ ...d, ...fill(d), sections: list }), mapped[0]._key, false, added);
    }
    toast.show({ message: `Pasted song split into ${mapped.length} section${mapped.length === 1 ? '' : 's'}`, duration: 3000 });
  }

  function handleEditorKeyDown(e) {
    // Alt+↑/↓ → previous / next section.
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const list = sectionsRef.current;
      const idx = list.findIndex((x) => x._key === activeKeyRef.current);
      const next = list[idx + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next) focusSection(next._key);
      return;
    }
    // ⌘/Ctrl+Enter → split slide here; plain Enter → line break, and a line that
    // reads as a section name ("Chorus", "Verse 2") becomes a new section.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); insertSplit(); return; }
    if (e.key === 'Enter') { e.preventDefault(); scanHeaders.current = true; document.execCommand('insertLineBreak'); }
  }

  // _key of the section the caret is in (nearest header at or before it).
  function caretSectionKey(root) {
    const sel = window.getSelection();
    const anchor = sel && sel.rangeCount ? sel.anchorNode : null;
    if (!anchor || !root.contains(anchor)) return null;
    let key = null;
    for (const h of root.querySelectorAll('[data-head]')) {
      if (h === anchor || h.contains(anchor) || (h.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)) key = h.dataset.key;
    }
    return key;
  }

  // Put the caret at the start of a section and bring it into view.
  function focusSection(key) {
    const root = editorRef.current;
    const head = root?.querySelector(headSel(key));
    const body = head?.nextElementSibling;
    if (!body) return;
    root.focus();
    const r = document.createRange();
    r.selectNodeContents(body);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    head.scrollIntoView({ block: 'nearest' });
  }

  // Header click → section menu (type / move / delete).
  function handleEditorMouseDown(e) {
    const head = e.target.closest?.('[data-head]');
    if (!head || !editorRef.current?.contains(head)) return;
    e.preventDefault();
    const r = head.querySelector('[data-label]')?.getBoundingClientRect() || head.getBoundingClientRect();
    setHeadMenu({ key: head.dataset.key, x: r.left, y: r.bottom + 4 });
  }

  function hasSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return false;
    return editorRef.current?.contains(sel.anchorNode) ?? false;
  }

  function execCmd(cmd) {
    editorRef.current?.focus();
    document.execCommand(cmd);
  }

  // Insert a slide-break marker at the caret. The section stays one logical unit;
  // it just renders as multiple slides at the break (variable-size parts).
  function insertSplit() {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand('insertHTML', false, EDITOR_BREAK_HTML + '<br>');
    handleEditorInput();
  }

  // Split the active section into one slide per blank-line stanza. Idempotent.
  // Inline runs are dropped (the restructured whitespace would invalidate offsets).
  function autoSplit(key = activeKeyRef.current) {
    const sec = sectionsRef.current.find((x) => x._key === key);
    if (!sec) return;
    const clean = (sec.content || '').replace(/\s*⁂\s*/g, '\n');
    const parts = clean.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length <= 1) return;
    const joined = parts.join(`\n${SLIDE_BREAK}\n`);
    restructure((d) => ({ ...d, sections: d.sections.map((x) => x._key === key ? { ...x, content: joined, runs: [] } : x) }), key);
  }

  // Canvas text edit committed from SlidePreview: replace only the active preview
  // part of the active section (other split parts preserved), then re-render.
  function handleCanvasTextChange(newText) {
    const key = activeKeyRef.current;
    if (!key) return;
    const fullText = previewContent.text;
    let newFullText;
    if (previewParts.length <= 1) {
      newFullText = newText;
    } else {
      const segments = fullText.split(SLIDE_BREAK);
      let nonEmptyCount = 0;
      const updated = segments.map((seg) => {
        if (!seg.trim()) return seg;
        if (nonEmptyCount === partIdx) {
          nonEmptyCount++;
          const lead = seg.match(/^\s*/)?.[0] || '';
          const trail = seg.match(/\s*$/)?.[0] || '';
          return lead + newText + trail;
        }
        nonEmptyCount++;
        return seg;
      });
      newFullText = updated.join(SLIDE_BREAK);
    }
    restructure((d) => ({ ...d, sections: d.sections.map((x) => x._key === key ? { ...x, content: newFullText, runs: [] } : x) }));
  }

  // Singer / voice-part notes still in the lyrics ("Solo - Tammi", "All:", "Tammi: …"
  // — songs imported before the parser handled them). They would show on screen,
  // so the editor offers to remove them in one click (an undoable step).
  const singerNotes = React.useMemo(() => {
    const names = singerNamesIn(sections.map((x) => x.content));
    const edits = new Map();
    for (const sec of sections) {
      const r = cleanSectionText(sec.content, sec.runs || [], names);
      if (r) edits.set(sec._key, r);
    }
    return edits;
  }, [sections]);
  function removeSingerNotes() {
    const edits = singerNotes;
    if (!edits.size) return;
    restructure((d) => ({
      ...d,
      sections: d.sections.map((x) => edits.has(x._key) ? { ...x, content: edits.get(x._key).content, runs: edits.get(x._key).runs } : x),
    }), activeKeyRef.current);
  }

  // ── Section mutations ───────────────────────────────────────────────────
  // New section goes after the one the caret is in (or at the end).
  function addSection(type = 'verse') {
    const k = newKey();
    const after = activeKeyRef.current || sectionsRef.current[sectionsRef.current.length - 1]?._key;
    restructure((d) => {
      const i = d.sections.findIndex((x) => x._key === activeKeyRef.current);
      const list = [...d.sections];
      list.splice(i < 0 ? list.length : i + 1, 0, { _key: k, type, content: '', runs: [] });
      return { ...d, sections: list };
    }, k, false, after ? [[after, k]] : []);
  }

  function onTypeChange(key, value) {
    restructure((d) => ({ ...d, sections: d.sections.map((x) => x._key === key ? { ...x, type: value } : x) }), key);
  }

  function moveSection(key, dir) {
    restructure((d) => {
      const i = d.sections.findIndex((x) => x._key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.sections.length) return d;
      return { ...d, sections: arrayMove(d.sections, i, j) };
    }, key);
  }

  function deleteSection(key) {
    const list = sectionsRef.current;
    const i = list.findIndex((x) => x._key === key);
    const neighbour = list[i - 1] || list[i + 1];
    restructure((d) => ({ ...d, sections: d.sections.filter((x) => x._key !== key) }), neighbour?._key);
  }

  function handleParsedImport(parsed) {
    const mapped = parsed.sections.map((p) => ({ _key: newKey(), type: p.type, content: p.content, runs: [] }));
    // One undo step: sections, plus the played order the paste implied ("Repeat
    // Chorus", a chorus written twice → arrangement, not duplicate sections), plus
    // metadata it carried (title line, SongSelect footer) — never overwriting.
    doc.set((d) => ({
      ...d,
      sections: mapped,
      arrangement: Array.isArray(parsed.arrangement) ? parsed.arrangement.map((i) => mapped[i]?._key).filter(Boolean) : null,
      title: d.title.trim() ? d.title : (parsed.title || d.title),
      author: d.author.trim() ? d.author : (parsed.author || d.author),
      copyright: d.copyright.trim() ? d.copyright : (parsed.copyright || d.copyright),
    }));
    setShowPaste(false);
    if (mapped.length) {
      setActiveSectionKey(mapped[0]._key);
      caretTarget.current = { key: mapped[0]._key };
    }
    setDomSyncTick((t) => t + 1);
  }

  // ── Tags ────────────────────────────────────────────────────────────────
  function toggleTag(id) {
    setSelectedTagIds((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  }

  // Auto-assigned palette for tags created inline (no AI purple/indigo).
  const TAG_PALETTE = ['#4d8eff', '#ff5470', '#34d399', '#f59e0b', '#22d3ee', '#e879a6', '#94a3a8', '#a3e635'];

  async function handleCreateTag() {
    const name = newTagName.trim();
    if (!name) { setAddingTag(false); return; }
    // Reuse an existing tag of the same name rather than creating a duplicate.
    const existing = allTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!selectedTagIds.includes(existing.id)) toggleTag(existing.id);
    } else {
      const colour = TAG_PALETTE[allTags.length % TAG_PALETTE.length];
      const id = await window.cue.tags.create({ name, colour });
      setAllTags(await window.cue.tags.list());
      setSelectedTagIds((prev) => [...prev, id]);
    }
    setNewTagName('');
    setAddingTag(false);
  }

  // ── Save ────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!title.trim() || saving) return;
    setSaving(true); setSaveError('');
    try {
      // Read the live document (state is kept in sync on input; this is belt-and-braces).
      const live = editorRef.current && !showPaste
        ? extractSongSections(editorRef.current, sectionsRef.current)
        : sectionsRef.current;
      if (live.length) sectionsRef.current = live;
      const sectionData = live.map((sec) => serializeSection(sec.type, sec.content || '', sec.runs || [], style));
      // Arrangement keys → 0-based positions in the exact section order being saved
      // (stale keys dropped). null clears back to natural order.
      const keyIdx = new Map(sectionsRef.current.map((s, i) => [s._key, i]));
      const arrangementIdxs = Array.isArray(arrangement)
        ? arrangement.map((k) => keyIdx.get(k)).filter((n) => n != null)
        : null;
      const data = {
        title: title.trim(), author: author.trim() || null, copyright: copyright.trim() || null,
        sections: sectionData, tagIds: selectedTagIds,
        arrangement: arrangementIdxs && arrangementIdxs.length ? arrangementIdxs : null,
        maxLines: Number(maxLines) > 0 ? Number(maxLines) : 0,
      };
      let savedId;
      if (song?.id) {
        await window.cue.songs.update(song.id, data);
        savedId = song.id;
        await window.cue.songs.setBackground(savedId, songBackground?.id ?? null);
      } else {
        savedId = await window.cue.songs.create(data);
        if (songBackground?.id != null) await window.cue.songs.setBackground(savedId, songBackground.id);
      }
      await window.cue.songs.setLock(savedId, bgLocked);
      onSave(savedId);
    } catch (err) {
      console.error('[SongEditor] save failed:', err);
      setSaveError(`Save failed: ${err?.message || 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  // ⌘S / Ctrl+S saves the song (standard app behavior). A ref keeps the listener
  // stable while always calling the latest handleSave (which reads current state).
  // ⌘B/I/U inline formatting is handled natively by the contentEditable editor.
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      handleSaveRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function handleApplyStyleToSong() {
    if (!song?.id) return;
    const styleJsonStr = styleIsDefault(style) ? null : JSON.stringify(style);
    try {
      await window.cue.songs.applyStyleToSong(song.id, styleJsonStr);
      toast.success('Style applied to all sections');
    } catch (err) {
      toast.error('Failed: ' + (err?.message || 'unknown error'));
    }
  }

  const inputCls  = 'w-full bg-surface-container-lowest text-on-surface text-body-sm rounded-lg px-md py-1.5 border border-outline-variant/50 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors';
  const labelCls  = 'block text-label-sm text-on-surface-variant mb-1';
  const activeSection = sections.find((s) => s._key === activeSectionKey);

  // Where this song's background comes from, mirroring the live cascade
  // (lock → override → song → global → black). The editor never sees a rundown
  // slot, so "override" can't show here; that's resolved per-slot at output.
  const bgSource = bgLocked ? 'Locked' : songBackground ? 'Song' : globalBg ? 'Global' : 'None';
  // The picture actually shown: a locked song is pinned to its own bg (no global
  // fallback); otherwise the live global fills in when the song has none.
  const effectiveBgPath = bgLocked
    ? (songBackground?.path ?? null)
    : (songBackground?.path ?? globalBg?.path ?? null);
  const BG_SOURCE_STYLE = {
    Locked: 'text-secondary border-secondary/40 bg-secondary/10',
    Song:   'text-primary border-primary/40 bg-primary/10',
    Global: 'text-on-surface-variant border-outline-variant/40 bg-surface-container',
    None:   'text-on-surface-variant/60 border-outline-variant/30 bg-surface-container',
  };

  // The active section's display parts (split on the ⁂ marker). The preview shows
  // one part at a time so the operator never sees a slide with a marker in it.
  const previewParts = splitForPreview(previewContent.text, previewContent.runs);
  const partIdx      = Math.min(Math.max(previewPart, 0), previewParts.length - 1);
  const activePart   = previewParts[partIdx] || { text: '', runs: [] };

  return createPortal(
    <div className="fixed inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50 p-2">
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full h-full max-w-[98vw] max-h-[96vh] flex flex-col shadow-2xl ring-1 ring-white/5 overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-md px-lg py-sm border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <div className="flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>music_note</span>
            <div>
              <h2 className="text-headline-md font-semibold text-on-surface leading-tight">
                {title.trim() || (song?.id ? 'Edit Song' : 'New Song')}
              </h2>
              <p className="text-label-sm text-on-surface-variant">{song?.id ? 'Editing song' : 'New song'}</p>
            </div>
          </div>

          <div className="flex-1" />

          <UndoRedoButtons undo={handleUndo} redo={handleRedo} canUndo={doc.canUndo} canRedo={doc.canRedo} />

          {themeList.length > 0 && (
            <button
              onClick={() => setShowThemePicker(true)}
              className="flex items-center gap-xs px-md h-8 text-body-md text-on-surface-variant hover:text-on-surface border border-outline-variant/40 hover:border-outline-variant rounded-lg cursor-pointer transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">style</span>
              Load theme…
            </button>
          )}
          <button onClick={() => setShowPaste(true)} title="Replace the lyrics by pasting the whole song" className="flex items-center gap-xs px-md h-8 text-body-md text-on-surface-variant hover:text-on-surface border border-outline-variant/40 hover:border-outline-variant rounded-lg cursor-pointer transition-colors">
            <span className="material-symbols-outlined text-[18px]">content_paste</span>
            Paste song
          </button>
          <button onClick={() => setShowMeta((v) => !v)} className="flex items-center gap-xs px-md h-8 text-body-md text-on-surface-variant hover:text-on-surface border border-outline-variant/40 hover:border-outline-variant rounded-lg cursor-pointer transition-colors">
            <span className="material-symbols-outlined text-[18px]">{showMeta ? 'expand_less' : 'expand_more'}</span>
            {showMeta ? 'Hide details' : 'Show details'}
          </button>
          <button onClick={onClose} title="Close (Esc)"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* ── Metadata (collapsible) ──────────────────────────────────── */}
        {showMeta && (
          <div className="flex-shrink-0 border-b border-outline-variant/20 bg-surface-container/40 px-lg py-sm">
            <div className="grid grid-cols-12 gap-sm items-end">
              <div className="col-span-4">
                <label className={labelCls}>Title *</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Song title" />
              </div>
              <div className="col-span-3">
                <label className={labelCls}>Author</label>
                <input value={author} onChange={(e) => setAuthor(e.target.value)} className={inputCls} placeholder="Songwriter" />
              </div>
              <div className="col-span-3">
                <label className={labelCls}>Copyright</label>
                <input value={copyright} onChange={(e) => setCopyright(e.target.value)} className={inputCls} placeholder="© Year Publisher" />
              </div>
              {/* Background thumbnail */}
              <div className="col-span-2 flex items-end gap-sm">
                <div>
                  <div className="flex items-center gap-xs mb-0.5">
                    <label className={`${labelCls} mb-0`}>Background</label>
                    {/* Source badge — where the shown background comes from. */}
                    <span
                      className={`text-[11px] font-mono px-[5px] py-[1px] rounded-full border ${BG_SOURCE_STYLE[bgSource]}`}
                      title={
                        bgSource === 'Locked' ? 'Locked: this background is pinned and ignores rundown overrides and the global default.'
                        : bgSource === 'Song' ? "This song's own background."
                        : bgSource === 'Global' ? 'Falling back to the global song background (changes when you change the global).'
                        : 'No background — output shows black.'
                      }
                    >
                      {bgSource}
                    </span>
                  </div>
                  <div className="flex items-center gap-sm">
                    <div className="w-16 aspect-video rounded border border-outline-variant/30 bg-surface-container overflow-hidden cursor-pointer group relative flex-shrink-0"
                      onClick={() => setShowBgPicker(true)}>
                      {effectiveBgPath ? (
                        /\.(mp4|webm|mov)$/i.test(effectiveBgPath)
                          ? <video src={mediaUrl(effectiveBgPath)} className="w-full h-full object-cover" muted />
                          : <img src={mediaUrl(effectiveBgPath)} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="material-symbols-outlined text-on-surface-variant/70 text-base">wallpaper</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="material-symbols-outlined text-white text-xs">edit</span>
                      </div>
                    </div>
                    {/* Lock toggle — pins this song's background above overrides + global.
                        Locking while only the global fallback is showing captures it onto
                        the song, so the lock freezes the image you actually see (not black). */}
                    <button
                      onClick={() => doc.set((d) => {
                        // Lock + (capture global onto the song) is one undo step.
                        const next = !d.bgLocked;
                        const songBackground = (next && !d.songBackground && globalBg) ? { ...globalBg } : d.songBackground;
                        return { ...d, bgLocked: next, songBackground };
                      })}
                      title={bgLocked
                        ? 'Background locked — pinned above rundown overrides and the global default. Click to unlock.'
                        : 'Lock this background so rundown overrides, the global default, and "apply to all" can\'t change it.'}
                      className={`flex items-center gap-[3px] text-[11px] font-mono px-sm py-[3px] rounded border cursor-pointer transition-colors
                        ${bgLocked
                          ? 'text-secondary border-secondary/50 bg-secondary/10 hover:bg-secondary/20'
                          : 'text-on-surface-variant border-outline-variant/40 hover:border-outline-variant hover:text-on-surface'}`}
                    >
                      <span className="material-symbols-outlined text-[12px]">{bgLocked ? 'lock' : 'lock_open'}</span>
                      {bgLocked ? 'Locked' : 'Lock'}
                    </button>
                    {songBackground && (
                      <button onClick={() => setSongBackground(null)}
                        className="text-[11px] font-mono text-error/60 hover:text-error cursor-pointer">Clear</button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Tags */}
            <div className="flex items-center gap-xs mt-sm flex-wrap">
              <span className={`${labelCls} mb-0`}>Tags:</span>
              {allTags.map((tag) => (
                <button key={tag.id} onClick={() => toggleTag(tag.id)}
                  className={`text-[11px] font-mono px-sm py-[2px] rounded-full border transition-colors cursor-pointer
                    ${selectedTagIds.includes(tag.id) ? 'text-white border-transparent' : 'bg-surface-container border-outline-variant/30 text-on-surface-variant hover:border-outline-variant'}`}
                  style={selectedTagIds.includes(tag.id) ? { backgroundColor: tag.colour || '#4d8eff' } : {}}>
                  {tag.name}
                </button>
              ))}
              {addingTag ? (
                <input
                  autoFocus
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onBlur={handleCreateTag}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleCreateTag(); }
                    if (e.key === 'Escape') { setNewTagName(''); setAddingTag(false); }
                  }}
                  placeholder="tag name…"
                  className="text-[11px] font-mono px-sm py-[2px] rounded-full bg-surface-container border border-primary/50 text-on-surface w-24 focus:outline-none"
                />
              ) : (
                <button
                  onClick={() => setAddingTag(true)}
                  className="text-[11px] font-mono px-sm py-[2px] rounded-full border border-dashed border-outline-variant/40 text-on-surface-variant hover:border-primary hover:text-primary transition-colors cursor-pointer flex items-center gap-[2px]"
                >
                  <span className="material-symbols-outlined text-[12px]">add</span>New
                </button>
              )}
            </div>

            {/* Remembered set-list names — matched instantly by Paste Song List */}
            {aliases.length > 0 && (
              <div className="flex items-center gap-xs mt-sm flex-wrap" title="Names your set lists have used for this song. Paste Song List matches these instantly.">
                <span className={`${labelCls} mb-0`}>Also called:</span>
                {aliases.map((a) => (
                  <span key={a.alias} className="flex items-center gap-[2px] text-label-sm pl-sm pr-[2px] py-[1px] rounded-full border border-outline-variant/40 text-on-surface">
                    {a.alias}
                    <button
                      onClick={async () => {
                        try { await window.cue.songs.forgetAlias(song.id, a.alias); } catch { /* ignore */ }
                        setAliases((prev) => prev.filter((x) => x.alias !== a.alias));
                      }}
                      title="Forget this name"
                      className="w-4 h-4 flex items-center justify-center rounded-full text-on-surface-variant hover:text-error cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[13px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {showBgPicker && (
          <MediaPickerModal
            initialId={songBackground?.id ?? null}
            onSelect={(asset) => { setSongBackground(asset); setShowBgPicker(false); }}
            onClose={() => setShowBgPicker(false)}
          />
        )}

        {showThemePicker && (
          <ThemePickerModal
            onPick={(t) => { setShowThemePicker(false); handleLoadTheme(t.id); }}
            onClose={() => setShowThemePicker(false)}
          />
        )}

        {/* ── Body ────────────────────────────────────────────────────── */}
        {showPaste ? (
          <PasteView onParse={handleParsedImport} onCancel={() => setShowPaste(false)} />
        ) : (
          <div className="flex flex-1 min-h-0">

            {/* ── Lyrics: one continuous document (EasyWorship-style Words pane) ── */}
            <div className="w-[38%] min-w-[320px] max-w-[520px] flex-shrink-0 border-r border-outline-variant/30 bg-surface-container-lowest flex flex-col min-h-0">
              {/* Section strip: jump anywhere in a long song; + adds a section after the caret. */}
              <div className="px-sm py-[6px] border-b border-outline-variant/20 flex items-center gap-xs flex-shrink-0">
                <div className="flex-1 min-w-0 flex items-center gap-[4px] overflow-x-auto custom-scrollbar">
                  {(() => {
                    const labels = sectionLabels(sections, { abbrev: true });
                    return sections.map((sec, i) => (
                      <button
                        key={sec._key}
                        onMouseDown={(e) => { e.preventDefault(); focusSection(sec._key); }}
                        title={`Go to ${sectionLabels(sections)[i]}`}
                        className={`shrink-0 h-6 px-sm rounded-md text-[12px] font-medium tabular-nums transition-colors cursor-pointer ${
                          sec._key === activeSectionKey
                            ? 'bg-primary/20 text-primary'
                            : `${HEAD_TONE[sec.type] || 'text-on-surface-variant'} hover:bg-surface-variant`
                        }`}
                      >
                        {labels[i]}
                      </button>
                    ));
                  })()}
                </div>
                <button
                  onMouseDown={(e) => { e.preventDefault(); addSection(); }}
                  title="Add a section after the one you're in (or type a name like “Chorus” on its own line and press Enter)"
                  className="shrink-0 flex items-center gap-[2px] h-7 px-sm rounded-md border border-outline-variant/40 text-[12px] text-on-surface hover:border-primary hover:text-primary transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>Section
                </button>
              </div>

              {singerNotes.size > 0 && (() => {
                const lines = [...singerNotes.values()].flatMap((r) => r.removed);
                return (
                  <div className="mx-sm mt-sm px-md py-sm rounded-lg border border-yellow-400/40 bg-yellow-400/10 flex items-center gap-sm flex-shrink-0">
                    <span className="material-symbols-outlined text-[18px] text-yellow-300 shrink-0">record_voice_over</span>
                    <p className="flex-1 min-w-0 text-[13px] text-on-surface">
                      Singer notes in the lyrics would show on screen:{' '}
                      <span className="text-on-surface-variant">{lines.slice(0, 3).map((x) => `“${x}”`).join(', ')}{lines.length > 3 ? ` +${lines.length - 3} more` : ''}</span>
                    </p>
                    <button
                      onMouseDown={(e) => { e.preventDefault(); removeSingerNotes(); }}
                      className="shrink-0 h-7 px-md rounded-md text-[13px] font-semibold bg-yellow-400/20 text-yellow-200 hover:bg-yellow-400/30 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                );
              })()}

              <div ref={sidebarRef} className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="relative px-md pt-xs pb-lg">
                  {/* Frame around the slide the caret is in (EasyWorship's selected slide). */}
                  {activeFrame && (
                    <div
                      className="absolute left-[6px] right-[6px] rounded-md border border-primary/50 bg-primary/[0.06] pointer-events-none"
                      style={{ top: activeFrame.top, height: activeFrame.height }}
                    />
                  )}
                  <div
                    ref={editorRef}
                    contentEditable="true"
                    suppressContentEditableWarning
                    spellCheck
                    onInput={handleEditorInput}
                    onPaste={handleEditorPaste}
                    onKeyDown={handleEditorKeyDown}
                    onMouseDown={handleEditorMouseDown}
                    className="relative outline-none caret-primary text-[13px] leading-[1.5] text-on-surface whitespace-pre-wrap break-words pr-sm"
                  />
                </div>
                <p className="px-md pb-md text-[12px] text-on-surface-variant/70">
                  Type a section name (“Chorus”, “Verse 2”) on its own line and press Enter to start a new section ·
                  ⌘/Ctrl+Enter starts a new slide · click a section name to change or move it
                </p>
              </div>

              {/* Played order (arrangement) — repeats sections without duplicating lyrics */}
              <ArrangementPanel sections={sections} arrangement={arrangement} onChange={setArrangement} />

              {/* Max lines / slide — auto-paginates every section of THIS song longer
                  than the cap into multiple display slides, overriding the global
                  default. 0 = inherit the global (Settings › Themes). */}
              <div className="px-md py-sm border-t border-outline-variant/20 flex items-center gap-sm">
                <div className="min-w-0 flex-1">
                  <div className="text-body-md text-on-surface">Max lines per slide</div>
                  <div className="text-label-sm text-on-surface-variant">Longer sections split automatically · 0 = app default</div>
                </div>
                <input
                  type="number"
                  min={0}
                  max={20}
                  step={1}
                  value={maxLines || ''}
                  placeholder="0"
                  onChange={(e) => {
                    const n = Math.max(0, Math.min(20, Math.round(Number(e.target.value) || 0)));
                    setMaxLines(n);
                  }}
                  className="w-14 bg-surface-container border border-outline-variant/30 rounded px-sm py-[3px] text-[13px] tabular-nums text-on-surface text-center outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* ── Look: formatting + live slide preview ─────────────── */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0">

              {/* Formatting toolbar */}
              <FormattingToolbar
                style={style}
                onChange={setStyle}
                fonts={fonts}
                hasSelection={hasSelection}
                execCmd={execCmd}
                previewTemplate={previewTemplate}
              />

              {/* Apply-to-all-sections strip — only available once the song is saved */}
              {song?.id && (
                <div className="flex items-center justify-end px-md py-[5px] border-b border-outline-variant/30 bg-surface-container/50">
                  <button
                    onMouseDown={(e) => { e.preventDefault(); handleApplyStyleToSong(); }}
                    className="flex items-center gap-xs text-[11px] font-mono text-on-surface-variant/60 hover:text-primary transition-colors"
                    title="Apply current text styling to all sections of this song"
                  >
                    <span className="material-symbols-outlined text-[12px]">format_paint</span>
                    Apply Style to All Sections
                  </button>
                </div>
              )}

                {/* Slide preview */}
                <div className="flex-1 flex flex-col min-h-0 bg-surface-container-lowest p-md">
                  <div className="flex items-center justify-between mb-sm flex-shrink-0">
                    <div className="flex items-center gap-sm">
                      <span className="text-[11px] font-mono text-on-surface-variant/60">
                        {activeSection ? `${activeSection.type.charAt(0).toUpperCase()}${activeSection.type.slice(1)} — ` : ''}{previewTemplate === 'lowerthird' ? 'Lower Third' : 'Fullscreen'}
                      </span>
                      {previewParts.length > 1 && (
                        <span className="text-[11px] font-mono text-primary/70 tabular-nums">
                          {previewParts.length} slides
                        </span>
                      )}
                    </div>
                    {/* Template toggle */}
                    <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px]">
                      {[
                        { id: 'fullscreen',  label: 'Full' },
                        { id: 'lowerthird',  label: 'L3' },
                      ].map(({ id, label }) => (
                        <button
                          key={id}
                          onMouseDown={(e) => { e.preventDefault(); setPreviewTemplate(id); }}
                          className={`px-sm h-[18px] text-[11px] font-mono rounded transition-colors cursor-pointer ${
                            previewTemplate === id
                              ? 'bg-primary text-on-primary'
                              : 'text-on-surface-variant/60 hover:text-on-surface-variant'
                          }`}
                        >{label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 flex items-center justify-center min-h-0 overflow-hidden">
                    {/* Height-bound 16:9 box: fits the available section regardless of toolbar height */}
                    <div className="h-full max-w-full relative" style={{ aspectRatio: '16 / 9' }}>
                      {previewTemplate === 'lowerthird' ? (
                        <LowerThirdPreview
                          text={activePart.text}
                          runs={activePart.runs}
                          style={style}
                          copyright={copyright || undefined}
                        />
                      ) : (
                        <SlidePreview
                          text={activePart.text}
                          runs={activePart.runs}
                          style={style}
                          backgroundPath={effectiveBgPath}
                          copyright={copyright || undefined}
                          onTextBoxChange={(box) => setStyle((s) => ({ ...s, textBox: box }))}
                          onCanvasTextChange={handleCanvasTextChange}
                        />
                      )}
                      {bgLoading && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-xs bg-background/55 pointer-events-none">
                          <span className="material-symbols-outlined text-primary animate-spin text-[28px]">progress_activity</span>
                          <span className="text-[11px] font-mono text-on-surface-variant">Loading background…</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Part filmstrip — every slide of a split section at a glance;
                      click a thumbnail to load it into the big preview above. */}
                  {previewParts.length > 1 && (
                    <div className="flex-shrink-0 mt-sm flex gap-sm overflow-x-auto custom-scrollbar pb-1">
                      {previewParts.map((part, i) => (
                        <button
                          key={i}
                          onClick={() => setPreviewPart(i)}
                          title={`Slide ${i + 1}`}
                          className={`relative flex-shrink-0 w-32 rounded overflow-hidden border-2 transition-colors cursor-pointer ${
                            i === partIdx ? 'border-primary' : 'border-outline-variant/30 hover:border-outline-variant'
                          }`}
                        >
                          {previewTemplate === 'lowerthird' ? (
                            <LowerThirdPreview text={part.text} runs={part.runs} style={style} />
                          ) : (
                            <SlidePreview text={part.text} runs={part.runs} style={style} backgroundPath={effectiveBgPath} />
                          )}
                          <span className="absolute top-0.5 left-0.5 text-[11px] font-mono bg-black/60 text-white rounded px-1 tabular-nums leading-tight">
                            {i + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

            </div>
          </div>
        )}

        {headMenu && (() => {
          const sec = sections.find((x) => x._key === headMenu.key);
          if (!sec) return null;
          const i = sections.indexOf(sec);
          const item = 'w-full flex items-center gap-sm px-md py-[6px] text-left text-body-md hover:bg-surface-variant cursor-pointer disabled:opacity-40 disabled:cursor-default';
          const close = () => setHeadMenu(null);
          return (
            <>
              <div className="fixed inset-0 z-[70]" onMouseDown={close} />
              <div
                className="fixed z-[71] w-56 py-xs bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl"
                style={{ left: Math.min(headMenu.x, window.innerWidth - 240), top: Math.max(8, Math.min(headMenu.y, window.innerHeight - 470)) }}
              >
                <p className="px-md pt-xs pb-[2px] text-[12px] text-on-surface-variant">Section type</p>
                {SECTION_TYPES.map((t) => (
                  <button key={t} className={item} onClick={() => { close(); onTypeChange(sec._key, t); }}>
                    <span className="material-symbols-outlined text-[16px] w-4">{sec.type === t ? 'check' : ''}</span>
                    <span className={`capitalize ${HEAD_TONE[t] || 'text-on-surface'}`}>{t}</span>
                  </button>
                ))}
                <div className="my-xs h-px bg-outline-variant/30" />
                <button className={item} disabled={i === 0} onClick={() => { close(); moveSection(sec._key, -1); }}>
                  <span className="material-symbols-outlined text-[16px]">arrow_upward</span>Move up
                </button>
                <button className={item} disabled={i === sections.length - 1} onClick={() => { close(); moveSection(sec._key, 1); }}>
                  <span className="material-symbols-outlined text-[16px]">arrow_downward</span>Move down
                </button>
                <button className={item} onClick={() => { close(); autoSplit(sec._key); }}>
                  <span className="material-symbols-outlined text-[16px]">splitscreen</span>One slide per stanza
                </button>
                <button className={`${item} text-error`} disabled={sections.length <= 1} onClick={() => { close(); deleteSection(sec._key); }}>
                  <span className="material-symbols-outlined text-[16px]">delete</span>Delete section
                </button>
              </div>
            </>
          );
        })()}

        {/* ── Footer ──────────────────────────────────────────────────── */}
        {!showPaste && (
          <div className="flex items-center justify-between px-lg py-sm border-t border-outline-variant/30 bg-surface-container-high flex-shrink-0">
            <div className="flex items-center gap-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary/60" />
              <span className="text-label-sm text-on-surface-variant">
                {sections.length} section{sections.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-sm">
              {saveError && <span className="text-label-sm font-mono text-error">{saveError}</span>}
              <button onClick={onClose}
                className="px-lg h-9 text-body-md text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-variant transition-colors cursor-pointer">
                Cancel
              </button>
              <button onClick={handleSave} disabled={!title.trim() || saving}
                title={!title.trim() ? 'Add a title to save' : undefined}
                className="px-lg h-9 text-body-md font-semibold bg-tertiary-container text-on-tertiary-container disabled:opacity-40 rounded-lg transition-colors cursor-pointer hover:opacity-90">
                {saving ? 'Saving…' : 'Save song'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
