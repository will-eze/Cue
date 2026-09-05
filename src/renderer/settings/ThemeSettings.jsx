import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import AnchoredMenu from '../components/AnchoredMenu';
import {
  FormattingToolbar,
  SlidePreview,
  LowerThirdPreview,
  DEFAULT_STYLE,
} from '../components/SongEditor';
import MediaPickerModal from '../components/MediaPickerModal';
import { useToast } from '../components/Toast';
import { BackgroundBrowseModal } from './BackgroundLibrary.jsx';
import { themeKind, filterBrowseThemes, isCuratedTheme } from '../utils/themeSort';
import { ensureThemeBg } from '../utils/ensureThemeBg';
import { getThemeFavs, toggleThemeFav } from '../utils/themeFavorites';
import ThemeCascadeBar from '../components/ThemeCascadeBar';
import LazyVisible from '../components/LazyVisible';
import { themeContrast } from '../utils/contrast';
import { mediaUrl } from '../utils/mediaUrl';
import { StaticSlide } from '../components/SlideElements';
import { buildThemeSlide, PRES_LAYOUTS, normalizeLookStyle, isThemeTokens } from '../utils/presentationThemes';
import { useFonts } from '../utils/fonts';

const SAMPLE_TEXT = 'Amazing Grace\nHow Sweet the Sound';
const SCRIPTURE_SAMPLE = 'For God so loved the world,\nthat he gave his only Son.';

const labelCls = 'block text-[9px] font-mono text-on-surface-variant/60 mb-0.5 uppercase tracking-[0.05em]';

// Which content surfaces a custom theme can target. Song & scripture themes share
// the song text-style shape (DEFAULT_STYLE + a media background) and differ only by
// `category`; presentation themes are layout-agnostic tokens ({ kind:'pres-theme' }).
const THEME_CATS = [
  { id: 'song', label: 'Songs' },
  { id: 'scripture', label: 'Scripture' },
  { id: 'presentation', label: 'Presentations' },
];

// Default tokens for a brand-new presentation theme (mirrors the "Midnight Title"
// built-in shape — see scripts/build-presentation-themes.mjs).
const DEFAULT_PRES_TOKENS = {
  kind: 'pres-theme', bg: 'linear-gradient(135deg,#0b1220,#1b2b4a)',
  display: 'Inter', body: 'Inter', quoteFont: 'Cormorant Garamond',
  title: '#ffffff', sub: '#9fb6d6', bodyColor: '#cdd9ee',
  accent: '#4d8eff', accentText: '#02132e', kicker: '#7fb0ff',
  titleUpper: false, sectionUpper: false, serif: false,
};

// ─── Auto-derive a theme from a background ─────────────────────────────────
// Deterministic display-face pairings (all bundled → identical on every device,
// offline). "New from a background" downloads the media, picks one, and applies an
// always-on scrim + lower-third bar so white text stays legible on any image. The
// result is saved as a concrete, editable theme definition (never re-generated). §0b.2
const DERIVE_DISPLAY = ['Montserrat', 'Oswald', 'Bebas Neue', 'Playfair Display', 'Cormorant Garamond', 'Anton', 'Archivo', 'Cinzel'];

function titleFromBgItem(item) {
  const tag = (item.tags || []).find((t) => t && t.length > 2 && !/^\d/.test(t));
  if (!tag) return 'New Look';
  return tag.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function deriveThemeFromBackground(item) {
  const asset = await window.cue.backgrounds.download(item.id);
  const idx = String(item.id).split('').reduce((a, c) => a + c.charCodeAt(0), 0) % DERIVE_DISPLAY.length;
  const display = DERIVE_DISPLAY[idx];
  const serif = /Playfair|Cormorant|Cinzel|Garamond/.test(display);
  const style = {
    ...DEFAULT_STYLE,
    fontFamily: display,
    color: '#ffffff',
    uppercase: /Bebas|Oswald|Anton/.test(display),
    fontSize: serif ? 96 : 92,
    lineSpacing: 1.08,
    letterSpacing: /Bebas|Anton/.test(display) ? 0.03 : 0,
    textShadow: { enabled: true, x: 0, y: 2, blur: 26, color: 'rgba(0,0,0,0.5)' },
    bgScrim: 0.28,
    ltBar: { css: 'linear-gradient(to top, rgba(6,8,14,0.92) 0%, rgba(6,8,14,0.78) 66%, rgba(6,8,14,0) 100%)' },
  };
  return window.cue.themes.create({
    name: titleFromBgItem(item),
    style_json: JSON.stringify(style),
    background_id: asset.id,
    category: 'song',
  });
}

// ─── Presentation token editor ─────────────────────────────────────────────
// Edits a { kind:'pres-theme', … } token bag: background (solid/gradient/custom
// CSS), heading/body/quote fonts, role colours, and case/serif flags. buildThemeSlide
// composes any layout from these, so the slide preview stays WYSIWYG with output.

// Parse a token bg string back into editable controls. Simple 2-stop linear gradients
// and solid hex colours round-trip; anything else (radial, multi-stop) drops to a raw
// CSS field so it's never silently lost.
function parseBg(bg) {
  const d = { mode: 'gradient', solid: '#0a0e1a', c1: '#0b1220', c2: '#1b2b4a', angle: 135, raw: bg || '' };
  if (!bg) return d;
  const s = bg.trim();
  const color = '(#[0-9a-fA-F]{3,8}|rgba?\\([^)]+\\))';
  const lin = new RegExp(`^linear-gradient\\(\\s*(-?\\d+)deg\\s*,\\s*${color}\\s*,\\s*${color}\\s*\\)$`).exec(s);
  if (lin) return { ...d, mode: 'gradient', angle: Number(lin[1]), c1: lin[2], c2: lin[3] };
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return { ...d, mode: 'solid', solid: s };
  return { ...d, mode: 'custom', raw: s };
}

function PresBgEditor({ value, onChange }) {
  const [bg, setBg] = useState(() => parseBg(value));
  // Recompose the CSS bg from the editable parts and push it up.
  const push = (next) => {
    setBg(next);
    const css = next.mode === 'solid' ? next.solid
      : next.mode === 'gradient' ? `linear-gradient(${next.angle}deg,${next.c1},${next.c2})`
      : next.raw;
    onChange(css);
  };
  const modes = [['solid', 'Solid'], ['gradient', 'Gradient'], ['custom', 'CSS']];
  return (
    <div className="flex flex-col gap-xs">
      <span className={labelCls}>Background</span>
      <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px] w-fit">
        {modes.map(([id, label]) => (
          <button key={id} onClick={() => push({ ...bg, mode: id })}
            className={`px-sm py-[2px] text-[9px] font-mono rounded uppercase tracking-[0.05em] transition-colors cursor-pointer ${bg.mode === id ? 'bg-primary text-on-primary' : 'text-on-surface-variant/60 hover:text-on-surface-variant'}`}>{label}</button>
        ))}
      </div>
      {bg.mode === 'solid' && (
        <Swatch value={bg.solid} onChange={(v) => push({ ...bg, solid: v })} />
      )}
      {bg.mode === 'gradient' && (
        <div className="flex items-center gap-sm">
          <Swatch value={bg.c1} onChange={(v) => push({ ...bg, c1: v })} />
          <Swatch value={bg.c2} onChange={(v) => push({ ...bg, c2: v })} />
          <label className="flex items-center gap-1 text-[10px] font-mono text-on-surface-variant/70">
            <span className="uppercase tracking-[0.05em]">Angle</span>
            <input type="number" value={bg.angle} onChange={(e) => push({ ...bg, angle: Number(e.target.value) })}
              className="w-14 bg-surface-container-lowest border border-outline-variant/40 rounded px-1 py-[2px] text-on-surface outline-none focus:border-primary" />
          </label>
        </div>
      )}
      {bg.mode === 'custom' && (
        <input value={bg.raw} onChange={(e) => push({ ...bg, raw: e.target.value })}
          placeholder="radial-gradient(circle, #000, #111)"
          className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded px-sm py-1 text-[11px] font-mono text-on-surface outline-none focus:border-primary" />
      )}
    </div>
  );
}

function Swatch({ value, onChange }) {
  return <input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)}
    className="w-8 h-8 rounded cursor-pointer bg-transparent border border-outline-variant/30 shrink-0" />;
}

function FontSelect({ label, value, onChange, fonts }) {
  return (
    <label className="flex flex-col gap-0.5 min-w-0">
      <span className={labelCls}>{label}</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-surface-container-lowest border border-outline-variant/40 rounded px-sm py-1 text-[11px] font-mono text-on-surface outline-none focus:border-primary cursor-pointer">
        {fonts.map((f) => <option key={f.family} value={f.family}>{f.label || f.family}</option>)}
      </select>
    </label>
  );
}

function ColorRow({ label, value, onChange }) {
  return (
    <label className="flex items-center justify-between gap-sm">
      <span className="text-[10px] font-mono text-on-surface-variant/70 uppercase tracking-[0.04em] truncate">{label}</span>
      <Swatch value={value} onChange={onChange} />
    </label>
  );
}

