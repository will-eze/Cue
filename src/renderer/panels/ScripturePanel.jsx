import React, { useState, useEffect, useCallback, useRef } from 'react';

const INPUT_CLS =
  'bg-surface-container-lowest border border-outline-variant/50 rounded-lg px-sm py-xs ' +
  'text-body-md text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all';

export default function ScripturePanel({ onAdd }) {
  const [versions, setVersions] = useState([]);
  const [versionId, setVersionId] = useState(null);
  const [reference, setReference] = useState('');
  const [versesPerSlide, setVersesPerSlide] = useState(1);
  const [passage, setPassage] = useState(null);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [importing, setImporting] = useState(false);
  const searchDebounce = useRef(null);

  const loadVersions = useCallback(async () => {
    const list = await window.cue.bible.versions();
    setVersions(list);
    setVersionId((cur) => cur ?? (list[0]?.id ?? null));
  }, []);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  const resolve = useCallback(async (ref, vps) => {
    setError('');
    if (!versionId || !ref.trim()) { setPassage(null); return; }
    const p = await window.cue.bible.resolve(versionId, ref.trim(), vps);
    if (!p) { setPassage(null); setError(`Couldn't find "${ref.trim()}" in this translation.`); }
    else setPassage(p);
  }, [versionId]);

  // Re-resolve when verses-per-slide changes and a passage is already shown.
  useEffect(() => {
    if (passage) resolve(passage.reference, versesPerSlide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versesPerSlide]);

  useEffect(() => {
    clearTimeout(searchDebounce.current);
    if (!versionId || !searchQuery.trim()) { setResults([]); return; }
    let cancelled = false;
    searchDebounce.current = setTimeout(async () => {
      const r = await window.cue.bible.search(versionId, searchQuery);
      if (!cancelled) setResults(r); // ignore stale resolves after unmount / version switch
    }, 200);
    return () => { cancelled = true; clearTimeout(searchDebounce.current); };
  }, [searchQuery, versionId]);

  async function handleImport() {
    const result = await window.cue.dialog.openFile({
      filters: [{ name: 'Bible', extensions: ['json', 'xml'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return;
    setImporting(true);
    try {
      const res = await window.cue.bible.importFile(result.filePaths[0], {});
      if (!res.ok) { setError(res.error || 'Import failed.'); return; }
      await loadVersions();
      setVersionId(res.id);
    } finally { setImporting(false); }
  }

  function handleAdd() {
    if (passage && onAdd) onAdd(passage);
  }

  function pickResult(r) {
    const ref = `${r.book_name} ${r.chapter}:${r.verse}`;
    setReference(ref);
    setSearchQuery('');
    setResults([]);
    resolve(ref, versesPerSlide);
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-md text-outline-variant">
        <span className="material-symbols-outlined text-4xl">menu_book</span>
        <span className="text-label-sm font-label-sm uppercase tracking-widest">No Translations Installed</span>
        <p className="text-body-sm text-on-surface-variant max-w-md text-center px-md">
          Import a free Bible translation (JSON or Zefania XML). Try the open JSON sets from
          github.com/thiagobodruk/bible.
        </p>
        <button
          onClick={handleImport}
          disabled={importing}
          className="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center gap-xs disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">upload</span>
          {importing ? 'Importing…' : 'Import Translation'}
        </button>
        {error && <p className="text-body-sm text-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* Controls column */}
      <div className="w-80 border-r border-outline-variant/30 flex flex-col gap-md p-md shrink-0 overflow-y-auto">
        {/* Version */}
        <div className="space-y-xs">
          <label className="text-[10px] font-label-sm text-on-surface-variant uppercase tracking-[0.06em]">Translation</label>
          <select
            value={versionId ?? ''}
            onChange={(e) => { setVersionId(Number(e.target.value)); setPassage(null); }}
            className={`${INPUT_CLS} w-full cursor-pointer`}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>{v.name} ({v.abbrev})</option>
            ))}
          </select>
        </div>

        {/* Reference entry */}
        <div className="space-y-xs">
          <label className="text-[10px] font-label-sm text-on-surface-variant uppercase tracking-[0.06em]">Reference</label>
          <div className="flex gap-xs">
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') resolve(reference, versesPerSlide); }}
              placeholder="e.g. John 3:16-18"
              className={`${INPUT_CLS} flex-1 min-w-0`}
            />
            <button
              onClick={() => resolve(reference, versesPerSlide)}
              className="shrink-0 px-md bg-primary-container text-on-primary rounded-lg text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            >
              Go
            </button>
          </div>
        </div>

        {/* Verses per slide */}
        <div className="space-y-xs">
          <label className="text-[10px] font-label-sm text-on-surface-variant uppercase tracking-[0.06em]">Verses per slide</label>
          <div className="flex gap-xs">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setVersesPerSlide(n)}
                className={`flex-1 py-xs rounded-lg text-label-sm font-label-sm border transition-colors cursor-pointer ${
                  versesPerSlide === n
                    ? 'bg-primary/15 border-primary/50 text-primary'
                    : 'bg-surface-container border-outline-variant/30 text-on-surface-variant hover:border-outline-variant'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="space-y-xs">
          <label className="text-[10px] font-label-sm text-on-surface-variant uppercase tracking-[0.06em]">Search verses</label>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Find a phrase…"
            className={`${INPUT_CLS} w-full`}
          />
          {results.length > 0 && (
            <div className="mt-xs max-h-48 overflow-y-auto rounded-lg border border-outline-variant/30 divide-y divide-outline-variant/20">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => pickResult(r)}
                  className="block w-full text-left px-sm py-xs hover:bg-surface-variant transition-colors cursor-pointer"
                >
                  <span className="text-[10px] font-label-sm text-primary uppercase tracking-wider">
                    {r.book_name} {r.chapter}:{r.verse}
                  </span>
                  <p className="text-body-sm text-on-surface-variant line-clamp-2">{r.text}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-body-sm text-error">{error}</p>}
      </div>

      {/* Preview column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {passage ? (
          <>
            <div className="flex items-center justify-between px-md py-sm border-b border-outline-variant/20 shrink-0">
              <div>
                <h3 className="text-body-md font-semibold text-on-surface">{passage.reference}</h3>
                <p className="text-[10px] font-label-sm text-on-surface-variant uppercase tracking-wider">
                  {passage.versionName} · {passage.verses.length} verse{passage.verses.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={handleAdd}
                className="bg-tertiary-container text-on-tertiary px-md py-sm rounded-lg text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center gap-xs"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add to Rundown
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-md space-y-sm">
              {passage.verses.map((v) => (
                <p key={`${v.chapter}:${v.verse}`} className="text-body-md text-on-surface leading-relaxed">
                  <sup className="text-primary font-label-sm mr-xs">{v.verse}</sup>
                  {v.text}
                </p>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-sm text-outline-variant">
            <span className="material-symbols-outlined text-4xl">menu_book</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">
              Enter a Reference
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
