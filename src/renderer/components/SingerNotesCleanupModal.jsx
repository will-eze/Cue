import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalGuard } from '../utils/modalGuard';

// Library tool: find songs whose lyrics still carry choir annotations from before
// the lyrics parser handled them ("Solo - Tammi", "All:", "Tammi: …"), show exactly
// what would be removed, and clean the ticked songs. Nothing is written until Apply.
export default function SingerNotesCleanupModal({ onClose, onDone }) {
  useModalGuard();
  const [rows, setRows] = useState(null);   // null = scanning
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    window.cue.songs.scanSingerNotes()
      .then((r) => { const list = Array.isArray(r) ? r : []; setRows(list); setPicked(new Set(list.map((x) => x.id))); })
      .catch((e) => { setRows([]); setError(e?.message || 'Could not scan the library.'); });
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function apply() {
    if (!picked.size) return;
    setBusy(true); setError(null);
    try {
      const res = await window.cue.songs.applySingerNotes([...picked]);
      onDone?.(res?.changed ?? picked.size);
    } catch (e) {
      setError(e?.message || 'Cleanup failed.');
      setBusy(false);
    }
  }

  const toggle = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return createPortal(
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-lg py-md border-b border-outline-variant/20 flex items-center justify-between gap-md">
          <div className="min-w-0">
            <h2 className="text-headline-md font-semibold text-on-surface">Clean up singer notes</h2>
            <p className="text-body-md text-on-surface-variant">
              Removes lines like “Solo - Tammi” or “All:” and names before lyrics (“Tammi: …”) from songs already in your library.
            </p>
          </div>
          <button onClick={onClose} disabled={busy} className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-variant cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-md space-y-xs min-h-[120px]">
          {rows === null && <p className="p-md text-body-md text-on-surface-variant">Checking your songs…</p>}
          {rows && rows.length === 0 && !error && (
            <p className="p-md text-body-md text-on-surface-variant">Nothing to clean — no singer notes found in your songs.</p>
          )}
          {rows && rows.map((r) => (
            <label key={r.id} className="flex items-start gap-md px-md py-sm rounded-lg border border-outline-variant/20 hover:border-outline-variant/50 cursor-pointer">
              <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="accent-primary w-4 h-4 mt-[3px] shrink-0" />
              <div className="min-w-0">
                <p className="text-body-md text-on-surface font-medium truncate">{r.title}</p>
                <p className="text-[13px] text-on-surface-variant">
                  Removes: {r.removed.map((x, i) => (
                    <span key={i} className="line-through decoration-error/70 mr-sm">{x}</span>
                  ))}
                </p>
              </div>
            </label>
          ))}
          {error && <p className="px-md py-sm text-body-md text-error">{error}</p>}
        </div>

        <div className="px-lg py-md border-t border-outline-variant/20 flex items-center justify-end gap-sm">
          <button onClick={onClose} disabled={busy} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={busy || !picked.size}
            className="btn btn-go"
          >
            {busy ? 'Cleaning…' : `Clean ${picked.size} song${picked.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
