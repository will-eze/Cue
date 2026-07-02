import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useModalGuard } from '../utils/modalGuard';

// Browse + download Bible translations from the online catalog (getbible.net v2).
// Multi-select, then download → import into the library. Licence responsibility
// rests with the operator: the warning is shown but no version is blocked.

export default function OnlineBibleModal({ onClose, onImported }) {
  useModalGuard();
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [progress, setProgress] = useState(null); // { done, total, current } | null
  const [failures, setFailures] = useState([]);

  useEffect(() => {
    (async () => {
      const res = await window.cue.bible.onlineList();
      if (!res.ok) { setError(res.error || 'Could not reach the online catalog.'); setLoading(false); return; }
      setVersions(res.versions);
      setLoading(false);
    })();
  }, []);

  // Escape to close (unless mid-download).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !progress) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, progress]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return versions;
    return versions.filter((v) =>
      `${v.name} ${v.abbrev} ${v.language} ${v.license}`.toLowerCase().includes(q));
  }, [versions, query]);

  function toggle(abbrev) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(abbrev) ? next.delete(abbrev) : next.add(abbrev);
      return next;
    });
  }

  async function handleDownload() {
    const list = [...selected];
    if (!list.length) return;
    setFailures([]);
    const errs = [];
    for (let i = 0; i < list.length; i++) {
      const v = versions.find((x) => x.abbrev === list[i]);
      setProgress({ done: i, total: list.length, current: v?.name || list[i] });
      const res = await window.cue.bible.onlineDownload(list[i]);
      if (!res.ok) errs.push(`${v?.name || list[i]}: ${res.error}`);
    }
    setProgress({ done: list.length, total: list.length, current: '' });
    onImported?.();
    if (errs.length) { setFailures(errs); setProgress(null); setSelected(new Set()); }
    else onClose();
  }

  const selectedCount = selected.size;

  return createPortal(
    <div className="fixed inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl ring-1 ring-white/5 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-md px-lg py-sm border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <span className="material-symbols-outlined text-primary text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>cloud_download</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-headline-md font-bold text-primary leading-tight tracking-tight">Import from Online</h2>
            <p className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">getbible.net catalog</p>
          </div>
          <button onClick={() => !progress && onClose()}
            className="w-7 h-7 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer text-sm">
            ✕
          </button>
        </div>

        {/* Licence warning */}
        <div className="flex items-start gap-sm px-lg py-sm border-b border-outline-variant/20 bg-secondary-container/10 flex-shrink-0">
          <span className="material-symbols-outlined text-secondary text-[18px] mt-[1px]">gpp_maybe</span>
          <p className="text-body-sm text-on-surface-variant leading-snug">
            Some translations are <span className="text-secondary">copyrighted</span> and require a licence to use or
            redistribute. Downloading does not grant any rights — <span className="text-on-surface">you are responsible</span> for
            ensuring you have permission to use each translation. Public-domain versions are free to use.
          </p>
        </div>

        {/* What's available here */}
        <div className="flex items-start gap-sm px-lg py-sm border-b border-outline-variant/20 flex-shrink-0">
          <span className="material-symbols-outlined text-on-surface-variant/60 text-[18px] mt-[1px]">info</span>
          <p className="text-body-sm text-on-surface-variant/80 leading-snug">
            This catalog only carries public-domain &amp; freely-licensed translations. Heavily licensed
            versions such as <span className="text-on-surface">ESV, NIV, NKJV, NLT and NASB</span> are not
            distributed here. If you hold a licence for one, add it with
            <span className="text-on-surface"> Import&nbsp;from&nbsp;File</span> (JSON or Zefania XML).
          </p>
        </div>

        {/* Search */}
        <div className="px-lg py-sm border-b border-outline-variant/20 flex-shrink-0">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant text-[16px]">search</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, abbreviation or language…"
              className="w-full bg-surface-container-lowest border border-outline-variant/50 rounded-lg pl-xl pr-md py-1.5 text-body-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center h-full text-label-sm font-label-sm text-on-surface-variant uppercase tracking-widest">Loading catalog…</div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-sm text-on-surface-variant px-lg text-center">
              <span className="material-symbols-outlined text-3xl text-error">cloud_off</span>
              <p className="text-body-sm text-error">{error}</p>
            </div>
          ) : (
            filtered.map((v) => {
              const isSel = selected.has(v.abbrev);
              return (
                <button
                  key={v.abbrev}
                  disabled={v.installed}
                  onClick={() => toggle(v.abbrev)}
                  className={`w-full flex items-center gap-md px-lg py-sm border-b border-outline-variant/15 text-left transition-colors ${
                    v.installed ? 'opacity-50 cursor-default' : 'cursor-pointer hover:bg-surface-variant/40'
                  } ${isSel ? 'bg-primary/10' : ''}`}
                >
                  <span className={`material-symbols-outlined text-[18px] shrink-0 ${isSel ? 'text-primary' : 'text-outline-variant'}`}>
                    {v.installed ? 'check_circle' : isSel ? 'check_box' : 'check_box_outline_blank'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-sm">
                      <span className="text-body-md text-on-surface truncate">{v.name}</span>
                      <span className="text-[9px] font-mono uppercase tracking-[0.05em] text-on-surface-variant/60 shrink-0">{v.abbrev}</span>
                    </div>
                    <div className="flex items-center gap-xs mt-[1px]">
                      <span className="text-[10px] text-on-surface-variant/60">{v.language}</span>
                      <span className="text-on-surface-variant/30 text-[10px]">·</span>
                      <span className={`text-[10px] ${v.restricted ? 'text-secondary' : 'text-tertiary/80'}`}>{v.license}</span>
                    </div>
                  </div>
                  {v.installed && (
                    <span className="text-[9px] font-mono uppercase tracking-[0.05em] text-tertiary shrink-0">Installed</span>
                  )}
                  {!v.installed && v.restricted && (
                    <span className="text-[9px] font-mono uppercase tracking-[0.04em] text-secondary border border-secondary/40 rounded px-1.5 py-[1px] shrink-0">Licence req.</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Failures */}
        {failures.length > 0 && (
          <div className="px-lg py-sm border-t border-outline-variant/20 bg-error-container/10 flex-shrink-0 max-h-24 overflow-y-auto">
            {failures.map((f, i) => <p key={i} className="text-body-sm text-error">{f}</p>)}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-lg py-sm border-t border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <span className="text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-[0.05em]">
            {progress
              ? `Downloading ${progress.done}/${progress.total}${progress.current ? ` · ${progress.current}` : ''}…`
              : `${selectedCount} selected`}
          </span>
          <div className="flex items-center gap-sm">
            <button onClick={() => !progress && onClose()} disabled={!!progress}
              className="px-lg h-8 text-label-sm font-mono text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-variant transition-colors cursor-pointer uppercase tracking-[0.05em] disabled:opacity-40">
              {failures.length ? 'Close' : 'Cancel'}
            </button>
            <button onClick={handleDownload} disabled={!selectedCount || !!progress}
              className="px-lg h-8 text-label-sm font-mono bg-tertiary-container text-on-tertiary-container disabled:opacity-40 rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em] hover:opacity-90 flex items-center gap-xs">
              <span className="material-symbols-outlined text-[16px]">cloud_download</span>
              {progress ? 'Downloading…' : `Download${selectedCount ? ` (${selectedCount})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
