import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FixedSizeList as List } from 'react-window';
import SongPreviewModal from '../components/SongPreviewModal';
import SongEditor from '../components/SongEditor';
import ContextMenu from '../components/ContextMenu';
import { mediaUrl } from '../utils/mediaUrl';

function SongRow({ index, style, data }) {
  const { songs, selectedId, onSelect, onDoubleClick, onContextMenu } = data;
  const song = songs[index];
  const isSelected = selectedId === song.id;
  const clickTimer = useRef(null);

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
        background: isSelected ? 'rgba(77,142,255,0.1)' : undefined,
        transition: 'background 80ms',
      }}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, song)}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(51,53,57,0.5)'; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
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

function MediaGrid({ assets, onDelete, onSetBackground }) {
  const [contextMenu, setContextMenu] = useState(null);

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
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, asset }); }}
            >
              <div className="aspect-video rounded bg-black border border-outline-variant overflow-hidden mb-xs relative">
                {asset.type === 'image' ? (
                  <img src={mediaUrl(asset.path)}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                    alt={asset.filename}
                    loading="lazy" />
                ) : asset.type === 'video' ? (
                  <>
                    <video src={mediaUrl(asset.path)}
                      className="w-full h-full object-cover"
                      muted />
                    <div className="absolute bottom-1 right-1 bg-black/50 px-1 rounded text-[8px] text-white font-label-sm">VID</div>
                  </>
                ) : (
                  <div className="w-full h-full bg-surface-container-high flex items-center justify-center">
                    <span className="text-label-sm font-label-sm text-outline-variant">AUD</span>
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
            { label: 'Set as Global Song Background', onClick: () => { onSetBackground('song', contextMenu.asset); setContextMenu(null); } },
            { label: 'Set as Global Slide Background', onClick: () => { onSetBackground('slide', contextMenu.asset); setContextMenu(null); } },
            { separator: true },
            { label: 'Delete', danger: true, onClick: () => { onDelete(contextMenu.asset); setContextMenu(null); } },
          ]}
        />
      )}
    </div>
  );
}

export default function LibraryPanel({ onAddToRundown, onSongSave, refreshTick = 0, focusSearchRef }) {
  const [tab, setTab] = useState('songs');
  const [searchQuery, setSearchQuery] = useState('');
  const [songs, setSongs] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [previewSong, setPreviewSong] = useState(null);
  const [editSong, setEditSong] = useState(null);
  const [songContextMenu, setSongContextMenu] = useState(null);
  const [listHeight, setListHeight] = useState(300);
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);
  const searchDebounce = useRef(null);

  // Expose a focus function so OperatorView can trigger search focus via keyboard (S key)
  useEffect(() => {
    if (focusSearchRef) {
      focusSearchRef.current = () => {
        setTab('songs');
        setTimeout(() => { searchInputRef.current?.focus(); searchInputRef.current?.select(); }, 0);
      };
    }
  }, [focusSearchRef]);
  const [mediaAssets, setMediaAssets] = useState([]);
  const [folderTree, setFolderTree] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => { loadSongs(); window.cue.tags.list().then(setTags); }, [refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'media') loadMedia(); }, [tab, activeFolderId]);

  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) setListHeight(Math.max(h - 8, 60));
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

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

  const filteredSongs = selectedTagIds.length === 0
    ? songs
    : songs.filter((s) => selectedTagIds.every((tid) => (s.tags || []).some((t) => t.id === tid)));

  function toggleTag(id) {
    setSelectedTagIds((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  }

  async function handleDeleteSong(song) {
    if (!confirm(`Delete "${song.title}"? This cannot be undone.`)) return;
    const result = await window.cue.songs.delete(song.id);
    if (result.hasReferences) {
      alert(`"${song.title}" is used in ${result.count} rundown item(s). Remove it from all rundowns first.`);
    } else {
      loadSongs();
    }
  }

  async function handleDuplicateSong(song) {
    const full = await window.cue.songs.get(song.id);
    await window.cue.songs.create({ title: full.title + ' (copy)', author: full.author, copyright: full.copyright, sections: full.sections.map((s) => ({ type: s.type, content: s.content })) });
    loadSongs();
  }

  async function handleImportMedia() {
    const result = await window.cue.dialog.openFile({ filters: [{ name: 'Media', extensions: ['png','jpg','jpeg','gif','webp','bmp','svg','mp4','webm','mov','avi','mkv','mp3','wav','aac','flac','m4a'] }], properties: ['openFile', 'multiSelections'] });
    if (result.canceled || !result.filePaths.length) return;
    setImporting(true);
    try { await window.cue.media.import(result.filePaths); loadMedia(); } finally { setImporting(false); }
  }

  async function handleDeleteMedia(asset) {
    if (!confirm(`Delete "${asset.filename}"? This cannot be undone.`)) return;
    await window.cue.media.delete(asset.id);
    loadMedia();
  }

  async function handleSetBackground(type, asset) {
    await window.cue.settings.setGlobalBackground(type, asset.id);
  }

  return (
    <div className="flex flex-col h-full bg-surface-container-low border-t border-outline-variant/30">
      {/* Panel header */}
      <div className="flex items-center px-md h-12 bg-surface-container-high border-b border-outline-variant/30 shrink-0">
        {/* Tabs */}
        <div className="flex h-full items-center">
          <LibTab active={tab === 'songs'} onClick={() => setTab('songs')}>
            Songs{tab === 'songs' && filteredSongs.length > 0 ? ` · ${filteredSongs.length}` : ''}
          </LibTab>
          <LibTab active={tab === 'media'} onClick={() => setTab('media')}>
            Media{tab === 'media' && mediaAssets.length > 0 ? ` · ${mediaAssets.length}` : ''}
          </LibTab>
        </div>

        <div className="ml-auto flex items-center gap-md">
          {/* Search */}
          {tab === 'songs' && (
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
              />
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
        </div>
      </div>

      {/* Songs tab */}
      {tab === 'songs' && (
        <div className="flex flex-1 min-h-0">
          {/* Folder/tag tree */}
          <div className="w-56 border-r border-outline-variant/30 overflow-y-auto shrink-0">
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
                    onClick={() => toggleTag(tag.id)}
                    style={active ? { background: `${tag.colour || '#333539'}25` } : {}}
                  >
                    <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: tag.colour || '#8c909f' }} />
                    <span className="truncate">{tag.name}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Song list */}
          <div ref={containerRef} className="flex-1 min-w-0 overflow-hidden">
            {filteredSongs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-sm text-outline-variant">
                <span className="material-symbols-outlined text-4xl">music_note</span>
                <span className="text-label-sm font-label-sm uppercase tracking-widest">
                  {searchQuery ? 'No Songs Found' : 'No Songs Yet'}
                </span>
              </div>
            ) : (
              <List
                height={listHeight}
                itemCount={filteredSongs.length}
                itemSize={46}
                itemData={{
                  songs: filteredSongs,
                  selectedId: previewSong?.id,
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
          <MediaGrid assets={mediaAssets} onDelete={handleDeleteMedia} onSetBackground={handleSetBackground} />
        </div>
      )}

      {previewSong && (
        <SongPreviewModal song={previewSong} onClose={() => setPreviewSong(null)}
          onEdit={(song) => { setPreviewSong(null); setEditSong(song); }}
          onAddToRundown={(songId) => { onAddToRundown(songId); setPreviewSong(null); }} />
      )}
      {editSong !== null && (
        <SongEditor song={editSong.id ? editSong : null}
          onClose={() => setEditSong(null)}
          onSave={() => { setEditSong(null); loadSongs(); onSongSave?.(); }} />
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
