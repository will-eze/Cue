import React, { useRef } from 'react';
import LtBandPreview from './LtBandPreview';
import {
  resolveLtPages, pagesToText, ltDefaults, parseLtJson,
  LT_LIMITS, LT_DEFAULT_MAX_LINES, LT_DEFAULT_MAX_CHARS, PAGE_BREAK,
} from '../../shared/presentation-lt-text';

// Lower-third editor for ONE presentation slide. A slide's text rarely fits a lower third in one
// piece, so it airs as several short PAGES: auto-split at sentence/clause boundaries within a
// max-lines / characters-per-line budget, or exactly as the operator writes it (Enter = line
// break, a "⁂" line = page break). The strip below is produced by the same resolveLtPages the
// operator payload uses, so what is shown here is what airs. On air, Next steps through the pages
// before moving to the next slide.

const MODES = [
  { id: 'inherit', label: 'Inherit' }, { id: 'auto', label: 'Auto' },
  { id: 'custom', label: 'Custom' }, { id: 'hide', label: 'Hide' },
];

function Stepper({ value, min, max, step = 1, onChange, unit }) {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(Math.min(max, value + step));
  return (
    <div className="flex items-center gap-xs shrink-0">
      <button type="button" className="btn btn-icon-sm btn-icon-outline" title="Decrease" disabled={value <= min} onClick={dec}>
        <span className="material-symbols-outlined text-[14px]">remove</span>
      </button>
      <span className="min-w-[3.5ch] text-center text-body-md text-on-surface tabular-nums">{value}{unit || ''}</span>
      <button type="button" className="btn btn-icon-sm btn-icon-outline" title="Increase" disabled={value >= max} onClick={inc}>
        <span className="material-symbols-outlined text-[14px]">add</span>
      </button>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-wrap items-center gap-x-sm gap-y-xs min-w-0">
      <span className="text-label-sm font-label-sm text-on-surface-variant w-24 shrink-0">{label}</span>
      {children}
    </div>
  );
}

