import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { SlidePreview, DEFAULT_STYLE } from '../components/SongEditor';
import { normalizeLookStyle } from '../utils/presentationThemes';
import { sortThemes, filterBrowseThemes, isCuratedTheme } from '../utils/themeSort';
import { ensureThemeBg } from '../utils/ensureThemeBg';
import { getThemeFavs, toggleThemeFav } from '../utils/themeFavorites';
import { themeSearchText } from '../utils/themeSearch';
import ThemeCascadeBar from '../components/ThemeCascadeBar';
import LazyVisible from '../components/LazyVisible';
import { useToast } from '../components/Toast';

// Compact, in-operator theme browser — quick-assign a look to the rundown or set it as
// an app default without leaving for Settings. Reuses SlidePreview (so cards show the
// real treated look) and the shared curated/legacy filter. Heavier management (bake,
// reset-all, the full editor) stays in Settings → Theme Library.
const SAMPLE = 'Amazing Grace\nHow Sweet the Sound';

function themeStyleOf(theme) {
  const raw = theme.style_json ? JSON.parse(theme.style_json) : null;
  return { ...DEFAULT_STYLE, ...(normalizeLookStyle(raw) || {}) };
}

function ThemeQuickCard({ theme, bgThumb, isDefault, isSongDefault, isScriptureDefault, isSlideDefault, isRundown, isFav, onDefault, onRundown, onApplyToItem, onToggleFav }) {
  const style = useMemo(() => themeStyleOf(theme), [theme]);
  return (
    <div className="bg-surface-container border border-outline-variant/30 rounded-xl overflow-hidden flex flex-col">
      {/* Double-click the preview to apply this theme to the selected rundown item(s),
          mirroring the media double-click background override. */}
      <div className="p-sm pb-0 cursor-pointer" onDoubleClick={() => onApplyToItem?.(theme)}
        title="Double-click to apply to the selected rundown item">
        <LazyVisible placeholder={<div className="w-full aspect-video rounded-lg bg-surface-container-high animate-pulse" />}>
          <SlidePreview text={SAMPLE} runs={[]} style={bgThumb ? { ...style, bgThumb } : style} backgroundPath={theme.background_path ?? null} />
        </LazyVisible>
      </div>
      <div className="px-md pt-sm pb-xs flex items-center gap-xs min-w-0">
        <span className="text-label-sm font-mono font-bold text-on-surface truncate min-w-0">{theme.name}</span>
        {isDefault && <span className="text-[8px] font-mono text-tertiary border border-tertiary/40 rounded px-[3px] uppercase tracking-[0.05em] shrink-0">Default</span>}
        <button onClick={() => onToggleFav?.(theme)} title={isFav ? 'Unpin' : 'Pin to Favorites'}
          className={`ml-auto shrink-0 flex items-center transition-colors cursor-pointer ${isFav ? 'text-primary' : 'text-on-surface-variant/30 hover:text-on-surface-variant'}`}>
          <span className="material-symbols-outlined text-[15px]" style={isFav ? { fontVariationSettings: "'FILL' 1" } : undefined}>star</span>
        </button>
      </div>
      <div className="px-md pb-md space-y-xs">
        <button onClick={() => onRundown(theme)}
          className={`w-full text-[10px] font-mono uppercase tracking-[0.05em] rounded px-sm py-[5px] cursor-pointer flex items-center justify-center gap-xs border transition-colors ${
            isRundown ? 'bg-primary/15 border-primary/40 text-primary'
              : 'bg-primary/5 border-primary/20 text-on-surface-variant hover:text-primary hover:border-primary/40'}`}>
          <span className="material-symbols-outlined text-[13px]">{isRundown ? 'check_circle' : 'playlist_add_check'}</span>
          {isRundown ? 'This rundown’s theme' : 'Use for this rundown'}
        </button>
        <div className="flex items-center gap-xs flex-wrap">
          <span className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-[0.05em] shrink-0">Default</span>
          <button onClick={() => onDefault(theme, 'all')} title="App-wide default (all content)"
            className={`flex items-center justify-center gap-[2px] px-sm py-[4px] text-[10px] font-mono uppercase tracking-[0.04em] rounded cursor-pointer border transition-colors shrink-0 ${
              isDefault ? 'bg-tertiary/15 border-tertiary/40 text-tertiary' : 'bg-tertiary-container/10 border-tertiary-container/30 text-on-surface-variant hover:text-tertiary hover:border-tertiary/40'}`}>
            <span className="material-symbols-outlined text-[12px]">stars</span>All
          </button>
          <button onClick={() => onDefault(theme, 'song')} title="Songs only"
            className={`flex-1 min-w-[66px] text-[10px] font-mono uppercase tracking-[0.04em] rounded px-xs py-[4px] cursor-pointer border transition-colors ${
              isSongDefault ? 'bg-tertiary/15 border-tertiary/40 text-tertiary' : 'border-outline-variant/25 text-on-surface-variant/70 hover:text-tertiary hover:border-tertiary/40'}`}>
            Songs
          </button>
          <button onClick={() => onDefault(theme, 'scripture')} title="Scripture only"
            className={`flex-1 min-w-[66px] text-[10px] font-mono uppercase tracking-[0.04em] rounded px-xs py-[4px] cursor-pointer border transition-colors ${
              isScriptureDefault ? 'bg-tertiary/15 border-tertiary/40 text-tertiary' : 'border-outline-variant/25 text-on-surface-variant/70 hover:text-tertiary hover:border-tertiary/40'}`}>
            Scripture
          </button>
          <button onClick={() => onDefault(theme, 'slide')} title="Slides only"
            className={`flex-1 min-w-[66px] text-[10px] font-mono uppercase tracking-[0.04em] rounded px-xs py-[4px] cursor-pointer border transition-colors ${
              isSlideDefault ? 'bg-tertiary/15 border-tertiary/40 text-tertiary' : 'border-outline-variant/25 text-on-surface-variant/70 hover:text-tertiary hover:border-tertiary/40'}`}>
            Slides
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LibraryThemesTab({ activeServiceId, onThemesChanged, onApplyToItem }) {
  const toast = useToast();
  const [themes, setThemes] = useState([]);
  const [bgThumbs, setBgThumbs] = useState({});
  const [query, setQuery] = useState('');
  const [showLegacy, setShowLegacy] = useState(false);
  const [group, setGroup] = useState('all'); // all | collections | mine | favorites | selected
  const [favs, setFavs] = useState(() => getThemeFavs());
  const [defId, setDefId] = useState(null);
  const [songDef, setSongDef] = useState(null);
  const [scrDef, setScrDef] = useState(null);
  const [slideDef, setSlideDef] = useState(null);
  const [svcThemeId, setSvcThemeId] = useState(null);
  const [svcTitle, setSvcTitle] = useState(null);

  const reloadDefaults = useCallback(() => {
    window.cue.settings.get('default_theme_id').then((v) => setDefId(Number(v) || null));
    window.cue.settings.get('default_theme_id_song').then((v) => setSongDef(Number(v) || null));
    window.cue.settings.get('default_theme_id_scripture').then((v) => setScrDef(Number(v) || null));
    window.cue.settings.get('default_theme_id_slide').then((v) => setSlideDef(Number(v) || null));
  }, []);
  const reloadSvc = useCallback(() => {
    if (!activeServiceId) { setSvcThemeId(null); setSvcTitle(null); return; }
    window.cue.services.get(activeServiceId).then((s) => { setSvcThemeId(s?.theme_id || null); setSvcTitle(s?.title || null); }).catch(() => {});
  }, [activeServiceId]);

  useEffect(() => {
    window.cue.themes.list().then((l) => setThemes((l || []).filter((t) => (t.category || 'song') !== 'graphic'))).catch(() => {});
    window.cue.backgrounds?.list?.().then((items) => {
      const m = {}; for (const it of items) if (it.thumb) m[it.id] = it.thumb; setBgThumbs(m);
    }).catch(() => {});
    reloadDefaults();
  }, [reloadDefaults]);
  useEffect(() => { reloadSvc(); }, [reloadSvc]);

  // Themes enabled in the cascade (a default of any kind, or the rundown theme).
  const activeIds = useMemo(
    () => new Set([defId, songDef, scrDef, slideDef, svcThemeId].filter(Boolean).map(Number)),
    [defId, songDef, scrDef, slideDef, svcThemeId],
  );
  const hasLegacy = useMemo(() => themes.some((t) => t.builtin && !isCuratedTheme(t)), [themes]);
  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q ? themes.filter((t) => themeSearchText(t).includes(q)) : themes;
    list = filterBrowseThemes(list, { showLegacy, keepIds: [defId, songDef, scrDef, slideDef, svcThemeId] });
    if (group === 'mine') list = list.filter((t) => !t.builtin);
    else if (group === 'collections') list = list.filter((t) => t.builtin);
    else if (group === 'selected') list = list.filter((t) => activeIds.has(Number(t.id)));
    else if (group === 'favorites') list = list.filter((t) => favs.has(Number(t.id)));
    return sortThemes(list);
  }, [themes, query, showLegacy, group, defId, songDef, scrDef, slideDef, svcThemeId, activeIds, favs]);
  const mineCount = useMemo(() => themes.filter((t) => !t.builtin).length, [themes]);

  const bgThumbFor = (t) => {
    try { const r = t.style_json ? JSON.parse(t.style_json).bgRef : null; return r ? bgThumbs[r] : null; } catch { return null; }
  };

  async function setDefault(theme, scope) {
    const key = scope === 'song' ? 'default_theme_id_song' : scope === 'scripture' ? 'default_theme_id_scripture' : scope === 'slide' ? 'default_theme_id_slide' : 'default_theme_id';
    const cur = scope === 'song' ? songDef : scope === 'scripture' ? scrDef : scope === 'slide' ? slideDef : defId;
    const next = theme.id === cur ? null : theme.id;
    if (next) await ensureThemeBg(theme, toast); // download the photo/video bg first
    const commit = async (id) => { await window.cue.settings.set(key, id ? String(id) : ''); reloadDefaults(); onThemesChanged?.(); };
    await commit(next);
    const scopeLabel = scope === 'all' ? 'Default' : `${scope[0].toUpperCase() + scope.slice(1)} default`;
    toast.show({ message: next ? `${scopeLabel} → “${theme.name}”` : `${scopeLabel} cleared`, kind: 'success', duration: 6000,
      action: { label: 'Undo', onClick: () => commit(cur) } });
  }
  async function useForRundown(theme) {
    if (!activeServiceId) { toast.error('Open a rundown first.'); return; }
    await ensureThemeBg(theme, toast); // download the photo/video bg first
    const prev = svcThemeId;
    await window.cue.services.setServiceTheme(activeServiceId, theme.id);
    reloadSvc();
    onThemesChanged?.();
    toast.show({ message: `“${theme.name}” is now this rundown’s theme`, kind: 'success', duration: 6000,
      action: { label: 'Undo', onClick: async () => { await window.cue.services.setServiceTheme(activeServiceId, prev); reloadSvc(); onThemesChanged?.(); } } });
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-md py-sm border-b border-outline-variant/20 flex items-center gap-md flex-wrap shrink-0">
        <div className="flex-1 min-w-[160px] relative">
          <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-[16px]">search</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or mood (serif, video, dark…)"
            className="w-full pl-[30px] pr-sm py-[5px] text-body-sm bg-surface-container-lowest rounded-lg border border-outline-variant/30 text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50" />
        </div>
        <div className="flex items-center gap-[2px] bg-surface-container rounded-lg p-[2px] shrink-0">
          {[['all', 'All'], ['collections', 'Collections'], ['mine', `Your Themes${mineCount ? ` · ${mineCount}` : ''}`],
            ...(favs.size ? [['favorites', `★ ${favs.size}`]] : []),
            ...(activeIds.size ? [['selected', `Selected · ${activeIds.size}`]] : [])].map(([id, label]) => (
            <button key={id} onClick={() => setGroup(id)}
              className={`px-sm py-[3px] text-[10px] font-mono uppercase tracking-[0.04em] rounded transition-colors cursor-pointer ${group === id ? 'bg-primary text-on-primary' : 'text-on-surface-variant/70 hover:text-on-surface'}`}>
              {label}
            </button>
          ))}
        </div>
        {(svcThemeId || defId || songDef || scrDef || slideDef) && (
          <ThemeCascadeBar
            themes={themes}
            rundownThemeId={svcThemeId}
            rundownTitle={svcTitle}
            defaultThemeId={defId}
            songDefaultId={songDef}
            scriptureDefaultId={scrDef}
            slideDefaultId={slideDef}
            onClearRundown={activeServiceId ? async () => {
              await window.cue.services.setServiceTheme(activeServiceId, null);
              reloadSvc();
              onThemesChanged?.();
              toast.success('Rundown theme cleared — defaults now apply');
            } : null}
          />
        )}
        {hasLegacy && (
          <button onClick={() => setShowLegacy((v) => !v)}
            className="shrink-0 text-[10px] font-label-sm uppercase tracking-[0.05em] text-on-surface-variant/60 hover:text-on-surface-variant flex items-center gap-[3px] cursor-pointer">
            <span className="material-symbols-outlined text-[15px]">{showLegacy ? 'visibility_off' : 'history'}</span>
            {showLegacy ? 'Hide legacy' : 'Show legacy'}
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-md custom-scrollbar">
        {sorted.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-sm text-outline-variant px-lg text-center">
            <span className="material-symbols-outlined text-5xl">palette</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">
              {group === 'mine' ? 'No themes of your own yet' : group === 'selected' ? 'No themes enabled yet' : group === 'favorites' ? 'No favorites yet — tap ★ on a theme' : 'No themes'}
            </span>
            {group === 'mine' && (
              <p className="text-body-sm text-on-surface-variant/50 max-w-xs mt-xs">
                Make one in Settings → Theme Library: “Customize” any Collection, or “+ New Theme”.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {sorted.map(({ t }) => (
              <ThemeQuickCard key={t.id} theme={t} bgThumb={bgThumbFor(t)}
                isDefault={t.id === defId} isSongDefault={t.id === songDef} isScriptureDefault={t.id === scrDef} isSlideDefault={t.id === slideDef}
                isRundown={t.id === svcThemeId} isFav={favs.has(Number(t.id))} onDefault={setDefault} onRundown={useForRundown}
                onApplyToItem={onApplyToItem} onToggleFav={() => setFavs(new Set(toggleThemeFav(t.id)))} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
