import React, { useState, useEffect } from 'react';

function formatBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Backup / restore of the whole installation as one portable .cuebackup file
// (cue.db + every media asset). Restore is destructive — it replaces the live
// database and media, then relaunches — so it sits behind a confirm step.
export default function DataSettings() {
  const [diskUsage, setDiskUsage] = useState(null);
  const [busy, setBusy] = useState(null);   // 'export' | 'restore'
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => { window.cue.settings.getDiskUsage().then(setDiskUsage); }, []);

  function showFeedback(msg, kind = 'ok') {
    setFeedback({ msg, kind });
    setTimeout(() => setFeedback(null), 3000);
  }

  async function handleExport() {
    setBusy('export');
    try {
      const res = await window.cue.settings.exportBackup();
      if (res?.ok) showFeedback(`Backup saved (${formatBytes(res.size)})`);
      else if (!res?.canceled) showFeedback('Export failed', 'error');
    } catch {
      showFeedback('Export failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore() {
    setConfirming(false);
    setBusy('restore');
    try {
      const res = await window.cue.settings.importBackup();
      if (res?.ok) showFeedback('Backup restored — relaunching…');
      else if (!res?.canceled) showFeedback(res?.error || 'Restore failed', 'error');
    } catch (err) {
      showFeedback(err?.message || 'Restore failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-md">
      <div>
        <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>database</span>
          Data
        </h2>
        <p className="text-body-sm text-on-surface-variant mt-xs">
          Back up everything — songs, rundowns, themes, settings and all media — to a single
          <span className="font-label-sm"> .cuebackup</span> file, and restore it on any machine.
        </p>
      </div>

      <div className="bg-surface-container rounded-xl border border-outline-variant/30">
        {/* Export */}
        <div className="flex items-center gap-md px-lg py-md border-b border-outline-variant/20">
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-semibold text-on-surface">Export backup</p>
            <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
              Save a complete snapshot of the database and media ({formatBytes(diskUsage)} of media).
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={busy != null}
            className="px-md py-xs text-label-sm font-label-sm font-bold bg-surface-container-high border border-primary/40 text-primary hover:bg-primary/10 active:scale-95 transition-all cursor-pointer rounded-lg uppercase tracking-[0.05em] whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === 'export' ? 'Exporting…' : 'Export'}
          </button>
        </div>

        {/* Restore */}
        <div className="flex items-center gap-md px-lg py-md">
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-semibold text-on-surface">Restore backup</p>
            <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
              Replace the current database and media with a backup file. This overwrites everything
              and relaunches Cue. Cannot be undone.
            </p>
          </div>
          {confirming ? (
            <div className="flex items-center gap-sm flex-wrap">
              <span className="text-label-sm font-label-sm text-error uppercase tracking-[0.05em] whitespace-nowrap">Overwrite all?</span>
              <button
                onClick={handleRestore}
                className="px-md py-xs text-label-sm font-label-sm font-bold bg-error-container text-error rounded-lg border border-error/40 hover:brightness-110 active:scale-95 transition-all cursor-pointer uppercase tracking-[0.05em] whitespace-nowrap"
              >
                Choose file
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="px-md py-xs text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface bg-surface-container hover:bg-surface-variant border border-outline-variant/30 rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={busy != null}
              className="px-md py-xs text-label-sm font-label-sm font-bold bg-surface-container-high border border-error/40 text-error hover:bg-error-container/20 active:scale-95 transition-all cursor-pointer rounded-lg uppercase tracking-[0.05em] whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'restore' ? 'Restoring…' : 'Restore'}
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-sm bg-surface-container-high border rounded-xl px-lg py-sm text-on-surface text-body-sm shadow-2xl pointer-events-none ${feedback.kind === 'error' ? 'border-error/40 ring-1 ring-error/10' : 'border-tertiary/40 ring-1 ring-tertiary/10'}`}>
          <span
            className={`material-symbols-outlined text-[16px] ${feedback.kind === 'error' ? 'text-error' : 'text-tertiary'}`}
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {feedback.kind === 'error' ? 'error' : 'check_circle'}
          </span>
          {feedback.msg}
        </div>
      )}
    </section>
  );
}
