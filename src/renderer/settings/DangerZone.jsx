import React, { useState, useEffect } from 'react';
import { useToast } from '../components/Toast';

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

export default function DangerZone({ activeServiceId, onRundownCleared, onRundownDeleted, onRundownRestored, onLibraryCleared, onMediaCleared }) {
  const toast = useToast();
  const [services, setServices] = useState([]);
  const [clearServiceId, setClearServiceId] = useState(null);
  const [deleteServiceId, setDeleteServiceId] = useState(null);

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

  async function handleClearRundown() {
    if (!clearServiceId) return;
    const serviceId = clearServiceId;
    const service = await window.cue.services.get(serviceId);
    const items = service?.items || [];
    const name = services.find((s) => s.id === serviceId)?.title || 'Rundown';
    if (!items.length) { toast.info(`"${name}" is already empty`); return; }
    // Snapshot (in order) so the clear can be undone by re-adding every item.
    const snapshot = items.map((it) => ({
      item_type: it.item_type, ref_id: it.ref_id ?? null,
      content: it.content ?? null, background_override_id: it.background_override_id ?? null,
    }));
    for (const item of items) await window.cue.services.removeItem(item.id);
    onRundownCleared?.(serviceId);
    toast.show({
      message: `"${name}" cleared (${snapshot.length} items)`,
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: async () => { await window.cue.services.addItems(serviceId, snapshot); onRundownCleared?.(serviceId); },
      },
    });
  }

  async function handleDeleteRundown() {
    if (!deleteServiceId) return;
    const deletedId = deleteServiceId;
    const svc = services.find((s) => s.id === deletedId);
    const name = svc?.title || 'Rundown';
    // Snapshot items before deletion so we can undo.
    const full = await window.cue.services.get(deletedId);
    const snapshot = (full?.items || []).map((it) => ({
      item_type: it.item_type, ref_id: it.ref_id ?? null,
      content: it.content ?? null, background_override_id: it.background_override_id ?? null,
    }));
    await window.cue.services.delete(deletedId);
    onRundownDeleted?.(deletedId);
    loadServices();
    toast.show({
      message: `"${name}" deleted`,
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: async () => {
          const newId = await window.cue.services.create({ title: name, date: svc?.date || new Date().toISOString().split('T')[0] });
          if (snapshot.length) await window.cue.services.addItems(newId, snapshot);
          onRundownRestored?.(newId);
          loadServices();
        },
      },
    });
  }

  async function handleClearLibrary() {
    await window.cue.songs.deleteAll();
    onLibraryCleared?.();
    toast.success('Song library cleared');
  }

  async function handleClearMedia() {
    const removed = await window.cue.media.deleteAll();
    onMediaCleared?.();
    toast.success(removed ? `${removed} media file${removed === 1 ? '' : 's'} deleted` : 'Media library already empty');
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
    </section>
  );
}
