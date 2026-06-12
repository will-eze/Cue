import React, { useState, useEffect } from 'react';
import { thumbUrl } from '../utils/mediaUrl';

/**
 * Cached thumbnail tile for an image or video asset. Renders the small,
 * OS-generated cue-thumb:// poster (cached in main) instead of the
 * full-resolution original — the original is what made media grids slow to load.
 *
 * If the OS can't produce a thumbnail (e.g. an exotic video codec on Windows)
 * the protocol returns 404, the <img> errors, and we show a neutral icon.
 * Audio has no visual frame — callers render their own placeholder for it.
 */
export default function MediaThumb({ path, alt = '', className = '' }) {
  const [failed, setFailed] = useState(false);

  // Reset the error state if this instance is reused for a different asset
  // (lists keyed by index rather than id could otherwise show a stale fallback).
  useEffect(() => { setFailed(false); }, [path]);

  if (failed || !path) {
    return (
      <div className={`flex items-center justify-center bg-surface-container-high ${className}`}>
        <span className="material-symbols-outlined text-outline-variant text-2xl">broken_image</span>
      </div>
    );
  }

  return (
    <img
      src={thumbUrl(path)}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
