import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { GPU_MODELS, downloadGpuModel, removeGpuModel, clearGpuModels } from '../audio/gpuModelStore';

// Package Manager — one clean surface for every optional dependency Cue can install:
// yt-dlp, ffmpeg, the on-device speech / verse-matching models, LibreOffice, and the
// opt-in GPU speech models. Shows what's installed, where, how big, what each unlocks,
// and what breaks if removed. Main-managed packages come from window.cue.packages;
// the GPU card is built here (its weights live in Chromium's Cache API, driven by the
// transformers.js web worker — see gpuModelStore).

function fmtBytes(b) {
  if (!b) return '—';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const ICONS = {
  'yt-dlp': 'smart_display',
  ffmpeg: 'movie',
  libreoffice: 'slideshow',
  'whisper-cpu': 'hearing',
  embed: 'manage_search',
  gpu: 'bolt',
};

export default function PackageManagerModal({ onClose }) {
  const [pkgs, setPkgs] = useState(null);
  const [progress, setProgress] = useState({});   // id → { percent, file }
  const [busyId, setBusyId] = useState(null);      // id currently installing/removing
  const [confirmRemove, setConfirmRemove] = useState(null); // id awaiting confirmation
  const [error, setError] = useState(null);        // { id, msg }

  // `window.cue.packages` is absent if the app is running an older preload (e.g. an
  // `npm start` that only hot-reloaded the renderer, not the main/preload process) —
  // guard so the modal shows a clear hint instead of hanging on "Loading…".
  const hasApi = !!(window.cue && window.cue.packages);

  const refresh = useCallback(async () => {
    if (!hasApi) { setPkgs([]); return; }
    try { setPkgs(await window.cue.packages.list()); }
    catch (e) { setError({ id: null, msg: e?.message || 'Failed to read packages' }); setPkgs([]); }
  }, [hasApi]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const off = window.cue.on('packages:progress', ({ id, percent }) => {
      setProgress((p) => ({ ...p, [id]: { percent } }));
    });
    return off;
  }, []);

  // The whisper CPU model installs through the scripture manager (it owns model choice
  // + thread budgets), which streams progress on `scripture:status`, not packages:progress.
  // Bridge that stream into the whisper-cpu card's bar.
  useEffect(() => {
    const off = window.cue.on('scripture:status', (s) => {
      if (s?.download?.kind === 'asr') {
        setProgress((p) => ({ ...p, 'whisper-cpu': { percent: s.download.percent || 0 } }));
      }
    });
    return off;
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busyId) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busyId, onClose]);

  const install = useCallback(async (id) => {
    setError(null); setBusyId(id); setProgress((p) => ({ ...p, [id]: { percent: 0 } }));
    const res = await window.cue.packages.install(id);
    setBusyId(null);
    setProgress((p) => { const n = { ...p }; delete n[id]; return n; });
    if (res && res.ok === false) setError({ id, msg: res.error || 'Install failed' });
    refresh();
  }, [refresh]);

  const remove = useCallback(async (id) => {
    setConfirmRemove(null); setError(null); setBusyId(id);
    const res = await window.cue.packages.remove(id);
    setBusyId(null);
    if (res && res.ok === false) setError({ id, msg: res.error || 'Remove failed' });
    refresh();
  }, [refresh]);

  const locate = useCallback(async (id) => {
    setError(null); setBusyId(id);
    const res = await window.cue.packages.locate(id);
    setBusyId(null);
    if (res && res.ok === false && !res.canceled) {
      setError({ id, msg: 'That file didn’t work — pick the executable itself.' });
    }
    refresh();
  }, [refresh]);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] bg-background/80 backdrop-blur-sm flex items-center justify-center p-lg"
      onClick={busyId ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[720px] max-w-full max-h-[86vh] flex flex-col bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden"
      >
        <div className="flex items-center gap-sm px-lg h-12 bg-surface-container-high border-b border-outline-variant/30 shrink-0">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>inventory_2</span>
          <span className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface">Package Manager</span>
          <button
            onClick={onClose}
            disabled={!!busyId}
            className="ml-auto text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-30"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-lg overflow-y-auto custom-scrollbar space-y-md">
          <p className="text-body-sm text-on-surface-variant">
            Cue ships lean — these optional modules are downloaded on demand to unlock extra
            features. Install what you need, remove what you don't.
          </p>

          {error && error.id === null && (
            <p className="text-body-sm text-error bg-error/10 border border-error/30 rounded-lg px-md py-sm">{error.msg}</p>
          )}

          {!hasApi ? (
            <div className="py-lg text-center space-y-xs">
              <span className="material-symbols-outlined text-secondary text-[28px]">restart_alt</span>
              <p className="text-body-md text-on-surface font-bold">Restart Cue to finish loading</p>
              <p className="text-body-sm text-on-surface-variant max-w-sm mx-auto">
                The Package Manager was just added. Fully quit and reopen the app
                (a dev hot-reload doesn’t refresh the background process).
              </p>
            </div>
          ) : pkgs === null ? (
            <div className="py-xl text-center text-body-sm text-on-surface-variant">Loading…</div>
          ) : (
            <>
              {pkgs.map((p) => (
                <PackageCard
                  key={p.id}
                  pkg={p}
                  busy={busyId === p.id}
                  anyBusy={!!busyId}
                  progress={progress[p.id]}
                  error={error?.id === p.id ? error.msg : null}
                  confirming={confirmRemove === p.id}
                  onInstall={() => install(p.id)}
                  onRemove={() => remove(p.id)}
                  onAskRemove={() => setConfirmRemove(p.id)}
                  onCancelRemove={() => setConfirmRemove(null)}
                  onReveal={() => window.cue.packages.reveal(p.id)}
                  onLocate={() => locate(p.id)}
                  onExternal={() => window.cue.openExternal(p.externalUrl)}
                />
              ))}
              <GpuPackageCard anyBusy={!!busyId} onBusy={setBusyId} busyId={busyId} />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── main-managed package card ──────────────────────────────────────────────────
function PackageCard({
  pkg, busy, anyBusy, progress, error, confirming,
  onInstall, onRemove, onAskRemove, onCancelRemove, onReveal, onLocate, onExternal,
}) {
  const installed = pkg.status === 'installed';
  const pct = progress ? Math.round((progress.percent || 0) * 100) : null;

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden">
      <div className="flex items-start gap-md p-md">
        <span
          className={`material-symbols-outlined text-[22px] mt-[2px] ${installed ? 'text-tertiary' : 'text-on-surface-variant/60'}`}
          style={installed ? { fontVariationSettings: "'FILL' 1" } : undefined}
        >
          {ICONS[pkg.id] || 'package_2'}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-sm">
            <span className="text-body-md font-bold text-on-surface">{pkg.name}</span>
            <StatusPill installed={installed} managed={pkg.managed} />
            {installed && pkg.size > 0 && (
              <span className="text-[11px] font-label-sm text-on-surface-variant tabular-nums">{fmtBytes(pkg.size)}</span>
            )}
            {pkg.version && <span className="text-[11px] font-label-sm text-on-surface-variant truncate">{pkg.version}</span>}
          </div>

          <ul className="mt-xs space-y-[2px]">
            {pkg.features.map((f, i) => (
              <li key={i} className="text-body-sm text-on-surface-variant flex items-start gap-xs">
                <span className="material-symbols-outlined text-[14px] text-tertiary/70 mt-[2px]">check_small</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          {installed && pkg.location && (
            <button
              onClick={onReveal}
              title="Show in file manager"
              className="mt-xs inline-flex items-center gap-xs text-[11px] font-label-sm text-on-surface-variant/70 hover:text-primary transition-colors cursor-pointer max-w-full"
            >
              <span className="material-symbols-outlined text-[13px]">folder_open</span>
              <span className="truncate">{pkg.location}</span>
            </button>
          )}

          {pkg.id === 'libreoffice' && !installed && (
            <p className="mt-xs text-[11px] font-label-sm text-on-surface-variant/70">
              A separate free install. Get it from the official site, then Cue detects it automatically —
              or point Cue at an existing copy.
            </p>
          )}

          {error && <p className="mt-xs text-[11px] font-label-sm text-error">{error}</p>}

          {confirming && (
            <div className="mt-sm bg-error/10 border border-error/30 rounded-lg p-sm">
              <p className="text-[11px] font-label-sm text-on-surface">
                Remove {pkg.name}? {pkg.losesOnRemove}
              </p>
              <div className="flex items-center gap-xs mt-sm">
                <button
                  onClick={onRemove}
                  className="px-md h-7 rounded-lg bg-error text-on-error text-label-sm font-label-sm hover:opacity-90 transition-opacity cursor-pointer"
                >
                  Remove
                </button>
                <button
                  onClick={onCancelRemove}
                  className="px-md h-7 rounded-lg bg-surface-container-high text-on-surface-variant text-label-sm font-label-sm hover:text-on-surface transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Action column */}
        <div className="shrink-0 flex flex-col items-end gap-xs w-28">
          {busy && pct !== null ? (
            <div className="w-full">
              <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="block text-right text-[10px] font-label-sm text-primary tabular-nums mt-[3px]">{pct}%</span>
            </div>
          ) : busy ? (
            <span className="text-label-sm font-label-sm text-primary animate-pulse">Working…</span>
          ) : installed ? (
            <>
              {pkg.removable && !confirming && (
                <button
                  onClick={onAskRemove}
                  disabled={anyBusy}
                  className="w-full px-sm h-8 rounded-lg border border-outline-variant/40 bg-surface-container-high text-on-surface-variant text-label-sm font-label-sm hover:text-error hover:border-error/50 transition-colors cursor-pointer disabled:opacity-40"
                >
                  Remove
                </button>
              )}
              {!pkg.removable && !pkg.managed && (
                <span className="text-[10px] font-label-sm text-on-surface-variant/60 text-right">
                  {pkg.kind === 'external' ? 'System install' : 'On PATH'}
                </span>
              )}
            </>
          ) : pkg.installable ? (
            <>
              <button
                onClick={onInstall}
                disabled={anyBusy}
                className="w-full flex items-center justify-center gap-xs px-sm h-8 rounded-lg bg-primary text-on-primary text-label-sm font-label-sm hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[15px]">download</span>Install
              </button>
              {pkg.locatable && (
                <button
                  onClick={onLocate}
                  disabled={anyBusy}
                  title="Already installed elsewhere? Point Cue at it."
                  className="w-full px-sm h-7 rounded-lg border border-outline-variant/40 bg-surface-container-high text-on-surface-variant text-label-sm font-label-sm hover:text-on-surface transition-colors cursor-pointer disabled:opacity-40"
                >
                  Locate…
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={onExternal}
                disabled={anyBusy}
                className="w-full flex items-center justify-center gap-xs px-sm h-8 rounded-lg bg-primary text-on-primary text-label-sm font-label-sm hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[15px]">open_in_new</span>Get
              </button>
              {pkg.locatable && (
                <button
                  onClick={onLocate}
                  disabled={anyBusy}
                  className="w-full px-sm h-7 rounded-lg border border-outline-variant/40 bg-surface-container-high text-on-surface-variant text-label-sm font-label-sm hover:text-on-surface transition-colors cursor-pointer disabled:opacity-40"
                >
                  Locate…
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ installed, managed }) {
  if (installed) {
    return (
      <span className="inline-flex items-center gap-xs px-xs h-5 rounded-full bg-tertiary/15 text-tertiary text-[10px] font-label-sm uppercase tracking-[0.06em]">
        <span className="material-symbols-outlined text-[12px]">check_circle</span>Installed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-xs h-5 rounded-full bg-surface-container-highest text-on-surface-variant/70 text-[10px] font-label-sm uppercase tracking-[0.06em]">
      Not installed
    </span>
  );
}

// ── GPU speech models (renderer-managed, Chromium Cache API) ─────────────────────
function GpuPackageCard({ anyBusy, onBusy, busyId }) {
  const [hw, setHw] = useState(undefined);        // undefined probing · null none · { label }
  const [downloaded, setDownloaded] = useState({});
  const [usage, setUsage] = useState(0);
  const [pct, setPct] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  const busy = busyId === 'gpu';

  const refresh = useCallback(async () => {
    try {
      const cfg = await window.cue.scriptureDetect.getConfig();
      setDownloaded(cfg.gpuModels || {});
    } catch {}
    try { setUsage(await window.cue.scriptureDetect.getGpuModelUsage()); } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.gpu) { if (!cancelled) setHw(null); return; }
        const adapter = await navigator.gpu.requestAdapter();
        if (cancelled) return;
        if (!adapter || adapter.isFallbackAdapter) { setHw(null); return; }
        const info = adapter.info || {};
        setHw({ label: [info.vendor, info.architecture || info.description].filter(Boolean).join(' ') || 'GPU' });
      } catch { if (!cancelled) setHw(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  const anyDownloaded = Object.values(downloaded).some(Boolean);
  const rec = GPU_MODELS[0];

  const install = async () => {
    setError(null); onBusy('gpu'); setPct(0);
    try {
      await downloadGpuModel(rec.id, (p) => setPct(p));
      const cfg = await window.cue.scriptureDetect.getConfig();
      await window.cue.scriptureDetect.setConfig({ gpuModels: { ...(cfg.gpuModels || {}), [rec.id]: true } });
    } catch (e) {
      setError(e.message || 'Download failed');
    }
    setPct(null); onBusy(null); refresh();
  };

  const remove = async () => {
    setConfirming(false); onBusy('gpu');
    try {
      await clearGpuModels();
      await window.cue.scriptureDetect.setConfig({ gpuModels: {} });
    } catch (e) { setError(e.message || 'Remove failed'); }
    onBusy(null); refresh();
  };

  const percent = pct !== null ? Math.round(pct * 100) : null;

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden">
      <div className="flex items-start gap-md p-md">
        <span
          className={`material-symbols-outlined text-[22px] mt-[2px] ${anyDownloaded ? 'text-tertiary' : 'text-on-surface-variant/60'}`}
          style={anyDownloaded ? { fontVariationSettings: "'FILL' 1" } : undefined}
        >
          {ICONS.gpu}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-sm">
            <span className="text-body-md font-bold text-on-surface">GPU Speech Acceleration</span>
            <StatusPill installed={anyDownloaded} managed />
            {anyDownloaded && usage > 0 && (
              <span className="text-[11px] font-label-sm text-on-surface-variant tabular-nums">{fmtBytes(usage)}</span>
            )}
          </div>
          <ul className="mt-xs space-y-[2px]">
            <li className="text-body-sm text-on-surface-variant flex items-start gap-xs">
              <span className="material-symbols-outlined text-[14px] text-tertiary/70 mt-[2px]">check_small</span>
              <span>Faster, more accurate scripture detection using your GPU</span>
            </li>
          </ul>
          <p className="mt-xs text-[11px] font-label-sm text-on-surface-variant/70">
            {hw === undefined ? 'Detecting GPU…'
              : hw ? `GPU: ${hw.label}`
              : 'No compatible GPU detected — the CPU model is used instead.'}
            {' '}Fine-tune which GPU model in Settings → Detect.
          </p>
          {error && <p className="mt-xs text-[11px] font-label-sm text-error">{error}</p>}
          {confirming && (
            <div className="mt-sm bg-error/10 border border-error/30 rounded-lg p-sm">
              <p className="text-[11px] font-label-sm text-on-surface">
                Remove all downloaded GPU speech models? Detection falls back to the CPU model.
              </p>
              <div className="flex items-center gap-xs mt-sm">
                <button onClick={remove} className="px-md h-7 rounded-lg bg-error text-on-error text-label-sm font-label-sm hover:opacity-90 transition-opacity cursor-pointer">Remove</button>
                <button onClick={() => setConfirming(false)} className="px-md h-7 rounded-lg bg-surface-container-high text-on-surface-variant text-label-sm font-label-sm hover:text-on-surface transition-colors cursor-pointer">Cancel</button>
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-xs w-28">
          {busy && percent !== null ? (
            <div className="w-full">
              <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
              </div>
              <span className="block text-right text-[10px] font-label-sm text-primary tabular-nums mt-[3px]">{percent}%</span>
            </div>
          ) : busy ? (
            <span className="text-label-sm font-label-sm text-primary animate-pulse">Working…</span>
          ) : anyDownloaded ? (
            !confirming && (
              <button
                onClick={() => setConfirming(true)}
                disabled={anyBusy}
                className="w-full px-sm h-8 rounded-lg border border-outline-variant/40 bg-surface-container-high text-on-surface-variant text-label-sm font-label-sm hover:text-error hover:border-error/50 transition-colors cursor-pointer disabled:opacity-40"
              >
                Remove
              </button>
            )
          ) : (
            <button
              onClick={install}
              disabled={anyBusy || hw === null}
              title={hw === null ? 'No compatible GPU' : `Downloads ${rec.label} (~${rec.approxMB} MB)`}
              className="w-full flex items-center justify-center gap-xs px-sm h-8 rounded-lg bg-primary text-on-primary text-label-sm font-label-sm hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[15px]">download</span>Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
