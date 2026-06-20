import React, { useState, useEffect } from 'react';

function ConfirmButton({ label, confirmLabel = 'Yes, delete', disabled = false, onConfirm }) {
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-sm flex-wrap">
        <span className="text-label-sm font-label-sm text-error uppercase tracking-[0.05em] whitespace-nowrap">Are you sure?</span>
        <button
          onClick={handleConfirm}
          className="px-md py-xs text-label-sm font-label-sm font-bold bg-error-container text-error rounded-lg border border-error/40 hover:brightness-110 active:scale-95 transition-all cursor-pointer uppercase tracking-[0.05em] whitespace-nowrap"
        >
          {confirmLabel}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-md py-xs text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface bg-surface-container hover:bg-surface-variant border border-outline-variant/30 rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em]"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      disabled={disabled}
      className="px-md py-xs text-label-sm font-label-sm font-bold bg-surface-container-high border border-error/40 text-error hover:bg-error-container/20 active:scale-95 transition-all cursor-pointer rounded-lg uppercase tracking-[0.05em] whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}

export default function DangerZone({ activeServiceId, onRundownCleared, onRundownDeleted, onLibraryCleared, onMediaCleared }) {
  const [services, setServices] = useState([]);
  const [clearServiceId, setClearServiceId] = useState(null);
  const [deleteServiceId, setDeleteServiceId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  function loadServices() {
    window.cue.services.list().then((list) => {
      setServices(list);
      const fallback = activeServiceId ?? (list.length > 0 ? list[0].id : null);
      setClearServiceId((prev) => (prev && list.some((s) => s.id === prev) ? prev : fallback));
      setDeleteServiceId((prev) => (prev && list.some((s) => s.id === prev) ? prev : fallback));
    });
  }

  useEffect(() => { loadServices(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeServiceId != null) {
      setClearServiceId(activeServiceId);
      setDeleteServiceId(activeServiceId);
    }
  }, [activeServiceId]);

  function showFeedback(msg) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  }

  async function handleClearRundown() {
    if (!clearServiceId) return;
    const service = await window.cue.services.get(clearServiceId);
    const items = service?.items || [];
    for (const item of items) {
      await window.cue.services.removeItem(item.id);
    }
    onRundownCleared?.(clearServiceId);
    const name = services.find((s) => s.id === clearServiceId)?.title || 'Rundown';
    showFeedback(`"${name}" cleared`);
  }

  async function handleDeleteRundown() {
    if (!deleteServiceId) return;
    const deletedId = deleteServiceId;
    const name = services.find((s) => s.id === deletedId)?.title || 'Rundown';
    await window.cue.services.delete(deletedId);
    onRundownDeleted?.(deletedId);
    loadServices();
    showFeedback(`"${name}" deleted`);
  }

  async function handleClearLibrary() {
    await window.cue.songs.deleteAll();
    onLibraryCleared?.();
    showFeedback('Song library cleared');
  }

  async function handleClearMedia() {
    const removed = await window.cue.media.deleteAll();
    onMediaCleared?.();
    showFeedback(removed ? `${removed} media file${removed === 1 ? '' : 's'} deleted` : 'Media library already empty');
  }

  async function handleFactoryReset() {
    // Wipes the DB + media and relaunches; no feedback needed — the window tears down.
    await window.cue.settings.factoryReset();
  }

  const noRundowns = services.length === 0;

  const selectCls = "bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-sm py-xs text-body-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 max-w-[200px] mt-xs";

  return (
    <section className="space-y-md">
      <h2 className="text-headline-md font-semibold text-error flex items-center gap-sm">
        <span
          className="material-symbols-outlined text-error"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          warning
        </span>
        Danger Zone
      </h2>

      <div className="bg-surface-container rounded-xl border border-error/30">

        {/* Clear rundown items */}
        <div className="flex items-center gap-md px-lg py-md border-b border-outline-variant/20">
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-semibold text-on-surface">Clear rundown</p>
            <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
              Remove all items from a rundown. The rundown itself is kept; songs remain in the library.
            </p>
            {noRundowns ? (
              <span className="text-label-sm font-label-sm text-on-surface-variant italic mt-xs block">No rundowns</span>
            ) : (
              <select value={clearServiceId ?? ''} onChange={(e) => setClearServiceId(Number(e.target.value))} className={selectCls}>
                {services.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            )}
          </div>
          <ConfirmButton
            label="Clear Rundown"
            confirmLabel="Yes, clear"
            disabled={!clearServiceId || noRundowns}
            onConfirm={handleClearRundown}
          />
        </div>

        {/* Delete rundown */}
        <div className="flex items-center gap-md px-lg py-md border-b border-outline-variant/20">
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-semibold text-on-surface">Delete rundown</p>
            <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
              Permanently delete a rundown and all its items. Songs remain in the library.
            </p>
            {noRundowns ? (
              <span className="text-label-sm font-label-sm text-on-surface-variant italic mt-xs block">No rundowns</span>
            ) : (
              <select value={deleteServiceId ?? ''} onChange={(e) => setDeleteServiceId(Number(e.target.value))} className={selectCls}>
                {services.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            )}
          </div>
          <ConfirmButton
            label="Delete Rundown"
            confirmLabel="Yes, delete"
            disabled={!deleteServiceId || noRundowns}
            onConfirm={handleDeleteRundown}
          />
        </div>

        {/* Clear library */}
        <div className="flex items-center gap-md px-lg py-md border-b border-outline-variant/20">
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-semibold text-on-surface">Clear song library</p>
            <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
              Permanently delete every song and all their sections. Also removes songs from all rundowns. Cannot be undone.
            </p>
          </div>
          <ConfirmButton
            label="Clear library"
            confirmLabel="Yes, delete all"
            onConfirm={handleClearLibrary}
          />
        </div>

        {/* Clear media library */}
        <div className="flex items-center gap-md px-lg py-md">
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-semibold text-on-surface">Clear media library</p>
            <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
              Permanently delete every imported image, video and audio file. Backgrounds and logos that used them are reset to none. Cannot be undone.
            </p>
          </div>
          <ConfirmButton
            label="Clear media"
            confirmLabel="Yes, delete all"
            onConfirm={handleClearMedia}
          />
        </div>

      </div>

      {/* Reset to defaults — most destructive, in its own emphasised card. */}
      <div className="bg-error-container/20 rounded-xl border border-error/50">
        <div className="flex items-center gap-md px-lg py-md">
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-bold text-error">Reset app to defaults</p>
            <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
              Erase <span className="font-semibold text-on-surface">everything</span> — songs, rundowns, media, themes, graphics,
              channels, bibles and all settings — and restart Cue as a fresh install. This cannot be undone.
            </p>
          </div>
          <ConfirmButton
            label="Reset app"
            confirmLabel="Yes, erase everything"
            onConfirm={handleFactoryReset}
          />
        </div>
      </div>

      {feedback && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-sm bg-surface-container-high border border-tertiary/40 rounded-xl px-lg py-sm text-on-surface text-body-sm shadow-2xl ring-1 ring-tertiary/10 pointer-events-none">
          <span
            className="material-symbols-outlined text-tertiary text-[16px]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            check_circle
          </span>
          {feedback}
        </div>
      )}
    </section>
  );
}
