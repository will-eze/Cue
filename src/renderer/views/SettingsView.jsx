import React, { useState, useEffect, useRef } from 'react';
import OutputChannels from '../settings/OutputChannels';
import LogoSettings from '../settings/LogoSettings';
import BackgroundSettings from '../settings/BackgroundSettings';
import ThemeSettings from '../settings/ThemeSettings';
import TransitionSettings from '../settings/TransitionSettings';
import BibleSettings from '../settings/BibleSettings';
import TagSettings from '../settings/TagSettings';
import FontSettings from '../settings/FontSettings';
import MediaCleanup from '../settings/MediaCleanup';
import ShortcutSettings from '../settings/ShortcutSettings';
import RemoteSettings from '../settings/RemoteSettings';
import ScriptureDetectionSettings from '../settings/ScriptureDetectionSettings';
import DataSettings from '../settings/DataSettings';
import DangerZone from '../settings/DangerZone';

// Each section is an anchor in the scrollable settings column. Clicking a nav
// item smooth-scrolls to it; the active item is tracked as the user scrolls.
const SECTIONS = [
  { id: 'channels',   icon: 'cast',            label: 'Channels' },
  { id: 'logo',       icon: 'image',           label: 'Logo' },
  { id: 'background', icon: 'wallpaper',       label: 'Background' },
  { id: 'themes',     icon: 'style',           label: 'Themes' },
  { id: 'transitions', icon: 'animation',      label: 'Motion' },
  { id: 'bible',      icon: 'menu_book',       label: 'Bible' },
  { id: 'tags',       icon: 'sell',            label: 'Tags' },
  { id: 'fonts',      icon: 'font_download',   label: 'Fonts' },
  { id: 'media',      icon: 'cleaning_services', label: 'Media' },
  { id: 'shortcuts',  icon: 'keyboard',        label: 'Shortcuts' },
  { id: 'remote',     icon: 'cell_tower',      label: 'Remote' },
  { id: 'detect',     icon: 'hearing',         label: 'Detect' },
  { id: 'data',       icon: 'database',        label: 'Data' },
  { id: 'danger',     icon: 'warning',         label: 'Danger' },
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
          <span className="text-label-sm font-label-sm text-outline">v{__APP_VERSION__} (Build {__BUILD_NUMBER__})</span>
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
  const scrollRef = useRef(null);
  const sectionRefs = useRef({});
  const [active, setActive] = useState(SECTIONS[0].id);

  function scrollTo(id) {
    const el = sectionRefs.current[id];
    const root = scrollRef.current;
    if (!el || !root) return;
    // Measure the section's position relative to the scroll container directly
    // (getBoundingClientRect), so the jump is correct regardless of offsetParent —
    // `offsetTop` is only valid when <main> is the positioned ancestor, which it
    // isn't, so it landed off for lower sections.
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 24;
    root.scrollTo({ top, behavior: 'smooth' });
    setActive(id);
  }

  // Highlight the section currently in view as the operator scrolls.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.dataset.section);
      },
      { root, rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    );
    Object.values(sectionRefs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const setRef = (id) => (el) => { sectionRefs.current[id] = el; };

  return (
    <div className="flex h-full bg-background">
      {/* Section navigation */}
      <aside className="flex flex-col w-24 h-full bg-surface-container-low items-center border-r border-outline-variant/20 shrink-0">
        <button
          onClick={onClose}
          title="Back to Operator"
          className="mt-md mb-sm shrink-0 flex flex-col items-center gap-xs py-sm w-20 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-variant transition-all active:scale-95 cursor-pointer"
        >
          <span className="material-symbols-outlined">arrow_back</span>
          <span className="text-label-sm font-label-sm">Back</span>
        </button>

        {/* The section list scrolls on its own so every header stays reachable on
            short screens — without it the bottom items (Data/Danger) were clipped. */}
        <nav className="flex flex-col items-center gap-xs w-full overflow-y-auto custom-scrollbar pb-md">
          {SECTIONS.map((item) => {
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className={`shrink-0 flex flex-col items-center gap-xs py-sm w-20 rounded-lg transition-all active:scale-95 cursor-pointer ${
                  isActive
                    ? 'bg-surface-variant text-primary'
                    : 'text-on-surface-variant hover:text-primary hover:bg-surface-variant'
                }`}
              >
                <span className="material-symbols-outlined" style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}>{item.icon}</span>
                <span className="text-label-sm font-label-sm">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main settings content */}
      <main ref={scrollRef} className="flex-1 overflow-y-auto bg-background p-lg space-y-xl">
        <header className="mb-xl">
          <h1 className="text-display-lg font-bold text-on-surface">Settings</h1>
          <p className="text-body-md text-on-surface-variant mt-xs">
            Global system configuration and broadcast parameters.
          </p>
        </header>

        <section ref={setRef('channels')} data-section="channels" className="scroll-mt-lg"><OutputChannels /></section>
        <section ref={setRef('logo')} data-section="logo" className="scroll-mt-lg"><LogoSettings /></section>
        <section ref={setRef('background')} data-section="background" className="scroll-mt-lg"><BackgroundSettings activeServiceId={activeServiceId} /></section>
        <section ref={setRef('themes')} data-section="themes" className="scroll-mt-lg"><ThemeSettings /></section>
        <section ref={setRef('transitions')} data-section="transitions" className="scroll-mt-lg"><TransitionSettings /></section>
        <section ref={setRef('bible')} data-section="bible" className="scroll-mt-lg"><BibleSettings /></section>
        <section ref={setRef('tags')} data-section="tags" className="scroll-mt-lg"><TagSettings /></section>
        <section ref={setRef('fonts')} data-section="fonts" className="scroll-mt-lg"><FontSettings /></section>
        <section ref={setRef('media')} data-section="media" className="scroll-mt-lg"><MediaCleanup /></section>
        <section ref={setRef('shortcuts')} data-section="shortcuts" className="scroll-mt-lg"><ShortcutSettings /></section>
        <section ref={setRef('remote')} data-section="remote" className="scroll-mt-lg"><RemoteSettings /></section>
        <section ref={setRef('detect')} data-section="detect" className="scroll-mt-lg"><ScriptureDetectionSettings /></section>
        <section ref={setRef('data')} data-section="data" className="scroll-mt-lg"><DataSettings /></section>
        <section ref={setRef('danger')} data-section="danger" className="scroll-mt-lg">
          <DangerZone
            activeServiceId={activeServiceId}
            onRundownCleared={onRundownCleared}
            onRundownDeleted={onRundownDeleted}
            onLibraryCleared={onLibraryCleared}
          />
        </section>
        <SettingsFooter />
      </main>
    </div>
  );
}
