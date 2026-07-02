import React, { useEffect, useState } from 'react';

// Live keyboard-shortcut cheatsheet, opened with `?` from the operator. Reads the
// configurable shortcut settings so it always reflects the operator's own keymap,
// and lists the fixed single-key shortcuts. Close with Esc / backdrop / ✕.

const isMac = window.cue.platform === 'darwin';

function Key({ children }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[26px] h-7 px-2 text-label-sm font-mono text-on-surface bg-surface-container-high border border-outline-variant/40 rounded">
      {children}
    </span>
  );
}

function Row({ keys, desc }) {
  return (
    <div className="flex items-center gap-md py-[6px]">
      <div className="flex items-center gap-xs w-40 shrink-0">
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-on-surface-variant/50 text-[11px]">/</span>}
            <Key>{k}</Key>
          </React.Fragment>
        ))}
      </div>
      <span className="text-body-sm text-on-surface-variant">{desc}</span>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div>
      <p className="text-label-sm font-label-sm text-on-surface-variant/70 uppercase tracking-[0.08em] mb-xs">{title}</p>
      <div className="divide-y divide-outline-variant/10">{children}</div>
    </div>
  );
}

export default function ShortcutsOverlay({ onClose }) {
  const [sc, setSc] = useState({ modifier: isMac ? 'meta' : 'ctrl', go: 'g', clear: 'c', logo: 'l', live: 'o' });

  useEffect(() => {
    Promise.all([
      window.cue.settings.get('keyboard_modifier'),
      window.cue.settings.get('keyboard_go'),
      window.cue.settings.get('keyboard_clear'),
      window.cue.settings.get('keyboard_logo'),
      window.cue.settings.get('keyboard_live'),
    ]).then(([mod, go, clear, logo, live]) => {
      setSc({
        modifier: mod ?? (isMac ? 'meta' : 'ctrl'),
        go: go ?? 'g', clear: clear ?? 'c', logo: logo ?? 'l', live: live ?? 'o',
      });
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mod = sc.modifier === 'meta' ? '⌘' : sc.modifier === 'alt' ? '⌥' : 'Ctrl';
  const up = (s) => (s || '').toUpperCase();

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-xl" onClick={onClose}>
      <div className="w-full max-w-2xl bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-lg py-md border-b border-outline-variant/20 flex items-center justify-between">
          <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>keyboard</span>
            Keyboard Shortcuts
          </h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-on-surface-variant/60 hover:text-on-surface cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="px-lg py-md grid grid-cols-2 gap-x-xl gap-y-lg max-h-[70vh] overflow-auto">
          <Group title="Transport">
            <Row keys={['Space']} desc="Advance LIVE to the next slide" />
            <Row keys={[`${mod}+${up(sc.go)}`, 'G']} desc="GO — send preview to live" />
            <Row keys={[`${mod}+${up(sc.clear)}`, 'Esc']} desc="Clear all outputs" />
            <Row keys={[`${mod}+${up(sc.logo)}`, 'L']} desc="Show logo on all outputs" />
            <Row keys={[`${mod}+${up(sc.live)}`]} desc="Toggle output windows on / off" />
          </Group>
          <Group title="Navigation">
            <Row keys={['↓']} desc="Next preview slide / item" />
            <Row keys={['↑']} desc="Previous preview slide / item" />
            <Row keys={['Q', 'W', 'E', '…']} desc="Jump LIVE to slide 1, 2, 3 … (when armed)" />
            <Row keys={['S']} desc="Focus the song search bar" />
            <Row keys={[`${isMac ? '⌘' : 'Ctrl'}+A`]} desc="Select all rundown items" />
            <Row keys={[`${isMac ? '⌘' : 'Ctrl'}+.`, `${isMac ? '⌘' : 'Ctrl'}+,`]} desc="Next / previous Library tab" />
          </Group>
          <Group title="Scenes">
            <Row keys={['1', '9']} desc="Recall the Scene bound to that number" />
          </Group>
          <Group title="Global">
            <Row keys={[`${isMac ? '⌘' : 'Ctrl'}+K`]} desc="Command palette — find & add anything" />
            <Row keys={['?']} desc="Show / hide this cheatsheet" />
          </Group>
        </div>
        <div className="px-lg py-sm border-t border-outline-variant/20 flex items-center justify-between gap-md">
          <span className="text-[11px] text-on-surface-variant/60">
            Bare G / Esc fire on a single press only when armed (Settings → Shortcuts). The {mod}-shortcuts always work.
          </span>
          <button
            onClick={() => {
              ['layout_h_pct', 'layout_v_pct'].forEach((k) => localStorage.removeItem(k));
              window.location.reload();
            }}
            className="shrink-0 text-[11px] text-on-surface-variant/50 hover:text-on-surface-variant cursor-pointer underline underline-offset-2 transition-colors"
          >
            Reset panel layout
          </button>
        </div>
      </div>
    </div>
  );
}
