import React, { useState } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
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
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="10" rx="1.5"/>
    </svg>
  ),
};

function SortableItem({ item, index, isPreview, isLive, onClick, onDoubleClick, onContextMenu }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const dndStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    borderBottom: '1px solid #181510',
    minHeight: 42,
  };

  const label = item.item_type === 'song'
    ? item.song?.title || 'Unknown Song'
    : item.item_type === 'media'
    ? item.asset?.filename || 'Media'
    : (item.content ? JSON.parse(item.content || '{}')?.text?.split('\n')[0] : 'Slide') || 'Slide';

  const sublabel = item.item_type === 'song' ? item.song?.author || '' : '';

  const rowBg = isLive
    ? 'linear-gradient(90deg, rgba(224,53,53,0.13) 0%, rgba(224,53,53,0.03) 35%, transparent 70%)'
    : isPreview
    ? 'linear-gradient(90deg, rgba(212,137,26,0.11) 0%, rgba(212,137,26,0.025) 35%, transparent 70%)'
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={dndStyle}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`flex items-center cursor-pointer transition-colors ${
        isLive ? 'tally-live' : isPreview ? 'tally-preview' : 'tally-idle'
      }`}
      onMouseEnter={(e) => { if (!isLive && !isPreview) e.currentTarget.style.background = '#161310'; }}
      onMouseLeave={(e) => { if (!isLive && !isPreview) e.currentTarget.style.background = ''; }}
    >
      {/* Index column */}
      <div style={{
        width: 32,
        flexShrink: 0,
        textAlign: 'right',
        paddingRight: 6,
        fontFamily: "'Oswald', 'Inter', sans-serif",
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.08em',
        color: isLive ? '#E03535' : isPreview ? '#C87C14' : '#2E2820',
        fontVariantNumeric: 'tabular-nums',
        alignSelf: 'stretch',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}>
        {String(index + 1).padStart(2, '0')}
      </div>

      {/* Drag handle */}
      <button
        className="drag-handle flex-shrink-0 flex items-center justify-center"
        style={{ width: 16, alignSelf: 'stretch', color: '#201D18' }}
        {...attributes}
        {...listeners}
        tabIndex={-1}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#3A332A'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = '#201D18'; }}
      >
        <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor">
          <circle cx="1.5" cy="1.5" r="1"/><circle cx="4.5" cy="1.5" r="1"/>
          <circle cx="1.5" cy="5" r="1"/><circle cx="4.5" cy="5" r="1"/>
          <circle cx="1.5" cy="8.5" r="1"/><circle cx="4.5" cy="8.5" r="1"/>
        </svg>
      </button>

      {/* Type icon */}
      <span style={{
        flexShrink: 0,
        marginRight: 8,
        color: isLive ? '#E03535' : isPreview ? '#C87C14' : '#302820',
      }}>
        {ITEM_ICONS[item.item_type] || ITEM_ICONS.slide}
      </span>

      {/* Text */}
      <div className="flex-1 min-w-0" style={{ paddingTop: 9, paddingBottom: 9 }}>
        <div style={{
          fontSize: 12.5,
          fontWeight: 500,
          letterSpacing: '0.01em',
          color: isLive ? '#E8E0D8' : isPreview ? '#DDD4C0' : '#A89888',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </div>
        {sublabel && (
          <div style={{
            fontSize: 10.5,
            color: isLive ? 'rgba(224,53,53,0.65)' : isPreview ? 'rgba(200,124,20,0.6)' : '#302820',
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, paddingRight: 10 }}>
        {item.notes && (
          <span style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 8.5,
            fontWeight: 500,
            letterSpacing: '0.14em',
            background: '#1A1714',
            color: '#3A332A',
            border: '1px solid #2A2520',
            padding: '1px 5px',
            borderRadius: 1,
          }}>
            NOTE
          </span>
        )}
        {isLive && (
          <span style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.18em',
            background: 'linear-gradient(180deg, #C42020 0%, #991818 100%)',
            color: '#FFCACA',
            border: '1px solid rgba(224,53,53,0.4)',
            padding: '2px 7px',
            borderRadius: 1,
            boxShadow: '0 0 8px rgba(224,53,53,0.18)',
          }}>
            LIVE
          </span>
        )}
        {isPreview && !isLive && (
          <span style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.18em',
            background: 'rgba(80,48,0,0.8)',
            color: '#D4891A',
            border: '1px solid rgba(212,137,26,0.35)',
            padding: '2px 7px',
            borderRadius: 1,
          }}>
            CUE
          </span>
        )}
      </div>
    </div>
  );
}

