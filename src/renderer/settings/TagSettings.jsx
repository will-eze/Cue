import React, { useState, useEffect, useCallback } from 'react';

// Preset palette for tag colours — broadcast-semantic, no AI purple/indigo.
const PALETTE = ['#4d8eff', '#ff5470', '#34d399', '#f59e0b', '#22d3ee', '#e879a6', '#94a3a8', '#a3e635'];

export default function TagSettings() {
  const [tags, setTags] = useState([]);
  const [newName, setNewName] = useState('');
  const [newColour, setNewColour] = useState(PALETTE[0]);
  const [editing, setEditing] = useState(null); // { id, name, colour }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setTags(await window.cue.tags.list());
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    if (tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      setError(`A tag named “${name}” already exists.`);
      return;
    }
    setError('');
    await window.cue.tags.create({ name, colour: newColour });
    setNewName('');
    setNewColour(PALETTE[0]);
    load();
  }

  async function handleSaveEdit() {
    const name = editing.name.trim();
    if (!name) return;
    if (tags.some((t) => t.id !== editing.id && t.name.toLowerCase() === name.toLowerCase())) {
      setError(`A tag named “${name}” already exists.`);
      return;
    }
    setError('');
    await window.cue.tags.update(editing.id, { name, colour: editing.colour });
    setEditing(null);
    load();
  }

  async function handleDelete(id) {
    await window.cue.tags.delete(id);
    setConfirmDelete(null);
    load();
  }

  return (
    <section className="space-y-md">
      <div>
        <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>sell</span>
          Tags
        </h2>
        <p className="text-body-sm text-on-surface-variant mt-xs">
          Create and manage the tags used to organise the song library. Deleting a tag removes it from every song.
        </p>
      </div>

      {error && (
        <div className="bg-error-container/20 border border-error/30 rounded-lg px-md py-sm text-body-sm text-error">
          {error}
        </div>
      )}

      {/* Create new tag */}
      <div className="bg-surface-container-high border border-outline-variant/30 rounded-xl p-md flex items-center gap-sm">
        <ColourPicker value={newColour} onChange={setNewColour} />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          placeholder="New tag name…"
          className="flex-1 bg-background border border-outline-variant/30 rounded-lg px-md py-sm text-body-md text-on-surface placeholder:text-outline-variant focus:border-primary focus:outline-none"
        />
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="bg-primary-container text-on-primary px-md py-sm rounded-lg text-label-sm font-label-sm font-bold flex items-center gap-xs hover:brightness-110 active:scale-95 transition-all cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-default"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          Add Tag
        </button>
      </div>

      {/* Existing tags */}
      {tags.length === 0 ? (
        <div className="border-2 border-dashed border-outline-variant/20 rounded-xl py-xl flex flex-col items-center gap-sm text-outline-variant">
          <span className="material-symbols-outlined text-3xl">sell</span>
          <span className="text-label-sm font-label-sm uppercase tracking-[0.05em]">No tags yet</span>
        </div>
      ) : (
        <div className="space-y-sm">
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center gap-md bg-surface-container-low border border-outline-variant/30 rounded-xl px-md py-sm"
            >
              {editing?.id === tag.id ? (
                <>
                  <ColourPicker value={editing.colour} onChange={(c) => setEditing({ ...editing, colour: c })} />
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditing(null); }}
                    autoFocus
                    className="flex-1 bg-background border border-outline-variant/30 rounded-lg px-md py-xs text-body-md text-on-surface focus:border-primary focus:outline-none"
                  />
                  <button
                    onClick={handleSaveEdit}
                    className="text-[10px] font-mono text-tertiary hover:text-tertiary/70 cursor-pointer uppercase tracking-[0.04em] border border-tertiary/40 px-sm py-[3px] rounded transition-colors"
                  >Save</button>
                  <button
                    onClick={() => { setEditing(null); setError(''); }}
                    className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.04em]"
                  >Cancel</button>
                </>
              ) : (
                <>
                  <span className="w-[14px] h-[14px] rounded-full shrink-0 border border-white/10" style={{ background: tag.colour || '#8c909f' }} />
                  <span className="flex-1 min-w-0 text-body-md font-semibold text-on-surface truncate">{tag.name}</span>
                  <span className="text-label-sm font-label-sm text-on-surface-variant shrink-0">
                    {tag.song_count} {tag.song_count === 1 ? 'song' : 'songs'}
                  </span>
                  {confirmDelete === tag.id ? (
                    <div className="flex items-center gap-sm shrink-0">
                      <span className="text-[10px] font-mono text-error uppercase tracking-[0.04em]">Delete?</span>
                      <button
                        onClick={() => handleDelete(tag.id)}
                        className="text-[10px] font-mono text-error hover:text-error/70 cursor-pointer uppercase tracking-[0.04em] border border-error/40 px-sm py-[2px] rounded transition-colors"
                      >Yes</button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.04em]"
                      >No</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-xs shrink-0">
                      <button
                        onClick={() => { setEditing({ id: tag.id, name: tag.name, colour: tag.colour || PALETTE[0] }); setError(''); }}
                        className="text-on-surface-variant hover:text-primary cursor-pointer transition-colors p-xs rounded hover:bg-primary/10"
                        title="Rename tag"
                      >
                        <span className="material-symbols-outlined text-[15px]">edit</span>
                      </button>
                      <button
                        onClick={() => setConfirmDelete(tag.id)}
                        className="text-on-surface-variant hover:text-error cursor-pointer transition-colors p-xs rounded hover:bg-error/10"
                        title="Delete tag"
                      >
                        <span className="material-symbols-outlined text-[15px]">delete</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ColourPicker({ value, onChange }) {
  return (
    <div className="flex items-center gap-xs shrink-0">
      {PALETTE.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`w-[18px] h-[18px] rounded-full transition-all cursor-pointer ${value === c ? 'ring-2 ring-offset-2 ring-offset-surface-container-high ring-white/60 scale-110' : 'hover:scale-110'}`}
          style={{ background: c }}
          title={c}
        />
      ))}
    </div>
  );
}
