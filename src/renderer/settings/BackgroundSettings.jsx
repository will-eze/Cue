import React, { useState, useEffect } from 'react';

function BackgroundPicker({ label, settingKey, description }) {
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
      filters: [
        { name: 'Images & Videos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov'] },
      ],
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
    <div className="bg-slate-800 border border-slate-700 rounded p-4 mb-3">
      <h3 className="text-xs font-semibold text-slate-300 mb-1">{label}</h3>
      <p className="text-xs text-slate-500 mb-3">{description}</p>
      <div className="flex items-center gap-3">
        {asset ? (
          asset.type === 'video' ? (
            <video
              src={`file://${asset.path}`}
              className="h-16 w-28 object-cover bg-black rounded border border-slate-600"
              muted
            />
          ) : (
            <img
              src={`file://${asset.path}`}
              className="h-16 w-28 object-cover rounded border border-slate-600"
              alt=""
            />
          )
        ) : (
          <div className="h-16 w-28 bg-slate-700 rounded border border-slate-600 flex items-center justify-center text-xs text-slate-600">
            None
          </div>
        )}
        <button
          onClick={handlePick}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded"
        >
          Choose…
        </button>
        {assetId && (
          <button
            onClick={handleClear}
            className="text-xs text-slate-500 hover:text-red-400 px-3 py-1.5"
          >
            Clear
          </button>
        )}
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
    <div className="max-w-2xl">
      <h2 className="text-sm font-semibold text-slate-100 mb-4">Background Defaults</h2>

      <BackgroundPicker
        label="Global Song Background"
        settingKey="global_bg_song_id"
        description="Applied to all songs that have no per-song background set."
      />
      <button
        onClick={() => handleApplyToAll('song')}
        className="text-xs text-amber-400 hover:text-amber-300 mb-4"
      >
        Apply to All Songs…
      </button>

      <BackgroundPicker
        label="Global Slide Background"
        settingKey="global_bg_slide_id"
        description="Applied to all custom slides with no background override."
      />

      {/* Data path */}
      <div className="bg-slate-800 border border-slate-700 rounded p-4 mt-4">
        <h3 className="text-xs font-semibold text-slate-300 mb-2">Data Location</h3>
        <p className="text-xs text-slate-500 font-mono break-all mb-2">{dataPath}</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.cue.settings.openDataFolder()}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded"
          >
            Open in Finder / Explorer
          </button>
          {diskUsage !== null && (
            <span className="text-xs text-slate-500">
              Media: {formatBytes(diskUsage)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
