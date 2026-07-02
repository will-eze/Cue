import React, { useState, useEffect, useRef, useCallback } from 'react';
import { looksLikeYouTube } from '../utils/youtube';
import { useModalGuard } from '../utils/modalGuard';

// Paste a YouTube URL → speculative download starts immediately (before Confirm) to
// steal lead time. Confirm adds the cue; if the URL was edited between paste and
// Confirm, the speculative download is abandoned and the submitted URL fetched
// instead. Closing without confirming cancels the speculative download.
// `initialUrl` pre-fills the field (e.g. a link detected in the clipboard) and kicks
// the speculative resolve immediately — editing it cancels-and-switches like a paste.
export default function AddYouTubeModal({ onClose, onConfirm, initialUrl = '' }) {
  useModalGuard();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState(null); // latest youtube:status snapshot for the prefetched URL
  const [cookieBrowser, setCookieBrowser] = useState(''); // '' = login off, else 'chrome'|'firefox'|…
  const inputRef = useRef(null);
  const prefetchedRef = useRef(null);   // URL we kicked a speculative download for
  const confirmedRef = useRef(false);   // don't cancel on unmount once confirmed
  const debounceRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Restore the operator's browser-login preference.
  useEffect(() => {
    window.cue.settings.get('youtube_cookies_browser').then((b) => { if (b) setCookieBrowser(b); });
  }, []);

  // Browser-login preference feeds the main-process client cascade (cookies tier).
  // Persist it immediately and restart the in-flight prefetch so the change applies.
  function changeCookieBrowser(browser) {
    setCookieBrowser(browser);
    window.cue.settings.set('youtube_cookies_browser', browser || null);
    const u = prefetchedRef.current;
    if (u) {
      window.cue.youtube.cancel(u);
      setStatus({ url: u, status: 'resolving', percent: 0 });
      window.cue.youtube.prefetch(u);
    }
  }

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

  // Pre-filled from the clipboard chip: show it and start resolving right away. Any
  // later edit/paste goes through startSpeculative, which cancels this resolve first.
  useEffect(() => {
    if (initialUrl && looksLikeYouTube(initialUrl)) {
      setUrl(initialUrl);
      startSpeculative(initialUrl);
    }
  }, [initialUrl, startSpeculative]);

  function handleChange(e) {
    const next = e.target.value;
    setUrl(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!looksLikeYouTube(next.trim())) { setStatus(null); return; }
    debounceRef.current = setTimeout(() => startSpeculative(next), 400);
  }

  // Re-run a failed prefetch (re-downloads binaries if that was the failure, or a
  // stale yt-dlp, or a transient network error). Bypasses the same-URL no-op guard.
  function retry() {
    const u = (prefetchedRef.current || url).trim();
    if (!looksLikeYouTube(u)) return;
    prefetchedRef.current = u;
    setStatus({ url: u, status: 'resolving', percent: 0 });
    window.cue.youtube.prefetch(u);
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

        {/* Browser login — feeds the cookies tier of the download cascade for videos
            YouTube blocks with a "sign in to confirm you're not a bot" wall. */}
        <div className="flex flex-col gap-xs">
          <label className="flex items-center gap-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!cookieBrowser}
              onChange={(e) => changeCookieBrowser(e.target.checked ? (cookieBrowser || 'chrome') : '')}
              className="accent-primary w-4 h-4 cursor-pointer"
            />
            <span className="text-label-sm font-label-sm text-on-surface normal-case tracking-normal">
              Use my browser’s YouTube login <span className="text-outline-variant">— for videos YouTube blocks</span>
            </span>
          </label>
          {cookieBrowser && (
            <div className="flex items-center gap-sm pl-[26px]">
              <select
                value={cookieBrowser}
                onChange={(e) => changeCookieBrowser(e.target.value)}
                className="bg-surface-container-lowest border border-outline-variant/40 rounded px-sm py-[3px] text-label-sm font-label-sm text-on-surface normal-case tracking-normal focus:outline-none focus:border-primary cursor-pointer"
              >
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
                <option value="firefox">Firefox</option>
                <option value="brave">Brave</option>
                <option value="safari">Safari</option>
              </select>
              <span className="text-[11px] text-outline-variant normal-case tracking-normal leading-snug">
                Sign in to YouTube in that browser first. macOS may ask for Keychain access.
              </span>
            </div>
          )}
        </div>

        {/* Live status line */}
        <div className="h-6 flex items-center gap-sm text-label-sm font-label-sm">
          {!url.trim() && <span className="text-outline-variant normal-case tracking-normal">Waiting for a link…</span>}
          {url.trim() && !valid && <span className="text-on-surface-variant normal-case tracking-normal">That doesn’t look like a YouTube link.</span>}
          {valid && st === 'setup' && (
            <>
              <span className="text-primary uppercase tracking-wide whitespace-nowrap">Setting up YouTube{status?.setupName ? ` · ${status.setupName}` : ''}</span>
              <div className="flex-1 h-1 bg-surface-container-lowest rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round(status?.percent || 0)}%` }} />
              </div>
            </>
          )}
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
            <span className="flex items-center gap-sm min-w-0">
              <span className="text-error normal-case tracking-normal truncate">{status?.error || 'Could not download this video.'}</span>
              <button onClick={retry} className="shrink-0 text-primary uppercase tracking-wide hover:brightness-110 cursor-pointer">Retry</button>
            </span>
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
