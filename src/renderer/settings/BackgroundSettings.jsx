import React, { useState, useEffect } from 'react';
import { mediaUrl } from '../utils/mediaUrl';

function BackgroundPicker({ label, settingKey }) {
  const [assetId, setAssetId] = useState(null);
  const [asset, setAsset] = useState(null);

  useEffect(() => {
    window.cue.settings.get(settingKey).then(async (id) => {
      setAssetId(id);
      if (id) {
        const assets = await window.cue.media.list(null);
        setAsset(assets.find((a) => a.id === id) || null);
      }
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
      <div className="aspect-video w-full rounded overflow-hidden relative group border border-outline-variant/30">
        {asset ? (
          asset.type === 'video' ? (
            <video src={mediaUrl(asset.path)} className="w-full h-full object-cover" muted />
          ) : (
            <img src={mediaUrl(asset.path)} className="w-full h-full object-cover" alt="" />
          )
        ) : (
          <div className="w-full h-full bg-surface-container-high flex items-center justify-center">
            <span className="material-symbols-outlined text-outline-variant text-2xl">wallpaper</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent p-sm flex items-end justify-between">
          <span className="text-label-sm font-label-sm text-white">{label}</span>
          <div className="flex gap-xs opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={handlePick}
              className="p-xs bg-black/50 hover:bg-black/70 rounded text-white material-symbols-outlined text-sm cursor-pointer"
            >
              edit
            </button>
            {assetId && (
              <button
                onClick={handleClear}
                className="p-xs bg-black/50 hover:bg-error-container/70 rounded text-white material-symbols-outlined text-sm cursor-pointer"
              >
                delete
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BackgroundSettings() {
  const [dataPath, setDataPath] = useState('');
  const [diskUsage, setDiskUsage] = useState(null);

  useEffect(() => {
    window.cue.settings.getDataPath().then(setDataPath);
    window.cue.settings.getDiskUsage().then(setDiskUsage);
  }, []);

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  async function handleApplyToAll(type) {
    const key = type === 'song' ? 'global_bg_song_id' : 'global_bg_slide_id';
    const id = await window.cue.settings.get(key);
    if (!id) { alert('Set a global background first.'); return; }
    if (!confirm(`Apply this background to all ${type === 'song' ? 'songs' : 'slides'}? This will overwrite all per-song settings.`)) return;
    await window.cue.settings.applyBackgroundToAll(type, id);
    alert('Done.');
  }

  return (
    <section className="space-y-md">
      <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary">wallpaper</span>
        Background Defaults
      </h2>

      <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30 space-y-md">
        <div className="flex gap-md">
          <BackgroundPicker label="Global Song" settingKey="global_bg_song_id" />
          <BackgroundPicker label="Global Slide" settingKey="global_bg_slide_id" />
        </div>

        <div className="flex justify-between items-center pt-sm border-t border-outline-variant/30">
          <p className="text-label-sm font-label-sm text-on-surface-variant">Default transition: 400ms Dissolve</p>
          <div className="flex gap-md">
            <button
              onClick={() => handleApplyToAll('song')}
              className="text-primary text-label-sm font-label-sm flex items-center gap-xs hover:underline cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">auto_awesome</span>
              Apply to all songs
            </button>
            <button
              onClick={() => handleApplyToAll('slide')}
              className="text-primary text-label-sm font-label-sm flex items-center gap-xs hover:underline cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">auto_awesome</span>
              Apply to all slides
            </button>
          </div>
        </div>
      </div>

      {/* System info */}
      <footer className="pt-lg border-t border-outline-variant/30 flex justify-between items-center">
        <div className="flex items-center gap-md">
          <div className="flex flex-col">
            <span className="text-label-sm font-label-sm text-on-surface">System Version</span>
            <span className="text-label-sm font-label-sm text-outline">v1.0.0 (Build 1)</span>
          </div>
          <div className="h-8 w-[1px] bg-outline-variant/30" />
          <div className="flex flex-col">
            <span className="text-label-sm font-label-sm text-on-surface">Storage</span>
            <span className="text-label-sm font-label-sm text-outline">
              {diskUsage !== null ? `${formatBytes(diskUsage)} used` : '—'}
            </span>
          </div>
          {dataPath && (
            <>
              <div className="h-8 w-[1px] bg-outline-variant/30" />
              <div className="flex flex-col">
                <span className="text-label-sm font-label-sm text-on-surface">Data Path</span>
                <span className="text-[10px] font-label-sm text-outline truncate max-w-48">{dataPath}</span>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => window.cue.settings.openDataFolder()}
          className="bg-surface-container text-on-surface px-lg py-sm rounded text-label-sm font-label-sm hover:bg-surface-container-high transition-all cursor-pointer"
        >
          Open Data Folder
        </button>
      </footer>
    </section>
  );
}
