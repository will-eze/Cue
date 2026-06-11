import React, { useState, useEffect, useCallback, useRef } from 'react';
import GraphicsEditor, { fillPlaceholders, flatTextCss, buildBarBg } from '../components/GraphicsEditor';
import { CHANNEL_MODES, channelMode, modeToFlags } from '../utils/channelMode';

const FRAME_W = 1920, FRAME_H = 1080;
const DEFAULT_BOX = { x: 4, y: 70, w: 55, h: 22 };
const NAME_BASE  = { fontSize: 54, color: '#ffffff', fontWeight: 700 };
const TITLE_BASE = { fontSize: 28, color: '#adc6ff', fontWeight: 500 };

function parseStyle(g) {
  try { return g.style_json ? (typeof g.style_json === 'string' ? JSON.parse(g.style_json) : g.style_json) : {}; }
  catch { return {}; }
}

function ntEqual(a, b) {
  if (!a || !b) return false;
  return (a.name || '') === (b.name || '') && (a.title || '') === (b.title || '');
}

// Destination overrides — 'default' uses each graphic's saved target.
const DEST_OPTS = [
  { id: 'default', label: 'Default', icon: 'tune' },
  { id: 'all',     label: 'All',     icon: 'cast' },
  { id: 'screen',  label: 'In-Room', icon: 'monitor' },
  { id: 'ndi',     label: 'Online',  icon: 'lan' },
];
const TARGET_LABEL = { all: 'All', screen: 'In-Room', ndi: 'Online' };

