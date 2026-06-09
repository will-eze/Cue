import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { mediaUrl } from '../utils/mediaUrl';

export default function MediaPickerModal({ onSelect, onClose, initialId = null }) {
  const [assets, setAssets] = useState([]);
  const [selectedId, setSelectedId] = useState(initialId);
  const fileInputRef = useRef(null);

  useEffect(() => {
    window.cue.media.list(undefined).then((all) =>
      setAssets(all.filter((a) => a.type === 'image' || a.type === 'video'))
    );
  }, []);

  async function handleImport(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const paths = files.map((f) => f.path).filter(Boolean);
    if (!paths.length) return;
    const imported = await window.cue.media.import(paths);
    setAssets((prev) => [
      ...prev,
      ...imported.filter((a) => a.type === 'image' || a.type === 'video'),
    ]);
    e.target.value = '';
  }

  const btnBase = 'px-lg h-8 text-label-sm font-mono rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em]';

  return createPortal(
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl ring-1 ring-white/5">

        {/* Header */}
        <div className="flex items-center px-lg py-md border-b border-outline-variant/30 bg-surface-container-high rounded-t-xl shrink-0">
          <div>
            <h2 className="text-headline-md font-bold text-on-surface">Select Background</h2>
            <p className="text-label-sm font-mono text-on-surface-variant uppercase tracking-[0.05em]">Media Library</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer"
          >✕</button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-md custom-scrollbar">
          <div className="grid gap-sm" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>

            {/* None tile */}
            <div
              className={`cursor-pointer rounded-lg border-2 aspect-video flex flex-col items-center justify-center gap-xs bg-surface-container transition-colors ${
                selectedId === null ? 'border-primary' : 'border-outline-variant/30 hover:border-outline-variant'
              }`}
              onClick={() => setSelectedId(null)}
            >
              <span className="material-symbols-outlined text-outline-variant text-2xl">block</span>
              <span className="text-[9px] font-mono text-outline-variant uppercase tracking-wider">None</span>
            </div>

            {assets.map((asset) => (
              <div
                key={asset.id}
                className={`cursor-pointer rounded-lg border-2 overflow-hidden transition-colors ${
                  selectedId === asset.id ? 'border-primary' : 'border-transparent hover:border-outline-variant'
                }`}
                onClick={() => setSelectedId(asset.id)}
              >
                <div className="aspect-video bg-black relative">
                  {asset.type === 'image' ? (
                    <img src={mediaUrl(asset.path)} className="w-full h-full object-cover" alt={asset.filename} />
                  ) : (
                    <video src={mediaUrl(asset.path)} className="w-full h-full object-cover" muted />
                  )}
                  {selectedId === asset.id && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <span
                        className="material-symbols-outlined text-primary text-2xl"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >check_circle</span>
                    </div>
                  )}
                </div>
                <p className="text-[9px] font-mono text-on-surface truncate px-xs py-[3px] bg-surface-container">
                  {asset.filename}
                </p>
              </div>
            ))}

            {assets.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-xl gap-sm text-outline-variant">
                <span className="material-symbols-outlined text-4xl">image</span>
                <span className="text-label-sm font-mono uppercase tracking-widest">No media imported yet</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-lg py-md border-t border-outline-variant/30 bg-surface-container-high rounded-b-xl shrink-0">
          <div className="flex items-center gap-sm">
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`${btnBase} bg-surface-container border border-outline-variant/50 text-on-surface-variant hover:text-on-surface flex items-center gap-xs`}
            >
              <span className="material-symbols-outlined text-[14px] leading-none">upload</span>
              Import
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={handleImport}
            />
          </div>
          <div className="flex items-center gap-sm">
            <button
              onClick={onClose}
              className={`${btnBase} text-on-surface-variant hover:text-on-surface hover:bg-surface-variant`}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const asset = selectedId !== null ? (assets.find((a) => a.id === selectedId) || null) : null;
                onSelect(asset);
              }}
              className={`${btnBase} bg-primary text-on-primary hover:opacity-90`}
            >
              {selectedId === null ? 'Clear Background' : 'Set Background'}
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
}
