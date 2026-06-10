import React, { useState, useEffect } from 'react';
import { mediaUrl } from '../utils/mediaUrl';

function BackgroundPicker({ label, settingKey }) {
  const [assetId, setAssetId] = useState(null);
  const [asset, setAsset] = useState(null);

  useEffect(() => {
    window.cue.settings.get(settingKey).then(async (id) => {
      setAssetId(id);
      setAsset(id ? (await window.cue.media.get(id)) || null : null);
    });
  }, [settingKey]);

  async function handlePick() {
    const result = await window.cue.dialog.openFile({
      filters: [{ name: 'Images & Videos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return;
    const type = settingKey.includes('song') ? 'song' : 'slide';
    const imported = await window.cue.media.import(result.filePaths);
    if (imported.length) {
      await window.cue.settings.setGlobalBackground(type, imported[0].id);
      setAssetId(imported[0].id);
      setAsset(imported[0]);
    }
  }

  async function handleClear() {
    const type = settingKey.includes('song') ? 'song' : 'slide';
    await window.cue.settings.setGlobalBackground(type, null);
    setAssetId(null);
    setAsset(null);
  }

  return (
    <div className="flex-1 space-y-xs">
      <div className="aspect-video w-full rounded-lg overflow-hidden relative group border border-outline-variant/30 bg-surface-container-high">
        {asset ? (
          asset.type === 'video' ? (
            <video src={mediaUrl(asset.path)} className="w-full h-full object-cover" autoPlay loop muted />
          ) : (
            <img src={mediaUrl(asset.path)} className="w-full h-full object-cover" alt="" />
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-xs">
            <span className="material-symbols-outlined text-outline-variant text-2xl">wallpaper</span>
            <span className="text-label-sm font-label-sm text-outline-variant uppercase tracking-[0.05em]">No default</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent p-sm flex items-end justify-between">
          <span className="text-label-sm font-label-sm text-white drop-shadow">{label}</span>
          <div className="flex gap-xs opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handlePick}
              className="p-xs bg-black/60 hover:bg-black/80 rounded text-white cursor-pointer"
              title="Pick media"
            >
              <span className="material-symbols-outlined text-sm">{asset ? 'edit' : 'add'}</span>
            </button>
            {assetId && (
              <button
                onClick={handleClear}
                className="p-xs bg-black/50 hover:bg-error-container/70 rounded text-white cursor-pointer"
                title="Clear"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BackgroundSettings({ activeServiceId }) {
  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    window.cue.services.list().then((list) => {
      setServices(list);
      const defaultId = activeServiceId ?? (list.length > 0 ? list[0].id : null);
      setSelectedServiceId(defaultId);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the selector in sync if the operator switches rundowns while Settings is open.
  useEffect(() => {
    if (activeServiceId != null) setSelectedServiceId(activeServiceId);
  }, [activeServiceId]);

  function showFeedback(msg) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  }

  async function handleApplyToRundown() {
    if (!selectedServiceId) { alert('No rundown selected.'); return; }
    const id = await window.cue.settings.get('global_bg_song_id');
    if (!id) { alert('Set a global song background first.'); return; }
    const svc = services.find((s) => s.id === selectedServiceId);
    if (!confirm(`Override the background for all songs in "${svc?.title || 'this rundown'}"?\nThis replaces any per-slot background overrides.`)) return;
    const count = await window.cue.services.applyBackgroundToRundown(selectedServiceId, id);
    if (!count) { alert('No song items found in this rundown. Make sure songs are added first.'); return; }
    showFeedback(`Applied to ${count} song${count !== 1 ? 's' : ''} in rundown`);
  }

  async function handleApplyToAllSongs() {
    const id = await window.cue.settings.get('global_bg_song_id');
    if (!id) { alert('Set a global song background first.'); return; }
    if (!confirm("Write this background to every song in the library?\nThis sets each song's own default. Per-slot rundown overrides are not affected.")) return;
    await window.cue.settings.applyBackgroundToAll('song', id);
    showFeedback('Written to all songs in library');
  }

  return (
    <section className="space-y-md">
      <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary">wallpaper</span>
        Background Defaults
      </h2>

      {/* Global default pickers */}
      <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30 space-y-md">
        <div>
          <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Global Defaults</h3>
          <p className="text-body-sm text-on-surface-variant/70 mt-xs">
            Fallback shown on output when an item has no per-song or per-slot background set. Supports images and videos.
          </p>
        </div>
        <div className="flex gap-md">
          <BackgroundPicker label="Songs" settingKey="global_bg_song_id" />
          <BackgroundPicker label="Slides" settingKey="global_bg_slide_id" />
        </div>
      </div>

      {/* Bulk override actions */}
      <div className="bg-surface-container border border-outline-variant/30 rounded-xl overflow-hidden">
        <div className="px-lg py-md border-b border-outline-variant/20">
          <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Bulk Apply — Song Background</h3>
          <p className="text-body-sm text-on-surface-variant/70 mt-xs">
            Push the current global song background into specific records. The global default applies automatically — use these only to hardcode it.
          </p>
        </div>

        {/* Override rundown */}
        <div className="flex items-center gap-md px-lg py-md border-b border-outline-variant/20">
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-semibold text-on-surface">Override all songs in a rundown</p>
            <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
              Sets a hard background override on every song slot in the selected rundown, replacing any existing slot overrides.
            </p>
          </div>
          <div className="flex items-center gap-sm shrink-0">
            {services.length > 0 ? (
              <select
                value={selectedServiceId ?? ''}
                onChange={(e) => setSelectedServiceId(Number(e.target.value))}
                className="bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-sm py-xs text-body-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 max-w-[180px]"
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            ) : (
              <span className="text-label-sm font-label-sm text-on-surface-variant italic">No rundowns</span>
            )}
            <button
              onClick={handleApplyToRundown}
              disabled={!selectedServiceId || services.length === 0}
              className="px-md py-xs text-label-sm font-label-sm font-bold bg-primary/10 border border-primary/30 text-primary rounded-lg hover:bg-primary/20 hover:border-primary/50 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Apply
            </button>
          </div>
        </div>

        {/* Write to all songs */}
        <div className="flex items-center gap-md px-lg py-md">
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-semibold text-on-surface">Write to all songs in library</p>
            <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
              Sets every song's own default background. Songs with no per-song background will then show this instead of the global fallback.
            </p>
          </div>
          <button
            onClick={handleApplyToAllSongs}
            className="shrink-0 px-md py-xs text-label-sm font-label-sm font-bold bg-primary/10 border border-primary/30 text-primary rounded-lg hover:bg-primary/20 hover:border-primary/50 active:scale-95 transition-all cursor-pointer"
          >
            Apply to all songs
          </button>
        </div>
      </div>

      {/* Feedback toast */}
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
