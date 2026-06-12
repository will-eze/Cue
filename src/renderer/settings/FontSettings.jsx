import React, { useState, useEffect } from 'react';
import { injectUserFontFaces } from '../utils/fonts';

const BUNDLED = window.cue.fonts.list;
const SAMPLE = 'The quick brown fox 0123';

export default function FontSettings() {
  const [userFonts, setUserFonts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  function load() {
    window.cue.fonts.listUser().then((l) => setUserFonts(l || []));
  }
  useEffect(() => { load(); }, []);

  function showFeedback(msg) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2800);
  }

  async function handleImport() {
    setBusy(true);
    try {
      const res = await window.cue.fonts.import();
      if (res?.canceled) return;
      await injectUserFontFaces();
      load();
      if (res?.errors?.length) {
        showFeedback(`${res.added?.length || 0} installed · ${res.errors.length} skipped (unsupported)`);
      } else {
        showFeedback(`${res?.added?.length || 0} font${(res?.added?.length || 0) === 1 ? '' : 's'} installed`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    await window.cue.fonts.delete(id);
    setConfirmId(null);
    await injectUserFontFaces();
    load();
    showFeedback('Font removed');
  }

  return (
    <section className="space-y-md">
      <div className="flex items-center justify-between gap-md">
        <div>
          <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>font_download</span>
            Fonts
          </h2>
          <p className="text-body-sm text-on-surface-variant/70 mt-[2px]">
            Install your own fonts (.woff2, .woff, .ttf, .otf). They appear in every text editor and render on screen + NDI output.
          </p>
        </div>
        <button
          onClick={handleImport}
          disabled={busy}
          className="px-md py-xs text-label-sm font-label-sm font-bold bg-primary/15 border border-primary/50 text-primary hover:bg-primary/25 active:scale-95 transition-all cursor-pointer rounded-lg uppercase tracking-[0.05em] whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-xs"
        >
          <span className="material-symbols-outlined text-[16px]">upload_file</span>
          {busy ? 'Installing…' : 'Install Fonts'}
        </button>
      </div>

      {/* User-installed fonts */}
      <div className="bg-surface-container rounded-xl border border-outline-variant/20 overflow-hidden">
        <div className="px-lg py-sm border-b border-outline-variant/20 bg-surface-container-high">
          <span className="text-label-sm font-label-sm uppercase tracking-[0.06em] text-on-surface-variant">
            My fonts · {userFonts.length}
          </span>
        </div>
        {userFonts.length === 0 ? (
          <div className="px-lg py-lg flex flex-col items-center gap-xs text-center">
            <span className="material-symbols-outlined text-[32px] text-outline-variant/40">font_download_off</span>
            <p className="text-body-sm text-on-surface-variant/60">No custom fonts yet</p>
            <p className="text-label-sm font-label-sm text-outline uppercase tracking-[0.05em]">Click “Install Fonts” to add your own</p>
          </div>
        ) : (
          userFonts.map((f) => (
            <div key={f.id} className="flex items-center gap-md px-lg py-sm border-b border-outline-variant/10 last:border-b-0">
              <div className="flex-1 min-w-0">
                <div className="text-[26px] leading-tight text-on-surface truncate" style={{ fontFamily: f.family }}>{SAMPLE}</div>
                <div className="flex items-center gap-sm mt-[2px]">
                  <span className="text-body-sm font-semibold text-on-surface">{f.family}</span>
                  <span className="text-[10px] font-label-sm uppercase tracking-[0.05em] border border-outline-variant/30 rounded px-xs text-on-surface-variant">.{f.ext}</span>
                  <span className="text-[10px] font-label-sm text-on-surface-variant/40 truncate">{f.filename}</span>
                </div>
              </div>
              {confirmId === f.id ? (
                <div className="flex items-center gap-sm shrink-0">
                  <button onClick={() => handleDelete(f.id)}
                    className="px-md py-xs text-label-sm font-label-sm font-bold bg-error-container text-error rounded-lg border border-error/40 hover:brightness-110 cursor-pointer uppercase tracking-[0.05em]">Remove</button>
                  <button onClick={() => setConfirmId(null)}
                    className="px-md py-xs text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface bg-surface-container-high border border-outline-variant/30 rounded-lg cursor-pointer uppercase tracking-[0.05em]">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(f.id)} title="Remove font"
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-on-surface-variant/50 hover:text-error hover:bg-error-container/20 transition-colors cursor-pointer">
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Bundled fonts (read-only) */}
      <div className="bg-surface-container rounded-xl border border-outline-variant/20 overflow-hidden">
        <div className="px-lg py-sm border-b border-outline-variant/20 bg-surface-container-high">
          <span className="text-label-sm font-label-sm uppercase tracking-[0.06em] text-on-surface-variant">
            Built-in · {BUNDLED.length}
          </span>
        </div>
        <div className="px-lg py-sm flex flex-wrap gap-x-lg gap-y-xs">
          {BUNDLED.map((f) => (
            <span key={f.family} className="text-body-md text-on-surface" style={{ fontFamily: f.family }} title={f.label}>{f.label}</span>
          ))}
        </div>
      </div>

      {feedback && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-sm bg-surface-container-high border border-tertiary/40 rounded-xl px-lg py-sm text-on-surface text-body-sm shadow-2xl ring-1 ring-tertiary/10 pointer-events-none">
          <span className="material-symbols-outlined text-tertiary text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          {feedback}
        </div>
      )}
    </section>
  );
}
