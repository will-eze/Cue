import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SlidePreview, DEFAULT_STYLE } from './SongEditor';
import { sortThemes } from '../utils/themeSort';

// Reusable "click a theme to apply it" picker — a grid of live theme previews
// (media built-ins → gradient built-ins → custom, with a separator before the
// user's own). Replaces the old Load-Theme dropdown. onPick(theme) is called
// with the chosen theme; the caller decides what "apply" means.
const SAMPLE = 'Amazing Grace\nHow Sweet the Sound';

function PickCard({ theme, bgThumb, onPick }) {
  const style = theme.style_json ? { ...DEFAULT_STYLE, ...JSON.parse(theme.style_json) } : { ...DEFAULT_STYLE };
  const isMedia = !!style.bgRef || !!theme.background_id;
  return (
    // A <div> (not <button>) so SlidePreview's width:100%/aspect-ratio lays out
    // correctly — matches the Settings "view all" card. Button semantics added.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPick(theme)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(theme); } }}
      className="bg-surface-container border border-outline-variant/30 rounded-xl overflow-hidden flex flex-col cursor-pointer hover:border-primary/50 hover:ring-1 hover:ring-primary/30 active:scale-[0.99] transition-all"
    >
      <div className="p-sm pb-0">
        <SlidePreview text={SAMPLE} runs={[]} style={bgThumb ? { ...style, bgThumb } : style} backgroundPath={theme.background_path ?? null} />
      </div>
      <div className="px-md py-sm flex items-center gap-xs">
        <span className="text-label-sm font-mono font-bold text-on-surface truncate min-w-0">{theme.name}</span>
        {theme.builtin
          ? isMedia && <span className="text-[8px] font-mono text-primary/70 border border-primary/30 rounded px-[3px] py-[1px] uppercase tracking-[0.05em] shrink-0">Media</span>
          : <span className="text-[8px] font-mono text-tertiary/80 border border-tertiary/30 rounded px-[3px] py-[1px] uppercase tracking-[0.05em] shrink-0">Custom</span>}
      </div>
    </div>
  );
}

export default function ThemePickerModal({ onPick, onClose, category = 'song' }) {
  const [themes, setThemes] = useState([]);
  const [bgThumbs, setBgThumbs] = useState({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    window.cue.themes.list().then((list) => setThemes(list.filter((t) => (t.category || 'song') === category))).catch(() => {});
    window.cue.backgrounds?.list?.().then((items) => {
      const map = {};
      for (const it of items) if (it.thumb) map[it.id] = it.thumb;
      setBgThumbs(map);
    }).catch(() => {});
  }, [category]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? themes.filter((t) => t.name.toLowerCase().includes(q)) : themes;
    return sortThemes(list);
  }, [themes, query]);

  const bgThumbFor = (theme) => {
    try { const r = theme.style_json ? JSON.parse(theme.style_json).bgRef : null; return r ? bgThumbs[r] : null; } catch { return null; }
  };

  const nodes = [];
  let customStarted = false;
  for (const { t, kind } of sorted) {
    if (kind === 2 && !customStarted) {
      customStarted = true;
      nodes.push(
        <div key="sep-custom" style={{ gridColumn: '1 / -1' }} className="flex items-center gap-sm mt-sm">
          <span className="text-label-sm font-label-sm uppercase tracking-[0.08em] text-on-surface-variant whitespace-nowrap">Your Themes</span>
          <span className="flex-1 h-px bg-outline-variant/30" />
        </div>
      );
    }
    nodes.push(<PickCard key={t.id} theme={t} bgThumb={bgThumbFor(t)} onPick={onPick} />);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-background/90 flex flex-col" onMouseDown={onClose}>
      <div
        className="flex-1 min-h-0 flex flex-col m-lg bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0 gap-md">
          <h3 className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em] flex items-center gap-sm shrink-0">
            <span className="material-symbols-outlined text-primary text-[20px]">style</span>
            Choose a theme
          </h3>
          <div className="flex-1 max-w-sm relative">
            <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant/60 text-[18px]">search</span>
            <input
              value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
              placeholder="Search themes…"
              className="w-full pl-[34px] pr-sm py-xs text-body-sm bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary/50"
            />
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface cursor-pointer flex items-center shrink-0">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-lg">
          {sorted.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-sm text-outline-variant">
              <span className="material-symbols-outlined text-5xl">palette</span>
              <span className="text-label-sm font-label-sm uppercase tracking-widest">No themes</span>
            </div>
          ) : (
            <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {nodes}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
