import React from 'react';
import OutputChannels from '../settings/OutputChannels';
import LogoSettings from '../settings/LogoSettings';
import BackgroundSettings from '../settings/BackgroundSettings';
import ShortcutSettings from '../settings/ShortcutSettings';

const NAV_ITEMS = [
  { id: 'rundown',  icon: 'list_alt',       label: 'Rundown' },
  { id: 'preview',  icon: 'visibility',      label: 'Preview' },
  { id: 'library',  icon: 'library_books',   label: 'Library' },
  { id: 'live',     icon: 'sensors',         label: 'Live' },
];

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

      {/* Main settings content — all sections in one scrollable page */}
      <main className="flex-1 overflow-y-auto bg-background p-lg space-y-xl">
        <header className="mb-xl">
          <h1 className="text-display-lg font-bold text-on-surface">Settings</h1>
          <p className="text-body-md text-on-surface-variant mt-xs">
            Global system configuration and broadcast parameters.
          </p>
        </header>

        <OutputChannels />
        <LogoSettings />
        <BackgroundSettings
          activeServiceId={activeServiceId}
          onRundownCleared={onRundownCleared}
          onRundownDeleted={onRundownDeleted}
          onLibraryCleared={onLibraryCleared}
        />
        <ShortcutSettings />
      </main>
    </div>
  );
}