export default function LowerThirdEditor({ slide, deckMode, defaults, themeStyle, themeBgPath, ltFontScale = 1, onChange, onDefaultsChange }) {
  const taRef = useRef(null);
  const own = parseLtJson(slide.lt) || {};
  const sel = ['auto', 'custom', 'hide'].includes(own.mode) ? own.mode : 'inherit';
  const d = ltDefaults(defaults);
  const resolved = resolveLtPages({ elements: slide.elements, lt_json: own }, deckMode, d);
  const hidden = resolved.mode === 'hide';
  const titleSel = ['auto', 'none', 'custom'].includes(own.title) ? own.title : (resolved.mode === 'custom' ? 'none' : 'auto');
  const set = (patch, co) => onChange({ ...own, ...patch }, co);

  function pick(id) {
    if (id === 'custom') {
      // Pre-fill with what auto currently shows (explicit lines + ⁂), so the operator edits what they see.
      const have = own.mode === 'custom' && String(own.text || '').trim();
      const auto = resolveLtPages({ elements: slide.elements, lt_json: { ...own, mode: 'auto' } }, 'auto', d);
      set({ mode: 'custom', text: have ? own.text : pagesToText(auto.pages) });
    } else set({ mode: id });
  }

  function insertBreak() {
    const ta = taRef.current;
    const value = String(own.text || '');
    const a = ta ? ta.selectionStart : value.length, b = ta ? ta.selectionEnd : value.length;
    const before = value.slice(0, a).replace(/[ \t]+$/, ''), after = value.slice(b).replace(/^[ \t]+/, '');
    const ins = (before && !before.endsWith('\n') ? '\n' : '') + PAGE_BREAK + (after && !after.startsWith('\n') ? '\n' : '');
    const next = before + ins + after;
    set({ mode: 'custom', text: next.slice(0, LT_LIMITS.text) }, 'lt-text');
    const caret = (before + ins).length;
    setTimeout(() => { if (taRef.current) { taRef.current.focus(); taRef.current.setSelectionRange(caret, caret); } }, 0);
  }

  const pages = resolved.pages;
  const n = pages.length;
  return (
    <div className="flex flex-col gap-sm min-w-0">
      <span className="text-label-sm font-label-sm text-on-surface-variant">Lower third for this slide</span>
      <div className="flex flex-wrap items-center gap-xs">
        {MODES.map((o) => (
          <button key={o.id} type="button" onClick={() => pick(o.id)}
            className={`btn btn-toggle btn-xs ${sel === o.id ? 'is-on' : ''}`}>{o.label}</button>
        ))}
      </div>

      {!hidden && (
        <>
          <Row label="Lines per page">
            <Stepper value={resolved.maxLines} min={LT_LIMITS.maxLines[0]} max={LT_LIMITS.maxLines[1]}
              onChange={(v) => set({ maxLines: v }, 'lt-lines')} />
            <button type="button" title={`Use the default (${d.maxLines})`}
              className={`btn btn-toggle btn-xs ${own.maxLines == null ? 'is-on' : ''}`}
              onClick={() => { const { maxLines: _m, ...rest } = own; onChange(rest); }}>Default</button>
          </Row>
          <Row label="Characters per line">
            <Stepper value={resolved.maxChars} min={LT_LIMITS.maxChars[0]} max={LT_LIMITS.maxChars[1]} step={2}
              onChange={(v) => set({ maxChars: v }, 'lt-chars')} />
            <button type="button" title={`Use the default (${d.maxChars})`}
              className={`btn btn-toggle btn-xs ${own.maxChars == null ? 'is-on' : ''}`}
              onClick={() => { const { maxChars: _m, ...rest } = own; onChange(rest); }}>Default</button>
          </Row>
          <Row label="Title line">
            <div className="flex items-center gap-xs">
              {[{ id: 'auto', label: 'Heading' }, { id: 'none', label: 'None' }, { id: 'custom', label: 'Custom' }].map((o) => (
                <button key={o.id} type="button" onClick={() => set({ title: o.id })}
                  className={`btn btn-toggle btn-xs ${titleSel === o.id ? 'is-on' : ''}`}>{o.label}</button>
              ))}
            </div>
          </Row>
          {titleSel === 'custom' && (
            <input type="text" value={own.titleText || ''} maxLength={LT_LIMITS.titleText}
              onChange={(e) => set({ title: 'custom', titleText: e.target.value }, 'lt-title')}
              placeholder="Shown above every page"
              className="bg-surface-container-lowest border border-outline-variant/40 rounded px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary min-w-0" />
          )}
        </>
      )}

      {sel === 'custom' && (
        <div className="flex flex-col gap-xs min-w-0">
          <textarea
            ref={taRef}
            value={own.text || ''}
            maxLength={LT_LIMITS.text}
            onChange={(e) => set({ mode: 'custom', text: e.target.value }, 'lt-text')}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); insertBreak(); } }}
            rows={6}
            placeholder="Text for the lower third. Enter starts a new line. A line with only ⁂ starts a new page."
            className="bg-surface-container-lowest border border-outline-variant/40 rounded px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary resize-y min-w-0"
          />
          <div className="flex flex-wrap items-center gap-xs">
            <button type="button" className="btn btn-secondary btn-xs" onClick={insertBreak}
              title="Start a new page here (Ctrl/⌘ + Enter)">
              <span className="material-symbols-outlined text-[14px]">content_cut</span> Insert page break
            </button>
            <span className="text-label-sm font-label-sm text-on-surface-variant min-w-0 truncate">Enter = new line</span>
          </div>
        </div>
      )}

      {/* Page strip: one small lower-third picture per page, from the same resolver the operator uses. */}
      <div className="flex flex-col gap-xs min-w-0">
        <div className="flex items-center justify-between gap-sm min-w-0">
          <span className="text-label-sm font-label-sm text-on-surface-variant truncate min-w-0">
            {hidden ? 'Hidden on lower-third channels' : n === 0 ? 'No lower-third text' : `${n} page${n === 1 ? '' : 's'} · Next steps through them`}
          </span>
        </div>
        {n === 0 ? (
          <div className="text-label-sm font-label-sm text-on-surface-variant/70">
            {hidden ? 'This slide shows nothing on lower-third channels.' : 'This slide has no text, so lower-third channels stay blank.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-xs">
            {pages.map((p, i) => (
              <div key={i} className="min-w-0 flex flex-col gap-[2px]">
                <div className={`rounded-md overflow-hidden border ${p.manual ? 'border-dashed border-outline' : 'border-outline-variant/40'}`}>
                  <LtBandPreview lines={p.lines} title={resolved.title} style={themeStyle} bgPath={themeBgPath} fontScale={ltFontScale} />
                </div>
                <div className="flex items-center gap-xs text-label-sm font-label-sm text-on-surface-variant min-w-0">
                  <span className="tabular-nums shrink-0">Page {i + 1} of {n}</span>
                  {p.manual && <span className="material-symbols-outlined text-[13px] shrink-0" title="Manual page break before this page">content_cut</span>}
                  {p.overflow && <span className="material-symbols-outlined text-[13px] shrink-0 text-on-surface" title="A word is longer than the line width, so this page shrinks to fit">warning</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-xs min-w-0 pt-xs border-t border-outline-variant/30">
        <span className="text-label-sm font-label-sm text-on-surface-variant">Defaults for all presentations</span>
        <Row label="Lines per page">
          <Stepper value={d.maxLines} min={LT_LIMITS.maxLines[0]} max={LT_LIMITS.maxLines[1]}
            onChange={(v) => onDefaultsChange({ maxLines: v })} />
          {d.maxLines !== LT_DEFAULT_MAX_LINES && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => onDefaultsChange({ maxLines: LT_DEFAULT_MAX_LINES })}>Reset</button>
          )}
        </Row>
        <Row label="Characters per line">
          <Stepper value={d.maxChars} min={LT_LIMITS.maxChars[0]} max={LT_LIMITS.maxChars[1]} step={2}
            onChange={(v) => onDefaultsChange({ maxChars: v })} />
          {d.maxChars !== LT_DEFAULT_MAX_CHARS && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => onDefaultsChange({ maxChars: LT_DEFAULT_MAX_CHARS })}>Reset</button>
          )}
        </Row>
      </div>
    </div>
  );
}
