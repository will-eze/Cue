import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FixedSizeList as List } from 'react-window';
import SongPreviewModal from '../components/SongPreviewModal';
import SongEditor from '../components/SongEditor';
import ContextMenu from '../components/ContextMenu';

function SongRow({ index, style, data }) {
  const { songs, selectedId, onSelect, onDoubleClick, onContextMenu } = data;
  const song = songs[index];
  return (
    <div
      style={style}
      onClick={() => onSelect(song)}
      onDoubleClick={() => onDoubleClick(song.id)}
      onContextMenu={(e) => onContextMenu(e, song)}
      className={`flex items-center gap-3 px-3 cursor-pointer border-b border-slate-800 transition-colors hover:bg-slate-800 ${
        selectedId === song.id ? 'bg-slate-800' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-slate-200 truncate">{song.title}</div>
        {song.author && <div className="text-[11px] text-slate-500 truncate">{song.author}</div>}
      </div>
      <div className="flex gap-1 flex-shrink-0">
        {(song.tags || []).slice(0, 3).map((tag) => (
          <span
            key={tag.id}
            className="text-[10px] px-1.5 py-0.5 rounded-sm text-white font-medium"
            style={{ backgroundColor: tag.colour || '#1A6FBA' }}
          >
            {tag.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function MediaGrid({ assets, onDelete, onSetBackground }) {
  const [contextMenu, setContextMenu] = useState(null);

  function typeLabel(type) {
    if (type === 'video') return 'VID';
    if (type === 'audio') return 'AUD';
    return 'IMG';
  }

  return (
    <div className="flex-1 overflow-y-auto p-2">
      {assets.length === 0 ? (
        <div className="flex items-center justify-center h-full text-slate-600 text-[12px]">
          No media — import files above
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="bg-slate-800 border border-slate-700 rounded-sm overflow-hidden cursor-pointer hover:border-slate-500 transition-colors"
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, asset }); }}
            >
              {asset.type === 'image' ? (
                <div className="aspect-video bg-black">
                  <img
                    src={`file://${asset.path}`}
                    className="w-full h-full object-cover"
                    alt={asset.filename}
                  />
                </div>
              ) : asset.type === 'video' ? (
                <div className="aspect-video bg-black relative">
                  <video
                    src={`file://${asset.path}`}
                    className="w-full h-full object-cover"
                    muted
                  />
                  <span className="absolute top-1 right-1 text-[9px] font-bold tracking-wider bg-black/80 text-slate-300 px-1 py-0.5 rounded-sm">
                    VID
                  </span>
                </div>
              ) : (
                <div className="aspect-video bg-slate-700 flex items-center justify-center">
                  <span className="text-[11px] font-bold tracking-wider text-slate-500">{typeLabel(asset.type)}</span>
                </div>
              )}
              <div className="px-2 py-1">
                <div className="text-[11px] text-slate-300 truncate">{asset.filename}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Set as Global Song Background',
              onClick: () => { onSetBackground('song', contextMenu.asset); setContextMenu(null); },
            },
            {
              label: 'Set as Global Slide Background',
              onClick: () => { onSetBackground('slide', contextMenu.asset); setContextMenu(null); },
            },
            { separator: true },
            {
              label: 'Delete',
              danger: true,
              onClick: () => { onDelete(contextMenu.asset); setContextMenu(null); },
            },
          ]}
        />
      )}
    </div>
  );
}

