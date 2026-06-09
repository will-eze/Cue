import React, { useState } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ContextMenu from '../components/ContextMenu';
import MediaPickerModal from '../components/MediaPickerModal';
import { mediaUrl } from '../utils/mediaUrl';

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
    : (item.content ? JSON.parse(item.content || '{}')?.text?.split('\n')[0] : 'Slide') || 'Slide';

  const sublabel = item.item_type === 'song'
    ? `Song${item.song?.author ? ' · ' + item.song.author : ''}`
    : item.item_type === 'media' ? 'Media' : 'Slide';

  const typeIcon = item.item_type === 'song' ? 'music_note'
    : item.item_type === 'media' ? 'play_circle'
    : 'article';

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
        const bgAsset = item.background_override || item.song?.default_background;
        return (
          <div className={`w-12 h-8 bg-black rounded overflow-hidden shrink-0 relative flex items-center justify-center ${
            isLive ? 'border border-secondary/30' : isPreview ? 'border border-primary/30' : ''
          }`}>
            {bgAsset && (
              bgAsset.type === 'video' || /\.(mp4|webm|mov)$/i.test(bgAsset.path) ? (
                <video src={mediaUrl(bgAsset.path)} className="absolute inset-0 w-full h-full object-cover opacity-70" muted />
              ) : (
                <img src={mediaUrl(bgAsset.path)} className="absolute inset-0 w-full h-full object-cover opacity-70" alt="" />
              )
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
          {String(index + 1).padStart(2, '0')}. {label}
        </p>
        <p className="text-[10px] text-on-surface-variant truncate mt-0.5">{sublabel}</p>
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
        {item.notes && (
          <span className="font-label-sm text-[9px] tracking-wider bg-surface-variant text-on-surface-variant px-xs py-[2px] rounded uppercase">
            NOTE
          </span>
        )}
      </div>
    </div>
  );
}

export default function RundownPanel({
  services, activeServiceId, serviceData, previewItemId, liveItemId,
  onSelectService, onClickItem, onDoubleClickItem, onReorder, onRemoveItem, onDuplicate, onAddService, onRefresh,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [showNewService, setShowNewService] = useState(false);
  const [newServiceTitle, setNewServiceTitle] = useState('');
  const [bgPickerForItem, setBgPickerForItem] = useState(null);

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

  return (
    <div className="flex flex-col h-full bg-surface-container-low rounded-lg border border-outline-variant/30 overflow-hidden">
      {/* Panel header */}
      <div className="px-md py-sm bg-surface-container-high border-b border-outline-variant/30 shrink-0">
        <h2 className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface-variant mb-1">Rundown</h2>
        <div className="flex items-center gap-sm">
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
          <button
            onClick={() => setShowNewService(true)}
            className="shrink-0 w-6 h-6 flex items-center justify-center bg-primary text-on-primary rounded cursor-pointer hover:brightness-110 active:scale-95 transition-all text-sm font-bold"
          >
            +
          </button>
        </div>
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
            await window.cue.services.setItemBackground(bgPickerForItem.id, asset?.id ?? null);
            onRefresh?.();
            setBgPickerForItem(null);
          }}
          onClose={() => setBgPickerForItem(null)}
        />
      )}
    </div>
  );
}
