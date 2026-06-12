import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { rasterizePdf } from '../utils/pdfRaster';

const DOWNLOAD_URL = 'https://www.libreoffice.org/download/download-libreoffice/';

// PowerPoint import flow. We gate the whole thing behind a LibreOffice check so we
// never spawn a missing binary (which is what would crash/hang the conversion):
//   checking → (missing → nudge to install) | (ready → pick file) → converting →
//   rasterising → done. The deck becomes a native presentation whose slides each
//   hold one full-bleed image, so it inherits every existing rundown control.
export default function PptxImportModal({ onClose, onDone }) {
  const [status, setStatus] = useState('checking'); // checking|missing|ready|converting|rasterizing|error
  const [detect, setDetect] = useState(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null); // { i, n }

  const check = useCallback(async () => {
    setStatus('checking');
    const d = await window.cue.presentations.detectLibreOffice();
    setDetect(d);
    setStatus(d.found ? 'ready' : 'missing');
  }, []);

  useEffect(() => { check(); }, [check]);

  async function locateManually() {
    const res = await window.cue.dialog.openFile({ properties: ['openFile'] });
    if (res.canceled || !res.filePaths?.[0]) return;
    const d = await window.cue.presentations.setLibreOfficePath(res.filePaths[0]);
    setDetect(d);
    setStatus(d.found ? 'ready' : 'missing');
    if (!d.found) setError('That file is not a working LibreOffice (soffice) binary.');
  }

  async function chooseFile(pdfOnly = false) {
    setError('');
    const res = await window.cue.dialog.openFile({
      // Split filter entries + an All Files fallback: macOS NSOpenPanel can grey out
      // Office formats (.ppt/.pptx) under a single combined extension filter, so we
      // list them separately and always allow All Files as an escape hatch.
      filters: pdfOnly
        ? [{ name: 'PDF', extensions: ['pdf'] }, { name: 'All Files', extensions: ['*'] }]
        : [
            { name: 'Presentations', extensions: ['pptx', 'ppt', 'pdf'] },
            { name: 'PowerPoint', extensions: ['pptx', 'ppt'] },
            { name: 'PDF', extensions: ['pdf'] },
            { name: 'All Files', extensions: ['*'] },
          ],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths?.[0]) return;

    setStatus('converting');
    const conv = await window.cue.presentations.convertPptx(res.filePaths[0]);
    if (!conv.ok) {
      if (conv.error === 'not_found') { setStatus('missing'); return; }
      setError(conv.error || 'Conversion failed.');
      setStatus('error');
      return;
    }

    setStatus('rasterizing');
    setProgress({ i: 0, n: 0 });
    try {
      const pages = await rasterizePdf(conv.pdf, 1920, (i, n) => setProgress({ i, n }));
      if (!pages.length) { setError('The presentation appears to have no slides.'); setStatus('error'); return; }
      const result = await window.cue.presentations.createFromImages(conv.name || 'Imported Presentation', pages);
      onDone?.(result.id);
    } catch (e) {
      setError(e?.message || 'Failed to render the slides.');
      setStatus('error');
    }
  }

  const busy = status === 'converting' || status === 'rasterizing';

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-lg"
      onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-[480px] max-w-full bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden">
        <div className="flex items-center gap-sm px-lg h-12 bg-surface-container-high border-b border-outline-variant/30">
          <span className="material-symbols-outlined text-primary">slideshow</span>
          <span className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface">Import PowerPoint</span>
          {!busy && (
            <button onClick={onClose} className="ml-auto text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>

        <div className="p-lg flex flex-col gap-md">
          {status === 'checking' && (
            <Centered icon="hourglass_empty" spin>Checking for LibreOffice…</Centered>
          )}

          {status === 'missing' && (
            <>
              <div className="flex gap-md">
                <span className="material-symbols-outlined text-secondary text-[28px]">report</span>
                <div className="flex flex-col gap-xs">
                  <p className="text-body-md text-on-surface font-bold">LibreOffice is required</p>
                  <p className="text-body-md text-on-surface-variant">
                    Cue renders PowerPoint slides at full fidelity using LibreOffice (free, open-source). Install it,
                    then check again — nothing is imported until it's found, so the conversion can't crash.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-sm">
                <button onClick={() => window.cue.openExternal(DOWNLOAD_URL)}
                  className="bg-primary text-on-primary px-md py-xs rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all flex items-center gap-xs">
                  <span className="material-symbols-outlined text-[14px]">download</span> Download LibreOffice
                </button>
                <button onClick={check}
                  className="bg-surface-container border border-outline-variant/40 text-on-surface px-md py-xs rounded text-label-sm font-label-sm hover:bg-surface-container-high transition-colors flex items-center gap-xs">
                  <span className="material-symbols-outlined text-[14px]">refresh</span> Check again
                </button>
                <button onClick={locateManually}
                  className="text-on-surface-variant px-md py-xs rounded text-label-sm font-label-sm hover:bg-surface-variant transition-colors">
                  Locate manually…
                </button>
              </div>
              <div className="border-t border-outline-variant/30 pt-sm">
                <p className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case mb-xs">
                  No LibreOffice? Export your deck to PDF (PowerPoint / Keynote / Google Slides) and import that — pixel-perfect, no conversion.
                </p>
                <button onClick={() => chooseFile(true)}
                  className="bg-surface-container border border-outline-variant/40 text-on-surface px-md py-xs rounded text-label-sm font-label-sm hover:bg-surface-container-high transition-colors flex items-center gap-xs">
                  <span className="material-symbols-outlined text-[14px]">picture_as_pdf</span> Import a PDF instead
                </button>
              </div>
              {error && <p className="text-label-sm font-label-sm text-error">{error}</p>}
            </>
          )}

          {status === 'ready' && (
            <>
              <div className="flex items-center gap-sm">
                <span className="material-symbols-outlined text-tertiary text-[22px]">check_circle</span>
                <div className="flex flex-col">
                  <p className="text-body-md text-on-surface">LibreOffice detected</p>
                  {detect?.version && <p className="text-label-sm font-label-sm text-on-surface-variant truncate">{detect.version}</p>}
                </div>
                <button onClick={check} title="Re-check" className="ml-auto text-on-surface-variant hover:text-on-surface transition-colors">
                  <span className="material-symbols-outlined text-[16px]">refresh</span>
                </button>
              </div>
              <p className="text-body-md text-on-surface-variant">
                Choose a <span className="font-label-sm">.pptx</span> / <span className="font-label-sm">.ppt</span> / <span className="font-label-sm">.pdf</span> file.
                Each slide is rendered to an image and added as a controllable slide.
              </p>
              <div className="flex gap-sm items-start bg-surface-container/60 border border-outline-variant/30 rounded-lg px-sm py-xs">
                <span className="material-symbols-outlined text-[16px] text-on-surface-variant mt-[1px]">font_download</span>
                <p className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case leading-snug">
                  Best fidelity: export your deck to <span className="font-bold">PDF</span> and import that (fonts are embedded, nothing is substituted).
                  Importing .pptx relies on LibreOffice + the fonts installed on this machine, so missing fonts can shift alignment or overflow text.
                </p>
              </div>
              <button onClick={chooseFile}
                className="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-xs">
                <span className="material-symbols-outlined text-[16px]">upload_file</span> Choose PowerPoint file…
              </button>
            </>
          )}

          {status === 'converting' && <Centered icon="sync" spin>Converting with LibreOffice…</Centered>}
          {status === 'rasterizing' && (
            <Centered icon="image" spin>
              Rendering slides{progress?.n ? ` · ${progress.i}/${progress.n}` : '…'}
            </Centered>
          )}

          {status === 'error' && (
            <>
              <div className="flex gap-md">
                <span className="material-symbols-outlined text-error text-[28px]">error</span>
                <div className="flex flex-col gap-xs">
                  <p className="text-body-md text-on-surface font-bold">Import failed</p>
                  <p className="text-body-md text-on-surface-variant break-words">{error}</p>
                </div>
              </div>
              <div className="flex gap-sm">
                <button onClick={() => setStatus('ready')}
                  className="bg-surface-container border border-outline-variant/40 text-on-surface px-md py-xs rounded text-label-sm font-label-sm hover:bg-surface-container-high transition-colors">
                  Try another file
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Centered({ icon, spin, children }) {
  return (
    <div className="flex flex-col items-center justify-center gap-sm py-lg text-on-surface-variant">
      <span className={`material-symbols-outlined text-[32px] text-primary ${spin ? 'animate-spin' : ''}`}>{icon}</span>
      <p className="text-label-sm font-label-sm uppercase tracking-widest">{children}</p>
    </div>
  );
}
