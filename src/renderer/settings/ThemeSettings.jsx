import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  FormattingToolbar,
  SlidePreview,
  LowerThirdPreview,
  DEFAULT_STYLE,
} from '../components/SongEditor';
import MediaPickerModal from '../components/MediaPickerModal';
import { mediaUrl } from '../utils/mediaUrl';
import { useFonts } from '../utils/fonts';

const SAMPLE_TEXT = 'Amazing Grace\nHow Sweet the Sound';

// ─── Theme Editor Modal ────────────────────────────────────────────────────

function ThemeEditorModal({ theme, onClose, onSaved }) {
  const [name, setName] = useState(theme?.name ?? '');
  const [style, setStyle] = useState(() =>
    theme?.style_json ? { ...DEFAULT_STYLE, ...JSON.parse(theme.style_json) } : { ...DEFAULT_STYLE }
  );
  const [background, setBackground] = useState(
    theme?.background_id ? { id: theme.background_id, path: theme.background_path, filename: theme.background_filename } : null
  );
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState('fullscreen');
  const [saving, setSaving] = useState(false);
  const fonts = useFonts();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !showBgPicker) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, showBgPicker]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        style_json: JSON.stringify(style),
        background_id: background?.id ?? null,
      };
      if (theme?.id) {
        await window.cue.themes.update(theme.id, data);
      } else {
        await window.cue.themes.create(data);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const labelCls = 'block text-[9px] font-mono text-on-surface-variant/60 mb-0.5 uppercase tracking-[0.05em]';

  return createPortal(
    <div className="fixed inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50 p-2">
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-3xl flex flex-col shadow-2xl ring-1 ring-white/5 overflow-y-auto custom-scrollbar" style={{ maxHeight: '94vh' }}>

        {/* Header */}
        <div className="flex items-center gap-md px-lg py-sm border-b border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>style</span>
          <div>
            <h2 className="text-headline-md font-bold text-primary leading-tight">
              {theme?.id ? 'Edit Theme' : 'New Theme'}
            </h2>
            <p className="text-[9px] font-mono text-on-surface-variant/50 uppercase tracking-[0.06em]">Theme Editor</p>
          </div>
          <div className="flex-1" />
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer text-sm">
            ✕
          </button>
        </div>

        {/* Name + background row */}
        <div className="flex items-end gap-md px-lg py-sm border-b border-outline-variant/20 bg-surface-container/40 flex-shrink-0">
          <div className="flex-1">
            <label className={labelCls}>Theme Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sunday Worship"
              className="w-full bg-surface-container-lowest text-on-surface text-body-sm rounded-lg px-md py-1.5 border border-outline-variant/50 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
            />
          </div>
          <div>
            <label className={labelCls}>Background</label>
            <div className="flex items-center gap-sm">
              <div
                className="w-16 aspect-video rounded border border-outline-variant/30 bg-surface-container overflow-hidden cursor-pointer group relative flex-shrink-0"
                onClick={() => setShowBgPicker(true)}
              >
                {background?.path ? (
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
                  className="text-[9px] font-mono text-error/60 hover:text-error cursor-pointer uppercase tracking-[0.05em]">
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Formatting toolbar */}
        <FormattingToolbar
          style={style}
          onChange={setStyle}
          fonts={fonts}
          hasSelection={() => false}
          execCmd={() => {}}
          previewTemplate={previewTemplate}
        />

        {/* Preview — width-bound so it derives its height from the modal width
            (the modal is content-sized; a height-bound box would collapse to 0). */}
        <div className="p-md bg-surface-container-lowest">
          <div className="flex items-center justify-between mb-sm">
            <span className="text-[9px] font-mono text-on-surface-variant/40 uppercase tracking-[0.06em]">
              {previewTemplate === 'lowerthird' ? 'Lower Third Preview' : 'Fullscreen Preview'}
            </span>
            <div className="flex items-center gap-[2px] bg-surface-container rounded p-[2px]">
              {[
                { id: 'fullscreen', label: 'Full' },
                { id: 'lowerthird', label: 'L3' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onMouseDown={(e) => { e.preventDefault(); setPreviewTemplate(id); }}
                  className={`px-sm h-[18px] text-[9px] font-mono rounded transition-colors cursor-pointer uppercase tracking-[0.05em] ${
                    previewTemplate === id
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant/50 hover:text-on-surface-variant'
                  }`}
                >{label}</button>
              ))}
            </div>
          </div>
          <div className="w-full">
            {previewTemplate === 'lowerthird' ? (
              <LowerThirdPreview text={SAMPLE_TEXT} runs={[]} style={style} />
            ) : (
              <SlidePreview
                text={SAMPLE_TEXT}
                runs={[]}
                style={style}
                backgroundPath={background?.path ?? null}
                onTextBoxChange={(box) => setStyle((s) => ({ ...s, textBox: box }))}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-sm px-lg py-sm border-t border-outline-variant/30 bg-surface-container-high flex-shrink-0">
          <button onClick={onClose}
            className="px-lg h-8 text-label-sm font-mono text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-variant transition-colors cursor-pointer uppercase tracking-[0.05em]">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!name.trim() || saving}
            className="px-lg h-8 text-label-sm font-mono bg-tertiary-container text-on-tertiary-container disabled:opacity-40 rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em] hover:opacity-90">
            {saving ? 'Saving…' : theme?.id ? 'Update Theme' : 'Save Theme'}
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
    </div>,
    document.body
  );
}

// ─── Theme Card ────────────────────────────────────────────────────────────

function ThemeCard({ theme, services, onEdit, onDelete, onApplied }) {
  const [selectedServiceId, setSelectedServiceId] = useState(services[0]?.id ?? null);
  const [applyBg, setApplyBg] = useState(!!theme.background_id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const style = theme.style_json ? { ...DEFAULT_STYLE, ...JSON.parse(theme.style_json) } : { ...DEFAULT_STYLE };

  function showFeedback(msg) {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  }

  async function handleApplyToRundown() {
    if (!selectedServiceId) return;
    const count = await window.cue.themes.applyToRundown(theme.id, selectedServiceId, applyBg);
    showFeedback(`Applied to ${count} song${count !== 1 ? 's' : ''} in rundown`);
    onApplied?.();
  }

  async function handleApplyToAllSongs() {
    if (!confirm(`Apply theme "${theme.name}" to every song in the library?\nThis overwrites each song's style while preserving inline text formatting.`)) return;
    const count = await window.cue.themes.applyToAllSongs(theme.id, applyBg);
    showFeedback(`Applied to ${count} song${count !== 1 ? 's' : ''}`);
    onApplied?.();
  }

  return (
    <div className="bg-surface-container border border-outline-variant/30 rounded-xl overflow-hidden flex flex-col">
      {/* Slide preview */}
      <div className="p-sm pb-0">
        <SlidePreview
          text={SAMPLE_TEXT}
          runs={[]}
          style={style}
          backgroundPath={theme.background_path ?? null}
        />
      </div>

      {/* Name + edit/delete */}
      <div className="px-md pt-sm pb-xs flex items-center justify-between">
        <span className="text-label-sm font-mono font-bold text-on-surface truncate min-w-0 mr-sm">{theme.name}</span>
        <div className="flex items-center gap-xs flex-shrink-0">
          <button onClick={onEdit}
            className="text-[9px] font-mono text-on-surface-variant hover:text-primary cursor-pointer uppercase tracking-[0.05em] transition-colors">
            Edit
          </button>
          {confirmDelete ? (
            <>
              <button onClick={() => { onDelete(); setConfirmDelete(false); }}
                className="text-[9px] font-mono text-error cursor-pointer uppercase tracking-[0.05em]">
                Confirm
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="text-[9px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.05em]">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="text-[9px] font-mono text-on-surface-variant/40 hover:text-error cursor-pointer uppercase tracking-[0.05em] transition-colors">
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Apply controls */}
      <div className="px-md pb-md space-y-xs">
        {!!theme.background_id && (
          <label className="flex items-center gap-xs cursor-pointer">
            <input
              type="checkbox"
              checked={applyBg}
              onChange={(e) => setApplyBg(e.target.checked)}
              className="accent-primary w-3 h-3"
            />
            <span className="text-[10px] font-mono text-on-surface-variant/70">Apply background</span>
          </label>
        )}

        <div className="flex items-center gap-xs">
          <select
            value={selectedServiceId ?? ''}
            onChange={(e) => setSelectedServiceId(Number(e.target.value))}
            className="flex-1 min-w-0 bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[3px] text-[10px] font-mono text-on-surface outline-none focus:border-primary cursor-pointer"
          >
            {services.length === 0
              ? <option value="">No rundowns</option>
              : services.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)
            }
          </select>
          <button
            onClick={handleApplyToRundown}
            disabled={!selectedServiceId || services.length === 0}
            className="shrink-0 px-sm py-[3px] text-[9px] font-mono bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 active:scale-95 transition-all cursor-pointer disabled:opacity-40 uppercase tracking-[0.05em]"
          >
            Apply
          </button>
        </div>

        <button
          onClick={handleApplyToAllSongs}
          className="w-full text-[9px] font-mono text-on-surface-variant/60 hover:text-on-surface border border-outline-variant/20 hover:border-outline-variant rounded px-sm py-[3px] transition-colors cursor-pointer uppercase tracking-[0.05em]"
        >
          Apply to all songs
        </button>

        {feedback && (
          <p className="text-[9px] font-mono text-tertiary pt-[2px]">{feedback}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main section component ────────────────────────────────────────────────

export default function ThemeSettings() {
  const [themes, setThemes] = useState([]);
  const [services, setServices] = useState([]);
  const [editingTheme, setEditingTheme] = useState(null);

  useEffect(() => {
    reload();
    window.cue.services.list().then(setServices);
  }, []);

  async function reload() {
    const list = await window.cue.themes.list();
    setThemes(list);
  }

  async function handleDelete(id) {
    await window.cue.themes.delete(id);
    reload();
  }

  return (
    <section className="space-y-md">
      <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary">style</span>
        Themes
      </h2>

      <div className="bg-surface-container-high p-lg rounded-xl border border-outline-variant/30">
        <div className="flex items-start justify-between mb-md gap-md">
          <div>
            <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Saved Themes</h3>
            <p className="text-body-sm text-on-surface-variant/70 mt-xs">
              A theme is a saved text style (font, colour, shadow, textbox) plus an optional default background.
              Apply it to a rundown or to all songs to give them a consistent look.
            </p>
          </div>
          <button
            onClick={() => setEditingTheme({})}
            className="shrink-0 px-md py-xs text-label-sm font-label-sm font-bold bg-primary/10 border border-primary/30 text-primary rounded-lg hover:bg-primary/20 active:scale-95 transition-all cursor-pointer"
          >
            + New Theme
          </button>
        </div>

        {themes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-xl gap-sm text-outline-variant">
            <span className="material-symbols-outlined text-5xl">palette</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">No themes yet</span>
            <p className="text-body-sm text-on-surface-variant/50 text-center max-w-xs mt-xs">
              Create a theme to save a style you can quickly apply across songs and rundowns.
            </p>
          </div>
        ) : (
          <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {themes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                services={services}
                onEdit={() => setEditingTheme(theme)}
                onDelete={() => handleDelete(theme.id)}
                onApplied={reload}
              />
            ))}
          </div>
        )}
      </div>

      {editingTheme !== null && (
        <ThemeEditorModal
          theme={editingTheme?.id ? editingTheme : null}
          onClose={() => setEditingTheme(null)}
          onSaved={() => { setEditingTheme(null); reload(); }}
        />
      )}
    </section>
  );
}
