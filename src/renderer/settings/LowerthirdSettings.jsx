import React, { useState, useEffect } from 'react';

// Global lower-third appearance. The font scale is a single percentage of the
// authored (fullscreen) lyric size, applied ONLY to the lower-third output — so
// the L3 band can run a smaller relative font than the screen. 100% = identical
// to the screen; main pushes the change live (no reload) via output.lowerthird.
const PRESETS = [30, 50, 70, 100];

export default function LowerthirdSettings() {
  const [scale, setScale] = useState(100);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    window.cue.settings.get('lowerthird_font_scale').then((v) => {
      const n = Number(v);
      setScale(isFinite(n) && n > 0 ? n : 100);
      setLoaded(true);
    });
  }, []);

  // Persist + live-update through the dedicated output channel (which writes the
  // setting AND re-broadcasts the current slide so on-air L3 restyles instantly).
  function apply(pct) {
    const n = Math.max(1, Math.min(150, Math.round(pct)));
    setScale(n);
    window.cue.output.lowerthird.setFontScale(n);
  }

  return (
    <section className="space-y-md">
      <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary">subtitles</span>
        Lower Third
      </h2>

      <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30 space-y-md">
        <div>
          <h4 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">
            Font Size
          </h4>
          <p className="text-body-sm text-on-surface-variant/70 mt-xs">
            Lower-third lyric size as a percentage of the full-screen size. 100% matches
            the screen; lower it for a smaller caption band. Full-screen output is unaffected.
          </p>
        </div>

        {/* Live readout */}
        <div className="flex items-baseline gap-sm">
          <span className="text-[40px] leading-none font-bold tabular-nums text-on-surface">
            {scale}
          </span>
          <span className="text-headline-md font-semibold text-on-surface-variant">%</span>
          <span className="ml-auto text-body-sm text-on-surface-variant/60">
            of full-screen size
          </span>
        </div>

        {/* Slider */}
        <input
          type="range"
          min={1}
          max={150}
          step={1}
          value={scale}
          disabled={!loaded}
          onChange={(e) => apply(Number(e.target.value))}
          className="w-full accent-primary cursor-pointer disabled:opacity-50"
        />
        <div className="flex justify-between text-[10px] font-label-sm uppercase tracking-[0.08em] text-outline">
          <span>1%</span>
          <span>75%</span>
          <span>150%</span>
        </div>

        {/* Quick presets */}
        <div className="flex gap-sm">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => apply(p)}
              className={`flex-1 h-8 rounded-lg border text-label-sm font-label-sm font-bold tabular-nums transition-all cursor-pointer ${
                scale === p
                  ? 'border-primary bg-primary/8 text-primary'
                  : 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:border-outline-variant/60'
              }`}
            >
              {p}%
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
