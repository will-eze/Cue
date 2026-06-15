import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ContextMenu from '../components/ContextMenu';
import MediaPickerModal from '../components/MediaPickerModal';
import SongPreviewModal from '../components/SongPreviewModal';
import SongEditor from '../components/SongEditor';
import MediaThumb from '../components/MediaThumb';

function SortableItem({ item, index, isPreview, isLive, onClick, onDoubleClick, onContextMenu }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const dndStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const label = item.item_type === 'song'
    ? item.song?.title || 'Unknown Song'
    : item.item_type === 'media'
    ? item.asset?.filename || 'Media'
    : item.item_type === 'scripture'
    ? item.scripture?.reference || item.title || 'Scripture'
    : item.item_type === 'presentation'
    ? item.presentation?.title || 'Presentation'
    : item.item_type === 'youtube'
    ? item.youtube?.title || 'YouTube video'
    : (item.content?.split('\n')[0]?.trim()) || 'Slide';

  const sublabel = item.item_type === 'song'
    ? `Song${item.song?.author ? ' · ' + item.song.author : ''}`
    : item.item_type === 'media' ? 'Media'
    : item.item_type === 'scripture'
    ? `Scripture${item.scripture?.versionAbbrev ? ' · ' + item.scripture.versionAbbrev : ''}`
    : item.item_type === 'presentation'
    ? `Presentation · ${item.slides?.length || 0} slide${item.slides?.length === 1 ? '' : 's'}`
    : item.item_type === 'youtube' ? 'YouTube'
    : 'Slide';

  const typeIcon = item.item_type === 'song' ? 'music_note'
    : item.item_type === 'media' ? 'play_circle'
    : item.item_type === 'scripture' ? 'menu_book'
    : item.item_type === 'presentation' ? 'slideshow'
    : item.item_type === 'youtube' ? 'smart_display'
    : 'article';

  // Ephemeral YouTube download state, shown as a compact badge so the operator
  // knows when a cue is safe to take live (GO is soft-blocked until 'ready').
  const yt = item.item_type === 'youtube' ? item.youtube : null;
  const ytBadge = !yt ? null
    : yt.status === 'ready'       ? { text: 'READY',     cls: 'bg-tertiary/15 text-tertiary border border-tertiary/30' }
    : yt.status === 'setup'       ? { text: 'SETUP',     cls: 'bg-primary-container/20 text-primary border border-primary/30' }
    : yt.status === 'downloading' ? { text: `${Math.round(yt.percent || 0)}%`, cls: 'bg-primary-container/20 text-primary border border-primary/30' }
    : yt.status === 'processing'  ? { text: 'PROC',      cls: 'bg-primary-container/20 text-primary border border-primary/30' }
    : yt.status === 'resolving'   ? { text: 'RESOLVING', cls: 'bg-surface-variant text-on-surface-variant' }
    : yt.status === 'error'       ? { text: 'ERROR',     cls: 'bg-error/15 text-error border border-error/30' }
    : { text: 'QUEUED', cls: 'bg-surface-variant text-on-surface-variant' };

  return (
    <div
      ref={setNodeRef}
      style={{ ...dndStyle, minHeight: 44 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`flex items-center gap-sm px-sm cursor-pointer border-b border-outline-variant/20 group ${
        isLive ? 'tally-live' : isPreview ? 'tally-preview' : 'tally-idle hover:bg-surface-variant'
      }`}
    >
      {/* Drag handle */}
      <button
        className="drag-handle shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ width: 14, color: '#424754' }}
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
        tabIndex={-1}
      >
        <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor">
          <circle cx="1.5" cy="1.5" r="1"/><circle cx="4.5" cy="1.5" r="1"/>
          <circle cx="1.5" cy="5" r="1"/><circle cx="4.5" cy="5" r="1"/>
          <circle cx="1.5" cy="8.5" r="1"/><circle cx="4.5" cy="8.5" r="1"/>
        </svg>
      </button>

      {/* Icon / background thumbnail */}
      {(() => {
        const bgAsset = item.background_override || item.song?.default_background
          || (item.item_type === 'media' ? item.asset : null);
        return (
          <div className={`w-12 h-8 bg-black rounded overflow-hidden shrink-0 relative flex items-center justify-center ${
            isLive ? 'border border-secondary/30' : isPreview ? 'border border-primary/30' : ''
          }`}>
            {bgAsset && (
              <MediaThumb path={bgAsset.path} className="absolute inset-0 w-full h-full object-cover opacity-70" />
            )}
            <span
              className={`relative material-symbols-outlined text-[18px] ${bgAsset ? 'opacity-0' : ''} ${
                isLive ? 'text-secondary' : isPreview ? 'text-primary' : 'text-outline-variant'
              }`}
              style={isLive ? { fontVariationSettings: "'FILL' 1" } : {}}
            >
              {isLive ? 'sensors' : isPreview ? 'visibility' : typeIcon}
            </span>
          </div>
        );
      })()}

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className={`text-label-sm font-bold truncate ${
          isLive ? 'text-secondary' : isPreview ? 'text-primary' : 'text-on-surface'
        }`}>
          {label}
        </p>
        <div className="flex items-center gap-xs min-w-0 mt-0.5">
          <p className="text-[10px] text-on-surface-variant truncate shrink-0">{sublabel}</p>
          {(item.song?.tags || []).length > 0 && (
            <div className="flex items-center gap-xs min-w-0 overflow-hidden">
              {item.song.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className="text-[8px] font-mono font-bold leading-none px-xs py-[2px] rounded-full text-white/95 whitespace-nowrap"
                  style={{ background: tag.colour || '#4d8eff' }}
                  title={tag.name}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* State badges */}
      <div className="flex items-center gap-xs shrink-0 pr-xs">
        {isLive && (
          <span className="font-label-sm text-[9px] font-bold tracking-widest bg-secondary-container text-on-secondary-container px-sm py-[2px] rounded uppercase">
            LIVE
          </span>
        )}
        {isPreview && !isLive && (
          <span className="font-label-sm text-[9px] font-bold tracking-widest bg-primary-container/20 text-primary border border-primary/30 px-sm py-[2px] rounded uppercase">
            PRVW
          </span>
        )}
        {ytBadge && (
          <span
            title={yt.status === 'error' ? (yt.error || 'Download failed') : undefined}
            className={`font-label-sm text-[9px] font-bold tracking-wider px-xs py-[2px] rounded uppercase ${ytBadge.cls}`}
          >
            {ytBadge.text}
          </span>
        )}
        {(item.item_type === 'media' || item.item_type === 'youtube') && !!item.media_loop && (
          <span className="font-label-sm text-[9px] tracking-wider bg-primary-container/20 text-primary border border-primary/30 px-xs py-[2px] rounded uppercase">
            LOOP
          </span>
        )}
        {item.advance_seconds > 0 && (
          <span
            className="flex items-center gap-[2px] font-label-sm text-[9px] tracking-wider bg-surface-variant text-on-surface-variant px-xs py-[2px] rounded uppercase"
            title={item.advance_loop === 'item' ? 'Auto-advance · loops this item' : 'Auto-advance · continues rundown'}
          >
            <span className="material-symbols-outlined text-[11px] leading-none">
              {item.advance_loop === 'item' ? 'repeat_one' : 'timer'}
            </span>
            {item.advance_seconds}s
          </span>
        )}
        {item.notes && (
          <span className="font-label-sm text-[9px] tracking-wider bg-surface-variant text-on-surface-variant px-xs py-[2px] rounded uppercase">
            NOTE
          </span>
        )}
      </div>
    </div>
  );
}

// Set / clear an item's auto-advance interval. Presets cover the common pre-roll
// rotations; the field accepts any whole-second value. "Off" clears it (manual).
const ADVANCE_PRESETS = [5, 10, 15, 20, 30, 45, 60];

const LOOP_MODES = [
  { id: 'rundown', label: 'Continue rundown', hint: 'Roll into the next item; wrap to the top at the end.' },
  { id: 'item',    label: 'Loop this item',   hint: 'Rotate this item’s slides forever.' },
];

function AutoAdvanceModal({ item, onApply, onClose }) {
  const [secs, setSecs] = useState(item.advance_seconds > 0 ? String(item.advance_seconds) : '');
  const [loop, setLoop] = useState(item.advance_loop === 'item' ? 'item' : 'rundown');
  // Default on (matches the column default) so a brand-new auto-advance wraps.
  const [wrap, setWrap] = useState(item.advance_wrap !== 0);

  function apply(value) {
    const n = Math.round(Number(value));
    onApply(Number.isFinite(n) && n > 0 ? n : null, loop, wrap);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[340px] bg-surface-container-high border border-outline-variant/40 rounded-xl shadow-2xl ring-1 ring-white/5 p-lg">
        <h3 className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface-variant mb-1">Auto-Advance</h3>
        <p className="text-[11px] text-on-surface-variant/70 mb-md leading-snug">
          When this item is live, move forward automatically after the set interval.
        </p>

        <div className="grid grid-cols-4 gap-xs mb-md">
          {ADVANCE_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setSecs(String(p))}
              className={`py-xs text-[11px] font-mono rounded border cursor-pointer transition-colors ${
                Number(secs) === p
                  ? 'border-primary/60 bg-primary-container/20 text-primary'
                  : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-variant hover:text-on-surface'
              }`}
            >
              {p}s
            </button>
          ))}
          <button
            onClick={() => apply(null)}
            className="py-xs text-[11px] font-mono rounded border border-outline-variant/30 text-on-surface-variant hover:bg-surface-variant hover:text-on-surface cursor-pointer transition-colors uppercase"
          >
            Off
          </button>
        </div>

        {/* Loop mode — what happens when the timer reaches the item's last slide. */}
        <p className="text-[10px] font-label-sm uppercase tracking-widest text-on-surface-variant/60 mb-xs">At end of item</p>
        <div className="flex flex-col gap-xs mb-md">
          {LOOP_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setLoop(m.id)}
              className={`text-left px-sm py-xs rounded border cursor-pointer transition-colors ${
                loop === m.id
                  ? 'border-primary/60 bg-primary-container/20'
                  : 'border-outline-variant/30 hover:bg-surface-variant'
              }`}
            >
              <span className={`block text-[11px] font-bold ${loop === m.id ? 'text-primary' : 'text-on-surface'}`}>{m.label}</span>
              <span className="block text-[10px] text-on-surface-variant/70 leading-snug">{m.hint}</span>
            </button>
          ))}
        </div>

        {/* Wrap toggle — only meaningful in 'rundown' mode (item-loop always cycles). */}
        {loop === 'rundown' && (
          <button
            onClick={() => setWrap((w) => !w)}
            className="flex items-center gap-sm w-full text-left mb-md px-xs py-xs rounded hover:bg-surface-variant cursor-pointer transition-colors"
          >
            <span
              className={`shrink-0 w-8 h-[18px] rounded-full relative transition-colors ${wrap ? 'bg-primary' : 'bg-outline-variant/40'}`}
            >
              <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${wrap ? 'left-[16px]' : 'left-[2px]'}`} />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-bold text-on-surface">Wrap at the end</span>
              <span className="block text-[10px] text-on-surface-variant/70 leading-snug">
                {wrap ? 'Loop back to the first item.' : 'Stop after the last slide (one pass).'}
              </span>
            </span>
          </button>
        )}

        <div className="flex items-center gap-sm">
          <input
            autoFocus
            type="number"
            min="1"
            value={secs}
            onChange={(e) => setSecs(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') apply(secs); if (e.key === 'Escape') onClose(); }}
            placeholder="Custom seconds…"
            className="flex-1 min-w-0 bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-xs text-[12px] font-mono text-on-surface outline-none focus:border-primary"
          />
          <button
            onClick={() => apply(secs)}
            className="shrink-0 px-md py-xs bg-primary text-on-primary text-label-sm font-label-sm rounded cursor-pointer hover:brightness-110 active:scale-95"
          >
            Set
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function RundownPanel({
  services, activeServiceId, serviceData, previewItemId, liveItemId,
  onSelectService, onClickItem, onDoubleClickItem, onReorder, onRemoveItem, onDuplicate,
  onAddService, onRenameService, onDeleteService, onRefresh, onSongEdited,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [showNewService, setShowNewService] = useState(false);
  const [newServiceTitle, setNewServiceTitle] = useState('');
  const [renamingService, setRenamingService] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bgPickerForItem, setBgPickerForItem] = useState(null);
  const [advanceForItem, setAdvanceForItem] = useState(null);
  const [previewSong, setPreviewSong] = useState(null);
  const [editSong, setEditSong] = useState(null);
  const [themes, setThemes] = useState([]);

  // Load themes for the song context menu's "Apply Theme" entries (song-category only).
  useEffect(() => {
    window.cue.themes.list()
      .then((list) => setThemes((list || []).filter((t) => (t.category || 'song') === 'song')))
      .catch(() => {});
  }, [serviceData?.id]);

  const items = serviceData?.items || [];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    onReorder(arrayMove(items, oldIdx, newIdx).map((i) => i.id));
  }

  async function handleCreateService() {
    const title = newServiceTitle.trim() ||
      new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    await onAddService(title);
    setShowNewService(false);
    setNewServiceTitle('');
  }

  function startRename() {
    const svc = services.find((s) => s.id === activeServiceId);
    setRenameTitle(svc?.title || '');
    setRenamingService(true);
    setConfirmDelete(false);
  }

  async function confirmRename() {
    if (renameTitle.trim()) await onRenameService?.(renameTitle.trim());
    setRenamingService(false);
  }

  async function confirmDeleteService() {
    setConfirmDelete(false);
    await onDeleteService?.();
  }

  return (
    <div className="flex flex-col h-full bg-surface-container-low rounded-lg border border-outline-variant/30 overflow-hidden">
      {/* Panel header */}
      <div className="px-md py-sm bg-surface-container-high border-b border-outline-variant/30 shrink-0">
        <h2 className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface-variant mb-1">Rundown</h2>

        {renamingService ? (
          /* Inline rename input */
          <div className="flex items-center gap-xs">
            <input
              autoFocus
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') setRenamingService(false);
              }}
              className="flex-1 min-w-0 bg-surface-container-lowest border border-primary/40 rounded px-sm py-xs text-[11px] font-label-sm text-on-surface outline-none focus:border-primary"
            />
            <button
              onClick={confirmRename}
              className="shrink-0 w-6 h-6 flex items-center justify-center text-tertiary hover:text-tertiary/80 cursor-pointer transition-colors"
              title="Confirm rename"
            >
              <span className="material-symbols-outlined text-[15px]">check</span>
            </button>
            <button
              onClick={() => setRenamingService(false)}
              className="shrink-0 w-6 h-6 flex items-center justify-center text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
              title="Cancel"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          </div>
        ) : confirmDelete ? (
          /* Inline delete confirmation */
          <div className="flex items-center gap-sm">
            <span className="text-[10px] font-mono text-error uppercase tracking-[0.04em] shrink-0">Delete rundown?</span>
            <button
              onClick={confirmDeleteService}
              className="text-[10px] font-mono text-error hover:text-error/70 cursor-pointer uppercase tracking-[0.04em] border border-error/40 px-sm py-[2px] rounded transition-colors"
            >Yes</button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.04em] transition-colors"
            >No</button>
          </div>
        ) : (
          /* Normal service select row */
          <div className="flex items-center gap-xs">
            <select
              value={activeServiceId || ''}
              onChange={(e) => onSelectService(Number(e.target.value))}
              className="flex-1 min-w-0 bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-xs text-[11px] font-label-sm text-on-surface outline-none cursor-pointer"
            >
              {services.length === 0 && <option value="">No services</option>}
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
            {activeServiceId && (
              <>
                <button
                  onClick={startRename}
                  title="Rename service"
                  className="shrink-0 w-5 h-5 flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-[13px]">edit</span>
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  title="Delete service"
                  className="shrink-0 w-5 h-5 flex items-center justify-center text-on-surface-variant/40 hover:text-error cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-[13px]">delete</span>
                </button>
              </>
            )}
            <button
              onClick={() => setShowNewService(true)}
              className="shrink-0 w-6 h-6 flex items-center justify-center bg-primary text-on-primary rounded cursor-pointer hover:brightness-110 active:scale-95 transition-all text-sm font-bold"
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* New service input */}
      {showNewService && (
        <div className="flex gap-sm px-sm py-xs bg-surface-container border-b border-outline-variant/20 shrink-0">
          <input
            autoFocus
            className="flex-1 bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-xs text-[11px] font-label-sm text-on-surface outline-none"
            placeholder="Service title…"
            value={newServiceTitle}
            onChange={(e) => setNewServiceTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateService();
              if (e.key === 'Escape') { setShowNewService(false); setNewServiceTitle(''); }
            }}
          />
          <button
            onClick={handleCreateService}
            className="shrink-0 px-sm py-xs bg-primary text-on-primary text-label-sm font-label-sm rounded cursor-pointer hover:brightness-110 active:scale-95"
          >
            Create
          </button>
          <button
            onClick={() => { setShowNewService(false); setNewServiceTitle(''); }}
            className="shrink-0 text-on-surface-variant hover:text-on-surface cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Items list */}
      <div className="flex-1 overflow-y-auto">
        {!serviceData ? (
          <div className="flex flex-col items-center justify-center h-full gap-sm text-outline-variant">
            <span className="material-symbols-outlined text-4xl">calendar_today</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">
              {services.length === 0 ? 'No Service' : 'Select a Service'}
            </span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-sm text-outline-variant">
            <span className="material-symbols-outlined text-4xl">music_note</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">Add Songs Below</span>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {items.map((item, index) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  index={index}
                  isPreview={item.id === previewItemId}
                  isLive={item.id === liveItemId}
                  onClick={() => onClickItem(item)}
                  onDoubleClick={() => onDoubleClickItem(item)}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, item }); }}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Footer */}
      {serviceData && (
        <div className="px-md py-xs border-t border-outline-variant/20 shrink-0">
          <span className="text-[10px] font-label-sm text-outline-variant uppercase tracking-wider">
            {items.length} {items.length !== 1 ? 'items' : 'item'}
          </span>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Duplicate',
              onClick: () => { onDuplicate?.(contextMenu.item.id); setContextMenu(null); },
            },
            ...(contextMenu.item.item_type === 'song' ? [
              { separator: true },
              {
                label: 'Preview',
                onClick: () => { setPreviewSong(contextMenu.item.song); setContextMenu(null); },
              },
              {
                label: 'Edit',
                onClick: async () => {
                  const full = await window.cue.songs.get(contextMenu.item.song.id);
                  setEditSong(full);
                  setContextMenu(null);
                },
              },
              { separator: true },
              {
                label: 'Set Background Override',
                onClick: () => { setBgPickerForItem(contextMenu.item); setContextMenu(null); },
              },
              ...(contextMenu.item.background_override ? [{
                label: 'Clear Background Override',
                onClick: async () => {
                  await window.cue.services.setItemBackground(contextMenu.item.id, null);
                  onRefresh?.();
                  setContextMenu(null);
                },
              }] : []),
              ...(themes.length ? [
                { separator: true },
                {
                  label: 'Apply Theme',
                  submenu: themes.map((t) => ({
                    label: t.name,
                    onClick: async () => {
                      // setBg:true — a media or CSS-gradient theme applies its background;
                      // a text-only theme leaves backgrounds untouched (handled in db/themes.js).
                      await window.cue.themes.applyToSong(t.id, contextMenu.item.song.id, true);
                      onRefresh?.();
                      setContextMenu(null);
                    },
                  })),
                },
              ] : []),
            ] : []),
            ...(contextMenu.item.item_type === 'scripture' ? [
              { separator: true },
              {
                label: 'Set Background Override',
                onClick: () => { setBgPickerForItem(contextMenu.item); setContextMenu(null); },
              },
              ...(contextMenu.item.background_override ? [{
                label: 'Clear Background Override',
                onClick: async () => {
                  await window.cue.services.setItemBackground(contextMenu.item.id, null);
                  onRefresh?.();
                  setContextMenu(null);
                },
              }] : []),
            ] : []),
            ...((contextMenu.item.item_type === 'media' || contextMenu.item.item_type === 'youtube') ? [
              { separator: true },
              {
                label: contextMenu.item.media_loop ? 'Disable Loop' : 'Enable Loop',
                onClick: async () => {
                  await window.cue.services.setItemLoop(contextMenu.item.id, !contextMenu.item.media_loop);
                  onRefresh?.();
                  setContextMenu(null);
                },
              },
            ] : []),
            ...(contextMenu.item.item_type === 'youtube' ? [
              {
                label: 'Re-download',
                onClick: () => { window.cue.youtube.prefetch(contextMenu.item.content); setContextMenu(null); },
              },
            ] : []),
            { separator: true },
            {
              label: contextMenu.item.advance_seconds > 0
                ? `Auto-Advance: ${contextMenu.item.advance_seconds}s`
                : 'Auto-Advance…',
              onClick: () => { setAdvanceForItem(contextMenu.item); setContextMenu(null); },
            },
            { separator: true },
            {
              label: 'Remove from Rundown',
              danger: true,
              onClick: () => { onRemoveItem(contextMenu.item.id); setContextMenu(null); },
            },
          ]}
        />
      )}

      {bgPickerForItem && (
        <MediaPickerModal
          initialId={bgPickerForItem.background_override?.id ?? null}
          onSelect={async (asset) => {
            const mediaId = asset?.id ?? null;
            await window.cue.services.setItemBackground(bgPickerForItem.id, mediaId);
            if (bgPickerForItem.item_type === 'song' && bgPickerForItem.song?.id) {
              await window.cue.songs.setBackground(bgPickerForItem.song.id, mediaId);
            }
            onRefresh?.();
            setBgPickerForItem(null);
          }}
          onClose={() => setBgPickerForItem(null)}
        />
      )}

      {advanceForItem && (
        <AutoAdvanceModal
          item={advanceForItem}
          onApply={async (seconds, loop, wrap) => {
            await window.cue.services.setItemAdvance(advanceForItem.id, seconds, loop, wrap);
            onRefresh?.();
            setAdvanceForItem(null);
          }}
          onClose={() => setAdvanceForItem(null)}
        />
      )}

      {previewSong && (
        <SongPreviewModal
          song={previewSong}
          onClose={() => setPreviewSong(null)}
          onEdit={async (song) => {
            const full = await window.cue.songs.get(song.id);
            setPreviewSong(null);
            setEditSong(full);
          }}
          onAddToRundown={() => setPreviewSong(null)}
        />
      )}

      {editSong !== null && (
        <SongEditor
          song={editSong}
          onClose={() => setEditSong(null)}
          onSave={() => { setEditSong(null); onRefresh?.(); onSongEdited?.(); }}
        />
      )}
    </div>
  );
}
