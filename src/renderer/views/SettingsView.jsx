import React, { useState, useEffect } from 'react';
import OutputChannels from '../settings/OutputChannels';
import LogoSettings from '../settings/LogoSettings';
import BackgroundSettings from '../settings/BackgroundSettings';
import BibleSettings from '../settings/BibleSettings';
import ShortcutSettings from '../settings/ShortcutSettings';
import DangerZone from '../settings/DangerZone';

const NAV_ITEMS = [
  { id: 'rundown',  icon: 'list_alt',       label: 'Rundown' },
  { id: 'preview',  icon: 'visibility',      label: 'Preview' },
  { id: 'library',  icon: 'library_books',   label: 'Library' },
  { id: 'live',     icon: 'sensors',         label: 'Live' },
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function SettingsFooter() {
  const [dataPath, setDataPath] = useState('');
  const [diskUsage, setDiskUsage] = useState(null);

  useEffect(() => {
    window.cue.settings.getDataPath().then(setDataPath);
    window.cue.settings.getDiskUsage().then(setDiskUsage);
  }, []);

  return (
    <footer className="pt-lg border-t border-outline-variant/30 flex justify-between items-center">
      <div className="flex items-center gap-md">
        <div className="flex flex-col">
          <span className="text-label-sm font-label-sm text-on-surface">System Version</span>
          <span className="text-label-sm font-label-sm text-outline">v1.0.0 (Build 1)</span>
        </div>
        <div className="h-8 w-[1px] bg-outline-variant/30" />
        <div className="flex flex-col">
          <span className="text-label-sm font-label-sm text-on-surface">Storage</span>
          <span className="text-label-sm font-label-sm text-outline">
            {diskUsage !== null ? `${formatBytes(diskUsage)} used` : '—'}
          </span>
        </div>
        {dataPath && (
          <>
            <div className="h-8 w-[1px] bg-outline-variant/30" />
            <div className="flex flex-col">
              <span className="text-label-sm font-label-sm text-on-surface">Data Path</span>
              <span className="text-[10px] font-label-sm text-outline truncate max-w-48">{dataPath}</span>
            </div>
          </>
        )}
      </div>
      <button
        onClick={() => window.cue.settings.openDataFolder()}
        className="bg-surface-container text-on-surface px-lg py-sm rounded text-label-sm font-label-sm hover:bg-surface-container-high transition-all cursor-pointer"
      >
        Open Data Folder
      </button>
    </footer>
  );
}

export default function SettingsView({ onClose, activeServiceId, onRundownCleared, onRundownDeleted, onLibraryCleared }) {
  return (
    <div className="flex h-full bg-background">
      {/* Side navigation */}
      <aside className="flex flex-col w-20 h-full py-md gap-sm bg-surface-container-low items-center border-r border-outline-variant/20 shrink-0">
        <div className="mb-lg px-xs text-center">
          <span
            className="material-symbols-outlined text-2xl text-primary"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            tune
          </span>
        </div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={item.id === 'rundown' ? onClose : undefined}
            className="flex flex-col items-center gap-xs py-sm w-16 group hover:bg-surface-variant rounded-lg transition-all active:scale-95 cursor-pointer text-on-surface-variant hover:text-primary"
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="text-label-sm font-label-sm">{item.label}</span>
          </button>
        ))}
      </aside>

      {/* Main settings content */}
      <main className="flex-1 overflow-y-auto bg-background p-lg space-y-xl">
        <header className="mb-xl">
          <h1 className="text-display-lg font-bold text-on-surface">Settings</h1>
          <p className="text-body-md text-on-surface-variant mt-xs">
            Global system configuration and broadcast parameters.
          </p>
        </header>

        <OutputChannels />
        <LogoSettings />
        <BackgroundSettings activeServiceId={activeServiceId} />
        <BibleSettings />
        <ShortcutSettings />
        <DangerZone
          activeServiceId={activeServiceId}
          onRundownCleared={onRundownCleared}
          onRundownDeleted={onRundownDeleted}
          onLibraryCleared={onLibraryCleared}
        />
        <SettingsFooter />
      </main>
    </div>
  );
}
