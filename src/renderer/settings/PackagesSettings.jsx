import React, { useState, useEffect, useCallback } from 'react';
import PackageManagerModal from '../components/PackageManagerModal';

// Settings entry point for the Package Manager. Keeps the section itself lean — a
// one-line status summary plus a button that opens the full modal (per the design:
// manage packages in a modal, not an inline list, so Settings stays uncluttered).

function fmtBytes(b) {
  if (!b) return '0 MB';
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(0)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function PackagesSettings() {
  const [open, setOpen] = useState(false);
  const [pkgs, setPkgs] = useState(null);

  const refresh = useCallback(async () => {
    try { setPkgs(await window.cue.packages.list()); } catch { setPkgs([]); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const installed = pkgs?.filter((p) => p.status === 'installed') || [];
  const totalSize = installed.reduce((s, p) => s + (p.size || 0), 0);

  return (
    <section className="space-y-md">
      <div>
        <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>inventory_2</span>
          Packages
        </h2>
        <p className="text-body-sm text-on-surface-variant mt-xs">
          Optional modules that unlock extra features — YouTube playback, live streaming,
          PowerPoint import and scripture detection. Install what you need on demand.
        </p>
      </div>

      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-md flex items-center gap-lg">
        <div className="flex flex-col">
          <span className="text-display-sm font-bold text-on-surface tabular-nums">
            {pkgs ? `${installed.length}/${pkgs.length}` : '—'}
          </span>
          <span className="text-[11px] font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Installed</span>
        </div>
        <div className="h-10 w-[1px] bg-outline-variant/30" />
        <div className="flex flex-col">
          <span className="text-display-sm font-bold text-on-surface tabular-nums">{fmtBytes(totalSize)}</span>
          <span className="text-[11px] font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">On disk</span>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="ml-auto flex items-center gap-xs bg-primary text-on-primary px-lg h-10 rounded-lg text-label-sm font-label-sm hover:opacity-90 transition-opacity cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">tune</span>
          Manage Packages
        </button>
      </div>

      {open && <PackageManagerModal onClose={() => { setOpen(false); refresh(); }} />}
    </section>
  );
}
