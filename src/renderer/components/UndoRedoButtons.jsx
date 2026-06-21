import React from 'react';

const isMac = window.cue?.platform === 'darwin';
const mod = isMac ? '⌘' : 'Ctrl+';

// Undo / Redo pair for an editor toolbar. Driven by a useEditHistory instance —
// pass its { undo, redo, canUndo, canRedo }. Matches the mission-control chrome:
// flat surface, Inter, no shadow. Disabled (dimmed) when there's nothing to undo/redo.
export default function UndoRedoButtons({ undo, redo, canUndo, canRedo }) {
  return (
    <div className="flex items-center gap-[2px]">
      <button
        onClick={undo}
        disabled={!canUndo}
        title={`Undo (${mod}Z)`}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-variant disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors"
      >
        <span className="material-symbols-outlined text-[17px]">undo</span>
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        title={`Redo (${mod}⇧Z)`}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-variant disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors"
      >
        <span className="material-symbols-outlined text-[17px]">redo</span>
      </button>
    </div>
  );
}
