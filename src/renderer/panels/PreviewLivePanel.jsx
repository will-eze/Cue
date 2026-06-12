import React, { useState, useEffect, useRef } from 'react';
import SlideList from '../components/SlideList';
import { renderWithRuns, copyrightCss } from '../components/SongEditor';
import { flatTextCss, buildBarBg as buildGraphicBarBg, fmtDuration as fmtGfxDuration, fmtClock as fmtGfxClock, CD_DEFAULT_BOX, TIME_BASE as GFX_TIME_BASE, MSG_BASE as GFX_MSG_BASE } from '../components/GraphicsEditor';
import { mediaUrl } from '../utils/mediaUrl';

const GFX_BOX_DEFAULT = { x: 4, y: 70, w: 55, h: 22 };
const GFX_NAME_BASE  = { fontSize: 54, color: '#ffffff', fontWeight: 700 };
const GFX_TITLE_BASE = { fontSize: 28, color: '#adc6ff', fontWeight: 500 };

// Self-ticking countdown/clock for the live monitor — mirrors graphics-overlay.js.
// The bus carries the resolved anchor (endsAt/startAt); we recompute from Date.now().
function OverlayCountdown({ cd }) {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  const st  = (cd.style && cd.style.time)    || {};
  const mst = (cd.style && cd.style.message) || {};
  const box = st.textBox || CD_DEFAULT_BOX;
  const vAlign = st.verticalAlign || 'center';
  const hAlign = st.align === 'left' ? 'flex-start' : st.align === 'right' ? 'flex-end' : 'center';

  let timeText, msgText = cd.label || '';
  if (cd.mode === 'clock') timeText = fmtGfxClock(new Date(), cd.format, cd.showSeconds);
  else if (cd.mode === 'countup') timeText = fmtGfxDuration((Date.now() - cd.startAt) / 1000);
  else {
    const rem = (cd.endsAt - Date.now()) / 1000;
    if (rem <= 0) { timeText = cd.endMessage ? '' : '0:00'; if (cd.endMessage) msgText = cd.endMessage; }
    else timeText = fmtGfxDuration(rem);
  }

  return (
    <div style={{
      position: 'absolute', left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
      background: buildGraphicBarBg(st.ltBar), padding: '16px 32px', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      justifyContent: vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center',
      alignItems: hAlign,
    }}>
      {msgText && <div style={flatTextCss(mst, GFX_MSG_BASE)}>{msgText}</div>}
      <div style={{ ...flatTextCss(st, GFX_TIME_BASE), whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{timeText}</div>
    </div>
  );
}

// Renders the live broadcast-graphics overlay (name/title bug, ticker, custom HTML)
// on top of a lower-third live monitor — mirrors output/lowerthird.js exactly.
function GraphicsOverlayLayer({ overlay }) {
  if (!overlay) return null;
  const nt = overlay.nameTitle, tk = overlay.ticker, cu = overlay.custom, cd = overlay.countdown;
  if (!nt && !tk && !cu && !cd) return null;

  let bug = null;
  if (nt) {
    const st = nt.style || {};
    const box = (st.name && st.name.textBox) || GFX_BOX_DEFAULT;
    const vAlign = (st.name && st.name.verticalAlign) || 'bottom';
    bug = (
      <div style={{
        position: 'absolute', left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
        background: buildGraphicBarBg(st.name?.ltBar), padding: '12px 32px', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        justifyContent: vAlign === 'top' ? 'flex-start' : vAlign === 'center' ? 'center' : 'flex-end',
      }}>
        <div style={flatTextCss(st.name, GFX_NAME_BASE)}>{nt.name || ''}</div>
        {nt.title && <div style={{ ...flatTextCss(st.title, GFX_TITLE_BASE), marginTop: 4 }}>{nt.title}</div>}
      </div>
    );
  }

  let ticker = null;
  if (tk) {
    const st = tk.style || {};
    const top = st.position === 'top';
    const barBg = st.bar ? buildGraphicBarBg({ color: st.bar.color, opacity: st.bar.opacity, solid: true }) : 'rgba(12,14,18,0.9)';
    ticker = (
      <div style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 0, height: 72, background: barBg,
        borderTop: top ? 'none' : '3px solid #4d8eff', borderBottom: top ? '3px solid #4d8eff' : 'none',
        display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        <div style={{ ...flatTextCss(st, { fontSize: 30, color: '#fff', fontWeight: 500 }), whiteSpace: 'nowrap', paddingLeft: 40, lineHeight: '72px', textAlign: 'left' }}>
          {tk.text}
        </div>
      </div>
    );
  }

  return (
    <>
      {bug}
      {ticker}
      {cd && cd.mode && <OverlayCountdown cd={cd} />}
      {cu && (
        <iframe title="overlay-custom" sandbox="allow-same-origin"
          style={{ position: 'absolute', inset: 0, width: NATIVE_W, height: NATIVE_H, border: 0, background: 'transparent' }}
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:Inter,system-ui,sans-serif}.cue-root{position:absolute;inset:0}</style></head><body><div class="cue-root cue-in">${cu.html}</div></body></html>`} />
      )}
    </>
  );
}

function buildBarBg(ltBar) {
  if (!ltBar) return 'transparent';
  const c  = ltBar.color   ?? '#000000';
  const op = ltBar.opacity ?? 0.8;
  const r  = parseInt(c.slice(1, 3), 16) || 0;
  const g  = parseInt(c.slice(3, 5), 16) || 0;
  const b  = parseInt(c.slice(5, 7), 16) || 0;
  if (ltBar.solid) return `rgba(${r},${g},${b},${op})`;
  return `linear-gradient(to top, rgba(${r},${g},${b},${op}) 0%, rgba(${r},${g},${b},${(op * 0.7).toFixed(2)}) 70%, transparent 100%)`;
}

const NATIVE_W = 1920;
const NATIVE_H = 1080;

// Position (seconds) derived from the shared transport — identical maths to the
// output players, so the operator UI agrees with every audience surface.
function transportPosition(t, duration) {
  if (!t || !t.active) return 0;
  const now = Date.now();
  const ref = (t.pausedAt != null) ? t.pausedAt : now;
  let pos = (ref - t.startAt) / 1000;
  if (pos < 0) pos = 0;
  if (duration > 0) pos = t.loop ? pos % duration : Math.min(pos, duration);
  return pos;
}

function fmtClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// Probes media duration without showing the element. Covers both video and audio.
function useMediaDuration(path, type) {
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    setDuration(0);
    if (!path || (type !== 'video' && type !== 'audio')) return;
    const el = document.createElement(type === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata';
    el.src = mediaUrl(path);
    const onMeta = () => { if (Number.isFinite(el.duration)) setDuration(el.duration); };
    el.addEventListener('loadedmetadata', onMeta);
    return () => { el.removeEventListener('loadedmetadata', onMeta); try { el.src = ''; } catch {} };
  }, [path, type]);
  return duration;
}

// Muted preview video locked to the shared transport — same wall-clock + smooth
// playbackRate convergence used by the output players. Always silent (the operator
// preview never carries program audio).
function SyncedVideo({ src, transport, loop, style }) {
  const ref = useRef(null);
  const transportRef = useRef(transport);
  transportRef.current = transport;
  const tickRef = useRef(() => {});

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    try { v.preservesPitch = true; } catch {}

    const computeExpected = () => {
      const t = transportRef.current;
      if (!t || !t.active) return null;
      const dur = v.duration;
      const now = Date.now();
      const r = (t.pausedAt != null) ? t.pausedAt : now;
      let pos = (r - t.startAt) / 1000;
      if (pos < 0) pos = 0;
      if (Number.isFinite(dur) && dur > 0) pos = loop ? pos % dur : Math.min(pos, dur);
      return pos;
    };

    const wrappedDelta = (cur, expected, dur) => {
      let d = cur - expected;
      if (loop && Number.isFinite(dur) && dur > 0) {
        if (d > dur / 2) d -= dur; else if (d < -dur / 2) d += dur;
      }
      return d;
    };

    const tick = () => {
      const t = transportRef.current;
      if (!t || !t.active) return;
      const expected = computeExpected();
      if (expected == null) return;
      const dur = v.duration;
      if (t.pausedAt != null) {
        if (!v.paused) v.pause();
        v.playbackRate = 1;
        if (Number.isFinite(expected) && Math.abs((v.currentTime || 0) - expected) > 0.05) {
          try { v.currentTime = expected; } catch {}
        }
        return;
      }
      if (v.paused) v.play().catch(() => {});
      const drift = wrappedDelta(v.currentTime || 0, expected, dur);
      if (Math.abs(drift) > 0.5) { try { v.currentTime = expected; } catch {} v.playbackRate = 1; }
      else { let rr = 1 - drift * 0.5; rr = Math.max(0.94, Math.min(1.06, rr)); v.playbackRate = rr; }
    };
    tickRef.current = tick;

    const onMeta = () => {
      const expected = computeExpected();
      if (expected != null && Number.isFinite(expected)) { try { v.currentTime = expected; } catch {} }
      tick();
    };
    v.addEventListener('loadedmetadata', onMeta, { once: true });
    if (v.readyState >= 1) onMeta();

    const id = setInterval(tick, 250);
    return () => { v.removeEventListener('loadedmetadata', onMeta); clearInterval(id); };
  }, [src, loop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Snap immediately on pause/play/seek instead of waiting for the next tick.
  useEffect(() => { tickRef.current(); }, [transport]);

  return <video ref={ref} src={src} loop={loop} style={style} muted playsInline />;
}

// Confidence-monitor layout — mirrors output/stage.html + stage.css at native
// 1920×1080 so it scales identically to the other monitor templates. Shows the
// top status bar (live clock + idle timer/video slots), the current slide text
// big on a dark background, the COMING NEXT row, and the message bar.
function StageMonitor({ slide, item, slides, slideIdx, copyrightText, copyrightRight, transport, hideText }) {
  const [clock, setClock] = useState('');
  useEffect(() => {
    const fmt = () => setClock(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
    fmt();
    const id = setInterval(fmt, 1000);
    return () => clearInterval(id);
  }, []);

  const barCol     = { flex: '1 1 0', minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 2%', gap: 8 };
  const barLabel   = { fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 13, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#424754' };
  const barValue   = { fontSize: 48, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' };
  const barDivider = { flexShrink: 0, width: 1, background: 'rgba(255,255,255,0.07)', margin: '2% 0' };

  const isMediaItem = item?.item_type === 'media';
  const mediaPath   = isMediaItem ? item?.asset?.path : null;
  const isVideo     = mediaPath && /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(mediaPath);
  const nextText    = slides[slideIdx + 1]?.content || '';
  const refText     = copyrightRight ? copyrightText : null; // scripture reference

  return (
    <div style={{ width: NATIVE_W, height: NATIVE_H, display: 'flex', flexDirection: 'column', background: '#111317', fontFamily: 'Inter, sans-serif', color: '#e2e2e8' }}>
      {/* Top status bar */}
      <div style={{ flex: '0 0 12%', minHeight: 0, background: '#1a1c20', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex' }}>
        <div style={barCol}>
          <div style={barLabel}>LOCAL TIME</div>
          <div style={{ ...barValue, color: '#adc6ff' }}>{clock}</div>
        </div>
        <div style={barDivider} />
        <div style={barCol}>
          <div style={barLabel}>REMAINING</div>
          <div style={{ ...barValue, color: '#2a2e38' }}>00:00</div>
        </div>
        <div style={barDivider} />
        <div style={barCol}>
          <div style={barLabel}>VIDEO</div>
          <div style={{ ...barValue, color: '#2a2e38' }}>--:--</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: '1 1 0', minHeight: 0, background: '#0c0e12', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'relative', flex: '1 1 0', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2.5% 6%', textAlign: 'center' }}>
          {isVideo ? (
            transport?.active
              ? <SyncedVideo src={mediaUrl(mediaPath)} transport={transport} loop={!!item?.media_loop} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
              : <video src={mediaUrl(mediaPath)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} autoPlay loop muted />
          ) : !hideText && (
            <>
              {refText && (
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '1.5% 6% 0', textAlign: 'center', fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 34, fontWeight: 600, letterSpacing: '0.04em', color: '#adc6ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {refText}
                </div>
              )}
              <div style={{ fontWeight: 700, lineHeight: 1.15, color: '#ffffff', whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'center', width: '100%', fontSize: 88, overflow: 'hidden' }}>
                {slide?.content || ''}
              </div>
            </>
          )}
        </div>
        <div style={{ flexShrink: 0, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ flex: '0 0 auto', maxHeight: '20%', overflow: 'hidden', display: 'flex', alignItems: 'baseline', gap: '1.5%', padding: '1.2% 6%' }}>
          <span style={{ flexShrink: 0, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 13, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#4d8eff', whiteSpace: 'nowrap' }}>COMING NEXT</span>
          <span style={{ fontSize: 26, fontWeight: 400, lineHeight: 1.3, color: 'rgba(255,255,255,0.4)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden' }}>{nextText || '—'}</span>
        </div>
      </div>

      {/* Bottom message bar */}
      <div style={{ flex: '0 0 10%', minHeight: 0, background: '#1a1c20', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', padding: '0 4%' }}>
        <div style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 14, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(140,144,159,0.25)' }}>NO MESSAGES</div>
      </div>
    </div>
  );
}

function MonitorFrame({ item, slideIdx, getSlides, emptyLabel, isLive, backgroundPath, displayMode, channelTemplate, transport, overlay, hideProgram }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    if (!wrapRef.current) return;
    const update = () => { if (wrapRef.current) setScale(wrapRef.current.offsetWidth / NATIVE_W); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const slides = getSlides(item ?? null);
  const slide  = item ? slides[slideIdx] : null;
  const style  = slide?.style_json ? JSON.parse(slide.style_json) : null;
  const isLT   = channelTemplate === 'lowerthird';
  const isStage = channelTemplate === 'stage';

  // Attribution line — scripture slides carry "Book c:v (VERSION)", songs use the
  // song copyright. Scripture sits bottom-right; everything else stays centred.
  const copyrightText  = slide ? (slide.copyright ?? item?.song?.copyright ?? null) : null;
  const copyrightRight = item?.item_type === 'scripture';
  const copyrightStyle = slide?._refStyle ?? null; // scripture reference style

  // The monitor renders the slide from the payload (no screen-capture). In the
  // live 'cleared' state the audience output keeps the background but hides the
  // text, so we mirror that by suppressing the text block. A graphics-only
  // lower-third channel (hideProgram) likewise never shows the song lyric band.
  const hideText = (isLive && displayMode === 'cleared') || hideProgram;

  // Match the output templates' default shadow exactly
  const shadow    = style?.textShadow;
  const shadowCss = shadow
    ? (shadow.enabled ? `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}` : 'none')
    : (isLT ? '0 2px 8px rgba(0,0,0,0.6)' : '0 2px 16px rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.6)');
  const stroke = style?.textStroke;

  // Text styles at native 1920×1080 resolution — no scaling needed, CSS transform handles it
  const textStyle = {
    fontFamily:       style?.fontFamily || undefined,
    fontSize:         (style?.fontSize ?? (isLT ? 48 : 72)) + 'px',
    textAlign:        style?.align || (isLT ? 'left' : 'center'),
    fontWeight:       style?.bold ? 700 : 400,
    fontStyle:        style?.italic ? 'italic' : 'normal',
    textDecoration:   style?.underline ? 'underline' : 'none',
    textTransform:    style?.uppercase ? 'uppercase' : 'none',
    color:            style?.color || '#ffffff',
    lineHeight:       style?.lineSpacing ? String(style.lineSpacing) : (isLT ? '1.2' : '1.25'),
    letterSpacing:    style?.letterSpacing ? `${style.letterSpacing}em` : undefined,
    textShadow:       shadowCss,
    WebkitTextStroke: (stroke?.enabled) ? `${stroke.width ?? 2}px ${stroke.color ?? '#000'}` : undefined,
    whiteSpace:       'pre-wrap',
    wordBreak:        'break-word',
    width:            '100%',
  };

  return (
    <div
      ref={wrapRef}
      className={`w-full aspect-video relative overflow-hidden rounded-lg shrink-0 bg-black ${
        isLive ? 'monitor-live' : item ? 'monitor-preview' : 'monitor-idle'
      }`}
    >
      {/* Scaled 1920×1080 canvas — pixel-accurate match of the output template */}
      {slide ? (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <div style={{ width: NATIVE_W, height: NATIVE_H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
                {isStage ? (
                  <StageMonitor
                    slide={slide}
                    item={item}
                    slides={slides}
                    slideIdx={slideIdx}
                    copyrightText={copyrightText}
                    copyrightRight={copyrightRight}
                    transport={transport}
                    hideText={hideText}
                  />
                ) : (
                <>
                {/* Background */}
                {isLT ? (
                  <div style={{
                    position: 'absolute', inset: 0,
                    backgroundImage: 'repeating-conic-gradient(#1a1a1a 0% 25%, #222 0% 50%)',
                    backgroundSize: '20px 20px',
                  }} />
                ) : backgroundPath && (
                  <div style={{ position: 'absolute', inset: 0 }}>
                    {/\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(backgroundPath)
                      ? (transport?.active
                        ? <SyncedVideo src={mediaUrl(backgroundPath)} transport={transport} loop={item?.item_type === 'media' && !!item?.media_loop} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <video src={mediaUrl(backgroundPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} autoPlay loop muted />)
                      : /\.(mp3|wav|aac|flac|ogg|m4a)$/i.test(backgroundPath)
                      ? <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 220, color: '#4ae176' }}>volume_up</span>
                        </div>
                      : <img src={mediaUrl(backgroundPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />}
                  </div>
                )}

                {/* Content */}
                {!hideText && (isLT ? (
                  // Lower third: bottom-anchored, matches lowerthird.html exactly
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    padding: '24px 60px 32px',
                    background: buildBarBg(style?.ltBar),
                    minHeight: 160,
                    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                  }}>
                    <p style={textStyle} dangerouslySetInnerHTML={{ __html: renderWithRuns(slide.content, style?.runs) }} />
                    {copyrightText && (
                      <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.7)', marginTop: 4, ...copyrightCss(copyrightStyle, copyrightRight ? 'right' : 'left', false), paddingLeft: undefined, paddingRight: undefined }}>
                        {copyrightText}
                      </div>
                    )}
                  </div>
                ) : (() => {
                  const tb = style?.textBox || { x: 5, y: 5, w: 90, h: 90 };
                  return (
                    <div style={{
                      position: 'absolute',
                      left: `${tb.x}%`, top: `${tb.y}%`,
                      width: `${tb.w}%`, height: `${tb.h}%`,
                      display: 'flex', flexDirection: 'column',
                      justifyContent: style?.verticalAlign === 'top'    ? 'flex-start'
                                    : style?.verticalAlign === 'bottom' ? 'flex-end'
                                    : 'center',
                      overflow: 'hidden',
                    }}>
                      <p style={textStyle} dangerouslySetInnerHTML={{ __html: renderWithRuns(slide.content, style?.runs) }} />
                    </div>
                  );
                })())}

                {/* Attribution / copyright — matches fullscreen.css #copyright */}
                {!hideText && !isLT && copyrightText && (
                  <div style={{
                    position: 'absolute', bottom: 40, left: 0, right: 0,
                    color: 'rgba(255,255,255,0.7)', fontSize: 20,
                    textShadow: '0 1px 6px rgba(0,0,0,0.8)', zIndex: 2,
                    ...copyrightCss(copyrightStyle, copyrightRight ? 'right' : 'center'),
                  }}>
                    {copyrightText}
                  </div>
                )}
                </>
                )}
          </div>
        </div>
      ) : (
        // No content selected
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-label-sm font-label-sm uppercase tracking-widest text-outline-variant">
            {emptyLabel}
          </span>
        </div>
      )}

      {/* Broadcast-graphics overlay — independent of the program slide; rides on top
          of any program output (fullscreen + lower-third), mirroring the real windows. */}
      {overlay && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ width: NATIVE_W, height: NATIVE_H, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative' }}>
            <GraphicsOverlayLayer overlay={overlay} />
          </div>
        </div>
      )}

      {/* State badge */}
      <div className="absolute top-2 left-2 z-10">
        <span className={`px-sm py-[2px] text-label-sm font-label-sm rounded font-bold uppercase tracking-widest ${
          isLive ? 'bg-secondary text-on-secondary' : 'bg-primary text-on-primary'
        }`}>
          {isLive ? 'LIVE' : 'PREVIEW'}
        </span>
      </div>

      {/* ON AIR badge */}
      {isLive && item && (
        <div className="absolute top-2 right-2 flex items-center gap-xs z-20 bg-secondary-container/80 border border-secondary/40 px-sm py-[2px] rounded">
          <span className="w-[5px] h-[5px] rounded-full bg-secondary dot-pulse block" />
          <span className="text-label-sm font-label-sm text-on-secondary-container tracking-wider">ON AIR</span>
        </div>
      )}
    </div>
  );
}


export default function PreviewLivePanel({
  previewItem, liveItem, previewSlideIdx, liveSlideIdx,
  displayMode, getSlides, previewBgPath, liveBgPath,
  onSelectPreviewSlide, onGoAtPreviewSlide, onSelectLiveSlide,
  channelTemplate,
  allChannels = [], liveChannelIdx = 0, onSetLiveChannelIdx,
}) {
  const previewSlides = previewItem ? getSlides(previewItem) : [];
  const liveSlides    = liveItem    ? getSlides(liveItem)    : [];

  const selectedChannel  = allChannels[liveChannelIdx] ?? allChannels[0] ?? null;
  const selectedTemplate = selectedChannel?.template ?? channelTemplate;
  const multiChannel = allChannels.length > 1;

  // Foreground media transport — shown when a video/audio clip is live.
  const liveMediaType = liveItem?.item_type === 'media' ? liveItem.asset?.type : null;
  const showTransport = liveMediaType === 'video' || liveMediaType === 'audio';

  // Shared transport state (start/pause/loop/mute) from the main process.
  const [transport, setTransport] = useState(null);
  useEffect(() => {
    let active = true;
    window.cue.output.getState?.().then((s) => { if (active && s?.transport) setTransport(s.transport); });
    const off = window.cue.on('output:media-transport', (t) => setTransport(t));
    return () => { active = false; off(); };
  }, []);

  // Live broadcast-graphics overlay (shown on a lower-third live monitor).
  const [overlay, setOverlay] = useState(null);
  useEffect(() => {
    let active = true;
    window.cue.output.overlay?.get?.().then((o) => { if (active && o) setOverlay(o); });
    const off = window.cue.on('output:overlay-changed', (o) => setOverlay(o));
    return () => { active = false; off(); };
  }, []);

  // Filter the overlay by the selected channel's kind so the monitor matches what
  // that specific output shows (a graphic targeted Online won't appear on In-Room).
  const selKind = selectedChannel?.type === 'ndi' ? 'ndi' : 'screen';
  const slotMatch = (s) => (s && (!s.target || s.target === 'all' || s.target === selKind)) ? s : null;
  // The overlay rides on top of any program output (fullscreen + lower-third), not stage.
  // A channel with graphics turned off (Lyrics Only) shows no overlay on its monitor.
  const hideGraphics = selectedChannel?.show_graphics === 0;
  const monitorOverlay = (selectedTemplate !== 'stage' && overlay && !hideGraphics)
    ? { nameTitle: slotMatch(overlay.nameTitle), ticker: slotMatch(overlay.ticker), custom: slotMatch(overlay.custom), countdown: slotMatch(overlay.countdown) }
    : null;
  // Graphics-only lower-third channel → don't render the song lyric band on the monitor.
  const hideProgram = selectedTemplate === 'lowerthird' && selectedChannel?.show_program === 0;

  const isPaused = transport?.pausedAt != null;
  const isMuted  = !!transport?.muted;

  const mediaDuration = useMediaDuration(liveMediaType ? liveItem?.asset?.path : null, liveMediaType);

  // Advance the scrubber/readout ~4×/s while playing.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!showTransport || isPaused) return;
    const id = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [showTransport, isPaused]);

  const [scrub, setScrub] = useState(null); // non-null while dragging the timeline
  const position = scrub != null ? scrub : transportPosition(transport, mediaDuration);

  function handleTogglePlayPause() { window.cue.output.media?.control(isPaused ? 'play' : 'pause'); }
  function handleRestart()         { window.cue.output.media?.control('restart'); }
  function handleMute()            { window.cue.output.media?.setMuted(!isMuted); }
  function handleScrub(e)          { const v = Number(e.target.value); setScrub(v); window.cue.output.media?.seek(v); }
  function handleScrubCommit()     { setScrub(null); }

  return (
    <div className="flex flex-col h-full gap-gutter">
      {/* Monitors row */}
      <div className="flex flex-1 gap-gutter min-h-0">

        {/* PREVIEW column */}
        <div className="flex-1 flex flex-col gap-sm min-h-0">
          <MonitorFrame
            item={previewItem}
            slideIdx={previewSlideIdx}
            getSlides={getSlides}
            emptyLabel="Nothing in Preview"
            isLive={false}
            backgroundPath={previewBgPath}
            channelTemplate={channelTemplate}
          />
          <div className="flex-1 overflow-y-auto pr-xs">
            {previewSlides.length > 0 ? (
              <SlideList
                slides={previewSlides}
                activeIdx={previewSlideIdx}
                onSelect={onSelectPreviewSlide}
                onDoubleClick={onGoAtPreviewSlide}
                variant="preview"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-label-sm font-label-sm text-outline-variant uppercase tracking-widest">
                Nothing in Preview
              </div>
            )}
          </div>
        </div>

        {/* LIVE column */}
        <div className="flex-1 flex flex-col gap-sm min-h-0">
          <MonitorFrame
            item={liveItem}
            slideIdx={liveSlideIdx}
            getSlides={getSlides}
            emptyLabel="Nothing Live"
            isLive={true}
            backgroundPath={liveBgPath}
            displayMode={displayMode}
            channelTemplate={selectedTemplate}
            transport={transport}
            overlay={monitorOverlay}
            hideProgram={hideProgram}
          />

          {/* Foreground media transport */}
          {showTransport && (
            <div className="flex flex-col gap-xs flex-shrink-0">
              <div className="flex items-center gap-xs">
                <span className="material-symbols-outlined text-[14px] text-tertiary shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {liveMediaType === 'audio' ? 'volume_up' : 'movie'}
                </span>
                <span className="text-[9px] font-mono uppercase tracking-[0.05em] text-on-surface-variant truncate flex-1 min-w-0">
                  {liveItem.asset?.filename}
                </span>
                <span className="text-[9px] font-mono text-on-surface-variant tabular-nums shrink-0">
                  {fmtClock(position)} / {mediaDuration ? fmtClock(mediaDuration) : '--:--'}
                </span>
              </div>
              <div className="flex items-center gap-xs">
                <input
                  type="range"
                  min={0}
                  max={mediaDuration || 0}
                  step="0.05"
                  value={Math.min(position, mediaDuration || 0)}
                  onChange={handleScrub}
                  onMouseUp={handleScrubCommit}
                  onTouchEnd={handleScrubCommit}
                  disabled={!mediaDuration}
                  title="Scrub"
                  className="flex-1 h-1 accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-default"
                />
                <button
                  onClick={handleMute}
                  title={isMuted ? 'Unmute program audio' : 'Mute program audio'}
                  className={`flex items-center justify-center w-7 h-6 rounded border transition-colors cursor-pointer shrink-0 ${
                    isMuted
                      ? 'border-secondary/50 bg-surface-container text-secondary'
                      : 'border-outline-variant/30 bg-surface-container text-on-surface-variant hover:border-primary/50 hover:text-primary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">{isMuted ? 'volume_off' : 'volume_up'}</span>
                </button>
                <button
                  onClick={handleTogglePlayPause}
                  title={isPaused ? 'Play' : 'Pause'}
                  className="flex items-center justify-center w-7 h-6 rounded border border-outline-variant/30 bg-surface-container text-on-surface-variant hover:border-primary/50 hover:text-primary transition-colors cursor-pointer shrink-0"
                >
                  <span className="material-symbols-outlined text-[14px]">{isPaused ? 'play_arrow' : 'pause'}</span>
                </button>
                <button
                  onClick={handleRestart}
                  title="Restart"
                  className="flex items-center justify-center w-7 h-6 rounded border border-outline-variant/30 bg-surface-container text-on-surface-variant hover:border-primary/50 hover:text-primary transition-colors cursor-pointer shrink-0"
                >
                  <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                </button>
              </div>
            </div>
          )}

          {/* Channel selector — only shown when 2+ channels */}
          {multiChannel && (
            <div className="flex items-center gap-xs flex-shrink-0 flex-wrap">
              {allChannels.map((ch, idx) => {
                const isSelected = idx === liveChannelIdx;
                const isNdi = ch.type === 'ndi';
                return (
                  <button
                    key={ch.id}
                    onClick={() => onSetLiveChannelIdx?.(idx)}
                    title={`View ${ch.name}`}
                    className={`flex items-center gap-xs px-sm h-6 rounded border text-[9px] font-mono uppercase tracking-[0.05em] transition-colors cursor-pointer flex-shrink-0 ${
                      isSelected
                        ? 'bg-primary/15 border-primary/50 text-primary'
                        : 'bg-surface-container border-outline-variant/30 text-on-surface-variant hover:border-outline-variant hover:text-on-surface'
                    }`}
                  >
                    {isNdi && (
                      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${isSelected ? 'bg-tertiary' : 'bg-outline-variant'}`} />
                    )}
                    {!isNdi && (
                      <span className="material-symbols-outlined text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        monitor
                      </span>
                    )}
                    <span className="truncate max-w-[80px]">{ch.name}</span>
                    {isNdi && (
                      <span className={`text-[8px] ${isSelected ? 'text-primary/60' : 'text-outline-variant'}`}>NDI</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex-1 overflow-y-auto pr-xs">
            {liveSlides.length > 0 ? (
              <SlideList
                slides={liveSlides}
                activeIdx={liveSlideIdx}
                onSelect={onSelectLiveSlide}
                variant="live"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-label-sm font-label-sm text-outline-variant uppercase tracking-widest">
                Nothing Live
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
