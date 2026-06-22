import React, { useState, useEffect, useCallback, useRef } from 'react';
import GraphicsEditor, { GraphicsPresetModal, presetToGraphic, fillPlaceholders, flatTextCss, buildBarBg, cdSampleText, CD_DEFAULT_BOX, TIME_BASE, MSG_BASE } from '../components/GraphicsEditor';
import { CHANNEL_MODES, channelMode, modeToFlags } from '../utils/channelMode';

const FRAME_W = 1920, FRAME_H = 1080;
const DEFAULT_BOX = { x: 4, y: 70, w: 55, h: 22 };
const NAME_BASE  = { fontSize: 54, color: '#ffffff', fontWeight: 700 };
const TITLE_BASE = { fontSize: 28, color: '#adc6ff', fontWeight: 500 };

function parseStyle(g) {
  try { return g.style_json ? (typeof g.style_json === 'string' ? JSON.parse(g.style_json) : g.style_json) : {}; }
  catch { return {}; }
}

// Destination override — a toggleable SET of kinds. Empty set = "Default" (use each
// graphic's saved target). Any combination is allowed (e.g. Online + Stream).
const DEST_KINDS = ['screen', 'ndi', 'stream'];
const KIND_OPTS = [
  { id: 'screen', label: 'In-Room', icon: 'monitor' },
  { id: 'ndi',    label: 'Online',  icon: 'lan' },
  { id: 'stream', label: 'Stream',  icon: 'live_tv' },
];
const TARGET_LABEL = { all: 'All', screen: 'In-Room', ndi: 'Online', stream: 'Stream' };
// Collapse a kind set to a fire target: empty → fall back; all three → 'all'; one →
// the string; otherwise the array of kinds (the overlay bus accepts kind arrays).
const destToTarget = (dest, fallback) =>
  dest.length === 0 ? fallback
  : dest.length === DEST_KINDS.length ? 'all'
  : dest.length === 1 ? dest[0]
  : [...dest];

// Each overlay slot holds one occupant per destination kind: { screen, ndi, stream }.
const SLOT_BY_KIND = { lower_third: 'nameTitle', ticker: 'ticker', countdown: 'countdown', custom: 'custom' };
const EMPTY_KIND_SLOT = { screen: null, ndi: null, stream: null };
const EMPTY_OVERLAY = { nameTitle: { ...EMPTY_KIND_SLOT }, ticker: { ...EMPTY_KIND_SLOT }, custom: { ...EMPTY_KIND_SLOT }, countdown: { ...EMPTY_KIND_SLOT } };
const slotAnyLive = (slot) => !!(slot && (slot.screen || slot.ndi || slot.stream));

