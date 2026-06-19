import React, { useState, useEffect, useRef } from 'react';

// Mirrors the library in src/output/transitions.js. Labels/icons are renderer-only.
const STYLES = [
  { id: 'none',        label: 'Cut' },
  { id: 'fade',        label: 'Fade' },
  { id: 'slide-left',  label: 'Slide ←' },
  { id: 'slide-right', label: 'Slide →' },
  { id: 'slide-up',    label: 'Slide ↑' },
  { id: 'slide-down',  label: 'Slide ↓' },
  { id: 'zoom-in',     label: 'Zoom In' },
  { id: 'zoom-out',    label: 'Zoom Out' },
];

const TRIGGERS = [
  { id: 'slide', label: 'Slide Change', icon: 'compare_arrows',     desc: 'Between lyric / scripture / presentation slides, and on content go-live.' },
  { id: 'logo',  label: 'Logo',         icon: 'branding_watermark', desc: 'Showing or hiding the logo bug.' },
  { id: 'clear', label: 'Clear',        icon: 'visibility_off',     desc: 'Clearing the program text, or restoring it.' },
];

const EASINGS = [
  { id: 'ease',                        label: 'Ease' },
  { id: 'ease-in-out',                 label: 'In-Out' },
  { id: 'cubic-bezier(0.22,1,0.36,1)', label: 'Smooth' },
  { id: 'linear',                      label: 'Linear' },
];

const DEFAULTS = {
  slide: { type: 'fade', durationMs: 350, easing: 'ease' },
  logo:  { type: 'fade', durationMs: 350, easing: 'ease' },
  clear: { type: 'fade', durationMs: 250, easing: 'ease' },
};

