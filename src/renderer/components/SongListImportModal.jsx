import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import SongEditor from './SongEditor';
import { useModalGuard } from '../utils/modalGuard';

const CONFIDENCE_META = {
  exact: { icon: 'check_circle', cls: 'text-tertiary', label: 'Exact' },
  high:  { icon: 'check_circle', cls: 'text-primary',  label: 'Match' },
  low:   { icon: 'warning',      cls: 'text-yellow-400', label: 'Fuzzy' },
  none:  { icon: 'cancel',       cls: 'text-error',    label: 'Not Found' },
};

// A single library song the operator can preview or pick — used both for the
// matched/alternate list and for live search-to-replace results.
function SongOption({ song, current, onPick, onPreview, isPreviewing }) {
  return (
    <div className={`w-full flex items-center gap-sm px-md py-sm text-left transition-colors ${
      isPreviewing ? 'bg-primary/10' : 'hover:bg-surface-variant'
    }`}>
      <button onClick={() => onPick(song)} className="flex items-center gap-sm min-w-0 flex-1 cursor-pointer text-left">
        <span className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0">music_note</span>
        <span className="text-body-md text-on-surface truncate">{song.title}</span>
        {song.author && <span className="text-label-sm font-label-sm text-on-surface-variant truncate">— {song.author}</span>}
        {current && <span className="ml-auto text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em] shrink-0">current</span>}
      </button>
      <button
        onClick={() => onPreview(song)}
        title="Preview lyrics"
        className={`shrink-0 cursor-pointer transition-colors ${isPreviewing ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
      >
        <span className="material-symbols-outlined text-[16px]">visibility</span>
      </button>
    </div>
  );
}

function ResultRow({ row, onChange, onPreview, onCreate, previewId }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const pickerRef = useRef(null);
  const searchRef = useRef(null);
  // A manual override (picked or just-created) is trusted regardless of the
  // original match confidence, so it gets its own "Chosen" badge.
  const overridden = !!row.override;
  const meta = overridden
    ? { icon: 'check_circle', cls: 'text-tertiary', label: 'Chosen' }
    : CONFIDENCE_META[row.confidence];

  // Close the picker on an outside click (only while it's open).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => { if (open) setTimeout(() => searchRef.current?.focus(), 0); }, [open]);

  // Debounced library search for the replace-with picker.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const hits = await window.cue.songs.search(term);
        setResults(Array.isArray(hits) ? hits.slice(0, 12) : []);
      } catch { setResults([]); }
      setSearching(false);
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const effective = row.override ?? row.match;

  function pick(song) {
    onChange({ ...row, override: song, selected: true });
    onPreview(song);
    setOpen(false);
    setQ('');
  }
  function clearOverride() {
    onChange({ ...row, override: null, selected: row.confidence !== 'none' });
    setOpen(false);
    setQ('');
  }
  function create() {
    // Hand the new-song flow a title (the typed search, or the pasted line) and the
    // pasted line as a starting verse; apply the saved song back onto this row.
    onCreate({
      title: q.trim() || row.input,
      text: row.input,
      apply: (song) => onChange({ ...row, override: song, selected: true }),
    });
    setOpen(false);
    setQ('');
  }

  return (
    <div ref={pickerRef} className={`flex items-center gap-md px-md py-sm rounded-lg border transition-colors ${
      previewId && effective && previewId === effective.id
        ? 'border-primary/60 bg-primary/10'
        : row.selected
          ? 'border-primary/40 bg-primary/5'
          : 'border-outline-variant/30 bg-surface-container'
    }`}>
      {/* Select toggle */}
      <input
        type="checkbox"
        checked={!!row.selected}
        disabled={!effective}
        onChange={(e) => onChange({ ...row, selected: e.target.checked })}
        className="accent-primary w-4 h-4 cursor-pointer flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
      />

      {/* Input snippet (title or lyric line the operator pasted) */}
      <div className="flex-1 min-w-0 basis-0">
        <p className="text-body-md text-on-surface font-medium truncate" title={row.input}>{row.input}</p>
      </div>

      {/* Arrow */}
      <span className="material-symbols-outlined text-outline-variant text-[16px] shrink-0">arrow_forward</span>

      {/* Matched song — click to preview */}
      <div className="flex-1 min-w-0 basis-0">
        {effective ? (
          <button
            onClick={() => onPreview(effective)}
            title="Preview lyrics"
            className="flex items-center gap-sm min-w-0 w-full cursor-pointer text-left group/match"
          >
            <span className={`material-symbols-outlined text-[16px] shrink-0 ${meta.cls}`}>{meta.icon}</span>
            <span className="text-body-md text-on-surface truncate group-hover/match:underline">{effective.title}</span>
            {effective.author && (
              <span className="text-label-sm font-label-sm text-on-surface-variant truncate hidden lg:block">— {effective.author}</span>
            )}
          </button>
        ) : (
          <div className="flex items-center gap-sm">
            <span className={`material-symbols-outlined text-[16px] shrink-0 ${meta.cls}`}>{meta.icon}</span>
            <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Not Found</span>
          </div>
        )}
      </div>

      {/* Confidence badge */}
      <span className={`shrink-0 text-label-sm font-label-sm uppercase tracking-[0.05em] px-sm py-[2px] rounded-full border ${
        overridden || row.confidence === 'exact' ? 'text-tertiary border-tertiary/40 bg-tertiary/10'
        : row.confidence === 'high' ? 'text-primary border-primary/40 bg-primary/10'
        : row.confidence === 'low'  ? 'text-yellow-400 border-yellow-400/40 bg-yellow-400/10'
        : 'text-error border-error/40 bg-error/10'
      }`}>
        {meta.label}
      </span>

      {/* Replace / pick-different toggle (available on every row) */}
      <div className="relative shrink-0">
        <button
          onClick={() => setOpen((o) => !o)}
          title="Search for a different song"
          className={`cursor-pointer transition-colors ${open ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
        >
          <span className="material-symbols-outlined text-[18px]">search</span>
        </button>

        {open && (
          <div className="absolute right-0 mt-xs w-80 bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl ring-1 ring-white/5 z-50 flex flex-col max-h-96">
            {/* Search field */}
            <div className="p-sm border-b border-outline-variant/20 shrink-0">
              <div className="flex items-center gap-sm bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-sm focus-within:border-primary/60">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant">search</span>
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search the library…"
                  className="flex-1 bg-transparent py-sm text-body-md text-on-surface focus:outline-none placeholder:text-on-surface-variant/40"
                />
                {q && (
                  <button onClick={() => setQ('')} className="text-on-surface-variant hover:text-on-surface cursor-pointer">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-y-auto custom-scrollbar py-xs">
              {q.trim() ? (
                <>
                  {searching && (
                    <div className="px-md py-sm text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Searching…</div>
                  )}
                  {!searching && results.length === 0 && (
                    <div className="px-md py-sm text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline-variant">No songs found</div>
                  )}
                  {results.map((s) => (
                    <SongOption key={s.id} song={s} onPick={pick} onPreview={onPreview} isPreviewing={previewId === s.id} />
                  ))}
                </>
              ) : (
                <>
                  {effective && (
                    <SongOption song={effective} current onPick={clearOverride} onPreview={onPreview} isPreviewing={previewId === effective.id} />
                  )}
                  {row.alternates.length > 0 && (
                    <div className="px-md pt-sm pb-xs text-label-sm font-label-sm uppercase tracking-[0.08em] text-outline-variant">Other matches</div>
                  )}
                  {row.alternates
                    .filter((alt) => !effective || alt.id !== effective.id)
                    .map((alt) => (
                      <SongOption key={alt.id} song={alt} onPick={pick} onPreview={onPreview} isPreviewing={previewId === alt.id} />
                    ))}
                  {!effective && row.alternates.length === 0 && (
                    <div className="px-md py-sm text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline-variant">Type to search the library</div>
                  )}
                </>
              )}
            </div>

            {/* Not in the library? Create it. */}
            <button
              onClick={create}
              className="shrink-0 border-t border-outline-variant/20 px-md py-sm flex items-center gap-sm text-left hover:bg-surface-variant transition-colors cursor-pointer text-tertiary"
            >
              <span className="material-symbols-outlined text-[18px]">add_circle</span>
              <span className="text-body-md truncate">{q.trim() ? `Create “${q.trim()}”…` : 'Create new song…'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Right-hand pane: full lyrics of whichever song is being previewed.
function PreviewPane({ song, loading }) {
  return (
    <div className="w-96 shrink-0 border-l border-outline-variant/20 bg-surface-container-lowest flex flex-col min-h-0">
      {!song ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-sm p-lg text-center">
          <span className="material-symbols-outlined text-outline-variant text-4xl">lyrics</span>
          <p className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline-variant">
            Click a match to preview its lyrics
          </p>
        </div>
      ) : (
        <>
          <div className="px-lg py-md border-b border-outline-variant/20 shrink-0">
            <p className="text-body-lg font-bold text-on-surface truncate" title={song.title}>{song.title}</p>
            {song.author && <p className="text-label-sm font-label-sm text-on-surface-variant truncate">{song.author}</p>}
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-lg space-y-md">
            {loading ? (
              <div className="flex items-center justify-center py-xl">
                <span className="material-symbols-outlined text-primary text-3xl animate-spin" style={{ animationDuration: '1s' }}>progress_activity</span>
              </div>
            ) : !song.sections || song.sections.length === 0 ? (
              <p className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline-variant">No lyrics stored</p>
            ) : (
              song.sections.map((sec, i) => (
                <div key={i}>
                  {sec.type && (
                    <p className="text-label-sm font-label-sm uppercase tracking-[0.08em] text-primary/80 mb-xs">{sec.type}</p>
                  )}
                  <p className="text-body-md text-on-surface-variant whitespace-pre-wrap leading-relaxed">{sec.content}</p>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function SongListImportModal({ onCancel, onAddManyToRundown }) {
  useModalGuard();
  const [step, setStep] = useState('input'); // 'input' | 'matching' | 'results' | 'adding'
  const [text, setText] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);       // { id, title, author }
  const [previewData, setPreviewData] = useState(null); // full song w/ sections
  const [previewLoading, setPreviewLoading] = useState(false);
  const [creating, setCreating] = useState(null);     // { prefillTitle, prefillSections, apply }
  const textareaRef = useRef(null);
  const previewCache = useRef(new Map());

  useEffect(() => {
    function handleKey(e) {
      // Don't close the list modal on Escape while the song editor is layered over it.
      if (e.key === 'Escape' && step !== 'matching' && step !== 'adding' && !creating) onCancel();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel, step, creating]);

  useEffect(() => {
    if (step === 'input') textareaRef.current?.focus();
  }, [step]);

  // Load full lyrics whenever the previewed song changes (cached per id).
  useEffect(() => {
    if (!preview) { setPreviewData(null); return; }
    const id = preview.id;
    if (previewCache.current.has(id)) { setPreviewData(previewCache.current.get(id)); setPreviewLoading(false); return; }
    let alive = true;
    setPreviewData({ ...preview, sections: null });
    setPreviewLoading(true);
    (async () => {
      try {
        const full = await window.cue.songs.get(id);
        if (!alive) return;
        const data = full || { ...preview, sections: [] };
        previewCache.current.set(id, data);
        setPreviewData(data);
      } catch {
        if (alive) setPreviewData({ ...preview, sections: [] });
      } finally {
        if (alive) setPreviewLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [preview]);

  function requestPreview(song) {
    if (song && song.id) setPreview({ id: song.id, title: song.title, author: song.author });
  }

  function startCreate({ title, text, apply }) {
    setCreating({
      prefillTitle: title || '',
      prefillSections: text ? [{ type: 'verse', content: text }] : [],
      apply,
    });
  }

  async function handleMatch() {
    if (!text.trim()) return;
    setError(null);
    setStep('matching');
    try {
      const raw = await window.cue.songs.matchTitles(text);
      if (!Array.isArray(raw)) throw new Error('No response from the matcher.');
      const mapped = raw.map((r) => ({
        ...r,
        alternates: r.alternates || [],
        // Pre-tick only confident hits. Fuzzy/ambiguous matches still show their best
        // guess + alternates, but the operator opts in so a wrong guess isn't added silently.
        selected: r.confidence === 'exact' || r.confidence === 'high',
        override: null,
      }));
      setRows(mapped);
      setStep('results');
      // Auto-preview the first row that has a match so the pane isn't empty.
      const firstMatch = mapped.find((r) => r.match);
      if (firstMatch) requestPreview(firstMatch.match);
    } catch (e) {
      // Surface the failure instead of silently bouncing back to an unchanged screen.
      setError(e?.message || 'Matching failed. Reopen the app if it was just updated.');
      setStep('input');
    }
  }

  async function handleAdd() {
    const ids = rows
      .filter((r) => r.selected && (r.override ?? r.match))
      .map((r) => (r.override ?? r.match).id);
    if (!ids.length) return;
    setStep('adding');
    try {
      await onAddManyToRundown(ids);
    } finally {
      onCancel();
    }
  }

  const selectedCount = rows.filter((r) => r.selected && (r.override ?? r.match)).length;
  const notFoundCount = rows.filter((r) => r.confidence === 'none' && !r.override).length;
  const totalCount = rows.length;

  return createPortal(
    <>
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={step === 'matching' || step === 'adding' ? undefined : onCancel}
    >
      <div
        className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-[88rem] max-h-[88vh] flex flex-col shadow-2xl ring-1 ring-white/5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-lg py-md border-b border-outline-variant/20 bg-surface-container-high rounded-t-xl flex-shrink-0 flex items-center justify-between gap-md">
          <div className="flex items-center gap-sm min-w-0">
            <span className="material-symbols-outlined text-primary">format_list_bulleted_add</span>
            <div className="min-w-0">
              <h2 className="text-headline-md font-bold text-on-surface tracking-tight">Paste Song List</h2>
              <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">
                {step === 'input'
                  ? 'Paste a set list — titles or lyrics, however messy — to match against your library'
                  : step === 'matching'
                    ? 'Matching…'
                    : step === 'adding'
                      ? `Adding ${selectedCount} to rundown…`
                      : `${totalCount} titles · ${selectedCount} matched · ${notFoundCount} not found`
                }
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={step === 'matching' || step === 'adding'}
            className="text-on-surface-variant hover:text-on-surface cursor-pointer disabled:opacity-40"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex">
          {(step === 'input' || step === 'matching') && (
            <div className="p-lg flex flex-col gap-md h-full w-full overflow-y-auto custom-scrollbar">
              <p className="text-body-md text-on-surface-variant">
                Paste the set list exactly as you received it. Each entry can be a title or just
                a remembered lyric line — they're matched against song lyrics, not only titles.
                Numbers, "x2" markers and section labels like "Worship" / "Praise" are handled.
              </p>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={step === 'matching'}
                placeholder={"Worship\n1. As the deer panteth for the waters\n\n2. We bring the sacrifice of praise\n\nOh come let us adore him"}
                className="flex-1 min-h-[240px] bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-md text-body-md text-on-surface font-mono resize-none focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 disabled:opacity-50 placeholder:text-on-surface-variant/40"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleMatch();
                }}
              />
              {error && (
                <div className="flex items-start gap-sm px-md py-sm rounded-lg border border-error/40 bg-error/10 text-error">
                  <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                  <p className="text-body-md">{error}</p>
                </div>
              )}
            </div>
          )}

          {step === 'results' && (
            <>
              <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar px-lg py-sm space-y-xs">
                {rows.length === 0 && (
                  <div className="py-xl text-center text-label-sm font-label-sm uppercase tracking-widest text-outline-variant">
                    No titles detected
                  </div>
                )}
                {rows.map((row, i) => (
                  <ResultRow
                    key={i}
                    row={row}
                    previewId={preview?.id ?? null}
                    onPreview={requestPreview}
                    onCreate={startCreate}
                    onChange={(updated) => setRows((prev) => prev.map((r, j) => (j === i ? updated : r)))}
                  />
                ))}
              </div>
              <PreviewPane song={previewData} loading={previewLoading} />
            </>
          )}

          {step === 'adding' && (
            <div className="flex flex-col items-center justify-center py-xl gap-md w-full">
              <span className="material-symbols-outlined text-primary text-5xl animate-spin" style={{ animationDuration: '1s' }}>
                progress_activity
              </span>
              <p className="text-body-md text-on-surface-variant">
                Adding {selectedCount} song{selectedCount === 1 ? '' : 's'} to rundown…
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-lg py-md border-t border-outline-variant/20 bg-surface-container-high rounded-b-xl flex-shrink-0 flex items-center justify-between gap-sm">
          <div className="flex items-center gap-sm">
            {step === 'results' && (
              <button
                onClick={() => { setStep('input'); setRows([]); setPreview(null); }}
                className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer flex items-center gap-xs"
              >
                <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                Edit
              </button>
            )}
          </div>
          <div className="flex items-center gap-sm">
            <button
              onClick={onCancel}
              disabled={step === 'matching' || step === 'adding'}
              className="px-lg py-sm rounded-lg text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant hover:bg-surface-variant transition-colors cursor-pointer disabled:opacity-40"
            >
              Cancel
            </button>
            {(step === 'input' || step === 'matching') && (
              <button
                onClick={handleMatch}
                disabled={!text.trim() || step === 'matching'}
                className="px-lg py-sm rounded-lg text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold bg-primary text-on-primary hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center gap-xs"
              >
                {step === 'matching' && <span className="material-symbols-outlined text-[14px] animate-spin" style={{ animationDuration: '1s' }}>progress_activity</span>}
                {step === 'matching' ? 'Matching…' : 'Match Songs'}
              </button>
            )}
            {step === 'results' && (
              <button
                onClick={handleAdd}
                disabled={selectedCount === 0}
                className="px-lg py-sm rounded-lg text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold bg-tertiary-container text-on-tertiary hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                Add {selectedCount || ''} Song{selectedCount === 1 ? '' : 's'} to Rundown
              </button>
            )}
          </div>
        </div>
      </div>
    </div>

      {/* New-song editor — a SIBLING of the backdrop (not a child), so clicks inside
          it don't bubble through the React tree to the backdrop's onCancel. */}
      {creating && (
        <SongEditor
          song={{ prefillTitle: creating.prefillTitle, prefillSections: creating.prefillSections }}
          onClose={() => setCreating(null)}
          onSave={async (newId) => {
            try {
              if (newId) {
                const full = await window.cue.songs.get(newId);
                if (full) {
                  const s = { id: full.id, title: full.title, author: full.author };
                  creating.apply?.(s);
                  previewCache.current.set(s.id, full);
                  requestPreview(s);
                }
              }
            } catch { /* keep the row unmatched if the lookup fails */ }
            setCreating(null);
          }}
        />
      )}
    </>,
    document.body
  );
}
