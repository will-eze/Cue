import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const CONFIDENCE_META = {
  exact: { icon: 'check_circle', cls: 'text-tertiary', label: 'Exact' },
  high:  { icon: 'check_circle', cls: 'text-primary',  label: 'Match' },
  low:   { icon: 'warning',      cls: 'text-yellow-400', label: 'Fuzzy' },
  none:  { icon: 'cancel',       cls: 'text-error',    label: 'Not Found' },
};

function ResultRow({ row, onChange }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef(null);
  const meta = CONFIDENCE_META[row.confidence];

  // Close the alt-picker on an outside click (only while it's open).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);
  const effective = row.override ?? row.match;
  const canSelect = row.confidence !== 'none' || row.alternates.length > 0;
  const hasAlts = row.alternates.length > 0;

  function pickAlt(alt) {
    onChange({ ...row, override: alt, selected: true });
    setOpen(false);
  }

  function clearOverride() {
    if (row.confidence === 'none') return;
    onChange({ ...row, override: null, selected: true });
    setOpen(false);
  }

  return (
    <div ref={pickerRef} className={`flex items-center gap-md px-md py-sm rounded-lg border transition-colors ${
      !canSelect
        ? 'border-error/30 bg-error-container/10 opacity-60'
        : row.selected
          ? 'border-primary/40 bg-primary/5'
          : 'border-outline-variant/30 bg-surface-container'
    }`}>
      {/* Select toggle */}
      <input
        type="checkbox"
        checked={!!row.selected}
        disabled={!canSelect}
        onChange={(e) => onChange({ ...row, selected: e.target.checked })}
        className="accent-primary w-4 h-4 cursor-pointer flex-shrink-0 disabled:cursor-not-allowed"
      />

      {/* Input title */}
      <div className="w-48 shrink-0 min-w-0">
        <p className="text-body-md text-on-surface font-medium truncate" title={row.input}>{row.input}</p>
      </div>

      {/* Arrow */}
      <span className="material-symbols-outlined text-outline-variant text-[16px] shrink-0">arrow_forward</span>

      {/* Matched song / picker */}
      <div className="flex-1 min-w-0 relative">
        {effective ? (
          <div className="flex items-center gap-sm min-w-0">
            <span className={`material-symbols-outlined text-[16px] shrink-0 ${meta.cls}`}>{meta.icon}</span>
            <span className="text-body-md text-on-surface truncate">{effective.title}</span>
            {effective.author && (
              <span className="text-label-sm font-label-sm text-on-surface-variant truncate hidden sm:block">— {effective.author}</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-sm">
            <span className={`material-symbols-outlined text-[16px] shrink-0 ${meta.cls}`}>{meta.icon}</span>
            <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Not Found</span>
          </div>
        )}

        {/* Alt picker dropdown */}
        {hasAlts && open && (
          <div className="absolute left-0 mt-xs w-72 bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl ring-1 ring-white/5 z-50 py-xs">
            {effective && (
              <button
                onClick={clearOverride}
                className="w-full flex items-center gap-sm px-md py-sm text-left hover:bg-surface-variant transition-colors cursor-pointer"
              >
                <span className={`material-symbols-outlined text-[16px] shrink-0 ${meta.cls}`}>{meta.icon}</span>
                <span className="text-body-md text-on-surface truncate">{effective.title}</span>
                <span className="ml-auto text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">current</span>
              </button>
            )}
            {row.alternates.map((alt) => (
              <button
                key={alt.id}
                onClick={() => pickAlt(alt)}
                className="w-full flex items-center gap-sm px-md py-sm text-left hover:bg-surface-variant transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0">music_note</span>
                <span className="text-body-md text-on-surface truncate">{alt.title}</span>
                {alt.author && <span className="text-label-sm font-label-sm text-on-surface-variant truncate">— {alt.author}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Confidence badge + alt picker toggle */}
      <div className="flex items-center gap-xs shrink-0">
        <span className={`text-label-sm font-label-sm uppercase tracking-[0.05em] px-sm py-[2px] rounded-full border ${
          row.confidence === 'exact' ? 'text-tertiary border-tertiary/40 bg-tertiary/10'
          : row.confidence === 'high' ? 'text-primary border-primary/40 bg-primary/10'
          : row.confidence === 'low'  ? 'text-yellow-400 border-yellow-400/40 bg-yellow-400/10'
          : 'text-error border-error/40 bg-error/10'
        }`}>
          {meta.label}
        </span>
        {hasAlts && (
          <button
            onClick={() => setOpen((o) => !o)}
            title="Pick a different match"
            className="text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">unfold_more</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function SongListImportModal({ onCancel, onAddManyToRundown }) {
  const [step, setStep] = useState('input'); // 'input' | 'matching' | 'results' | 'adding'
  const [text, setText] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape' && step !== 'matching' && step !== 'adding') onCancel();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel, step]);

  useEffect(() => {
    if (step === 'input') textareaRef.current?.focus();
  }, [step]);

  async function handleMatch() {
    if (!text.trim()) return;
    setError(null);
    setStep('matching');
    try {
      const raw = await window.cue.songs.matchTitles(text);
      if (!Array.isArray(raw)) throw new Error('No response from the matcher.');
      setRows(raw.map((r) => ({
        ...r,
        alternates: r.alternates || [],
        selected: r.confidence !== 'none',
        override: null,
      })));
      setStep('results');
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
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={step === 'matching' || step === 'adding' ? undefined : onCancel}
    >
      <div
        className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-2xl max-h-[84vh] flex flex-col shadow-2xl ring-1 ring-white/5"
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
                  ? 'Paste a list of titles to match against your library'
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
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          {(step === 'input' || step === 'matching') && (
            <div className="p-lg flex flex-col gap-md h-full">
              <p className="text-body-md text-on-surface-variant">
                Paste the song list below — one title per line, or blocks separated by blank lines.
                Lyrics pasted alongside a title are used to verify the match.
              </p>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={step === 'matching'}
                placeholder={"Amazing Grace\nHow Great Thou Art\n\nBlessed Assurance\nBlest assurance, Jesus is mine…"}
                className="flex-1 min-h-[200px] bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-md text-body-md text-on-surface font-mono resize-none focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 disabled:opacity-50 placeholder:text-on-surface-variant/40"
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
            <div className="px-lg py-sm space-y-xs">
              {rows.length === 0 && (
                <div className="py-xl text-center text-label-sm font-label-sm uppercase tracking-widest text-outline-variant">
                  No titles detected
                </div>
              )}
              {rows.map((row, i) => (
                <ResultRow
                  key={i}
                  row={row}
                  onChange={(updated) => setRows((prev) => prev.map((r, j) => (j === i ? updated : r)))}
                />
              ))}
            </div>
          )}

          {step === 'adding' && (
            <div className="flex flex-col items-center justify-center py-xl gap-md">
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
                onClick={() => { setStep('input'); setRows([]); }}
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
    </div>,
    document.body
  );
}
