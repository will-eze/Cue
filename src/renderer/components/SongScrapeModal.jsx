import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

// Online Song Finder — search the web by title/artist, fetch + clean the lyrics,
// edit them in place, then save into the library. All scraping happens in main
// (window.cue.songs.scrape*); this is purely the search → pick → edit → save UI.
export default function SongScrapeModal({ onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);   // null = not searched yet
  const [error, setError] = useState('');

  const [urlMode, setUrlMode] = useState(false);
  const [pageUrl, setPageUrl] = useState('');

  // The editable preview (populated after fetching a candidate / URL).
  const [loaded, setLoaded] = useState(null);      // { source }
  const [fetching, setFetching] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftAuthor, setDraftAuthor] = useState('');
  const [draftLyrics, setDraftLyrics] = useState('');
  const [saving, setSaving] = useState(false);

  const titleRef = useRef(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const runSearch = useCallback(async () => {
    const q = `${title} ${artist}`.trim();
    if (!q) return;
    setSearching(true); setError(''); setResults(null);
    try {
      const res = await window.cue.songs.scrapeSearch(q);
      if (!res.ok) { setError(res.error || 'Search failed.'); setResults([]); return; }
      setResults(res.results || []);
      if (!res.results?.length) setError('No matches found. Try a different title, or paste a lyrics URL.');
    } finally {
      setSearching(false);
    }
  }, [title, artist]);

  async function loadCandidate(candidate) {
    setFetching(true); setError(''); setLoaded(null);
    try {
      const res = await window.cue.songs.scrapeFetch(candidate);
      if (!res.ok) { setError(res.error || 'Could not fetch the lyrics.'); return; }
      setLoaded({ source: res.source });
      setDraftTitle(res.title || candidate.title || '');
      setDraftAuthor(res.author || candidate.artist || '');
      setDraftLyrics(res.raw || '');
    } finally {
      setFetching(false);
    }
  }

  function loadFromUrl() {
    const url = pageUrl.trim();
    if (!/^https?:\/\//i.test(url)) { setError('Enter a valid http(s) lyrics page URL.'); return; }
    loadCandidate({ provider: 'url', url });
  }

  async function save() {
    if (!draftLyrics.trim()) { setError('Nothing to save — the lyrics are empty.'); return; }
    setSaving(true); setError('');
    try {
      // Re-parse the (possibly edited) lyrics text through the same pipeline so
      // sections reflect any operator edits, then create the song.
      const parsed = await window.cue.songs.scrapeFetch({
        provider: 'text', text: draftLyrics, title: draftTitle, artist: draftAuthor,
      });
      if (!parsed.ok) { setError(parsed.error || 'Could not parse the lyrics.'); return; }
      const id = await window.cue.songs.create({
        title: (draftTitle || 'Untitled').trim(),
        author: draftAuthor.trim() || null,
        sections: parsed.sections,
      });
      onSaved?.(id);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-lg"
      onClick={saving || fetching ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-[920px] max-w-full h-[620px] max-h-full bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-sm px-lg h-12 bg-surface-container-high border-b border-outline-variant/30 shrink-0">
          <span className="material-symbols-outlined text-primary">travel_explore</span>
          <span className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface">Find Song Online</span>
          <button onClick={onClose} className="ml-auto text-on-surface-variant hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Search bar */}
        <div className="px-lg py-sm border-b border-outline-variant/30 shrink-0 flex flex-col gap-sm">
          {!urlMode ? (
            <div className="flex items-end gap-sm">
              <label className="flex flex-col gap-[2px] flex-1">
                <span className="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">Song title</span>
                <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                  placeholder="e.g. Oceans"
                  className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-1 text-body-md text-on-surface focus:outline-none focus:border-primary" />
              </label>
              <label className="flex flex-col gap-[2px] w-56">
                <span className="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">Artist (optional)</span>
                <input value={artist} onChange={(e) => setArtist(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                  placeholder="e.g. Hillsong United"
                  className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-1 text-body-md text-on-surface focus:outline-none focus:border-primary" />
              </label>
              <button onClick={runSearch} disabled={searching || !`${title}${artist}`.trim()}
                className="bg-primary text-on-primary px-md py-1 rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all flex items-center gap-xs disabled:opacity-50 disabled:cursor-not-allowed h-[30px]">
                <span className="material-symbols-outlined text-[16px]">{searching ? 'hourglass_empty' : 'search'}</span>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-sm">
              <label className="flex flex-col gap-[2px] flex-1">
                <span className="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">Lyrics page URL</span>
                <input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadFromUrl(); }}
                  placeholder="https://…  (Genius, AZLyrics, hymn sites, any lyrics page)"
                  className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-1 text-body-md text-on-surface focus:outline-none focus:border-primary" />
              </label>
              <button onClick={loadFromUrl} disabled={fetching}
                className="bg-primary text-on-primary px-md py-1 rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all flex items-center gap-xs disabled:opacity-50 h-[30px]">
                <span className="material-symbols-outlined text-[16px]">download</span> Fetch
              </button>
            </div>
          )}
          <button onClick={() => { setUrlMode((v) => !v); setError(''); }}
            className="self-start text-label-sm font-label-sm text-primary hover:brightness-110 flex items-center gap-xs cursor-pointer">
            <span className="material-symbols-outlined text-[14px]">{urlMode ? 'search' : 'link'}</span>
            {urlMode ? 'Search by title/artist instead' : 'Paste a lyrics URL instead'}
          </button>
        </div>

        {/* Body: candidates | preview */}
        <div className="flex flex-1 min-h-0">
          {/* Candidates */}
          {!urlMode && (
            <div className="w-72 border-r border-outline-variant/30 overflow-y-auto shrink-0">
              {results === null ? (
                <Hint icon="search" text="Search for a song to see matches." />
              ) : results.length === 0 ? (
                <Hint icon="search_off" text="No matches." />
              ) : (
                <ul>
                  {results.map((r) => (
                    <li key={r.id}>
                      <button onClick={() => loadCandidate(r)}
                        className={`w-full flex items-center gap-sm px-sm py-sm text-left border-b border-outline-variant/20 hover:bg-surface-variant transition-colors cursor-pointer ${loaded && draftTitle && r.title === draftTitle ? 'bg-primary/10' : ''}`}>
                        {r.thumb
                          ? <img src={r.thumb} alt="" className="w-9 h-9 rounded object-cover shrink-0 bg-black" />
                          : <span className="w-9 h-9 rounded bg-surface-container-high flex items-center justify-center shrink-0"><span className="material-symbols-outlined text-[16px] text-outline-variant">music_note</span></span>}
                        <span className="flex flex-col min-w-0">
                          <span className="text-body-md text-on-surface truncate">{r.title}</span>
                          <span className="text-label-sm font-label-sm text-on-surface-variant truncate">{r.artist || '—'}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Preview / edit */}
          <div className="flex-1 min-w-0 flex flex-col">
            {fetching ? (
              <Hint icon="hourglass_empty" spin text="Fetching lyrics…" />
            ) : !loaded ? (
              <Hint icon="lyrics" text={urlMode ? 'Paste a URL and Fetch to preview.' : 'Pick a result to preview and edit its lyrics.'} />
            ) : (
              <div className="flex flex-col flex-1 min-h-0 p-md gap-sm">
                <div className="flex gap-sm">
                  <label className="flex flex-col gap-[2px] flex-1">
                    <span className="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">Title</span>
                    <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)}
                      className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-1 text-body-md text-on-surface focus:outline-none focus:border-primary" />
                  </label>
                  <label className="flex flex-col gap-[2px] flex-1">
                    <span className="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">Author</span>
                    <input value={draftAuthor} onChange={(e) => setDraftAuthor(e.target.value)}
                      className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-1 text-body-md text-on-surface focus:outline-none focus:border-primary" />
                  </label>
                </div>
                <label className="flex flex-col gap-[2px] flex-1 min-h-0">
                  <span className="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">
                    Lyrics — edit freely; <span className="normal-case tracking-normal">section headers like “Chorus” / “[Verse 1]” split the slides</span>
                  </span>
                  <textarea value={draftLyrics} onChange={(e) => setDraftLyrics(e.target.value)}
                    spellCheck={false}
                    className="flex-1 min-h-0 resize-none bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-sm text-body-md text-on-surface font-mono leading-relaxed focus:outline-none focus:border-primary" />
                </label>
                {loaded.source && (
                  <p className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case truncate">
                    Source: {loaded.source}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-sm px-lg h-14 bg-surface-container-high border-t border-outline-variant/30 shrink-0">
          {error && <p className="text-label-sm font-label-sm text-error truncate">{error}</p>}
          <div className="ml-auto flex items-center gap-sm">
            <button onClick={onClose}
              className="text-on-surface-variant px-md py-xs rounded text-label-sm font-label-sm hover:bg-surface-variant transition-colors">
              Cancel
            </button>
            <button onClick={save} disabled={!loaded || saving || !draftLyrics.trim()}
              className="bg-tertiary text-on-tertiary px-lg py-xs rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all flex items-center gap-xs disabled:opacity-40 disabled:cursor-not-allowed">
              <span className="material-symbols-outlined text-[16px]">{saving ? 'hourglass_empty' : 'library_add'}</span>
              {saving ? 'Saving…' : 'Add to Library'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Hint({ icon, text, spin }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 h-full gap-sm text-outline-variant px-lg text-center">
      <span className={`material-symbols-outlined text-4xl ${spin ? 'animate-spin' : ''}`}>{icon}</span>
      <span className="text-label-sm font-label-sm uppercase tracking-widest">{text}</span>
    </div>
  );
}
