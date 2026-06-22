import React from 'react';

// Streaming configuration moved to the dedicated Stream tab (top bar), which houses
// the external feed inputs, the live composite monitor, the layout/cut switcher, and
// Go Live — alongside the RTMP server/key/quality that used to live here.
export default function StreamSettings() {
  return (
    <section className="space-y-md">
      <div className="flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>live_tv</span>
        <h2 className="text-headline-md font-semibold text-on-surface">Streaming</h2>
      </div>
      <div className="bg-surface-container-low border border-primary/20 rounded-xl p-md ring-1 ring-primary/10 flex items-start gap-sm">
        <span className="material-symbols-outlined text-[16px] text-primary shrink-0 mt-[1px]">open_in_new</span>
        <p className="text-body-sm text-on-surface-variant">
          Streaming now lives in the <span className="text-on-surface font-medium">Stream</span> tab in the top bar.
          Bring in your video/audio feed, configure overlays and picture-in-picture, then Go Live from there.
          The in-room and NDI outputs are unaffected.
        </p>
      </div>
    </section>
  );
}
