import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FormattingToolbar, DEFAULT_STYLE, styleIsDefault } from './SongEditor';
import { useFonts } from '../utils/fonts';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Substitute {{name}}/{{title}}/{{text}} (values HTML-escaped). Exported so the
// panel fills the same placeholders when firing a custom graphic live.
export function fillPlaceholders(html, vals = {}) {
  return String(html || '')
    .replace(/\{\{\s*name\s*\}\}/gi, esc(vals.name))
    .replace(/\{\{\s*title\s*\}\}/gi, esc(vals.title))
    .replace(/\{\{\s*text\s*\}\}/gi, esc(vals.text));
}

// ── Style helpers (mirror lowerthird.js so the preview matches the output) ─────

function buildShadowCss(shadow) {
  if (!shadow) return null;
  if (!shadow.enabled) return 'none';
  return `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}`;
}

export function buildBarBg(bar) {
  if (!bar) return 'transparent';
  const c  = bar.color   ?? '#000000';
  const op = bar.opacity ?? 0.8;
  const r  = parseInt(c.slice(1, 3), 16) || 0;
  const g  = parseInt(c.slice(3, 5), 16) || 0;
  const b  = parseInt(c.slice(5, 7), 16) || 0;
  if (bar.solid) return `rgba(${r},${g},${b},${op})`;
  return `linear-gradient(to top, rgba(${r},${g},${b},${op}) 0%, rgba(${r},${g},${b},${(op * 0.7).toFixed(2)}) 70%, transparent 100%)`;
}

export function flatTextCss(s, base = {}) {
  s = s || {};
  return {
    fontFamily:       s.fontFamily || base.fontFamily || undefined,
    fontSize:         `${s.fontSize ?? base.fontSize ?? 48}px`,
    color:            s.color || base.color || '#ffffff',
    fontWeight:       s.bold ? 700 : 400,
    fontStyle:        s.italic ? 'italic' : 'normal',
    textDecoration:   s.underline ? 'underline' : 'none',
    textTransform:    s.uppercase ? 'uppercase' : 'none',
    textAlign:        s.align || base.align || 'left',
    lineHeight:       s.lineSpacing ? String(s.lineSpacing) : (base.lineHeight ?? 1.15),
    letterSpacing:    s.letterSpacing ? `${s.letterSpacing}em` : undefined,
    textShadow:       buildShadowCss(s.textShadow) ?? base.textShadow ?? '0 2px 8px rgba(0,0,0,0.6)',
    WebkitTextStroke: (s.textStroke?.enabled) ? `${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}` : undefined,
    whiteSpace:       'pre-wrap',
    wordBreak:        'break-word',
  };
}

const NAME_BASE  = { fontSize: 54, color: '#ffffff', fontWeight: 700 };
const TITLE_BASE = { fontSize: 28, color: '#adc6ff', fontWeight: 500 };

// ── Defaults for a fresh graphic of each kind ──────────────────────────────────

const DEFAULT_BOX = { x: 4, y: 70, w: 55, h: 22 };

function freshNameStyle() {
  return { ...DEFAULT_STYLE, align: 'left', verticalAlign: 'bottom', fontSize: 54, color: '#ffffff', bold: true,
    textBox: { ...DEFAULT_BOX }, ltBar: { color: '#0c0e12', opacity: 0.9, solid: false } };
}
function freshTitleStyle() {
  return { ...DEFAULT_STYLE, align: 'left', fontSize: 28, color: '#adc6ff', bold: false };
}
function freshTickerStyle() {
  return { ...DEFAULT_STYLE, fontSize: 30, color: '#ffffff', bar: null, position: 'bottom' };
}
export const CD_DEFAULT_BOX = { x: 25, y: 32, w: 50, h: 36 };
function freshTimeStyle() {
  return { ...DEFAULT_STYLE, align: 'center', verticalAlign: 'center', fontSize: 120, color: '#ffffff', bold: true,
    textBox: { ...CD_DEFAULT_BOX }, ltBar: null };
}
function freshMsgStyle() {
  return { ...DEFAULT_STYLE, align: 'center', fontSize: 36, color: '#adc6ff', bold: false };
}
const FRESH_CD = { mode: 'countdown', source: 'duration', durationSec: 300, targetClock: '11:00', format: '24h', showSeconds: true, endMessage: '' };

const CD_MODES = [
  { id: 'countdown', label: 'Countdown', icon: 'timer' },
  { id: 'countup',   label: 'Count Up',  icon: 'timelapse' },
  { id: 'clock',     label: 'Clock',     icon: 'schedule' },
];

export const TIME_BASE = { fontSize: 120, color: '#ffffff', fontWeight: 700 };
export const MSG_BASE  = { fontSize: 36, color: '#adc6ff', fontWeight: 500 };

