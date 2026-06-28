import React, { useState, useEffect } from 'react';
import { useToast } from '../components/Toast';
import { mediaUrl } from '../utils/mediaUrl';
import BackgroundLibrary from './BackgroundLibrary.jsx';

const typeFromKey = (k) => k.includes('song') ? 'song' : k.includes('scripture') ? 'scripture' : 'slide';

function BackgroundPicker({ label, settingKey, onChanged }) {
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
    const type = typeFromKey(settingKey);
    const imported = await window.cue.media.import(result.filePaths);
    if (imported.length) {
      await window.cue.settings.setGlobalBackground(type, imported[0].id);
      setAssetId(imported[0].id);
      setAsset(imported[0]);
      onChanged?.();
    }
  }

  async function handleClear() {
    const type = typeFromKey(settingKey);
    await window.cue.settings.setGlobalBackground(type, null);
    setAssetId(null);
    setAsset(null);
    onChanged?.();
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

export default function BackgroundSettings({ activeServiceId, onBackgroundDefaultChanged }) {
  const toast = useToast();
  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState(null);
  const [loopMode, setLoopMode] = useState('blend'); // 'blend' | 'jump'
  const [loopBlendSecs, setLoopBlendSecs] = useState(2.0);

  useEffect(() => {
    window.cue.services.list().then((list) => {
      setServices(list);
      const defaultId = activeServiceId ?? (list.length > 0 ? list[0].id : null);
      setSelectedServiceId(defaultId);
    });
    window.cue.settings.get('bg_loop_mode').then((v) => { if (v) setLoopMode(v); });
    window.cue.settings.get('bg_loop_blend_secs').then((v) => { if (v != null) setLoopBlendSecs(Number(v)); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the selector in sync if the operator switches rundowns while Settings is open.
  useEffect(() => {
    if (activeServiceId != null) setSelectedServiceId(activeServiceId);
  }, [activeServiceId]);

  function handleLoopModeChange(mode) {
    setLoopMode(mode);
    window.cue.settings.set('bg_loop_mode', mode);
  }

  function handleLoopBlendChange(secs) {
    setLoopBlendSecs(secs);
    window.cue.settings.set('bg_loop_blend_secs', secs);
  }

  function showFeedback(msg) { toast.success(msg); }

  async function handleApplyToRundown() {
    if (!selectedServiceId) { alert('No rundown selected.'); return; }
    const id = await window.cue.settings.get('global_bg_song_id');
    if (!id) { alert('Set a global song background first.'); return; }
    const svc = services.find((s) => s.id === selectedServiceId);
    if (!confirm(`Override the background for all songs in "${svc?.title || 'this rundown'}"?\nThis replaces any per-slot background overrides. Locked songs are skipped.`)) return;
    const count = await window.cue.services.applyBackgroundToRundown(selectedServiceId, id);
    if (!count) { alert('No song items found in this rundown. Make sure songs are added first.'); return; }
    showFeedback(`Applied to ${count} song${count !== 1 ? 's' : ''} in rundown`);
  }

  async function handleApplyToAllSongs() {
    const id = await window.cue.settings.get('global_bg_song_id');
    if (!id) { alert('Set a global song background first.'); return; }
    if (!confirm("Write this background to every song in the library?\nThis sets each song's own default and clears their slot overrides. Locked songs are skipped.")) return;
    await window.cue.settings.applyBackgroundToAll('song', id);
    showFeedback('Written to all songs in library');
  }

  return (
    <section className="space-y-md">
      <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary">wallpaper</span>
        Background Defaults
      </h2>

      {/* Background priority cascade */}
      <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-md space-y-sm">
        <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Background Priority — Highest to Lowest</h3>
        <div className="space-y-xs">
          {[
            { rank: '1', label: 'Locked pin', desc: 'Song has "Lock background" enabled — nothing can override it.' },
            { rank: '2', label: 'Slot override', desc: 'A background explicitly set on this rundown slot (drag-and-drop or right-click → Set Background).' },
            { rank: '3', label: "Song's own default", desc: "The background saved on the song itself (set via Song Editor or Bulk Apply)." },
            { rank: '4', label: 'Global default (below)', desc: 'The per-type default set here. Applies live to every item still on the fallback — change it and it takes effect instantly.' },
            { rank: '5', label: 'Black', desc: 'Nothing set anywhere — output shows a black screen.' },
          ].map(({ rank, label, desc }) => (
            <div key={rank} className="flex items-start gap-sm py-xs border-b border-outline-variant/10 last:border-0">
              <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-label-sm font-label-sm font-bold flex items-center justify-center tabular-nums">{rank}</span>
              <div>
                <span className="text-body-sm font-semibold text-on-surface">{label}</span>
                <span className="text-body-sm text-on-surface-variant"> — {desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Video loop behaviour */}
      <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30 space-y-md">
        <div>
          <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Video Loop</h3>
          <p className="text-body-sm text-on-surface-variant/70 mt-xs">
            How background videos behave at the loop point.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-sm">
          {[
            { id: 'blend', label: 'Smooth blend', desc: 'Crossfade end → start' },
            { id: 'jump',  label: 'Jump cut',     desc: 'Restart immediately' },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => handleLoopModeChange(opt.id)}
              className={`px-md py-sm rounded-lg border-2 text-left transition-all cursor-pointer ${
                loopMode === opt.id
                  ? 'border-primary bg-primary/8'
                  : 'border-outline-variant/30 bg-surface-container-low hover:border-outline-variant/60'
              }`}
            >
              <div className={`text-label-sm font-label-sm font-bold ${loopMode === opt.id ? 'text-primary' : 'text-on-surface'}`}>{opt.label}</div>
              <div className="text-body-sm text-on-surface-variant/70 mt-[2px]">{opt.desc}</div>
            </button>
          ))}
        </div>
        <div className={`flex items-center gap-lg ${loopMode !== 'blend' ? 'opacity-40 pointer-events-none' : ''}`}>
          <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em] shrink-0">Blend duration</span>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.5}
            value={loopBlendSecs}
            onChange={(e) => handleLoopBlendChange(Number(e.target.value))}
            className="flex-1 accent-primary cursor-pointer"
          />
          <span className="text-label-sm font-label-sm text-primary tabular-nums w-12 text-right">{loopBlendSecs.toFixed(1)} s</span>
        </div>
      </div>

      {/* Global default pickers */}
      <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30 space-y-md">
        <div>
          <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Global Defaults</h3>
          <p className="text-body-sm text-on-surface-variant/70 mt-xs">
            The live fallback shown whenever an item has no background of its own. Changing it applies instantly to every
            song, verse and slide still on the default (locked songs keep their pinned background). Supports images and videos.
          </p>
        </div>
        <div className="flex gap-md">
          <BackgroundPicker label="Songs" settingKey="global_bg_song_id" onChanged={onBackgroundDefaultChanged} />
          <BackgroundPicker label="Scripture" settingKey="global_bg_scripture_id" onChanged={onBackgroundDefaultChanged} />
          <BackgroundPicker label="Slides" settingKey="global_bg_slide_id" onChanged={onBackgroundDefaultChanged} />
        </div>
      </div>

      {/* Bulk override actions */}
      <div className="bg-surface-container border border-outline-variant/30 rounded-xl overflow-hidden">
        <div className="px-lg py-md border-b border-outline-variant/20">
          <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Bulk Apply — Song Background</h3>
          <p className="text-body-sm text-on-surface-variant/70 mt-xs">
            The global default already applies to songs automatically — use these only to hardcode it onto each song so it
            survives a later change to the global. Locked songs are always skipped.
          </p>
        </div>

        {/* Override rundown */}
        <div className="flex items-center gap-md px-lg py-md border-b border-outline-variant/20">
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-semibold text-on-surface">Override all songs in a rundown</p>
            <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
              Hardcodes this background onto every song in the selected rundown, replacing any existing slot overrides. Locked songs are skipped.
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
              Hardcodes this background onto every song in the library and clears their slot overrides, so the choice sticks even if you change the global later. Locked songs are skipped.
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

      {/* Curated library */}
      <BackgroundLibrary />
    </section>
  );
}
