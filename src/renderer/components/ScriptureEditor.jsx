import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useModalGuard } from '../utils/modalGuard';
import MediaPickerModal from './MediaPickerModal';
import ThemePickerModal from './ThemePickerModal';
import UndoRedoButtons from './UndoRedoButtons';
import useEditHistory, { useUndoRedoKeys } from '../utils/useEditHistory';
import { useToast } from './Toast';
import { mediaUrl } from '../utils/mediaUrl';
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
      const ts = theme.style_json ? JSON.parse(theme.style_json) : null;
      if (!ts) return;
      const { refStyle: refS, ...verse } = ts;
      // Apply verse + reference style as ONE undo step (a theme is one action).
      doc.set((d) => ({
        ...d,
        style: { ...DEFAULT_STYLE, ...verse },
        refStyle: refS ? { ...DEFAULT_STYLE, align: 'right', ...refS } : d.refStyle,
      }));
      if (theme.background_id && theme.background_path) {
        setBackground({ id: theme.background_id, path: theme.background_path, filename: theme.background_filename });
      } else if (ts.bgRef) {
        setBgLoading(true);
        try {
          const asset = await window.cue.backgrounds.download(ts.bgRef);
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

  const refLine = `${SAMPLE_REF} (KJV)`;

  return createPortal(
    <div className="fixed inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50 p-2">
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full h-full max-w-[98vw] max-h-[96vh] flex flex-col shadow-2xl ring-1 ring-white/5 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-md px-lg py-sm border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <div className="flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>menu_book</span>
            <div>
              <h2 className="text-headline-md font-bold text-primary leading-tight tracking-tight">Scripture Appearance</h2>
              <p className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">Applies to every verse</p>
            </div>
          </div>
          <div className="flex-1" />
          <UndoRedoButtons undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
          <button onClick={() => setShowThemePicker(true)}
            className="flex items-center gap-xs bg-surface-container text-on-surface-variant text-[10px] font-mono rounded-lg px-sm h-7 border border-outline-variant/30 hover:border-outline-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.05em] transition-colors">
            <span className="material-symbols-outlined text-[15px]">style</span>
            Load Theme…
          </button>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer text-sm">
            ✕
          </button>
        </div>

        {/* Background row */}
        <div className="flex-shrink-0 border-b border-outline-variant/20 bg-surface-container/40 px-lg py-sm flex items-center gap-md">
          <div>
            <label className="block text-[9px] font-mono text-on-surface-variant/60 mb-0.5 uppercase tracking-[0.05em]">Default Background</label>
            <div className="flex items-center gap-sm">
              <div className="w-16 aspect-video rounded border border-outline-variant/30 bg-surface-container overflow-hidden cursor-pointer group relative flex-shrink-0"
                onClick={() => setShowBgPicker(true)}>
                {background ? (
                  /\.(mp4|webm|mov)$/i.test(background.path)
                    ? <video src={mediaUrl(background.path)} className="w-full h-full object-cover" muted />
                    : <img src={mediaUrl(background.path)} className="w-full h-full object-cover" alt="" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-outline-variant text-base">wallpaper</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="material-symbols-outlined text-white text-xs">edit</span>
                </div>
              </div>
              {background && (
                <button onClick={() => setBackground(null)}
                  className="text-[9px] font-mono text-error/60 hover:text-error cursor-pointer uppercase tracking-[0.05em]">Clear</button>
              )}
            </div>
          </div>
          <p className="text-body-sm text-on-surface-variant/70 max-w-md">
            Shown behind every scripture verse unless a per-slot override is set in the rundown. Images and videos supported.
          </p>
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

        {/* Target toggle — choose what the toolbar edits */}
        <div className="flex items-center gap-sm px-lg py-xs border-b border-outline-variant/20 bg-surface-container/40 flex-shrink-0">
          <span className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">Editing</span>
          <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px]">
            {[{ id: 'verse', label: 'Verse Text' }, { id: 'reference', label: 'Reference' }].map(({ id, label }) => (
              <button key={id}
                onMouseDown={(e) => { e.preventDefault(); setTarget(id); }}
                className={`px-md h-6 text-[10px] font-mono rounded transition-colors cursor-pointer uppercase tracking-[0.05em] ${
                  target === id ? 'bg-primary text-on-primary' : 'text-on-surface-variant/60 hover:text-on-surface-variant'
                }`}
              >{label}</button>
            ))}
          </div>
          <span className="text-[9px] font-mono text-on-surface-variant/40">
            {target === 'reference' ? 'Styling “John 3:16 (KJV)”' : 'Styling the verse text'}
          </span>
        </div>

        {/* Toolbar — edits the verse or reference style depending on target */}
        <FormattingToolbar
          style={activeStyle}
          onChange={setActiveStyle}
          fonts={fonts}
          hasSelection={() => false}
          execCmd={() => {}}
          previewTemplate={previewTemplate}
          simple={target === 'reference'}
        />

        {/* Preview */}
        <div className="flex-1 flex flex-col min-h-0 bg-surface-container-lowest p-md">
          <div className="flex items-center justify-between mb-sm flex-shrink-0">
            <span className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-[0.06em]">
              {previewTemplate === 'lowerthird' ? 'Lower Third' : 'Fullscreen'} — sample verse
            </span>
            <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px]">
              {[{ id: 'fullscreen', label: 'Full' }, { id: 'lowerthird', label: 'L3' }].map(({ id, label }) => (
                <button key={id}
                  onMouseDown={(e) => { e.preventDefault(); setPreviewTemplate(id); }}
                  className={`px-sm h-[18px] text-[9px] font-mono rounded transition-colors cursor-pointer uppercase tracking-[0.05em] ${
                    previewTemplate === id ? 'bg-primary text-on-primary' : 'text-on-surface-variant/50 hover:text-on-surface-variant'
                  }`}
                >{label}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center min-h-0 overflow-hidden">
            {/* Height-bound 16:9 box: fits the available section regardless of toolbar height */}
            <div className="h-full max-w-full relative" style={{ aspectRatio: '16 / 9' }}>
              {previewTemplate === 'lowerthird' ? (
                <LowerThirdPreview text={SAMPLE_TEXT} runs={[]} style={style} copyright={refLine} copyrightAlign="right" copyrightStyle={refStyle} />
              ) : (
                <SlidePreview text={SAMPLE_TEXT} runs={[]} style={style} backgroundPath={background?.path ?? null} copyright={refLine} copyrightAlign="right" copyrightStyle={refStyle}
                  onTextBoxChange={(box) => setStyle((s) => ({ ...s, textBox: box }))}
                  onRefPosChange={(pos) => setRefStyle((s) => ({ ...s, pos }))} />
              )}
              {bgLoading && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-xs bg-background/55 pointer-events-none">
                  <span className="material-symbols-outlined text-primary animate-spin text-[28px]">progress_activity</span>
                  <span className="text-[10px] font-mono uppercase tracking-[0.08em] text-on-surface-variant">Loading background…</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-lg py-sm border-t border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <div className="flex items-center gap-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary/60" />
            <span className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">
              {styleIsDefault(style) ? 'Template defaults' : 'Custom style'}
            </span>
          </div>
          <div className="flex items-center gap-sm">
            {saveError && <span className="text-label-sm font-mono text-error">{saveError}</span>}
            <button onClick={onClose}
              className="px-lg h-8 text-label-sm font-mono text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-variant transition-colors cursor-pointer uppercase tracking-[0.05em]">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving || !loaded}
              className="px-lg h-8 text-label-sm font-mono bg-tertiary-container text-on-tertiary-container disabled:opacity-40 rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em] hover:opacity-90">
              {saving ? 'Saving…' : 'Save Appearance'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
