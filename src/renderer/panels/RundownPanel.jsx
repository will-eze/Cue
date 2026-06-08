import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ContextMenu from '../components/ContextMenu';

const ITEM_ICONS = {
  song: (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 2v9.27A3 3 0 1 0 8 14V6l6-1V3L6 2z"/>
    </svg>
  ),
  media: (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 3l7 5-7 5V3z"/>
    </svg>
  ),
  slide: (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
};

function SortableItem({ item, isPreview, isLive, onClick, onDoubleClick, onContextMenu }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const label = item.item_type === 'song'
    ? item.song?.title || 'Unknown Song'
    : item.item_type === 'media'
    ? item.asset?.filename || 'Media'
    : (item.content ? JSON.parse(item.content || '{}')?.text?.split('\n')[0] : 'Slide') || 'Slide';

  const sublabel = item.item_type === 'song' ? item.song?.author || '' : '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`flex items-center gap-2 px-2 py-2 cursor-pointer border-b border-slate-800 transition-colors ${
        isLive    ? 'tally-live'
        : isPreview ? 'tally-preview'
        : 'tally-idle hover:bg-slate-800'
      }`}
    >
      {/* Drag handle */}
      <button
        className="drag-handle text-slate-600 hover:text-slate-400 px-1 flex-shrink-0 flex items-center"
        {...attributes}
        {...listeners}
        tabIndex={-1}
      >
        <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
          <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
          <circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/>
          <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
        </svg>
      </button>

      {/* Type icon */}
      <span className={`flex-shrink-0 ${isLive ? 'text-red-500' : isPreview ? 'text-amber-500' : 'text-slate-600'}`}>
        {ITEM_ICONS[item.item_type] || ITEM_ICONS.slide}
      </span>

      {/* Labels */}
      <div className="flex-1 min-w-0">
        <div className={`text-[13px] truncate ${isLive ? 'text-slate-100' : 'text-slate-200'}`}>
          {label}
        </div>
        {sublabel && (
          <div className="text-[11px] text-slate-500 truncate">{sublabel}</div>
        )}
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {item.notes && (
          <span className="text-[9px] font-bold tracking-wider bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded-sm">
            NOTE
          </span>
        )}
        {isLive && (
          <span className="text-[9px] font-bold tracking-widest bg-red-600 text-white px-1.5 py-0.5 rounded-sm">
            LIVE
          </span>
        )}
        {isPreview && !isLive && (
          <span className="text-[9px] font-bold tracking-widest bg-amber-800 text-amber-200 px-1.5 py-0.5 rounded-sm">
            CUE
          </span>
        )}
      </div>
    </div>
  );
}

export default function RundownPanel({
  services,
  activeServiceId,
  serviceData,
  previewItemId,
  liveItemId,
  onSelectService,
  onClickItem,
  onDoubleClickItem,
  onReorder,
  onRemoveItem,
  onAddService,
  onRefresh,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [showNewService, setShowNewService] = useState(false);
  const [newServiceTitle, setNewServiceTitle] = useState('');

  const items = serviceData?.items || [];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    const reordered = arrayMove(items, oldIdx, newIdx);
    onReorder(reordered.map((i) => i.id));
  }

  function openContextMenu(e, item) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }

  async function handleCreateService() {
    const title = newServiceTitle.trim() ||
      new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    await onAddService(title);
    setShowNewService(false);
    setNewServiceTitle('');
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Panel header */}
      <div className="panel-header gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-0.5 h-3 bg-indigo-600 rounded-sm" />
          <span className="panel-label">Rundown</span>
        </div>
        <div className="flex-1 min-w-0">
          <select
            value={activeServiceId || ''}
            onChange={(e) => onSelectService(Number(e.target.value))}
            className="w-full text-[11px] bg-slate-700 text-slate-200 rounded-sm px-2 h-5 border border-slate-600 outline-none focus:border-indigo-500 truncate cursor-pointer"
          >
            {services.length === 0 && <option value="">No services</option>}
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowNewService(true)}
          className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white w-5 h-5 rounded-sm flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer font-bold"
          title="New Service"
        >
          +
        </button>
      </div>

      {/* New service input */}
      {showNewService && (
        <div className="flex gap-1.5 px-3 py-2 bg-slate-800 border-b border-slate-800 flex-shrink-0">
          <input
            autoFocus
            className="flex-1 bg-slate-700 text-slate-100 text-[12px] rounded-sm px-2 py-1 border border-slate-600 outline-none focus:border-indigo-500"
            placeholder="Service title..."
            value={newServiceTitle}
            onChange={(e) => setNewServiceTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateService();
              if (e.key === 'Escape') { setShowNewService(false); setNewServiceTitle(''); }
            }}
          />
          <button
            onClick={handleCreateService}
            className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 h-6 rounded-sm transition-colors cursor-pointer"
          >
            Create
          </button>
          <button
            onClick={() => setShowNewService(false)}
            className="text-[11px] text-slate-500 hover:text-slate-300 px-1.5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Items list */}
      <div className="flex-1 overflow-y-auto">
        {!serviceData ? (
          <div className="flex items-center justify-center h-full text-slate-600 text-[12px]">
            {services.length === 0 ? 'Create a service to get started' : 'Select a service'}
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-600 text-[12px]">
            Add songs from the library below
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {items.map((item) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  isPreview={item.id === previewItemId}
                  isLive={item.id === liveItemId}
                  onClick={() => onClickItem(item)}
                  onDoubleClick={() => onDoubleClickItem(item)}
                  onContextMenu={(e) => openContextMenu(e, item)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Footer */}
      {serviceData && (
        <div className="px-3 py-1 text-[10px] text-slate-600 border-t border-slate-800 flex-shrink-0 tracking-wide">
          {items.length} {items.length !== 1 ? 'items' : 'item'}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Remove from Rundown',
              onClick: () => { onRemoveItem(contextMenu.item.id); setContextMenu(null); },
            },
          ]}
        />
      )}
    </div>
  );
}
