import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FixedSizeList as List } from 'react-window';
import SongPreviewModal from '../components/SongPreviewModal';
import SongEditor from '../components/SongEditor';
import ContextMenu from '../components/ContextMenu';

function SongRow({ index, style, data }) {
  const { songs, selectedId, onSelect, onDoubleClick, onContextMenu } = data;
  const song = songs[index];
  const isSelected = selectedId === song.id;
  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        cursor: 'pointer',
        borderBottom: '1px solid #0D101A',
        background: isSelected ? '#0E1120' : undefined,
        transition: 'background 100ms',
      }}
      onClick={() => onSelect(song)}
      onDoubleClick={() => onDoubleClick(song.id)}
      onContextMenu={(e) => onContextMenu(e, song)}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#0A0C16'; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
    >
      {/* Music icon */}
      <span style={{ color: '#2A2E42', flexShrink: 0 }}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 2v9.27A3 3 0 1 0 8 14V6l6-1V3L6 2z"/>
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <div style={{
          fontSize: 12.5,
          fontWeight: 500,
          color: isSelected ? '#E8EBF5' : '#A8AEBE',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          letterSpacing: '0.01em',
        }}>
          {song.title}
        </div>
        {song.author && (
          <div style={{
            fontSize: 10.5,
            color: '#333852',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 1,
          }}>
            {song.author}
          </div>
        )}
      </div>
      <div className="flex gap-1 flex-shrink-0">
        {(song.tags || []).slice(0, 3).map((tag) => (
          <span
            key={tag.id}
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '0.08em',
              padding: '1px 6px',
              borderRadius: 2,
              color: 'rgba(255,255,255,0.85)',
              background: tag.colour || '#1A4A8A',
            }}
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

  return (
    <div className="flex-1 overflow-y-auto" style={{ padding: 8 }}>
      {assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: '#2A2E42' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span style={{ fontSize: 11, letterSpacing: '0.06em' }}>No media — import files above</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="cursor-pointer overflow-hidden transition-all"
              style={{
                background: '#0A0C14',
                border: '1px solid #1A1D27',
                borderRadius: 3,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#333852'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#1A1D27'; }}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, asset }); }}
            >
              {asset.type === 'image' ? (
                <div style={{ aspectRatio: '16/9', background: '#000' }}>
                  <img
                    src={`file://${asset.path}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    alt={asset.filename}
                  />
                </div>
              ) : asset.type === 'video' ? (
                <div style={{ aspectRatio: '16/9', background: '#000', position: 'relative' }}>
                  <video
                    src={`file://${asset.path}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    muted
                  />
                  <span style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    fontSize: 8.5,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    background: 'rgba(0,0,0,0.8)',
                    color: '#7A82A0',
                    padding: '1px 4px',
                    borderRadius: 2,
                  }}>
                    VID
                  </span>
                </div>
              ) : (
                <div style={{ aspectRatio: '16/9', background: '#0E1018', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#2A2E42' }}>AUD</span>
                </div>
              )}
              <div style={{ padding: '4px 7px 5px' }}>
                <div style={{ fontSize: 10.5, color: '#6B7291', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {asset.filename}
                </div>
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
    <div className="flex flex-col h-full" style={{ background: '#060810' }}>
      {/* Panel header */}
      <div className="panel-header gap-2">
        {/* Accent + label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={{ width: 2, height: 14, background: '#22C55E', borderRadius: 1 }} />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5">
          <LibTab active={tab === 'songs'} onClick={() => setTab('songs')}>
            Songs{tab === 'songs' && filteredSongs.length > 0 ? ` (${filteredSongs.length})` : ''}
          </LibTab>
          <LibTab active={tab === 'media'} onClick={() => setTab('media')}>
            Media{tab === 'media' && mediaAssets.length > 0 ? ` (${mediaAssets.length})` : ''}
          </LibTab>
        </div>

        <div className="flex-1" />

        {/* Search */}
        {tab === 'songs' && (
          <div className="flex items-center" style={{
            background: '#0A0C14',
            border: '1px solid #1A1D27',
            borderRadius: 3,
            height: 22,
            padding: '0 7px',
            gap: 6,
          }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#2A2E42" strokeWidth="2" strokeLinecap="round">
              <circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/>
            </svg>
            <input
              className="outline-none bg-transparent"
              style={{
                fontSize: 11,
                color: '#DEE2F0',
                width: 140,
              }}
              placeholder="Search songs…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}

        {/* Action button */}
        {tab === 'songs' && (
          <ActionButton onClick={() => setEditSong({})}>+ New Song</ActionButton>
        )}
        {tab === 'media' && (
          <ActionButton onClick={handleImportMedia} disabled={importing}>
            {importing ? 'Importing…' : '+ Import'}
          </ActionButton>
        )}
      </div>

      {/* Songs tab */}
      {tab === 'songs' && (
        <div className="flex flex-1 min-h-0">
          {/* Tag filter sidebar */}
          {tags.length > 0 && (
            <div className="flex-shrink-0 overflow-y-auto" style={{
              width: 112,
              borderRight: '1px solid #12151F',
              padding: '8px 6px',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}>
              <span className="panel-label" style={{ marginBottom: 4, paddingLeft: 4 }}>Tags</span>
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className="cursor-pointer text-left transition-all"
                  style={{
                    fontSize: 11,
                    fontWeight: selectedTagIds.includes(tag.id) ? 600 : 400,
                    padding: '4px 8px',
                    borderRadius: 3,
                    border: selectedTagIds.includes(tag.id)
                      ? `1px solid ${tag.colour || '#1A6FBA'}40`
                      : '1px solid transparent',
                    background: selectedTagIds.includes(tag.id) ? `${tag.colour || '#1A6FBA'}20` : 'transparent',
                    color: selectedTagIds.includes(tag.id) ? '#DEE2F0' : '#3A3F52',
                  }}
                  onMouseEnter={(e) => { if (!selectedTagIds.includes(tag.id)) e.currentTarget.style.color = '#7A82A0'; }}
                  onMouseLeave={(e) => { if (!selectedTagIds.includes(tag.id)) e.currentTarget.style.color = '#3A3F52'; }}
                >
                  <span style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: tag.colour || '#1A6FBA',
                    marginRight: 6,
                    verticalAlign: 'middle',
                  }} />
                  {tag.name}
                </button>
              ))}
            </div>
          )}

          <div ref={containerRef} className="flex-1 min-w-0 overflow-hidden">
            {filteredSongs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: '#2A2E42' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M9 18V5l12-2v13"/>
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="16" r="3"/>
                </svg>
                <span style={{ fontSize: 11, letterSpacing: '0.06em' }}>
                  {searchQuery ? 'No songs found' : 'No songs yet — add one above'}
                </span>
              </div>
            ) : (
              <List
                height={listHeight}
                itemCount={filteredSongs.length}
                itemSize={48}
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
          {/* Folder sidebar */}
          <div className="flex-shrink-0 overflow-y-auto" style={{
            width: 130,
            borderRight: '1px solid #12151F',
            padding: '8px 6px',
          }}>
            <button
              onClick={() => setActiveFolderId(null)}
              className="cursor-pointer w-full text-left transition-all"
              style={{
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 3,
                marginBottom: 2,
                background: activeFolderId == null ? 'rgba(79,110,247,0.15)' : 'transparent',
                border: activeFolderId == null ? '1px solid rgba(79,110,247,0.3)' : '1px solid transparent',
                color: activeFolderId == null ? '#A5B4FC' : '#3A3F52',
                fontWeight: activeFolderId == null ? 600 : 400,
              }}
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

      {/* Modals */}
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

function LibTab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer transition-all"
      style={{
        height: 22,
        padding: '0 10px',
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 3,
        border: active ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent',
        background: active ? 'rgba(34,197,94,0.1)' : 'transparent',
        color: active ? '#4ADE80' : '#3A3F52',
        letterSpacing: '0.02em',
      }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = '#7A82A0'; }}}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = '#3A3F52'; }}}
    >
      {children}
    </button>
  );
}

function ActionButton({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer transition-all"
      style={{
        fontSize: 11,
        fontWeight: 600,
        height: 22,
        padding: '0 10px',
        borderRadius: 3,
        background: disabled ? '#0A0C14' : 'linear-gradient(180deg, #2A3A8A 0%, #1E2D72 100%)',
        border: disabled ? '1px solid #1A1D27' : '1px solid rgba(79,110,247,0.45)',
        color: disabled ? '#2A2E42' : '#A5B4FC',
      }}
    >
      {children}
    </button>
  );
}

function FolderNode({ folder, activeFolderId, onSelect, depth }) {
  const isActive = activeFolderId === folder.id;
  return (
    <>
      <button
        onClick={() => onSelect(folder.id)}
        className="cursor-pointer w-full text-left transition-all"
        style={{
          fontSize: 11,
          padding: `4px 8px 4px ${8 + depth * 12}px`,
          borderRadius: 3,
          marginBottom: 2,
          background: isActive ? 'rgba(79,110,247,0.15)' : 'transparent',
          border: isActive ? '1px solid rgba(79,110,247,0.3)' : '1px solid transparent',
          color: isActive ? '#A5B4FC' : '#3A3F52',
          fontWeight: isActive ? 600 : 400,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
        onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = '#7A82A0'; }}}
        onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = '#3A3F52'; }}}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5, flexShrink: 0 }}>
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
