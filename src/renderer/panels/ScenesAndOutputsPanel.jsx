import React, { useState } from 'react';
import ScenesPanel from './ScenesPanel';
import OutputPresetsPanel from './OutputPresetsPanel';

// Combined Library tab hosting the two recall systems side by side:
//   • Scenes         — recall the live LOOK (graphics overlay + program + audio)
//   • Output Presets — recall the output RIG (channels / displays / NDI / stream / stage)
// They stay separate features (separate capture + apply); this just groups them under one
// Library tab with a segmented switch so they're not two competing top-level tabs.

export default function ScenesAndOutputsPanel({ onBackgroundDefaultChanged }) {
  const [view, setView] = useState('scenes');
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-xs px-md h-10 border-b border-outline-variant/30 shrink-0 bg-surface-container-low">
        <Seg active={view === 'scenes'} onClick={() => setView('scenes')} icon="bolt" label="Scenes" />
        <Seg active={view === 'outputs'} onClick={() => setView('outputs')} icon="tune" label="Output Presets" />
      </div>
      <div className="flex-1 min-h-0">
        {view === 'scenes'
          ? <ScenesPanel />
          : <OutputPresetsPanel onBackgroundDefaultChanged={onBackgroundDefaultChanged} />}
      </div>
    </div>
  );
}

function Seg({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-xs px-md py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.04em] transition-colors cursor-pointer ${
        active ? 'bg-primary/15 text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
      }`}>
      <span className="material-symbols-outlined text-[15px]">{icon}</span>{label}
    </button>
  );
}
