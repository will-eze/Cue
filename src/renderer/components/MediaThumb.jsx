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
const MAX_RETRIES = 3;

export default function MediaThumb({ path, alt = '', className = '' }) {
  const [failed, setFailed] = useState(false);
  // A cache-busting nonce appended on retry. A first miss can be transient — a
  // video whose poster is still being generated, or one waiting on the one-time
  // background ffmpeg download — so retry a few times with backoff before giving
  // up, rather than pinning the broken-image icon on the first 404.
  const [attempt, setAttempt] = useState(0);

  // Reset error + retry state if this instance is reused for a different asset
  // (lists keyed by index rather than id could otherwise show a stale fallback).
  useEffect(() => { setFailed(false); setAttempt(0); }, [path]);

  if (failed || !path) {
    return (
      <div className={`flex items-center justify-center bg-surface-container-high ${className}`}>
        <span className="material-symbols-outlined text-outline-variant text-2xl">broken_image</span>
      </div>
    );
  }

  const src = attempt > 0 ? `${thumbUrl(path)}?retry=${attempt}` : thumbUrl(path);

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => {
        if (attempt >= MAX_RETRIES) { setFailed(true); return; }
        const next = attempt + 1;
        setTimeout(() => setAttempt(next), 1500 * next);
      }}
    />
  );
}