function PresThemeEditor({ tokens, setTokens, fonts }) {
  const setTok = (k, v) => setTokens((t) => ({ ...t, [k]: v }));
  const flag = (k, label) => (
    <label className="flex items-center gap-xs cursor-pointer">
      <input type="checkbox" checked={!!tokens[k]} onChange={(e) => setTok(k, e.target.checked)} className="accent-primary w-3 h-3" />
      <span className="text-[10px] font-mono text-on-surface-variant/70 uppercase tracking-[0.04em]">{label}</span>
    </label>
  );
  return (
    <div className="px-lg py-md grid grid-cols-2 gap-lg border-b border-outline-variant/20">
      {/* Left: background + fonts + flags */}
      <div className="flex flex-col gap-md min-w-0">
        <PresBgEditor value={tokens.bg} onChange={(v) => setTok('bg', v)} />
        <div className="grid grid-cols-1 gap-sm">
          <FontSelect label="Heading font" value={tokens.display} onChange={(v) => setTok('display', v)} fonts={fonts} />
          <FontSelect label="Body font" value={tokens.body} onChange={(v) => setTok('body', v)} fonts={fonts} />
          <FontSelect label="Quote font" value={tokens.quoteFont} onChange={(v) => setTok('quoteFont', v)} fonts={fonts} />
        </div>
        <div className="flex flex-wrap gap-md pt-xs">
          {flag('titleUpper', 'Uppercase titles')}
          {flag('sectionUpper', 'Uppercase sections')}
          {flag('serif', 'Serif headings')}
        </div>
      </div>
      {/* Right: role colours */}
      <div className="flex flex-col gap-sm min-w-0">
        <span className={labelCls}>Colours</span>
        <ColorRow label="Title" value={tokens.title} onChange={(v) => setTok('title', v)} />
        <ColorRow label="Subtitle" value={tokens.sub} onChange={(v) => setTok('sub', v)} />
        <ColorRow label="Body" value={tokens.bodyColor} onChange={(v) => setTok('bodyColor', v)} />
        <ColorRow label="Accent" value={tokens.accent} onChange={(v) => setTok('accent', v)} />
        <ColorRow label="Accent text (on accent)" value={tokens.accentText} onChange={(v) => setTok('accentText', v)} />
        <ColorRow label="Kicker / reference" value={tokens.kicker} onChange={(v) => setTok('kicker', v)} />
      </div>
    </div>
  );
}

// ─── Lower-third & accent controls ─────────────────────────────────────────
// A theme styles two surfaces: the fullscreen slide and the lower-third overlay.
// The lower third starts identical to the fullscreen look; any field switched to
// "Custom" is stored in style.lt and overrides fullscreen on the overlay only.