export default function GraphicsPanel() {
  const [graphics, setGraphics] = useState([]);
  const [overlay, setOverlay] = useState({ nameTitle: null, ticker: null, custom: null });
  const [editor, setEditor] = useState(null); // {} = new, graphic obj = edit, null = closed
  const [quickTicker, setQuickTicker] = useState('');
  const [dest, setDest] = useState('default'); // live destination override
  const [ltChannels, setLtChannels] = useState([]); // lower-third channels (for the mode switcher)

  const load = useCallback(() => { window.cue.graphics.list().then(setGraphics); }, []);
  useEffect(() => { load(); }, [load]);

  const loadChannels = useCallback(() => {
    window.cue.output.channels.list().then((chs) => setLtChannels(chs.filter((c) => c.template === 'lowerthird')));
  }, []);
  useEffect(() => { loadChannels(); }, [loadChannels]);

  async function setChannelModeFor(ch, mode) {
    await window.cue.output.channels.update(ch.id, modeToFlags(mode));
    loadChannels();
  }

  useEffect(() => {
    window.cue.output.overlay?.get?.().then((o) => { if (o) setOverlay(o); });
    const off = window.cue.on('output:overlay-changed', (o) => setOverlay(o));
    return off;
  }, []);

  const tickerLive = !!overlay.ticker;
  const anyLive = !!(overlay.nameTitle || overlay.ticker || overlay.custom);

  // Resolve the destination for a fire: live override wins, else the graphic default
  // (graphics default to Online/NDI).
  const resolveTarget = (g) => (dest === 'default' ? (g?.target || 'ndi') : dest);
  const quickTarget = () => (dest === 'default' ? 'ndi' : dest);

  async function remove(g) {
    if (!confirm(`Delete "${g.label || g.name || g.text || 'graphic'}"?`)) return;
    await window.cue.graphics.delete(g.id);
    load();
  }
  function clearAll() {
    window.cue.output.graphic.hide();
    window.cue.output.ticker.hide();
    window.cue.output.graphic.hideCustom();
  }

  function take(g) {
    const target = resolveTarget(g);
    const style = parseStyle(g);
    if (g.kind === 'lower_third') window.cue.output.graphic.show({ name: g.name, title: g.title, style, target });
    else if (g.kind === 'ticker') window.cue.output.ticker.show({ text: g.text, speed: g.speed, style, target });
    else if (g.kind === 'custom') window.cue.output.graphic.showCustom({ html: fillPlaceholders(g.html, g), target });
  }
  function clear(g) {
    if (g.kind === 'lower_third') window.cue.output.graphic.hide();
    else if (g.kind === 'ticker') window.cue.output.ticker.hide();
    else if (g.kind === 'custom') window.cue.output.graphic.hideCustom();
  }
  function isLive(g) {
    if (g.kind === 'lower_third') return ntEqual(overlay.nameTitle, g);
    if (g.kind === 'ticker') return tickerLive && overlay.ticker?.text === g.text;
    if (g.kind === 'custom') return !!overlay.custom && overlay.custom.html === fillPlaceholders(g.html, g);
    return false;
  }

  function fireQuickTicker() {
    if (!quickTicker.trim()) return;
    window.cue.output.ticker.show({ text: quickTicker, speed: 100, target: quickTarget() });
  }

  const groups = [
    { key: 'lower_third', title: 'Name / Title Cards' },
    { key: 'custom',      title: 'Custom HTML' },
    { key: 'ticker',      title: 'Tickers' },
  ];

  return (
    <div className="flex flex-col h-full bg-surface-container-low min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-sm px-md h-11 border-b border-outline-variant/30 shrink-0">
        <span className="material-symbols-outlined text-[18px] text-primary">branding_watermark</span>
        <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Broadcast Graphics</span>

        {/* Live destination override */}
        <div className="ml-md flex items-center gap-[2px] bg-surface-container rounded-lg p-[3px]" title="Where graphics are sent — In-Room = screens, Online = NDI">
          <span className="material-symbols-outlined text-[14px] text-on-surface-variant/50 ml-1">send</span>
          {DEST_OPTS.map((d) => (
            <button key={d.id} onClick={() => setDest(d.id)}
              className={`flex items-center gap-xs px-sm py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] transition-colors cursor-pointer ${
                dest === d.id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'
              }`}>
              <span className="material-symbols-outlined text-[13px]">{d.icon}</span>{d.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-sm">
          {anyLive && (
            <button onClick={clearAll}
              className="flex items-center gap-xs px-md py-xs rounded text-label-sm font-label-sm uppercase tracking-[0.05em] bg-surface-container-high border border-secondary/50 text-secondary hover:bg-surface-variant cursor-pointer">
              <span className="material-symbols-outlined text-[14px]">block</span> Clear All
            </button>
          )}
          <button onClick={() => setEditor({})}
            className="flex items-center gap-xs px-md py-xs rounded text-label-sm font-label-sm bg-primary text-on-primary font-bold hover:brightness-110 cursor-pointer">
            <span className="material-symbols-outlined text-[14px]">add</span> New Graphic
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-md flex flex-col gap-md min-h-0">
        {/* Channel mode switcher — flip a lower-third channel between lyrics/graphics
            live, without diving into Settings. */}
        {ltChannels.length > 0 && (
          <div className="bg-surface-container rounded-lg border border-outline-variant/30 p-md flex flex-col gap-sm">
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">tune</span>
              <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Lower-Third Channels</span>
              <span className="text-[10px] font-mono text-on-surface-variant/50 normal-case tracking-normal">switch what each channel shows</span>
            </div>
            <div className="flex flex-col gap-xs">
              {ltChannels.map((ch) => (
                <div key={ch.id} className="flex items-center gap-sm">
                  <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${ch.active ? 'bg-tertiary' : 'bg-outline-variant'}`} />
                  <span className="text-body-md text-on-surface truncate flex-1 min-w-0">{ch.name}</span>
                  {ch.type === 'ndi' && (
                    <span className="shrink-0 text-[9px] font-label-sm uppercase tracking-[0.04em] px-xs py-[1px] rounded border border-tertiary/50 text-tertiary bg-tertiary/10">NDI</span>
                  )}
                  <div className="flex items-center gap-[2px] bg-surface-container-lowest rounded p-[2px] shrink-0">
                    {CHANNEL_MODES.map((m) => {
                      const active = channelMode(ch) === m.id;
                      return (
                        <button key={m.id} onClick={() => setChannelModeFor(ch, m.id)} title={m.label}
                          className={`flex items-center gap-xs px-sm py-[2px] rounded text-[10px] font-label-sm uppercase tracking-[0.04em] transition-colors cursor-pointer ${
                            active ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant hover:text-on-surface'
                          }`}>
                          <span className="material-symbols-outlined text-[12px]">{m.icon}</span>
                          {m.short}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick ticker — fire an ad-hoc announcement without saving */}
        <div className="bg-surface-container rounded-lg border border-outline-variant/30 p-md flex flex-col gap-sm">
          <div className="flex items-center justify-between">
            <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Quick Ticker</span>
            {tickerLive && (
              <span className="flex items-center gap-xs text-label-sm font-label-sm uppercase tracking-[0.05em] text-secondary">
                <span className="w-[6px] h-[6px] rounded-full bg-secondary dot-pulse" /> On Air
              </span>
            )}
          </div>
          <div className="flex items-center gap-sm">
            <input
              value={quickTicker}
              onChange={(e) => setQuickTicker(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fireQuickTicker(); }}
              placeholder="Type an announcement and press Start…"
              className="flex-1 bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-1.5 text-body-md text-on-surface focus:outline-none focus:border-primary"
            />
            <button onClick={fireQuickTicker} disabled={!quickTicker.trim()}
              className="px-md py-1.5 rounded-lg text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold bg-tertiary-container text-on-tertiary hover:brightness-110 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Start</button>
            <button onClick={() => window.cue.output.ticker.hide()} disabled={!tickerLive}
              className="px-md py-1.5 rounded-lg text-label-sm font-label-sm uppercase tracking-[0.05em] bg-surface-container-high border border-secondary/50 text-secondary hover:bg-surface-variant cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Stop</button>
          </div>
        </div>

        {groups.map(({ key, title }) => {
          const items = graphics.filter((g) => g.kind === key);
          if (!items.length) return null;
          return (
            <div key={key} className="flex flex-col gap-sm">
              <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline px-xs">{title}</span>
              <div className="grid gap-md" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(248px, 1fr))' }}>
                {items.map((g) => (
                  <GraphicCard key={g.id} g={g} live={isLive(g)} destLabel={TARGET_LABEL[resolveTarget(g)]}
                    onTake={() => take(g)} onClear={() => clear(g)}
                    onEdit={() => setEditor(g)} onDelete={() => remove(g)} />
                ))}
              </div>
            </div>
          );
        })}

        {graphics.length === 0 && (
          <div className="flex flex-col items-center justify-center py-xl gap-sm text-outline-variant">
            <span className="material-symbols-outlined text-4xl">branding_watermark</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">No graphics yet</span>
            <button onClick={() => setEditor({})} className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-primary hover:underline cursor-pointer">Create one</button>
          </div>
        )}
      </div>

      {editor && (
        <GraphicsEditor
          graphic={editor.id ? editor : null}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Card with live thumbnail ─────────────────────────────────────────────────

function GraphicCard({ g, live, destLabel, onTake, onClear, onEdit, onDelete }) {
  const primaryText = g.kind === 'ticker' ? g.text : (g.name || g.label || '—');
  const subText = g.kind === 'lower_third' ? g.title : g.kind === 'custom' ? (g.label || 'Custom HTML') : null;
  const takeLabel = g.kind === 'ticker' ? 'Start' : 'Take';
  const clearLabel = g.kind === 'ticker' ? 'Stop' : 'Clear';

  return (
    <div className={`group flex flex-col rounded-lg border overflow-hidden transition-colors ${
      live ? 'border-secondary/60 bg-secondary/5' : 'border-outline-variant/30 bg-surface-container hover:border-outline-variant/60'
    }`}>
      {/* Thumbnail */}
      <div className="relative">
        <GraphicThumb g={g} />
        {live && (
          <span className="absolute top-1.5 left-1.5 flex items-center gap-xs px-sm py-[2px] rounded bg-secondary text-on-secondary text-[9px] font-label-sm uppercase tracking-[0.08em] font-bold">
            <span className="w-[5px] h-[5px] rounded-full bg-on-secondary dot-pulse" /> Live
          </span>
        )}
        <span className="absolute top-1.5 right-1.5 px-sm py-[2px] rounded bg-background/70 text-on-surface-variant text-[9px] font-label-sm uppercase tracking-[0.06em]">{destLabel}</span>
        {/* Hover actions */}
        <div className="absolute bottom-1.5 right-1.5 flex items-center gap-xs opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} title="Edit" className="w-6 h-6 flex items-center justify-center rounded bg-background/70 text-on-surface-variant hover:text-primary cursor-pointer">
            <span className="material-symbols-outlined text-[15px]">edit</span>
          </button>
          <button onClick={onDelete} title="Delete" className="w-6 h-6 flex items-center justify-center rounded bg-background/70 text-on-surface-variant hover:text-error cursor-pointer">
            <span className="material-symbols-outlined text-[15px]">delete</span>
          </button>
        </div>
      </div>

      {/* Meta + action */}
      <div className="flex items-center gap-sm px-sm py-sm">
        <div className="flex-1 min-w-0">
          <div className="text-body-md text-on-surface font-medium truncate">{primaryText}</div>
          {subText && <div className="text-label-sm font-label-sm text-on-surface-variant truncate normal-case tracking-normal">{subText}</div>}
        </div>
        {live ? (
          <button onClick={onClear} className="px-md py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] bg-surface-container-high border border-secondary/50 text-secondary hover:bg-surface-variant cursor-pointer shrink-0">{clearLabel}</button>
        ) : (
          <button onClick={onTake} className="px-md py-1.5 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] font-bold bg-primary text-on-primary hover:brightness-110 cursor-pointer shrink-0">{takeLabel}</button>
        )}
      </div>
    </div>
  );
}

// Scaled 1920×1080 thumbnail rendered with the same style helpers as the output.
function GraphicThumb({ g }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.13);
  useEffect(() => {
    if (!wrapRef.current) return;
    const update = () => { if (wrapRef.current) setScale(wrapRef.current.offsetWidth / FRAME_W); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const st = parseStyle(g);

  let inner = null;
  if (g.kind === 'lower_third') {
    const box = (st.name && st.name.textBox) || DEFAULT_BOX;
    const vAlign = (st.name && st.name.verticalAlign) || 'bottom';
    inner = (
      <div style={{
        position: 'absolute', left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
        background: buildBarBg(st.name?.ltBar), padding: '12px 32px', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        justifyContent: vAlign === 'top' ? 'flex-start' : vAlign === 'center' ? 'center' : 'flex-end',
      }}>
        <div style={flatTextCss(st.name, NAME_BASE)}>{g.name || 'Name'}</div>
        {g.title && <div style={{ ...flatTextCss(st.title, TITLE_BASE), marginTop: 4 }}>{g.title}</div>}
      </div>
    );
  } else if (g.kind === 'ticker') {
    const top = st.position === 'top';
    const barBg = st.bar ? buildBarBg({ color: st.bar.color, opacity: st.bar.opacity, solid: true }) : 'rgba(12,14,18,0.9)';
    inner = (
      <div style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 0, height: 72, background: barBg,
        borderTop: top ? 'none' : '3px solid #4d8eff', borderBottom: top ? '3px solid #4d8eff' : 'none',
        display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        <div style={{ ...flatTextCss(st, { fontSize: 30, color: '#fff', fontWeight: 500 }), whiteSpace: 'nowrap', paddingLeft: 40, lineHeight: '72px', textAlign: 'left' }}>
          {g.text}
        </div>
      </div>
    );
  } else {
    // Custom — small isolated iframe
    inner = (
      <iframe title="thumb" sandbox="allow-same-origin" style={{ width: FRAME_W, height: FRAME_H, border: 0, background: 'transparent' }}
        srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:Inter,system-ui,sans-serif}.cue-root{position:absolute;inset:0}</style></head><body><div class="cue-root cue-in">${fillPlaceholders(g.html, g)}</div></body></html>`} />
    );
  }

  return (
    <div ref={wrapRef} className="w-full aspect-video relative overflow-hidden border-b border-outline-variant/20"
      style={{ backgroundImage: 'repeating-conic-gradient(#16181c 0% 25%, #1d2024 0% 50%)', backgroundSize: '20px 20px' }}>
      <div style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', inset: 0 }}>
        {inner}
      </div>
    </div>
  );
}
