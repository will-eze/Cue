import React, { useState, useEffect } from 'react';
import ShortcutsOverlay from '../components/ShortcutsOverlay';

const isMac = window.cue.platform === 'darwin';

const ACTIONS = [
  { key: 'keyboard_go',    label: 'GO',          desc: 'Send preview to live output' },
  { key: 'keyboard_clear', label: 'Clear',        desc: 'Hide content on all outputs' },
  { key: 'keyboard_logo',  label: 'Logo',         desc: 'Show logo on all outputs' },
  { key: 'keyboard_live',  label: 'Live Toggle',  desc: 'Enable / disable output windows' },
];

const DEFAULTS = { modifier: isMac ? 'meta' : 'ctrl', go: 'g', clear: 'c', logo: 'l', live: 'o' };

const FIXED_SHORTCUTS = [
  { keys: ['G'],          desc: 'GO — send preview to live' },
  { keys: ['L'],          desc: 'Logo — show logo on all outputs' },
  { keys: ['Esc'],        desc: 'Clear — hide content on all outputs' },
  { keys: ['S'],          desc: 'Search — focus the song search bar' },
  { keys: ['↓', 'Space'], desc: 'Next slide (or next rundown item at end of song)' },
  { keys: ['↑'],          desc: 'Previous slide (or previous rundown item at start)' },
  { keys: [isMac ? '⌘.' : 'Ctrl+.', isMac ? '⌘,' : 'Ctrl+,'], desc: 'Next / previous Library tab' },
  { keys: [isMac ? '⌘K' : 'Ctrl+K'], desc: 'Command palette — find & add anything' },
  { keys: ['?'],          desc: 'Show the keyboard-shortcut overlay' },
];

