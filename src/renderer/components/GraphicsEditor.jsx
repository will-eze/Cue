import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useModalGuard } from '../utils/modalGuard';
import { FormattingToolbar, DEFAULT_STYLE, styleIsDefault } from './SongEditor';
import UndoRedoButtons from './UndoRedoButtons';
import useEditHistory, { useUndoRedoKeys } from '../utils/useEditHistory';
import { useFonts } from '../utils/fonts';
import MediaPickerModal from './MediaPickerModal';
import MediaThumb from './MediaThumb';
import { mediaUrl } from '../utils/mediaUrl';
import { buildSnapTargets, snapMove, snapResizeBox, SnapGuides } from '../utils/snapping';

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
  if (bar.css) return bar.css;
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
    textDecoration:   [s.underline && 'underline', s.strikethrough && 'line-through'].filter(Boolean).join(' ') || 'none',
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
const FRESH_CD = { mode: 'countdown', source: 'duration', durationSec: 300, targetClock: '11:00', format: '24h', showSeconds: true, endMessage: '', onEnd: 'hold', onEndMediaId: null, onEndMediaPath: null, audioMediaId: null, audioName: '', audioLoop: false };

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

// Smart-snap targets for box drags: frame edges/centre/thirds + safe-area lines.
const GFX_SNAP_TARGETS = buildSnapTargets({ contentBox: CONTENT_BOX });

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