export default function LibraryPanel({ onAddToRundown, onSongSave }) {
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
  const searchDebounce = useRef(null);
  const [mediaAssets, setMediaAssets] = useState([]);
  const [folderTree, setFolderTree] = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    loadSongs();
    window.cue.tags.list().then(setTags);
  }, []);

  useEffect(() => {
    if (tab === 'media') loadMedia();
  }, [tab, activeFolderId]);

  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h) setListHeight(Math.max(h - 8, 60));
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  function loadSongs() {
    window.cue.songs.listAll().then(setSongs);
  }

  function loadMedia() {
    window.cue.media.list(activeFolderId ?? undefined).then(setMediaAssets);
    window.cue.media.folders.tree().then(setFolderTree);
  }

  const handleSearch = useCallback((q) => {
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      if (!q.trim()) {
        window.cue.songs.listAll().then(setSongs);
      } else {
        window.cue.songs.search(q).then(setSongs);
      }
    }, 150);
  }, []);

  useEffect(() => {
    handleSearch(searchQuery);
  }, [searchQuery, handleSearch]);

  const filteredSongs = selectedTagIds.length === 0
    ? songs
    : songs.filter((s) =>
        selectedTagIds.every((tid) => (s.tags || []).some((t) => t.id === tid))
      );

  function toggleTag(id) {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function handleDeleteSong(song) {
    const result = await window.cue.songs.delete(song.id);
    if (result.hasReferences) {
      alert(`This song is used in ${result.count} rundown item(s). Remove it from all rundowns first.`);
    } else {
      loadSongs();
    }
  }

  async function handleDuplicateSong(song) {
    const full = await window.cue.songs.get(song.id);
    await window.cue.songs.create({
      title: full.title + ' (copy)',
      author: full.author,
      copyright: full.copyright,
      sections: full.sections.map((s) => ({ type: s.type, content: s.content })),
    });
    loadSongs();
  }

  async function handleImportMedia() {
    const result = await window.cue.dialog.openFile({
      filters: [
        {
          name: 'Media',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg',
                       'mp4', 'webm', 'mov', 'avi', 'mkv',
                       'mp3', 'wav', 'aac', 'flac', 'm4a'],
        },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return;
    setImporting(true);
    try {
      await window.cue.media.import(result.filePaths);
      loadMedia();
    } finally {
      setImporting(false);
    }
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
    <div className="flex flex-col h-full bg-slate-950">
      {/* Panel header */}
      <div className="panel-header gap-2">
        {/* Tabs */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setTab('songs')}
            className={`h-5 px-2.5 text-[11px] font-medium rounded-sm transition-colors cursor-pointer ${
              tab === 'songs'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            Songs{tab === 'songs' && filteredSongs.length > 0 ? ` (${filteredSongs.length})` : ''}
          </button>
          <button
            onClick={() => setTab('media')}
            className={`h-5 px-2.5 text-[11px] font-medium rounded-sm transition-colors cursor-pointer ${
              tab === 'media'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            Media{tab === 'media' && mediaAssets.length > 0 ? ` (${mediaAssets.length})` : ''}
          </button>
        </div>

        <div className="flex-1" />

        {tab === 'songs' && (
          <input
            className="bg-slate-700 text-slate-200 text-[11px] rounded-sm px-2 h-5 border border-slate-600 outline-none focus:border-indigo-500 w-44"
            placeholder="Search songs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        )}
        {tab === 'songs' && (
          <button
            onClick={() => setEditSong({})}
            className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white h-5 px-2 rounded-sm transition-colors cursor-pointer"
          >
            + New Song
          </button>
        )}
        {tab === 'media' && (
          <button
            onClick={handleImportMedia}
            disabled={importing}
            className="text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white h-5 px-2 rounded-sm transition-colors cursor-pointer"
          >
            {importing ? 'Importing…' : '+ Import'}
          </button>
        )}
      </div>

      {/* Songs tab */}
      {tab === 'songs' && (
        <div className="flex flex-1 min-h-0">
          {tags.length > 0 && (
            <div className="w-28 flex-shrink-0 border-r border-slate-800 overflow-y-auto p-2 flex flex-col gap-0.5">
              <span className="panel-label mb-1">Tags</span>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={`text-[11px] px-2 py-1 rounded-sm text-left transition-colors cursor-pointer ${
                    selectedTagIds.includes(tag.id) ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  style={selectedTagIds.includes(tag.id) ? { backgroundColor: tag.colour || '#1A6FBA' } : {}}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}

          <div ref={containerRef} className="flex-1 min-w-0 overflow-hidden">
            {filteredSongs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-600 text-[12px]">
                {searchQuery ? 'No songs found' : 'No songs yet — add one above'}
              </div>
            ) : (
              <List
                height={listHeight}
                itemCount={filteredSongs.length}
                itemSize={52}
                itemData={{
                  songs: filteredSongs,
                  selectedId: previewSong?.id,
                  onSelect: setPreviewSong,
                  onDoubleClick: (songId) => onAddToRundown(songId),
                  onContextMenu: (e, song) => {
                    e.preventDefault();
                    setSongContextMenu({ x: e.clientX, y: e.clientY, song });
                  },
                }}
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
          <div className="w-36 flex-shrink-0 border-r border-slate-800 overflow-y-auto p-2">
            <button
              onClick={() => setActiveFolderId(null)}
              className={`text-[11px] px-2 py-1 rounded-sm w-full text-left mb-0.5 cursor-pointer transition-colors ${
                activeFolderId == null
                  ? 'bg-indigo-700 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Files
            </button>
            {folderTree.map((folder) => (
              <FolderNode
                key={folder.id}
                folder={folder}
                activeFolderId={activeFolderId}
                onSelect={setActiveFolderId}
                depth={0}
              />
            ))}
          </div>

          <MediaGrid
            assets={mediaAssets}
            onDelete={handleDeleteMedia}
            onSetBackground={handleSetBackground}
          />
        </div>
      )}

      {previewSong && (
        <SongPreviewModal
          song={previewSong}
          onClose={() => setPreviewSong(null)}
          onEdit={(song) => { setPreviewSong(null); setEditSong(song); }}
          onAddToRundown={(songId) => { onAddToRundown(songId); setPreviewSong(null); }}
        />
      )}

      {editSong !== null && (
        <SongEditor
          song={editSong.id ? editSong : null}
          onClose={() => setEditSong(null)}
          onSave={() => { setEditSong(null); loadSongs(); onSongSave?.(); }}
        />
      )}

      {songContextMenu && (
        <ContextMenu
          x={songContextMenu.x}
          y={songContextMenu.y}
          onClose={() => setSongContextMenu(null)}
          items={[
            {
              label: 'Add to Rundown',
              onClick: () => { onAddToRundown(songContextMenu.song.id); setSongContextMenu(null); },
            },
            {
              label: 'Preview',
              onClick: () => { setPreviewSong(songContextMenu.song); setSongContextMenu(null); },
            },
            {
              label: 'Edit',
              onClick: async () => {
                const full = await window.cue.songs.get(songContextMenu.song.id);
                setEditSong(full);
                setSongContextMenu(null);
              },
            },
            {
              label: 'Duplicate',
              onClick: () => { handleDuplicateSong(songContextMenu.song); setSongContextMenu(null); },
            },
            { separator: true },
            {
              label: 'Delete',
              danger: true,
              onClick: () => { handleDeleteSong(songContextMenu.song); setSongContextMenu(null); },
            },
          ]}
        />
      )}
    </div>
  );
}

function FolderNode({ folder, activeFolderId, onSelect, depth }) {
  return (
    <>
      <button
        onClick={() => onSelect(folder.id)}
        className={`text-[11px] px-2 py-1 rounded-sm w-full text-left mb-0.5 cursor-pointer transition-colors flex items-center gap-1.5 ${
          activeFolderId === folder.id
            ? 'bg-indigo-700 text-white'
            : 'text-slate-400 hover:text-slate-200'
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="flex-shrink-0 opacity-60">
          <path d="M2 4a2 2 0 0 1 2-2h3.5l1.5 2H12a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z"/>
        </svg>
        {folder.name}
      </button>
      {folder.children?.map((child) => (
        <FolderNode
          key={child.id}
          folder={child}
          activeFolderId={activeFolderId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  );
}
