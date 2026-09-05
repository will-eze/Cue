import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '../components/Toast';
import { injectUserFontFaces } from '../utils/fonts';

const BUNDLED = window.cue.fonts.list;
const SAMPLE = 'The quick brown fox 0123';

// Only the woff2 families we ship (not the system-font fallback entries) belong in
// the curated library alongside the downloadable ones.
const BUNDLED_SHIPPED = BUNDLED.filter((f) => f.bundled);

const CAT_LABEL = { 'sans-serif': 'Sans', serif: 'Serif', slab: 'Slab', display: 'Display', script: 'Script', monospace: 'Mono' };
const CAT_ORDER = ['sans-serif', 'serif', 'slab', 'display', 'script', 'monospace'];
const FALLBACK = {
  'sans-serif': 'system-ui, sans-serif', serif: 'Georgia, serif', slab: 'Georgia, serif',
  display: 'Impact, system-ui, sans-serif', script: 'cursive', monospace: 'monospace',
};

export default function FontSettings() {
  const toast = useToast();
  const [userFonts, setUserFonts] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [downloading, setDownloading] = useState(() => new Set());
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('all');
  // Favourites pin to the top — a per-viewer convenience, so localStorage is right.
  const [favs, setFavs] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('cue_font_favs') || '[]')); } catch { return new Set(); }
  });
  const toggleFav = (family) => setFavs((prev) => {
    const next = new Set(prev);
    next.has(family) ? next.delete(family) : next.add(family);
    try { localStorage.setItem('cue_font_favs', JSON.stringify([...next])); } catch { /* private mode */ }
    return next;
  });

  const [previewFams, setPreviewFams] = useState(() => new Set());
  function loadUser() { window.cue.fonts.listUser().then((l) => setUserFonts(l || [])); }
  function loadCatalog() { window.cue.fonts.catalog().then((l) => setCatalog(l || [])).catch(() => {}); }
  useEffect(() => {
    loadUser(); loadCatalog();
    // Preview faces let uninstalled fonts render in their own typeface before download.
    window.cue.fonts.previewCss?.().then((r) => {
      if (!r?.css) return;
      let el = document.getElementById('cue-font-previews');
      if (!el) { el = document.createElement('style'); el.id = 'cue-font-previews'; document.head.appendChild(el); }
      el.textContent = r.css;
      setPreviewFams(new Set(r.families || []));
    }).catch(() => {});
  }, []);

  async function handleImport() {
    setBusy(true);
    try {
      const res = await window.cue.fonts.import();
      if (res?.canceled) return;
      await injectUserFontFaces();
      loadUser();
      toast.success(res?.errors?.length
        ? `${res.added?.length || 0} installed · ${res.errors.length} skipped (unsupported)`
        : `${res?.added?.length || 0} font${(res?.added?.length || 0) === 1 ? '' : 's'} installed`);
    } finally { setBusy(false); }
  }

  async function handleDeleteUser(id) {
    await window.cue.fonts.delete(id);
    setConfirmId(null);
    await injectUserFontFaces();
    loadUser();
    toast.success('Font removed');
  }

  async function handleDownload(family) {
    setDownloading((s) => new Set(s).add(family));
    try {
      const r = await window.cue.fonts.download(family);
      if (r?.ok) {
        await injectUserFontFaces();
        loadCatalog();
        toast.success(`“${family}” installed`);
      } else {
        toast.error(r?.error || `Couldn’t download “${family}”`);
      }
    } catch {
      toast.error(`Couldn’t download “${family}”`);
    } finally {
      setDownloading((s) => { const n = new Set(s); n.delete(family); return n; });
    }
  }

  async function handleRemoveLibrary(family) {
    await window.cue.fonts.deleteLibrary(family);
    await injectUserFontFaces();
    loadCatalog();
    toast.success(`“${family}” removed`);
  }

  // Merge shipped built-ins + the downloadable catalog into one browsable list.
  const rows = useMemo(() => {
    const merged = [
      ...BUNDLED_SHIPPED.map((f) => ({ family: f.family, category: f.category, state: 'builtin' })),
      ...catalog.map((f) => ({ family: f.family, category: f.category, state: f.downloaded ? 'downloaded' : 'available', weights: f.weights })),
    ];
    const q = query.trim().toLowerCase();
    return merged
      .filter((f) => (cat === 'all' || f.category === cat) && (!q || f.family.toLowerCase().includes(q)))
      // Favourites first, then alphabetical.
      .sort((a, b) => (favs.has(b.family) - favs.has(a.family)) || a.family.localeCompare(b.family));
  }, [catalog, query, cat, favs]);

  const categories = useMemo(() => {
    const present = new Set([...BUNDLED_SHIPPED, ...catalog].map((f) => f.category));
    return CAT_ORDER.filter((c) => present.has(c));
  }, [catalog]);

  const installedCount = BUNDLED_SHIPPED.length + catalog.filter((f) => f.downloaded).length;

  return (
    <section className="space-y-md">
      <div className="flex items-center justify-between gap-md">
        <div>
          <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>font_download</span>
            Fonts
          </h2>
          <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
            Download from the font library or install your own (.woff2, .woff, .ttf, .otf). Every font appears in all text editors and renders on screen + NDI output.
          </p>
        </div>
        <button
          onClick={handleImport}
          disabled={busy}
          className="px-md py-xs text-label-sm font-label-sm font-bold bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:border-outline-variant active:scale-95 transition-all cursor-pointer rounded-lg uppercase tracking-[0.05em] whitespace-nowrap disabled:opacity-40 flex items-center gap-xs"
        >
          <span className="material-symbols-outlined text-[16px]">upload_file</span>
          {busy ? 'Installing…' : 'Install your own'}
        </button>
      </div>

      {/* ── Font library (browse + download) ─────────────────────────────── */}
      <div className="bg-surface-container rounded-xl border border-outline-variant/20 overflow-hidden">
        <div className="px-lg py-sm border-b border-outline-variant/20 bg-surface-container-high flex items-center gap-md flex-wrap">
          <span className="text-label-sm font-label-sm uppercase tracking-[0.06em] text-on-surface-variant shrink-0">
            Font library · {installedCount} installed
          </span>
          <div className="flex-1 min-w-[160px] relative">
            <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-[16px]">search</span>
            <input
              value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search fonts…"
              className="w-full pl-[30px] pr-sm py-[5px] text-body-sm bg-surface-container-lowest rounded-lg border border-outline-variant/30 text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50"
            />
          </div>
        </div>

        {/* Category filter */}
        <div className="px-lg py-sm border-b border-outline-variant/10 flex items-center gap-xs flex-wrap">
          {['all', ...categories].map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`px-md py-[3px] text-label-sm font-label-sm uppercase tracking-[0.05em] rounded-lg border transition-colors cursor-pointer ${cat === c ? 'bg-primary/15 border-primary/40 text-primary' : 'border-outline-variant/30 text-on-surface-variant hover:text-on-surface'}`}>
              {c === 'all' ? 'All' : (CAT_LABEL[c] || c)}
            </button>
          ))}
        </div>

        {/* Rows */}
        <div className="max-h-[460px] overflow-y-auto custom-scrollbar">
          {rows.length === 0 ? (
            <div className="px-lg py-lg text-center text-body-sm text-on-surface-variant/60">No fonts match.</div>
          ) : rows.map((f) => {
            const installed = f.state === 'builtin' || f.state === 'downloaded';
            const isDownloading = downloading.has(f.family);
            return (
              <div key={f.family} className="flex items-center gap-md px-lg py-sm border-b border-outline-variant/10 last:border-b-0">
                <div className="flex-1 min-w-0">
                  <div className="text-[24px] leading-tight text-on-surface truncate"
                    style={{ fontFamily: installed ? `'${f.family}', ${FALLBACK[f.category] || 'sans-serif'}`
                      : previewFams.has(f.family) ? `'${f.family} Preview', ${FALLBACK[f.category] || 'sans-serif'}`
                      : (FALLBACK[f.category] || 'sans-serif') }}>
                    {f.family}
                  </div>
                  <div className="flex items-center gap-sm mt-[1px]">
                    <span className="text-[9px] font-label-sm uppercase tracking-[0.06em] border border-outline-variant/30 rounded px-xs text-on-surface-variant/70">{CAT_LABEL[f.category] || f.category}</span>
                    {f.weights > 1 && <span className="text-[9px] font-label-sm uppercase tracking-[0.06em] border border-outline-variant/30 rounded px-xs text-on-surface-variant/70">{f.weights} weights</span>}
                    {!installed && <span className="text-[10px] text-on-surface-variant/40">{SAMPLE}</span>}
                  </div>
                </div>

                {/* Favourite — pin to top (per-viewer, localStorage) */}
                <button onClick={() => toggleFav(f.family)} title={favs.has(f.family) ? 'Unpin' : 'Pin to top'}
                  className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${favs.has(f.family) ? 'text-primary' : 'text-on-surface-variant/30 hover:text-on-surface-variant'}`}>
                  <span className="material-symbols-outlined text-[16px]" style={favs.has(f.family) ? { fontVariationSettings: "'FILL' 1" } : undefined}>star</span>
                </button>

                {/* Right affordance */}
                {f.state === 'builtin' ? (
                  <span className="shrink-0 text-[9px] font-label-sm uppercase tracking-[0.06em] text-on-surface-variant/50 border border-outline-variant/25 rounded px-sm py-[3px]">Built-in</span>
                ) : f.state === 'downloaded' ? (
                  <div className="shrink-0 flex items-center gap-sm">
                    <span className="text-[10px] font-label-sm uppercase tracking-[0.05em] text-tertiary flex items-center gap-[3px]">
                      <span className="material-symbols-outlined text-[15px]">check_circle</span>Installed
                    </span>
                    <button onClick={() => handleRemoveLibrary(f.family)} title="Remove"
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-on-surface-variant/40 hover:text-error hover:bg-error-container/20 transition-colors cursor-pointer">
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                ) : (
                  <button onClick={() => handleDownload(f.family)} disabled={isDownloading} title="Download font"
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-primary hover:bg-primary/15 transition-colors cursor-pointer disabled:cursor-default">
                    <span className={`material-symbols-outlined text-[20px] ${isDownloading ? 'animate-spin' : ''}`}>
                      {isDownloading ? 'progress_activity' : 'download'}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── My imported fonts ────────────────────────────────────────────── */}
      {userFonts.length > 0 && (
        <div className="bg-surface-container rounded-xl border border-outline-variant/20 overflow-hidden">
          <div className="px-lg py-sm border-b border-outline-variant/20 bg-surface-container-high">
            <span className="text-label-sm font-label-sm uppercase tracking-[0.06em] text-on-surface-variant">My fonts · {userFonts.length}</span>
          </div>
          {userFonts.map((f) => (
            <div key={f.id} className="flex items-center gap-md px-lg py-sm border-b border-outline-variant/10 last:border-b-0">
              <div className="flex-1 min-w-0">
                <div className="text-[24px] leading-tight text-on-surface truncate" style={{ fontFamily: f.family }}>{SAMPLE}</div>
                <div className="flex items-center gap-sm mt-[1px]">
                  <span className="text-body-sm font-semibold text-on-surface">{f.family}</span>
                  <span className="text-[10px] font-label-sm uppercase tracking-[0.05em] border border-outline-variant/30 rounded px-xs text-on-surface-variant">.{f.ext}</span>
                </div>
              </div>
              {confirmId === f.id ? (
                <div className="flex items-center gap-sm shrink-0">
                  <button onClick={() => handleDeleteUser(f.id)}
                    className="px-md py-xs text-label-sm font-label-sm font-bold bg-error-container text-error rounded-lg border border-error/40 hover:brightness-110 cursor-pointer uppercase tracking-[0.05em]">Remove</button>
                  <button onClick={() => setConfirmId(null)}
                    className="px-md py-xs text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface bg-surface-container-high border border-outline-variant/30 rounded-lg cursor-pointer uppercase tracking-[0.05em]">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(f.id)} title="Remove font"
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/50 hover:text-error hover:bg-error-container/20 transition-colors cursor-pointer">
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
