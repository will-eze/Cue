import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FormattingToolbar, DEFAULT_STYLE, styleIsDefault } from './SongEditor';

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
  { id: 'custom',      label: 'Custom HTML',  icon: 'code' },
];

const FRAME_W = 1920, FRAME_H = 1080;

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

function ScaledFrame({ children, wrapRef, scale }) {
  return (
    <div ref={wrapRef} className="w-full aspect-video relative overflow-hidden rounded-lg"
      style={{ backgroundImage: 'repeating-conic-gradient(#1a1a1a 0% 25%, #222 0% 50%)', backgroundSize: '28px 28px' }}>
      <div style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', inset: 0 }}>
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
    <ScaledFrame wrapRef={wrapRef} scale={scale}>
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
  const fonts = window.cue.fonts.list;

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
    };
  });
  const [target, setTarget] = useState('name'); // lower-third editing target: 'name' | 'title'
  const [replayKey, setReplayKey] = useState(0);
  const htmlRef = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const isLT = draft.kind === 'lower_third';
  const isTK = draft.kind === 'ticker';
  const isCustom = draft.kind === 'custom';

  const canSave = isLT ? draft.name.trim() : isTK ? draft.text.trim() : draft.html.trim();

  async function save() {
    let style_json = null;
    if (isLT) style_json = { name: draft.nameStyle, title: draft.titleStyle };
    else if (isTK) style_json = draft.tickerStyle;

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

  // Which style the toolbar edits (lower third: name or title; ticker: tickerStyle).
  const activeStyle = isLT ? (target === 'name' ? draft.nameStyle : draft.titleStyle) : draft.tickerStyle;
  const setActiveStyle = (next) => {
    if (isLT) set(target === 'name' ? { nameStyle: next } : { titleStyle: next });
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

        {/* Styling toolbar (lower third + ticker) */}
        {(isLT || isTK) && (
          <>
            {isLT && (
              <div className="flex items-center gap-sm px-lg py-xs border-b border-outline-variant/20 bg-surface-container/40 shrink-0">
                <span className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">Editing</span>
                <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px]">
                  {[{ id: 'name', label: 'Name' }, { id: 'title', label: 'Title' }].map(({ id, label }) => (
                    <button key={id}
                      onMouseDown={(e) => { e.preventDefault(); setTarget(id); }}
                      className={`px-md h-6 text-[10px] font-mono rounded transition-colors cursor-pointer uppercase tracking-[0.05em] ${
                        target === id ? 'bg-primary text-on-primary' : 'text-on-surface-variant/60 hover:text-on-surface-variant'
                      }`}
                    >{label}</button>
                  ))}
                </div>
                <span className="text-[9px] font-mono text-on-surface-variant/40">
                  {target === 'name' ? 'Drag/resize the box in the preview · controls the bar + position' : 'Styling the title line'}
                </span>
              </div>
            )}
            <FormattingToolbar
              style={activeStyle}
              onChange={setActiveStyle}
              fonts={fonts}
              hasSelection={() => false}
              execCmd={() => {}}
              // 'fullscreen' for the name target → box X/Y/W/H + object-align controls.
              // 'lowerthird' for the simple (title/ticker) targets → hides the stray
              // reference Pos control (the bar control is gated off by simple).
              previewTemplate={isLT && target === 'name' ? 'fullscreen' : 'lowerthird'}
              simple={isTK || (isLT && target === 'title')}
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