export default function RundownPanel({
  services, activeServiceId, serviceData, previewItemId, liveItemId,
  onSelectService, onClickItem, onDoubleClickItem, onReorder, onRemoveItem, onAddService,
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
    <div className="flex flex-col h-full" style={{ background: '#0C0A08' }}>
      {/* Panel header */}
      <div className="panel-header">
        <span className="panel-label">Rundown</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <select
            value={activeServiceId || ''}
            onChange={(e) => onSelectService(Number(e.target.value))}
            className="w-full outline-none cursor-pointer"
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 11,
              fontWeight: 500,
              background: '#141210',
              color: '#7A7068',
              border: '1px solid #2A2520',
              borderRadius: 2,
              padding: '0 22px 0 7px',
              height: 20,
            }}
          >
            {services.length === 0 && <option value="">No services</option>}
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowNewService(true)}
          title="New Service"
          className="cursor-pointer flex items-center justify-center flex-shrink-0"
          style={{
            width: 20,
            height: 20,
            fontFamily: "'Oswald', sans-serif",
            fontSize: 13,
            fontWeight: 400,
            background: 'linear-gradient(180deg, #3A2C10 0%, #261E08 100%)',
            border: '1px solid rgba(200,120,10,0.38)',
            borderRadius: 2,
            color: '#C87C14',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(200,120,10,0.7)'; e.currentTarget.style.color = '#E8A020'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(200,120,10,0.38)'; e.currentTarget.style.color = '#C87C14'; }}
        >
          +
        </button>
      </div>

      {/* New service input */}
      {showNewService && (
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '5px 8px',
          background: '#141210',
          borderBottom: '1px solid #201D18',
          flexShrink: 0,
        }}>
          <input
            autoFocus
            className="flex-1 outline-none"
            placeholder="Service title…"
            value={newServiceTitle}
            onChange={(e) => setNewServiceTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateService();
              if (e.key === 'Escape') { setShowNewService(false); setNewServiceTitle(''); }
            }}
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 11,
              background: '#0C0A08',
              color: '#C8C0B6',
              border: '1px solid #2A2520',
              borderRadius: 2,
              padding: '3px 7px',
            }}
          />
          <button
            onClick={handleCreateService}
            className="cursor-pointer"
            style={{
              fontFamily: "'Oswald', sans-serif",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              background: 'linear-gradient(180deg, #3A2C10 0%, #261E08 100%)',
              border: '1px solid rgba(200,120,10,0.38)',
              color: '#C87C14',
              padding: '0 10px',
              height: 22,
              borderRadius: 2,
            }}
          >
            Create
          </button>
          <button
            onClick={() => { setShowNewService(false); setNewServiceTitle(''); }}
            className="cursor-pointer"
            style={{ color: '#3A332A', padding: '0 4px' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#7A7068'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#3A332A'; }}
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}

      {/* Items list */}
      <div className="flex-1 overflow-y-auto">
        {!serviceData ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 8,
            color: '#2E2820',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              {services.length === 0 ? 'No Service' : 'Select a Service'}
            </span>
          </div>
        ) : items.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 8,
            color: '#2E2820',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
            <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              Add Songs Below
            </span>
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
        <div style={{
          padding: '4px 12px',
          borderTop: '1px solid #181510',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#2E2820',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {items.length} {items.length !== 1 ? 'items' : 'item'}
          </span>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[{ label: 'Remove from Rundown', onClick: () => { onRemoveItem(contextMenu.item.id); setContextMenu(null); } }]}
        />
      )}
    </div>
  );
}
