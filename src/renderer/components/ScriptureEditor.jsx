import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useModalGuard } from '../utils/modalGuard';
import MediaPickerModal from './MediaPickerModal';
import ThemePickerModal from './ThemePickerModal';
import UndoRedoButtons from './UndoRedoButtons';
import useEditHistory, { useUndoRedoKeys } from '../utils/useEditHistory';
import { useToast } from './Toast';
import { mediaUrl } from '../utils/mediaUrl';
import { normalizeLookStyle } from '../utils/presentationThemes';
import { useFonts } from '../utils/fonts';
import {
  FormattingToolbar, SlidePreview, LowerThirdPreview, DEFAULT_STYLE, styleIsDefault,
} from './SongEditor';

// Global scripture appearance editor — the styling counterpart to SongEditor.
// Scripture text comes from the bundled translations, so there are no editable
// sections; instead this edits ONE style applied to every verse, plus the global
// default scripture background. Saves to settings:
//   scripture_style_json     — style_json applied to all scripture slides
//   global_bg_scripture_id   — default background (override order: per-slot → this → black)

const SAMPLE_TEXT =
  'For God so loved the world, that he gave his only begotten Son, that whosoever ' +
  'believeth in him should not perish, but have everlasting life.';
const SAMPLE_REF = 'John 3:16';

