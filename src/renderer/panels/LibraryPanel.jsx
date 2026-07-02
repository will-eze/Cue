import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../components/Toast';
import { FixedSizeList as List } from 'react-window';
import SongImportModal from '../components/SongImportModal';
import SongListImportModal from '../components/SongListImportModal';
import SongScrapeModal from '../components/SongScrapeModal';
import SongEditor from '../components/SongEditor';
import ContextMenu from '../components/ContextMenu';
import ScripturePanel from './ScripturePanel';
import GraphicsPanel from './GraphicsPanel';
import ScenesPanel from './ScenesPanel';
import MediaThumb from '../components/MediaThumb';
import { StaticSlide } from '../components/SlideElements';
import PresentationEditor from '../components/PresentationEditor';
import PptxImportModal from '../components/PptxImportModal';
import SermonImportModal from '../components/SermonImportModal';
import AddYouTubeModal from '../components/AddYouTubeModal';
import { mediaUrl } from '../utils/mediaUrl';
import { looksLikeYouTube } from '../utils/youtube';

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function SongRow({ index, style, data }) {
  const { songs, selectedId, highlightIdx, onSelect, onDoubleClick, onContextMenu } = data;
  const song = songs[index];
  const isSelected = selectedId === song.id;
  const isHighlighted = index === highlightIdx;
  const clickTimer = useRef(null);

  // SongRow mounts/unmounts constantly under react-window virtualization; without
  // this, the pending single-click timer leaks on every fast scroll.
  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);

  function handleClick() {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      onDoubleClick(song.id);
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        onSelect(song);
      }, 220);
    }
  }

  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        cursor: 'pointer',
        borderBottom: '1px solid rgba(66,71,84,0.3)',
        background: isHighlighted ? 'rgba(77,142,255,0.18)' : isSelected ? 'rgba(77,142,255,0.1)' : undefined,
        boxShadow: isHighlighted ? 'inset 0 0 0 1px rgba(77,142,255,0.45)' : undefined,
        transition: 'background 80ms',
      }}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, song)}
      onMouseEnter={(e) => { if (!isSelected && !isHighlighted) e.currentTarget.style.background = 'rgba(51,53,57,0.5)'; }}
      onMouseLeave={(e) => { if (!isSelected && !isHighlighted) e.currentTarget.style.background = ''; }}
    >
      <span className="material-symbols-outlined text-[16px] text-outline-variant shrink-0">music_note</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 500,
          color: isSelected ? '#adc6ff' : '#e2e2e8',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {song.title}
        </div>
        {song.author && (
          <div style={{
            fontSize: 11,
            color: '#8c909f',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 1,
          }}>
            {song.author}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, shrink: 0 }}>
        {(song.tags || []).slice(0, 3).map((tag) => (
          <span key={tag.id} style={{
            fontFamily: 'monospace',
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: '0.08em',
            padding: '1px 6px',
            borderRadius: 2,
            color: 'rgba(255,255,255,0.8)',
            background: tag.colour || '#333539',
          }}>
            {tag.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function MediaGrid({ assets, onDelete, onSetBackground, onAddToRundown, onApplyBackground, onSetPreviewBackground, previewSongLabel }) {
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  return (
    <div className="flex-1 overflow-y-auto p-md">
      {assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-sm text-outline-variant">
          <span className="material-symbols-outlined text-4xl">image</span>
          <span className="text-label-sm font-label-sm uppercase tracking-widest">No Media — Import Above</span>
        </div>
      ) : (
        <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="group cursor-pointer"
              title="Single-click to select · double-click to set as background of the selected rundown item(s) · drag onto a rundown item to set its background · right-click to add to rundown"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('cue/assetid', String(asset.id));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => setSelectedId(asset.id)}
              onDoubleClick={() => onApplyBackground?.(asset.id)}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, asset }); }}
            >
              <div className={`aspect-video rounded bg-black overflow-hidden mb-xs relative border ${selectedId === asset.id ? 'border-primary' : 'border-outline-variant'}`}>
                {asset.type === 'audio' ? (
                  <div className="w-full h-full bg-surface-container-high flex items-center justify-center">
                    <span className="text-label-sm font-label-sm text-outline-variant">AUD</span>
                  </div>
                ) : (
                  <>
                    <MediaThumb path={asset.path} alt={asset.filename}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                    {asset.type === 'video' && (
                      <div className="absolute bottom-1 right-1 bg-black/50 px-1 rounded text-[8px] text-white font-label-sm">VID</div>
                    )}
                  </>
                )}
                {/* Metadata strip — visible on hover */}
                {(asset.duration_ms != null || asset.size_bytes != null) && (
                  <div className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-[2px] flex items-center justify-between gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    {asset.duration_ms != null && (
                      <span className="text-[8px] text-white/80 tabular-nums font-label-sm">
                        {formatDuration(asset.duration_ms)}
                      </span>
                    )}
                    {asset.size_bytes != null && (
                      <span className="text-[8px] text-white/60 tabular-nums font-label-sm ml-auto">
                        {formatBytes(asset.size_bytes)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-on-surface truncate">{asset.filename}</p>
            </div>
          ))}
        </div>
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: 'Add to Rundown', onClick: () => { onAddToRundown?.(contextMenu.asset.id); setContextMenu(null); } },
            { separator: true },
            previewSongLabel
              ? { label: `Set Background for "${previewSongLabel}"`, onClick: () => { onSetPreviewBackground?.(contextMenu.asset.id); setContextMenu(null); } }
              : { label: 'Set Background for Preview Item', disabled: true, onClick: null },
            { separator: true },
            { label: 'Set as Global Song Background', onClick: () => { onSetBackground('song', contextMenu.asset); setContextMenu(null); } },
            { label: 'Set as Global Slide Background', onClick: () => { onSetBackground('slide', contextMenu.asset); setContextMenu(null); } },
            { label: 'Set as Global Scripture Background', onClick: () => { onSetBackground('scripture', contextMenu.asset); setContextMenu(null); } },
            { separator: true },
            { label: 'Delete', danger: true, onClick: () => { onDelete(contextMenu.asset); setContextMenu(null); } },
          ]}
        />
      )}
    </div>
  );
}

