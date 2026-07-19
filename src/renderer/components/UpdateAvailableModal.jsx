import React, { useState, useEffect, useRef } from 'react';
import { useModalGuard } from '../utils/modalGuard';
import { useFocusTrap } from '../utils/useFocusTrap';

// Launch-time "Update available" prompt. Fired by main's background version check
// (see index.js `update:available`) — this modal never checks on its own, it just
// renders whatever result main sent. "Skip This Version" persists so the same
// version doesn't re-prompt on the next launch; "Later" just dismisses for now.
export default function UpdateAvailableModal({ info, onClose }) {
  useModalGuard();
  const [status, setStatus] = useState('idle'); // idle | downloading | error
  const [pct, setPct] = useState(0);
  const [error, setError] = useState('');
  const panelRef = useRef(null);
  useFocusTrap(panelRef);

  useEffect(() => {
    return window.cue.on('update:progress', ({ received, total }) => {
      setPct(total ? Math.round((received / total) * 100) : 0);
    });
  }, []);

  async function install() {
    setStatus('downloading');
    setPct(0);
    const res = await window.cue.settings.downloadUpdate(info.asset);
    if (!res.ok) { setError(res.error || 'Download failed'); setStatus('error'); }
    // on success the app quits as the installer launches.
  }

  function skipThisVersion() {
    window.cue.settings.set('update_skipped_version', info.latest);
    onClose();
  }

  const downloading = status === 'downloading';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={downloading ? undefined : onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Update Available"
        className="w-[480px] bg-surface-container-high border border-outline-variant/40 rounded-xl ring-1 ring-white/5 shadow-2xl p-lg flex flex-col gap-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-sm">
          <span className="material-symbols-outlined text-[20px] text-primary">system_update</span>
          <h2 className="text-body-lg text-on-surface font-medium">Update Available — v{info.latest}</h2>
        </div>

        <p className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case -mt-xs">
          You're on v{info.current}. Installing quits Cue and relaunches the installer — save or clear
          the program first.
        </p>

        {info.notes && (
          <div className="max-h-32 overflow-y-auto bg-surface-container-lowest border border-outline-variant/30 rounded px-md py-sm">
            <pre className="text-label-sm font-label-sm text-on-surface-variant normal-case tracking-normal whitespace-pre-wrap font-sans">{info.notes}</pre>
          </div>
        )}

        {status === 'error' && (
          <span className="text-label-sm font-label-sm text-error normal-case tracking-normal">{error}</span>
        )}

        {downloading ? (
          <div className="flex items-center gap-sm">
            <span className="text-label-sm font-label-sm text-primary uppercase tracking-wide whitespace-nowrap">Downloading… {pct}%</span>
            <div className="flex-1 h-1 bg-surface-container-lowest rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-sm mt-xs">
            <button
              onClick={skipThisVersion}
              className="px-md py-xs rounded text-label-sm font-label-sm text-on-surface-variant hover:bg-surface-variant transition-colors cursor-pointer"
            >Skip This Version</button>
            <button
              onClick={onClose}
              className="px-md py-xs rounded text-label-sm font-label-sm text-on-surface-variant hover:bg-surface-variant transition-colors cursor-pointer"
            >Later</button>
            <button
              onClick={install}
              className="bg-primary text-on-primary px-lg py-xs rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center gap-xs"
            >
              <span className="material-symbols-outlined text-[14px]">download</span>
              Install Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
