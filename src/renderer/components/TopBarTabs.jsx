import React, { useState, useRef } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SECTIONS } from '../views/SettingsView';
import AnchoredMenu from './AnchoredMenu';

// Pinnable extra destinations for the top bar: every Settings subsection, deep-linked
// as `settings:<id>`. The three base views (Operator/Multiview/Settings) are fixed in
// App and never appear here.
const DESTINATIONS = SECTIONS.map((s) => ({ id: `settings:${s.id}`, label: s.label, icon: s.icon }));
// Keep the bar from overflowing the titlebar — cap how many extras can be pinned.
const MAX_EXTRA = 6;
const labelFor = (id) => DESTINATIONS.find((d) => d.id === id)?.label ?? id;
const iconFor  = (id) => DESTINATIONS.find((d) => d.id === id)?.icon ?? 'tune';

// One pinned, draggable, removable tab. A plain click navigates; a >5px drag
// reorders (dnd-kit activation distance), so the two never fight.
function SortableTab({ id, active, onNavigate, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onNavigate(id)}
      title={`${labelFor(id)} — drag to reorder`}
      className={`titlebar-nodrag group relative h-full flex items-center gap-xs pl-sm pr-md text-label-sm font-label-sm tracking-[0.05em] uppercase cursor-pointer transition-colors border-b-2 ${
        active
          ? 'text-primary border-primary'
          : 'text-on-surface-variant hover:text-on-surface border-transparent'
      }`}
    >
      <span className="material-symbols-outlined text-[14px]">{iconFor(id)}</span>
      {labelFor(id)}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(id); }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Unpin tab"
        className="absolute right-[2px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 hidden group-hover:flex items-center justify-center rounded-full text-on-surface-variant/60 hover:text-error hover:bg-surface-variant"
      >
        <span className="material-symbols-outlined text-[12px]">close</span>
      </button>
    </div>
  );
}

export default function TopBarTabs({ extraTabs, activeTabId, onNavigate, onReorder, onRemove, onAdd, onReset }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapRef = useRef(null);
  const pickerBtnRef = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const available = DESTINATIONS.filter((d) => !extraTabs.includes(d.id));
  const atCap = extraTabs.length >= MAX_EXTRA;

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIdx = extraTabs.indexOf(active.id);
    const newIdx = extraTabs.indexOf(over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    onReorder(arrayMove(extraTabs, oldIdx, newIdx));
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={extraTabs} strategy={horizontalListSortingStrategy}>
          {extraTabs.map((id) => (
            <SortableTab key={id} id={id} active={activeTabId === id} onNavigate={onNavigate} onRemove={onRemove} />
          ))}
        </SortableContext>
      </DndContext>

      <div className="relative titlebar-nodrag" ref={wrapRef}>
        <button
          ref={pickerBtnRef}
          onClick={() => setPickerOpen((v) => !v)}
          title="Pin a Settings section as a tab"
          className={`h-6 w-6 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
            pickerOpen ? 'bg-surface-variant text-primary' : 'text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-variant'
          }`}
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
        </button>

        <AnchoredMenu
          open={pickerOpen}
          anchorRef={pickerBtnRef}
          onClose={() => setPickerOpen(false)}
          align="left"
          zIndex={60}
          className="titlebar-nodrag w-52 bg-surface-container-high border border-outline-variant/40 rounded-xl shadow-2xl ring-1 ring-white/5 overflow-hidden"
        >
            <div className="px-md py-xs border-b border-outline-variant/20">
              <span className="text-[9px] font-label-sm uppercase tracking-[0.08em] text-on-surface-variant/60">Pin a Settings tab</span>
            </div>
            <div className="max-h-[50vh] overflow-y-auto custom-scrollbar py-xs">
              {atCap ? (
                <p className="px-md py-sm text-[11px] text-on-surface-variant/50">Tab limit reached — unpin one first.</p>
              ) : available.length === 0 ? (
                <p className="px-md py-sm text-[11px] text-on-surface-variant/50">All sections pinned.</p>
              ) : available.map((d) => (
                <button
                  key={d.id}
                  onClick={() => { onAdd(d.id); setPickerOpen(false); }}
                  className="w-full flex items-center gap-sm px-md py-xs text-label-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-variant cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px]">{d.icon}</span>
                  {d.label}
                </button>
              ))}
            </div>
            {extraTabs.length > 0 && (
              <div className="border-t border-outline-variant/20">
                <button
                  onClick={() => { onReset(); setPickerOpen(false); }}
                  className="w-full flex items-center gap-sm px-md py-xs text-label-sm text-on-surface-variant/70 hover:text-error hover:bg-surface-variant cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px]">restart_alt</span>
                  Reset to default
                </button>
              </div>
            )}
        </AnchoredMenu>
      </div>
    </>
  );
}
