import React, { useState, useEffect, useRef, useCallback } from 'react';

// Client-side gate for the Confirm button + speculative fetch. Main does the
// authoritative parse (downloader.parseVideoId); this just avoids firing on
// obviously-non-YouTube input.
function looksLikeYouTube(s) {
  if (!s) return false;
  const t = s.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return true;
  try {
    const u = new URL(t);
    const h = u.hostname.replace(/^www\./, '');
    if (h === 'youtu.be') return /^[A-Za-z0-9_-]{11}/.test(u.pathname.slice(1));
    if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'music.youtube.com') {
      return !!u.searchParams.get('v') || /^\/(shorts|embed|v|live)\/[A-Za-z0-9_-]{11}/.test(u.pathname);
    }
  } catch {}
  return false;
}

// Paste a YouTube URL → speculative download starts immediately (before Confirm) to
// steal lead time. Confirm adds the cue; if the URL was edited between paste and
// Confirm, the speculative download is abandoned and the submitted URL fetched
// instead. Closing without confirming cancels the speculative download.
export default function AddYouTubeModal({ onClose, onConfirm }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState(null); // latest youtube:status snapshot for the prefetched URL
  const inputRef = useRef(null);
  const prefetchedRef = useRef(null);   // URL we kicked a speculative download for
  const confirmedRef = useRef(false);   // don't cancel on unmount once confirmed
  const debounceRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Cancel the speculative download if the modal closes without confirming.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!confirmedRef.current && prefetchedRef.current) {
      window.cue.youtube.cancel(prefetchedRef.current);
    }
  }, []);

  // Live progress for whatever URL we last prefetched.
  useEffect(() => {
    const off = window.cue.on('youtube:status', (snap) => {
      if (snap && snap.url && snap.url === prefetchedRef.current) setStatus(snap);
    });
    return off;
  }, []);

  // Speculatively start (and switch) the download as the field settles.
  const startSpeculative = useCallback((next) => {
    const trimmed = next.trim();
    if (!looksLikeYouTube(trimmed)) return;
    if (prefetchedRef.current === trimmed) return;
    // Abandon a previous speculative download for a now-stale URL.
    if (prefetchedRef.current) window.cue.youtube.cancel(prefetchedRef.current);
    prefetchedRef.current = trimmed;
    setStatus({ url: trimmed, status: 'resolving', percent: 0 });
    window.cue.youtube.prefetch(trimmed);
  }, []);

  function handleChange(e) {
    const next = e.target.value;
    setUrl(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!looksLikeYouTube(next.trim())) { setStatus(null); return; }
    debounceRef.current = setTimeout(() => startSpeculative(next), 400);
  }

  function handleConfirm() {
    const submitted = url.trim();
    if (!looksLikeYouTube(submitted)) return;
    // Edited since the speculative fetch → abandon it, fetch the submitted URL.
    if (prefetchedRef.current && prefetchedRef.current !== submitted) {
      window.cue.youtube.cancel(prefetchedRef.current);
    }
    confirmedRef.current = true;
    onConfirm(submitted); // OperatorView re-asserts prefetch (idempotent) + adds the cue
    onClose();
  }

  const valid = looksLikeYouTube(url.trim());
  const st = status?.status;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[520px] bg-surface-container-high border border-outline-variant/40 rounded-xl ring-1 ring-white/5 shadow-2xl p-lg flex flex-col gap-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-sm">
          <span className="material-symbols-outlined text-[20px] text-secondary">smart_display</span>
          <h2 className="text-body-lg text-on-surface font-medium">Add YouTube Video</h2>
        </div>

        <p className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case -mt-xs">
          Paste a link — it starts downloading right away. It plays as a clean full-screen video on any
          channel and is deleted when you close the app.
        </p>

        <input
          ref={inputRef}
          type="text"
          value={url}
          onChange={handleChange}
          onKeyDown={(e) => { if (e.key === 'Enter' && valid) handleConfirm(); if (e.key === 'Escape') onClose(); }}
          placeholder="https://www.youtube.com/watch?v=…"
          className="bg-surface-container-lowest border border-outline-variant/40 rounded px-md py-sm text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 w-full"
        />

        {/* Live status line */}
        <div className="h-6 flex items-center gap-sm text-label-sm font-label-sm">
          {!url.trim() && <span className="text-outline-variant normal-case tracking-normal">Waiting for a link…</span>}
          {url.trim() && !valid && <span className="text-on-surface-variant normal-case tracking-normal">That doesn’t look like a YouTube link.</span>}
          {valid && st === 'resolving' && <span className="text-on-surface-variant uppercase tracking-wide">Resolving…</span>}
          {valid && (st === 'downloading') && (
            <>
              <span className="text-primary uppercase tracking-wide">Downloading {Math.round(status?.percent || 0)}%</span>
              <div className="flex-1 h-1 bg-surface-container-lowest rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round(status?.percent || 0)}%` }} />
              </div>
            </>
          )}
          {valid && st === 'processing' && <span className="text-primary uppercase tracking-wide">Processing…</span>}
          {valid && st === 'ready' && (
            <span className="text-tertiary uppercase tracking-wide flex items-center gap-xs">
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              Ready{status?.title ? ` · ${status.title}` : ''}
            </span>
          )}
          {valid && st === 'error' && (
            <span className="text-error normal-case tracking-normal truncate">{status?.error || 'Could not download this video.'}</span>
          )}
        </div>

        <div className="flex justify-end gap-sm mt-xs">
          <button
            onClick={onClose}
            className="px-md py-xs rounded text-label-sm font-label-sm text-on-surface-variant hover:bg-surface-variant transition-colors cursor-pointer"
          >Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!valid}
            className="bg-primary text-on-primary px-lg py-xs rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center gap-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            Add to Rundown
          </button>
        </div>
      </div>
    </div>
  );
}