// Shared formatters (mirror graphics-overlay.js so the editor preview matches output).
const pad2 = (n) => String(n).padStart(2, '0');
export function fmtDuration(totalSec) {
  if (totalSec < 0) totalSec = 0;
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = Math.floor(totalSec % 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
export function fmtClock(date, format, showSeconds) {
  let h = date.getHours(); let suffix = '';
  if (format === '12h') { suffix = h >= 12 ? ' PM' : ' AM'; h = h % 12 || 12; }
  const hh = format === '12h' ? String(h) : pad2(h);
  const body = showSeconds ? `${hh}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` : `${hh}:${pad2(date.getMinutes())}`;
  return body + suffix;
}
// What the digits read in a static preview/thumbnail (no live anchor).
export function cdSampleText(cd) {
  if (cd.mode === 'clock') return fmtClock(new Date(), cd.format, cd.showSeconds);
  if (cd.mode === 'countup') return '0:00';
  return cd.source === 'target' ? '5:00' : fmtDuration(cd.durationSec || 0);
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SPEED_PRESETS = [
  { label: 'Slow', value: 60 },
  { label: 'Medium', value: 100 },
  { label: 'Fast', value: 160 },
];

const DEST_OPTS = [
  { id: 'all',    label: 'All',     icon: 'cast' },
  { id: 'screen', label: 'In-Room', icon: 'monitor' },
  { id: 'ndi',    label: 'Online',  icon: 'lan' },
];

const STARTER_HTML = `<style>
  .lt {
    position: absolute; bottom: 90px; left: 0;
    padding: 18px 44px 18px 28px;
    background: linear-gradient(90deg, rgba(10,12,16,.92), rgba(10,12,16,0));
    border-left: 6px solid #4d8eff;
    transform: translateX(-110%); opacity: 0;
  }
  .cue-in .lt  { animation: lt-in  .6s cubic-bezier(.2,.8,.2,1) forwards; }
  .cue-out .lt { animation: lt-out .45s ease forwards; }
  .lt .n { color: #fff;     font: 700 46px/1.1 Inter, sans-serif; }
  .lt .t { color: #adc6ff;  font: 500 24px/1.2 Inter, sans-serif; margin-top: 4px; }
  @keyframes lt-in  { to { transform: translateX(0);     opacity: 1; } }
  @keyframes lt-out { to { transform: translateX(-110%); opacity: 0; } }
</style>
<div class="lt">
  <div class="n">{{name}}</div>
  <div class="t">{{title}}</div>
</div>`;

const KINDS = [
  { id: 'lower_third', label: 'Lower Third', icon: 'badge' },
  { id: 'ticker',      label: 'Ticker',       icon: 'subtitles' },
  { id: 'countdown',   label: 'Countdown',    icon: 'timer' },
  { id: 'custom',      label: 'Custom HTML',  icon: 'code' },
];

const FRAME_W = 1920, FRAME_H = 1080;

// Fixed "content window" — the safe area object-align snaps boxes within (matches
// SongEditor.CONTENT_BOX). Boxes can still be dragged anywhere on the frame.
const CONTENT_BOX = { x: 5, y: 5, w: 90, h: 90 };

// ── Drag/resize (PowerPoint-style box) — same maths as SongEditor.SlidePreview ─

const MIN_BOX = 5;
const clampPct = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

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

// ── Previews ───────────────────────────────────────────────────────────────────

function ScaledFrame({ children, wrapRef, scale, contentGuide = false }) {
  return (
    <div ref={wrapRef} className="w-full aspect-video relative overflow-hidden rounded-lg"
      style={{ backgroundImage: 'repeating-conic-gradient(#1a1a1a 0% 25%, #222 0% 50%)', backgroundSize: '28px 28px' }}>
      <div style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', inset: 0 }}>
        {/* Content-window safe-area guide — boxes align within it (drag goes anywhere). */}
        {contentGuide && (
          <div style={{
            position: 'absolute',
            left: `${(CONTENT_BOX.x / 100) * FRAME_W}px`, top: `${(CONTENT_BOX.y / 100) * FRAME_H}px`,
            width: `${(CONTENT_BOX.w / 100) * FRAME_W}px`, height: `${(CONTENT_BOX.h / 100) * FRAME_H}px`,
            border: '1px dashed rgba(255,255,255,0.18)', boxSizing: 'border-box', pointerEvents: 'none', zIndex: 0,
          }} />
        )}
        {children}
      </div>
    </div>
  );
}

function useScale(wrapRef) {
  const [scale, setScale] = useState(0.3);
  const scaleRef = useRef(scale); scaleRef.current = scale;
  useEffect(() => {
    if (!wrapRef.current) return;
    const update = () => { if (wrapRef.current) setScale(wrapRef.current.offsetWidth / FRAME_W); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  return [scale, scaleRef];
}

// Draggable/resizable name/title bug preview.
function BugPreview({ name, title, nameStyle, titleStyle, onBoxChange }) {
  const wrapRef = useRef(null);
  const [scale, scaleRef] = useScale(wrapRef);
  const box = nameStyle?.textBox || { ...DEFAULT_BOX };

  function startDrag(e, start, onMove) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const sc = scaleRef.current || 1;
    const move = (ev) => onMove(((ev.clientX - sx) / sc) / FRAME_W * 100, ((ev.clientY - sy) / sc) / FRAME_H * 100, start);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const bL = (box.x / 100) * FRAME_W, bT = (box.y / 100) * FRAME_H;
  const bW = (box.w / 100) * FRAME_W, bH = (box.h / 100) * FRAME_H;
  const vAlign = nameStyle?.verticalAlign || 'bottom';

  return (
    <ScaledFrame wrapRef={wrapRef} scale={scale} contentGuide>
      {/* The bug box */}
      <div style={{
        position: 'absolute', left: `${bL}px`, top: `${bT}px`, width: `${bW}px`, height: `${bH}px`,
        background: buildBarBg(nameStyle?.ltBar), padding: '12px 32px', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        justifyContent: vAlign === 'top' ? 'flex-start' : vAlign === 'center' ? 'center' : 'flex-end',
      }}>
        <div style={flatTextCss(nameStyle, NAME_BASE)}>{name || 'Name'}</div>
        {(title || titleStyle) && <div style={{ ...flatTextCss(titleStyle, TITLE_BASE), marginTop: 4 }}>{title}</div>}
      </div>

      {/* Selection frame + handles */}
      {onBoxChange && (
        <div
          onPointerDown={(e) => startDrag(e, { ...box }, (dx, dy, s) => onBoxChange({
            x: Math.round(clampPct(s.x + dx, 0, 100 - s.w)),
            y: Math.round(clampPct(s.y + dy, 0, 100 - s.h)),
            w: s.w, h: s.h,
          }))}
          style={{ position: 'absolute', left: `${bL}px`, top: `${bT}px`, width: `${bW}px`, height: `${bH}px`,
            border: '2px solid rgba(173,198,255,0.8)', boxSizing: 'border-box', cursor: 'move' }}
        >
          {TB_HANDLES.map((hnd, i) => {
            const hs = 14 / scale;
            return (
              <div key={i}
                onPointerDown={(e) => { e.stopPropagation(); startDrag(e, { ...box }, (dx, dy, s) => onBoxChange(resizeBox(s, hnd.hx, hnd.hy, dx, dy))); }}
                style={{ position: 'absolute', left: `${hnd.hx * 100}%`, top: `${hnd.hy * 100}%`, width: hs, height: hs,
                  transform: 'translate(-50%, -50%)', background: '#adc6ff', border: '1px solid #0c0e12', borderRadius: 2, cursor: hnd.cursor }} />
            );
          })}
        </div>
      )}
    </ScaledFrame>
  );
}

// Draggable/resizable countdown/clock preview that ticks live, so the operator
// sees the real digits and animation cadence before taking it.
function CountdownPreview({ cd, timeStyle, msgStyle, label, onBoxChange }) {
  const wrapRef = useRef(null);
  const [scale, scaleRef] = useScale(wrapRef);
  const box = timeStyle?.textBox || { ...CD_DEFAULT_BOX };
  const [, force] = useState(0);

  // Local preview anchor: countdown counts from durationSec, count-up from mount.
  const anchorRef = useRef(0);
  useEffect(() => {
    anchorRef.current = cd.mode === 'countdown' ? Date.now() + (cd.durationSec || 0) * 1000 : Date.now();
  }, [cd.mode, cd.durationSec, cd.source]);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  let timeText;
  if (cd.mode === 'clock') timeText = fmtClock(new Date(), cd.format, cd.showSeconds);
  else if (cd.mode === 'countup') timeText = fmtDuration((Date.now() - anchorRef.current) / 1000);
  else {
    const rem = (anchorRef.current - Date.now()) / 1000;
    timeText = rem <= 0 ? (cd.endMessage ? '' : '0:00') : fmtDuration(rem);
  }
  const showEndMsg = cd.mode === 'countdown' && (anchorRef.current - Date.now()) / 1000 <= 0 && cd.endMessage;

  function startDrag(e, start, onMove) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const sc = scaleRef.current || 1;
    const move = (ev) => onMove(((ev.clientX - sx) / sc) / FRAME_W * 100, ((ev.clientY - sy) / sc) / FRAME_H * 100, start);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const bL = (box.x / 100) * FRAME_W, bT = (box.y / 100) * FRAME_H;
  const bW = (box.w / 100) * FRAME_W, bH = (box.h / 100) * FRAME_H;
  const vAlign = timeStyle?.verticalAlign || 'center';
  const hAlign = timeStyle?.align === 'left' ? 'flex-start' : timeStyle?.align === 'right' ? 'flex-end' : 'center';

  return (
    <ScaledFrame wrapRef={wrapRef} scale={scale} contentGuide>
      <div style={{
        position: 'absolute', left: `${bL}px`, top: `${bT}px`, width: `${bW}px`, height: `${bH}px`,
        background: buildBarBg(timeStyle?.ltBar), padding: '16px 32px', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        justifyContent: vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center',
        alignItems: hAlign,
      }}>
        {(label || showEndMsg) && (
          <div style={flatTextCss(msgStyle, MSG_BASE)}>{showEndMsg ? cd.endMessage : label}</div>
        )}
        <div style={{ ...flatTextCss(timeStyle, TIME_BASE), whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{timeText}</div>
      </div>

      {onBoxChange && (
        <div
          onPointerDown={(e) => startDrag(e, { ...box }, (dx, dy, s) => onBoxChange({
            x: Math.round(clampPct(s.x + dx, 0, 100 - s.w)),
            y: Math.round(clampPct(s.y + dy, 0, 100 - s.h)),
            w: s.w, h: s.h,
          }))}
          style={{ position: 'absolute', left: `${bL}px`, top: `${bT}px`, width: `${bW}px`, height: `${bH}px`,
            border: '2px solid rgba(173,198,255,0.8)', boxSizing: 'border-box', cursor: 'move' }}
        >
          {TB_HANDLES.map((hnd, i) => {
            const hs = 14 / scale;
            return (
              <div key={i}
                onPointerDown={(e) => { e.stopPropagation(); startDrag(e, { ...box }, (dx, dy, s) => onBoxChange(resizeBox(s, hnd.hx, hnd.hy, dx, dy))); }}
                style={{ position: 'absolute', left: `${hnd.hx * 100}%`, top: `${hnd.hy * 100}%`, width: hs, height: hs,
                  transform: 'translate(-50%, -50%)', background: '#adc6ff', border: '1px solid #0c0e12', borderRadius: 2, cursor: hnd.cursor }} />
            );
          })}
        </div>
      )}
    </ScaledFrame>
  );
}

function TickerPreview({ text, tickerStyle }) {
  const wrapRef = useRef(null);
  const [scale] = useScale(wrapRef);
  const top = tickerStyle?.position === 'top';
  const barBg = tickerStyle?.bar
    ? buildBarBg({ color: tickerStyle.bar.color, opacity: tickerStyle.bar.opacity, solid: true })
    : 'rgba(12,14,18,0.9)';
  const txt = flatTextCss(tickerStyle, { fontSize: 30, color: '#ffffff', fontWeight: 500 });
  return (
    <ScaledFrame wrapRef={wrapRef} scale={scale}>
      <div style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 0, height: 72,
        background: barBg, borderTop: top ? 'none' : '3px solid #4d8eff', borderBottom: top ? '3px solid #4d8eff' : 'none',
        display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        <div style={{ ...txt, whiteSpace: 'nowrap', paddingLeft: 40, lineHeight: '72px', textAlign: 'left' }}>
          {text || 'Ticker text…'}
        </div>
      </div>
    </ScaledFrame>
  );
}

function previewDoc(html) {
  return `<!doctype html><html><head><meta charset="utf-8">
    <style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:Inter,system-ui,sans-serif}
      .cue-root{position:absolute;inset:0}</style></head>
    <body><div class="cue-root cue-in">${html}</div></body></html>`;
}

function CustomPreview({ draft, replayKey }) {
  const wrapRef = useRef(null);
  const [scale] = useScale(wrapRef);
  return (
    <ScaledFrame wrapRef={wrapRef} scale={scale}>
      <iframe
        key={replayKey}
        title="graphic-preview"
        sandbox="allow-same-origin"
        srcDoc={previewDoc(fillPlaceholders(draft.html, draft))}
        style={{ width: FRAME_W, height: FRAME_H, border: 0, background: 'transparent' }}
      />
    </ScaledFrame>
  );
}

// ── Editor ─────────────────────────────────────────────────────────────────────

export default function GraphicsEditor({ graphic, onClose, onSaved }) {
  const isEdit = !!graphic?.id;
  const fonts = useFonts();

  const [draft, setDraft] = useState(() => {
    let parsed = {};
    try { parsed = graphic?.style_json ? (typeof graphic.style_json === 'string' ? JSON.parse(graphic.style_json) : graphic.style_json) : {}; } catch {}
    return {
      kind: graphic?.kind || 'lower_third',
      label: graphic?.label || '',
      name: graphic?.name || '',
      title: graphic?.title || '',
      text: graphic?.text || '',
      html: graphic?.html || '',
      speed: graphic?.speed ?? 100,
      target: graphic?.target || 'ndi', // graphics default to Online (NDI)
      nameStyle:   { ...freshNameStyle(),   ...(parsed.name  || {}) },
      titleStyle:  { ...freshTitleStyle(),  ...(parsed.title || {}) },
      tickerStyle: { ...freshTickerStyle(), ...(graphic?.kind === 'ticker' ? parsed : {}) },
      cd: { ...FRESH_CD, mode: parsed.mode || FRESH_CD.mode, source: parsed.source || FRESH_CD.source,
        durationSec: parsed.durationSec ?? FRESH_CD.durationSec, targetClock: parsed.targetClock || FRESH_CD.targetClock,
        format: parsed.format || FRESH_CD.format, showSeconds: parsed.showSeconds !== false, endMessage: parsed.endMessage || '' },
      timeStyle: { ...freshTimeStyle(), ...(parsed.time    || {}) },
      msgStyle:  { ...freshMsgStyle(),  ...(parsed.message || {}) },
    };
  });
  const [target, setTarget] = useState('name'); // editing target — LT: 'name'|'title'; countdown: 'time'|'message'
  const [replayKey, setReplayKey] = useState(0);
  const htmlRef = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setCd = (patch) => setDraft((d) => ({ ...d, cd: { ...d.cd, ...patch } }));
  const isLT = draft.kind === 'lower_third';
  const isTK = draft.kind === 'ticker';
  const isCD = draft.kind === 'countdown';
  const isCustom = draft.kind === 'custom';

  const canSave = isLT ? draft.name.trim() : isTK ? draft.text.trim() : isCD ? true : draft.html.trim();

  async function save() {
    let style_json = null;
    if (isLT) style_json = { name: draft.nameStyle, title: draft.titleStyle };
    else if (isTK) style_json = draft.tickerStyle;
    else if (isCD) style_json = { ...draft.cd, time: draft.timeStyle, message: draft.msgStyle };

    const payload = {
      kind: draft.kind, label: draft.label, name: draft.name, title: draft.title,
      text: draft.text, html: draft.html, speed: draft.speed, target: draft.target,
      style_json,
    };
    if (isEdit) await window.cue.graphics.update(graphic.id, payload);
    else await window.cue.graphics.create(payload);
    onSaved();
  }

  function insertPlaceholder(token) {
    const el = htmlRef.current;
    if (!el) { set({ html: draft.html + token }); return; }
    const s = el.selectionStart ?? draft.html.length;
    const e = el.selectionEnd ?? draft.html.length;
    set({ html: draft.html.slice(0, s) + token + draft.html.slice(e) });
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + token.length; });
  }

  // Which style the toolbar edits (LT: name/title; ticker: tickerStyle; countdown: time/message).
  const activeStyle = isLT ? (target === 'name' ? draft.nameStyle : draft.titleStyle)
    : isCD ? (target === 'message' ? draft.msgStyle : draft.timeStyle)
    : draft.tickerStyle;
  const setActiveStyle = (next) => {
    if (isLT) set(target === 'name' ? { nameStyle: next } : { titleStyle: next });
    else if (isCD) set(target === 'message' ? { msgStyle: next } : { timeStyle: next });
    else set({ tickerStyle: next });
  };

  return createPortal(
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div
        className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-6xl h-[86vh] flex flex-col shadow-2xl ring-1 ring-white/5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-lg py-md border-b border-outline-variant/20 bg-surface-container-high rounded-t-xl flex items-center justify-between gap-md shrink-0">
          <div className="flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary">branding_watermark</span>
            <h2 className="text-headline-md font-bold text-on-surface tracking-tight">{isEdit ? 'Edit Graphic' : 'New Graphic'}</h2>
          </div>
          <div className="flex items-center gap-xs bg-surface-container rounded-lg p-[3px]">
            {KINDS.map((k) => (
              <button
                key={k.id}
                disabled={isEdit && draft.kind !== k.id}
                onClick={() => set({ kind: k.id })}
                className={`flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                  draft.kind === k.id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">{k.icon}</span>{k.label}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface cursor-pointer">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Styling toolbar (lower third + ticker + countdown) */}
        {(isLT || isTK || isCD) && (
          <>
            {(isLT || isCD) && (
              <div className="flex items-center gap-sm px-lg py-xs border-b border-outline-variant/20 bg-surface-container/40 shrink-0">
                <span className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">Editing</span>
                <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px]">
                  {(isLT ? [{ id: 'name', label: 'Name' }, { id: 'title', label: 'Title' }]
                         : [{ id: 'time', label: 'Time' }, { id: 'message', label: 'Label' }]).map(({ id, label }) => {
                    // Countdown shares `target`; treat anything but 'message' as the Time target.
                    const active = isCD ? (id === 'time' ? target !== 'message' : target === 'message') : target === id;
                    return (
                    <button key={id}
                      onMouseDown={(e) => { e.preventDefault(); setTarget(id); }}
                      className={`px-md h-6 text-[10px] font-mono rounded transition-colors cursor-pointer uppercase tracking-[0.05em] ${
                        active ? 'bg-primary text-on-primary' : 'text-on-surface-variant/60 hover:text-on-surface-variant'
                      }`}
                    >{label}</button>
                    );
                  })}
                </div>
                <span className="text-[9px] font-mono text-on-surface-variant/40">
                  {isLT
                    ? (target === 'name' ? 'Drag/resize the box in the preview · controls the bar + position' : 'Styling the title line')
                    : (target === 'message' ? 'Styling the label line' : 'Drag/resize the box in the preview · controls the bar + position')}
                </span>
              </div>
            )}
            <FormattingToolbar
              style={activeStyle}
              onChange={setActiveStyle}
              fonts={fonts}
              hasSelection={() => false}
              execCmd={() => {}}
              // 'fullscreen' for the box-owning target (LT name / countdown time) → box
              // X/Y/W/H + object-align controls. 'lowerthird' for the simple (title /
              // label / ticker) targets → hides the stray reference Pos control.
              previewTemplate={(isLT && target === 'name') || (isCD && target !== 'message') ? 'fullscreen' : 'lowerthird'}
              simple={isTK || (isLT && target === 'title') || (isCD && target === 'message')}
            />
          </>
        )}

        {/* Body: form left, preview right */}
        <div className="flex-1 flex min-h-0">
          {/* Form */}
          <div className="w-[40%] border-r border-outline-variant/20 overflow-y-auto custom-scrollbar p-lg flex flex-col gap-md">
            <Field label="Label (optional)">
              <input value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder="For your reference"
                className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary" />
            </Field>

            {(isLT || isCustom) && (
              <>
                <Field label="Name">
                  <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Pastor John Smith"
                    className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary" />
                </Field>
                <Field label="Title / role">
                  <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Senior Pastor"
                    className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary" />
                </Field>
              </>
            )}

            {isLT && (
              <Field label="Bar background">
                <BarControl bar={draft.nameStyle.ltBar}
                  onChange={(bar) => set({ nameStyle: { ...draft.nameStyle, ltBar: bar } })} />
              </Field>
            )}

            {isTK && (
              <>
                <Field label="Ticker text">
                  <textarea value={draft.text} onChange={(e) => set({ text: e.target.value })} rows={3} placeholder="Scrolling announcement…"
                    className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary resize-none" />
                </Field>
                <Field label="Speed">
                  <div className="flex items-center gap-xs">
                    {SPEED_PRESETS.map((p) => (
                      <button key={p.value} onClick={() => set({ speed: p.value })}
                        className={`px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                          draft.speed === p.value ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                        }`}>{p.label}</button>
                    ))}
                  </div>
                </Field>
                <Field label="Position">
                  <div className="flex items-center gap-xs">
                    {[{ id: 'bottom', label: 'Bottom' }, { id: 'top', label: 'Top' }].map((p) => (
                      <button key={p.id} onClick={() => set({ tickerStyle: { ...draft.tickerStyle, position: p.id } })}
                        className={`px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                          (draft.tickerStyle.position || 'bottom') === p.id ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                        }`}>{p.label}</button>
                    ))}
                  </div>
                </Field>
                <Field label="Bar background">
                  <BarControl bar={draft.tickerStyle.bar}
                    onChange={(bar) => set({ tickerStyle: { ...draft.tickerStyle, bar } })} solidOnly />
                </Field>
              </>
            )}

            {isCD && (
              <>
                <Field label="Type">
                  <div className="flex items-center gap-xs">
                    {CD_MODES.map((m) => (
                      <button key={m.id} onClick={() => setCd({ mode: m.id })}
                        className={`flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                          draft.cd.mode === m.id ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                        }`}>
                        <span className="material-symbols-outlined text-[14px]">{m.icon}</span>{m.label}
                      </button>
                    ))}
                  </div>
                </Field>

                {draft.cd.mode === 'countdown' && (
                  <>
                    <Field label="Count down">
                      <div className="flex items-center gap-xs">
                        {[{ id: 'duration', label: 'For a duration' }, { id: 'target', label: 'To a time' }].map((o) => (
                          <button key={o.id} onClick={() => setCd({ source: o.id })}
                            className={`px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                              draft.cd.source === o.id ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                            }`}>{o.label}</button>
                        ))}
                      </div>
                    </Field>
                    {draft.cd.source === 'duration' ? (
                      <Field label="Duration (mm : ss)">
                        <DurationInput seconds={draft.cd.durationSec} onChange={(s) => setCd({ durationSec: s })} />
                      </Field>
                    ) : (
                      <Field label="Target time (today / next)">
                        <input type="time" value={draft.cd.targetClock} onChange={(e) => setCd({ targetClock: e.target.value })}
                          className="bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary" />
                      </Field>
                    )}
                    <Field label="End message (at zero)">
                      <input value={draft.cd.endMessage} onChange={(e) => setCd({ endMessage: e.target.value })} placeholder="e.g. Starting now"
                        className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary" />
                    </Field>
                  </>
                )}

                {draft.cd.mode === 'clock' && (
                  <>
                    <Field label="Format">
                      <div className="flex items-center gap-xs">
                        {[{ id: '24h', label: '24-Hour' }, { id: '12h', label: '12-Hour' }].map((o) => (
                          <button key={o.id} onClick={() => setCd({ format: o.id })}
                            className={`px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                              draft.cd.format === o.id ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                            }`}>{o.label}</button>
                        ))}
                      </div>
                    </Field>
                    <Field label="Seconds">
                      <button onClick={() => setCd({ showSeconds: !draft.cd.showSeconds })}
                        className={`px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                          draft.cd.showSeconds ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                        }`}>{draft.cd.showSeconds ? 'Showing seconds' : 'Hidden'}</button>
                    </Field>
                  </>
                )}

                <Field label={draft.cd.mode === 'clock' ? 'Label (above the clock)' : 'Label (above the timer)'}>
                  <input value={draft.text} onChange={(e) => set({ text: e.target.value })}
                    placeholder={draft.cd.mode === 'clock' ? 'e.g. Current Time' : 'e.g. Service starts in'}
                    className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary" />
                </Field>

                <Field label="Box background">
                  <BarControl bar={draft.timeStyle.ltBar}
                    onChange={(bar) => set({ timeStyle: { ...draft.timeStyle, ltBar: bar } })} />
                </Field>
              </>
            )}

            {isCustom && (
              <>
                <Field label="Text (for {{text}})">
                  <input value={draft.text} onChange={(e) => set({ text: e.target.value })} placeholder="Optional"
                    className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary" />
                </Field>
                <div className="flex items-center justify-between">
                  <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">HTML + inline CSS</span>
                  <div className="flex items-center gap-xs">
                    {['{{name}}', '{{title}}', '{{text}}'].map((t) => (
                      <button key={t} onClick={() => insertPlaceholder(t)}
                        className="px-xs py-[2px] rounded text-[10px] font-mono bg-surface-container border border-outline-variant/40 text-primary hover:bg-surface-container-high cursor-pointer">{t}</button>
                    ))}
                    {!draft.html.trim() && (
                      <button onClick={() => set({ html: STARTER_HTML })}
                        className="px-xs py-[2px] rounded text-[10px] font-mono bg-surface-container border border-outline-variant/40 text-on-surface-variant hover:text-on-surface cursor-pointer">Starter</button>
                    )}
                  </div>
                </div>
                <textarea
                  ref={htmlRef}
                  value={draft.html}
                  onChange={(e) => set({ html: e.target.value })}
                  spellCheck={false}
                  placeholder="Paste an HTML snippet with an inline <style>. Use .cue-in / .cue-out on the wrapper for enter/exit animations."
                  className="flex-1 min-h-[200px] bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-sm text-[12px] font-mono leading-relaxed text-on-surface focus:outline-none focus:border-primary resize-none custom-scrollbar"
                />
                <p className="text-[11px] text-on-surface-variant leading-snug">
                  Rendered in an isolated shadow root. Wrapped in <code className="text-primary">.cue-root</code> —
                  gets <code className="text-primary">.cue-in</code> on take, <code className="text-primary">.cue-out</code> on clear. Scripts don't run (CSS only).
                </p>
              </>
            )}

            {/* Default destination */}
            <Field label="Default destination">
              <div className="flex items-center gap-xs">
                {DEST_OPTS.map((d) => (
                  <button key={d.id} onClick={() => set({ target: d.id })}
                    className={`flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                      draft.target === d.id ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                    }`}>
                    <span className="material-symbols-outlined text-[14px]">{d.icon}</span>{d.label}
                  </button>
                ))}
              </div>
            </Field>
            <p className="text-[10px] text-on-surface-variant/60 leading-snug -mt-xs">
              In-Room = screen/monitor channels · Online = NDI channels. Can be overridden per-fire from the panel.
            </p>
          </div>

          {/* Preview */}
          <div className="flex-1 flex flex-col min-h-0 bg-surface-container-lowest">
            <div className="flex items-center justify-between px-md h-9 border-b border-outline-variant/20 shrink-0">
              <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline">Preview</span>
              {isCustom && (
                <button onClick={() => setReplayKey((k) => k + 1)} title="Replay animation"
                  className="flex items-center gap-xs text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant hover:text-primary cursor-pointer">
                  <span className="material-symbols-outlined text-[14px]">replay</span> Replay
                </button>
              )}
            </div>
            <div className="flex-1 flex items-center justify-center p-md min-h-0">
              {isCustom ? (
                <CustomPreview draft={draft} replayKey={replayKey} />
              ) : isTK ? (
                <TickerPreview text={draft.text} tickerStyle={draft.tickerStyle} />
              ) : isCD ? (
                <CountdownPreview cd={draft.cd} timeStyle={draft.timeStyle} msgStyle={draft.msgStyle} label={draft.text}
                  onBoxChange={(box) => set({ timeStyle: { ...draft.timeStyle, textBox: box } })} />
              ) : (
                <BugPreview
                  name={draft.name} title={draft.title}
                  nameStyle={draft.nameStyle} titleStyle={draft.titleStyle}
                  onBoxChange={(box) => set({ nameStyle: { ...draft.nameStyle, textBox: box } })}
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-lg py-md border-t border-outline-variant/20 bg-surface-container-high rounded-b-xl flex items-center justify-end gap-sm shrink-0">
          <button onClick={onClose} className="px-lg py-sm rounded-lg text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant hover:bg-surface-variant cursor-pointer">Cancel</button>
          <button onClick={save} disabled={!canSave}
            className="px-lg py-sm rounded-lg text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold bg-tertiary-container text-on-tertiary hover:brightness-110 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// mm : ss spinner pair backed by a single seconds value.
function DurationInput({ seconds, onChange }) {
  const mm = Math.floor((seconds || 0) / 60);
  const ss = (seconds || 0) % 60;
  const cls = 'w-16 bg-surface-container-lowest border border-outline-variant/40 text-on-surface text-body-md rounded-lg px-2 h-9 outline-none focus:border-primary text-center';
  return (
    <div className="flex items-center gap-xs">
      <input type="number" min={0} max={599} value={mm}
        onChange={(e) => onChange(Math.max(0, (parseInt(e.target.value, 10) || 0)) * 60 + ss)} className={cls} />
      <span className="text-on-surface-variant font-mono">:</span>
      <input type="number" min={0} max={59} value={pad2(ss)}
        onChange={(e) => onChange(mm * 60 + Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))} className={cls} />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-xs">
      <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">{label}</span>
      {children}
    </label>
  );
}

// Bar background control: none / colour + opacity (+ optional solid toggle).
function BarControl({ bar, onChange, solidOnly = false }) {
  const enabled = !!bar;
  return (
    <div className="flex items-center gap-xs flex-wrap">
      <button onClick={() => onChange(enabled ? null : { color: '#0c0e12', opacity: 0.9, solid: solidOnly ? true : false })}
        className={`px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
          enabled ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
        }`}>{enabled ? 'On' : 'Off'}</button>
      {enabled && (
        <>
          <div className="relative w-7 h-7 rounded border border-outline-variant/50 overflow-hidden" style={{ background: bar.color }}>
            <input type="color" value={bar.color} onChange={(e) => onChange({ ...bar, color: e.target.value })}
              className="opacity-0 absolute inset-0 w-full h-full cursor-pointer" />
          </div>
          <span className="text-[9px] font-mono text-on-surface-variant/50 uppercase">Opacity</span>
          <input type="number" min={0} max={1} step={0.05} value={bar.opacity}
            onChange={(e) => onChange({ ...bar, opacity: Number(e.target.value) })}
            className="w-14 bg-surface-container-lowest border border-outline-variant/40 text-on-surface text-[11px] rounded px-1 h-7 outline-none focus:border-primary text-center" />
          {!solidOnly && (
            <button onClick={() => onChange({ ...bar, solid: !bar.solid })}
              className={`px-sm py-1 rounded text-[10px] font-mono uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                bar.solid ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
              }`}>Solid</button>
          )}
        </>
      )}
    </div>
  );
}
