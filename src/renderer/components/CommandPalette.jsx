import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useToast } from './Toast';

// ⌘K / Ctrl+K launcher. One search box across songs, scripture, scenes,
// presentations and media — Enter on a result runs its primary action (add to the
// active rundown, or apply a scene) and closes. Reuses the operator's existing add
// handlers (passed as props) so nothing about rundown semantics is duplicated here.

const isMac = window.cue.platform === 'darwin';
const HAS_NUMBER = /\d/; // a query with a chapter/verse number may be a scripture ref

export default function CommandPalette({ onClose, onAddSong, onAddScripture, onAddMedia, onAddPresentation, onApplyScene }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [presentations, setPresentations] = useState([]);
  const [media, setMedia] = useState([]);
  const [versionId, setVersionId] = useState(null);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Static catalogs load once; songs search runs per-query (FTS in main).
  useEffect(() => {
    window.cue.scenes.list().then((l) => setScenes(l || []));
    window.cue.presentations.list().then((l) => setPresentations(l || []));
    window.cue.media.listAll().then((l) => setMedia(l || []));
    window.cue.bible.versions().then((l) => setVersionId(l?.[0]?.id ?? null));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setSongs([]); return; }
    const t = setTimeout(async () => {
      try { setSongs((await window.cue.songs.search(q)) || []); } catch { setSongs([]); }
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  // Backstop Esc close if focus ever leaves the input.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    const out = [];
    if (q && HAS_NUMBER.test(q) && versionId != null) {
      out.push({
        key: 'scr', category: 'Scripture', icon: 'menu_book',
        label: `Add scripture: ${query.trim()}`, sublabel: 'Resolve & add to rundown',
        run: async () => {
          const passage = await window.cue.bible.resolve(versionId, query.trim(), 1);
          if (!passage) { toast.error(`Couldn't resolve "${query.trim()}"`); return false; }
          onAddScripture(passage); toast.success(`Added ${passage.reference}`);
        },
      });
    }
    for (const s of songs.slice(0, 6)) {
      out.push({ key: 'song' + s.id, category: 'Songs', icon: 'music_note', label: s.title, sublabel: s.author || '',
        run: () => { onAddSong(s.id); toast.success('Added to rundown'); } });
    }
    if (q) {
      for (const sc of scenes.filter((x) => (x.name || '').toLowerCase().includes(q)).slice(0, 5)) {
        out.push({ key: 'scene' + sc.id, category: 'Scenes', icon: 'dashboard', label: sc.name, sublabel: 'Apply scene',
          run: () => { onApplyScene(sc); toast.success(`Applied "${sc.name}"`); } });
      }
      for (const p of presentations.filter((x) => (x.title || '').toLowerCase().includes(q)).slice(0, 5)) {
        out.push({ key: 'pres' + p.id, category: 'Presentations', icon: 'slideshow', label: p.title, sublabel: 'Add to rundown',
          run: () => { onAddPresentation(p.id); toast.success('Added to rundown'); } });
      }
      for (const m of media.filter((x) => (x.filename || '').toLowerCase().includes(q)).slice(0, 5)) {
        out.push({ key: 'media' + m.id, category: 'Media', icon: 'perm_media', label: m.filename, sublabel: m.type || 'Media',
          run: () => { onAddMedia(m.id); toast.success('Added to rundown'); } });
      }
    }
    return out;
  }, [q, query, songs, scenes, presentations, media, versionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSel(0); }, [results.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const activate = useCallback(async (idx) => {
    const r = results[idx];
    if (!r) return;
    const ok = await r.run();
    if (ok !== false) onClose();
  }, [results, onClose]);

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(sel); }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center bg-black/60 pt-[12vh] px-xl" onClick={onClose}>
      <div className="w-full max-w-xl bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-sm px-md border-b border-outline-variant/20">
          <span className="material-symbols-outlined text-on-surface-variant/60 text-[20px]">search</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search songs, scripture, scenes, presentations, media…"
            className="flex-1 h-12 bg-transparent text-body-md text-on-surface placeholder:text-on-surface-variant/50 outline-none"
          />
          <span className="text-[11px] text-on-surface-variant/50 font-mono shrink-0">{isMac ? '⌘' : 'Ctrl'}K</span>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-auto py-xs">
          {results.length === 0 ? (
            q ? (
              <p className="px-md py-lg text-center text-body-sm text-on-surface-variant/60">No matches</p>
            ) : (
              <div className="px-md py-md">
                <p className="text-[10px] font-label-sm text-on-surface-variant/50 uppercase tracking-[0.08em] mb-sm">Keyboard Shortcuts</p>
                <div className="grid grid-cols-2 gap-x-lg gap-y-xs text-[11px] text-on-surface-variant">
                  {[
                    [isMac ? '⌘G / G' : 'Ctrl+G / G', 'GO (send preview live)'],
                    [isMac ? '⌘C / Esc' : 'Ctrl+C / Esc', 'Clear output'],
                    [isMac ? '⌘L / L' : 'Ctrl+L / L', 'Toggle logo'],
                    ['Space', 'Next live slide'],
                    ['↑ / ↓', 'Navigate preview'],
                    ['S', 'Focus song search'],
                    ['1–9', 'Recall scene'],
                    ['Q W E …', 'Jump to live slide'],
                    ['?', 'Shortcut help overlay'],
                    ['`', 'Stage controls'],
                  ].map(([key, desc]) => (
                    <div key={key} className="flex items-center gap-sm">
                      <span className="font-mono text-on-surface bg-surface-container-high border border-outline-variant/30 rounded px-xs py-[1px] text-[10px] shrink-0">{key}</span>
                      <span className="text-on-surface-variant/70">{desc}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-on-surface-variant/40 mt-sm">Type to search songs, scripture (e.g. "John 3:16"), scenes, presentations, and media.</p>
              </div>
            )
          ) : (
            results.map((r, i) => {
              const showCat = i === 0 || results[i - 1].category !== r.category;
              return (
                <React.Fragment key={r.key}>
                  {showCat && (
                    <p className="px-md pt-sm pb-[2px] text-label-sm font-label-sm text-on-surface-variant/50 uppercase tracking-[0.08em]">{r.category}</p>
                  )}
                  <button
                    data-idx={i}
                    onMouseMove={() => setSel(i)}
                    onClick={() => activate(i)}
                    className={`w-full flex items-center gap-sm px-md py-sm text-left cursor-pointer ${i === sel ? 'bg-primary-container/20' : ''}`}
                  >
                    <span className={`material-symbols-outlined text-[18px] ${i === sel ? 'text-primary' : 'text-on-surface-variant/70'}`}>{r.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-body-sm text-on-surface truncate">{r.label}</span>
                      {r.sublabel && <span className="block text-[11px] text-on-surface-variant/60 truncate">{r.sublabel}</span>}
                    </span>
                    {i === sel && <span className="material-symbols-outlined text-[16px] text-on-surface-variant/50 shrink-0">keyboard_return</span>}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
