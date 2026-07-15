import React, { useState, useEffect } from 'react';
import ShortcutsOverlay from '../components/ShortcutsOverlay';

const isMac = window.cue.platform === 'darwin';
const MOD = isMac ? '⌘' : 'Ctrl';

// Transport lives entirely on BARE keys (no modifier) so the ⌘/Ctrl accelerators
// stay reserved for standard app actions (clipboard, undo, save, formatting…).
// These three bare keys are configurable; Clear is fixed to Esc.
const ACTIONS = [
  { key: 'keyboard_go',   label: 'GO',            desc: 'Send preview to live output' },
  { key: 'keyboard_logo', label: 'Logo',          desc: 'Show logo on all outputs' },
  { key: 'keyboard_live', label: 'Output Toggle', desc: 'Enable / disable output windows' },
];

const DEFAULTS = { go: 'g', logo: 'l', live: 'o' };

// Bare-key transport (no modifier) — always active when no text field is focused.
const BARE_SHORTCUTS = [
  { keys: ['Space'],      desc: 'Advance LIVE to the next slide' },
  { keys: ['↓'],          desc: 'Next preview slide / item' },
  { keys: ['↑'],          desc: 'Previous preview slide / item' },
  { keys: ['Esc'],        desc: 'Clear — hide content on all outputs' },
  { keys: ['S'],          desc: 'Focus the song search bar' },
  { keys: ['Q', 'W', 'E', '…'], desc: 'Jump LIVE to slide 1, 2, 3 … (when verse-jump is armed)' },
  { keys: ['1', '–', '9'], desc: 'Recall the Scene bound to that number' },
  { keys: ['`'],          desc: 'Toggle the Stage controls panel' },
];

// Standard app shortcuts on the OS modifier — same as any desktop app, never
// shadowed by transport.
const MOD_SHORTCUTS = [
  { keys: [`${MOD}+C`, `${MOD}+X`, `${MOD}+V`], desc: 'Copy / cut / paste (text)' },
  { keys: [`${MOD}+Z`, `${MOD}+⇧Z`], desc: 'Undo / redo (in editors)' },
  { keys: [`${MOD}+S`], desc: 'Save the open editor' },
  { keys: [`${MOD}+B`, `${MOD}+I`, `${MOD}+U`], desc: 'Bold / italic / underline (in editors)' },
  { keys: [`${MOD}+A`], desc: 'Select all rundown items (or text, when text is selected)' },
  { keys: [`${MOD}+D`], desc: 'Duplicate the selected rundown item(s)' },
  { keys: [`${MOD}+F`], desc: 'Find — focus the song search bar' },
  { keys: [`${MOD}+N`], desc: 'New — open the command palette to add anything' },
  { keys: [`${MOD}+K`], desc: 'Command palette — find & add anything' },
  { keys: [`${MOD}+,`], desc: 'Open / leave Settings' },
  { keys: ['Ctrl+Tab', 'Ctrl+⇧Tab'], desc: 'Next / previous Library tab' },
  { keys: ['?'], desc: 'Show the keyboard-shortcut overlay' },
];

export default function ShortcutSettings() {
  const [keys, setKeys] = useState(DEFAULTS);
  const [armBare, setArmBare] = useState(true);
  const [armJump, setArmJump] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    Promise.all([
      window.cue.settings.get('shortcut_arm_bare'),
      window.cue.settings.get('shortcut_arm_jump'),
      ...ACTIONS.map((a) => window.cue.settings.get(a.key)),
    ]).then(([arm, armJ, ...vals]) => {
      setArmBare(arm !== false); // default armed when unset
      setArmJump(armJ === true); // default disarmed when unset
      const loaded = {};
      ACTIONS.forEach((a, i) => { loaded[a.key] = vals[i] ?? DEFAULTS[a.key.replace('keyboard_', '')]; });
      setKeys(loaded);
    });
  }, []);

  async function handleSave() {
    await window.cue.settings.set('shortcut_arm_bare', armBare);
    await window.cue.settings.set('shortcut_arm_jump', armJump);
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
          Live transport runs on <span className="text-on-surface font-medium">bare keys</span> (no modifier), so the
          {' '}{MOD} accelerators stay free for standard app actions — copy/paste, undo, save, formatting. Bare keys are
          active whenever no text field is focused.
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

      {/* Configurable bare transport keys */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
        <div className="px-md py-sm border-b border-outline-variant/20">
          <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">
            Transport Keys (bare — press without a modifier)
          </span>
        </div>
        {ACTIONS.map((action, i) => (
          <div
            key={action.key}
            className={`px-md py-sm flex items-center gap-lg ${i < ACTIONS.length - 1 ? 'border-b border-outline-variant/20' : ''}`}
          >
            <div className="w-40 shrink-0">
              <p className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em]">{action.label}</p>
              <p className="text-[11px] text-on-surface-variant mt-[2px]">{action.desc}</p>
            </div>
            <input
              value={(keys[action.key] ?? '').toUpperCase()}
              onChange={(e) => handleKeyInput(action.key, e)}
              maxLength={2}
              className="w-10 h-8 text-center text-label-sm font-mono text-on-surface bg-surface-container-lowest border border-outline-variant/50 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 uppercase"
            />
          </div>
        ))}
      </div>

      {/* Fixed reference — bare transport */}
      <ReferenceCard title="Bare keys (transport — no modifier)" rows={BARE_SHORTCUTS} />
      {/* Fixed reference — standard app shortcuts */}
      <ReferenceCard title="Standard app shortcuts (with the OS modifier)" rows={MOD_SHORTCUTS} />

      {/* Safety: arm the bare GO / Clear / Output keys (a stray press can't go to air). */}
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
          <p className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em]">Arm bare GO / Clear / Output</p>
          <p className="text-[11px] text-on-surface-variant mt-[2px]">
            When armed, a single press of the bare <span className="font-mono">GO</span>, <span className="font-mono">Esc</span> (Clear)
            or <span className="font-mono">Output Toggle</span> key goes straight to air. Disarm to lock those keys — a stray
            press is ignored, and you use the on-screen buttons instead.
          </p>
        </div>
      </div>

      {/* Arm the positional verse-jump keys (Q W E …). Off by default. */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl px-md py-sm flex items-center gap-lg">
        <button
          onClick={() => setArmJump((v) => !v)}
          role="switch"
          aria-checked={armJump}
          className={`relative w-10 h-6 rounded-full shrink-0 transition-colors cursor-pointer ${armJump ? 'bg-tertiary-container' : 'bg-surface-container-highest'}`}
        >
          <span className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-on-surface transition-all ${armJump ? 'left-[19px]' : 'left-[3px]'}`} />
        </button>
        <div className="flex-1">
          <p className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em]">Arm verse-jump keys</p>
          <p className="text-[11px] text-on-surface-variant mt-[2px]">
            When armed, the positional keys <span className="font-mono">Q W E R …</span> jump the
            LIVE item straight to slide 1, 2, 3 … and air it — direct on-air navigation instead of
            stepping with arrows. Each live slide shows its letter. Disarm to free those letters for other use.
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

function ReferenceCard({ title, rows }) {
  return (
    <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
      <div className="px-md py-sm border-b border-outline-variant/20">
        <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">{title}</span>
      </div>
      {rows.map((row, i) => (
        <div
          key={i}
          className={`px-md py-sm flex items-center gap-lg ${i < rows.length - 1 ? 'border-b border-outline-variant/20' : ''}`}
        >
          <div className="flex items-center gap-xs w-44 shrink-0 flex-wrap">
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
  );
}
