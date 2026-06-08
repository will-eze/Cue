import React, { useState, useEffect } from 'react';

export default function LogoSettings() {
  const [globalLogoId, setGlobalLogoId] = useState(null);
  const [globalLogoAsset, setGlobalLogoAsset] = useState(null);
  const [channels, setChannels] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const logoId = await window.cue.settings.get('global_logo_id');
    setGlobalLogoId(logoId);
    if (logoId) {
      const assets = await window.cue.media.list(null);
      setGlobalLogoAsset(assets.find((a) => a.id === logoId) || null);
    }
    window.cue.output.channels.list().then(setChannels);
  }

  async function handlePickLogo() {
    const result = await window.cue.dialog.openFile({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return;
    const imported = await window.cue.media.import(result.filePaths);
    if (imported.length) {
      await window.cue.settings.setGlobalLogo(imported[0].id);
      load();
    }
  }

  async function handleClearLogo() {
    await window.cue.settings.setGlobalLogo(null);
    setGlobalLogoId(null);
    setGlobalLogoAsset(null);
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-sm font-semibold text-slate-100 mb-4">Logo Settings</h2>

      <div className="bg-slate-800 border border-slate-700 rounded p-4 mb-4">
        <h3 className="text-xs font-semibold text-slate-300 mb-3">Global Logo</h3>
        <p className="text-xs text-slate-500 mb-3">
          Shown on all channels when Logo is pressed, unless overridden per-channel.
        </p>
        <div className="flex items-center gap-3">
          {globalLogoAsset ? (
            <img
              src={`file://${globalLogoAsset.path}`}
              className="h-16 w-28 object-contain bg-black rounded border border-slate-600"
              alt="Logo"
            />
          ) : (
            <div className="h-16 w-28 bg-slate-700 rounded border border-slate-600 flex items-center justify-center text-xs text-slate-600">
              No logo
            </div>
          )}
          <button
            onClick={handlePickLogo}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded"
          >
            Choose…
          </button>
          {globalLogoId && (
            <button
              onClick={handleClearLogo}
              className="text-xs text-slate-500 hover:text-red-400 px-3 py-1.5"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {channels.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded p-4">
          <h3 className="text-xs font-semibold text-slate-300 mb-2">Per-Channel Overrides</h3>
          <p className="text-xs text-slate-500 mb-3">
            Per-channel logo overrides are configured in Output Channels.
          </p>
          <div className="space-y-1">
            {channels.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between py-1 text-xs text-slate-400">
                <span>{ch.name}</span>
                <span className="text-slate-600">
                  {ch.logo_override_id ? 'Custom logo' : '↑ Global'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