function SurfaceSwitch({ value, onChange }) {
  const opts = [{ id: 'fullscreen', label: 'Fullscreen' }, { id: 'lowerthird', label: 'Lower Third' }];
  return (
    <div className="px-lg pt-md pb-sm bg-surface-container-lowest flex items-center gap-sm border-b border-outline-variant/20">
      <span className={labelCls} style={{ marginBottom: 0 }}>Editing</span>
      <div className="flex items-center gap-[2px] bg-surface-container rounded-lg p-[3px]">
        {opts.map((o) => (
          <button key={o.id} onClick={() => onChange(o.id)}
            className={`px-md py-1 rounded text-label-sm font-mono uppercase tracking-[0.05em] transition-colors cursor-pointer ${value === o.id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>
            {o.label}
          </button>
        ))}
      </div>
      <span className="text-[10px] text-on-surface-variant/50 ml-auto">
        {value === 'lowerthird' ? 'Overlay style — can differ from fullscreen' : 'Main on-screen output'}
      </span>
    </div>
  );
}

// A small on/off switch (green when on) — used for accent, uppercase, shadow.
function ThemeToggle({ on, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors cursor-pointer border ${on ? 'bg-tertiary-container border-tertiary-container' : 'bg-surface-container border-outline-variant/50'}`}>
      <span className={`absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-[2px]'}`} />
    </button>
  );
}

// "Same as fullscreen" ↔ "Custom" chooser for one lower-third field.
function InheritSeg({ overridden, onInherit, onCustom }) {
  const cls = (active) => `px-sm py-[3px] text-[10px] font-mono rounded uppercase tracking-[0.04em] transition-colors cursor-pointer ${active ? 'bg-primary text-on-primary' : 'text-on-surface-variant/70 hover:text-on-surface-variant'}`;
  return (
    <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px] shrink-0">
      <button className={cls(!overridden)} onClick={onInherit}>Same as fullscreen</button>
      <button className={cls(overridden)} onClick={onCustom}>Custom</button>
    </div>
  );
}

function OverrideRow({ label, sub, overridden, onInherit, onCustom, children }) {
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-center justify-between gap-md">
        <div className="min-w-0">
          <div className="text-[12px] text-on-surface">{label}</div>
          {sub && <div className="text-[10px] text-on-surface-variant/60">{sub}</div>}
        </div>
        <InheritSeg overridden={overridden} onInherit={onInherit} onCustom={onCustom} />
      </div>
      {overridden && <div className="pl-sm">{children}</div>}
    </div>
  );
}

// Accent — theme-wide colour rendered as a rule on the lower third; toggle turns it off.
function AccentControl({ accent, onChange }) {
  const on = !!accent?.enabled;
  const color = accent?.color || '#e7c98a';
  return (
    <div className="px-lg py-sm border-b border-outline-variant/20 bg-surface-container/40 flex items-center gap-md">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-mono text-on-surface uppercase tracking-[0.05em]">Accent</div>
        <div className="text-[10px] text-on-surface-variant/60">A colour rule under the lower-third text. Turn it off if you don’t want an accent.</div>
      </div>
      <span className="text-[10px] font-mono text-on-surface-variant/50 uppercase">{on ? 'On' : 'Off'}</span>
      <ThemeToggle on={on} onChange={(v) => onChange({ enabled: v, color })} />
      <div className={on ? '' : 'opacity-30 pointer-events-none'}>
        <Swatch value={color} onChange={(v) => onChange({ enabled: on, color: v })} />
      </div>
    </div>
  );
}

// Background motion — video backgrounds play at normal speed by default; slow them
// for a calmer, less-distracting loop. (Only affects video backgrounds.)
const BG_SPEEDS = [{ v: 1, label: 'Normal' }, { v: 0.7, label: 'Slow' }, { v: 0.5, label: 'Slower' }, { v: 0.35, label: 'Slowest' }];
function BgSpeedControl({ speed, onChange }) {
  const cur = speed || 1;
  return (
    <div className="px-lg py-sm border-b border-outline-variant/20 bg-surface-container/40 flex items-center gap-md">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-mono text-on-surface uppercase tracking-[0.05em]">Background motion</div>
        <div className="text-[10px] text-on-surface-variant/60">Slow a distracting loop. Only affects video backgrounds; default is normal speed.</div>
      </div>
      <div className="flex items-center gap-[2px] bg-surface-container rounded-lg p-[3px] shrink-0">
        {BG_SPEEDS.map((s) => (
          <button key={s.v} onClick={() => onChange(s.v === 1 ? undefined : s.v)}
            className={`px-sm py-1 rounded text-[10px] font-mono uppercase tracking-[0.04em] transition-colors cursor-pointer ${Math.abs(cur - s.v) < 0.01 ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Treatment layer (§5) ──────────────────────────────────────────────────────
// The designed legibility + grade stack that lifts a flat "font on a wash" into a
// composed, commercial-looking slide. Edits style.treatment; rendered by
// components/TreatmentOverlays.jsx (preview) + output/fullscreen.js (output).
const SCRIM_SHAPES = [['none', 'None'], ['bottom', 'Bottom'], ['radial', 'Center'], ['flat', 'Even'], ['top', 'Top']];
const KB_MODES = [['none', 'None'], ['zoom', 'Zoom'], ['pan-lr', 'Pan ↔'], ['pan-tb', 'Pan ↕'], ['drift', 'Drift']];
const GRADE_BLENDS = ['soft-light', 'multiply', 'overlay', 'screen', 'color'];

function TxSlider({ label, value, min = 0, max = 1, step = 0.01, onChange }) {
  return (
    <label className="flex items-center gap-sm">
      <span className="text-[10px] text-on-surface-variant/70 w-20 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-primary cursor-pointer" />
      <span className="text-[10px] font-mono text-on-surface-variant/50 w-9 text-right tabular-nums">{Math.round(value * 100)}%</span>
    </label>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px] flex-wrap">
      {options.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)}
          className={`px-sm py-[3px] text-[10px] font-mono rounded uppercase tracking-[0.04em] transition-colors cursor-pointer ${value === id ? 'bg-primary text-on-primary' : 'text-on-surface-variant/70 hover:text-on-surface-variant'}`}>{label}</button>
      ))}
    </div>
  );
}

function TreatmentControl({ treatment, onChange }) {
  const t = treatment || {};
  const set = (patch) => {
    const next = { ...t, ...patch };
    Object.keys(next).forEach((k) => { if (next[k] == null) delete next[k]; });
    onChange(Object.keys(next).length ? next : undefined);
  };
  const scrimShape = t.scrim || 'none';
  const setTint = (patch) => {
    const tint = { color: '#3a6ea5', amount: 0.12, blend: 'soft-light', ...(t.tint || {}), ...patch };
    set({ tint: tint.amount > 0 ? tint : undefined });
  };
  const glass = t.glass || {};
  const setGlass = (patch) => {
    const g = { enabled: false, blur: 22, opacity: 0.28, tint: '#0a0e1a', radius: 26, pad: 56, ...(t.glass || {}), ...patch };
    set({ glass: g.enabled ? g : undefined });
  };

  return (
    <div className="px-lg py-md border-b border-outline-variant/20 bg-surface-container/40 flex flex-col gap-md">
      <div className="min-w-0">
        <div className="text-[11px] font-mono text-on-surface uppercase tracking-[0.05em]">Treatment</div>
        <div className="text-[10px] text-on-surface-variant/60">Designed legibility &amp; grade — the layer that makes a background look professional.</div>
      </div>

      {/* Scrim — directional darkening for legibility */}
      <div className="flex flex-col gap-sm">
        <div className="flex items-center justify-between gap-sm">
          <span className="text-[11px] text-on-surface">Scrim</span>
          <Segmented options={SCRIM_SHAPES} value={scrimShape}
            onChange={(id) => set({ scrim: id === 'none' ? undefined : id, scrimStrength: id === 'none' ? undefined : (t.scrimStrength ?? 0.4) })} />
        </div>
        {scrimShape !== 'none' && (
          <TxSlider label="Strength" value={t.scrimStrength ?? 0.4} onChange={(v) => set({ scrimStrength: v })} />
        )}
      </div>

      <TxSlider label="Vignette" value={t.vignette ?? 0} max={0.6} onChange={(v) => set({ vignette: v || undefined })} />
      <TxSlider label="Film grain" value={t.grain ?? 0} max={0.3} onChange={(v) => set({ grain: v || undefined })} />

      {/* Colour grade / tint */}
      <div className="flex flex-col gap-sm">
        <div className="flex items-center justify-between gap-sm">
          <span className="text-[11px] text-on-surface">Colour grade</span>
          <div className="flex items-center gap-sm">
            <Swatch value={t.tint?.color || '#3a6ea5'} onChange={(v) => setTint({ color: v })} />
            <select value={t.tint?.blend || 'soft-light'} onChange={(e) => setTint({ blend: e.target.value })}
              className="bg-surface-container-lowest border border-outline-variant/40 rounded px-sm py-[3px] text-[10px] font-mono text-on-surface outline-none focus:border-primary cursor-pointer">
              {GRADE_BLENDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>
        <TxSlider label="Amount" value={t.tint?.amount ?? 0} max={0.5} onChange={(v) => setTint({ amount: v })} />
      </div>

      {/* Frosted glass panel behind text */}
      <div className="flex flex-col gap-sm">
        <div className="flex items-center gap-sm">
          <span className="text-[11px] text-on-surface flex-1">Glass panel</span>
          <ThemeToggle on={!!glass.enabled} onChange={(v) => setGlass({ enabled: v })} />
          <span className="text-[10px] font-mono text-on-surface-variant/50 uppercase">{glass.enabled ? 'On' : 'Off'}</span>
        </div>
        {glass.enabled && (
          <>
            <div className="flex items-center gap-sm">
              <span className="text-[10px] text-on-surface-variant/70 w-20 shrink-0">Tint</span>
              <Swatch value={glass.tint || '#0a0e1a'} onChange={(v) => setGlass({ tint: v })} />
            </div>
            <TxSlider label="Blur" value={(glass.blur ?? 22) / 40} onChange={(v) => setGlass({ blur: Math.round(v * 40) })} />
            <TxSlider label="Opacity" value={glass.opacity ?? 0.28} max={0.7} onChange={(v) => setGlass({ opacity: v })} />
          </>
        )}
      </div>

      {/* Ken Burns motion — only affects still photo backgrounds */}
      <div className="flex items-center justify-between gap-sm">
        <div className="min-w-0">
          <span className="text-[11px] text-on-surface">Motion</span>
          <div className="text-[10px] text-on-surface-variant/50">Slow drift on still photo backgrounds.</div>
        </div>
        <Segmented options={KB_MODES} value={t.kenBurns || 'none'}
          onChange={(id) => set({ kenBurns: id === 'none' ? undefined : id })} />
      </div>
    </div>
  );
}

// Lower-third bar (the band behind the words). None / Solid / Gradient (+ colour),
// or a theme-authored custom CSS background.
function parseBar(bar) {
  if (!bar) return { mode: 'none', color: '#050912', opacity: 0.88, raw: '' };
  if (bar.css) return { mode: 'custom', color: '#050912', opacity: 0.88, raw: bar.css };
  return { mode: bar.solid ? 'solid' : 'gradient', color: bar.color || '#050912', opacity: bar.opacity ?? 0.88, raw: '' };
}
function LtBarEditor({ value, onChange }) {
  const [b, setB] = useState(() => parseBar(value));
  const push = (next) => {
    setB(next);
    if (next.mode === 'none') onChange(null);
    else if (next.mode === 'custom') onChange(next.raw ? { css: next.raw } : null);
    else onChange({ color: next.color, opacity: next.opacity, solid: next.mode === 'solid' });
  };
  const modes = [['none', 'None'], ['solid', 'Solid'], ['gradient', 'Gradient'], ['custom', 'CSS']];
  return (
    <div className="flex flex-col gap-sm">
      <div className="min-w-0">
        <div className="text-[12px] text-on-surface">Lower-third bar</div>
        <div className="text-[10px] text-on-surface-variant/60">The band behind the words. A gradient fades it into the background.</div>
      </div>
      <div className="flex items-center gap-sm flex-wrap">
        <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px]">
          {modes.map(([id, label]) => (
            <button key={id} onClick={() => push({ ...b, mode: id })}
              className={`px-sm py-[3px] text-[10px] font-mono rounded uppercase tracking-[0.04em] transition-colors cursor-pointer ${b.mode === id ? 'bg-primary text-on-primary' : 'text-on-surface-variant/70 hover:text-on-surface-variant'}`}>{label}</button>
          ))}
        </div>
        {(b.mode === 'solid' || b.mode === 'gradient') && (
          <Swatch value={b.color} onChange={(v) => push({ ...b, color: v })} />
        )}
        {b.mode === 'custom' && (
          <input value={b.raw} onChange={(e) => push({ ...b, raw: e.target.value })}
            placeholder="linear-gradient(to top, #000 0%, transparent 100%)"
            className="flex-1 min-w-[160px] bg-surface-container-lowest border border-outline-variant/40 rounded px-sm py-1 text-[11px] font-mono text-on-surface outline-none focus:border-primary" />
        )}
      </div>
    </div>
  );
}

function LowerThirdThemeEditor({ style, onChange, fonts }) {
  const lt = style.lt || {};
  const has = (k) => k in lt;
  const setLt = (fn) => {
    const next = { ...lt };
    fn(next);
    onChange({ ...style, lt: Object.keys(next).length ? next : null });
  };
  return (
    <>
      {/* Live lower-third preview — reflects the overrides + bar + accent below. */}
      <div className="p-md bg-surface-container-lowest">
        <div className="flex items-center justify-between mb-sm">
          <span className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-[0.06em]">Lower Third Preview</span>
        </div>
        <div className="w-full">
          <LowerThirdPreview text={SAMPLE_TEXT} runs={[]} style={style} />
        </div>
      </div>

      <div className="px-lg py-md flex flex-col gap-lg border-t border-outline-variant/20">
        <LtBarEditor value={style.ltBar} onChange={(v) => onChange({ ...style, ltBar: v })} />

        {/* Form — the shape the lower-third bar takes. */}
        <div className="flex items-center justify-between gap-md">
          <div className="min-w-0">
            <div className="text-[12px] text-on-surface">Form</div>
            <div className="text-[10px] text-on-surface-variant/60">Band, a boxed panel, a pill, or text only.</div>
          </div>
          <Segmented
            options={[['band', 'Band'], ['box', 'Box'], ['pill', 'Pill'], ['none', 'None']]}
            value={lt.form || 'band'}
            onChange={(id) => setLt((n) => { if (id === 'band') delete n.form; else n.form = id; })}
          />
        </div>

        {/* Anchor — where the lower third sits vertically. */}
        <div className="flex items-center justify-between gap-md">
          <div className="min-w-0">
            <div className="text-[12px] text-on-surface">Anchor</div>
            <div className="text-[10px] text-on-surface-variant/60">Where it sits on screen.</div>
          </div>
          <Segmented
            options={[['bottom', 'Bottom'], ['center', 'Center'], ['top', 'Top']]}
            value={lt.anchor || 'bottom'}
            onChange={(id) => setLt((n) => { if (id === 'bottom') delete n.anchor; else n.anchor = id; })}
          />
        </div>

        {/* Entrance animation — how the lower third's text appears (output only). */}
        <div className="flex items-center justify-between gap-md">
          <div className="min-w-0">
            <div className="text-[12px] text-on-surface">Entrance</div>
            <div className="text-[10px] text-on-surface-variant/60">How the text animates in on air.</div>
          </div>
          <Segmented
            options={[['none', 'None'], ['fade', 'Fade'], ['slide-up', 'Up'], ['slide-down', 'Down'], ['slide-left', 'Slide']]}
            value={lt.anim || 'none'}
            onChange={(id) => setLt((n) => { if (id === 'none') delete n.anim; else n.anim = id; })}
          />
        </div>

        {/* Max lines — by default the lower third inherits the fullscreen Max Lines/Slide
            cap (Settings → Theme Library) and auto-fits to it. Turn inherit off to set a
            tighter cap just for the lower third. A safety net always keeps it on-screen. */}
        <div className="flex flex-col gap-sm">
          <div className="flex items-center justify-between gap-md">
            <div className="min-w-0">
              <div className="text-[12px] text-on-surface">Max lines</div>
              <div className="text-[10px] text-on-surface-variant/60">Inherit the fullscreen Max&nbsp;Lines/Slide cap, or set a tighter one.</div>
            </div>
            <div className="flex items-center gap-sm shrink-0">
              <span className="text-[11px] text-on-surface-variant">Inherit</span>
              <ThemeToggle on={lt.maxLines == null} onChange={(on) => setLt((n) => { if (on) delete n.maxLines; else n.maxLines = 4; })} />
            </div>
          </div>
          {lt.maxLines != null && (
            <div className="flex items-center gap-sm justify-end">
              <span className="text-[10px] font-mono text-on-surface-variant/70 uppercase">Lower-third max</span>
              <input type="number" min={1} max={12} value={lt.maxLines}
                onChange={(e) => setLt((n) => { n.maxLines = Math.max(1, Math.min(12, Math.round(Number(e.target.value) || 1))); })}
                className="w-16 bg-surface-container border border-outline-variant/30 rounded px-sm py-[3px] text-[13px] tabular-nums text-on-surface text-center outline-none focus:border-primary shrink-0" />
            </div>
          )}
        </div>

        <p className="text-[11px] text-on-surface-variant/70 leading-snug">
          The text below matches the fullscreen slide. Switch any setting to <b className="text-on-surface">Custom</b> to make the lower third look different.
        </p>

        <OverrideRow
          label="Text shadow" sub="Turn off for a clean overlay when the bar already gives contrast"
          overridden={has('textShadow')}
          onInherit={() => setLt((n) => { delete n.textShadow; })}
          onCustom={() => setLt((n) => { n.textShadow = { enabled: false }; })}
        >
          <div className="flex items-center gap-sm">
            <span className="text-[11px] text-on-surface-variant">Shadow</span>
            <ThemeToggle on={!!lt.textShadow?.enabled}
              onChange={(v) => setLt((n) => { n.textShadow = v ? { enabled: true, x: 0, y: 2, blur: 16, color: '#000000' } : { enabled: false }; })} />
            <span className="text-[10px] font-mono text-on-surface-variant/50 uppercase">{lt.textShadow?.enabled ? 'On' : 'Off'}</span>
          </div>
        </OverrideRow>

        <OverrideRow
          label="Font"
          overridden={has('fontFamily')}
          onInherit={() => setLt((n) => { delete n.fontFamily; })}
          onCustom={() => setLt((n) => { n.fontFamily = style.fontFamily || (fonts[0]?.family ?? 'Inter'); })}
        >
          <FontSelect label="Lower-third font" value={lt.fontFamily} onChange={(v) => setLt((n) => { n.fontFamily = v; })} fonts={fonts} />
        </OverrideRow>

        <OverrideRow
          label="Text colour"
          overridden={has('color')}
          onInherit={() => setLt((n) => { delete n.color; })}
          onCustom={() => setLt((n) => { n.color = style.color || '#ffffff'; })}
        >
          <Swatch value={lt.color || '#ffffff'} onChange={(v) => setLt((n) => { n.color = v; })} />
        </OverrideRow>

        <OverrideRow
          label="Uppercase"
          overridden={has('uppercase')}
          onInherit={() => setLt((n) => { delete n.uppercase; })}
          onCustom={() => setLt((n) => { n.uppercase = !!style.uppercase; })}
        >
          <div className="flex items-center gap-sm">
            <ThemeToggle on={!!lt.uppercase} onChange={(v) => setLt((n) => { n.uppercase = v; })} />
            <span className="text-[10px] font-mono text-on-surface-variant/50 uppercase">{lt.uppercase ? 'On' : 'Off'}</span>
          </div>
        </OverrideRow>
      </div>
    </>
  );
}

// ─── Theme Editor Modal ────────────────────────────────────────────────────

function ThemeEditorModal({ theme, initialCategory, onClose, onSaved }) {
  // One unified look — no song/scripture/presentation category. `category` is kept
  // only as a vestigial DB field (defaults 'song'); it no longer gates anything, and
  // a legacy presentation-token theme is normalised into the look shape on open.
  const category = (theme?.category && theme.category !== 'presentation') ? theme.category : 'song';
  const [name, setName] = useState(theme?.name ?? '');
  const [style, setStyle] = useState(() => {
    if (theme?.style_json) {
      try { return { ...DEFAULT_STYLE, ...(normalizeLookStyle(JSON.parse(theme.style_json)) || {}) }; } catch {}
    }
    return { ...DEFAULT_STYLE };
  });
  const [background, setBackground] = useState(
    theme?.background_id ? { id: theme.background_id, path: theme.background_path, filename: theme.background_filename } : null
  );
  const [showBgPicker, setShowBgPicker] = useState(false);
  // Which output surface the look is styling — the fullscreen slide or the lower-third
  // overlay (which can override the fullscreen look).
  const [editSurface, setEditSurface] = useState('fullscreen');
  const [saving, setSaving] = useState(false);
  const fonts = useFonts();
  const isPres = false; // legacy token editor is retired — every theme is one look

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !showBgPicker) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, showBgPicker]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        style_json: JSON.stringify(style),
        background_id: background?.id ?? null,
        category,
      };
      if (theme?.id) {
        await window.cue.themes.update(theme.id, data);
      } else {
        await window.cue.themes.create(data);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  // The live multi-preview (right pane): the SAME theme rendered as a fullscreen song
  // slide, a scripture verse, a section header and a lower third at once, so a change and
  // its (possibly different) lower third are judged together (§4.3 Theme Studio). The
  // fullscreen slide keeps the draggable text box; the rest are read-only.
  const previewPane = (
    <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-lg bg-surface-container-lowest flex flex-col gap-lg">
      <div className="flex items-center gap-sm text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">
        <span className="material-symbols-outlined text-[14px] text-primary/60">preview</span>
        Live preview · assign as a default or to a rundown from the Theme Library
      </div>
      <div>
        <div className="flex items-center justify-between mb-sm gap-sm">
          <div className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-[0.06em]">Fullscreen slide</div>
          {(() => {
            const c = themeContrast(style);
            if (!c) return null;
            const cls = c.aa ? 'text-tertiary border-tertiary/40' : 'text-secondary border-secondary/40';
            return (
              <span className={`text-[9px] font-mono uppercase tracking-[0.04em] border rounded px-xs py-[1px] flex items-center gap-[3px] ${cls}`}
                title={`Text vs background ≈ ${c.ratio.toFixed(1)}:1 (WCAG AA needs 4.5:1${c.approx ? '; estimate for photo/glass backgrounds' : ''})`}>
                <span className="material-symbols-outlined text-[12px]">{c.aa ? 'contrast' : 'warning'}</span>
                {c.ratio.toFixed(1)}:1 {c.aa ? 'AA' : 'low'}{c.approx ? '~' : ''}
              </span>
            );
          })()}
        </div>
        <SlidePreview text={SAMPLE_TEXT} runs={[]} style={style} backgroundPath={background?.path ?? null}
          onTextBoxChange={(box) => setStyle((s) => ({ ...s, textBox: box }))} />
      </div>
      <div className="grid grid-cols-3 gap-md">
        <div>
          <div className="text-[8px] font-mono text-on-surface-variant/40 uppercase tracking-[0.05em] mb-xs">Scripture</div>
          <SlidePreview text={SCRIPTURE_SAMPLE} runs={[]} style={style} backgroundPath={background?.path ?? null} copyright="John 3:16" copyrightAlign="right" />
        </div>
        <div>
          <div className="text-[8px] font-mono text-on-surface-variant/40 uppercase tracking-[0.05em] mb-xs">Section</div>
          <SlidePreview text={'Chorus'} runs={[]} style={style} backgroundPath={background?.path ?? null} />
        </div>
        <div>
          <div className="text-[8px] font-mono text-on-surface-variant/40 uppercase tracking-[0.05em] mb-xs">Lower third</div>
          <LowerThirdPreview text={SAMPLE_TEXT} runs={[]} style={style} />
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 bg-background z-50 flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-md px-lg py-sm border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>style</span>
          <div>
            <h2 className="text-headline-md font-bold text-primary leading-tight">
              {theme?.id ? 'Edit Theme' : 'New Theme'}
            </h2>
            <p className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">Theme Studio</p>
          </div>
          <div className="flex-1" />
          <span className="text-[10px] font-mono text-on-surface-variant/50 uppercase tracking-[0.05em] mr-sm">One theme · any content</span>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer text-sm">
            ✕
          </button>
        </div>

        {/* Two-pane studio: grouped controls (left) · live multi-preview (right) */}
        <div className="flex-1 min-h-0 flex">
        <div className="w-[440px] shrink-0 flex flex-col overflow-y-auto custom-scrollbar border-r border-outline-variant/20">

        {/* Name + background row */}
        <div className="flex items-end gap-md px-lg py-sm border-b border-outline-variant/20 bg-surface-container/40 flex-shrink-0">
          <div className="flex-1">
            <label className={labelCls}>Theme Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sunday Worship"
              className="w-full bg-surface-container-lowest text-on-surface text-body-sm rounded-lg px-md py-1.5 border border-outline-variant/50 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
            />
          </div>
          <div>
            <label className={labelCls}>Background</label>
            <div className="flex items-center gap-sm">
              <div
                className="w-16 aspect-video rounded border border-outline-variant/30 bg-surface-container overflow-hidden cursor-pointer group relative flex-shrink-0"
                onClick={() => setShowBgPicker(true)}
              >
                {background?.path ? (
                  /\.(mp4|webm|mov)$/i.test(background.path)
                    ? <video src={mediaUrl(background.path)} className="w-full h-full object-cover" muted />
                    : <img src={mediaUrl(background.path)} className="w-full h-full object-cover" alt="" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-outline-variant text-base">wallpaper</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="material-symbols-outlined text-white text-xs">edit</span>
                </div>
              </div>
              {background && (
                <button onClick={() => setBackground(null)}
                  className="text-[9px] font-mono text-error/60 hover:text-error cursor-pointer uppercase tracking-[0.05em]">
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {(
          <>
            {/* Surface switch — a theme styles the fullscreen slide AND the lower-third
                overlay. They start the same; the Lower Third tab lets them differ. */}
            <SurfaceSwitch value={editSurface} onChange={setEditSurface} />

            {/* Accent — a theme-wide colour that appears as a rule on the lower third.
                Fully optional: the toggle turns it off. */}
            <AccentControl accent={style.accent} onChange={(a) => setStyle((s) => ({ ...s, accent: a }))} />

            {/* Background motion — slow a distracting video-background loop (default normal). */}
            <BgSpeedControl speed={style.bgSpeed} onChange={(v) => setStyle((s) => ({ ...s, bgSpeed: v }))} />

            {/* Treatment layer (§5) — background-scoped, so only on the fullscreen surface. */}
            {editSurface !== 'lowerthird' && (
              <TreatmentControl treatment={style.treatment} onChange={(v) => setStyle((s) => ({ ...s, treatment: v }))} />
            )}

            {editSurface === 'lowerthird' ? (
              <LowerThirdThemeEditor style={style} onChange={setStyle} fonts={fonts} />
            ) : (
              <>
                {/* Formatting toolbar */}
                <FormattingToolbar
                  style={style}
                  onChange={setStyle}
                  fonts={fonts}
                  hasSelection={() => false}
                  execCmd={() => {}}
                  previewTemplate="fullscreen"
                />

                {/* Max lines per slide — auto-paginates any section longer than this
                    into multiple display slides (0 / blank = unlimited). Stored in
                    style_json and merged into each section on apply. */}
                <div className="px-md py-sm border-b border-outline-variant/20 bg-surface-container-lowest flex items-center gap-md">
                  <div className="min-w-0">
                    <div className="text-[11px] font-mono text-on-surface uppercase tracking-[0.05em]">Max Lines / Slide</div>
                    <div className="text-[10px] text-on-surface-variant/60">Longer sections split across slides. 0 = unlimited.</div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    step={1}
                    value={style.maxLines ?? ''}
                    placeholder="0"
                    onChange={(e) => {
                      const n = Math.max(0, Math.min(20, Math.round(Number(e.target.value) || 0)));
                      setStyle((s) => ({ ...s, maxLines: n || undefined }));
                    }}
                    className="ml-auto w-16 bg-surface-container border border-outline-variant/30 rounded px-sm py-[3px] text-[13px] tabular-nums text-on-surface text-center outline-none focus:border-primary"
                  />
                </div>

              </>
            )}
          </>
        )}
        </div>{/* /left controls pane */}
        {previewPane}
        </div>{/* /two-pane */}

        {/* Footer */}
        <div className="flex items-center justify-end gap-sm px-lg py-sm border-t border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <button onClick={onClose}
            className="px-lg h-8 text-label-sm font-mono text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-variant transition-colors cursor-pointer uppercase tracking-[0.05em]">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!name.trim() || saving}
            className="px-lg h-8 text-label-sm font-mono bg-tertiary-container text-on-tertiary-container disabled:opacity-40 rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em] hover:opacity-90">
            {saving ? 'Saving…' : theme?.id ? 'Update Theme' : 'Save Theme'}
          </button>
        </div>

      {showBgPicker && (
        <MediaPickerModal
          initialId={background?.id ?? null}
          onSelect={(asset) => { setBackground(asset); setShowBgPicker(false); }}
          onClose={() => setShowBgPicker(false)}
        />
      )}
    </div>,
    document.body
  );
}

// ─── Theme Card ────────────────────────────────────────────────────────────

function MenuAction({ icon, label, onClick, danger }) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-sm px-md py-[6px] text-[11px] font-mono uppercase tracking-[0.04em] cursor-pointer transition-colors ${danger ? 'text-secondary hover:bg-secondary/10' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/40'}`}>
      <span className="material-symbols-outlined text-[14px]">{icon}</span>{label}
    </button>
  );
}

function ThemeCard({ theme, services, activeServiceId, onEdit, onCustomize, onDuplicate, onDelete, onApplied, onUsedForService, bgThumb, songApply = true, isDefault = false, isSongDefault = false, isScriptureDefault = false, isSlideDefault = false, isServiceLook = false, isFav = false, onToggleFav, onSetDefault }) {
  const toast = useToast();
  const [selectedServiceId, setSelectedServiceId] = useState(activeServiceId ?? services[0]?.id ?? null);
  const [applyBg, setApplyBg] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmApplyAll, setConfirmApplyAll] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);

  // Assign this theme to the active service (the intuitive, non-destructive verb —
  // it's resolved live through the App→Service→Item cascade, nothing is baked).
  async function handleUseForService() {
    if (!activeServiceId) { toast.error('Open a rundown first.'); return; }
    await ensureThemeBg(theme, toast); // download the photo/video bg first (spinner if needed)
    const prev = (await window.cue.services.get(activeServiceId).catch(() => null))?.theme_id ?? null;
    await window.cue.services.setServiceTheme(activeServiceId, theme.id);
    onUsedForService?.();
    toast.show({
      message: `“${theme.name}” is now this rundown’s theme`,
      kind: 'success', duration: 6000,
      action: { label: 'Undo', onClick: async () => { await window.cue.services.setServiceTheme(activeServiceId, prev); onUsedForService?.(); } },
    });
  }

  const isBuiltin = !!theme.builtin;
  // Every theme is one "look" — normalise any stored shape (incl. a legacy
  // presentation token theme) into the text-style shape so the card previews it
  // uniformly as a lyric slide, exactly how a song/scripture would render it.
  const raw = theme.style_json ? JSON.parse(theme.style_json) : null;
  const style = { ...DEFAULT_STYLE, ...(normalizeLookStyle(raw) || {}) };
  // A theme carries a background if it has a media asset, an authored CSS gradient,
  // or a media-library reference (bgRef) resolved on apply.
  const hasBackground = !!theme.background_id || !!style.bgCss || !!(raw && raw.bgRef);

  function showFeedback(msg) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  }

  // Built-ins are read-only. "Edit a copy" duplicates into an editable user theme AND
  // opens the editor on it in one click — so tweaking a Collection (e.g. adding a tint)
  // is a single step, not Duplicate-then-hunt-for-the-copy. The curated pack stays intact.
  async function handleExport() {
    try {
      const r = await window.cue.themes.export(theme.id);
      if (r?.ok) showFeedback('Exported');
      else if (!r?.canceled) toast.error(r?.error || 'Export failed');
    } catch { toast.error('Export failed'); }
  }

  // A media theme downloads its background on first apply, so wrap the apply in a
  // spinner toast (debounced — gradient/local-media/text themes finish instantly
  // and never flash one). The success count comes from the resolved value.
  async function handleApplyToRundown() {
    if (!selectedServiceId) return;
    try {
      await toast.promise(
        window.cue.themes.applyToRundown(theme.id, selectedServiceId, applyBg),
        {
          pending: `Applying “${theme.name}” to rundown…`,
          success: (count) => `Applied to ${count} song${count !== 1 ? 's' : ''} in rundown`,
          error: `Couldn't apply “${theme.name}”`,
        },
      );
      onApplied?.();
    } catch { /* error toast already shown */ }
  }

  async function handleApplyToAllSongs() {
    try {
      await toast.promise(
        window.cue.themes.applyToAllSongs(theme.id, applyBg),
        {
          pending: `Applying “${theme.name}” to all songs…`,
          success: (count) => `Applied to ${count} song${count !== 1 ? 's' : ''}`,
          error: `Couldn't apply “${theme.name}”`,
        },
      );
      onApplied?.();
    } catch { /* error toast already shown */ }
  }

  return (
    <div className="bg-surface-container border border-outline-variant/30 rounded-xl overflow-hidden flex flex-col">
      {/* Slide preview — every look previews as a lyric slide (one look, any surface).
          Lazy-mounted so a 50-card gallery doesn't render every treated preview at once. */}
      <div className="p-sm pb-0">
        <LazyVisible placeholder={<div className="w-full aspect-video rounded-lg bg-surface-container-high animate-pulse" />}>
          <SlidePreview
            text={SAMPLE_TEXT}
            runs={[]}
            style={bgThumb ? { ...style, bgThumb } : style}
            backgroundPath={theme.background_path ?? null}
          />
        </LazyVisible>
      </div>

      {/* Name + edit/delete */}
      <div className="px-md pt-sm pb-xs flex items-center justify-between">
        <span className="text-label-sm font-mono font-bold text-on-surface truncate min-w-0 mr-sm flex items-center gap-xs">
          {theme.name}
          {isBuiltin && (
            <span className="text-[8px] font-mono text-primary/70 border border-primary/30 rounded px-[3px] py-[1px] uppercase tracking-[0.05em] shrink-0">Built-in</span>
          )}
          {isDefault && (
            <span className="text-[8px] font-mono text-tertiary border border-tertiary/40 rounded px-[3px] py-[1px] uppercase tracking-[0.05em] shrink-0 flex items-center gap-[2px]">
              <span className="material-symbols-outlined text-[10px]">check_circle</span>Default
            </span>
          )}
        </span>
        <div className="flex items-center gap-xs flex-shrink-0">
          <button onClick={() => onToggleFav?.(theme)} title={isFav ? 'Unpin' : 'Pin to Favorites'}
            className={`cursor-pointer transition-colors flex items-center ${isFav ? 'text-primary' : 'text-on-surface-variant/40 hover:text-on-surface-variant'}`}>
            <span className="material-symbols-outlined text-[14px]" style={isFav ? { fontVariationSettings: "'FILL' 1" } : undefined}>star</span>
          </button>
          <button ref={menuBtnRef} onClick={() => setMenuOpen((o) => !o)} title="More actions"
            className="text-on-surface-variant/50 hover:text-on-surface cursor-pointer transition-colors flex items-center">
            <span className="material-symbols-outlined text-[16px]">more_vert</span>
          </button>
          <AnchoredMenu open={menuOpen} anchorRef={menuBtnRef} onClose={() => { setMenuOpen(false); setConfirmDelete(false); }}
            align="right" className="w-44 py-xs bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl ring-1 ring-white/5">
            {isBuiltin
              ? <MenuAction icon="edit" label="Customize" onClick={() => { setMenuOpen(false); onCustomize?.(theme); }} />
              : <MenuAction icon="edit" label="Edit" onClick={() => { setMenuOpen(false); onEdit(); }} />}
            <MenuAction icon="content_copy" label="Duplicate" onClick={() => { setMenuOpen(false); onDuplicate?.(theme); }} />
            <MenuAction icon="ios_share" label="Export…" onClick={() => { setMenuOpen(false); handleExport(); }} />
            {!isBuiltin && (confirmDelete
              ? <MenuAction icon="delete" label="Confirm delete" danger onClick={() => { setMenuOpen(false); setConfirmDelete(false); onDelete(); }} />
              : <MenuAction icon="delete" label="Delete" danger onClick={() => setConfirmDelete(true)} />)}
          </AnchoredMenu>
        </div>
      </div>

      {/* Assign controls — one non-destructive verb ("use here"), resolved live
          through the App→Service→Item cascade. Nothing is baked. */}
      <div className="px-md pb-md space-y-xs">
        <>
          {/* Default — a labelled row of 4 equal chips. "All" is the app-wide default;
              Songs/Scripture/Slides set a per-kind default that overrides "All" for that
              content type. Every song/verse without its own theme inherits this LIVE. */}
          <div>
            <div className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-[0.06em] mb-[3px]">Set as default for</div>
            <div className="flex items-stretch gap-[3px]">
              {[['all', 'All', isDefault, 'stars'], ['song', 'Songs', isSongDefault], ['scripture', 'Scripture', isScriptureDefault], ['slide', 'Slides', isSlideDefault]].map(([scope, label, active, icon]) => (
                <button key={scope} onClick={() => onSetDefault(scope)} title={`Default for ${label.toLowerCase() === 'all' ? 'all content' : label.toLowerCase()}`}
                  className={`flex-1 min-w-0 flex items-center justify-center gap-[2px] px-[4px] py-[5px] text-[10px] font-mono uppercase tracking-[0.03em] rounded border transition-colors cursor-pointer ${
                    active ? 'bg-tertiary/15 border-tertiary/40 text-tertiary' : 'border-outline-variant/25 text-on-surface-variant/70 hover:text-tertiary hover:border-tertiary/40'}`}>
                  {icon && <span className="material-symbols-outlined text-[12px] shrink-0">{icon}</span>}
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Rundown — assign to the active rundown (overrides the app default there). */}
          <button onClick={handleUseForService} disabled={!activeServiceId}
            className={`w-full text-[10px] font-mono uppercase tracking-[0.05em] rounded px-sm py-[5px] transition-colors cursor-pointer flex items-center justify-center gap-xs border disabled:opacity-40 ${
              isServiceLook ? 'bg-primary/15 border-primary/40 text-primary'
                : 'bg-primary/5 border-primary/20 text-on-surface-variant hover:text-primary hover:border-primary/40'}`}>
            <span className="material-symbols-outlined text-[13px]">{isServiceLook ? 'check_circle' : 'playlist_add_check'}</span>
            {isServiceLook ? 'This rundown’s theme' : 'Use for this rundown'}
          </button>

          {/* Advanced — the older "bake into every song" path, kept for one-off
              hard-coding but tucked away so the live cascade is the obvious choice. */}
          <button onClick={() => setAdvanced((v) => !v)}
            className="w-full text-[9px] font-mono uppercase tracking-[0.05em] text-on-surface-variant/50 hover:text-on-surface-variant flex items-center justify-center gap-[2px] pt-[2px] cursor-pointer">
            <span className="material-symbols-outlined text-[12px]">{advanced ? 'expand_less' : 'expand_more'}</span>
            Advanced — bake into songs
          </button>
          {advanced && (
            <div className="space-y-xs pt-xs border-t border-outline-variant/20">
              {hasBackground && (
                <label className="flex items-center gap-xs cursor-pointer">
                  <input type="checkbox" checked={applyBg} onChange={(e) => setApplyBg(e.target.checked)} className="accent-primary w-3 h-3" />
                  <span className="text-[10px] font-mono text-on-surface-variant/70">Include background</span>
                </label>
              )}
              <div className="flex items-center gap-xs">
                <select value={selectedServiceId ?? ''} onChange={(e) => setSelectedServiceId(Number(e.target.value))}
                  className="flex-1 min-w-0 bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[3px] text-[10px] font-mono text-on-surface outline-none focus:border-primary cursor-pointer">
                  {services.length === 0 ? <option value="">No rundowns</option>
                    : services.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
                <button onClick={handleApplyToRundown} disabled={!selectedServiceId || services.length === 0}
                  className="shrink-0 px-sm py-[3px] text-[9px] font-mono bg-surface-container border border-outline-variant/40 text-on-surface-variant rounded hover:text-on-surface active:scale-95 transition-all cursor-pointer disabled:opacity-40 uppercase tracking-[0.05em]">
                  Bake
                </button>
              </div>
              {confirmApplyAll ? (
                <div className="flex items-center gap-sm">
                  <span className="text-[9px] font-mono text-error uppercase tracking-[0.04em] flex-1 truncate">Bake into all songs?</span>
                  <button onClick={() => { setConfirmApplyAll(false); handleApplyToAllSongs(); }} className="text-[9px] font-mono text-error hover:text-error/70 cursor-pointer uppercase tracking-[0.04em] border border-error/40 px-sm py-[2px] rounded transition-colors shrink-0">Yes</button>
                  <button onClick={() => setConfirmApplyAll(false)} className="text-[9px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.04em] transition-colors shrink-0">No</button>
                </div>
              ) : (
                <button onClick={() => setConfirmApplyAll(true)}
                  className="w-full text-[9px] font-mono text-on-surface-variant/60 hover:text-on-surface border border-outline-variant/20 hover:border-outline-variant rounded px-sm py-[3px] transition-colors cursor-pointer uppercase tracking-[0.05em]">
                  Bake into all songs
                </button>
              )}
            </div>
          )}
        </>

        {feedback && <p className="text-[9px] font-mono text-tertiary pt-[2px]">{feedback}</p>}
      </div>
    </div>
  );
}

// ─── Main section component ────────────────────────────────────────────────

export default function ThemeSettings({ activeServiceId, onBackgroundDefaultChanged }) {
  const toast = useToast();
  const [themes, setThemes] = useState([]);
  const [services, setServices] = useState([]);
  const [editingTheme, setEditingTheme] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false); // reveal hidden legacy (pre-Collections) built-ins
  const [allFilter, setAllFilter] = useState('all');   // "All Themes" modal: all | collections | mine | favorites | selected
  const [favs, setFavs] = useState(() => getThemeFavs());
  const [bgThumbs, setBgThumbs] = useState({}); // media-library item id -> thumb url (for media-theme previews)
  const [globalMaxLines, setGlobalMaxLines] = useState(0); // global song max lines/slide (0 = unlimited)
  const [defaultThemeId, setDefaultThemeId] = useState(null); // app-wide default theme (settings default_theme_id)
  const [songDefaultId, setSongDefaultId] = useState(null);       // per-kind: songs
  const [scriptureDefaultId, setScriptureDefaultId] = useState(null); // per-kind: scripture
  const [slideDefaultId, setSlideDefaultId] = useState(null);        // per-kind: slides/presentations
  const [serviceThemeId, setServiceThemeId] = useState(null); // active service's assigned look
  const [browsingBg, setBrowsingBg] = useState(false);        // "New from a background" browser open
  const [derivingId, setDerivingId] = useState(null);         // bg item currently being turned into a theme
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);

  useEffect(() => {
    reload();
    window.cue.services.list().then(setServices);
    window.cue.settings.get('song_max_lines').then((v) => {
      const n = Number(v);
      setGlobalMaxLines(isFinite(n) && n > 0 ? n : 0);
    });
    window.cue.settings.get('default_theme_id').then((v) => setDefaultThemeId(Number(v) || null));
    window.cue.settings.get('default_theme_id_song').then((v) => setSongDefaultId(Number(v) || null));
    window.cue.settings.get('default_theme_id_scripture').then((v) => setScriptureDefaultId(Number(v) || null));
    window.cue.settings.get('default_theme_id_slide').then((v) => setSlideDefaultId(Number(v) || null));
    window.cue.backgrounds?.list?.().then((items) => {
      const map = {};
      for (const it of items) if (it.thumb) map[it.id] = it.thumb;
      setBgThumbs(map);
    }).catch(() => {});
  }, []);

  // Track the active service's assigned look so the gallery can mark it "in use".
  useEffect(() => {
    if (!activeServiceId) { setServiceThemeId(null); return; }
    window.cue.services.get(activeServiceId).then((s) => setServiceThemeId(s?.theme_id || null)).catch(() => {});
  }, [activeServiceId]);

  const refreshServiceLook = () => {
    if (!activeServiceId) return;
    window.cue.services.get(activeServiceId).then((s) => setServiceThemeId(s?.theme_id || null)).catch(() => {});
    onBackgroundDefaultChanged?.();
  };

  // Make a theme an app-wide default. `scope` targets the whole app ('all') or a single
  // content kind ('song' / 'scripture') — the per-kind default overrides 'all' for that
  // kind, so you can give songs a photo look and scripture a clean one. Toggling the
  // current default clears it. Everything resolves live (nothing baked).
  async function handleSetDefault(theme, scope = 'all') {
    const key = scope === 'song' ? 'default_theme_id_song'
      : scope === 'scripture' ? 'default_theme_id_scripture'
      : scope === 'slide' ? 'default_theme_id_slide' : 'default_theme_id';
    const cur = scope === 'song' ? songDefaultId : scope === 'scripture' ? scriptureDefaultId
      : scope === 'slide' ? slideDefaultId : defaultThemeId;
    const next = theme.id === cur ? null : theme.id;
    if (next) await ensureThemeBg(theme, toast); // download the photo/video bg first (spinner if needed)
    const setter = scope === 'song' ? setSongDefaultId : scope === 'scripture' ? setScriptureDefaultId
      : scope === 'slide' ? setSlideDefaultId : setDefaultThemeId;
    const commit = async (id) => { await window.cue.settings.set(key, id ? String(id) : ''); setter(id); onBackgroundDefaultChanged?.(); };
    await commit(next);
    const scopeLabel = scope === 'all' ? 'default' : `${scope} default`;
    toast.show({
      message: next ? `${scopeLabel[0].toUpperCase() + scopeLabel.slice(1)} → “${theme.name}”` : `${scopeLabel} cleared`,
      kind: 'success', duration: 6000,
      action: { label: 'Undo', onClick: () => commit(cur) },
    });
  }

  // "New from a background": download the picked background, auto-derive a theme, then
  // open the editor on it so the look can be tweaked before it's used.
  async function handlePickBackground(item) {
    setDerivingId(item.id);
    try {
      const newId = await deriveThemeFromBackground(item);
      const list = await window.cue.themes.list();
      setThemes(list);
      setBrowsingBg(false);
      const created = list.find((t) => t.id === newId);
      if (created) setEditingTheme(created);
      toast.success('Theme created — tweak and save');
    } catch (e) {
      toast.error('Couldn’t create theme: ' + (e?.message || e));
    } finally {
      setDerivingId(null);
    }
  }

  // Strip every song's baked style/background library-wide so the live theme cascade
  // fully takes over — the fix for "songs still store a theme so I can't override them".
  // Import one or more .cuetheme files as editable user themes.
  async function handleImportTheme() {
    try {
      const r = await window.cue.themes.import();
      if (r?.canceled) return;
      if (r?.ok) { reload(); toast.success(`Imported ${r.added.length} theme${r.added.length === 1 ? '' : 's'}`); }
      else toast.error(r?.error || 'Couldn’t import theme');
    } catch { toast.error('Couldn’t import theme'); }
  }

  async function handleResetAllSongs() {
    setResettingAll(true);
    try {
      // Songs will fall back to the app-default theme's background. If that default is a
      // photo/video theme whose media was never downloaded (e.g. set on an older build),
      // resolve it now so the inherited background isn't black.
      const defIds = [...new Set([defaultThemeId, songDefaultId, scriptureDefaultId].filter(Boolean))];
      for (const id of defIds) {
        const t = themes.find((x) => x.id === id);
        if (t) await ensureThemeBg(t, toast);
      }
      const count = await window.cue.themes.resetAllSongsToTheme();
      toast.success(`${count} song${count !== 1 ? 's' : ''} now follow the live theme`);
      onBackgroundDefaultChanged?.();
    } catch (e) {
      toast.error('Reset failed: ' + (e?.message || e));
    } finally {
      setResettingAll(false);
      setConfirmResetAll(false);
    }
  }

  function saveGlobalMaxLines(n) {
    const v = Math.max(0, Math.min(20, Math.round(Number(n) || 0)));
    setGlobalMaxLines(v);
    window.cue.settings.set('song_max_lines', String(v));
  }

  async function reload() {
    const list = await window.cue.themes.list();
    setThemes(list);
  }

  async function handleDelete(id) {
    await window.cue.themes.delete(id);
    reload();
  }

  // ── Customize / duplicate (copy-on-write, no pile-up) ─────────────────────────
  const copiedFromOf = (t) => { try { return t?.style_json ? Number(JSON.parse(t.style_json).copiedFrom) || null : null; } catch { return null; } };

  // "Customize" a built-in: open THIS built-in's editable copy (reused — at most one per
  // built-in, tagged copiedFrom), creating it the first time. On save it follows the
  // assignment (handleThemeSaved), so you're editing "your theme" seamlessly.
  async function handleCustomize(theme) {
    const existing = themes.find((t) => !t.builtin && copiedFromOf(t) === Number(theme.id));
    if (existing) { setEditingTheme(existing); return; }
    let style = {}; try { style = theme.style_json ? JSON.parse(theme.style_json) : {}; } catch {}
    style.copiedFrom = Number(theme.id);
    const name = `${theme.name} (custom)`;
    const id = await window.cue.themes.create({ name, style_json: JSON.stringify(style), background_id: theme.background_id ?? null, category: theme.category || 'song' });
    await reload();
    setEditingTheme({ id: Number(id), name, style_json: JSON.stringify(style), background_id: theme.background_id ?? null, background_path: theme.background_path ?? null, category: theme.category || 'song', builtin: 0 });
  }

  // "Duplicate": ALWAYS a fresh standalone variant (no copiedFrom link, no reuse) — for
  // when you genuinely want two versions of a look. Opens the editor on the new variant.
  async function handleDuplicateTheme(theme) {
    let style = {}; try { style = theme.style_json ? JSON.parse(theme.style_json) : {}; } catch {}
    delete style.copiedFrom; // a variant is standalone
    const name = `${theme.name} copy`;
    const id = await window.cue.themes.create({ name, style_json: JSON.stringify(style), background_id: theme.background_id ?? null, category: theme.category || 'song' });
    await reload();
    setEditingTheme({ id: Number(id), name, style_json: JSON.stringify(style), background_id: theme.background_id ?? null, background_path: theme.background_path ?? null, category: theme.category || 'song', builtin: 0 });
  }

  // After saving a customised copy, FOLLOW the assignment: any app default / rundown theme
  // that pointed at the origin built-in switches to the copy, so the edits actually show.
  async function handleThemeSaved(edited) {
    setEditingTheme(null);
    await reload();
    const origin = copiedFromOf(edited);
    if (!origin) return;
    const copyId = Number(edited.id);
    let switched = false;
    for (const [key, cur, setter] of [
      ['default_theme_id', defaultThemeId, setDefaultThemeId],
      ['default_theme_id_song', songDefaultId, setSongDefaultId],
      ['default_theme_id_scripture', scriptureDefaultId, setScriptureDefaultId],
      ['default_theme_id_slide', slideDefaultId, setSlideDefaultId],
    ]) {
      if (Number(cur) === origin) { await window.cue.settings.set(key, String(copyId)); setter(copyId); switched = true; }
    }
    if (Number(serviceThemeId) === origin && activeServiceId) { await window.cue.services.setServiceTheme(activeServiceId, copyId); setServiceThemeId(copyId); switched = true; }
    if (switched) { onBackgroundDefaultChanged?.(); toast.show({ message: `Now using your version of “${edited.name.replace(/ \(custom\)$/, '')}”`, kind: 'success', duration: 4000 }); }
  }

  // One-time cleanup: remove duplicate custom copies (same name), keeping the newest.
  const [confirmDedupe, setConfirmDedupe] = useState(false);
  const dupeCount = useMemo(() => {
    const byName = new Map();
    for (const t of themes) if (!t.builtin) byName.set(t.name.toLowerCase(), (byName.get(t.name.toLowerCase()) || 0) + 1);
    return [...byName.values()].reduce((n, c) => n + (c > 1 ? c - 1 : 0), 0);
  }, [themes]);
  async function handleDedupe() {
    const byName = new Map();
    for (const t of themes) if (!t.builtin) { const k = t.name.toLowerCase(); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(t); }
    const toDelete = [];
    for (const group of byName.values()) {
      if (group.length > 1) { group.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))); toDelete.push(...group.slice(1)); }
    }
    for (const t of toDelete) await window.cue.themes.delete(t.id);
    setConfirmDedupe(false);
    await reload();
    toast.show({ message: `Removed ${toDelete.length} duplicate cop${toDelete.length === 1 ? 'y' : 'ies'}`, kind: 'success' });
  }

  const renderCard = (theme) => {
    let bgRef = null;
    try { bgRef = theme.style_json ? JSON.parse(theme.style_json).bgRef : null; } catch {}
    return (
      <ThemeCard
        key={theme.id}
        theme={theme}
        services={services}
        activeServiceId={activeServiceId}
        bgThumb={bgRef ? bgThumbs[bgRef] : null}
        onEdit={(t) => setEditingTheme(t || theme)}
        onCustomize={handleCustomize}
        onDuplicate={handleDuplicateTheme}
        onDelete={() => handleDelete(theme.id)}
        onApplied={reload}
        onUsedForService={refreshServiceLook}
        isDefault={theme.id === defaultThemeId}
        isSongDefault={theme.id === songDefaultId}
        isScriptureDefault={theme.id === scriptureDefaultId}
        isSlideDefault={theme.id === slideDefaultId}
        isServiceLook={theme.id === serviceThemeId}
        isFav={favs.has(Number(theme.id))}
        onToggleFav={() => setFavs(new Set(toggleThemeFav(theme.id)))}
        onSetDefault={(scope) => handleSetDefault(theme, scope)}
        songApply={(theme.category || 'song') === 'song'}
      />
    );
  };

  // ONE library — no song/scripture/presentation split. Every theme is a portable
  // look; sort media → gradient → custom. (Graphics presets are a separate system.)
  // Legacy built-ins are hidden by default (Collections + the user's own themes lead);
  // the active default/service themes are always kept so a selection still shows.
  const hasLegacy = useMemo(() => themes.some((t) => t.builtin && !isCuratedTheme(t)), [themes]);
  const sortedThemes = useMemo(() => {
    return filterBrowseThemes(themes, { showLegacy, keepIds: [defaultThemeId, songDefaultId, scriptureDefaultId, slideDefaultId, serviceThemeId] })
      .filter((t) => (t.category || 'song') !== 'graphic')
      .map((t) => ({ t, kind: themeKind(t) }))
      .sort((a, b) => a.kind - b.kind || (a.t.sort_order ?? 0) - (b.t.sort_order ?? 0)
        || a.t.name.localeCompare(b.t.name));
  }, [themes, showLegacy, defaultThemeId, serviceThemeId]);

  // Themes currently ENABLED somewhere in the cascade (a default of any kind, or the
  // active rundown's theme) — surfaced to the top so the operator sees what's in use.
  const activeIds = useMemo(
    () => new Set([defaultThemeId, songDefaultId, scriptureDefaultId, slideDefaultId, serviceThemeId].filter(Boolean).map(Number)),
    [defaultThemeId, songDefaultId, scriptureDefaultId, slideDefaultId, serviceThemeId],
  );

  // Render the grid, dropping a full-width "Your Themes" separator before the first
  // custom theme. In-use themes are surfaced via the "Selected" filter, not extra dividers.
  const renderThemeGrid = (list) => {
    const nodes = [];
    let customStarted = false;
    for (const { t, kind } of list) {
      if (kind === 2 && !customStarted) {
        customStarted = true;
        nodes.push(
          <div key="sep-custom" style={{ gridColumn: '1 / -1' }} className="flex items-center gap-sm mt-sm">
            <span className="text-label-sm font-label-sm uppercase tracking-[0.08em] text-on-surface-variant whitespace-nowrap">Your Themes</span>
            <span className="flex-1 h-px bg-outline-variant/30" />
          </div>
        );
      }
      nodes.push(renderCard(t));
    }
    return nodes;
  };

  return (
    <section className="space-y-md">
      <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary">style</span>
        Theme Library
      </h2>
      <p className="text-body-md text-on-surface-variant -mt-xs">
        A theme is the complete look — background, fonts, colour, and lower-third styling — in one place.
        There’s no separate “background”: a theme carries its own. Set one as your <b className="text-on-surface">Default theme</b> and
        every song, verse and slide uses it automatically, live.
      </p>


      {/* Global song legibility — max lines per slide across every song in the
          rundown. A per-song value (Song Editor) or a theme's own Max Lines
          overrides this; 0 = unlimited (no auto-pagination). */}
      <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30">
        <div className="flex items-center justify-between gap-md">
          <div className="min-w-0">
            <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Max Lines / Slide</h3>
            <p className="text-body-sm text-on-surface-variant/70 mt-xs">
              Auto-split every song so no slide shows more than this many lines. Applies to the whole
              rundown; a song can override it in the Song Editor. 0 = unlimited.
            </p>
          </div>
          <div className="flex items-center gap-xs shrink-0">
            <button
              onClick={() => saveGlobalMaxLines(globalMaxLines - 1)}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant cursor-pointer"
            >−</button>
            <input
              type="number"
              min={0}
              max={20}
              step={1}
              value={globalMaxLines || ''}
              placeholder="0"
              onChange={(e) => saveGlobalMaxLines(e.target.value)}
              className="w-14 bg-surface-container border border-outline-variant/30 rounded-lg px-sm py-[4px] text-[14px] tabular-nums text-on-surface text-center outline-none focus:border-primary"
            />
            <button
              onClick={() => saveGlobalMaxLines(globalMaxLines + 1)}
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant cursor-pointer"
            >+</button>
          </div>
        </div>
      </div>

      <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30">
        <div className="flex items-start justify-between mb-md gap-md">
          <div>
            <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Collections</h3>
            <p className="text-body-sm text-on-surface-variant/70 mt-xs">
              Cue’s curated themes plus your own. Song &amp; scripture themes are interchangeable — use any theme on either.
              Start from a curated background, or design one from scratch.
            </p>
          </div>
          <div className="flex items-center gap-md shrink-0">
            {(serviceThemeId || defaultThemeId || songDefaultId || scriptureDefaultId || slideDefaultId) && (
              <ThemeCascadeBar
                themes={themes}
                rundownThemeId={serviceThemeId}
                rundownTitle={services.find((s) => s.id === activeServiceId)?.title || null}
                defaultThemeId={defaultThemeId}
                songDefaultId={songDefaultId}
                scriptureDefaultId={scriptureDefaultId}
                slideDefaultId={slideDefaultId}
                onClearRundown={activeServiceId ? async () => {
                  await window.cue.services.setServiceTheme(activeServiceId, null);
                  refreshServiceLook();
                  toast.success('Rundown theme cleared — defaults now apply');
                } : null}
              />
            )}
            <button
              onClick={handleImportTheme}
              title="Import a .cuetheme file"
              className="px-md py-xs text-label-sm font-label-sm font-bold bg-surface-container border border-outline-variant/40 text-on-surface rounded-lg hover:border-primary/50 hover:text-primary active:scale-95 transition-all cursor-pointer flex items-center gap-xs"
            >
              <span className="material-symbols-outlined text-[18px]">file_open</span>
              Import
            </button>
            <button
              onClick={() => setBrowsingBg(true)}
              className="px-md py-xs text-label-sm font-label-sm font-bold bg-surface-container border border-outline-variant/40 text-on-surface rounded-lg hover:border-primary/50 hover:text-primary active:scale-95 transition-all cursor-pointer flex items-center gap-xs"
            >
              <span className="material-symbols-outlined text-[18px]">wallpaper</span>
              New from a background
            </button>
            <button
              onClick={() => setEditingTheme({})}
              className="px-md py-xs text-label-sm font-label-sm font-bold bg-primary/10 border border-primary/30 text-primary rounded-lg hover:bg-primary/20 active:scale-95 transition-all cursor-pointer"
            >
              + New Theme
            </button>
          </div>
        </div>

        {sortedThemes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-xl gap-sm text-outline-variant">
            <span className="material-symbols-outlined text-5xl">palette</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">No themes yet</span>
            <p className="text-body-sm text-on-surface-variant/50 text-center max-w-xs mt-xs">
              Start from a curated background above, or design one from scratch.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {sortedThemes.slice(0, 4).map(({ t }) => renderCard(t))}
            </div>
            {sortedThemes.length > 4 && (
              <button
                onClick={() => setShowAll(true)}
                className="mt-md w-full text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant hover:text-on-surface border border-outline-variant/30 hover:border-outline-variant rounded-lg py-sm transition-colors cursor-pointer flex items-center justify-center gap-xs"
              >
                <span className="material-symbols-outlined text-[18px]">grid_view</span>
                View all {sortedThemes.length} themes
              </button>
            )}
            {hasLegacy && (
              <button
                onClick={() => setShowLegacy((v) => !v)}
                className="mt-xs w-full text-[10px] font-label-sm uppercase tracking-[0.05em] text-on-surface-variant/50 hover:text-on-surface-variant flex items-center justify-center gap-[3px] cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">{showLegacy ? 'visibility_off' : 'history'}</span>
                {showLegacy ? 'Hide legacy themes' : 'Show legacy themes'}
              </button>
            )}
            {dupeCount > 0 && (
              confirmDedupe ? (
                <div className="mt-xs flex items-center justify-center gap-sm text-[10px] font-mono uppercase tracking-[0.04em]">
                  <span className="text-secondary">Remove {dupeCount} duplicate cop{dupeCount === 1 ? 'y' : 'ies'}?</span>
                  <button onClick={handleDedupe} className="text-secondary hover:text-secondary/70 border border-secondary/40 rounded px-sm py-[2px] cursor-pointer">Yes, remove</button>
                  <button onClick={() => setConfirmDedupe(false)} className="text-on-surface-variant hover:text-on-surface cursor-pointer">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDedupe(true)}
                  className="mt-xs w-full text-[10px] font-label-sm uppercase tracking-[0.05em] text-on-surface-variant/50 hover:text-secondary flex items-center justify-center gap-[3px] cursor-pointer">
                  <span className="material-symbols-outlined text-[14px]">cleaning_services</span>
                  Remove {dupeCount} duplicate cop{dupeCount === 1 ? 'y' : 'ies'}
                </button>
              )
            )}
          </>
        )}

        {/* Escape hatch out of the old baked-theme model — a song that was ever
            "applied" a theme stores that style and ignores the live theme. This
            clears every song's stored style + background so the theme takes over. */}
        <div className="mt-md pt-md border-t border-outline-variant/20 flex items-center justify-between gap-md">
          <p className="text-body-sm text-on-surface-variant/70 min-w-0">
            Songs still showing an old saved style? Clear every song’s baked style &amp; background so they follow the live theme cascade (rundown → default theme). Set a default theme first, or reset songs will have no background (black).
          </p>
          {confirmResetAll ? (
            <div className="flex items-center gap-sm shrink-0">
              <span className="text-[10px] font-mono text-error uppercase tracking-[0.04em]">Reset every song?</span>
              <button onClick={handleResetAllSongs} disabled={resettingAll}
                className="text-[10px] font-mono text-error hover:text-error/70 cursor-pointer uppercase tracking-[0.04em] border border-error/40 px-sm py-[3px] rounded transition-colors disabled:opacity-40">
                {resettingAll ? 'Resetting…' : 'Yes, reset all'}
              </button>
              <button onClick={() => setConfirmResetAll(false)} disabled={resettingAll}
                className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.04em] transition-colors">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmResetAll(true)}
              className="shrink-0 px-md py-xs text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface border border-outline-variant/30 hover:border-outline-variant rounded-lg transition-colors cursor-pointer flex items-center gap-xs">
              <span className="material-symbols-outlined text-[16px]">restart_alt</span>
              Reset all songs to theme
            </button>
          )}
        </div>
      </div>

      {browsingBg && (
        <BackgroundBrowseModal
          onPick={handlePickBackground}
          onClose={() => setBrowsingBg(false)}
          busyId={derivingId}
        />
      )}

      {showAll && createPortal(
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex flex-col" onMouseDown={() => setShowAll(false)}>
          <div
            className="flex-1 min-h-0 flex flex-col m-lg bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0 gap-md flex-wrap">
              <h3 className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em] flex items-center gap-sm shrink-0">
                <span className="material-symbols-outlined text-primary text-[20px]">style</span>
                All Themes · {sortedThemes.length}
              </h3>
              {/* Filter — Collections vs the user's own themes, so "Your Themes" is
                  discoverable instead of buried below 50 built-ins. */}
              {(() => {
                const mineCount = sortedThemes.filter((x) => !x.t.builtin).length;
                const collCount = sortedThemes.length - mineCount;
                const selCount = sortedThemes.filter((x) => activeIds.has(Number(x.t.id))).length;
                const favCount = sortedThemes.filter((x) => favs.has(Number(x.t.id))).length;
                const chips = [['all', `All · ${sortedThemes.length}`], ['collections', `Collections · ${collCount}`], ['mine', `Your Themes · ${mineCount}`]];
                if (favCount) chips.push(['favorites', `★ ${favCount}`]);
                if (selCount) chips.push(['selected', `Selected · ${selCount}`]);
                return (
                  <div className="flex items-center gap-[2px] bg-surface-container rounded-lg p-[3px] ml-auto mr-sm">
                    {chips.map(([id, label]) => (
                      <button key={id} onClick={() => setAllFilter(id)}
                        className={`px-md py-[4px] text-[10px] font-mono uppercase tracking-[0.04em] rounded transition-colors cursor-pointer ${allFilter === id ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                );
              })()}
              <button onClick={() => setShowAll(false)}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer flex items-center shrink-0">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-lg">
              {(() => {
                const shown = allFilter === 'mine' ? sortedThemes.filter((x) => !x.t.builtin)
                  : allFilter === 'collections' ? sortedThemes.filter((x) => x.t.builtin)
                  : allFilter === 'selected' ? sortedThemes.filter((x) => activeIds.has(Number(x.t.id)))
                  : allFilter === 'favorites' ? sortedThemes.filter((x) => favs.has(Number(x.t.id)))
                  : sortedThemes;
                if (!shown.length) {
                  return (
                    <div className="h-full flex flex-col items-center justify-center gap-sm text-outline-variant py-xl">
                      <span className="material-symbols-outlined text-5xl">palette</span>
                      <span className="text-label-sm font-label-sm uppercase tracking-widest">
                        {allFilter === 'mine' ? 'No themes of your own yet' : allFilter === 'selected' ? 'No themes enabled yet' : 'No themes'}
                      </span>
                      {allFilter === 'mine' && (
                        <p className="text-body-sm text-on-surface-variant/50 text-center max-w-xs mt-xs">
                          “Customize” any Collection, or “+ New Theme”, to make one that’s yours.
                        </p>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                    {renderThemeGrid(shown)}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>,
        document.body
      )}

      {editingTheme !== null && (
        <ThemeEditorModal
          theme={editingTheme?.id ? editingTheme : null}
          initialCategory={editingTheme?.category || 'song'}
          onClose={() => setEditingTheme(null)}
          onSaved={() => handleThemeSaved(editingTheme)}
        />
      )}
    </section>
  );
}