export default function GraphicsPanel() {
  const [graphics, setGraphics] = useState([]);
  const [overlay, setOverlay] = useState(EMPTY_OVERLAY);
  const [editor, setEditor] = useState(null); // {} = new, graphic obj = edit, null = closed
  const [gallery, setGallery] = useState(false); // design gallery open
  const [quickTicker, setQuickTicker] = useState('');
  const [quickStyleId, setQuickStyleId] = useState(null); // saved ticker whose style the quick ticker borrows (null = plain default)
  const [quickDismiss, setQuickDismiss] = useState(0); // auto-dismiss seconds for the quick ticker (0 = sticky)
  const [dest, setDest] = useState([]); // live destination override (kind set; [] = default)
  const toggleDest = (id) => setDest((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
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

  // Pick a design from the gallery → create a graphic of that kind (seeded with the
  // design's style + sample content), add it to the tab, and open it for editing.
  async function addFromDesign(preset) {
    const id = await window.cue.graphics.create(presetToGraphic(preset));
    setGallery(false);
    load();
    const g = await window.cue.graphics.get(id);
    if (g) setEditor(g);
  }

  useEffect(() => {
    window.cue.output.overlay?.get?.().then((o) => { if (o) setOverlay(o); });
    const off = window.cue.on('output:overlay-changed', (o) => setOverlay(o));
    return off;
  }, []);

  const tickerLive = slotAnyLive(overlay.ticker);
  const anyLive = slotAnyLive(overlay.nameTitle) || slotAnyLive(overlay.ticker) || slotAnyLive(overlay.custom) || slotAnyLive(overlay.countdown);

  // Resolve the destination for a fire: live override (kind set) wins, else the
  // graphic default (graphics default to Online/NDI).
  const resolveTarget = (g) => destToTarget(dest, g?.target || 'ndi');
  const quickTarget = () => destToTarget(dest, 'ndi');

  async function remove(g) {
    if (!confirm(`Delete "${g.label || g.name || g.text || 'graphic'}"?`)) return;
    await window.cue.graphics.delete(g.id);
    load();
  }
  function clearAll() {
    window.cue.output.graphic.hide();
    window.cue.output.ticker.hide();
    window.cue.output.countdown.hide();
    window.cue.output.graphic.hideCustom();
  }

  function take(g) {
    const target = resolveTarget(g);
    const style = parseStyle(g);
    const autoDismissSec = Number(style.autoDismissSec) || 0;
    if (g.kind === 'lower_third') window.cue.output.graphic.show({ id: g.id, name: g.name, title: g.title, style, target, autoDismissSec });
    else if (g.kind === 'ticker') window.cue.output.ticker.show({ id: g.id, text: g.text, speed: g.speed, style, target, autoDismissSec });
    else if (g.kind === 'countdown') window.cue.output.countdown.show({
      id: g.id, mode: style.mode, source: style.source, durationSec: style.durationSec,
      targetClock: style.targetClock, format: style.format, showSeconds: style.showSeconds,
      label: g.text || '', endMessage: style.endMessage || '',
      style: { time: style.time, message: style.message }, target,
    });
    else if (g.kind === 'custom') window.cue.output.graphic.showCustom({ id: g.id, html: fillPlaceholders(g.html, g), target, autoDismissSec });
  }
  // Which destination kinds this saved graphic is currently live on (match by id,
  // not content — otherwise two graphics sharing a body would both light up). Ad-hoc
  // fires (e.g. the quick ticker) carry no id, so no saved card falsely matches.
  function liveDests(g) {
    const slot = overlay[SLOT_BY_KIND[g.kind]];
    if (!slot) return [];
    return DEST_KINDS.filter((k) => slot[k] && slot[k].id === g.id);
  }
  const isLive = (g) => liveDests(g).length > 0;
  // Soonest auto-dismiss anchor (absolute ms) across the kinds this graphic is live on,
  // or null if it has no timer. Drives the card's ticking "auto · Ns" badge.
  function liveDismissAt(g) {
    const slot = overlay[SLOT_BY_KIND[g.kind]];
    if (!slot) return null;
    const ats = DEST_KINDS
      .filter((k) => slot[k] && slot[k].id === g.id && slot[k].dismissAt)
      .map((k) => slot[k].dismissAt);
    return ats.length ? Math.min(...ats) : null;
  }

  function clear(g) {
    const dests = liveDests(g);
    const target = destToTarget(dests, dests[0]); // all kinds → 'all', one → string, else array
    if (g.kind === 'lower_third') window.cue.output.graphic.hide(target);
    else if (g.kind === 'ticker') window.cue.output.ticker.hide(target);
    else if (g.kind === 'countdown') window.cue.output.countdown.hide(target);
    else if (g.kind === 'custom') window.cue.output.graphic.hideCustom(target);
  }

  // Saved tickers the quick ticker can borrow a look from.
  const tickerStyles = graphics.filter((g) => g.kind === 'ticker');

  function fireQuickTicker() {
    if (!quickTicker.trim()) return;
    const base = quickStyleId != null ? tickerStyles.find((g) => g.id === quickStyleId) : null;
    window.cue.output.ticker.show({
      text: quickTicker,
      speed: base?.speed ?? 100,
      style: base ? parseStyle(base) : undefined,
      target: quickTarget(),
      autoDismissSec: Number(quickDismiss) || 0,
    });
  }

  const groups = [
    { key: 'lower_third', title: 'Name / Title Cards' },
    { key: 'countdown',   title: 'Countdowns & Clocks' },
    { key: 'custom',      title: 'Custom HTML' },
    { key: 'ticker',      title: 'Tickers' },
  ];

  return (
    <div className="flex flex-col h-full bg-surface-container-low min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-sm px-md h-11 border-b border-outline-variant/30 shrink-0">
        <span className="material-symbols-outlined text-[18px] text-primary">branding_watermark</span>
        <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Broadcast Graphics</span>

        {/* Live destination override — Default, or any combination of kinds */}
        <div className="ml-md flex items-center gap-[2px] bg-surface-container rounded-lg p-[3px]" title="Where graphics are sent — In-Room = screens, Online = NDI, Stream = the broadcast composite. Combine any.">
          <span className="material-symbols-outlined text-[14px] text-on-surface-variant/50 ml-1">send</span>
          <button onClick={() => setDest([])}
            className={`flex items-center gap-xs px-sm py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] transition-colors cursor-pointer ${
              dest.length === 0 ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'
            }`}>
            <span className="material-symbols-outlined text-[13px]">tune</span>Default
          </button>
          {KIND_OPTS.map((d) => (
            <button key={d.id} onClick={() => toggleDest(d.id)}
              className={`flex items-center gap-xs px-sm py-1 rounded text-label-sm font-label-sm uppercase tracking-[0.05em] transition-colors cursor-pointer ${
                dest.includes(d.id) ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'
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
          <button onClick={() => setGallery(true)}
            className="flex items-center gap-xs px-md py-xs rounded text-label-sm font-label-sm bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:text-on-surface cursor-pointer">
            <span className="material-symbols-outlined text-[14px]">grid_view</span> Designs
          </button>
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
          <div className="flex items-center justify-between gap-sm">
            <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant shrink-0">Quick Ticker</span>
            <div className="flex items-center gap-sm">
              {/* Borrow the look of a saved ticker design (or a plain default) */}
              <label className="flex items-center gap-xs text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-[0.05em]">
                Style
                <select
                  value={quickStyleId ?? ''}
                  onChange={(e) => setQuickStyleId(e.target.value ? Number(e.target.value) : null)}
                  className="bg-surface-container-lowest border border-outline-variant/40 rounded px-xs h-7 text-body-md text-on-surface focus:outline-none focus:border-primary cursor-pointer max-w-[160px]"
                >
                  <option value="">Default</option>
                  {tickerStyles.map((g) => (
                    <option key={g.id} value={g.id}>{g.label || g.text || `Ticker ${g.id}`}</option>
                  ))}
                </select>
              </label>
              {/* Optional auto-dismiss — hides the ticker N seconds after it airs (0 = sticky) */}
              <label className="flex items-center gap-xs text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-[0.05em]" title="Auto-hide this ticker after N seconds (0 = stay until cleared)">
                <span className="material-symbols-outlined text-[13px]">timer</span>
                <input type="number" min="0" max="3600" value={quickDismiss || ''} placeholder="0"
                  onChange={(e) => setQuickDismiss(Math.max(0, Number(e.target.value) || 0))}
                  className="w-12 bg-surface-container-lowest border border-outline-variant/40 rounded px-xs h-7 text-body-md text-on-surface text-center tabular-nums focus:outline-none focus:border-primary" />
                <span className="normal-case tracking-normal">sec</span>
              </label>
              {tickerLive && (
                <span className="flex items-center gap-xs text-label-sm font-label-sm uppercase tracking-[0.05em] text-secondary shrink-0">
                  <span className="w-[6px] h-[6px] rounded-full bg-secondary dot-pulse" /> On Air
                </span>
              )}
            </div>
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
            <button onClick={() => window.cue.output.ticker.hide(quickTarget())} disabled={!tickerLive}
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
                  <GraphicCard key={g.id} g={g} liveOn={liveDests(g)} dismissAt={liveDismissAt(g)} destLabel={(() => { const t = resolveTarget(g); return Array.isArray(t) ? t.map((k) => TARGET_LABEL[k]).join(' + ') : TARGET_LABEL[t]; })()}
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

      {gallery && (
        <GraphicsPresetModal onPick={addFromDesign} onClose={() => setGallery(false)} />
      )}
    </div>
  );
}

// ── Card with live thumbnail ─────────────────────────────────────────────────

// Seconds remaining until `dismissAt` (absolute ms), ticking locally for display only —
// the authoritative hide runs in main. null when there's no timer or it has elapsed.
function useDismissCountdown(dismissAt) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!dismissAt) return;
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [dismissAt]);
  if (!dismissAt) return null;
  const secs = Math.ceil((dismissAt - Date.now()) / 1000);
  return secs > 0 ? secs : null;
}

function GraphicCard({ g, liveOn = [], dismissAt = null, destLabel, onTake, onClear, onEdit, onDelete }) {
  const live = liveOn.length > 0;
  const dismissIn = useDismissCountdown(dismissAt);
  // Where it's live: multiple kinds → "Live", else name the single destination.
  const liveLabel = liveOn.length > 1 ? 'Live' : `Live · ${TARGET_LABEL[liveOn[0]] || ''}`;
  const cdSt = g.kind === 'countdown' ? parseStyle(g) : null;
  const cdModeLabel = cdSt ? (cdSt.mode === 'clock' ? 'Clock' : cdSt.mode === 'countup' ? 'Count Up' : 'Countdown') : '';
  const primaryText = g.kind === 'ticker' ? g.text
    : g.kind === 'countdown' ? (g.label || g.text || cdModeLabel)
    : (g.name || g.label || '—');
  const subText = g.kind === 'lower_third' ? g.title
    : g.kind === 'countdown' ? cdModeLabel
    : g.kind === 'custom' ? (g.label || 'Custom HTML') : null;
  const isTimer = g.kind === 'ticker' || g.kind === 'countdown';
  const takeLabel = isTimer ? 'Start' : 'Take';
  const clearLabel = isTimer ? 'Stop' : 'Clear';

  return (
    <div className={`group flex flex-col rounded-lg border overflow-hidden transition-colors ${
      live ? 'border-secondary/60 bg-secondary/5' : 'border-outline-variant/30 bg-surface-container hover:border-outline-variant/60'
    }`}>
      {/* Thumbnail */}
      <div className="relative">
        <GraphicThumb g={g} />
        {live && (
          <span className="absolute top-1.5 left-1.5 flex flex-col items-start gap-[3px]">
            <span className="flex items-center gap-xs px-sm py-[2px] rounded bg-secondary text-on-secondary text-[9px] font-label-sm uppercase tracking-[0.08em] font-bold">
              <span className="w-[5px] h-[5px] rounded-full bg-on-secondary dot-pulse" /> {liveLabel}
            </span>
            {dismissIn != null && (
              <span className="flex items-center gap-xs px-sm py-[1px] rounded bg-background/75 text-on-surface-variant text-[9px] font-label-sm uppercase tracking-[0.06em] tabular-nums" title="Auto-dismisses">
                <span className="material-symbols-outlined text-[11px]">timer</span>{dismissIn}s
              </span>
            )}
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

  // Ticker crawl: measure the text + animate horizontally like the live output
  // (keyframes `cue-ticker-crawl` in index.css). Hooks run unconditionally; the
  // effect no-ops for non-ticker graphics.
  const tkInnerRef = useRef(null);
  const [tkDur, setTkDur] = useState(20);
  useEffect(() => {
    if (g.kind !== 'ticker') return;
    const el = tkInnerRef.current;
    if (!el) return;
    const spd = Math.max(20, Number(g.speed) || 100);
    setTkDur(el.scrollWidth / spd);
  }, [g.kind, g.text, g.style_json, g.speed]);

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
        <div ref={tkInnerRef} style={{ ...flatTextCss(st, { fontSize: 30, color: '#fff', fontWeight: 500 }), whiteSpace: 'nowrap',
          flexShrink: 0, paddingLeft: '100%', lineHeight: '72px', textAlign: 'left', willChange: 'transform',
          animation: `cue-ticker-crawl ${tkDur}s linear infinite` }}>
          {g.text}
        </div>
      </div>
    );
  } else if (g.kind === 'countdown') {
    const box = st.time?.textBox || CD_DEFAULT_BOX;
    const vAlign = st.time?.verticalAlign || 'center';
    const hAlign = st.time?.align === 'left' ? 'flex-start' : st.time?.align === 'right' ? 'flex-end' : 'center';
    inner = (
      <div style={{
        position: 'absolute', left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
        background: buildBarBg(st.time?.ltBar), padding: '16px 32px', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        justifyContent: vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center',
        alignItems: hAlign,
      }}>
        {g.text && <div style={flatTextCss(st.message, MSG_BASE)}>{g.text}</div>}
        <div style={{ ...flatTextCss(st.time, TIME_BASE), whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{cdSampleText(st)}</div>
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
