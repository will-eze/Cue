import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { extractPdfText } from '../utils/pdfText';

// Sermon → Slides. Pick a sermon doc (PDF / .docx / .txt / .md), choose a theme
// (defaults to the global slide background), then generate a native presentation:
// title slide, a slide per point, and scripture references broken out with the full
// verse text (uses the first installed Bible version). PDF text is extracted here
// (pdfjs); txt/md/docx are read in main. The deck opens in the editor when done.
const ACCEPT = ['pdf', 'docx', 'txt', 'text', 'md', 'markdown'];

function baseName(p) {
  const f = String(p || '').split(/[\\/]/).pop() || '';
  return f.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

export default function SermonImportModal({ onClose, onDone }) {
  const [filePath, setFilePath] = useState('');
  const [title, setTitle] = useState('');
  const [themes, setThemes] = useState([]);
  const [themeId, setThemeId] = useState('');      // '' = global slide background
  const [status, setStatus] = useState('idle');    // idle|reading|generating|error
  const [progress, setProgress] = useState(null);  // { i, n }
  const [error, setError] = useState('');

  useEffect(() => {
    window.cue.themes.list().then((t) => setThemes(t || []));
  }, []);

  const pickFile = useCallback(async () => {
    setError('');
    const res = await window.cue.dialog.openFile({
      filters: [
        { name: 'Sermon documents', extensions: ACCEPT },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word', extensions: ['docx'] },
        { name: 'Text / Markdown', extensions: ['txt', 'text', 'md', 'markdown'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths?.[0]) return;
    const p = res.filePaths[0];
    setFilePath(p);
    if (!title.trim()) setTitle(baseName(p));
  }, [title]);

  async function generate() {
    if (!filePath) return;
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    setError('');
    try {
      let payload = { title: title.trim(), themeId: themeId || null };
      if (ext === 'pdf') {
        // Reuse the PowerPoint import's PDF reader (returns the file bytes for a
        // .pdf), then extract text in the renderer.
        setStatus('reading');
        setProgress(null);
        const conv = await window.cue.presentations.convertPptx(filePath);
        if (!conv.ok) { setError(conv.error === 'not_found' ? 'Could not read the PDF.' : (conv.error || 'Could not read the PDF.')); setStatus('error'); return; }
        const text = await extractPdfText(conv.pdf, (i, n) => setProgress({ i, n }));
        if (!text.trim()) { setError('No selectable text was found in this PDF (is it a scan?).'); setStatus('error'); return; }
        payload.text = text;
      } else {
        payload.filePath = filePath;
      }
      setStatus('generating');
      const res = await window.cue.presentations.sermonGenerate(payload);
      if (!res.ok) { setError(res.error || 'Could not generate slides.'); setStatus('error'); return; }
      onDone?.(res.id);
    } catch (e) {
      setError(e?.message || 'Something went wrong.');
      setStatus('error');
    }
  }

  const busy = status === 'reading' || status === 'generating';

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-lg"
      onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-[520px] max-w-full bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5 overflow-hidden">
        <div className="flex items-center gap-sm px-lg h-12 bg-surface-container-high border-b border-outline-variant/30">
          <span className="material-symbols-outlined text-primary">menu_book</span>
          <span className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface">Sermon to Slides</span>
          {!busy && (
            <button onClick={onClose} className="ml-auto text-on-surface-variant hover:text-on-surface transition-colors">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>

        <div className="p-lg flex flex-col gap-md">
          {!busy && (
            <>
              {/* File */}
              <button onClick={pickFile}
                className="flex items-center gap-sm w-full px-md py-sm rounded-lg border border-dashed border-outline-variant/50 bg-surface-container/60 hover:border-primary/60 hover:bg-surface-container transition-all text-left cursor-pointer">
                <span className="material-symbols-outlined text-[22px] text-primary">upload_file</span>
                <span className="flex flex-col min-w-0">
                  <span className="text-body-md text-on-surface truncate">{filePath ? baseName(filePath) : 'Choose a sermon document…'}</span>
                  <span className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case">PDF · Word (.docx) · Text · Markdown</span>
                </span>
              </button>

              {/* Title */}
              <label className="flex flex-col gap-[2px]">
                <span className="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">Presentation title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sermon title"
                  className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-1 text-body-md text-on-surface focus:outline-none focus:border-primary" />
              </label>

              {/* Theme */}
              <label className="flex flex-col gap-[2px]">
                <span className="text-label-sm font-label-sm uppercase tracking-wide text-on-surface-variant">Theme</span>
                <select value={themeId} onChange={(e) => setThemeId(e.target.value)}
                  className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-1 text-body-md text-on-surface focus:outline-none focus:border-primary cursor-pointer">
                  <option value="">Global default background</option>
                  {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>

              <p className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case leading-snug">
                Cue detects your headings/points and any scripture references (e.g. “John 3:16”), and builds a title slide,
                a slide per point, and scripture slides with the full verse text. You can fine-tune everything in the editor afterwards.
              </p>

              {error && <p className="text-label-sm font-label-sm text-error">{error}</p>}

              <button onClick={generate} disabled={!filePath}
                className="bg-primary text-on-primary px-lg py-sm rounded-lg text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-xs disabled:opacity-40 disabled:cursor-not-allowed">
                <span className="material-symbols-outlined text-[16px]">auto_awesome</span> Generate slides
              </button>
            </>
          )}

          {status === 'reading' && (
            <Centered icon="description" spin>
              Reading document{progress?.n ? ` · ${progress.i}/${progress.n}` : '…'}
            </Centered>
          )}
          {status === 'generating' && <Centered icon="auto_awesome" spin>Building slides…</Centered>}
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
