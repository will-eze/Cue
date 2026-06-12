import React, { useState } from 'react';
import MediaThumb from '../components/MediaThumb';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function MediaCleanup() {
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [unused, setUnused] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function scan() {
    setScanning(true);
    try {
      const rows = await window.cue.media.findUnused();
      setUnused(rows);
      setSelected(new Set(rows.map((r) => r.id)));
      setScanned(true);
      setConfirmDelete(false);
    } finally { setScanning(false); }
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === unused.length ? new Set() : new Set(unused.map((r) => r.id))));
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await window.cue.media.deleteMany([...selected]);
      await scan();
    } finally { setDeleting(false); }
  }

  const selectedBytes = unused.filter((r) => selected.has(r.id)).reduce((sum, r) => sum + (r.size_bytes || 0), 0);

  return (
    <section className="space-y-md">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>cleaning_services</span>
            Unused Media
          </h2>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Find imported images and videos that aren't used as a background, channel logo, theme, or global default.
            Review the list before deleting — files are removed from disk permanently.
          </p>
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="bg-primary-container text-on-primary px-md py-sm rounded-lg text-label-sm font-label-sm font-bold flex items-center gap-xs hover:brightness-110 active:scale-95 transition-all cursor-pointer shrink-0 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[14px]">search</span>
          {scanning ? 'Scanning…' : scanned ? 'Re-scan' : 'Scan'}
        </button>
      </div>

      {scanned && unused.length === 0 && (
        <div className="border-2 border-dashed border-outline-variant/20 rounded-xl py-xl flex flex-col items-center gap-sm text-outline-variant">
          <span className="material-symbols-outlined text-3xl text-tertiary">check_circle</span>
          <span className="text-label-sm font-label-sm uppercase tracking-[0.05em]">No unused media — all clean</span>
        </div>
      )}

      {scanned && unused.length > 0 && (
        <>
          <div className="flex items-center justify-between bg-surface-container border border-outline-variant/30 rounded-lg px-md py-sm">
            <button
              onClick={toggleAll}
              className="text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface cursor-pointer flex items-center gap-xs"
            >
              <span className="material-symbols-outlined text-[16px]">
                {selected.size === unused.length ? 'check_box' : selected.size === 0 ? 'check_box_outline_blank' : 'indeterminate_check_box'}
              </span>
              {selected.size === unused.length ? 'Deselect all' : 'Select all'}
            </button>
            <span className="text-label-sm font-label-sm text-on-surface-variant">
              {unused.length} unused · {selected.size} selected · {formatBytes(selectedBytes)} reclaimable
            </span>
          </div>

          <div className="grid grid-cols-3 gap-sm">
            {unused.map((m) => {
              const sel = selected.has(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  className={`text-left rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${sel ? 'border-error' : 'border-outline-variant/30 hover:border-outline-variant/60'}`}
                >
                  <div className="aspect-video w-full relative bg-surface-container-high">
                    {m.type === 'audio' ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="material-symbols-outlined text-outline-variant text-3xl">music_note</span>
                      </div>
                    ) : (
                      <MediaThumb path={m.path} className="w-full h-full object-cover" />
                    )}
                    <span
                      className={`absolute top-1 right-1 material-symbols-outlined text-[18px] rounded-full ${sel ? 'text-error bg-background' : 'text-outline-variant/60'}`}
                      style={{ fontVariationSettings: sel ? "'FILL' 1" : "'FILL' 0" }}
                    >
                      {sel ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                  </div>
                  <div className="px-sm py-xs">
                    <p className="text-label-sm font-label-sm text-on-surface truncate">{m.filename}</p>
                    <p className="text-[10px] font-mono text-on-surface-variant">{m.type} · {formatBytes(m.size_bytes)}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end">
            {confirmDelete ? (
              <div className="flex items-center gap-sm">
                <span className="text-label-sm font-label-sm text-error">
                  Permanently delete {selected.size} file{selected.size === 1 ? '' : 's'}?
                </span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-error text-on-error px-md py-sm rounded-lg text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface cursor-pointer px-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={selected.size === 0}
                className="bg-error/15 text-error border border-error/40 px-md py-sm rounded-lg text-label-sm font-label-sm font-bold flex items-center gap-xs hover:bg-error/25 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                <span className="material-symbols-outlined text-[14px]">delete</span>
                Delete Selected ({selected.size})
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