export default function ScriptureEditor({ onClose, onSave }) {
  useModalGuard();
  const toast = useToast();
  // Undoable working document: verse style, reference style, default background.
  // The target toggle / preview template / modals below are ephemeral UI, not history.
  const doc = useEditHistory({
    style: { ...DEFAULT_STYLE },
    refStyle: { ...DEFAULT_STYLE, align: 'right' },
    background: null,
  });
  const { style, refStyle, background } = doc.state;
  const setStyle = (updater) =>
    doc.set((d) => ({ ...d, style: typeof updater === 'function' ? updater(d.style) : updater }), 'sc:style');
  const setRefStyle = (updater) =>
    doc.set((d) => ({ ...d, refStyle: typeof updater === 'function' ? updater(d.refStyle) : updater }), 'sc:refStyle');
  const setBackground = (value) =>
    doc.set((d) => ({ ...d, background: typeof value === 'function' ? value(d.background) : value }));
  useUndoRedoKeys(doc.undo, doc.redo);

  const [target, setTarget] = useState('verse');                  // 'verse' | 'reference'
  const [previewTemplate, setPreviewTemplate] = useState('fullscreen');
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [bgLoading, setBgLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const fonts = useFonts();

  // Preview text: a stock verse, or any passage the operator types (first installed
  // translation) so they can check a long verse or a short one against the style.
  const [sampleQuery, setSampleQuery] = useState('');
  const [sample, setSample] = useState({ text: SAMPLE_TEXT, ref: SAMPLE_REF, abbrev: 'KJV' });
  const [sampleMiss, setSampleMiss] = useState(false);
  useEffect(() => {
    const q = sampleQuery.trim();
    if (!q) { setSample({ text: SAMPLE_TEXT, ref: SAMPLE_REF, abbrev: 'KJV' }); setSampleMiss(false); return undefined; }
    const t = setTimeout(async () => {
      try {
        const versions = await window.cue.bible.versions();
        const v = versions?.[0];
        if (!v) { setSampleMiss('none'); return; }
        const res = await window.cue.bible.resolve(v.id, q, 99);
        if (res?.verses?.length) {
          setSample({ text: res.verses.map((x) => x.text).join(' '), ref: res.reference, abbrev: res.versionAbbrev || v.abbrev });
          setSampleMiss(false);
        } else setSampleMiss('ref');
      } catch { setSampleMiss('ref'); }
    }, 250);
    return () => clearTimeout(t);
  }, [sampleQuery]);

  // Load saved scripture verse style, reference style + background. Seeded via
  // reset() so the async hydrate is the baseline, not the first undo step.
  useEffect(() => {
    (async () => {
      const styleJson = await window.cue.settings.get('scripture_style_json');
      const refJson = await window.cue.settings.get('scripture_ref_style_json');
      const bgId = await window.cue.settings.get('global_bg_scripture_id');
      const asset = bgId ? await window.cue.media.get(bgId) : null;
      doc.reset({
        style: styleJson ? { ...DEFAULT_STYLE, ...styleJson } : { ...DEFAULT_STYLE },
        refStyle: refJson ? { ...DEFAULT_STYLE, align: 'right', ...refJson } : { ...DEFAULT_STYLE, align: 'right' },
        background: asset || null,
      });
      setLoaded(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeStyle = target === 'verse' ? style : refStyle;
  const setActiveStyle = target === 'verse' ? setStyle : setRefStyle;

  // Apply a scripture theme: verse style (minus the reference sub-style) → the
  // verse, style.refStyle → the reference line, and resolve its bgRef background.
  async function handleLoadTheme(theme) {
    try {
      const raw = theme.style_json ? JSON.parse(theme.style_json) : null;
      if (!raw) return;
      // Normalise any theme shape (incl. a presentation token theme) into the verse
      // text style — one look applies to any content.
      const ts = normalizeLookStyle(raw);
      const { refStyle: refS, ...verse } = ts;
      // Apply verse + reference style as ONE undo step (a theme is one action).
      doc.set((d) => ({
        ...d,
        style: { ...DEFAULT_STYLE, ...verse },
        refStyle: refS ? { ...DEFAULT_STYLE, align: 'right', ...refS } : d.refStyle,
      }));
      if (theme.background_id && theme.background_path) {
        setBackground({ id: theme.background_id, path: theme.background_path, filename: theme.background_filename });
      } else if (raw.bgRef) {
        setBgLoading(true);
        try {
          const asset = await window.cue.backgrounds.download(raw.bgRef);
          setBackground({ id: asset.id, path: asset.path, filename: asset.filename });
        } catch {
          // Style applied, but the background couldn't be fetched — surface it.
          toast.error(`Couldn't download “${theme.name}” background`);
        }
        finally { setBgLoading(false); }
      }
    } catch {}
  }

  // Escape to close (unless the media picker is open).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving && !showBgPicker) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving, showBgPicker]);

  // ⌘S / Ctrl+S saves, like the other editors.
  const saveShortcutRef = React.useRef(null);
  saveShortcutRef.current = () => { if (!saving && loaded) handleSave(); };
  useEffect(() => {
    const onKey = (e) => {
      const mod = window.cue.platform === 'darwin' ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      saveShortcutRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function handleSave() {
    setSaving(true); setSaveError('');
    try {
      const strip = (s) => { const { runs: _r, ...base } = s; return base; };
      const styleToStore = styleIsDefault(style) ? null : strip(style);
      // The reference's default is right-aligned; store null only when it still
      // matches that baseline (so an explicit centre/left choice is preserved).
      const refBaseline = JSON.stringify({ ...DEFAULT_STYLE, align: 'right' });
      const refToStore = JSON.stringify({ ...DEFAULT_STYLE, ...strip(refStyle) }) === refBaseline ? null : strip(refStyle);
      await window.cue.settings.set('scripture_style_json', styleToStore);
      await window.cue.settings.set('scripture_ref_style_json', refToStore);
      await window.cue.settings.setGlobalBackground('scripture', background?.id ?? null);
      onSave?.();
      onClose();
    } catch (err) {
      console.error('[ScriptureEditor] save failed:', err);
      setSaveError(`Save failed: ${err?.message || 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  const refLine = `${sample.ref} (${sample.abbrev})`;

  // One-line summary of a style for the cards on the left.
  const summary = (st) => [
    st.fontFamily || 'Theme font',
    st.fontSize ? `${st.fontSize}px` : null,
    st.bold ? 'Bold' : null,
    st.italic ? 'Italic' : null,
    st.uppercase ? 'All caps' : null,
    st.align ? ({ left: 'Left', center: 'Centred', right: 'Right', justify: 'Justified' })[st.align] : null,
  ].filter(Boolean).join(' · ');

  return createPortal(
    <div className="fixed inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50 p-2">
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full h-full max-w-[98vw] max-h-[96vh] flex flex-col shadow-2xl ring-1 ring-white/5 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-md px-lg py-sm border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <span className="material-symbols-outlined text-primary text-[20px] shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>menu_book</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-headline-md font-semibold text-on-surface leading-tight truncate">Scripture appearance</h2>
            <p className="text-body-md text-on-surface-variant truncate">Applies to every verse you put on screen</p>
          </div>
          <div className="flex items-center gap-sm shrink-0">
            <UndoRedoButtons undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
            <button onClick={() => setShowThemePicker(true)} className="btn btn-secondary">
              <span className="material-symbols-outlined text-[16px]">style</span>
              Load theme…
            </button>
            <button onClick={onClose} title="Close" aria-label="Close"
              className="btn-icon">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {showBgPicker && (
          <MediaPickerModal
            initialId={background?.id ?? null}
            onSelect={(asset) => { setBackground(asset); setShowBgPicker(false); }}
            onClose={() => setShowBgPicker(false)}
          />
        )}

        {showThemePicker && (
          <ThemePickerModal
            category="scripture"
            onPick={(t) => { setShowThemePicker(false); handleLoadTheme(t); }}
            onClose={() => setShowThemePicker(false)}
          />
        )}

        <div className="flex-1 flex min-h-0">
          {/* Left: what you're styling, the background, and the preview text */}
          <div className="w-[360px] shrink-0 border-r border-outline-variant/30 overflow-y-auto custom-scrollbar p-lg flex flex-col gap-lg">
            <section className="flex flex-col gap-sm">
              <h3 className="text-[13px] font-semibold text-on-surface">What you're styling</h3>
              {[
                { id: 'verse', label: 'Verse text', body: sample.text, st: style, clamp: true },
                { id: 'reference', label: 'Reference', body: refLine, st: refStyle },
              ].map(({ id, label, body, st, clamp }) => (
                <button key={id}
                  onMouseDown={(e) => { e.preventDefault(); setTarget(id); }}
                  aria-pressed={target === id}
                  className={`text-left rounded-lg border px-md py-sm transition-colors cursor-pointer ${
                    target === id
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-outline-variant/30 bg-surface-container hover:border-outline-variant/60'
                  }`}
                >
                  <span className="flex items-center justify-between gap-sm">
                    <span className={`text-[13px] font-semibold ${target === id ? 'text-primary' : 'text-on-surface'}`}>{label}</span>
                    {target === id && <span className="text-[12px] text-primary">Editing</span>}
                  </span>
                  <span className={`block mt-xs text-[15px] leading-snug text-on-surface ${clamp ? 'line-clamp-3' : 'truncate'}`}>{body}</span>
                  <span className="block mt-xs text-[12px] text-on-surface-variant truncate">{summary(st)}</span>
                </button>
              ))}
            </section>

            <section className="flex flex-col gap-sm">
              <h3 className="text-[13px] font-semibold text-on-surface">Default background</h3>
              <div className="flex items-center gap-md">
                <button onClick={() => setShowBgPicker(true)} title="Choose a background"
                  className="w-32 aspect-video shrink-0 rounded-lg border border-outline-variant/30 bg-surface-container overflow-hidden cursor-pointer group relative">
                  {background ? (
                    /\.(mp4|webm|mov)$/i.test(background.path)
                      ? <video src={mediaUrl(background.path)} className="w-full h-full object-cover" muted />
                      : <img src={mediaUrl(background.path)} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-on-surface-variant/70 text-[22px]">wallpaper</span>
                    </span>
                  )}
                  <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="material-symbols-outlined text-white text-[18px]">edit</span>
                  </span>
                </button>
                <div className="flex flex-col gap-xs min-w-0">
                  <button onClick={() => setShowBgPicker(true)} className="btn btn-sm btn-secondary">{background ? 'Change…' : 'Choose…'}</button>
                  {background && <button onClick={() => setBackground(null)} className="btn btn-sm btn-ghost">Remove</button>}
                </div>
              </div>
              <p className="text-body-md text-on-surface-variant">
                Shown behind every verse unless a rundown item sets its own. Images and videos both work.
              </p>
            </section>

            <section className="flex flex-col gap-sm">
              <h3 className="text-[13px] font-semibold text-on-surface">Preview with</h3>
              <input
                value={sampleQuery}
                onChange={(e) => setSampleQuery(e.target.value)}
                placeholder="John 3:16, or any reference"
                className="h-9 px-md rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-body-md text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:border-primary"
              />
              <p className={`text-[12px] ${sampleMiss === 'ref' ? 'text-error' : 'text-on-surface-variant'}`}>
                {sampleMiss === 'none' ? 'Install a Bible translation in the Scripture tab to preview your own verses.'
                  : sampleMiss ? 'No passage found for that reference.'
                  : 'Try a long passage to check the text still fits.'}
              </p>
            </section>
          </div>

          {/* Right: toolbar + live preview, as in the Song Editor */}
          <div className="flex-1 min-w-0 flex flex-col">
            <FormattingToolbar
              style={activeStyle}
              onChange={setActiveStyle}
              fonts={fonts}
              hasSelection={() => false}
              execCmd={() => {}}
              previewTemplate={previewTemplate}
              simple={target === 'reference'}
            />

            <div className="flex-1 flex flex-col min-h-0 bg-surface-container-lowest p-md">
              <div className="flex items-center justify-between mb-sm flex-shrink-0">
                <span className="text-[12px] text-on-surface-variant">
                  {target === 'reference' ? 'Reference' : 'Verse text'} · {previewTemplate === 'lowerthird' ? 'Lower third' : 'Fullscreen'}
                </span>
                <div className="flex items-center gap-[2px] bg-surface-container rounded-md p-[2px]">
                  {[{ id: 'fullscreen', label: 'Full' }, { id: 'lowerthird', label: 'L3' }].map(({ id, label }) => (
                    <button key={id}
                      onMouseDown={(e) => { e.preventDefault(); setPreviewTemplate(id); }}
                      className={`btn btn-xs btn-toggle ${previewTemplate === id ? 'is-on' : ''}`}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center min-h-0 overflow-hidden">
                {/* Height-bound 16:9 box: fits the available section regardless of toolbar height */}
                <div className="h-full max-w-full relative" style={{ aspectRatio: '16 / 9' }}>
                  {previewTemplate === 'lowerthird' ? (
                    <LowerThirdPreview text={sample.text} runs={[]} style={style} copyright={refLine} copyrightAlign="right" copyrightStyle={refStyle} />
                  ) : (
                    <SlidePreview text={sample.text} runs={[]} style={style} backgroundPath={background?.path ?? null} copyright={refLine} copyrightAlign="right" copyrightStyle={refStyle}
                      onTextBoxChange={(box) => setStyle((s) => ({ ...s, textBox: box }))}
                      onRefPosChange={(pos) => setRefStyle((s) => ({ ...s, pos }))} />
                  )}
                  {bgLoading && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-xs bg-background/55 pointer-events-none">
                      <span className="material-symbols-outlined text-primary animate-spin text-[28px]">progress_activity</span>
                      <span className="text-[12px] text-on-surface-variant">Loading background…</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-md px-lg py-sm border-t border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <span className="flex items-center gap-xs text-body-md text-on-surface-variant min-w-0 truncate">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${styleIsDefault(style) ? 'bg-on-surface-variant/50' : 'bg-tertiary'}`} />
            {styleIsDefault(style) ? 'Using the theme defaults' : 'Custom style'}
          </span>
          <div className="flex items-center gap-sm shrink-0">
            {saveError && <span className="text-body-md text-error">{saveError}</span>}
            <button onClick={onClose} className="btn btn-ghost">Cancel</button>
            <button onClick={handleSave} disabled={saving || !loaded} className="btn btn-go">
              {saving ? 'Saving…' : 'Save appearance'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