export default function ShortcutSettings() {
  const [modifier, setModifier] = useState(DEFAULTS.modifier);
  const [keys, setKeys] = useState({ keyboard_go: 'g', keyboard_clear: 'c', keyboard_logo: 'l', keyboard_live: 'o' });
  const [armBare, setArmBare] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    Promise.all([
      window.cue.settings.get('keyboard_modifier'),
      window.cue.settings.get('shortcut_arm_bare'),
      ...ACTIONS.map((a) => window.cue.settings.get(a.key)),
    ]).then(([mod, arm, ...vals]) => {
      if (mod) setModifier(mod);
      setArmBare(arm !== false); // default armed when unset
      const loaded = {};
      ACTIONS.forEach((a, i) => { loaded[a.key] = vals[i] ?? DEFAULTS[a.key.replace('keyboard_', '')]; });
      setKeys(loaded);
    });
  }, []);

  async function handleSave() {
    await window.cue.settings.set('keyboard_modifier', modifier);
    await window.cue.settings.set('shortcut_arm_bare', armBare);
    await Promise.all(ACTIONS.map((a) => window.cue.settings.set(a.key, keys[a.key])));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleKeyInput(settingKey, e) {
    const raw = e.target.value;
    const char = raw.slice(-1).toLowerCase();
    if (char && /^[a-z0-9,./;'[\]]$/.test(char)) {
      setKeys((prev) => ({ ...prev, [settingKey]: char }));
    }
  }

  const modSymbol = modifier === 'meta' ? '⌘' : modifier === 'alt' ? '⎇' : 'Ctrl';

  return (
    <section className="space-y-md">
      {showAll && <ShortcutsOverlay onClose={() => setShowAll(false)} />}
      <div className="flex items-start justify-between gap-md">
        <div>
        <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>keyboard</span>
          Keyboard Shortcuts
        </h2>
        <p className="text-body-sm text-on-surface-variant mt-xs">
          Modifier shortcuts work even when switching between views. Single-key shortcuts (below) are always active when no text field is focused.
        </p>
        </div>
        <button
          onClick={() => setShowAll(true)}
          className="shrink-0 mt-xs px-md py-xs text-label-sm font-label-sm font-bold uppercase tracking-[0.05em] text-primary border border-primary/40 rounded-lg hover:bg-primary-container/20 active:scale-95 transition-all cursor-pointer flex items-center gap-xs"
        >
          <span className="material-symbols-outlined text-[16px]">visibility</span>
          View All
        </button>
      </div>

      {/* Modifier + configurable shortcuts */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
        {/* Modifier selector */}
        <div className="px-md py-sm border-b border-outline-variant/20 flex items-center gap-lg">
          <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em] w-32 shrink-0">
            Modifier Key
          </span>
          <div className="flex items-center gap-sm">
            {isMac && (
              <ModifierChip label="⌘ Cmd"   active={modifier === 'meta'} onClick={() => setModifier('meta')} />
            )}
            <ModifierChip label={isMac ? '⌃ Ctrl' : 'Ctrl'} active={modifier === 'ctrl'} onClick={() => setModifier('ctrl')} />
            {!isMac && (
              <ModifierChip label="Alt" active={modifier === 'alt'} onClick={() => setModifier('alt')} />
            )}
          </div>
        </div>

        {/* Action rows */}
        {ACTIONS.map((action, i) => (
          <div
            key={action.key}
            className={`px-md py-sm flex items-center gap-lg ${i < ACTIONS.length - 1 ? 'border-b border-outline-variant/20' : ''}`}
          >
            <div className="w-32 shrink-0">
              <p className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em]">{action.label}</p>
              <p className="text-[11px] text-on-surface-variant mt-[2px]">{action.desc}</p>
            </div>
            <div className="flex items-center gap-sm">
              <span className="text-label-sm font-mono text-on-surface-variant bg-surface-container-high border border-outline-variant/30 px-sm py-[3px] rounded text-[11px] shrink-0">
                {modSymbol}
              </span>
              <span className="text-on-surface-variant text-label-sm">+</span>
              <input
                value={(keys[action.key] ?? '').toUpperCase()}
                onChange={(e) => handleKeyInput(action.key, e)}
                maxLength={2}
                className="w-10 h-8 text-center text-label-sm font-mono text-on-surface bg-surface-container-lowest border border-outline-variant/50 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 uppercase"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Fixed shortcuts reference */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
        <div className="px-md py-sm border-b border-outline-variant/20">
          <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">
            Fixed Shortcuts (always active, not configurable)
          </span>
        </div>
        {FIXED_SHORTCUTS.map((row, i) => (
          <div
            key={i}
            className={`px-md py-sm flex items-center gap-lg ${i < FIXED_SHORTCUTS.length - 1 ? 'border-b border-outline-variant/20' : ''}`}
          >
            <div className="flex items-center gap-xs w-32 shrink-0">
              {row.keys.map((k) => (
                <span
                  key={k}
                  className="text-label-sm font-mono text-on-surface-variant bg-surface-container-high border border-outline-variant/30 px-sm py-[3px] rounded text-[11px] shrink-0"
                >
                  {k}
                </span>
              ))}
            </div>
            <span className="text-body-sm text-on-surface-variant">{row.desc}</span>
          </div>
        ))}
      </div>

      {/* Safety: arm the bare GO / Clear keys (the modifier shortcuts stay instant). */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl px-md py-sm flex items-center gap-lg">
        <button
          onClick={() => setArmBare((v) => !v)}
          role="switch"
          aria-checked={armBare}
          className={`relative w-10 h-6 rounded-full shrink-0 transition-colors cursor-pointer ${armBare ? 'bg-tertiary-container' : 'bg-surface-container-highest'}`}
        >
          <span className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-on-surface transition-all ${armBare ? 'left-[19px]' : 'left-[3px]'}`} />
        </button>
        <div className="flex-1">
          <p className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em]">Arm bare GO / Clear</p>
          <p className="text-[11px] text-on-surface-variant mt-[2px]">
            When armed, a single press of <span className="font-mono">G</span> (GO) or <span className="font-mono">Esc</span> (Clear)
            goes straight to air. Disarm to lock those bare keys — a stray press is ignored, and you use the
            {' '}{modSymbol}-shortcuts or the on-screen buttons instead.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-on-surface-variant/50 font-mono">
          Changes take effect after returning to Operator view.
        </p>
        <button
          onClick={handleSave}
          className={`px-lg py-sm text-label-sm font-label-sm font-bold rounded-lg transition-all cursor-pointer uppercase tracking-[0.05em] ${
            saved
              ? 'bg-tertiary-container text-on-tertiary-container'
              : 'bg-primary-container text-on-primary hover:brightness-110 active:scale-95'
          }`}
        >
          {saved ? '✓ Saved' : 'Save Shortcuts'}
        </button>
      </div>
    </section>
  );
}

function ModifierChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-md py-xs text-label-sm font-mono rounded-lg border transition-all cursor-pointer ${
        active
          ? 'bg-primary-container/30 border-primary/50 text-primary'
          : 'border-outline-variant/30 text-on-surface-variant hover:border-outline-variant hover:text-on-surface'
      }`}
    >
      {label}
    </button>
  );
}
