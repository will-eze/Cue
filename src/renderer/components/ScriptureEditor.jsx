import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import MediaPickerModal from './MediaPickerModal';
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
  const [style, setStyle] = useState({ ...DEFAULT_STYLE });        // verse text style
  const [refStyle, setRefStyle] = useState({ ...DEFAULT_STYLE, align: 'right' }); // reference line style
  const [target, setTarget] = useState('verse');                  // 'verse' | 'reference'
  const [background, setBackground] = useState(null); // { id, path, filename } | null
  const [previewTemplate, setPreviewTemplate] = useState('fullscreen');
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const fonts = useFonts();

  // Load saved scripture verse style, reference style + background.
  useEffect(() => {
    (async () => {
      const styleJson = await window.cue.settings.get('scripture_style_json');
      if (styleJson) setStyle({ ...DEFAULT_STYLE, ...styleJson });
      const refJson = await window.cue.settings.get('scripture_ref_style_json');
      if (refJson) setRefStyle({ ...DEFAULT_STYLE, align: 'right', ...refJson });
      const bgId = await window.cue.settings.get('global_bg_scripture_id');
      if (bgId) {
        const asset = await window.cue.media.get(bgId);
        if (asset) setBackground(asset);
      }
      setLoaded(true);
    })();
  }, []);

  const activeStyle = target === 'verse' ? style : refStyle;
  const setActiveStyle = target === 'verse' ? setStyle : setRefStyle;

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
            <div className="h-full max-w-full" style={{ aspectRatio: '16 / 9' }}>
              {previewTemplate === 'lowerthird' ? (
                <LowerThirdPreview text={SAMPLE_TEXT} runs={[]} style={style} copyright={refLine} copyrightAlign="right" copyrightStyle={refStyle} />
              ) : (
                <SlidePreview text={SAMPLE_TEXT} runs={[]} style={style} backgroundPath={background?.path ?? null} copyright={refLine} copyrightAlign="right" copyrightStyle={refStyle}
                  onTextBoxChange={(box) => setStyle((s) => ({ ...s, textBox: box }))}
                  onRefPosChange={(pos) => setRefStyle((s) => ({ ...s, pos }))} />
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