function ScaledFrame({ children, wrapRef, scale, contentGuide = false, bgMedia = null, guides = null }) {
  const bgPath = bgMedia?.path;
  const bgFit  = bgMedia?.fit || 'cover';
  const bgIsVideo = bgPath && /\.(mp4|mov|webm|avi)$/i.test(bgPath.toLowerCase());
  return (
    <div ref={wrapRef} className="w-full aspect-video relative overflow-hidden rounded-lg"
      style={bgPath ? { background: '#000' } : { backgroundImage: 'repeating-conic-gradient(#1a1a1a 0% 25%, #222 0% 50%)', backgroundSize: '28px 28px' }}>
      {/* Smart-snap guide lines — % positions map 1:1 onto the 16:9 wrapper. */}
      {guides && <SnapGuides guides={guides} zIndex={40} />}
      {bgPath && (
        bgIsVideo
          ? <video src={mediaUrl(bgPath)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: bgFit }} autoPlay loop muted playsInline />
          : <img src={mediaUrl(bgPath)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: bgFit }} alt="" />
      )}
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
function BugPreview({ name, title, nameStyle, titleStyle, onBoxChange, bgMedia = null }) {
  const wrapRef = useRef(null);
  const [scale, scaleRef] = useScale(wrapRef);
  const [guides, setGuides] = useState([]);
  const box = nameStyle?.textBox || { ...DEFAULT_BOX };

  function startDrag(e, start, onMove) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const sc = scaleRef.current || 1;
    const move = (ev) => onMove(((ev.clientX - sx) / sc) / FRAME_W * 100, ((ev.clientY - sy) / sc) / FRAME_H * 100, start, ev);
    const up = () => { setGuides([]); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const bL = (box.x / 100) * FRAME_W, bT = (box.y / 100) * FRAME_H;
  const bW = (box.w / 100) * FRAME_W, bH = (box.h / 100) * FRAME_H;
  const vAlign = nameStyle?.verticalAlign || 'bottom';

  return (
    <ScaledFrame wrapRef={wrapRef} scale={scale} contentGuide bgMedia={bgMedia} guides={guides}>
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
          onPointerDown={(e) => startDrag(e, { ...box }, (dx, dy, s, ev) => {
            const snapped = snapMove({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }, GFX_SNAP_TARGETS, { free: ev?.altKey, grid: 0 });
            setGuides(snapped.guides);
            onBoxChange({
              x: Math.round(clampPct(snapped.x, 0, 100 - s.w)),
              y: Math.round(clampPct(snapped.y, 0, 100 - s.h)),
              w: s.w, h: s.h,
            });
          })}
          style={{ position: 'absolute', left: `${bL}px`, top: `${bT}px`, width: `${bW}px`, height: `${bH}px`,
            border: '2px solid rgba(173,198,255,0.8)', boxSizing: 'border-box', cursor: 'move' }}
        >
          {TB_HANDLES.map((hnd, i) => {
            const hs = 14 / scale;
            return (
              <div key={i}
                onPointerDown={(e) => { e.stopPropagation(); startDrag(e, { ...box }, (dx, dy, s, ev) => {
                  const sized = resizeBox(s, hnd.hx, hnd.hy, dx, dy);
                  const { box: b, guides: g } = snapResizeBox(sized, hnd.hx, hnd.hy, GFX_SNAP_TARGETS, { free: ev?.altKey, min: MIN_BOX });
                  setGuides(g);
                  onBoxChange({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
                }); }}
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
function CountdownPreview({ cd, timeStyle, msgStyle, label, onBoxChange, bgMedia = null }) {
  const wrapRef = useRef(null);
  const [scale, scaleRef] = useScale(wrapRef);
  const [guides, setGuides] = useState([]);
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
    if (rem <= 0) {
      timeText = cd.onEnd === 'overflow' ? '+' + fmtDuration((Date.now() - anchorRef.current) / 1000) : '0:00';
    } else {
      timeText = fmtDuration(Math.ceil(rem));
    }
  }
  const showEndMsg = cd.mode === 'countdown' && (anchorRef.current - Date.now()) / 1000 <= 0 && cd.onEnd === 'hold';

  function startDrag(e, start, onMove) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const sc = scaleRef.current || 1;
    const move = (ev) => onMove(((ev.clientX - sx) / sc) / FRAME_W * 100, ((ev.clientY - sy) / sc) / FRAME_H * 100, start, ev);
    const up = () => { setGuides([]); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const bL = (box.x / 100) * FRAME_W, bT = (box.y / 100) * FRAME_H;
  const bW = (box.w / 100) * FRAME_W, bH = (box.h / 100) * FRAME_H;
  const vAlign = timeStyle?.verticalAlign || 'center';
  const hAlign = timeStyle?.align === 'left' ? 'flex-start' : timeStyle?.align === 'right' ? 'flex-end' : 'center';

  return (
    <ScaledFrame wrapRef={wrapRef} scale={scale} contentGuide bgMedia={bgMedia} guides={guides}>
      <div style={{
        position: 'absolute', left: `${bL}px`, top: `${bT}px`, width: `${bW}px`, height: `${bH}px`,
        background: buildBarBg(timeStyle?.ltBar), padding: '16px 32px', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        justifyContent: vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center',
        alignItems: hAlign,
      }}>
        {(showEndMsg ? (cd.endMessage || label) : label) ? (
          <div style={flatTextCss(msgStyle, MSG_BASE)}>{showEndMsg ? (cd.endMessage || label) : label}</div>
        ) : null}
        <div style={{ ...flatTextCss(timeStyle, TIME_BASE), whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{timeText}</div>
      </div>

      {onBoxChange && (
        <div
          onPointerDown={(e) => startDrag(e, { ...box }, (dx, dy, s, ev) => {
            const snapped = snapMove({ x: s.x + dx, y: s.y + dy, w: s.w, h: s.h }, GFX_SNAP_TARGETS, { free: ev?.altKey, grid: 0 });
            setGuides(snapped.guides);
            onBoxChange({
              x: Math.round(clampPct(snapped.x, 0, 100 - s.w)),
              y: Math.round(clampPct(snapped.y, 0, 100 - s.h)),
              w: s.w, h: s.h,
            });
          })}
          style={{ position: 'absolute', left: `${bL}px`, top: `${bT}px`, width: `${bW}px`, height: `${bH}px`,
            border: '2px solid rgba(173,198,255,0.8)', boxSizing: 'border-box', cursor: 'move' }}
        >
          {TB_HANDLES.map((hnd, i) => {
            const hs = 14 / scale;
            return (
              <div key={i}
                onPointerDown={(e) => { e.stopPropagation(); startDrag(e, { ...box }, (dx, dy, s, ev) => {
                  const sized = resizeBox(s, hnd.hx, hnd.hy, dx, dy);
                  const { box: b, guides: g } = snapResizeBox(sized, hnd.hx, hnd.hy, GFX_SNAP_TARGETS, { free: ev?.altKey, min: MIN_BOX });
                  setGuides(g);
                  onBoxChange({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
                }); }}
                style={{ position: 'absolute', left: `${hnd.hx * 100}%`, top: `${hnd.hy * 100}%`, width: hs, height: hs,
                  transform: 'translate(-50%, -50%)', background: '#adc6ff', border: '1px solid #0c0e12', borderRadius: 2, cursor: hnd.cursor }} />
            );
          })}
        </div>
      )}
    </ScaledFrame>
  );
}

function TickerPreview({ text, tickerStyle, speed = 100, bgMedia = null }) {
  const wrapRef = useRef(null);
  const [scale] = useScale(wrapRef);
  const innerRef = useRef(null);
  const [dur, setDur] = useState(20);
  const top = tickerStyle?.position === 'top';
  const barBg = tickerStyle?.bar
    ? buildBarBg({ color: tickerStyle.bar.color, opacity: tickerStyle.bar.opacity, solid: true })
    : 'rgba(12,14,18,0.9)';
  const txt = flatTextCss(tickerStyle, { fontSize: 30, color: '#ffffff', fontWeight: 500 });
  const content = text || 'Ticker text…';

  // Crawl the text horizontally like the live output: the inner starts off the
  // right edge (padding-left:100%) and animates to translateX(-100%); duration =
  // travel distance / speed, so the crawl pace matches graphics-overlay.js.
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const distance = el.scrollWidth; // 100% padding (≈frame width) + text width
    const spd = Math.max(20, Number(speed) || 100);
    setDur(distance / spd);
  }, [content, tickerStyle, speed]);

  return (
    <ScaledFrame wrapRef={wrapRef} scale={scale} bgMedia={bgMedia}>
      <div style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 0, height: 72,
        background: barBg, borderTop: top ? 'none' : '3px solid #4d8eff', borderBottom: top ? '3px solid #4d8eff' : 'none',
        display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        <div ref={innerRef} style={{ ...txt, whiteSpace: 'nowrap', flexShrink: 0, paddingLeft: '100%',
          lineHeight: '72px', textAlign: 'left', willChange: 'transform',
          animation: `cue-ticker-crawl ${dur}s linear infinite` }}>
          {content}
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

// ── Design gallery (built-in presets) ───────────────────────────────────────────

// Sample fill so each tile reads like a real broadcast graphic. {{text}} is the
// kicker/eyebrow/badge slot most custom designs use as a third line.
const PRESET_SAMPLE = { name: 'Sarah Bennett', title: 'Worship Pastor', text: 'This Sunday' };

// Per-kind labels/icons + the order they appear as filter tabs.
const KIND_META = {
  lower_third: { label: 'Lower Thirds', icon: 'badge' },
  ticker:      { label: 'Tickers',      icon: 'subtitles' },
  countdown:   { label: 'Countdowns',   icon: 'timer' },
  custom:      { label: 'Custom',       icon: 'code' },
};
const KIND_ORDER = ['lower_third', 'ticker', 'countdown', 'custom'];

// A preset's style_json (already an object from the loader, but be defensive).
function presetStyle(preset) {
  const sj = preset?.graphic?.style_json;
  if (!sj) return {};
  return typeof sj === 'string' ? (() => { try { return JSON.parse(sj); } catch { return {}; } })() : sj;
}

// Live preview of a preset, rendered with the SAME components the editor/output
// use — so a structured design stays a real (editable) lower-third/ticker/
// countdown, and custom designs render their HTML in an isolated iframe.
function PresetPreview({ preset, replay }) {
  const wrapRef = useRef(null);
  const [scale] = useScale(wrapRef);
  const sj = presetStyle(preset);
  const g = preset.graphic || {};

  if (preset.kind === 'lower_third') {
    return <BugPreview name={g.name || PRESET_SAMPLE.name} title={g.title || PRESET_SAMPLE.title}
      nameStyle={sj.name} titleStyle={sj.title} />;
  }
  if (preset.kind === 'ticker') {
    return <TickerPreview text={g.text || 'Scrolling announcement…'} tickerStyle={sj} speed={g.speed} />;
  }
  if (preset.kind === 'countdown') {
    return <CountdownPreview cd={sj} timeStyle={sj.time} msgStyle={sj.message} label={g.text || ''} />;
  }
  // custom HTML
  return (
    <ScaledFrame wrapRef={wrapRef} scale={scale}>
      <iframe
        key={replay}
        title={preset.name}
        sandbox="allow-same-origin"
        srcDoc={previewDoc(fillPlaceholders(g.html, PRESET_SAMPLE))}
        style={{ width: FRAME_W, height: FRAME_H, border: 0, background: 'transparent', pointerEvents: 'none' }}
      />
    </ScaledFrame>
  );
}

// One clickable tile: live preview + name + kind badge. Re-mounts custom iframes on
// hover so their entrance animation replays.
function PresetTile({ preset, onPick }) {
  const [replay, setReplay] = useState(0);
  const meta = KIND_META[preset.kind] || KIND_META.custom;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPick(preset)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(preset); } }}
      onMouseEnter={() => setReplay((k) => k + 1)}
      className="group bg-surface-container border border-outline-variant/30 rounded-xl overflow-hidden flex flex-col cursor-pointer hover:border-primary/50 hover:ring-1 hover:ring-primary/30 active:scale-[0.99] transition-all"
    >
      <div className="p-sm pb-0">
        <PresetPreview preset={preset} replay={replay} />
      </div>
      <div className="px-md py-sm flex items-center justify-between gap-xs">
        <span className="text-label-sm font-mono font-bold text-on-surface truncate min-w-0">{preset.name}</span>
        <span className="text-[8px] font-mono uppercase tracking-[0.05em] text-on-surface-variant/50 border border-outline-variant/40 rounded px-[3px] py-[1px] shrink-0">{meta.label}</span>
      </div>
    </div>
  );
}

// Full-screen gallery of the bundled designs — mirrors ThemePickerModal's shell
// (search + responsive grid + close) plus per-type filter tabs. Picking a design
// calls onPick(preset); the caller decides what "use" means (the panel creates a
// graphic, the editor restyles the current draft). When `lockKind` is set the
// gallery shows only that kind and hides the tabs (used from inside the editor,
// where the graphic's kind is fixed).
export function GraphicsPresetModal({ onPick, onClose, lockKind = null }) {
  const [presets, setPresets] = useState([]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(lockKind || 'all');

  useEffect(() => {
    window.cue.graphics.presets().then((list) => setPresets(list || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Which kinds are actually present (for the tab bar), in canonical order.
  const presentKinds = useMemo(() => {
    const set = new Set(presets.map((p) => p.kind));
    return KIND_ORDER.filter((k) => set.has(k));
  }, [presets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const activeKind = lockKind || tab;
    let list = lockKind ? presets.filter((p) => p.kind === lockKind)
      : activeKind === 'all' ? presets : presets.filter((p) => p.kind === activeKind);
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    // Keep canonical kind grouping, then preset order (filename) within a kind.
    return [...list].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
  }, [presets, query, tab, lockKind]);

  const lockedMeta = lockKind ? (KIND_META[lockKind] || KIND_META.custom) : null;

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/90 flex flex-col" onMouseDown={onClose}>
      <div
        className="flex-1 min-h-0 flex flex-col m-lg bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0 gap-md">
          <h3 className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em] flex items-center gap-sm shrink-0">
            <span className="material-symbols-outlined text-primary text-[20px]">grid_view</span>
            {lockedMeta ? `${lockedMeta.label.replace(/s$/, '')} designs` : 'Design gallery'}
          </h3>
          <div className="flex-1 max-w-sm relative">
            <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant/60 text-[18px]">search</span>
            <input
              value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
              placeholder="Search designs…"
              className="w-full pl-[34px] pr-sm py-xs text-body-sm bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary/50"
            />
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface cursor-pointer flex items-center shrink-0">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Per-type filter tabs (hidden when the kind is locked from the editor) */}
        {!lockKind && presentKinds.length > 1 && (
          <div className="flex items-center gap-xs px-lg py-sm border-b border-outline-variant/20 bg-surface-container/40 shrink-0">
            {[{ id: 'all', label: 'All', icon: 'apps' }, ...presentKinds.map((k) => ({ id: k, ...KIND_META[k] }))].map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] transition-colors cursor-pointer ${
                  tab === t.id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}>
                <span className="material-symbols-outlined text-[14px]">{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto p-lg custom-scrollbar">
          {filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-sm text-outline-variant">
              <span className="material-symbols-outlined text-5xl">grid_view</span>
              <span className="text-label-sm font-label-sm uppercase tracking-widest">{presets.length ? 'No matches' : 'No designs'}</span>
            </div>
          ) : (
            <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {filtered.map((p) => <PresetTile key={p.id} preset={p} onPick={onPick} />)}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Convert a preset into the create-payload for a brand-new graphic (used by the
// Graphics panel's "Designs" gallery — adds it to the tab, ready to customise).
// Seeds sample content so the new graphic is immediately valid + visible.
export function presetToGraphic(preset) {
  const g = preset.graphic || {};
  const base = { kind: preset.kind, label: g.label || preset.name, target: 'ndi' };
  if (preset.kind === 'custom') {
    return { ...base, html: g.html, name: '', title: '', text: '' };
  }
  if (preset.kind === 'lower_third') {
    return { ...base, name: g.name || 'Name', title: g.title || '', style_json: g.style_json };
  }
  if (preset.kind === 'ticker') {
    return { ...base, text: g.text || 'Ticker text', speed: g.speed ?? 100, style_json: g.style_json };
  }
  if (preset.kind === 'countdown') {
    return { ...base, text: g.text || '', style_json: g.style_json };
  }
  return base;
}

// ── Editor ─────────────────────────────────────────────────────────────────────

export default function GraphicsEditor({ graphic, onClose, onSaved }) {
  useModalGuard();
  const isEdit = !!graphic?.id;
  const fonts = useFonts();

  // The whole working graphic is one `draft` object — routed through the shared
  // undo/redo history. Edits coalesce per field (see `set`/`setCd` below) so a
  // typing run or slider drag is a single undo step; preset application is one step.
  const initialDraft = useMemo(() => {
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
      autoDismissSec: Number(parsed.autoDismissSec) || 0, // 0 = sticky; >0 auto-hides after N sec live
      // Brand inheritance from the active theme (§ graphics↔theme). NEW graphics inherit
      // the theme accent by default (cohesion); existing keep their look ('custom') until
      // the user opts in. Font stays custom by default.
      accentSource: parsed.accentSource || (graphic ? 'custom' : 'theme'),
      fontSource:   parsed.fontSource   || 'custom',
      nameStyle:   { ...freshNameStyle(),   ...(parsed.name  || {}) },
      titleStyle:  { ...freshTitleStyle(),  ...(parsed.title || {}) },
      tickerStyle: { ...freshTickerStyle(), ...(graphic?.kind === 'ticker' ? parsed : {}) },
      cd: { ...FRESH_CD, mode: parsed.mode || FRESH_CD.mode, source: parsed.source || FRESH_CD.source,
        durationSec: parsed.durationSec ?? FRESH_CD.durationSec, targetClock: parsed.targetClock || FRESH_CD.targetClock,
        format: parsed.format || FRESH_CD.format, showSeconds: parsed.showSeconds !== false, endMessage: parsed.endMessage || '',
        onEnd: parsed.onEnd || 'hold',
        onEndMediaId: parsed.onEndMediaId || null, onEndMediaPath: parsed.onEndMediaPath || null,
        audioMediaId: parsed.audioMediaId || null, audioName: parsed.audioName || '', audioLoop: !!parsed.audioLoop },
      timeStyle: { ...freshTimeStyle(), ...(parsed.time    || {}) },
      msgStyle:  { ...freshMsgStyle(),  ...(parsed.message || {}) },
      bgMediaId:   graphic?.background_media_id || null,
      bgMediaPath: graphic?.background_path     || null,
      bgFit:       parsed.bgFit || 'cover',
    };
  }, [graphic]);
  const docH = useEditHistory(initialDraft);
  const draft = docH.state;
  const setDraft = (updater) => docH.set(updater);
  useUndoRedoKeys(docH.undo, docH.redo);
  const [target, setTarget] = useState('name'); // editing target — LT: 'name'|'title'; countdown: 'time'|'message'
  const [replayKey, setReplayKey] = useState(0);
  const [showGallery, setShowGallery] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [showEndMediaPicker, setShowEndMediaPicker] = useState(false);
  const [showAudioPicker, setShowAudioPicker] = useState(false);
  const htmlRef = useRef(null);

  // Apply a built-in design to the current draft. It's a STYLE preset, so keep the
  // operator's typed content (name/title/text) and only swap appearance — except
  // custom designs, where the HTML *is* the design. The gallery is locked to the
  // current kind, so the preset always matches.
  function applyPresetStyle(preset) {
    const sj = presetStyle(preset);
    setDraft((d) => {
      if (preset.kind === 'custom') return { ...d, kind: 'custom', html: preset.graphic?.html || '', label: d.label || preset.name };
      if (preset.kind === 'lower_third') return { ...d, nameStyle: { ...freshNameStyle(), ...(sj.name || {}) }, titleStyle: { ...freshTitleStyle(), ...(sj.title || {}) } };
      if (preset.kind === 'ticker') return { ...d, tickerStyle: { ...freshTickerStyle(), ...sj }, speed: preset.graphic?.speed ?? d.speed };
      if (preset.kind === 'countdown') return { ...d, timeStyle: { ...freshTimeStyle(), ...(sj.time || {}) }, msgStyle: { ...freshMsgStyle(), ...(sj.message || {}) } };
      return d;
    });
    setShowGallery(false);
    setReplayKey((k) => k + 1); // replay the entrance animation in the editor preview
  }

  // Escape closes the editor — but not while the design gallery is layered on top
  // (it owns its own Escape). A ref keeps the listener stable without resubscribing.
  const galleryOpenRef = useRef(false);
  galleryOpenRef.current = showGallery;
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !galleryOpenRef.current) onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ⌘S saves & closes; ⌘B/I/U toggle bold/italic/underline on the active text
  // style (whole-element formatting — these graphics have no inline runs). No dep
  // array so the listener always sees the current draft/activeStyle (matches the
  // sibling PresentationEditor pattern).
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || showGallery) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); if (canSave) save(); return; }
      if ((isLT || isTK || isCD) && (k === 'b' || k === 'i' || k === 'u')) {
        e.preventDefault();
        const prop = k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline';
        setActiveStyle({ ...activeStyle, [prop]: !activeStyle[prop] });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Coalesce edits by the field(s) touched, so a typing run / slider drag on one
  // field collapses to a single undo step but switching fields starts a new one.
  const set = (patch) => docH.set((d) => ({ ...d, ...patch }), Object.keys(patch).sort().join(','));
  const setCd = (patch) => docH.set((d) => ({ ...d, cd: { ...d.cd, ...patch } }), 'cd:' + Object.keys(patch).sort().join(','));
  const isLT = draft.kind === 'lower_third';
  const isTK = draft.kind === 'ticker';
  const isCD = draft.kind === 'countdown';
  const isCustom = draft.kind === 'custom';

  const canSave = isLT ? draft.name.trim() : isTK ? draft.text.trim() : isCD ? true : draft.html.trim();

  async function save() {
    // Auto-dismiss (name/title, ticker, custom) rides in style_json — no schema column,
    // same as how the countdown stashes mode/durationSec. 0 = sticky → omit the key.
    const dis = (isLT || isTK || isCustom) && draft.autoDismissSec > 0 ? { autoDismissSec: draft.autoDismissSec } : {};
    // bgFit stored in style_json only when background media is set (non-default fit).
    const bgFitKey = draft.bgMediaId && draft.bgFit !== 'cover' ? { bgFit: draft.bgFit } : {};
    // Theme-brand inheritance flags (only meaningful for text-bearing kinds).
    const brand = (isLT || isTK || isCD) ? { accentSource: draft.accentSource, fontSource: draft.fontSource } : {};
    let style_json = null;
    if (isLT) style_json = { name: draft.nameStyle, title: draft.titleStyle, ...brand, ...dis, ...bgFitKey };
    else if (isTK) {
      // tickerStyle absorbs the whole style_json on load (incl. a stored autoDismissSec),
      // so drop the stale key before re-folding the current toggle state.
      const { autoDismissSec: _drop, ...tickerBase } = draft.tickerStyle;
      style_json = { ...tickerBase, ...brand, ...dis, ...bgFitKey };
    } else if (isCD) style_json = { ...draft.cd, time: draft.timeStyle, message: draft.msgStyle, ...brand, ...bgFitKey };
    else if (isCustom) style_json = dis.autoDismissSec || Object.keys(bgFitKey).length ? { ...dis, ...bgFitKey } : null;

    const payload = {
      kind: draft.kind, label: draft.label, name: draft.name, title: draft.title,
      text: draft.text, html: draft.html, speed: draft.speed, target: draft.target,
      style_json,
      background_media_id: draft.bgMediaId || null,
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
    <>
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
          <div className="flex items-center gap-sm">
            <UndoRedoButtons undo={docH.undo} redo={docH.redo} canUndo={docH.canUndo} canRedo={docH.canRedo} />
            <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface cursor-pointer">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
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
              allowBoxFill={false} // graphics boxes use the ltBar bar control instead
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

            {/* Start from / restyle with a built-in design (locked to this kind). */}
            <button onClick={() => setShowGallery(true)}
              className="flex items-center justify-center gap-xs px-md py-sm rounded-lg text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25 cursor-pointer transition-colors">
              <span className="material-symbols-outlined text-[16px]">grid_view</span>
              {isCustom ? 'Browse designs' : 'Apply a design'}
            </button>

            {(isLT || isTK || isCD) && (
              <Field label="Match theme">
                <div className="flex flex-col gap-xs">
                  {[['accent', 'Accent', draft.accentSource, (v) => set({ accentSource: v })],
                    ['font', 'Font', draft.fontSource, (v) => set({ fontSource: v })]].map(([id, label, val, onCh]) => (
                    <div key={id} className="flex items-center gap-sm">
                      <span className="text-[10px] font-mono text-on-surface-variant/70 w-12 shrink-0 uppercase">{label}</span>
                      <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px]">
                        {[['theme', 'Theme'], ['custom', 'Custom']].map(([v, l]) => (
                          <button key={v} onClick={() => onCh(v)}
                            className={`px-sm py-[3px] text-[10px] font-mono uppercase tracking-[0.04em] rounded transition-colors cursor-pointer ${val === v ? 'bg-primary text-on-primary' : 'text-on-surface-variant/70 hover:text-on-surface'}`}>{l}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-on-surface-variant/50 leading-snug">“Theme” pulls the active rundown theme’s accent/font at air time — set once, stays cohesive. Applied on the next fire (never restyles live).</p>
                </div>
              </Field>
            )}

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
                    <Field label="On end">
                      <div className="flex items-center gap-xs flex-wrap">
                        {[
                          { id: 'hold',     label: 'Hold',      icon: 'pause_circle',        desc: 'Freeze at 0:00' },
                          { id: 'clear',    label: 'Clear',     icon: 'visibility_off',      desc: 'Hide the graphic' },
                          { id: 'overflow', label: 'Overflow',  icon: 'expand_circle_down',  desc: 'Keep counting past zero' },
                          { id: 'media',    label: 'Play media', icon: 'play_circle',          desc: 'Switch to a selected image or video' },
                          { id: 'loop',     label: 'Loop',      icon: 'loop',                desc: 'Restart from beginning' },
                        ].map((o) => (
                          <button key={o.id} onClick={() => setCd({ onEnd: o.id })}
                            title={o.desc}
                            className={`flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                              draft.cd.onEnd === o.id ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                            }`}>
                            <span className="material-symbols-outlined text-[14px]">{o.icon}</span>{o.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                    {draft.cd.onEnd === 'hold' && (
                      <Field label="End message (at zero)">
                        <input value={draft.cd.endMessage} onChange={(e) => setCd({ endMessage: e.target.value })} placeholder="e.g. Starting now"
                          className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary" />
                      </Field>
                    )}
                    {draft.cd.onEnd === 'media' && (
                      <Field label="Media to play">
                        <div className="flex items-start gap-sm">
                          {draft.cd.onEndMediaPath ? (
                            <div className="w-24 aspect-video rounded overflow-hidden border border-outline-variant/40 shrink-0 relative bg-black">
                              <MediaThumb path={draft.cd.onEndMediaPath} className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div className="w-24 aspect-video rounded border border-outline-variant/30 flex items-center justify-center bg-surface-container shrink-0">
                              <span className="material-symbols-outlined text-outline-variant text-2xl">play_circle</span>
                            </div>
                          )}
                          <div className="flex flex-col gap-xs">
                            <button onClick={() => setShowEndMediaPicker(true)}
                              className="flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors">
                              <span className="material-symbols-outlined text-[14px]">video_library</span>
                              {draft.cd.onEndMediaPath ? 'Change' : 'Pick media'}
                            </button>
                            {draft.cd.onEndMediaPath && (
                              <button onClick={() => setCd({ onEndMediaId: null, onEndMediaPath: null })}
                                className="flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-error cursor-pointer transition-colors">
                                <span className="material-symbols-outlined text-[14px]">close</span>
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                      </Field>
                    )}
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

                {/* Audio track — plays in-room while the timer is live, tied to Start/Stop
                    (and Pause/Resume). Sourced from any audio/video item in the media
                    library, which includes everything already in the rundown. */}
                <Field label="Audio track (plays while live)">
                  <div className="flex items-center gap-sm flex-wrap">
                    <button onClick={() => setShowAudioPicker(true)}
                      className="flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors">
                      <span className="material-symbols-outlined text-[14px]">music_note</span>
                      {draft.cd.audioMediaId ? 'Change' : 'Pick audio'}
                    </button>
                    {draft.cd.audioMediaId && (
                      <>
                        <span className="text-body-md text-on-surface truncate max-w-[160px]" title={draft.cd.audioName}>{draft.cd.audioName || 'Audio'}</span>
                        <button onClick={() => setCd({ audioLoop: !draft.cd.audioLoop })}
                          title="Loop the track until the timer stops"
                          className={`flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                            draft.cd.audioLoop ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                          }`}>
                          <span className="material-symbols-outlined text-[14px]">loop</span>{draft.cd.audioLoop ? 'Loop on' : 'Loop off'}
                        </button>
                        <button onClick={() => setCd({ audioMediaId: null, audioName: '' })}
                          className="flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-error cursor-pointer transition-colors">
                          <span className="material-symbols-outlined text-[14px]">close</span>Clear
                        </button>
                      </>
                    )}
                  </div>
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

            {/* Auto-dismiss — countdowns have their own end behaviour, so skip them. */}
            {(isLT || isTK || isCustom) && (
              <Field label="Auto-dismiss">
                <div className="flex items-center gap-sm">
                  <button onClick={() => set({ autoDismissSec: draft.autoDismissSec > 0 ? 0 : 8 })}
                    className={`flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                      draft.autoDismissSec > 0 ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                    }`}>
                    <span className="material-symbols-outlined text-[14px]">timer</span>
                    {draft.autoDismissSec > 0 ? 'On' : 'Off'}
                  </button>
                  {draft.autoDismissSec > 0 && (
                    <div className="flex items-center gap-xs">
                      <input type="number" min="1" max="3600" value={draft.autoDismissSec}
                        onChange={(e) => set({ autoDismissSec: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-16 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface text-center tabular-nums focus:outline-none focus:border-primary" />
                      <span className="text-label-sm font-label-sm text-on-surface-variant normal-case">seconds after airing</span>
                    </div>
                  )}
                </div>
              </Field>
            )}

            {/* Background media — optional full-screen video/image behind the overlay. */}
            <Field label="Background media">
              <div className="flex items-start gap-sm">
                {draft.bgMediaPath ? (
                  <div className="w-24 aspect-video rounded overflow-hidden border border-outline-variant/40 shrink-0 relative bg-black">
                    <MediaThumb path={draft.bgMediaPath} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-24 aspect-video rounded border border-outline-variant/30 flex items-center justify-center bg-surface-container shrink-0">
                    <span className="material-symbols-outlined text-outline-variant text-2xl">wallpaper</span>
                  </div>
                )}
                <div className="flex flex-col gap-xs">
                  <button onClick={() => setShowBgPicker(true)}
                    className="flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors">
                    <span className="material-symbols-outlined text-[14px]">video_library</span>
                    {draft.bgMediaPath ? 'Change' : 'Set media'}
                  </button>
                  {draft.bgMediaPath && (
                    <button onClick={() => set({ bgMediaId: null, bgMediaPath: null })}
                      className="flex items-center gap-xs px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-error cursor-pointer transition-colors">
                      <span className="material-symbols-outlined text-[14px]">close</span>
                      Clear
                    </button>
                  )}
                </div>
              </div>
              {draft.bgMediaPath && (
                <div className="flex items-center gap-xs mt-xs">
                  <span className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">Fit</span>
                  {[{ id: 'cover', label: 'Cover' }, { id: 'contain', label: 'Contain' }].map((o) => (
                    <button key={o.id} onClick={() => set({ bgFit: o.id })}
                      className={`px-md py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                        draft.bgFit === o.id ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-container-lowest border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                      }`}>{o.label}</button>
                  ))}
                </div>
              )}
            </Field>
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
                <TickerPreview text={draft.text} tickerStyle={draft.tickerStyle} speed={draft.speed}
                  bgMedia={draft.bgMediaPath ? { path: draft.bgMediaPath, fit: draft.bgFit } : null} />
              ) : isCD ? (
                <CountdownPreview cd={draft.cd} timeStyle={draft.timeStyle} msgStyle={draft.msgStyle} label={draft.text}
                  onBoxChange={(box) => set({ timeStyle: { ...draft.timeStyle, textBox: box } })}
                  bgMedia={draft.bgMediaPath ? { path: draft.bgMediaPath, fit: draft.bgFit } : null} />
              ) : (
                <BugPreview
                  name={draft.name} title={draft.title}
                  nameStyle={draft.nameStyle} titleStyle={draft.titleStyle}
                  onBoxChange={(box) => set({ nameStyle: { ...draft.nameStyle, textBox: box } })}
                  bgMedia={draft.bgMediaPath ? { path: draft.bgMediaPath, fit: draft.bgFit } : null}
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
    </div>

    {showGallery && (
      <GraphicsPresetModal lockKind={draft.kind} onPick={applyPresetStyle} onClose={() => setShowGallery(false)} />
    )}
    {showBgPicker && (
      <MediaPickerModal
        initialId={draft.bgMediaId}
        onClose={() => setShowBgPicker(false)}
        onSelect={(asset) => {
          set({ bgMediaId: asset ? asset.id : null, bgMediaPath: asset ? asset.path : null });
          setShowBgPicker(false);
        }}
      />
    )}
    {showEndMediaPicker && (
      <MediaPickerModal
        initialId={draft.cd.onEndMediaId}
        onClose={() => setShowEndMediaPicker(false)}
        onSelect={(asset) => {
          setCd({ onEndMediaId: asset ? asset.id : null, onEndMediaPath: asset ? asset.path : null });
          setShowEndMediaPicker(false);
        }}
      />
    )}
    {showAudioPicker && (
      <AudioTrackPickerModal
        selectedId={draft.cd.audioMediaId}
        onClose={() => setShowAudioPicker(false)}
        onSelect={(asset) => {
          setCd({ audioMediaId: asset ? asset.id : null, audioName: asset ? (asset.filename || 'Audio') : '' });
          setShowAudioPicker(false);
        }}
      />
    )}
    </>,
    document.body
  );
}

// Audio-track picker for the countdown "play while live" track. MediaPickerModal is
// image/video + thumbnail-based, so this is a lightweight list of audio/video assets
// (the audio of a video item works too). Sourced from the whole media library, which
// includes every file already added to a rundown.
function AudioTrackPickerModal({ selectedId, onSelect, onClose }) {
  const [assets, setAssets] = useState(null);
  useEffect(() => {
    window.cue.media.listAll().then((all) =>
      setAssets((all || []).filter((a) => a.type === 'audio' || a.type === 'video'))
    );
  }, []);
  const fmtDur = (ms) => {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  return createPortal(
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6" onClick={onClose}>
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-lg max-h-[70vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-lg py-md border-b border-outline-variant/20 flex items-center gap-sm shrink-0">
          <span className="material-symbols-outlined text-primary">music_note</span>
          <h3 className="text-headline-sm font-bold text-on-surface">Choose audio track</h3>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-sm min-h-0">
          {assets === null ? (
            <div className="p-lg text-center text-on-surface-variant text-body-md">Loading…</div>
          ) : assets.length === 0 ? (
            <div className="p-lg text-center text-on-surface-variant text-body-md">No audio or video in the media library yet.</div>
          ) : (
            <div className="flex flex-col gap-[2px]">
              {assets.map((a) => (
                <button key={a.id} onClick={() => onSelect(a)}
                  className={`flex items-center gap-sm px-sm py-2 rounded-lg text-left transition-colors cursor-pointer ${
                    a.id === selectedId ? 'bg-primary/15 text-primary' : 'text-on-surface hover:bg-surface-container'
                  }`}>
                  <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">{a.type === 'audio' ? 'audiotrack' : 'movie'}</span>
                  <span className="flex-1 min-w-0 truncate text-body-md">{a.filename}</span>
                  <span className="text-label-sm font-label-sm text-on-surface-variant tabular-nums shrink-0">{fmtDur(a.duration_ms)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="px-lg py-sm border-t border-outline-variant/20 flex justify-end shrink-0">
          <button onClick={onClose} className="px-md py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:text-on-surface cursor-pointer">Cancel</button>
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
