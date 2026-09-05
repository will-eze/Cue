import React, { useMemo, useState } from 'react';

// A compact "Priority" control (header button + popover) that answers "why isn't my
// default showing?". The cascade — highest set wins — is:
//
//   Item override  ›  Rundown theme  ›  Songs/Scripture/Slides default  ›  App default  ›  Built-in
//
// The trigger is a small header chip (sits next to "Show legacy"); a red dot flags a
// conflict where a default you set is OVERRIDDEN by a higher tier. The popover shows the
// per-kind resolution and a one-click "Clear rundown theme" fix (the usual culprit).
// Item overrides are per-item, so they're the top tier but not resolved at this level.

const KINDS = [
  { key: 'song', label: 'Songs' },
  { key: 'scripture', label: 'Scripture' },
  { key: 'slide', label: 'Slides' },
];

export default function ThemeCascadeBar({
  themes = [], rundownThemeId = null, rundownTitle = null,
  defaultThemeId = null, songDefaultId = null, scriptureDefaultId = null, slideDefaultId = null,
  onClearRundown = null, align = 'right',
}) {
  const [open, setOpen] = useState(false);
  const nameOf = useMemo(() => {
    const m = new Map();
    for (const t of themes) m.set(t.id, t.name);
    return (id) => (id ? (m.get(id) || 'Unknown') : null);
  }, [themes]);

  const perKindId = { song: songDefaultId, scripture: scriptureDefaultId, slide: slideDefaultId };

  function resolve(kind, label) {
    const chain = [
      { tier: 'Rundown', id: rundownThemeId },
      { tier: `${label} default`, id: perKindId[kind] },
      { tier: 'All default', id: defaultThemeId },
    ];
    const winnerIdx = chain.findIndex((c) => c.id);
    const winner = winnerIdx >= 0 ? chain[winnerIdx] : null;
    const overridden = chain
      .map((c, i) => ({ ...c, i }))
      .filter((c) => c.id && c.i > winnerIdx && c.tier.endsWith('default'));
    return { winner, overridden };
  }

  const rows = KINDS.map(({ key, label }) => ({ key, label, ...resolve(key, label) }));
  const conflicts = rows.filter((r) => r.overridden.length);

  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen((v) => !v)} title="How themes resolve (priority order)"
        className={`text-[10px] font-label-sm uppercase tracking-[0.05em] flex items-center gap-[3px] cursor-pointer transition-colors ${conflicts.length ? 'text-secondary/90 hover:text-secondary' : 'text-on-surface-variant/60 hover:text-on-surface-variant'}`}>
        <span className="material-symbols-outlined text-[15px]">account_tree</span>
        Priority
        {conflicts.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-secondary" />}
        <span className="material-symbols-outlined text-[14px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className={`absolute z-30 mt-xs top-full ${align === 'right' ? 'right-0' : 'left-0'} w-[440px] max-w-[92vw] bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl ring-1 ring-white/5 overflow-hidden`}>
            {/* Priority legend */}
            <div className="px-md py-sm border-b border-outline-variant/20 bg-surface-container/40 flex items-center gap-[3px] flex-wrap">
              <span className="text-[9px] font-mono text-on-surface uppercase tracking-[0.05em] mr-xs">Highest set wins</span>
              {['This item', 'Rundown', 'Songs / Scripture / Slides default', 'All default', 'Built-in'].map((t, i) => (
                <React.Fragment key={t}>
                  {i > 0 && <span className="material-symbols-outlined text-[13px] text-on-surface-variant/30">chevron_right</span>}
                  <span className="text-[9px] font-mono uppercase tracking-[0.04em] text-on-surface-variant/60 border border-outline-variant/25 rounded px-xs py-[1px]">{t}</span>
                </React.Fragment>
              ))}
            </div>

            {/* Per-kind resolution */}
            <div className="divide-y divide-outline-variant/10">
              {rows.map((r) => {
                const fromRundown = r.winner?.tier === 'Rundown';
                return (
                  <div key={r.key} className="px-md py-[7px] flex items-center gap-sm flex-wrap">
                    <span className="w-16 shrink-0 text-[10px] font-mono uppercase tracking-[0.04em] text-on-surface-variant">{r.label}</span>
                    {r.winner ? (
                      <span className="flex items-center gap-xs min-w-0">
                        <span className="material-symbols-outlined text-[13px] text-tertiary">arrow_forward</span>
                        <b className="text-body-sm text-on-surface truncate">{nameOf(r.winner.id)}</b>
                        <span className={`text-[9px] font-mono uppercase tracking-[0.04em] rounded px-xs py-[1px] shrink-0 ${fromRundown ? 'bg-primary/15 text-primary border border-primary/30' : 'text-on-surface-variant/60 border border-outline-variant/25'}`}>
                          from {r.winner.tier}
                        </span>
                      </span>
                    ) : (
                      <span className="text-body-sm text-on-surface-variant/50 italic">Built-in fallback (black)</span>
                    )}
                    {r.overridden.map((o) => (
                      <span key={o.tier} className="flex items-center gap-[3px] text-[10px] text-secondary/90 ml-auto shrink-0" title={`You set this ${o.tier}, but a higher-priority theme wins for ${r.label}`}>
                        <span className="material-symbols-outlined text-[14px]">priority_high</span>
                        Your {o.tier} ({nameOf(o.id)}) is hidden
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* One-click fix — the rundown theme is the usual reason a default doesn't show. */}
            {rundownThemeId && (
              <div className="px-md py-sm bg-surface-container/30 flex items-center gap-sm flex-wrap border-t border-outline-variant/10">
                <span className="text-[10px] text-on-surface-variant/60 min-w-0">
                  This rundown{rundownTitle ? ` (“${rundownTitle}”)` : ''} has its own theme set, so your defaults don’t apply here.
                </span>
                {onClearRundown && (
                  <button onClick={() => { onClearRundown(); setOpen(false); }}
                    className="ml-auto shrink-0 text-[10px] font-mono uppercase tracking-[0.04em] text-primary hover:text-on-primary hover:bg-primary/80 border border-primary/40 rounded px-sm py-[3px] transition-colors cursor-pointer flex items-center gap-[3px]">
                    <span className="material-symbols-outlined text-[13px]">close</span>Clear rundown theme
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
