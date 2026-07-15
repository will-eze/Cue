import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { rasterizePdf } from '../utils/pdfRaster';
import { structureSheet } from '../ocr/sheetParse';
import { sheetModelPresent, downloadSheetModel, SHEET_MODEL } from '../ocr/sheetOcrStore';
import SheetOcrWorker from '../ocr/sheet-ocr-worker.web.js?worker';

// Sheet Music → Song. Drop / paste / choose an image or PDF of sheet music; a LOCAL
// offline OCR model (Florence-2, opt-in download) reads the page, and sheetParse.js
// structures it into title / verses / chorus. The result autopopulates a fresh Song
// Editor for review (onDone) — nothing is saved until the operator hits Save there.
//
// All decoding stays in the renderer: File objects (drop/paste/<input>) expose
// arrayBuffer(); PDFs rasterise via pdfRaster.js; the worker owns transformers.js.
const IMG_RE = /^image\/(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const NAME_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|pdf)$/i;
const MAX_PAGES = 8; // guard a huge multi-page PDF from spinning forever

function isAccepted(file) {
  return !!file && (file.type === 'application/pdf' || IMG_RE.test(file.type) || NAME_RE.test(file.name || ''));
}

export default function SheetMusicImportModal({ onClose, onDone }) {
  const [modelReady, setModelReady]   = useState(null); // null = checking
  const [dlPct, setDlPct]             = useState(0);
  const [status, setStatus]           = useState('idle'); // idle|need-model|downloading|rendering|ocr|done|error
  const [progress, setProgress]       = useState(null);   // { i, n }
  const [fileName, setFileName]       = useState('');
  const [result, setResult]           = useState(null);   // { title, author, copyright, sections }
  const [rawText, setRawText]         = useState('');
  const [showRaw, setShowRaw]         = useState(false);
  const [error, setError]             = useState('');
  const [dragOver, setDragOver]       = useState(false);
  const workerRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    sheetModelPresent().then((ok) => { setModelReady(ok); setStatus(ok ? 'idle' : 'need-model'); }).catch(() => { setModelReady(false); setStatus('need-model'); });
    return () => { try { workerRef.current?.terminate(); } catch {} };
  }, []);

  const busy = status === 'rendering' || status === 'ocr' || status === 'downloading';

  // ── Model download ────────────────────────────────────────────────────────
  const download = useCallback(async () => {
    setError(''); setStatus('downloading'); setDlPct(0);
    try {
      await downloadSheetModel((pct) => setDlPct(pct));
      setModelReady(true); setStatus('idle');
    } catch (e) {
      setError(e?.message || 'Download failed.'); setStatus('need-model');
    }
  }, []);

  // ── OCR one page in the resident worker ────────────────────────────────────
  const ocrPage = useCallback((bytes, mime, page) => new Promise((resolve, reject) => {
    if (!workerRef.current) workerRef.current = new SheetOcrWorker();
    const w = workerRef.current;
    const onMsg = (e) => {
      const m = e.data || {};
      if (m.type === 'result') { w.removeEventListener('message', onMsg); resolve(m.lines || []); }
      else if (m.type === 'error') { w.removeEventListener('message', onMsg); reject(new Error(m.error || 'OCR failed')); }
    };
    w.addEventListener('message', onMsg);
    // Transfer the buffer to avoid a copy.
    w.postMessage({ type: 'ocr', bytes, mime, page }, [bytes]);
  }), []);

  // ── Full pipeline for a chosen file ────────────────────────────────────────
  const process = useCallback(async (file) => {
    if (!isAccepted(file)) { setError('Please choose an image (PNG/JPG…) or a PDF.'); return; }
    if (!modelReady) { setStatus('need-model'); return; }
    setError(''); setResult(null); setRawText(''); setFileName(file.name || 'pasted image');
    try {
      // 1. Rasterise to one PNG/JPEG buffer per page.
      let pages; // [{ bytes:ArrayBuffer, mime }]
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      if (isPdf) {
        setStatus('rendering'); setProgress(null);
        const buf = new Uint8Array(await file.arrayBuffer());
        const imgs = await rasterizePdf(buf, 1600, (i, n) => setProgress({ i, n }));
        pages = imgs.slice(0, MAX_PAGES).map((u8) => ({ bytes: u8.buffer, mime: 'image/png' }));
      } else {
        pages = [{ bytes: await file.arrayBuffer(), mime: file.type || 'image/png' }];
      }
      if (!pages.length) { setError('Nothing to read in that file.'); setStatus('error'); return; }

      // 2. OCR each page; concatenate lines in page order.
      setStatus('ocr');
      const allLines = [];
      for (let p = 0; p < pages.length; p++) {
        setProgress({ i: p + 1, n: pages.length });
        const lines = await ocrPage(pages[p].bytes, pages[p].mime, p);
        allLines.push(...lines);
      }
      if (!allLines.length) { setError('No text was detected on the page.'); setStatus('error'); return; }

      // 3. Structure into a song.
      const structured = structureSheet(allLines);
      setRawText(allLines.map((l) => (typeof l === 'string' ? l : l.text)).join('\n'));
      if (!structured.sections.length && !structured.title) {
        setError('Could not make out any lyrics — try a clearer or higher-resolution scan.'); setStatus('error'); return;
      }
      setResult(structured);
      setStatus('done');
    } catch (e) {
      setError(e?.message || 'Something went wrong reading the sheet.'); setStatus('error');
    }
  }, [modelReady, ocrPage]);

  // ── Input sources: drop, paste, file picker ────────────────────────────────
  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) process(f);
  }, [process]);

  useEffect(() => {
    const onPaste = (e) => {
      if (busy) return;
      for (const item of e.clipboardData?.items || []) {
        if (item.kind === 'file') { const f = item.getAsFile(); if (f && isAccepted(f)) { process(f); return; } }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [process, busy]);

  const openEditor = useCallback(() => {
    if (!result) return;
    onDone?.({
      title: result.title,
      author: result.author,
      copyright: result.copyright,
      sections: result.sections,
    });
  }, [result, onDone]);

  const reset = () => { setResult(null); setRawText(''); setError(''); setFileName(''); setStatus(modelReady ? 'idle' : 'need-model'); };

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-lg"
      onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-full bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden">
        <div className="flex items-center gap-sm px-lg h-12 bg-surface-container-high border-b border-outline-variant/30">
          <span className="material-symbols-outlined text-primary">music_note</span>
          <span className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface">Sheet Music to Song</span>
          {!busy && (
            <button onClick={onClose} className="ml-auto text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>

        <div className="p-lg flex flex-col gap-md">
          {/* Model gate */}
          {status === 'need-model' && (
            <div className="flex flex-col gap-md">
              <p className="text-body-md text-on-surface-variant leading-snug">
                Reading sheet music uses a local, offline OCR model (Florence-2, ~{SHEET_MODEL.approxMB} MB).
                It downloads once and stays on this machine — nothing is sent to the cloud.
              </p>
              {error && <p className="text-label-sm font-label-sm text-error">{error}</p>}
              <button onClick={download}
                className="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-xs">
                <span className="material-symbols-outlined text-[16px]">download</span> Download OCR model
              </button>
            </div>
          )}

          {status === 'downloading' && (
            <div className="flex flex-col items-center gap-sm py-md text-on-surface-variant">
              <span className="material-symbols-outlined text-[32px] text-primary animate-spin">progress_activity</span>
              <p className="text-label-sm font-label-sm uppercase tracking-widest">Downloading model · {dlPct}%</p>
              <div className="w-full h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
                <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${dlPct}%` }} />
              </div>
            </div>
          )}

          {/* Drop zone (idle) */}
          {status === 'idle' && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-sm w-full px-md py-xl rounded-lg border-2 border-dashed transition-all cursor-pointer text-center
                  ${dragOver ? 'border-primary bg-primary/10' : 'border-outline-variant/50 bg-surface-container/60 hover:border-primary/60 hover:bg-surface-container'}`}>
                <span className="material-symbols-outlined text-[34px] text-primary">upload_file</span>
                <span className="text-body-md text-on-surface">Drop, paste, or click to choose sheet music</span>
                <span className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case">Image (PNG / JPG / WEBP) or PDF · up to {MAX_PAGES} pages</span>
              </div>
              <input ref={inputRef} type="file" accept="image/*,application/pdf,.pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) process(f); }} />
              <p className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case leading-snug">
                The model reads the lyrics printed under the staves and splits them into verses and a chorus.
                Sheet music is tricky to read — you’ll review and fix everything in the editor before saving.
              </p>
              {error && <p className="text-label-sm font-label-sm text-error">{error}</p>}
            </>
          )}

          {status === 'rendering' && <Centered icon="picture_as_pdf" spin>Rendering page{progress?.n ? ` · ${progress.i}/${progress.n}` : '…'}</Centered>}
          {status === 'ocr' && <Centered icon="document_scanner" spin>Reading sheet music{progress?.n ? ` · page ${progress.i}/${progress.n}` : '…'}</Centered>}

          {status === 'error' && (
            <div className="flex flex-col gap-md">
              <p className="text-label-sm font-label-sm text-error">{error}</p>
              <button onClick={reset}
                className="bg-surface-container-high text-on-surface px-lg py-sm rounded-lg text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all">
                Try another file
              </button>
            </div>
          )}

          {/* Result preview */}
          {status === 'done' && result && (
            <div className="flex flex-col gap-md">
              <div className="flex flex-col gap-[2px]">
                <span className="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">Detected</span>
                <span className="text-body-lg text-on-surface font-medium truncate">{result.title || '(no title found)'}</span>
                {result.author && <span className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case truncate">{result.author.replace(/\n/g, ' · ')}</span>}
              </div>

              <div className="flex flex-wrap gap-xs">
                {result.sections.map((s, i) => (
                  <span key={i} className="px-sm py-[2px] rounded bg-surface-container-high text-label-sm font-label-sm text-on-surface-variant capitalize">
                    {s.type}
                  </span>
                ))}
                {!result.sections.length && <span className="text-label-sm font-label-sm text-error">No sections detected</span>}
              </div>

              <div className="max-h-40 overflow-y-auto rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-sm flex flex-col gap-sm">
                {result.sections.map((s, i) => (
                  <div key={i}>
                    <div className="text-label-sm font-label-sm uppercase tracking-wide text-primary capitalize mb-[2px]">{s.type}</div>
                    <div className="text-body-md text-on-surface whitespace-pre-wrap leading-snug">{s.content}</div>
                  </div>
                ))}
              </div>

              <button onClick={() => setShowRaw((v) => !v)}
                className="self-start text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface tracking-normal normal-case underline decoration-dotted">
                {showRaw ? 'Hide' : 'Show'} raw OCR text
              </button>
              {showRaw && (
                <pre className="max-h-32 overflow-y-auto rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-sm text-label-sm text-on-surface-variant whitespace-pre-wrap">{rawText}</pre>
              )}

              <div className="flex gap-sm">
                <button onClick={reset}
                  className="flex-1 bg-surface-container-high text-on-surface px-lg py-sm rounded-lg text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all">
                  Start over
                </button>
                <button onClick={openEditor}
                  className="flex-[2] bg-primary text-on-primary px-lg py-sm rounded-lg text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-xs">
                  <span className="material-symbols-outlined text-[16px]">edit_note</span> Open in Song Editor
                </button>
              </div>
            </div>
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