// Keyframes for the live preview — mirrors src/output/transitions.js spec().
function previewKeyframes(type) {
  switch (type) {
    case 'fade':        return { base: [{ opacity: 0 }, { opacity: 1 }], ghost: [{ opacity: 1 }, { opacity: 0 }] };
    case 'slide-left':  return { base: [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }],  ghost: [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }] };
    case 'slide-right': return { base: [{ transform: 'translateX(-100%)' }, { transform: 'translateX(0)' }], ghost: [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }] };
    case 'slide-up':    return { base: [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }],  ghost: [{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }] };
    case 'slide-down':  return { base: [{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }], ghost: [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }] };
    case 'zoom-in':     return { base: [{ transform: 'scale(0.9)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], ghost: [{ opacity: 1 }, { opacity: 0 }] };
    case 'zoom-out':    return { base: [{ transform: 'scale(1.1)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], ghost: [{ opacity: 1 }, { opacity: 0 }] };
    default:            return null;
  }
}

export default function TransitionSettings() {
  const [cfg, setCfg] = useState(DEFAULTS);

  useEffect(() => {
    window.cue.settings.get('output_transitions').then((saved) => {
      if (saved) setCfg({ ...DEFAULTS, ...saved });
    });
  }, []);

  function update(trigger, patch) {
    setCfg((prev) => {
      const next = { ...prev, [trigger]: { ...prev[trigger], ...patch } };
      window.cue.settings.set('output_transitions', next);
      return next;
    });
  }

  return (
    <section className="space-y-md">
      <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary">animation</span>
        Transitions
      </h2>
      <p className="text-body-md text-on-surface-variant -mt-xs">
        Animate how the program output changes. Slides with a video background or a video
        item always hard-cut, regardless of these settings.
      </p>

      {TRIGGERS.map((t) => (
        <TriggerRow key={t.id} trigger={t} value={cfg[t.id]} onChange={(patch) => update(t.id, patch)} />
      ))}
    </section>
  );
}

function TriggerRow({ trigger, value, onChange }) {
  return (
    <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30 space-y-md">
      <div className="flex items-start gap-md">
        <span className="material-symbols-outlined text-primary mt-xs">{trigger.icon}</span>
        <div className="flex-1">
          <h4 className="text-headline-md font-semibold text-on-surface">{trigger.label}</h4>
          <p className="text-body-sm text-on-surface-variant mt-xs">{trigger.desc}</p>
        </div>
        <TransitionPreview value={value} />
      </div>

      {/* Style picker */}
      <div className="grid grid-cols-4 gap-sm">
        {STYLES.map((s) => {
          const active = value.type === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onChange({ type: s.id })}
              className={`px-sm py-md rounded-lg border-2 text-label-sm font-label-sm font-bold uppercase tracking-[0.05em] transition-all active:scale-95 cursor-pointer ${
                active
                  ? 'border-primary bg-primary/8 text-primary'
                  : 'border-outline-variant/30 bg-surface-container-low text-on-surface hover:border-outline-variant/60'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Duration + easing — irrelevant when Cut, so dim them */}
      <div className={`flex items-center gap-lg ${value.type === 'none' ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-xs">
            <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Duration</span>
            <span className="text-label-sm font-label-sm text-primary tabular-nums">{value.durationMs} ms</span>
          </div>
          <input
            type="range"
            min={100}
            max={1200}
            step={50}
            value={value.durationMs}
            onChange={(e) => onChange({ durationMs: Number(e.target.value) })}
            className="w-full accent-primary cursor-pointer"
          />
        </div>
        <div>
          <span className="block text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em] mb-xs">Easing</span>
          <div className="flex gap-xs">
            {EASINGS.map((e) => (
              <button
                key={e.id}
                onClick={() => onChange({ easing: e.id })}
                className={`px-sm py-xs rounded text-label-sm font-label-sm transition-all cursor-pointer ${
                  value.easing === e.id
                    ? 'bg-primary-container text-on-primary-container font-bold'
                    : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-variant'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// A small two-card swatch that replays the selected transition on click — so the
// operator sees exactly what it looks like before going live.
function TransitionPreview({ value }) {
  const baseRef = useRef(null);
  const ghostRef = useRef(null);

  function play() {
    const base = baseRef.current, ghost = ghostRef.current;
    if (!base || !ghost) return;
    const dur = value.type === 'none' ? 0 : value.durationMs;
    const easing = value.easing || 'ease';
    base.getAnimations().forEach((a) => a.cancel());
    ghost.getAnimations().forEach((a) => a.cancel());

    if (value.type === 'none') {
      ghost.style.opacity = '0';
      setTimeout(() => { ghost.style.opacity = '1'; }, 240);
      return;
    }
    const kf = previewKeyframes(value.type);
    if (!kf) return;
    ghost.style.opacity = '1';
    ghost.style.transform = 'none';
    base.style.transform = 'none';
    base.style.opacity = '1';
    if (kf.base) base.animate(kf.base, { duration: dur, easing, fill: 'none' });
    const g = ghost.animate(kf.ghost, { duration: dur, easing, fill: 'forwards' });
    g.onfinish = () => { setTimeout(() => { try { g.cancel(); ghost.style.opacity = '1'; ghost.style.transform = 'none'; } catch {} }, 500); };
  }

  return (
    <button
      onClick={play}
      title="Preview"
      className="relative w-28 h-16 rounded-lg overflow-hidden border border-outline-variant/40 shrink-0 cursor-pointer group"
    >
      {/* base = incoming (revealed); ghost = outgoing (animates away) */}
      <div ref={baseRef} className="absolute inset-0 flex items-center justify-center bg-primary/25">
        <span className="text-label-sm font-label-sm text-on-surface/80">NEXT</span>
      </div>
      <div ref={ghostRef} className="absolute inset-0 flex items-center justify-center bg-secondary/25">
        <span className="text-label-sm font-label-sm text-on-surface/80">NOW</span>
      </div>
      <span className="absolute bottom-0.5 right-1 material-symbols-outlined text-[14px] text-on-surface/50 group-hover:text-primary">play_arrow</span>
    </button>
  );
}
