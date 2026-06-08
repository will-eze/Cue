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
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 2v9.27A3 3 0 1 0 8 14V6l6-1V3L6 2z"/>
    </svg>
  ),
  media: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 3l7 5-7 5V3z"/>
    </svg>
  ),
  slide: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
};

function SortableItem({ item, index, isPreview, isLive, onClick, onDoubleClick, onContextMenu }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const dndStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    borderBottom: '1px solid #12151F',
    minHeight: 44,
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
      style={dndStyle}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`flex items-center gap-0 cursor-pointer transition-colors ${
        isLive    ? 'tally-live'
        : isPreview ? 'tally-preview'
        : 'tally-idle hover:bg-[#0E1120]'
      }`}
    >
      {/* Row number */}
      <span style={{
        width: 28,
        flexShrink: 0,
        textAlign: 'right',
        paddingRight: 6,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.06em',
        color: isLive ? '#EF4444' : isPreview ? '#F59E0B' : '#2A2E42',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {String(index + 1).padStart(2, '0')}
      </span>

      {/* Drag handle */}
      <button
        className="drag-handle flex-shrink-0 flex items-center justify-center"
        style={{ width: 18, height: 44, color: '#282C3E' }}
        {...attributes}
        {...listeners}
        tabIndex={-1}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#404563'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#282C3E'; }}
      >
        <svg width="7" height="12" viewBox="0 0 7 12" fill="currentColor">
          <circle cx="2" cy="2" r="1.1"/><circle cx="5" cy="2" r="1.1"/>
          <circle cx="2" cy="6" r="1.1"/><circle cx="5" cy="6" r="1.1"/>
          <circle cx="2" cy="10" r="1.1"/><circle cx="5" cy="10" r="1.1"/>
        </svg>
      </button>

      {/* Type icon */}
      <span style={{
        flexShrink: 0,
        marginRight: 8,
        color: isLive ? '#EF4444' : isPreview ? '#F59E0B' : '#2E3347',
      }}>
        {ITEM_ICONS[item.item_type] || ITEM_ICONS.slide}
      </span>

      {/* Labels */}
      <div className="flex-1 min-w-0 py-2.5">
        <div style={{
          fontSize: 12.5,
          fontWeight: 500,
          color: isLive ? '#F8FAFC' : isPreview ? '#F5F0E8' : '#B8BECE',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          letterSpacing: '0.01em',
        }}>
          {label}
        </div>
        {sublabel && (
          <div style={{
            fontSize: 10.5,
            color: isLive ? '#EF4444' : isPreview ? '#B38A30' : '#3A3F52',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 1,
          }}>
            {sublabel}
          </div>
        )}
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1 flex-shrink-0 pr-2.5">
        {item.notes && (
          <span style={{
            fontSize: 8.5,
            fontWeight: 700,
            letterSpacing: '0.1em',
            background: '#181C2A',
            color: '#404563',
            border: '1px solid #1E2232',
            padding: '1px 5px',
            borderRadius: 2,
          }}>
            NOTE
          </span>
        )}
        {isLive && (
          <span style={{
            fontSize: 8.5,
            fontWeight: 800,
            letterSpacing: '0.14em',
            background: 'linear-gradient(180deg, #DC2626 0%, #B91C1C 100%)',
            color: '#FEE2E2',
            border: '1px solid rgba(239,68,68,0.4)',
            padding: '2px 6px',
            borderRadius: 2,
          }}>
            LIVE
          </span>
        )}
        {isPreview && !isLive && (
          <span style={{
            fontSize: 8.5,
            fontWeight: 800,
            letterSpacing: '0.14em',
            background: 'rgba(92,58,0,0.8)',
            color: '#FCD34D',
            border: '1px solid rgba(245,158,11,0.35)',
            padding: '2px 6px',
            borderRadius: 2,
          }}>
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
    <div className="flex flex-col h-full" style={{ background: '#060810' }}>
      {/* Panel header */}
      <div className="panel-header">
        {/* Accent + label */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div style={{ width: 2, height: 14, background: '#4F6EF7', borderRadius: 1 }} />
          <span className="panel-label">Rundown</span>
        </div>

        {/* Service selector */}
        <div className="flex-1 min-w-0">
          <select
            value={activeServiceId || ''}
            onChange={(e) => onSelectService(Number(e.target.value))}
            className="w-full cursor-pointer outline-none"
            style={{
              fontSize: 11,
              fontWeight: 500,
              background: '#0E1018',
              color: '#9AA0B8',
              border: '1px solid #1E2232',
              borderRadius: 3,
              padding: '0 22px 0 8px',
              height: 22,
            }}
          >
            {services.length === 0 && <option value="">No services</option>}
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>

        {/* New service button */}
        <button
          onClick={() => setShowNewService(true)}
          className="cursor-pointer flex items-center justify-center flex-shrink-0 transition-all"
          style={{
            width: 22,
            height: 22,
            background: 'linear-gradient(180deg, #2A3A8A 0%, #1E2D72 100%)',
            border: '1px solid rgba(79,110,247,0.45)',
            borderRadius: 3,
            color: '#A5B4FC',
            fontSize: 14,
            fontWeight: 400,
            lineHeight: 1,
          }}
          title="New Service"
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(79,110,247,0.8)'; e.currentTarget.style.color = '#C7D2FE'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(79,110,247,0.45)'; e.currentTarget.style.color = '#A5B4FC'; }}
        >
          +
        </button>
      </div>

      {/* New service input */}
      {showNewService && (
        <div className="flex gap-1.5 flex-shrink-0" style={{
          padding: '6px 10px',
          background: '#0A0C14',
          borderBottom: '1px solid #181C2A',
        }}>
          <input
            autoFocus
            className="flex-1 outline-none"
            placeholder="Service title..."
            value={newServiceTitle}
            onChange={(e) => setNewServiceTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateService();
              if (e.key === 'Escape') { setShowNewService(false); setNewServiceTitle(''); }
            }}
            style={{
              background: '#0E1018',
              color: '#DEE2F0',
              fontSize: 12,
              border: '1px solid #1E2232',
              borderRadius: 3,
              padding: '3px 8px',
            }}
          />
          <button
            onClick={handleCreateService}
            className="cursor-pointer transition-colors"
            style={{
              fontSize: 11,
              fontWeight: 600,
              background: 'linear-gradient(180deg, #2A3A8A 0%, #1E2D72 100%)',
              border: '1px solid rgba(79,110,247,0.4)',
              color: '#A5B4FC',
              padding: '0 10px',
              height: 24,
              borderRadius: 3,
            }}
          >
            Create
          </button>
          <button
            onClick={() => { setShowNewService(false); setNewServiceTitle(''); }}
            className="cursor-pointer"
            style={{ color: '#404563', padding: '0 6px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#7A82A0'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#404563'; }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor">
              <path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}

      {/* Items list */}
      <div className="flex-1 overflow-y-auto">
        {!serviceData ? (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: '#2A2E42' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span style={{ fontSize: 11, letterSpacing: '0.06em' }}>
              {services.length === 0 ? 'Create a service to start' : 'Select a service'}
            </span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: '#2A2E42' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
            <span style={{ fontSize: 11, letterSpacing: '0.06em' }}>Add songs from the library</span>
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
                  onContextMenu={(e) => openContextMenu(e, item)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Footer */}
      {serviceData && (
        <div style={{
          padding: '5px 12px',
          borderTop: '1px solid #12151F',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{ fontSize: 9.5, letterSpacing: '0.1em', color: '#2A2E42', fontVariantNumeric: 'tabular-nums' }}>
            {items.length} {items.length !== 1 ? 'ITEMS' : 'ITEM'}
          </span>
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
