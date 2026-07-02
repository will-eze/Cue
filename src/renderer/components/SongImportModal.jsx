import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalGuard } from '../utils/modalGuard';

const FORMAT_BADGE = {
  OpenLyrics:   'text-primary border-primary/40 bg-primary/10',
  ChordPro:     'text-tertiary border-tertiary/40 bg-tertiary/10',
  EasyWorship:  'text-secondary border-secondary/40 bg-secondary/10',
  GHS:          'text-primary border-primary/40 bg-primary/10',
  Text:         'text-on-surface-variant border-outline-variant/40 bg-surface-container-high',
};

// Preview / confirm step for song import. `preview` is the parseSongFiles result
// (one entry per file). The operator can deselect songs and edit titles before
// committing. Failed files are shown but cannot be selected.
export default function SongImportModal({ preview, onCancel, onImported }) {
  useModalGuard();
  const rows = React.useMemo(
    () => (preview || []).map((p, i) => ({ ...p, _id: i, title: p.title || 'Untitled' })),
    [preview]
  );
  // Selection in state (per-click); titles uncontrolled in a ref so editing a name
  // in a large import (EasyWorship can be 1000s of songs) doesn't re-render every row.
  // Duplicates (already in the library) start unselected.
  const [selected, setSelected] = useState(() => new Set(rows.filter((r) => r.ok && !r.existing).map((r) => r._id)));
  const titlesRef = useRef(Object.fromEntries(rows.map((r) => [r._id, r.title])));
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape' && !committing) onCancel(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel, committing]);

  const okRows      = rows.filter((r) => r.ok);
  const failedCount = rows.length - okRows.length;
  const selCount    = okRows.reduce((n, r) => n + (selected.has(r._id) ? 1 : 0), 0);
  const allSelected = okRows.length > 0 && selCount === okRows.length;

  function toggle(id) {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(okRows.map((r) => r._id)));
  }

  async function handleImport() {
    if (selCount === 0) return;
    setCommitting(true);
    try {
      const payload = okRows.filter((r) => selected.has(r._id)).map((r) => ({
        title: (titlesRef.current[r._id] ?? r.title).trim() || 'Untitled',
        author: r.author,
        copyright: r.copyright,
        sections: r.sections,
        tags: r.tags,
      }));
      const result = await window.cue.songs.importCommit(payload);
      onImported(result.count);
    } finally {
      setCommitting(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={committing ? undefined : onCancel}>
      <div
        className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-2xl max-h-[82vh] flex flex-col shadow-2xl ring-1 ring-white/5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-lg py-md border-b border-outline-variant/20 bg-surface-container-high rounded-t-xl flex-shrink-0 flex items-center justify-between gap-md">
          <div className="flex items-center gap-sm min-w-0">
            <span className="material-symbols-outlined text-primary">library_add</span>
            <div className="min-w-0">
              <h2 className="text-headline-md font-bold text-on-surface tracking-tight">Import Songs</h2>
              <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">
                {okRows.length} parsed{failedCount ? ` · ${failedCount} failed` : ''}
              </p>
            </div>
          </div>
          <button onClick={onCancel} disabled={committing} className="text-on-surface-variant hover:text-on-surface cursor-pointer disabled:opacity-40">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Select-all bar */}
        {okRows.length > 0 && (
          <div className="px-lg py-xs border-b border-outline-variant/20 flex items-center gap-sm flex-shrink-0">
            <label className="flex items-center gap-sm cursor-pointer select-none">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-primary w-4 h-4 cursor-pointer" />
              <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">
                Select all · {selCount}/{okRows.length}
              </span>
            </label>
          </div>
        )}

        {/* Rows */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-lg py-sm space-y-xs min-h-0">
          {rows.length === 0 && (
            <div className="py-xl text-center text-label-sm font-label-sm uppercase tracking-widest text-outline-variant">
              No files selected
            </div>
          )}

          {rows.map((r) => (
            <div
              key={r._id}
              className={`flex items-center gap-md px-md py-sm rounded-lg border transition-colors ${
                r.ok
                  ? selected.has(r._id)
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-outline-variant/30 bg-surface-container'
                  : 'border-error/40 bg-error-container/10'
              }`}
            >
              {r.ok ? (
                <input type="checkbox" checked={selected.has(r._id)} onChange={() => toggle(r._id)} className="accent-primary w-4 h-4 cursor-pointer flex-shrink-0" />
              ) : (
                <span className="material-symbols-outlined text-error text-[18px] flex-shrink-0">error</span>
              )}

              <div className="flex-1 min-w-0">
                {r.ok ? (
                  <input
                    defaultValue={r.title}
                    onChange={(e) => { titlesRef.current[r._id] = e.target.value; }}
                    className="w-full bg-transparent text-body-md text-on-surface font-medium focus:outline-none focus:bg-surface-container-lowest rounded px-xs -mx-xs"
                  />
                ) : (
                  <span className="text-body-md text-on-surface font-medium truncate block">{r.title}</span>
                )}
                <div className="flex items-center gap-sm mt-[2px] text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">
                  <span className="truncate max-w-[160px] text-outline">{r.file}</span>
                  {r.ok ? (
                    <>
                      <span>·</span>
                      <span>{r.sections.length} section{r.sections.length === 1 ? '' : 's'}</span>
                      {r.author && (<><span>·</span><span className="truncate max-w-[140px] normal-case tracking-normal">{r.author}</span></>)}
                      {r.existing && (<><span>·</span><span className="text-tertiary">already imported</span></>)}
                    </>
                  ) : (
                    <span className="text-error normal-case tracking-normal">{r.error}</span>
                  )}
                </div>
              </div>

              {r.ok && (
                <span className={`text-label-sm font-label-sm uppercase tracking-[0.05em] px-sm py-[2px] rounded-full border flex-shrink-0 ${FORMAT_BADGE[r.format] || FORMAT_BADGE.Text}`}>
                  {r.format}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-lg py-md border-t border-outline-variant/20 bg-surface-container-high rounded-b-xl flex-shrink-0 flex items-center justify-end gap-sm">
          <button
            onClick={onCancel}
            disabled={committing}
            className="px-lg py-sm rounded-lg text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant hover:bg-surface-variant transition-colors cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={committing || selCount === 0}
            className="px-lg py-sm rounded-lg text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold bg-tertiary-container text-on-tertiary hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {committing ? 'Importing…' : `Import ${selCount || ''} Song${selCount === 1 ? '' : 's'}`.trim()}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
