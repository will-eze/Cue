import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FormattingToolbar,
  SlidePreview,
  LowerThirdPreview,
  DEFAULT_STYLE,
} from '../components/SongEditor';
import MediaPickerModal from '../components/MediaPickerModal';
import { useToast } from '../components/Toast';
import BackgroundLibrary from './BackgroundLibrary.jsx';
import { themeKind } from '../utils/themeSort';
import { mediaUrl } from '../utils/mediaUrl';
import { StaticSlide } from '../components/SlideElements';
import { buildThemeSlide, PRES_LAYOUTS } from '../utils/presentationThemes';
import { useFonts } from '../utils/fonts';

const SAMPLE_TEXT = 'Amazing Grace\nHow Sweet the Sound';

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

// ─── Theme Editor Modal ────────────────────────────────────────────────────

function ThemeEditorModal({ theme, initialCategory, onClose, onSaved }) {
  const startCat = theme?.category || initialCategory || 'song';
  const [category, setCategory] = useState(startCat);
  const [name, setName] = useState(theme?.name ?? '');
  // Song/scripture text-style state. (Skip parsing if the theme being edited is a
  // presentation theme — its style_json holds tokens, not a text style.)
  const [style, setStyle] = useState(() =>
    (theme?.category !== 'presentation' && theme?.style_json)
      ? { ...DEFAULT_STYLE, ...JSON.parse(theme.style_json) } : { ...DEFAULT_STYLE }
  );
  const [background, setBackground] = useState(
    theme?.background_id ? { id: theme.background_id, path: theme.background_path, filename: theme.background_filename } : null
  );
  // Presentation token state (independent of `style`, so toggling category keeps both).
  const [tokens, setTokens] = useState(() => {
    if (theme?.category === 'presentation' && theme?.style_json) {
      try { return { ...DEFAULT_PRES_TOKENS, ...JSON.parse(theme.style_json) }; } catch {}
    }
    return { ...DEFAULT_PRES_TOKENS };
  });
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState('fullscreen');
  const [previewLayout, setPreviewLayout] = useState('title-sub');
  const [saving, setSaving] = useState(false);
  const fonts = useFonts();
  const isPres = category === 'presentation';

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
        style_json: JSON.stringify(isPres ? tokens : style),
        background_id: isPres ? null : (background?.id ?? null),
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

  return createPortal(
    <div className="fixed inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50 p-2">
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-3xl flex flex-col shadow-2xl ring-1 ring-white/5 overflow-y-auto custom-scrollbar" style={{ maxHeight: '94vh' }}>

        {/* Header */}
        <div className="flex items-center gap-md px-lg py-sm border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>style</span>
          <div>
            <h2 className="text-headline-md font-bold text-primary leading-tight">
              {theme?.id ? 'Edit Theme' : 'New Theme'}
            </h2>
            <p className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">Theme Editor</p>
          </div>
          <div className="flex-1" />
          {/* Target surface — switches the editor between the song text-style and the
              presentation token editor; elements below update accordingly. */}
          <div className="flex items-center gap-[2px] bg-surface-container rounded-lg p-[3px]">
            {THEME_CATS.map((c) => (
              <button key={c.id} onClick={() => setCategory(c.id)}
                className={`px-md py-1 rounded text-label-sm font-mono uppercase tracking-[0.05em] transition-colors cursor-pointer ${category === c.id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>
                {c.label}
              </button>
            ))}
          </div>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer text-sm">
            ✕
          </button>
        </div>

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
          {/* Presentation backgrounds are CSS tokens (edited below), not a media asset. */}
          {!isPres && (
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
          )}
        </div>

        {isPres ? (
          <>
            {/* Presentation token editor */}
            <PresThemeEditor tokens={tokens} setTokens={setTokens} fonts={fonts} />

            {/* Slide preview — rendered from the tokens across a selectable layout. */}
            <div className="p-md bg-surface-container-lowest">
              <div className="flex items-center justify-between mb-sm">
                <span className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-[0.06em]">Slide Preview</span>
                <select value={previewLayout} onChange={(e) => setPreviewLayout(e.target.value)}
                  className="bg-surface-container border border-outline-variant/30 rounded px-sm py-[2px] text-[10px] font-mono text-on-surface outline-none focus:border-primary cursor-pointer">
                  {PRES_LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="w-full max-w-xl mx-auto">
                <StaticSlide elements={buildThemeSlide(tokens, previewLayout)} />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Formatting toolbar */}
            <FormattingToolbar
              style={style}
              onChange={setStyle}
              fonts={fonts}
              hasSelection={() => false}
              execCmd={() => {}}
              previewTemplate={previewTemplate}
            />

            {/* Preview — width-bound so it derives its height from the modal width
                (the modal is content-sized; a height-bound box would collapse to 0). */}
            <div className="p-md bg-surface-container-lowest">
              <div className="flex items-center justify-between mb-sm">
                <span className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-[0.06em]">
                  {previewTemplate === 'lowerthird' ? 'Lower Third Preview' : 'Fullscreen Preview'}
                </span>
                <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px]">
                  {[
                    { id: 'fullscreen', label: 'Full' },
                    { id: 'lowerthird', label: 'L3' },
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
              <div className="w-full">
                {previewTemplate === 'lowerthird' ? (
                  <LowerThirdPreview text={SAMPLE_TEXT} runs={[]} style={style} />
                ) : (
                  <SlidePreview
                    text={SAMPLE_TEXT}
                    runs={[]}
                    style={style}
                    backgroundPath={background?.path ?? null}
                    onTextBoxChange={(box) => setStyle((s) => ({ ...s, textBox: box }))}
                  />
                )}
              </div>
            </div>
          </>
        )}

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

function ThemeCard({ theme, services, onEdit, onDelete, onApplied, bgThumb, songApply = true }) {
  const toast = useToast();
  const [selectedServiceId, setSelectedServiceId] = useState(services[0]?.id ?? null);
  const [applyBg, setApplyBg] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const isBuiltin = !!theme.builtin;
  const style = theme.style_json ? { ...DEFAULT_STYLE, ...JSON.parse(theme.style_json) } : { ...DEFAULT_STYLE };
  // Presentation themes are element layouts (not a section text style), so they
  // preview with the slide-element renderer rather than the song SlidePreview.
  const isPresentation = (theme.category || 'song') === 'presentation';
  // A theme carries a background if it has a media asset, an authored CSS gradient,
  // or a media-library reference (bgRef) resolved on apply.
  const hasBackground = !!theme.background_id || !!style.bgCss || !!style.bgRef;

  function showFeedback(msg) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  }

  // Built-ins are read-only; "Duplicate" creates an editable user copy so the
  // curated pack stays intact (and re-seedable on factory reset).
  async function handleDuplicate() {
    await window.cue.themes.create({
      name: `${theme.name} Copy`,
      style_json: theme.style_json ?? null,
      background_id: theme.background_id ?? null,
      category: theme.category || 'song',
    });
    showFeedback('Duplicated — see new theme');
    onApplied?.();
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
    if (!confirm(`Apply theme "${theme.name}" to every song in the library?\nThis overwrites each song's style while preserving inline text formatting.`)) return;
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
      {/* Slide preview */}
      <div className="p-sm pb-0">
        {isPresentation ? (
          <StaticSlide elements={buildThemeSlide(style, 'title-sub')} />
        ) : (
          <SlidePreview
            text={SAMPLE_TEXT}
            runs={[]}
            style={bgThumb ? { ...style, bgThumb } : style}
            backgroundPath={theme.background_path ?? null}
          />
        )}
      </div>

      {/* Name + edit/delete */}
      <div className="px-md pt-sm pb-xs flex items-center justify-between">
        <span className="text-label-sm font-mono font-bold text-on-surface truncate min-w-0 mr-sm flex items-center gap-xs">
          {theme.name}
          {isBuiltin && (
            <span className="text-[8px] font-mono text-primary/70 border border-primary/30 rounded px-[3px] py-[1px] uppercase tracking-[0.05em] shrink-0">Built-in</span>
          )}
        </span>
        <div className="flex items-center gap-xs flex-shrink-0">
          {isBuiltin ? (
            <button onClick={handleDuplicate}
              className="text-[9px] font-mono text-on-surface-variant hover:text-primary cursor-pointer uppercase tracking-[0.05em] transition-colors">
              Duplicate
            </button>
          ) : (
            <>
              <button onClick={onEdit}
                className="text-[9px] font-mono text-on-surface-variant hover:text-primary cursor-pointer uppercase tracking-[0.05em] transition-colors">
                Edit
              </button>
              {confirmDelete ? (
                <>
                  <button onClick={() => { onDelete(); setConfirmDelete(false); }}
                    className="text-[9px] font-mono text-error cursor-pointer uppercase tracking-[0.05em]">
                    Confirm
                  </button>
                  <button onClick={() => setConfirmDelete(false)}
                    className="text-[9px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.05em]">
                    Cancel
                  </button>
                </>
              ) : (
                <button onClick={() => setConfirmDelete(true)}
                  className="text-[9px] font-mono text-on-surface-variant/40 hover:text-error cursor-pointer uppercase tracking-[0.05em] transition-colors">
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Apply controls */}
      <div className="px-md pb-md space-y-xs">
        {!songApply ? (
          <p className="text-[9px] font-mono text-on-surface-variant/50 leading-snug pb-xs">
            Open the {theme.category} editor and pick this theme to apply it.
          </p>
        ) : (<>
        {hasBackground && (
          <label className="flex items-center gap-xs cursor-pointer">
            <input
              type="checkbox"
              checked={applyBg}
              onChange={(e) => setApplyBg(e.target.checked)}
              className="accent-primary w-3 h-3"
            />
            <span className="text-[10px] font-mono text-on-surface-variant/70">Apply background</span>
          </label>
        )}

        <div className="flex items-center gap-xs">
          <select
            value={selectedServiceId ?? ''}
            onChange={(e) => setSelectedServiceId(Number(e.target.value))}
            className="flex-1 min-w-0 bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[3px] text-[10px] font-mono text-on-surface outline-none focus:border-primary cursor-pointer"
          >
            {services.length === 0
              ? <option value="">No rundowns</option>
              : services.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)
            }
          </select>
          <button
            onClick={handleApplyToRundown}
            disabled={!selectedServiceId || services.length === 0}
            className="shrink-0 px-sm py-[3px] text-[9px] font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 active:scale-95 transition-all cursor-pointer disabled:opacity-40 uppercase tracking-[0.05em]"
          >
            Apply
          </button>
        </div>

        <button
          onClick={handleApplyToAllSongs}
          className="w-full text-[9px] font-mono text-on-surface-variant/60 hover:text-on-surface border border-outline-variant/20 hover:border-outline-variant rounded px-sm py-[3px] transition-colors cursor-pointer uppercase tracking-[0.05em]"
        >
          Apply to all songs
        </button>
        </>)}

        {feedback && (
          <p className="text-[9px] font-mono text-tertiary pt-[2px]">{feedback}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main section component ────────────────────────────────────────────────

export default function ThemeSettings() {
  const [themes, setThemes] = useState([]);
  const [services, setServices] = useState([]);
  const [editingTheme, setEditingTheme] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [bgThumbs, setBgThumbs] = useState({}); // media-library item id -> thumb url (for media-theme previews)
  const [cat, setCat] = useState('song');       // active category tab

  useEffect(() => {
    reload();
    window.cue.services.list().then(setServices);
    window.cue.backgrounds?.list?.().then((items) => {
      const map = {};
      for (const it of items) if (it.thumb) map[it.id] = it.thumb;
      setBgThumbs(map);
    }).catch(() => {});
  }, []);

  async function reload() {
    const list = await window.cue.themes.list();
    setThemes(list);
  }

  async function handleDelete(id) {
    await window.cue.themes.delete(id);
    reload();
  }

  const renderCard = (theme) => {
    let bgRef = null;
    try { bgRef = theme.style_json ? JSON.parse(theme.style_json).bgRef : null; } catch {}
    return (
      <ThemeCard
        key={theme.id}
        theme={theme}
        services={services}
        bgThumb={bgRef ? bgThumbs[bgRef] : null}
        onEdit={() => setEditingTheme(theme)}
        onDelete={() => handleDelete(theme.id)}
        onApplied={reload}
        songApply={(theme.category || 'song') === 'song'}
      />
    );
  };

  const CAT_ORDER = ['song', 'scripture', 'graphic', 'presentation'];
  const CAT_LABEL = { song: 'Songs', scripture: 'Scripture', graphic: 'Graphics', presentation: 'Presentations' };
  const categories = useMemo(() => {
    const present = new Set(themes.map((t) => t.category || 'song'));
    return CAT_ORDER.filter((c) => present.has(c));
  }, [themes]);

  // Filtered to the active category, then: media → gradient → custom.
  const sortedThemes = useMemo(() => {
    return themes
      .filter((t) => (t.category || 'song') === cat)
      .map((t) => ({ t, kind: themeKind(t) }))
      .sort((a, b) => a.kind - b.kind || (a.t.sort_order ?? 0) - (b.t.sort_order ?? 0)
        || a.t.name.localeCompare(b.t.name));
  }, [themes, cat]);

  // Render the grid, dropping a full-width "Your Themes" separator before the
  // first custom (user-created) theme.
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
        Themes
      </h2>

      <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30">
        <div className="flex items-start justify-between mb-md gap-md">
          <div>
            <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Saved Themes</h3>
            <p className="text-body-sm text-on-surface-variant/70 mt-xs">
              A theme is a saved text style (font, colour, shadow, textbox) plus an optional default background.
              Apply it to a rundown or to all songs to give them a consistent look.
            </p>
          </div>
          <button
            onClick={() => setEditingTheme({ category: cat })}
            className="shrink-0 px-md py-xs text-label-sm font-label-sm font-bold bg-primary/10 border border-primary/30 text-primary rounded-lg hover:bg-primary/20 active:scale-95 transition-all cursor-pointer"
          >
            + New Theme
          </button>
        </div>

        {categories.length > 1 && (
          <div className="flex items-center gap-xs mb-md">
            {categories.map((c) => (
              <button key={c} onClick={() => { setCat(c); setShowAll(false); }}
                className={`px-md py-[3px] text-label-sm font-label-sm uppercase tracking-[0.05em] rounded-lg border transition-colors cursor-pointer ${cat === c ? 'bg-primary/15 border-primary/40 text-primary' : 'border-outline-variant/30 text-on-surface-variant hover:text-on-surface'}`}>
                {CAT_LABEL[c] || c}
              </button>
            ))}
          </div>
        )}

        {sortedThemes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-xl gap-sm text-outline-variant">
            <span className="material-symbols-outlined text-5xl">palette</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">No themes yet</span>
            <p className="text-body-sm text-on-surface-variant/50 text-center max-w-xs mt-xs">
              Create a theme to save a style you can quickly apply across songs and rundowns.
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
                View all {sortedThemes.length} {CAT_LABEL[cat]?.toLowerCase() || ''} themes
              </button>
            )}
          </>
        )}
      </div>

      <BackgroundLibrary />

      {showAll && createPortal(
        <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex flex-col" onMouseDown={() => setShowAll(false)}>
          <div
            className="flex-1 min-h-0 flex flex-col m-lg bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0">
              <h3 className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em] flex items-center gap-sm">
                <span className="material-symbols-outlined text-primary text-[20px]">style</span>
                All {CAT_LABEL[cat] || ''} Themes · {sortedThemes.length}
              </h3>
              <button onClick={() => setShowAll(false)}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer flex items-center">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-lg">
              <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {renderThemeGrid(sortedThemes)}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {editingTheme !== null && (
        <ThemeEditorModal
          theme={editingTheme?.id ? editingTheme : null}
          initialCategory={editingTheme?.category || cat}
          onClose={() => setEditingTheme(null)}
          onSaved={() => { setEditingTheme(null); reload(); }}
        />
      )}
    </section>
  );
}
