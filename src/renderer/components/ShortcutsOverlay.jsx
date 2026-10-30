import React, { useEffect, useState } from 'react';
import { shortcutGroups, combo } from '../utils/shortcuts';

// Live keyboard-shortcut cheatsheet, opened with `?` from the operator. Reads the
// configurable shortcut settings so it always reflects the operator's own keymap,
// and lists the fixed single-key shortcuts. Close with Esc / backdrop / ✕.

function Key({ children }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[26px] h-7 px-sm text-[13px] tabular-nums whitespace-nowrap text-on-surface bg-surface-container-high border border-outline-variant/40 rounded-md">
      {children}
    </span>
  );
}

function Row({ keys, desc }) {
  return (
    <div className="flex items-center gap-md py-[6px]">
      <div className="flex items-center gap-xs w-[160px] shrink-0">
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-on-surface-variant/60 text-[11px]">/</span>}
            <Key>{k}</Key>
          </React.Fragment>
        ))}
      </div>
      <span className="text-body-md text-on-surface-variant">{desc}</span>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-on-surface mb-xs">{title}</p>
      <div className="divide-y divide-outline-variant/10">{children}</div>
    </div>
  );
}

export default function ShortcutsOverlay({ onClose }) {
  const [sc, setSc] = useState({ go: 'g', logo: 'l', live: 'o' });

  useEffect(() => {
    Promise.all([
      window.cue.settings.get('keyboard_go'),
      window.cue.settings.get('keyboard_logo'),
      window.cue.settings.get('keyboard_live'),
    ]).then(([go, logo, live]) => {
      setSc({ go: go ?? 'g', logo: logo ?? 'l', live: live ?? 'o' });
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-xl" onClick={onClose}>
      <div className="w-full max-w-5xl bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-lg py-md border-b border-outline-variant/20 flex items-center justify-between">
          <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>keyboard</span>
            Keyboard shortcuts
          </h2>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-variant cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="px-lg py-md grid grid-cols-2 gap-x-xl gap-y-lg max-h-[70vh] overflow-auto custom-scrollbar">
          {shortcutGroups(sc).map((g) => (
            <Group key={g.title} title={g.title}>
              {g.rows.map((r) => <Row key={r.desc} keys={r.keys} desc={r.desc} />)}
            </Group>
          ))}
        </div>
        <div className="px-lg py-sm border-t border-outline-variant/20 flex items-center justify-between gap-md">
          <span className="text-[12px] text-on-surface-variant">
            Single-key GO, Clear and Outputs only work while Hotkeys are on. {combo('mod')} shortcuts always work. Keys are set in Settings › Shortcuts.
          </span>
          <button
            onClick={() => {
              ['layout_h_pct', 'layout_v_pct'].forEach((k) => localStorage.removeItem(k));
              window.location.reload();
            }}
            className="shrink-0 text-[12px] text-on-surface-variant hover:text-on-surface cursor-pointer underline underline-offset-2 transition-colors"
          >
            Reset panel layout
          </button>
        </div>
      </div>
    </div>
  );
}
