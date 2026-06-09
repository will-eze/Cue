import React, { useState, useEffect } from 'react';
import { mediaUrl } from '../utils/mediaUrl';

export default function LogoSettings() {
  const [globalLogoId, setGlobalLogoId] = useState(null);
  const [globalLogoAsset, setGlobalLogoAsset] = useState(null);
  const [channels, setChannels] = useState([]);

  useEffect(() => { load(); }, []);

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
    <section className="space-y-md">
      <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary">branding_watermark</span>
        Logo Settings
      </h2>

      <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30 flex items-center gap-xl">
        {/* Logo preview */}
        <div className="w-32 h-32 rounded bg-background flex items-center justify-center p-md border border-outline-variant/30 relative group shrink-0">
          {globalLogoAsset ? (
            <img
              src={mediaUrl(globalLogoAsset.path)}
              className="w-full h-full object-contain"
              alt="Logo"
            />
          ) : (
            <span className="material-symbols-outlined text-outline-variant text-3xl">image</span>
          )}
        </div>

        {/* Logo info and controls */}
        <div className="flex-1 space-y-md">
          <div>
            <h4 className="text-headline-md font-semibold text-on-surface">Global Brand Mark</h4>
            <p className="text-body-md text-on-surface-variant mt-xs">
              PNG or SVG with transparent background. Min 512px. Shown on all channels when Logo is pressed.
            </p>
          </div>
          <div className="flex gap-sm">
            <button
              onClick={handlePickLogo}
              className="bg-primary-container text-on-primary-container px-md py-sm rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            >
              Pick Media
            </button>
            {globalLogoId && (
              <button
                onClick={handleClearLogo}
                className="bg-surface-variant text-on-surface-variant px-md py-sm rounded text-label-sm font-label-sm hover:bg-outline-variant transition-all cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {channels.length > 0 && (
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-md">
          <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider mb-sm">Per-Channel Status</h3>
          <div className="space-y-xs">
            {channels.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between py-xs text-label-sm font-label-sm">
                <span className="text-on-surface">{ch.name}</span>
                <span className="text-on-surface-variant">
                  {ch.logo_override_id ? 'Custom logo' : '↑ Global'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
