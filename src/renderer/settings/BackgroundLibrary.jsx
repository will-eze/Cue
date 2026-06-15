import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

// Phase 1b — Background Library (Layer 1). Browses the curated, tagged manifest
// of worship backgrounds (resources/media-manifest.json). Tiles preview by
// hotlinking each item's remote `thumb`; picking downloads the origin into the
// local media library (a normal media_asset) and can set it as a default
// background. See src/main/db/background-library.js.

const SURFACES = [
  { key: 'song', label: 'Songs' },
  { key: 'scripture', label: 'Scripture' },
  { key: 'slide', label: 'Slides' },
];

const BATCH = 24; // tiles mounted per page — keeps thumbnail requests + compositor cost bounded

function Tile({ item, busy, onApply, onAdd }) {
  return (
    <div
      className="group relative aspect-video rounded-lg overflow-hidden border border-outline-variant/30 bg-surface-container"
      // skip rendering/compositing tiles while offscreen — keeps GPU tile memory
      // bounded (fixes "tile memory limits exceeded"). `auto` makes Chromium
      // remember each tile's real rendered size, so re-entry doesn't shift layout.
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 124px' }}
    >
      <img src={item.thumb} loading="lazy" decoding="async" alt=""
        className="w-full h-full object-cover" draggable={false} />

      {/* badges */}
      <div className="absolute top-xs left-xs flex gap-xs">
        {item.kind === 'video' && (
          <span className="px-xs py-[1px] rounded bg-background/85 text-[10px] font-label-sm uppercase tracking-wide text-on-surface flex items-center gap-[2px]">
            <span className="material-symbols-outlined text-[12px]">play_arrow</span>video
          </span>
        )}
        {item.mediaId != null && (
          <span className="px-xs py-[1px] rounded bg-tertiary/80 text-[10px] font-label-sm uppercase tracking-wide text-on-tertiary flex items-center gap-[2px]">
            <span className="material-symbols-outlined text-[12px]">check</span>library
          </span>
        )}
      </div>

      {/* hover actions */}
      <div className="absolute inset-0 bg-background/90 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-xs p-sm">
        {busy ? (
          <span className="material-symbols-outlined text-primary animate-spin text-[28px]">progress_activity</span>
        ) : (
          <>
            <span className="text-[10px] font-label-sm uppercase tracking-[0.08em] text-on-surface-variant">Set as default for</span>
            <div className="flex flex-wrap gap-xs justify-center">
              {SURFACES.map((s) => (
                <button key={s.key} onClick={() => onApply(item, s.key)}
                  className="px-sm py-[3px] text-[11px] font-label-sm font-bold rounded-md bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25 active:scale-95 transition-all cursor-pointer">
                  {s.label}
                </button>
              ))}
            </div>
            {item.mediaId == null && (
              <button onClick={() => onAdd(item)}
                className="mt-[2px] text-[10px] font-label-sm uppercase tracking-[0.06em] text-on-surface-variant hover:text-on-surface cursor-pointer flex items-center gap-[2px]">
                <span className="material-symbols-outlined text-[14px]">download</span>add to library
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BrowserModal({ items, tagCounts, onClose, onChange }) {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [kind, setKind] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);
  const [visible, setVisible] = useState(BATCH);
  const toastTimer = useRef(null);
  const sentinelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function flash(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  // top tags as quick filters (exclude the noisiest generic ones up front)
  const topTags = useMemo(
    () => Object.entries(tagCounts).slice(0, 28).map(([t]) => t),
    [tagCounts]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (!it.thumb) return false;
      if (kind !== 'all' && it.kind !== kind) return false;
      if (activeTag && !it.tags.includes(activeTag)) return false;
      if (q && !it.tags.some((t) => t.includes(q))) return false;
      return true;
    });
  }, [items, query, activeTag, kind]);

  const shown = useMemo(() => filtered.slice(0, visible), [filtered, visible]);

  // reset the window whenever the filter changes (don't page through a stale set)
  useEffect(() => { setVisible(BATCH); }, [query, activeTag, kind]);

  // auto-append the next batch when the sentinel scrolls into view
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visible >= filtered.length) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setVisible((v) => Math.min(v + BATCH, filtered.length));
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible, filtered.length]);

  async function apply(item, surface) {
    setBusyId(item.id);
    try {
      const asset = await window.cue.backgrounds.applyAsDefault(item.id, surface);
      onChange(item.id, asset.id);
      flash(`Set as default ${surface} background`);
    } catch (e) { flash('Failed: ' + (e?.message || e)); }
    finally { setBusyId(null); }
  }
  async function add(item) {
    setBusyId(item.id);
    try {
      const asset = await window.cue.backgrounds.download(item.id);
      onChange(item.id, asset.id);
      flash('Added to your media library');
    } catch (e) { flash('Failed: ' + (e?.message || e)); }
    finally { setBusyId(null); }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-background/95 flex flex-col" onMouseDown={onClose}>
      <div
        className="flex-1 min-h-0 flex flex-col m-lg bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-lg py-md border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0 gap-md">
          <h3 className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em] flex items-center gap-sm shrink-0">
            <span className="material-symbols-outlined text-primary text-[20px]">wallpaper</span>
            Backgrounds · {filtered.length}
          </h3>
          <div className="flex-1 max-w-sm relative">
            <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant/60 text-[18px]">search</span>
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tags — ocean, candle, snow…"
              className="w-full pl-[34px] pr-sm py-xs text-body-sm bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex items-center gap-xs shrink-0">
            {['all', 'video', 'photo'].map((k) => (
              <button key={k} onClick={() => setKind(k)}
                className={`px-sm py-[3px] text-[11px] font-label-sm uppercase tracking-wide rounded-md border transition-colors cursor-pointer ${kind === k ? 'bg-primary/15 border-primary/40 text-primary' : 'border-outline-variant/30 text-on-surface-variant hover:text-on-surface'}`}>
                {k}
              </button>
            ))}
            <button onClick={onClose} className="ml-xs text-on-surface-variant hover:text-on-surface cursor-pointer flex items-center">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        {/* tag chips */}
        <div className="flex items-center gap-xs px-lg py-sm border-b border-outline-variant/20 overflow-x-auto flex-shrink-0">
          <button onClick={() => setActiveTag(null)}
            className={`px-sm py-[2px] text-[11px] font-label-sm rounded-full border whitespace-nowrap transition-colors cursor-pointer ${!activeTag ? 'bg-primary/15 border-primary/40 text-primary' : 'border-outline-variant/30 text-on-surface-variant hover:text-on-surface'}`}>
            All
          </button>
          {topTags.map((t) => (
            <button key={t} onClick={() => setActiveTag(activeTag === t ? null : t)}
              className={`px-sm py-[2px] text-[11px] font-label-sm rounded-full border whitespace-nowrap transition-colors cursor-pointer ${activeTag === t ? 'bg-primary/15 border-primary/40 text-primary' : 'border-outline-variant/30 text-on-surface-variant hover:text-on-surface'}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-lg">
          {filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-sm text-outline-variant">
              <span className="material-symbols-outlined text-5xl">image_search</span>
              <span className="text-label-sm font-label-sm uppercase tracking-widest">No matches</span>
            </div>
          ) : (
            <>
              <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                {shown.map((it) => (
                  <Tile key={it.id} item={it} busy={busyId === it.id} onApply={apply} onAdd={add} />
                ))}
              </div>
              {visible < filtered.length && (
                <div ref={sentinelRef} className="flex justify-center pt-lg">
                  <button onClick={() => setVisible((v) => Math.min(v + BATCH, filtered.length))}
                    className="px-lg py-sm text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant hover:text-on-surface border border-outline-variant/30 hover:border-outline-variant rounded-lg transition-colors cursor-pointer flex items-center gap-xs">
                    <span className="material-symbols-outlined text-[18px]">expand_more</span>
                    Load more · {shown.length} of {filtered.length}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {toast && (
          <div className="absolute bottom-lg left-1/2 -translate-x-1/2 px-md py-sm rounded-lg bg-surface-container-high border border-outline-variant/40 text-body-sm text-on-surface shadow-xl ring-1 ring-white/5">
            {toast}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default function BackgroundLibrary() {
  const [items, setItems] = useState([]);
  const [tagCounts, setTagCounts] = useState({});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    window.cue.backgrounds.list().then(setItems).catch(() => setItems([]));
    window.cue.backgrounds.tagCounts().then(setTagCounts).catch(() => setTagCounts({}));
  }, []);

  function handleChange(itemId, mediaId) {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, mediaId } : i)));
  }

  const previews = useMemo(() => items.filter((i) => i.thumb).slice(0, 6), [items]);
  const total = useMemo(() => items.filter((i) => i.thumb).length, [items]);

  return (
    <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30">
      <div className="flex items-start justify-between mb-md gap-md">
        <div>
          <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Background Library</h3>
          <p className="text-body-sm text-on-surface-variant/70 mt-xs">
            Curated 16:9 worship backgrounds (video &amp; photo). Pick one to download it into your
            media library and set it as a default background.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          disabled={total === 0}
          className="shrink-0 px-md py-xs text-label-sm font-label-sm font-bold bg-primary/10 border border-primary/30 text-primary rounded-lg hover:bg-primary/20 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default flex items-center gap-xs"
        >
          <span className="material-symbols-outlined text-[18px]">wallpaper</span>
          Browse {total > 0 ? total : ''} backgrounds
        </button>
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center py-xl gap-sm text-outline-variant">
          <span className="material-symbols-outlined text-5xl">wallpaper</span>
          <span className="text-label-sm font-label-sm uppercase tracking-widest">Library unavailable</span>
        </div>
      ) : (
        <button onClick={() => setOpen(true)}
          className="grid gap-sm w-full cursor-pointer" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          {previews.map((it) => (
            <div key={it.id} className="aspect-video rounded-md overflow-hidden border border-outline-variant/30 bg-surface-container">
              <img src={it.thumb} loading="lazy" alt="" className="w-full h-full object-cover" draggable={false} />
            </div>
          ))}
        </button>
      )}

      {open && (
        <BrowserModal
          items={items}
          tagCounts={tagCounts}
          onClose={() => setOpen(false)}
          onChange={handleChange}
        />
      )}
    </div>
  );
}
