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
        borderBottom: '1px solid #0F0D0A',
        background: isSelected ? '#181510' : undefined,
        transition: 'background 80ms',
      }}
      onClick={() => onSelect(song)}
      onDoubleClick={() => onDoubleClick(song.id)}
      onContextMenu={(e) => onContextMenu(e, song)}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#121008'; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ''; }}
    >
      <span style={{ color: '#2A2218', flexShrink: 0 }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6 2v9.27A3 3 0 1 0 8 14V6l6-1V3L6 2z"/>
        </svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12.5,
          fontWeight: 500,
          letterSpacing: '0.01em',
          color: isSelected ? '#D0C8BE' : '#807060',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {song.title}
        </div>
        {song.author && (
          <div style={{
            fontSize: 10.5,
            color: '#2E2820',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 1,
          }}>
            {song.author}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {(song.tags || []).slice(0, 3).map((tag) => (
          <span key={tag.id} style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: '0.1em',
            padding: '1px 6px',
            borderRadius: 1,
            color: 'rgba(255,255,255,0.75)',
            background: tag.colour || '#4A3410',
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
    <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
      {assets.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: '#2E2820' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
            No Media — Import Above
          </span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {assets.map((asset) => (
            <div
              key={asset.id}
              style={{
                background: '#0F0D0A',
                border: '1px solid #201D18',
                borderRadius: 2,
                overflow: 'hidden',
                cursor: 'pointer',
                transition: 'border-color 100ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3A332A'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#201D18'; }}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, asset }); }}
            >
              {asset.type === 'image' ? (
                <div style={{ aspectRatio: '16/9', background: '#000' }}>
                  <img src={`file://${asset.path}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    alt={asset.filename} />
                </div>
              ) : asset.type === 'video' ? (
                <div style={{ aspectRatio: '16/9', background: '#000', position: 'relative' }}>
                  <video src={`file://${asset.path}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    muted />
                  <span style={{
                    position: 'absolute', top: 4, right: 4,
                    fontFamily: "'Oswald', sans-serif",
                    fontSize: 8.5, fontWeight: 500, letterSpacing: '0.14em',
                    background: 'rgba(0,0,0,0.85)', color: '#7A7068',
                    padding: '1px 4px', borderRadius: 1,
                  }}>VID</span>
                </div>
              ) : (
                <div style={{ aspectRatio: '16/9', background: '#141210', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: '0.16em', color: '#2E2820' }}>AUD</span>
                </div>
              )}
              <div style={{ padding: '4px 7px 5px' }}>
                <div style={{ fontSize: 10.5, color: '#504540', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {asset.filename}
                </div>
              </div>
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

  useEffect(() => { loadSongs(); window.cue.tags.list().then(setTags); }, []);
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
    const result = await window.cue.songs.delete(song.id);
    if (result.hasReferences) alert(`This song is used in ${result.count} rundown item(s). Remove it from all rundowns first.`);
    else loadSongs();
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0C0A08' }}>
      {/* Panel header */}
      <div className="panel-header" style={{ gap: 10 }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2 }}>
          <LibTab active={tab === 'songs'} onClick={() => setTab('songs')}>
            Songs{tab === 'songs' && filteredSongs.length > 0 ? ` · ${filteredSongs.length}` : ''}
          </LibTab>
          <LibTab active={tab === 'media'} onClick={() => setTab('media')}>
            Media{tab === 'media' && mediaAssets.length > 0 ? ` · ${mediaAssets.length}` : ''}
          </LibTab>
        </div>

        <div style={{ flex: 1 }} />

        {/* Search */}
        {tab === 'songs' && (
          <div style={{
            display: 'flex', alignItems: 'center',
            background: '#0F0D0A',
            border: '1px solid #2A2520',
            borderRadius: 2,
            height: 20,
            padding: '0 7px',
            gap: 5,
          }}>
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="#3A332A" strokeWidth="2" strokeLinecap="round">
              <circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/>
            </svg>
            <input
              className="outline-none bg-transparent"
              style={{ fontSize: 11, color: '#C8C0B6', width: 130, fontFamily: "'Inter', sans-serif" }}
              placeholder="Search songs…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}

        {tab === 'songs' && <AmberButton onClick={() => setEditSong({})}>+ New Song</AmberButton>}
        {tab === 'media' && (
          <AmberButton onClick={handleImportMedia} disabled={importing}>
            {importing ? 'Importing…' : '+ Import'}
          </AmberButton>
        )}
      </div>

      {/* Songs tab */}
      {tab === 'songs' && (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {tags.length > 0 && (
            <div style={{ width: 108, flexShrink: 0, borderRight: '1px solid #181510', overflowY: 'auto', padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="panel-label" style={{ fontSize: 8.5, marginBottom: 4, paddingLeft: 4 }}>Filter</span>
              {tags.map((tag) => {
                const active = selectedTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className="cursor-pointer text-left"
                    style={{
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 11,
                      fontWeight: active ? 500 : 400,
                      padding: '4px 8px',
                      borderRadius: 2,
                      border: active ? `1px solid ${tag.colour || '#4A3410'}60` : '1px solid transparent',
                      background: active ? `${tag.colour || '#4A3410'}18` : 'transparent',
                      color: active ? '#C8C0B6' : '#3A332A',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      transition: 'all 80ms',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = '#7A7068'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#3A332A'; }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: tag.colour || '#C8780A', flexShrink: 0 }} />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
          <div ref={containerRef} style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            {filteredSongs.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: '#2E2820' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                </svg>
                <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
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
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: 120, flexShrink: 0, borderRight: '1px solid #181510', overflowY: 'auto', padding: '8px 6px' }}>
            <FolderBtn active={activeFolderId == null} onClick={() => setActiveFolderId(null)}>All Files</FolderBtn>
            {folderTree.map((folder) => (
              <FolderNode key={folder.id} folder={folder} activeFolderId={activeFolderId} onSelect={setActiveFolderId} depth={0} />
            ))}
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
      className="cursor-pointer"
      style={{
        fontFamily: "'Oswald', 'Inter', sans-serif",
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        height: 20,
        padding: '0 10px',
        borderRadius: 2,
        border: active ? '1px solid rgba(200,120,10,0.4)' : '1px solid transparent',
        background: active ? 'rgba(200,120,10,0.10)' : 'transparent',
        color: active ? '#C87C14' : '#3A332A',
        transition: 'all 100ms',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = '#7A7068'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#3A332A'; }}
    >
      {children}
    </button>
  );
}

function AmberButton({ onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer"
      style={{
        fontFamily: "'Oswald', 'Inter', sans-serif",
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        height: 20,
        padding: '0 10px',
        borderRadius: 2,
        background: disabled ? '#0F0D0A' : 'linear-gradient(180deg, #3A2C10 0%, #261E08 100%)',
        border: disabled ? '1px solid #201D18' : '1px solid rgba(200,120,10,0.38)',
        color: disabled ? '#2A2218' : '#C87C14',
        boxShadow: disabled ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.05)',
        transition: 'all 100ms',
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.borderColor = 'rgba(200,120,10,0.7)'; e.currentTarget.style.color = '#E8A020'; }}}
      onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.borderColor = 'rgba(200,120,10,0.38)'; e.currentTarget.style.color = '#C87C14'; }}}
    >
      {children}
    </button>
  );
}

function FolderBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer w-full text-left"
      style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
        padding: '4px 8px',
        borderRadius: 2,
        marginBottom: 2,
        background: active ? 'rgba(200,120,10,0.12)' : 'transparent',
        border: active ? '1px solid rgba(200,120,10,0.3)' : '1px solid transparent',
        color: active ? '#C87C14' : '#3A332A',
        fontWeight: active ? 500 : 400,
        transition: 'all 80ms',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = '#7A7068'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#3A332A'; }}
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
        className="cursor-pointer w-full text-left"
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 11,
          padding: `4px 8px 4px ${8 + depth * 12}px`,
          borderRadius: 2,
          marginBottom: 2,
          background: isActive ? 'rgba(200,120,10,0.12)' : 'transparent',
          border: isActive ? '1px solid rgba(200,120,10,0.3)' : '1px solid transparent',
          color: isActive ? '#C87C14' : '#3A332A',
          fontWeight: isActive ? 500 : 400,
          display: 'flex', alignItems: 'center', gap: 6,
          transition: 'all 80ms',
        }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = '#7A7068'; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = '#3A332A'; }}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.45, flexShrink: 0 }}>
          <path d="M2 4a2 2 0 0 1 2-2h3.5l1.5 2H12a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z"/>
        </svg>
        {folder.name}
      </button>
      {folder.children?.map((child) => (
        <FolderNode key={child.id} folder={child} activeFolderId={activeFolderId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </>
  );
}