const SECTION_TYPE_LABELS = { verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', 'pre-chorus': 'Pre-Chorus', tag: 'Tag', intro: 'Intro', outro: 'Outro' };

function SongPreviewStrip({ song, onClose, onEdit, onAddToRundown }) {
  const [fullSong, setFullSong] = useState(null);
  useEffect(() => {
    setFullSong(null);
    window.cue.songs.get(song.id).then(setFullSong);
  }, [song.id]);
  return (
    <div className="shrink-0 border-t border-outline-variant/30 bg-surface-container" style={{ maxHeight: 200 }}>
      <div className="flex items-center justify-between px-md py-xs bg-surface-container-high border-b border-outline-variant/20">
        <div className="min-w-0">
          <div className="text-label-sm font-bold text-on-surface truncate">{song.title}</div>
          {song.author && <div className="text-[10px] text-on-surface-variant uppercase tracking-[0.04em] truncate">{song.author}</div>}
        </div>
        <div className="flex gap-xs shrink-0 ml-sm">
          <button onClick={() => onAddToRundown(song.id)} className="px-sm py-[3px] rounded text-[10px] font-label-sm font-bold uppercase tracking-[0.04em] bg-primary text-on-primary hover:brightness-110 cursor-pointer">Add</button>
          <button onClick={() => onEdit(fullSong || song)} className="px-sm py-[3px] rounded text-[10px] font-label-sm uppercase tracking-[0.04em] bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant cursor-pointer">Edit</button>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-variant cursor-pointer">
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      </div>
      <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: 132 }}>
        {!fullSong ? (
          <div className="px-md py-sm text-[10px] text-on-surface-variant/50 uppercase tracking-[0.05em]">Loading…</div>
        ) : !fullSong.sections?.length ? (
          <div className="px-md py-sm text-[10px] text-on-surface-variant/50 uppercase tracking-[0.05em]">No lyrics</div>
        ) : (
          <div className="px-md py-xs divide-y divide-outline-variant/10">
            {fullSong.sections.map((s, i) => {
              const text = (s.content || '').split('⁂')[0].trim();
              if (!text) return null;
              return (
                <div key={i} className="py-xs">
                  <div className="text-[9px] text-on-surface-variant/60 uppercase tracking-[0.06em] font-label-sm mb-[2px]">
                    {SECTION_TYPE_LABELS[s.type] || s.type}
                  </div>
                  <div className="text-[11px] text-on-surface leading-snug line-clamp-2">{text}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


const TAB_ORDER = ['songs', 'media', 'scripture', 'presentations', 'graphics', 'scenes'];

export default function LibraryPanel({ onAddToRundown, onAddManyToRundown, onAddScripture, onScriptureLive, onScripturePreview, onScriptureStyleSaved, onBackgroundDefaultChanged, onAddMedia, onApplyMediaBackground, onSetPreviewBackground, previewSongLabel, onAddYouTube, onAddPresentation, onSongSave, refreshTick = 0, focusSearchRef, cycleTabRef, detectArmed, detectActive, detectDownloadPct, onToggleDetect }) {
  const toast = useToast();
  const [tab, setTab] = useState('songs');
  const [searchQuery, setSearchQuery] = useState('');
  const [songs, setSongs] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [previewSong, setPreviewSong] = useState(null);
  const [editSong, setEditSong] = useState(null);
  const [songContextMenu, setSongContextMenu] = useState(null);
  const [listHeight, setListHeight] = useState(300);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const ghsSearchRef = useRef(null);
  const searchDebounce = useRef(null);
  const listRef = useRef(null);

  // Expose a focus function so OperatorView can trigger search focus via keyboard
  // (S key). Only one of the two inputs is mounted at a time — the GHS number
  // field in the GHS folder, the normal search elsewhere — so focus whichever is.
  useEffect(() => {
    if (focusSearchRef) {
      focusSearchRef.current = () => {
        setTab('songs');
        setTimeout(() => {
          const el = ghsSearchRef.current || searchInputRef.current;
          el?.focus();
          el?.select?.();
        }, 0);
      };
    }
  }, [focusSearchRef]);

  // Imperative tab cycler driven by the operator's Tab / Shift+Tab shortcut.
  useEffect(() => {
    if (cycleTabRef) {
      cycleTabRef.current = (dir = 1) => {
        setTab((cur) => {
          const i = TAB_ORDER.indexOf(cur);
          return TAB_ORDER[(i + dir + TAB_ORDER.length) % TAB_ORDER.length];
        });
      };
    }
  }, [cycleTabRef]);

  const [mediaAssets, setMediaAssets] = useState([]);
  const [mediaSearch, setMediaSearch] = useState('');
  const [folderTree, setFolderTree] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // parsed song files awaiting confirm
  const [parsingSongs, setParsingSongs] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [ghsQuery, setGhsQuery] = useState(''); // GHS number quick-search
  const [presentations, setPresentations] = useState([]);
  const [editPresentation, setEditPresentation] = useState(null); // null=closed, {}=new, {id}=edit
  const [presContext, setPresContext] = useState(null);
  const [pptxImport, setPptxImport] = useState(false);
  const [sermonImport, setSermonImport] = useState(false);
  const [ytModal, setYtModal] = useState(false);
  const [ytInitialUrl, setYtInitialUrl] = useState('');     // pre-fill for the modal (clipboard chip)
  const [clipboardYt, setClipboardYt] = useState(null);     // YouTube link detected in the clipboard
  const clipboardSeenRef = useRef(null);                    // last clipboard link we already offered/dismissed
  const [songListModal, setSongListModal] = useState(false);
  const [scrapeModal, setScrapeModal] = useState(false);

  useEffect(() => { loadSongs(); window.cue.tags.list().then(setTags); }, [refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'media') loadMedia(); }, [tab, activeFolderId]);

  // On entering the Media library, peek at the clipboard (silent, no prompt — Electron's
  // main-process clipboard). If it holds a YouTube link, offer a one-click "add it" chip.
  // Read on tab-entry only (never polled); only acted on for a YouTube match; surfaced
  // once per distinct link (dismiss/add marks it seen) so re-entering doesn't re-nag.
  useEffect(() => {
    if (tab !== 'media' || ytModal) return;
    let cancelled = false;
    window.cue.youtube.readClipboard().then((text) => {
      if (cancelled) return;
      const link = (text || '').trim();
      if (looksLikeYouTube(link) && link !== clipboardSeenRef.current) setClipboardYt(link);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  function openYouTube(url = '') {
    setYtInitialUrl(url);
    setYtModal(true);
    if (clipboardYt) { clipboardSeenRef.current = clipboardYt; setClipboardYt(null); }
  }

  function dismissClipboardYt() {
    clipboardSeenRef.current = clipboardYt;
    setClipboardYt(null);
  }
  useEffect(() => { if (tab === 'presentations') loadPresentations(); }, [tab]);

  function loadPresentations() { window.cue.presentations.list().then(setPresentations); }

  // Re-attach on tab change: the songs subtree (and containerRef's node) unmounts
  // when another tab is active, so an observer bound only on mount would keep
  // watching a detached node and leave listHeight stale (the song list then stops
  // filling the tab). Re-running when `tab` flips to 'songs' binds the live node.
  useEffect(() => {
    if (tab !== 'songs' || !containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) setListHeight(Math.max(h - 8, 60));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [tab]);

  function loadSongs() { window.cue.songs.listAll().then(setSongs); }
  function loadMedia() {
    window.cue.media.list(activeFolderId ?? undefined).then(setMediaAssets);
    window.cue.media.folders.tree().then(setFolderTree);
  }

  const handleSearch = useCallback((q) => {
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      if (!q.trim()) window.cue.songs.listAll().then(setSongs);
      else window.cue.songs.search(q).then(setSongs);
    }, 150);
  }, []);

  useEffect(() => { handleSearch(searchQuery); }, [searchQuery, handleSearch]);

  // Reset highlight whenever the query or active tab changes.
  useEffect(() => { setHighlightIdx(-1); }, [searchQuery, tab]);

  // Clamp highlight after a debounce refresh shrinks the list.
  useEffect(() => {
    setHighlightIdx((i) => (i <= 0 ? i : Math.min(i, songs.length - 1)));
  }, [songs]);

  // Scroll the highlighted row into view using react-window's imperative API.
  useEffect(() => {
    if (highlightIdx >= 0 && listRef.current) {
      listRef.current.scrollToItem(highlightIdx, 'smart');
    }
  }, [highlightIdx]);

  const filteredSongs = selectedTagIds.length === 0
    ? songs
    : songs.filter((s) => selectedTagIds.every((tid) => (s.tags || []).some((t) => t.id === tid)));

  // GHS folder is the auto-created "GHS" tag. When it's the sole active filter we
  // show a number-only quick search and order the list by hymn number — typing a
  // number surfaces that hymn deterministically (not at the mercy of FTS ranking).
  const ghsTag = tags.find((t) => t.name === 'GHS');
  const isGhsView = !!ghsTag && selectedTagIds.length === 1 && selectedTagIds[0] === ghsTag.id;
  const ghsNumber = (title) => { const m = /^GHS\s+(\d+)/i.exec(title || ''); return m ? parseInt(m[1], 10) : null; };

  const displaySongs = isGhsView
    ? filteredSongs
        .map((s) => ({ s, n: ghsNumber(s.title) }))
        .sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity) || a.s.title.localeCompare(b.s.title))
        .filter(({ n }) => !ghsQuery || (n != null && String(n).startsWith(ghsQuery)))
        .map(({ s }) => s)
    : filteredSongs;

  // Swapping in/out of GHS view: clear the other view's query so a stale search
  // doesn't constrain the list (clearing searchQuery re-runs listAll via its effect).
  useEffect(() => {
    if (isGhsView) { if (searchQuery) setSearchQuery(''); }
    else if (ghsQuery) { setGhsQuery(''); }
  }, [isGhsView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click switches to a single tag; Shift-click adds/removes (multi-select).
  // Clicking the only active tag again clears the filter.
  function selectTag(id, additive) {
    setSelectedTagIds((prev) => {
      if (additive) return prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id];
      return prev.length === 1 && prev[0] === id ? [] : [id];
    });
  }

  // Jump straight to a hymn from the GHS number field (Enter) — preview the exact
  // number if present, else the first prefix match.
  function handleGhsEnter() {
    const exact = displaySongs.find((s) => String(ghsNumber(s.title)) === ghsQuery);
    const target = exact || displaySongs[0];
    if (target) setPreviewSong(target);
  }

  async function handleDeleteSong(song) {
    const full = await window.cue.songs.get(song.id);
    const result = await window.cue.songs.delete(song.id);
    if (result.hasReferences) {
      toast.error(`Can't delete — "${song.title}" is in ${result.count} rundown${result.count !== 1 ? 's' : ''}. Remove it from all rundowns first.`);
      return;
    }
    loadSongs();
    toast.show({
      message: `"${song.title}" deleted`,
      kind: 'info',
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          // Lossless restore: sections keep their per-run styling, plus tags,
          // the song's own default background, and the lock flag.
          const newId = await window.cue.songs.create({
            title: full.title,
            author: full.author,
            copyright: full.copyright,
            sections: (full.sections || []).map((s) => ({ type: s.type, content: s.content, style_json: s.style_json })),
            tagIds: (full.tags || []).map((t) => t.id),
          });
          if (full.default_background_id) await window.cue.songs.setBackground(newId, full.default_background_id);
          if (full.background_locked) await window.cue.songs.setLock(newId, true);
          loadSongs();
        },
      },
    });
  }

  async function handleDuplicateSong(song) {
    const full = await window.cue.songs.get(song.id);
    await window.cue.songs.create({ title: full.title + ' (copy)', author: full.author, copyright: full.copyright, sections: full.sections.map((s) => ({ type: s.type, content: s.content })) });
    loadSongs();
    toast.success(`Duplicate of "${song.title}" created`);
  }

  async function handleImportSongs() {
    const result = await window.cue.dialog.openFile({
      filters: [
        { name: 'Song files', extensions: ['db', 'xml', 'txt', 'text', 'chordpro', 'cho', 'crd', 'chopro', 'cpm', 'pro', 'onsong'] },
        { name: 'EasyWorship (Songs.db)', extensions: ['db'] },
        { name: 'OpenLyrics (XML)', extensions: ['xml'] },
        { name: 'ChordPro / Text', extensions: ['txt', 'text', 'chordpro', 'cho', 'crd', 'chopro', 'cpm', 'pro', 'onsong'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return;
    setParsingSongs(true);
    try {
      const preview = await window.cue.songs.importParse(result.filePaths);
      setImportPreview(preview);
    } finally {
      setParsingSongs(false);
    }
  }

  async function handleImportGhs() {
    setParsingSongs(true);
    try {
      const preview = await window.cue.songs.importGhs();
      setImportPreview(preview);
    } catch (e) {
      toast.error('Could not load the GHS hymnal: ' + e.message);
    } finally {
      setParsingSongs(false);
    }
  }

  function handleImportedSongs(count) {
    setImportPreview(null);
    loadSongs();
    window.cue.tags.list().then(setTags); // surface the GHS folder if it was just created
    onSongSave?.();
  }

  async function handleImportMedia() {
    const result = await window.cue.dialog.openFile({ filters: [{ name: 'Media', extensions: ['png','jpg','jpeg','gif','webp','bmp','svg','mp4','webm','mov','avi','mkv','mp3','wav','aac','flac','m4a'] }], properties: ['openFile', 'multiSelections'] });
    if (result.canceled || !result.filePaths.length) return;
    setImporting(true);
    try { await window.cue.media.import(result.filePaths); loadMedia(); } finally { setImporting(false); }
  }

  async function handleDeleteMedia(asset) {
    await window.cue.media.delete(asset.id);
    loadMedia();
    toast.show({ message: `"${asset.filename}" deleted`, kind: 'info', duration: 4000 });
  }

  async function handleDeletePresentation(pres) {
    const full = await window.cue.presentations.get(pres.id);
    await window.cue.presentations.delete(pres.id);
    loadPresentations();
    toast.show({
      message: `"${pres.title}" deleted`,
      kind: 'info',
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          await window.cue.presentations.create({
            title: full.title,
            slides: (full.slides || []).map((s) => ({ label: s.label, background_id: s.background_id, elements: s.elements })),
          });
          loadPresentations();
        },
      },
    });
  }

  async function handleSetBackground(type, asset) {
    await window.cue.settings.setGlobalBackground(type, asset.id);
    // Songs/scripture/slides read the global default live — tell OperatorView to
    // re-read it so the change shows on the rundown and output without a reload.
    onBackgroundDefaultChanged?.();
  }

  return (
    <div className="flex flex-col h-full bg-surface-container-low border-t border-outline-variant/30">
      {/* Panel header */}
      <div className="flex items-center px-md h-12 bg-surface-container-high border-b border-outline-variant/30 shrink-0">
        {/* Tabs */}
        <div className="flex h-full items-center">
          <LibTab active={tab === 'songs'} onClick={() => setTab('songs')}>
            Songs{tab === 'songs' && displaySongs.length > 0 ? ` · ${displaySongs.length}` : ''}
          </LibTab>
          <LibTab active={tab === 'media'} onClick={() => setTab('media')}>
            Media{tab === 'media' && mediaAssets.length > 0 ? ` · ${mediaAssets.length}` : ''}
          </LibTab>
          <LibTab active={tab === 'scripture'} onClick={() => setTab('scripture')}>
            Scripture
          </LibTab>
          <LibTab active={tab === 'presentations'} onClick={() => setTab('presentations')}>
            Presentations{tab === 'presentations' && presentations.length > 0 ? ` · ${presentations.length}` : ''}
          </LibTab>
          <LibTab active={tab === 'graphics'} onClick={() => setTab('graphics')}>
            Graphics
          </LibTab>
          <LibTab active={tab === 'scenes'} onClick={() => setTab('scenes')}>
            Scenes
          </LibTab>
        </div>

        <div className="ml-auto flex items-center gap-md">
          {/* GHS number quick-search — shown when the GHS folder is the active filter */}
          {tab === 'songs' && isGhsView && (
            <div className="relative">
              <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-primary text-[16px]">tag</span>
              <input
                ref={ghsSearchRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="bg-surface-container-lowest border border-primary/40 rounded-full pl-xl pr-md py-1 text-label-sm font-label-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-40 text-on-surface"
                placeholder="GHS number…"
                value={ghsQuery}
                onChange={(e) => setGhsQuery(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleGhsEnter(); }}
              />
            </div>
          )}
          {/* Search */}
          {tab === 'songs' && !isGhsView && (
            <div className="relative">
              <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant text-[16px]">
                search
              </span>
              <input
                ref={searchInputRef}
                className="bg-surface-container-lowest border border-outline-variant/30 rounded-full pl-xl pr-md py-1 text-label-sm font-label-sm focus:outline-none w-56 text-on-surface"
                placeholder="Search songs…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightIdx((i) => Math.min(i + 1, displaySongs.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightIdx((i) => Math.max(i - 1, -1));
                  } else if (e.key === 'Enter') {
                    const idx = highlightIdx >= 0 ? highlightIdx : (searchQuery.trim() ? 0 : -1);
                    if (idx >= 0 && idx < displaySongs.length) {
                      onAddToRundown(displaySongs[idx].id);
                      searchInputRef.current?.select();
                    }
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    if (searchQuery) {
                      setSearchQuery('');
                      setHighlightIdx(-1);
                    } else {
                      searchInputRef.current?.blur();
                    }
                  }
                }}
              />
            </div>
          )}

          {tab === 'songs' && (
            <div className="relative">
              <button
                onClick={() => setImportMenuOpen((o) => !o)}
                disabled={parsingSongs}
                title="Import songs"
                className="bg-surface-container border border-outline-variant/40 text-on-surface px-md py-xs rounded text-label-sm font-label-sm hover:bg-surface-container-high active:scale-95 transition-all cursor-pointer flex items-center gap-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[14px]">file_upload</span>
                {parsingSongs ? 'Reading…' : 'Import'}
                <span className="material-symbols-outlined text-[14px]">expand_more</span>
              </button>
              {importMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setImportMenuOpen(false)} />
                  <div className="absolute right-0 mt-xs w-60 bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl ring-1 ring-white/5 z-50 py-xs">
                    <button
                      onClick={() => { setImportMenuOpen(false); handleImportSongs(); }}
                      className="w-full flex items-start gap-sm px-md py-sm text-left hover:bg-surface-variant transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px] text-on-surface-variant mt-[1px]">description</span>
                      <span className="flex flex-col">
                        <span className="text-body-md text-on-surface">Import from File…</span>
                        <span className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case">EasyWorship, OpenLyrics, ChordPro, text</span>
                      </span>
                    </button>
                    <button
                      onClick={() => { setImportMenuOpen(false); handleImportGhs(); }}
                      className="w-full flex items-start gap-sm px-md py-sm text-left hover:bg-surface-variant transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px] text-primary mt-[1px]">menu_book</span>
                      <span className="flex flex-col">
                        <span className="text-body-md text-on-surface">Import GHS Hymnal</span>
                        <span className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case">260 bundled Gospel Hymns &amp; Songs</span>
                      </span>
                    </button>
                    <div className="my-xs border-t border-outline-variant/20" />
                    <button
                      onClick={() => { setImportMenuOpen(false); setScrapeModal(true); }}
                      className="w-full flex items-start gap-sm px-md py-sm text-left hover:bg-surface-variant transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px] text-primary mt-[1px]">travel_explore</span>
                      <span className="flex flex-col">
                        <span className="text-body-md text-on-surface">Find Song Online…</span>
                        <span className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case">Search the web for lyrics and add a song</span>
                      </span>
                    </button>
                    <button
                      onClick={() => { setImportMenuOpen(false); setSongListModal(true); }}
                      className="w-full flex items-start gap-sm px-md py-sm text-left hover:bg-surface-variant transition-colors cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px] text-on-surface-variant mt-[1px]">format_list_bulleted_add</span>
                      <span className="flex flex-col">
                        <span className="text-body-md text-on-surface">Paste Song List…</span>
                        <span className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case">Match a list of titles and add to rundown</span>
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {tab === 'songs' && (
            <button
              onClick={() => setEditSong({})}
              className="bg-primary text-on-primary px-md py-xs rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center gap-xs"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              New Song
            </button>
          )}
          {tab === 'media' && clipboardYt && (
            <div className="flex items-center gap-xs bg-primary/10 border border-primary/40 rounded pl-sm pr-xs py-[3px]">
              <button
                onClick={() => openYouTube(clipboardYt)}
                title={clipboardYt}
                className="flex items-center gap-xs text-label-sm font-label-sm text-primary hover:brightness-110 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">content_paste</span>
                Add YouTube link from clipboard
              </button>
              <button
                onClick={dismissClipboardYt}
                title="Dismiss"
                className="flex items-center justify-center w-4 h-4 rounded text-primary/70 hover:text-primary hover:bg-primary/15 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            </div>
          )}
          {tab === 'media' && (
            <button
              onClick={() => openYouTube()}
              title="Add a YouTube video (downloaded for this session only)"
              className="bg-surface-container border border-outline-variant/40 text-on-surface px-md py-xs rounded text-label-sm font-label-sm hover:bg-surface-container-high active:scale-95 transition-all cursor-pointer flex items-center gap-xs"
            >
              <span className="material-symbols-outlined text-[14px]">smart_display</span>
              YouTube
            </button>
          )}
          {tab === 'media' && (
            <button
              onClick={handleImportMedia}
              disabled={importing}
              className="bg-primary text-on-primary px-md py-xs rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center gap-xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[14px]">upload</span>
              {importing ? 'Importing…' : 'Import'}
            </button>
          )}
          {tab === 'presentations' && (
            <>
              <button
                onClick={() => setSermonImport(true)}
                title="Turn a sermon document into a presentation"
                className="bg-surface-container border border-outline-variant/40 text-on-surface px-md py-xs rounded text-label-sm font-label-sm hover:bg-surface-container-high active:scale-95 transition-all cursor-pointer flex items-center gap-xs"
              >
                <span className="material-symbols-outlined text-[14px]">menu_book</span>
                Sermon to Slides
              </button>
              <button
                onClick={() => setPptxImport(true)}
                title="Import a PowerPoint (.pptx) file"
                className="bg-surface-container border border-outline-variant/40 text-on-surface px-md py-xs rounded text-label-sm font-label-sm hover:bg-surface-container-high active:scale-95 transition-all cursor-pointer flex items-center gap-xs"
              >
                <span className="material-symbols-outlined text-[14px]">upload_file</span>
                Import PowerPoint
              </button>
              <button
                onClick={() => setEditPresentation({})}
                className="bg-primary text-on-primary px-md py-xs rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center gap-xs"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                New Presentation
              </button>
            </>
          )}
        </div>
      </div>

      {/* Songs tab */}
      {tab === 'songs' && (
        <div className="flex flex-1 min-h-0">
          {/* Folder/tag tree */}
          <div className="w-56 border-r border-outline-variant/30 overflow-y-auto shrink-0 flex-shrink-0">
            <ul className="text-label-sm font-label-sm text-on-surface-variant flex flex-col gap-xs p-sm">
              <li
                className={`flex items-center gap-sm p-sm rounded cursor-pointer transition-colors ${
                  selectedTagIds.length === 0 ? 'text-on-surface bg-surface-variant' : 'hover:bg-surface-variant'
                }`}
                onClick={() => setSelectedTagIds([])}
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span>All Songs</span>
              </li>
              {tags.map((tag) => {
                const active = selectedTagIds.includes(tag.id);
                return (
                  <li
                    key={tag.id}
                    className={`flex items-center gap-sm p-sm rounded cursor-pointer transition-colors ${
                      active ? 'text-on-surface' : 'hover:bg-surface-variant'
                    }`}
                    onClick={(e) => selectTag(tag.id, e.shiftKey)}
                    title="Click to filter · Shift-click to select multiple"
                    style={active ? { background: `${tag.colour || '#333539'}25` } : {}}
                  >
                    <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: tag.colour || '#8c909f' }} />
                    <span className="truncate flex-1">{tag.name}</span>
                    {tag.song_count != null && <span className="text-[10px] text-on-surface-variant/50 shrink-0 ml-auto">{tag.song_count}</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Song list + inline preview strip */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden">
            {displaySongs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-xs text-outline-variant px-lg text-center">
                <span className="material-symbols-outlined text-4xl">{searchQuery || ghsQuery ? 'search_off' : 'library_music'}</span>
                <span className="text-label-sm font-label-sm uppercase tracking-widest">
                  {searchQuery || ghsQuery ? 'No Songs Found' : 'No Songs Yet'}
                </span>
                <span className="text-[11px] text-on-surface-variant/60 max-w-[240px] leading-snug">
                  {searchQuery || ghsQuery
                    ? 'Try a different search, or clear it to see your whole library.'
                    : 'Use Import above to bring in EasyWorship / OpenLyrics / ChordPro files or the bundled GHS hymnal, or + to write a new song.'}
                </span>
              </div>
            ) : (
              <List
                ref={listRef}
                height={listHeight}
                itemCount={displaySongs.length}
                itemSize={46}
                itemData={{
                  songs: displaySongs,
                  selectedId: previewSong?.id,
                  highlightIdx,
                  onSelect: setPreviewSong,
                  onDoubleClick: (songId) => onAddToRundown(songId),
                  onContextMenu: (e, song) => { e.preventDefault(); setSongContextMenu({ x: e.clientX, y: e.clientY, song }); },
                }}
                itemKey={(index, data) => data.songs[index].id}
                width="100%"
              >
                {SongRow}
              </List>
            )}
          </div>
          {previewSong && (
            <SongPreviewStrip
              song={previewSong}
              onClose={() => setPreviewSong(null)}
              onEdit={(song) => { setPreviewSong(null); setEditSong(song); }}
              onAddToRundown={onAddToRundown}
            />
          )}
          </div>
        </div>
      )}

      {/* Media tab */}
      {tab === 'media' && (
        <div className="flex flex-1 min-h-0">
          {/* Folder tree */}
          <div className="w-56 border-r border-outline-variant/30 overflow-y-auto shrink-0 p-sm">
            <ul className="text-label-sm font-label-sm text-on-surface-variant flex flex-col gap-xs">
              <li
                className={`flex items-center gap-sm p-sm rounded cursor-pointer transition-colors ${
                  activeFolderId == null ? 'text-on-surface bg-surface-variant' : 'hover:bg-surface-variant'
                }`}
                onClick={() => setActiveFolderId(null)}
              >
                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                <span>All Files</span>
              </li>
              {folderTree.map((folder) => (
                <FolderNode key={folder.id} folder={folder} activeFolderId={activeFolderId} onSelect={setActiveFolderId} depth={0} />
              ))}
            </ul>
          </div>
          <div className="flex flex-col flex-1 min-h-0 min-w-0">
            <div className="shrink-0 px-md pt-sm pb-xs border-b border-outline-variant/20">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant text-[15px]">search</span>
                <input
                  className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-full pl-xl pr-md py-1 text-label-sm font-label-sm focus:outline-none text-on-surface"
                  placeholder="Search media…"
                  value={mediaSearch}
                  onChange={(e) => setMediaSearch(e.target.value)}
                />
              </div>
            </div>
            <MediaGrid
              assets={mediaSearch.trim() ? mediaAssets.filter((a) => a.filename.toLowerCase().includes(mediaSearch.trim().toLowerCase())) : mediaAssets}
              onDelete={handleDeleteMedia}
              onSetBackground={handleSetBackground}
              onAddToRundown={onAddMedia}
              onApplyBackground={onApplyMediaBackground}
              onSetPreviewBackground={onSetPreviewBackground}
              previewSongLabel={previewSongLabel}
            />
          </div>
        </div>
      )}

      {/* Scripture tab */}
      {tab === 'scripture' && (
        <ScripturePanel
          onAdd={onAddScripture}
          onGoLive={onScriptureLive}
          onPreview={onScripturePreview}
          onStyleSaved={onScriptureStyleSaved}
          detectArmed={detectArmed}
          detectActive={detectActive}
          detectDownloadPct={detectDownloadPct}
          onToggleDetect={onToggleDetect}
        />
      )}

      {/* Presentations tab */}
      {tab === 'presentations' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto p-md">
            {presentations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-sm text-outline-variant">
                <span className="material-symbols-outlined text-4xl">slideshow</span>
                <span className="text-label-sm font-label-sm uppercase tracking-widest">No Presentations Yet</span>
              </div>
            ) : (
              <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                {presentations.map((p) => (
                  <PresentationCard
                    key={p.id}
                    pres={p}
                    onEdit={() => setEditPresentation({ id: p.id })}
                    onAddToRundown={() => onAddPresentation?.(p.id)}
                    onContextMenu={(e) => { e.preventDefault(); setPresContext({ x: e.clientX, y: e.clientY, pres: p }); }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'graphics' && <GraphicsPanel />}

      {tab === 'scenes' && <ScenesPanel />}

      {editPresentation !== null && (
        <PresentationEditor
          presentationId={editPresentation.id || null}
          onClose={() => setEditPresentation(null)}
          onSave={() => { setEditPresentation(null); loadPresentations(); }}
        />
      )}
      {pptxImport && (
        <PptxImportModal
          onClose={() => setPptxImport(false)}
          onDone={(id) => { setPptxImport(false); loadPresentations(); setEditPresentation({ id }); }}
        />
      )}
      {sermonImport && (
        <SermonImportModal
          onClose={() => setSermonImport(false)}
          onDone={(id) => { setSermonImport(false); loadPresentations(); setEditPresentation({ id }); }}
        />
      )}
      {ytModal && (
        <AddYouTubeModal
          initialUrl={ytInitialUrl}
          onClose={() => { setYtModal(false); setYtInitialUrl(''); }}
          onConfirm={(url) => onAddYouTube?.(url)}
        />
      )}
      {presContext && (
        <ContextMenu
          x={presContext.x} y={presContext.y}
          onClose={() => setPresContext(null)}
          items={[
            { label: 'Add to Rundown', onClick: () => { onAddPresentation?.(presContext.pres.id); setPresContext(null); } },
            { label: 'Edit', onClick: () => { setEditPresentation({ id: presContext.pres.id }); setPresContext(null); } },
            { separator: true },
            { label: 'Delete', danger: true, onClick: () => { handleDeletePresentation(presContext.pres); setPresContext(null); } },
          ]}
        />
      )}

      {/* SongPreviewModal removed from click path — lyrics now shown in inline strip */}
      {editSong !== null && (
        <SongEditor song={editSong.id ? editSong : null}
          onClose={() => setEditSong(null)}
          onSave={() => { setEditSong(null); loadSongs(); window.cue.tags.list().then(setTags); onSongSave?.(); }} />
      )}
      {importPreview && (
        <SongImportModal
          preview={importPreview}
          onCancel={() => setImportPreview(null)}
          onImported={handleImportedSongs} />
      )}
      {songListModal && (
        <SongListImportModal
          onCancel={() => setSongListModal(false)}
          onAddManyToRundown={onAddManyToRundown} />
      )}
      {scrapeModal && (
        <SongScrapeModal
          onClose={() => setScrapeModal(false)}
          onSaved={() => { setScrapeModal(false); loadSongs(); window.cue.tags.list().then(setTags); onSongSave?.(); }} />
      )}
      {songContextMenu && (
        <ContextMenu
          x={songContextMenu.x} y={songContextMenu.y}
          onClose={() => setSongContextMenu(null)}
          items={[
            { label: 'Add to Rundown', onClick: () => { onAddToRundown(songContextMenu.song.id); setSongContextMenu(null); } },
            { label: 'Preview', onClick: () => { setPreviewSong(songContextMenu.song); setSongContextMenu(null); } },
            { label: 'Edit', onClick: async () => { const full = await window.cue.songs.get(songContextMenu.song.id); setEditSong(full); setSongContextMenu(null); } },
            { label: 'Duplicate', onClick: () => { handleDuplicateSong(songContextMenu.song); setSongContextMenu(null); } },
            { separator: true },
            { label: 'Delete', danger: true, onClick: () => { handleDeleteSong(songContextMenu.song); setSongContextMenu(null); } },
          ]}
        />
      )}
    </div>
  );
}

function PresentationCard({ pres, onEdit, onAddToRundown, onContextMenu }) {
  const clickTimer = useRef(null);
  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current); }, []);

  function handleClick() {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      onAddToRundown?.();
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        onEdit?.();
      }, 220);
    }
  }

  return (
    <div
      onClick={handleClick}
      onContextMenu={onContextMenu}
      title="Click to edit · Double-click to add to rundown"
      className="group text-left rounded-lg border border-outline-variant/30 bg-surface-container hover:border-primary/50 overflow-hidden transition-all cursor-pointer"
    >
      {pres.first_slide_elements?.length ? (
        <StaticSlide elements={pres.first_slide_elements} backgroundPath={pres.first_slide_bg_path} />
      ) : (
        <div className="relative bg-black flex items-center justify-center" style={{ aspectRatio: '16 / 9' }}>
          <span className="material-symbols-outlined text-outline-variant text-4xl group-hover:text-primary transition-colors">slideshow</span>
        </div>
      )}
      <div className="px-sm py-xs">
        <p className="text-body-md text-on-surface truncate">{pres.title}</p>
        <p className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wide">{pres.slide_count} slide{pres.slide_count === 1 ? '' : 's'}</p>
      </div>
    </div>
  );
}

function LibTab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`h-full px-lg text-label-sm font-label-sm cursor-pointer transition-colors ${
        active
          ? 'text-primary border-b-2 border-primary'
          : 'text-on-surface-variant hover:bg-surface-variant border-b-2 border-transparent'
      }`}
    >
      {children}
    </button>
  );
}

function FolderNode({ folder, activeFolderId, onSelect, depth }) {
  const isActive = activeFolderId === folder.id;
  return (
    <>
      <li
        className={`flex items-center gap-sm p-sm rounded cursor-pointer transition-colors ${
          isActive ? 'text-on-surface bg-surface-variant' : 'hover:bg-surface-variant'
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => onSelect(folder.id)}
      >
        <span className="material-symbols-outlined text-[16px]">folder</span>
        <span className="truncate">{folder.name}</span>
      </li>
      {folder.children?.map((child) => (
        <FolderNode key={child.id} folder={child} activeFolderId={activeFolderId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </>
  );
}
