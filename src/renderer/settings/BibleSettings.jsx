import React, { useState, useEffect, useCallback } from 'react';
import ContextMenu from '../components/ContextMenu';
import OnlineBibleModal from '../components/OnlineBibleModal';

export default function BibleSettings() {
  const [versions, setVersions] = useState([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [importMenu, setImportMenu] = useState(null);
  const [showOnline, setShowOnline] = useState(false);

  const load = useCallback(async () => {
    setVersions(await window.cue.bible.versions());
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleImport() {
    setError('');
    const result = await window.cue.dialog.openFile({
      filters: [{ name: 'Bible', extensions: ['json', 'xml'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return;
    setImporting(true);
    try {
      const res = await window.cue.bible.importFile(result.filePaths[0], {});
      if (!res.ok) setError(res.error || 'Import failed.');
      else await load();
    } finally { setImporting(false); }
  }

  async function handleDelete(id) {
    await window.cue.bible.delete(id);
    setConfirmDelete(null);
    load();
  }

  return (
    <section className="space-y-md">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
              menu_book
            </span>
            Bible Translations
          </h2>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Import Bible translations as JSON or Zefania XML. Free open translations are available at
            github.com/thiagobodruk/bible.
          </p>
        </div>
        <button
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setImportMenu({ x: r.right - 200, y: r.bottom + 4 }); }}
          disabled={importing}
          className="bg-primary-container text-on-primary px-md py-sm rounded-lg text-label-sm font-label-sm font-bold flex items-center gap-xs hover:brightness-110 active:scale-95 transition-all cursor-pointer shrink-0 disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[14px]">upload</span>
          {importing ? 'Importing…' : 'Import Translation'}
        </button>
      </div>

      {importMenu && (
        <ContextMenu
          x={importMenu.x} y={importMenu.y}
          onClose={() => setImportMenu(null)}
          items={[
            { label: 'Import from Online', onClick: () => { setImportMenu(null); setShowOnline(true); } },
            { label: 'Import from File', onClick: () => { setImportMenu(null); handleImport(); } },
          ]}
        />
      )}

      {showOnline && (
        <OnlineBibleModal onClose={() => setShowOnline(false)} onImported={load} />
      )}

      {error && (
        <div className="bg-error-container/20 border border-error/30 rounded-lg px-md py-sm text-body-sm text-error">
          {error}
        </div>
      )}

      {versions.length === 0 ? (
        <div className="border-2 border-dashed border-outline-variant/20 rounded-xl py-xl flex flex-col items-center gap-sm text-outline-variant">
          <span className="material-symbols-outlined text-3xl">menu_book</span>
          <span className="text-label-sm font-label-sm uppercase tracking-[0.05em]">No translations installed</span>
        </div>
      ) : (
        <div className="space-y-sm">
          {versions.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-md bg-surface-container-low border border-outline-variant/30 rounded-xl px-md py-sm"
            >
              <span className="material-symbols-outlined text-on-surface-variant">menu_book</span>
              <div className="flex-1 min-w-0">
                <p className="text-body-md font-semibold text-on-surface truncate">{v.name}</p>
                <p className="text-label-sm font-label-sm text-on-surface-variant">
                  {v.abbrev}{v.language ? ` · ${v.language}` : ''} · {v.verse_count?.toLocaleString() ?? 0} verses
                </p>
              </div>
              {confirmDelete === v.id ? (
                <div className="flex items-center gap-sm shrink-0">
                  <span className="text-[10px] font-mono text-error uppercase tracking-[0.04em]">Delete?</span>
                  <button
                    onClick={() => handleDelete(v.id)}
                    className="text-[10px] font-mono text-error hover:text-error/70 cursor-pointer uppercase tracking-[0.04em] border border-error/40 px-sm py-[2px] rounded transition-colors"
                  >Yes</button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.04em]"
                  >No</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(v.id)}
                  className="shrink-0 text-on-surface-variant hover:text-error cursor-pointer transition-colors p-xs rounded hover:bg-error/10"
                  title="Delete translation"
                >
                  <span className="material-symbols-outlined text-[15px]">delete</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
