import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import MediaPickerModal from './MediaPickerModal';
import ThemePickerModal from './ThemePickerModal';
import { mediaUrl } from '../utils/mediaUrl';
import { sectionOrdinals } from '../utils/sectionLabels';
import { useFonts } from '../utils/fonts';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ─── Constants ─────────────────────────────────────────────────────────────

const SECTION_TYPES = ['verse', 'chorus', 'refrain', 'bridge', 'pre-chorus', 'tag', 'intro', 'outro'];
const FONT_SIZES    = [18, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 112, 128, 144, 160];

export const DEFAULT_STYLE = {
  fontFamily:    null,
  fontSize:      null,
  color:         null,
  bold:          false,
  italic:        false,
  underline:     false,
  uppercase:     false,
  align:         'center',
  verticalAlign: 'center',
  lineSpacing:   null,
  letterSpacing: null,
  textShadow:    null,
  textStroke:    null,
  textBox:       null,
  ltBar:         null,
};

const TEXTBOX_PRESETS = [
  { label: 'Full',   value: null },
  { label: 'Top',    value: { x: 5, y: 4,  w: 90, h: 30 } },
  { label: 'Middle', value: { x: 5, y: 35, w: 90, h: 30 } },
  { label: 'Bottom', value: { x: 5, y: 60, w: 90, h: 35 } },
  { label: 'L3',     value: { x: 5, y: 68, w: 90, h: 27 } },
];

let keyCounter = 0;
const newKey = () => `k${++keyCounter}`;

// ─── Core helpers (exported for output windows) ────────────────────────────

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderWithRuns(text, runs) {
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
    if (run.underline)  st.push('text-decoration:underline');
    if (run.color)      st.push(`color:${run.color}`);
    if (run.fontFamily) st.push(`font-family:${String(run.fontFamily).replace(/"/g, "'")}`);
    if (run.fontSize)   st.push(`font-size:${Number(run.fontSize)}px`);
    const inner = esc(text.slice(s, e)).replace(/\n/g, '<br>');
    html += st.length ? `<span style="${st.join(';')}">${inner}</span>` : inner;
    pos = e;
  }
  if (pos < text.length) html += esc(text.slice(pos)).replace(/\n/g, '<br>');
  return html;
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
    const s = { ...style };
    if (tag === 'B' || tag === 'STRONG') s.bold = true;
    if (tag === 'I' || tag === 'EM')     s.italic = true;
    if (tag === 'U')                      s.underline = true;
    if (tag === 'SPAN') {
      const cs = node.style;
      if (cs.fontWeight === 'bold' || cs.fontWeight === '700') s.bold = true;
      if (cs.fontStyle === 'italic')                          s.italic = true;
      if (cs.textDecoration?.includes('underline'))           s.underline = true;
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
    !s.underline && !s.uppercase && (!s.align || s.align === 'center') &&
    (!s.verticalAlign || s.verticalAlign === 'center') &&
    !s.lineSpacing && !s.letterSpacing && !s.textShadow && !s.textStroke && !s.textBox && !s.ltBar && !s.bgCss && !s.bgScrim;
}

function serializeSection(type, text, runs, style) {
  const hasRuns  = runs && runs.length > 0;
  const hasStyle = !styleIsDefault(style);
  if (!hasStyle && !hasRuns) return { type, content: text, style_json: null };
  const { runs: _r, ...base } = style;
  return { type, content: text, style_json: JSON.stringify({ ...base, runs: hasRuns ? runs : undefined }) };
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
  if (cs.underline)     o.textDecoration = 'underline';
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

function parseSong(rawText) {
  if (!rawText.trim()) return [];
  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const KW = 'verse|chorus|bridge|pre[-\\s]?chorus|prechorus|tag|intro|outro|refrain';
  const HEADER_PATTERNS = [
    new RegExp('^\\[(.{1,40}?)\\]\\s*:?\\s*$'),
    new RegExp(`^(${KW})\\s*\\d*\\s*:$`, 'i'),
    new RegExp(`^(${KW})\\s*\\d*$`, 'i'),
  ];
  const TYPE_MAP = {
    verse:'verse',v:'verse',chorus:'chorus',ch:'chorus',refrain:'refrain',
    bridge:'bridge',br:'bridge','pre-chorus':'pre-chorus','pre chorus':'pre-chorus',
    prechorus:'pre-chorus',tag:'tag',intro:'intro',outro:'outro',
  };
  function matchHeader(line) {
    const t = line.trim();
    if (!t || t.length > 60) return null;
    for (const re of HEADER_PATTERNS) { const m = t.match(re); if (m) return (m[1] ?? m[0]).replace(/:?\s*$/, '').trim(); }
    return null;
  }
  function labelToType(label) {
    const l = label.toLowerCase().replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
    const base = l.replace(/\s*\d+$/, '').trim();
    return TYPE_MAP[base] || TYPE_MAP[l] || 'verse';
  }
  const TRAILING_TAG_RE = new RegExp(`\\s*\\[(${KW}|ch|br|v)\\s*\\d*\\]\\s*$`, 'i');
  function cleanLine(line) {
    return line.trim().replace(TRAILING_TAG_RE, '').replace(/^\s*[\[\(]?\d+[\]\)\.:]?\s+/, '');
  }
  const sections = []; let currentType = null, currentLines = [], hasHeaders = false, prevBlank = true;
  function flush() {
    while (currentLines.length && !currentLines[0].trim()) currentLines.shift();
    while (currentLines.length && !currentLines[currentLines.length-1].trim()) currentLines.pop();
    const content = currentLines.join('\n').trim();
    if (content) sections.push({ type: currentType || 'verse', content });
    currentLines = []; currentType = null;
  }
  for (const line of lines) {
    const isBlank = !line.trim();
    const headerLabel = matchHeader(line);
    if (headerLabel) { flush(); currentType = labelToType(headerLabel); hasHeaders = true; prevBlank = true; continue; }
    if (/^\s*\d+[.):]?\s*$/.test(line)) { prevBlank = true; continue; }
    if (prevBlank && !isBlank) {
      const m = line.match(/^\s*(\d{1,2})[.)]?\s+(.+)$/);
      if (m) { flush(); currentType = 'verse'; hasHeaders = true; currentLines.push(cleanLine(m[2])); prevBlank = false; continue; }
    }
    if (isBlank) { currentLines.push(''); prevBlank = true; }
    else { currentLines.push(cleanLine(line)); prevBlank = false; }
  }
  flush();
  if (!hasHeaders) return rawText.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(content => ({ type: 'verse', content }));
  return sections;
}

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

export function SlidePreview({ text, runs, style, backgroundPath, copyright, copyrightAlign, copyrightStyle, onTextBoxChange, onRefPosChange }) {
  const wrapRef  = useRef(null);
  const [scale, setScale] = useState(0.5);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    if (!wrapRef.current) return;
    const update = () => { if (wrapRef.current) setScale(wrapRef.current.offsetWidth / SLIDE_W); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Drag: pointer delta → native px (÷ scale) → percent. onMove(dx%, dy%, startSnapshot).
  function startDrag(e, start, onMove) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const sc = scaleRef.current || 1;
    const move = (ev) => {
      const dx = ((ev.clientX - sx) / sc) / SLIDE_W * 100;
      const dy = ((ev.clientY - sy) / sc) / SLIDE_H * 100;
      onMove(dx, dy, start);
    };
    const up = () => {
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
  };

  const textCss = {
    fontFamily:          style?.fontFamily || undefined,
    fontSize:            `${style?.fontSize ?? 72}px`,
    fontWeight:          style?.bold ? 700 : 400,
    fontStyle:           style?.italic ? 'italic' : 'normal',
    textDecoration:      style?.underline ? 'underline' : 'none',
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

  const rendered = renderWithRuns(text || '', runs || []);

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}
    >
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div style={{ width: `${SLIDE_W}px`, height: `${SLIDE_H}px`, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
          {/* Background — media asset wins; else a media theme's remote thumb
              (bgThumb, preview-only); else a theme's CSS gradient/solid (bgCss). */}
          {backgroundPath ? (
            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
              {/\.(mp4|webm|mov)$/i.test(backgroundPath)
                ? <video src={mediaUrl(backgroundPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} autoPlay loop muted />
                : <img src={mediaUrl(backgroundPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />}
            </div>
          ) : style?.bgThumb ? (
            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
              <img src={style.bgThumb} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
            </div>
          ) : style?.bgCss ? (
            <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: style.bgCss }} />
          ) : null}
          {/* Adjustable dark scrim over the background (style.bgScrim, 0→1) */}
          {style?.bgScrim ? (
            <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: '#000', opacity: Math.max(0, Math.min(1, style.bgScrim)), pointerEvents: 'none' }} />
          ) : null}
          {/* Content window guide — fixed safe area (not interactive) */}
          <div style={{
            position: 'absolute',
            left: `${(CONTENT_BOX.x / 100) * SLIDE_W}px`, top: `${(CONTENT_BOX.y / 100) * SLIDE_H}px`,
            width: `${(CONTENT_BOX.w / 100) * SLIDE_W}px`, height: `${(CONTENT_BOX.h / 100) * SLIDE_H}px`,
            border: '1px dashed rgba(255,255,255,0.18)', boxSizing: 'border-box', zIndex: 1, pointerEvents: 'none',
          }} />

          {/* Text box content */}
          <div style={{ ...textBoxCss, zIndex: 2 }}>
            <div style={textCss} dangerouslySetInnerHTML={{ __html: rendered }} />
          </div>

          {/* Text box selection frame (drag body to move) + resize handles */}
          {tbDraggable && (
            <div
              onPointerDown={(e) => startDrag(
                e,
                { x: tb.x, y: tb.y, w: tb.w, h: tb.h },
                (dx, dy, s) => onTextBoxChange({
                  x: Math.round(clampPct(s.x + dx, 0, 100 - s.w)),
                  y: Math.round(clampPct(s.y + dy, 0, 100 - s.h)),
                  w: s.w, h: s.h,
                }),
              )}
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
                    onPointerDown={(e) => { e.stopPropagation(); startDrag(e, { x: tb.x, y: tb.y, w: tb.w, h: tb.h }, (dx, dy, s) => onTextBoxChange(resizeBox(s, hnd.hx, hnd.hy, dx, dy))); }}
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

  const textCss = {
    fontFamily:       style?.fontFamily || undefined,
    fontSize:         `${style?.fontSize ?? 48}px`,
    fontWeight:       style?.bold ? 700 : 400,
    fontStyle:        style?.italic ? 'italic' : 'normal',
    textDecoration:   style?.underline ? 'underline' : 'none',
    color:            style?.color || '#ffffff',
    textAlign:        style?.align || 'center',
    lineHeight:       style?.lineSpacing ? String(style.lineSpacing) : '1.2',
    letterSpacing:    style?.letterSpacing ? `${style.letterSpacing}em` : undefined,
    textTransform:    style?.uppercase ? 'uppercase' : 'none',
    textShadow:       buildShadowCss(style?.textShadow) || '0 2px 8px rgba(0,0,0,0.6)',
    WebkitTextStroke: buildStrokeCss(style?.textStroke),
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
          {/* Lower third bar — background controlled by style.ltBar; transparent by default. */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            padding: '24px 60px 32px',
            background: buildBarBg(style?.ltBar),
            minHeight: '160px',
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
            zIndex: 1,
          }}>
            <div style={textCss} dangerouslySetInnerHTML={{ __html: renderWithRuns(text || '', runs || []) }} />
            {copyright && <div style={copyrightStyleCss}>{copyright}</div>}
          </div>
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
      className={`h-6 min-w-[24px] px-1 flex items-center justify-center rounded transition-colors flex-shrink-0 cursor-pointer text-[11px] font-mono
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
      className={`${width} bg-surface-container-lowest border border-outline-variant/40 text-on-surface text-[10px] rounded px-1 h-6 outline-none focus:border-primary text-center`}
    />
  );
}

export function FormattingToolbar({ style, onChange, fonts, hasSelection, execCmd, previewTemplate, simple = false }) {
  const set = (prop, val) => onChange({ ...style, [prop]: val });

  const shadow = style.textShadow;
  const stroke = style.textStroke;
  const tb     = style.textBox || { x: 5, y: 5, w: 90, h: 90 };

  const shadowEnabled = shadow?.enabled ?? false;
  const strokeEnabled = stroke?.enabled ?? false;

  function toggleShadow() {
    if (!shadow) onChange({ ...style, textShadow: { enabled: true, color: '#000000', blur: 16, x: 0, y: 2 } });
    else onChange({ ...style, textShadow: { ...shadow, enabled: !shadow.enabled } });
  }
  function toggleStroke() {
    if (!stroke) onChange({ ...style, textStroke: { enabled: true, color: '#000000', width: 2 } });
    else onChange({ ...style, textStroke: { ...stroke, enabled: !stroke.enabled } });
  }
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
  const label = 'text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.05em] flex-shrink-0';

  return (
    <div className="border-b border-outline-variant/30 bg-surface-container">
      {/* Row 1: Font + basic style + alignment */}
      <div className={row}>
        {/* Font family */}
        <select
          value={style.fontFamily || ''}
          onChange={(e) => set('fontFamily', e.target.value || null)}
          className="bg-surface-container-high text-on-surface text-[11px] rounded px-1.5 h-6 border border-outline-variant/50 w-32 outline-none focus:border-primary cursor-pointer flex-shrink-0"
        >
          <option value="">Default Font</option>
          {(() => {
            // Group by category; bundled fonts first within each so the shipped,
            // pixel-identical faces sit at the top of the list.
            const GROUPS = [
              { key: 'custom',     label: 'My Fonts' },
              { key: 'sans-serif', label: 'Sans-serif' },
              { key: 'serif',      label: 'Serif' },
              { key: 'display',    label: 'Display' },
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

        {/* Font size */}
        <select
          value={style.fontSize || ''}
          onChange={(e) => set('fontSize', e.target.value ? Number(e.target.value) : null)}
          className="bg-surface-container-high text-on-surface text-[11px] rounded px-1 h-6 border border-outline-variant/50 w-[62px] outline-none focus:border-primary cursor-pointer flex-shrink-0"
        >
          <option value="">Size</option>
          {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
        </select>

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
              <span className="text-[9px] text-error/70 hover:text-error">Reset</span>
            </ToolBtn>
          </>
        )}
      </div>

      {/* Row 2: Spacing + Shadow + Stroke + TextBox */}
      <div className={`${row} border-t border-outline-variant/20`}>

        {/* Line spacing */}
        <span className={label}>Line</span>
        <NumInput value={style.lineSpacing} onChange={(v) => set('lineSpacing', v)} min={0.5} max={4} step={0.05} width="w-12" placeholder="1.25" />

        {/* Letter spacing */}
        <span className={label}>Track</span>
        <NumInput value={style.letterSpacing} onChange={(v) => set('letterSpacing', v)} min={-0.2} max={1} step={0.01} width="w-12" placeholder="0" />

        <Divider />

        {/* Text Shadow */}
        <span className={label}>Shadow</span>
        <ToolBtn active={shadowEnabled} title="Toggle text shadow" onMouseDown={toggleShadow}>
          {shadowEnabled ? 'On' : 'Off'}
        </ToolBtn>
        {shadowEnabled && shadow && (
          <>
            <ColorSwatch value={shadow.color || '#000000'} onChange={(v) => onChange({ ...style, textShadow: { ...shadow, color: v } })} title="Shadow colour" />
            <span className={label}>Blur</span>
            <NumInput value={shadow.blur ?? 16} onChange={(v) => onChange({ ...style, textShadow: { ...shadow, blur: v } })} min={0} max={100} step={1} width="w-10" />
            <span className={label}>X</span>
            <NumInput value={shadow.x ?? 0} onChange={(v) => onChange({ ...style, textShadow: { ...shadow, x: v } })} min={-50} max={50} step={1} width="w-10" />
            <span className={label}>Y</span>
            <NumInput value={shadow.y ?? 2} onChange={(v) => onChange({ ...style, textShadow: { ...shadow, y: v } })} min={-50} max={50} step={1} width="w-10" />
          </>
        )}

        <Divider />

        {/* Text Stroke */}
        <span className={label}>Stroke</span>
        <ToolBtn active={strokeEnabled} title="Toggle text stroke" onMouseDown={toggleStroke}>
          {strokeEnabled ? 'On' : 'Off'}
        </ToolBtn>
        {strokeEnabled && stroke && (
          <>
            <ColorSwatch value={stroke.color || '#000000'} onChange={(v) => onChange({ ...style, textStroke: { ...stroke, color: v } })} title="Stroke colour" />
            <span className={label}>Width</span>
            <NumInput value={stroke.width ?? 2} onChange={(v) => onChange({ ...style, textStroke: { ...stroke, width: v } })} min={0.5} max={20} step={0.5} width="w-10" />
          </>
        )}

        {/* Background scrim — darken the background (transparent → black) for legibility
            on bright displays. Fullscreen background concept; lower-third uses its bar. */}
        {previewTemplate !== 'lowerthird' && (
          <>
            <Divider />
            <span className={label} title="Darken the background for brighter displays">Scrim</span>
            <input
              type="range" min={0} max={1} step={0.05}
              value={style.bgScrim ?? 0}
              onChange={(e) => set('bgScrim', Number(e.target.value) || null)}
              className="w-20 accent-primary cursor-pointer"
              title="Background scrim (transparent → black)"
            />
            <span className="text-[10px] font-mono text-on-surface-variant w-8 text-right tabular-nums">
              {Math.round((style.bgScrim ?? 0) * 100)}%
            </span>
          </>
        )}

        {/* Reference position — fullscreen reference styling only (drag in preview or set X/Y) */}
        {simple && previewTemplate !== 'lowerthird' && (
          <>
            <Divider />
            <span className={label}>Pos</span>
            <ToolBtn active={!style.pos} title="Anchor to bottom" onMouseDown={() => set('pos', null)}>Bottom</ToolBtn>
            <ToolBtn active={!!style.pos} title="Free position (drag in preview)" onMouseDown={() => set('pos', style.pos || { x: 50, y: 90 })}>Free</ToolBtn>
            {style.pos && (
              <>
                <span className={label}>X</span>
                <NumInput value={style.pos.x} onChange={(v) => set('pos', { ...style.pos, x: Number(v) })} min={0} max={100} step={1} width="w-9" />
                <span className={label}>Y</span>
                <NumInput value={style.pos.y} onChange={(v) => set('pos', { ...style.pos, y: Number(v) })} min={0} max={100} step={1} width="w-9" />
              </>
            )}
          </>
        )}

        {/* Text box — fill / object-align in content window / precise X/Y/W/H. Fullscreen only. */}
        {!simple && previewTemplate !== 'lowerthird' && (
          <>
            <Divider />
            <span className={label}>Box</span>
            <ToolBtn title="Fill the content window" onMouseDown={() => set('textBox', { ...CONTENT_BOX })}>Fill</ToolBtn>
            {/* Object align — position the box within the content window */}
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
            <span className={label}>X</span>
            <NumInput value={tb.x} onChange={(v) => setTb('x', v)} min={0} max={100} step={1} width="w-9" />
            <span className={label}>Y</span>
            <NumInput value={tb.y} onChange={(v) => setTb('y', v)} min={0} max={100} step={1} width="w-9" />
            <span className={label}>W</span>
            <NumInput value={tb.w} onChange={(v) => setTb('w', v)} min={1} max={100} step={1} width="w-9" />
            <span className={label}>H</span>
            <NumInput value={tb.h} onChange={(v) => setTb('h', v)} min={1} max={100} step={1} width="w-9" />
          </>
        )}

        {/* Gradient bar — lower third only */}
        {!simple && previewTemplate === 'lowerthird' && (
          <>
            <Divider />
            <span className={label}>Bar</span>
            <ToolBtn active={!!style.ltBar} title="Toggle gradient bar" onMouseDown={() => {
              onChange({ ...style, ltBar: style.ltBar ? null : { color: '#000000', opacity: 0.8, solid: false } });
            }}>
              {style.ltBar ? 'On' : 'Off'}
            </ToolBtn>
            {style.ltBar && (
              <>
                <ColorSwatch value={style.ltBar.color || '#000000'} onChange={(v) => onChange({ ...style, ltBar: { ...style.ltBar, color: v } })} title="Bar colour" />
                <span className={label}>Opacity</span>
                <NumInput value={style.ltBar.opacity ?? 0.8} onChange={(v) => onChange({ ...style, ltBar: { ...style.ltBar, opacity: Number(v) } })} min={0} max={1} step={0.05} width="w-12" />
                <ToolBtn active={!!style.ltBar.solid} title="Solid bar (no fade to transparent)" onMouseDown={() => onChange({ ...style, ltBar: { ...style.ltBar, solid: !style.ltBar.solid } })}>
                  Solid
                </ToolBtn>
              </>
            )}
          </>
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

function SortableSectionItem({ section, ordinal, isActive, onSelect, onDelete, onTypeChange }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section._key });
  const preview = (section.content || '').split('\n').slice(0, 2).join(' · ').slice(0, 60) || '(empty)';
  const typeColor = TYPE_COLORS[section.type] || TYPE_COLORS.default;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      onClick={() => onSelect(section._key)}
      className={`group relative flex flex-col gap-0.5 px-sm py-2 border-b border-outline-variant/15 cursor-pointer transition-colors
        ${isActive ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-surface-variant/40 border-l-2 border-l-transparent'}`}
    >
      <div className="flex items-center gap-1.5">
        <button
          className="drag-handle cursor-grab text-on-surface-variant/25 hover:text-on-surface-variant flex-shrink-0 transition-colors"
          {...attributes} {...listeners} tabIndex={-1} onClick={(e) => e.stopPropagation()}
        >
          <svg width="7" height="10" viewBox="0 0 7 10" fill="currentColor">
            <circle cx="1.5" cy="1.5" r="1.2"/><circle cx="5.5" cy="1.5" r="1.2"/>
            <circle cx="1.5" cy="5" r="1.2"/><circle cx="5.5" cy="5" r="1.2"/>
            <circle cx="1.5" cy="8.5" r="1.2"/><circle cx="5.5" cy="8.5" r="1.2"/>
          </svg>
        </button>

        <select
          value={section.type}
          onChange={(e) => { e.stopPropagation(); onTypeChange(section._key, e.target.value); }}
          onClick={(e) => e.stopPropagation()}
          className={`text-[9px] font-mono font-bold uppercase tracking-[0.06em] border rounded px-1 h-[18px] outline-none cursor-pointer bg-transparent flex-shrink-0 ${typeColor}`}
        >
          {SECTION_TYPES.map((t) => (
            <option key={t} value={t} className="bg-surface-container text-on-surface normal-case font-normal">{t}</option>
          ))}
        </select>

        {ordinal != null && (
          <span className={`text-[9px] font-mono font-bold tabular-nums flex-shrink-0 ${typeColor}`}>{ordinal}</span>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onDelete(section._key); }}
          className="ml-auto opacity-0 group-hover:opacity-100 text-on-surface-variant/40 hover:text-error transition-all cursor-pointer w-4 h-4 flex items-center justify-center rounded flex-shrink-0 text-[10px]"
          tabIndex={-1} title="Remove section"
        >✕</button>
      </div>

      <p className="text-[10px] text-on-surface-variant/60 leading-tight pl-[15px] truncate">
        {preview}
      </p>
    </div>
  );
}

// ─── Paste view ───────────────────────────────────────────────────────────

function PasteView({ onParse, onCancel }) {
  const [text, setText] = useState('');
  return (
    <div className="flex flex-col gap-md p-lg flex-1">
      <p className="text-body-sm text-on-surface-variant leading-relaxed">
        Paste the full song text. Headers like{' '}
        <span className="text-on-surface font-mono">[Verse 1]</span>,{' '}
        <span className="text-on-surface font-mono">Chorus:</span>, or{' '}
        <span className="text-on-surface font-mono">BRIDGE</span> are detected and stripped.
      </p>
      <textarea
        autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={12}
        placeholder={"[Verse 1]\nAmazing grace, how sweet the sound\n\n[Chorus]\nPraise the Lord..."}
        className="w-full bg-surface-container-lowest text-on-surface text-body-sm rounded-lg px-md py-sm border border-outline-variant/50 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 resize-none font-mono leading-relaxed flex-1"
      />
      <div className="flex gap-sm">
        <button onClick={() => { const p = parseSong(text); if (p.length) onParse(p); }}
          disabled={!text.trim()}
          className="px-lg h-8 text-label-sm font-mono bg-primary text-on-primary disabled:opacity-40 rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em]">
          Import Sections
        </button>
        <button onClick={onCancel}
          className="px-lg h-8 text-label-sm font-mono text-on-surface-variant hover:text-on-surface cursor-pointer rounded-lg hover:bg-surface-variant transition-colors uppercase tracking-[0.05em]">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────

export default function SongEditor({ song, onClose, onSave }) {
  const [title, setTitle]         = useState('');
  const [author, setAuthor]       = useState('');
  const [copyright, setCopyright] = useState('');
  const [sections, setSections]   = useState([]);
  const [allTags, setAllTags]     = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [style, setStyle]         = useState({ ...DEFAULT_STYLE });
  const [activeSectionKey, setActiveSectionKey] = useState(null);
  const [previewContent, setPreviewContent] = useState({ text: '', runs: [] });
  const [songBackground, setSongBackground] = useState(null);
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
  const fonts        = useFonts();
  const sensors      = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Keep sectionsRef in sync
  useEffect(() => { sectionsRef.current = sections; }, [sections]);
  useEffect(() => { activeKeyRef.current = activeSectionKey; }, [activeSectionKey]);

  // Load themes list for the "Load Theme…" dropdown (song-category themes only)
  useEffect(() => {
    window.cue.themes.list()
      .then((list) => setThemeList((list || []).filter((t) => (t.category || 'song') === 'song')))
      .catch(() => {});
  }, []);

  async function handleLoadTheme(themeId) {
    const theme = themeList.find((t) => t.id === Number(themeId));
    if (!theme) return;
    try {
      const themeStyle = theme.style_json ? JSON.parse(theme.style_json) : null;
      if (themeStyle) setStyle({ ...DEFAULT_STYLE, ...themeStyle });
      // Loading a theme is explicit — its background replaces the current one.
      if (theme.background_id && theme.background_path) {
        setSongBackground({ id: theme.background_id, path: theme.background_path, filename: theme.background_filename });
      } else if (themeStyle?.bgRef) {
        // Media theme whose background isn't downloaded yet — resolve the
        // background-library item (download → media asset), same as applyTo*.
        setBgLoading(true);
        try {
          const asset = await window.cue.backgrounds.download(themeStyle.bgRef);
          setSongBackground({ id: asset.id, path: asset.path, filename: asset.filename });
        } catch { /* leave the current background on failure */ }
        finally { setBgLoading(false); }
      } else if (themeStyle?.bgCss) {
        // A CSS-gradient theme carries its background in the style; clear any media
        // background so the gradient (style.bgCss) actually shows.
        setSongBackground(null);
      }
    } catch {}
  }

  // Load song data
  useEffect(() => {
    window.cue.tags.list().then(setAllTags);
    if (song?.id) {
      window.cue.songs.get(song.id).then((s) => {
        setTitle(s.title);
        setAuthor(s.author || '');
        setCopyright(s.copyright || '');
        setSelectedTagIds((s.tags || []).map((t) => t.id));
        if (s.default_background_id && s.background_path) {
          setSongBackground({ id: s.default_background_id, path: s.background_path, filename: s.background_filename });
        }
        const firstStyled = (s.sections || []).find((sec) => sec.style_json);
        if (firstStyled) {
          const { runs: _r, ...base } = JSON.parse(firstStyled.style_json);
          setStyle({ ...DEFAULT_STYLE, ...base });
        }
        const mapped = (s.sections || []).map((sec) => {
          const parsed = sec.style_json ? JSON.parse(sec.style_json) : {};
          return { ...sec, _key: String(sec.id), content: sec.content || '', runs: parsed.runs || [] };
        });
        setSections(mapped);
        if (mapped.length) {
          setActiveSectionKey(mapped[0]._key);
          setPreviewContent({ text: mapped[0].content, runs: mapped[0].runs });
        }
      });
    } else {
      const first = { _key: newKey(), type: 'verse', content: '', runs: [] };
      setSections([first]);
      setActiveSectionKey(first._key);
      setPreviewContent({ text: '', runs: [] });
    }
  }, [song?.id]);

  // Escape to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving && !showBgPicker) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving, showBgPicker]);

  // When active section changes → load its content into contenteditable
  useEffect(() => {
    if (!activeSectionKey || !editorRef.current) return;
    const sec = sectionsRef.current.find((s) => s._key === activeSectionKey);
    if (sec) {
      editorRef.current.innerHTML = renderWithRuns(sec.content || '', sec.runs || []);
      setPreviewContent({ text: sec.content || '', runs: sec.runs || [] });
    }
  }, [activeSectionKey]);

  // ── Flush active section to sections array ──────────────────────────────
  const flushActiveSection = useCallback(() => {
    const key = activeKeyRef.current;
    if (!key || !editorRef.current) return;
    const { text, runs } = extractContentAndRuns(editorRef.current);
    setSections((prev) => prev.map((s) => s._key === key ? { ...s, content: text, runs } : s));
  }, []);

  function switchSection(key) {
    if (key === activeKeyRef.current) return;
    flushActiveSection();
    setActiveSectionKey(key);
    const sec = sectionsRef.current.find((s) => s._key === key);
    if (sec) setPreviewContent({ text: sec.content || '', runs: sec.runs || [] });
  }

  // ── Editor input handler ────────────────────────────────────────────────
  function handleEditorInput() {
    if (!editorRef.current) return;
    const { text, runs } = extractContentAndRuns(editorRef.current);
    setPreviewContent({ text, runs });
  }

  function handleEditorPaste(e) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  }

  function handleEditorKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
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

  // ── Section mutations ───────────────────────────────────────────────────
  function addSection() {
    const k = newKey();
    const sec = { _key: k, type: 'verse', content: '', runs: [] };
    setSections((prev) => [...prev, sec]);
    flushActiveSection();
    setActiveSectionKey(k);
    setPreviewContent({ text: '', runs: [] });
  }

  function onTypeChange(key, value) {
    setSections((prev) => prev.map((s) => s._key === key ? { ...s, type: value } : s));
  }

  function deleteSection(key) {
    setSections((prev) => {
      const next = prev.filter((s) => s._key !== key);
      if (key === activeKeyRef.current && next.length) {
        const idx = Math.max(0, prev.findIndex((s) => s._key === key) - 1);
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveSectionKey(newActive._key);
        setPreviewContent({ text: newActive.content, runs: newActive.runs });
      } else if (!next.length) {
        setActiveSectionKey(null);
        setPreviewContent({ text: '', runs: [] });
      }
      return next;
    });
  }

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oi = sections.findIndex((s) => s._key === active.id);
    const ni = sections.findIndex((s) => s._key === over.id);
    setSections(arrayMove(sections, oi, ni));
  }

  function handleParsedImport(parsed) {
    const mapped = parsed.map((p) => ({ _key: newKey(), type: p.type, content: p.content, runs: [] }));
    setSections(mapped);
    setShowPaste(false);
    if (mapped.length) {
      setActiveSectionKey(mapped[0]._key);
      setPreviewContent({ text: mapped[0].content, runs: [] });
    }
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
    if (!title.trim()) return;
    setSaving(true); setSaveError('');
    try {
      // For the active section read directly from the DOM; all others from state.
      const activeKey = activeKeyRef.current;
      const sectionData = sectionsRef.current.map((sec) => {
        let content = sec.content || '';
        let runs    = sec.runs    || [];
        if (sec._key === activeKey && editorRef.current) {
          const extracted = extractContentAndRuns(editorRef.current);
          content = extracted.text;
          runs    = extracted.runs;
        }
        return serializeSection(sec.type, content, runs, style);
      });
      const data = { title: title.trim(), author: author.trim() || null, copyright: copyright.trim() || null, sections: sectionData, tagIds: selectedTagIds };
      let savedId;
      if (song?.id) {
        await window.cue.songs.update(song.id, data);
        savedId = song.id;
        await window.cue.songs.setBackground(savedId, songBackground?.id ?? null);
      } else {
        savedId = await window.cue.songs.create(data);
        if (songBackground?.id != null) await window.cue.songs.setBackground(savedId, songBackground.id);
      }
      onSave();
    } catch (err) {
      console.error('[SongEditor] save failed:', err);
      setSaveError(`Save failed: ${err?.message || 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  const inputCls  = 'w-full bg-surface-container-lowest text-on-surface text-body-sm rounded-lg px-md py-1.5 border border-outline-variant/50 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors';
  const labelCls  = 'block text-[9px] font-mono text-on-surface-variant/60 mb-0.5 uppercase tracking-[0.05em]';
  const activeSection = sections.find((s) => s._key === activeSectionKey);

  return createPortal(
    <div className="fixed inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50 p-2">
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full h-full max-w-[98vw] max-h-[96vh] flex flex-col shadow-2xl ring-1 ring-white/5 overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-md px-lg py-sm border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <div className="flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>music_note</span>
            <div>
              <h2 className="text-headline-md font-bold text-primary leading-tight tracking-tight">
                {song?.id ? 'Edit Song' : 'New Song'}
              </h2>
              <p className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">Song Editor</p>
            </div>
          </div>

          <div className="flex-1" />

          {themeList.length > 0 && (
            <button
              onClick={() => setShowThemePicker(true)}
              className="flex items-center gap-xs bg-surface-container text-on-surface-variant text-[10px] font-mono rounded-lg px-sm h-7 border border-outline-variant/30 hover:border-outline-variant hover:text-on-surface outline-none cursor-pointer uppercase tracking-[0.05em] transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">style</span>
              Load Theme…
            </button>
          )}
          <button onClick={() => setShowPaste(true)}
            className="px-sm h-7 text-label-sm font-mono text-on-surface-variant hover:text-on-surface border border-outline-variant/30 hover:border-outline-variant rounded-lg cursor-pointer transition-colors uppercase tracking-[0.05em] text-[10px]">
            ↙ Paste Song
          </button>
          <button onClick={() => setShowMeta((v) => !v)}
            className="px-sm h-7 text-label-sm font-mono text-on-surface-variant hover:text-on-surface border border-outline-variant/30 hover:border-outline-variant rounded-lg cursor-pointer transition-colors uppercase tracking-[0.05em] text-[10px]">
            {showMeta ? 'Hide Meta' : 'Show Meta'}
          </button>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer text-sm">
            ✕
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
                  <label className={labelCls}>Background</label>
                  <div className="flex items-center gap-sm">
                    <div className="w-16 aspect-video rounded border border-outline-variant/30 bg-surface-container overflow-hidden cursor-pointer group relative flex-shrink-0"
                      onClick={() => setShowBgPicker(true)}>
                      {songBackground ? (
                        /\.(mp4|webm|mov)$/i.test(songBackground.path)
                          ? <video src={mediaUrl(songBackground.path)} className="w-full h-full object-cover" muted />
                          : <img src={mediaUrl(songBackground.path)} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="material-symbols-outlined text-outline-variant text-base">wallpaper</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="material-symbols-outlined text-white text-xs">edit</span>
                      </div>
                    </div>
                    {songBackground && (
                      <button onClick={() => setSongBackground(null)}
                        className="text-[9px] font-mono text-error/60 hover:text-error cursor-pointer uppercase tracking-[0.05em]">Clear</button>
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
                  className={`text-[9px] font-mono px-sm py-[2px] rounded-full border transition-colors cursor-pointer
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
                  className="text-[9px] font-mono px-sm py-[2px] rounded-full bg-surface-container border border-primary/50 text-on-surface w-24 focus:outline-none"
                />
              ) : (
                <button
                  onClick={() => setAddingTag(true)}
                  className="text-[9px] font-mono px-sm py-[2px] rounded-full border border-dashed border-outline-variant/40 text-on-surface-variant hover:border-primary hover:text-primary transition-colors cursor-pointer flex items-center gap-[2px]"
                >
                  <span className="material-symbols-outlined text-[11px]">add</span>New
                </button>
              )}
            </div>
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

            {/* ── Sections sidebar ──────────────────────────────────── */}
            <div className="w-48 flex-shrink-0 border-r border-outline-variant/30 bg-surface-container-lowest flex flex-col">
              <div className="px-sm py-1.5 border-b border-outline-variant/20 bg-surface-container flex items-center justify-between">
                <span className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">
                  {sections.length} Section{sections.length !== 1 ? 's' : ''}
                </span>
                <button onClick={addSection}
                  className="text-[9px] font-mono text-primary hover:text-primary/80 cursor-pointer transition-colors uppercase tracking-[0.05em]">
                  + Add
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={sections.map((s) => s._key)} strategy={verticalListSortingStrategy}>
                    {(() => {
                      // Number repeated section types (Verse 1, Verse 2…); a lone
                      // type shows no number. Recomputed live as sections change.
                      const ordinals = sectionOrdinals(sections);
                      return sections.map((sec, i) => (
                        <SortableSectionItem
                          key={sec._key}
                          section={sec}
                          ordinal={ordinals[i]}
                          isActive={sec._key === activeSectionKey}
                          onSelect={switchSection}
                          onDelete={deleteSection}
                          onTypeChange={onTypeChange}
                        />
                      ));
                    })()}
                  </SortableContext>
                </DndContext>
                {sections.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-32 gap-sm px-md text-center">
                    <span className="material-symbols-outlined text-outline-variant/40 text-3xl">playlist_add</span>
                    <span className="text-[9px] font-mono text-on-surface-variant/30 uppercase tracking-[0.05em]">No sections</span>
                    <button onClick={addSection}
                      className="text-[9px] font-mono text-primary hover:text-primary/80 cursor-pointer">+ Add section</button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Editor main area ──────────────────────────────────── */}
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

              {/* Content area: preview left, editor right */}
              <div className="flex flex-1 min-h-0 gap-0">

                {/* Slide preview */}
                <div className="flex-1 flex flex-col min-h-0 bg-surface-container-lowest border-r border-outline-variant/20 p-md">
                  <div className="flex items-center justify-between mb-sm flex-shrink-0">
                    <span className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-[0.06em]">
                      {activeSection ? `${activeSection.type} — ` : ''}{previewTemplate === 'lowerthird' ? 'Lower Third' : 'Fullscreen'}
                    </span>
                    {/* Template toggle */}
                    <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px]">
                      {[
                        { id: 'fullscreen',  label: 'Full' },
                        { id: 'lowerthird',  label: 'L3' },
                      ].map(({ id, label }) => (
                        <button
                          key={id}
                          onMouseDown={(e) => { e.preventDefault(); setPreviewTemplate(id); }}
                          className={`px-sm h-[18px] text-[9px] font-mono rounded transition-colors cursor-pointer uppercase tracking-[0.05em] ${
                            previewTemplate === id
                              ? 'bg-primary text-on-primary'
                              : 'text-on-surface-variant/50 hover:text-on-surface-variant'
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
                          text={previewContent.text}
                          runs={previewContent.runs}
                          style={style}
                          copyright={copyright || undefined}
                        />
                      ) : (
                        <SlidePreview
                          text={previewContent.text}
                          runs={previewContent.runs}
                          style={style}
                          backgroundPath={songBackground?.path ?? null}
                          copyright={copyright || undefined}
                          onTextBoxChange={(box) => setStyle((s) => ({ ...s, textBox: box }))}
                        />
                      )}
                      {bgLoading && (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-xs bg-background/55 pointer-events-none">
                          <span className="material-symbols-outlined text-primary animate-spin text-[28px]">progress_activity</span>
                          <span className="text-[10px] font-mono uppercase tracking-[0.08em] text-on-surface-variant">Loading background…</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section text editor */}
                <div className="w-72 flex-shrink-0 flex flex-col min-h-0">
                  <div className="px-md py-1.5 border-b border-outline-variant/20 bg-surface-container flex items-center justify-between flex-shrink-0">
                    <span className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">
                      {activeSection?.type ?? 'Section'}
                    </span>
                    {activeSection && (
                      <select
                        value={activeSection.type}
                        onChange={(e) => onTypeChange(activeSection._key, e.target.value)}
                        className="text-[9px] font-mono bg-transparent border-none outline-none cursor-pointer text-on-surface-variant hover:text-on-surface"
                      >
                        {SECTION_TYPES.map((t) => (
                          <option key={t} value={t} className="bg-surface-container text-on-surface">{t}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="flex-1 relative overflow-hidden">
                    {activeSectionKey ? (
                      <div
                        ref={editorRef}
                        contentEditable="true"
                        suppressContentEditableWarning
                        onInput={handleEditorInput}
                        onPaste={handleEditorPaste}
                        onKeyDown={handleEditorKeyDown}
                        className="absolute inset-0 overflow-y-auto custom-scrollbar px-md py-md outline-none text-on-surface leading-relaxed whitespace-pre-wrap caret-primary text-body-md resize-none"
                        style={{
                          fontFamily:     style.fontFamily || undefined,
                          textAlign:      style.align || 'center',
                          fontWeight:     style.bold ? 700 : undefined,
                          fontStyle:      style.italic ? 'italic' : undefined,
                          textDecoration: style.underline ? 'underline' : undefined,
                          textTransform:  style.uppercase ? 'uppercase' : undefined,
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-[9px] font-mono text-on-surface-variant/30 uppercase tracking-[0.06em]">
                        Select a section
                      </div>
                    )}
                  </div>

                  {/* Character count */}
                  <div className="px-md py-1 border-t border-outline-variant/20 bg-surface-container flex-shrink-0">
                    <span className="text-[9px] font-mono text-on-surface-variant/30">
                      {previewContent.text.length} chars · {previewContent.text.split('\n').length} lines
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────────── */}
        {!showPaste && (
          <div className="flex items-center justify-between px-lg py-sm border-t border-outline-variant/30 bg-surface-container-high flex-shrink-0">
            <div className="flex items-center gap-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary/60" />
              <span className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">
                {sections.length} section{sections.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-sm">
              {saveError && <span className="text-label-sm font-mono text-error">{saveError}</span>}
              <button onClick={onClose}
                className="px-lg h-8 text-label-sm font-mono text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-variant transition-colors cursor-pointer uppercase tracking-[0.05em]">
                Cancel
              </button>
              <button onClick={handleSave} disabled={!title.trim() || saving}
                className="px-lg h-8 text-label-sm font-mono bg-tertiary-container text-on-tertiary-container disabled:opacity-40 rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em] hover:opacity-90">
                {saving ? 'Saving…' : 'Save Song'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
