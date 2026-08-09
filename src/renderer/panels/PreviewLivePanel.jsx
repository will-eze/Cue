import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import SlideList from '../components/SlideList';
import { renderWithRuns, copyrightCss, buildDecorationCss, buildBoxFillCss } from '../components/SongEditor';
import { flatTextCss, buildBarBg as buildGraphicBarBg, fmtDuration as fmtGfxDuration, fmtClock as fmtGfxClock, CD_DEFAULT_BOX, TIME_BASE as GFX_TIME_BASE, MSG_BASE as GFX_MSG_BASE } from '../components/GraphicsEditor';
import { mediaUrl } from '../utils/mediaUrl';
import { resolveActive } from '../../shared/stage-schedule.js';

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

  // While paused, freeze the readout against the frozen instant (mirrors graphics-overlay.js).
  const now = cd.paused ? (cd.frozenAt || Date.now()) : Date.now();
  let timeText, msgText = cd.label || '';
  if (cd.mode === 'clock') timeText = fmtGfxClock(new Date(now), cd.format, cd.showSeconds);
  else if (cd.mode === 'countup') timeText = fmtGfxDuration((now - cd.startAt) / 1000);
  else {
    const rem = (cd.endsAt - now) / 1000;
    if (rem <= 0) {
      if (cd.onEnd === 'overflow') {
        timeText = '+' + fmtGfxDuration(-rem);
      } else {
        timeText = '0:00';
        msgText = cd.endMessage || cd.label || '';
      }
    } else {
      timeText = fmtGfxDuration(Math.ceil(rem));
    }
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

  // Background media: priority countdown > custom > nameTitle > ticker (mirrors graphics-overlay.js).
  const bgSlot = (cd && cd.bgPath && cd) || (cu && cu.bgPath && cu) || (nt && nt.bgPath && nt) || (tk && tk.bgPath && tk) || null;
  const bgUrl  = bgSlot ? mediaUrl(bgSlot.bgPath) : null;
  const bgFit  = bgSlot?.bgFit || 'cover';
  const bgIsVideo = bgSlot?.bgPath && /\.(mp4|mov|webm|avi)$/i.test(bgSlot.bgPath.toLowerCase());

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

  return (
    <>
      {bgUrl && (
        bgIsVideo
          ? <video src={bgUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: bgFit }} autoPlay loop muted playsInline />
          : <img src={bgUrl} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: bgFit }} alt="" />
      )}
      {bug}
      {tk && <OverlayTicker tk={tk} />}
      {cd && cd.mode && <OverlayCountdown cd={cd} />}
      {cu && (
        <iframe title="overlay-custom" sandbox="allow-same-origin"
          style={{ position: 'absolute', inset: 0, width: NATIVE_W, height: NATIVE_H, border: 0, background: 'transparent' }}
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:Inter,system-ui,sans-serif}.cue-root{position:absolute;inset:0}</style></head><body><div class="cue-root cue-in">${cu.html}</div></body></html>`} />
      )}
    </>
  );
}

// Crawling ticker for the live monitor — scrolls horizontally exactly like the
// output (output/graphics-overlay.js): inner starts off the right edge
// (padding-left:100%) and animates to translateX(-100%); duration = travel
// distance / speed. Keyframes `cue-ticker-crawl` live in index.css.
function OverlayTicker({ tk }) {
  const innerRef = useRef(null);
  const [dur, setDur] = useState(20);
  const st = tk.style || {};
  const top = st.position === 'top';
  const barBg = st.bar ? buildGraphicBarBg({ color: st.bar.color, opacity: st.bar.opacity, solid: true }) : 'rgba(12,14,18,0.9)';

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const distance = el.scrollWidth;
    const spd = Math.max(20, Number(tk.speed) || 100);
    setDur(distance / spd);
  }, [tk.text, tk.style, tk.speed]);

  return (
    <div style={{ position: 'absolute', left: 0, right: 0, [top ? 'top' : 'bottom']: 0, height: 72, background: barBg,
      borderTop: top ? 'none' : '3px solid #4d8eff', borderBottom: top ? '3px solid #4d8eff' : 'none',
      display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
      <div ref={innerRef} style={{ ...flatTextCss(st, { fontSize: 30, color: '#fff', fontWeight: 500 }), whiteSpace: 'nowrap',
        flexShrink: 0, paddingLeft: '100%', lineHeight: '72px', textAlign: 'left', willChange: 'transform',
        animation: `cue-ticker-crawl ${dur}s linear infinite` }}>
        {tk.text}
      </div>
    </div>
  );
}

function buildBarBg(ltBar) {
  if (!ltBar) return 'transparent';
  if (ltBar.css) return ltBar.css;
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
  let pos = (ref - t.startAt) / 1000 * (t.rate || 1);
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
      let pos = (r - t.startAt) / 1000 * (t.rate || 1);
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
      const base = t.rate || 1;
      const drift = wrappedDelta(v.currentTime || 0, expected, dur);
      if (Math.abs(drift) > 0.5) { try { v.currentTime = expected; } catch {} v.playbackRate = base; }
      else { let rr = base * (1 - drift * 0.5); rr = Math.max(base * 0.94, Math.min(base * 1.06, rr)); v.playbackRate = rr; }
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

// Confidence-monitor — a layout-driven mirror of the customisable stage display
// (output/stage.js). Reads the selected channel's per-channel layout (subscribing to
// stage:layout) and renders the same positioned elements at native 1920×1080, binding
// the live slide / next / transport it already receives PLUS the stage buses
// (stage:timer / stage:message / stage:schedule), so the monitor shows the same
// clock, presenter timer, video countdown and message bar the stage screen does.
// Like the template, every ticker runs LOCALLY against Date.now() — main sends
// anchors (startedAt / showAt / transport.startAt), never per-second updates.
// Parallel renderer to the plain-DOM template, same as StreamLayoutEditor.
const STAGE_DEFAULT_ELEMENTS = [
  { id: 'clock',   type: 'clock',          x: 2.5, y: 2.5,  w: 30.5, h: 12, hour12: true, showSeconds: true },
  { id: 'timer',   type: 'timer',          x: 34.5, y: 2.5, w: 31,   h: 12, showBar: true },
  { id: 'video',   type: 'videoCountdown', x: 67,  y: 2.5,  w: 30.5, h: 12 },
  { id: 'current', type: 'currentText',    x: 2.5, y: 16,   w: 95,   h: 54, align: 'center', color: '#ffffff', fit: 'auto', showRef: true },
  { id: 'next',    type: 'nextText',       x: 2.5, y: 71.5, w: 95,   h: 14, color: 'rgba(255,255,255,0.4)', align: 'center' },
  { id: 'message', type: 'message',        x: 2.5, y: 87.5, w: 95,   h: 10, align: 'center' },
];
const alignJustify = (a) => (a === 'left' ? 'flex-start' : a === 'right' ? 'flex-end' : 'center');

// mm:ss, matching stage.js fmtTime (zero-padded minutes, unlike fmtClock above).
function fmtStageTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

// Wall-clock string for the `clock` element — mirrors stage.js fmtClock, honouring
// the element's own hour12 / showSeconds spec (the old monitor hardcoded 12h+seconds).
function fmtStageClock(spec, now) {
  const d = new Date(now);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  if (spec.hour12 !== false) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = String(h % 12 || 12).padStart(2, '0');
    return spec.showSeconds !== false ? `${h12}:${m}:${s} ${ampm}` : `${h12}:${m} ${ampm}`;
  }
  const h24 = String(h).padStart(2, '0');
  return spec.showSeconds !== false ? `${h24}:${m}:${s}` : `${h24}:${m}`;
}

// The presenter timer's remaining seconds, recomputed locally from the last anchor
// main sent — identical to stage.js currentRemaining(). `remainingSeconds` in the
// payload IS the value at `startedAt` (main only rewrites it on pause/reset), so it
// doubles as stage.js's `remainingAtStart`.
function stageRemaining(t, now) {
  if (!t) return 0;
  return Math.max(0, (t.running && t.startedAt)
    ? t.remainingSeconds - (now - t.startedAt) / 1000
    : (t.remainingSeconds || 0));
}

// Live stage buses (presenter timer, immediate message, scheduled messages). Main
// already mirrors all three to the operator window via notifyMainWindow, and preload
// whitelists them — this just subscribes, seeding from the getters so a monitor opened
// mid-service is correct before the next broadcast.
function useStageState() {
  const [timer, setTimer] = useState(null);
  const [message, setMessage] = useState('');
  const [scheduled, setScheduled] = useState([]);
  useEffect(() => {
    let alive = true;
    const api = window.cue.output.stage;
    api?.getTimer?.().then((t) => { if (alive && t) setTimer(t); });
    api?.getMessage?.().then((m) => { if (alive && m) setMessage(m.text || ''); });
    api?.getSchedule?.().then((s) => { if (alive && Array.isArray(s)) setScheduled(s); });
    const offT = window.cue.on('stage:timer',    (t) => setTimer(t));
    const offM = window.cue.on('stage:message',  (p) => setMessage(p?.text || ''));
    const offS = window.cue.on('stage:schedule', (p) => setScheduled(p?.scheduled || []));
    return () => { alive = false; offT(); offM(); offS(); };
  }, []);
  return { timer, message, scheduled };
}

function StageMonitor({ slide, item, slides, slideIdx, copyrightText, copyrightRight, transport, channelId, displayMode, isLive }) {
  const [elements, setElements] = useState(null);
  const { timer, message, scheduled } = useStageState();

  // One local ticker drives clock, presenter timer, video countdown and the
  // scheduled-message window — same 250ms cadence stage.js uses for its timers.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  // Load + live-subscribe to this channel's layout.
  useEffect(() => {
    if (channelId == null) { setElements(STAGE_DEFAULT_ELEMENTS); return; }
    let alive = true;
    window.cue.output.stage.getLayout(channelId).then((l) => { if (alive) setElements(l.elements); });
    const off = window.cue.on('stage:layout', (p) => { if (p && p.channelId === channelId) setElements(p.elements); });
    return () => { alive = false; if (off) off(); };
  }, [channelId]);

  const els = elements || STAGE_DEFAULT_ELEMENTS;

  // Foreground media — mirrors stage.js's slide bus handling: a video plays muted in
  // the currentText box (and drives the video countdown); any other media shows an
  // icon + title line instead of lyric text.
  const isMediaItem = item?.item_type === 'media';
  const isYouTube   = item?.item_type === 'youtube' && item?.youtube?.status === 'ready';
  const mediaPath   = isMediaItem ? item?.asset?.path : isYouTube ? item?.youtube?.path : null;
  const mediaType   = isMediaItem ? item?.asset?.type : isYouTube ? 'video' : null;
  const isVideo     = !!mediaPath && (mediaType === 'video' || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(mediaPath));
  const videoDuration = useMediaDuration(isVideo ? mediaPath : null, 'video');

  // stage.js keeps the last content on screen when the program is cleared/logo and
  // simply dims the whole layout (#stage-root.muted) — it never blanks the text.
  const muted = isLive && (displayMode === 'cleared' || displayMode === 'logo');

  let currentText = slide?.content || '';
  if (mediaPath && !isVideo) {
    const icon = mediaType === 'audio' ? '♪' : '⊞';
    currentText = `${icon} ${item?.asset?.filename || item?.youtube?.title || mediaPath.split(/[\\/]/).pop()}`;
  } else if (isVideo) {
    currentText = '';
  }

  // Video countdown: time left in the live clip, off the shared transport clock.
  // null (→ "--:--") whenever no video is running, exactly like stage.js.
  // transportPosition already wraps (loop) or clamps (one-shot) against the duration.
  const vcdLoop  = transport ? !!transport.loop : !!item?.media_loop;
  const vcdValue = (isVideo && transport?.active && videoDuration > 0)
    ? Math.max(0, videoDuration - transportPosition(transport, videoDuration))
    : null;

  const remaining = stageRemaining(timer, now);
  const activeMsg = (message && message.trim())
    ? message
    : (resolveActive(scheduled, now)?.text || '');

  const live = {
    now,
    currentText,
    nextText: slides[slideIdx + 1]?.content || '',
    refText:  copyrightRight ? copyrightText : null,
    isVideo, mediaPath, transport, item,
    timer, remaining,
    elapsed: (timer?.totalSeconds > 0) ? Math.max(0, timer.totalSeconds - remaining) : 0,
    vcdValue, vcdLoop,
    message: activeMsg,
  };

  return (
    <div style={{ width: NATIVE_W, height: NATIVE_H, position: 'relative', background: '#0c0e12', fontFamily: 'Inter, sans-serif', color: '#e2e2e8' }}>
      {els.map((el, i) => (
        <div key={el.id} style={{ position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`, zIndex: i + 1, overflow: 'hidden', opacity: muted ? 0.25 : 1 }}>
          <StageElement el={el} live={live} />
        </div>
      ))}
    </div>
  );
}

// Auto-fit mirror of stage.js fitNode() for the currentText element.
// Binary-searches the largest font-px that fits vertically — identical algorithm.
function StageCurrentText({ el, live }) {
  const boxRef  = useRef(null);
  const textRef = useRef(null);
  const refRef  = useRef(null);

  useLayoutEffect(() => {
    const box    = boxRef.current;
    const textEl = textRef.current;
    if (!box || !textEl) return;
    if (el.fit === 'fixed') { textEl.style.fontSize = (el.fontPx || 88) + 'px'; return; }

    const cs     = getComputedStyle(box);
    let availH   = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 4;
    if (refRef.current) availH -= refRef.current.offsetHeight + 8;
    if (availH <= 10) return;

    const wCap  = box.clientWidth * 0.6;
    const hiCap = Math.min(availH * 0.88, wCap, 400);

    textEl.style.fontSize = hiCap + 'px';
    if (textEl.scrollHeight <= availH) return;

    let lo = 8, hi = hiCap;
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2;
      textEl.style.fontSize = mid + 'px';
      if (textEl.scrollHeight <= availH) lo = mid; else hi = mid;
    }
    textEl.style.fontSize = lo + 'px';
  }, [live.currentText, live.refText, el.fit, el.fontPx]);

  return (
    <div ref={boxRef} style={{ width: '100%', height: '100%', position: 'relative', background: '#0c0e12', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2% 4%', overflow: 'hidden', textAlign: 'center' }}>
      {live.isVideo ? (
        live.transport?.active
          ? <SyncedVideo src={mediaUrl(live.mediaPath)} transport={live.transport} loop={!!live.item?.media_loop} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
          : <video src={mediaUrl(live.mediaPath)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} autoPlay loop muted />
      ) : (
        <>
          {live.refText && el.showRef !== false && (
            <div ref={refRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '1.5% 6% 0', textAlign: 'center', fontSize: 34, fontWeight: 600, letterSpacing: '0.04em', color: '#adc6ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{live.refText}</div>
          )}
          <div ref={textRef} style={{ fontWeight: 700, lineHeight: 1.15, color: el.color || '#ffffff', whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: el.align || 'center', width: '100%', overflow: 'hidden' }}>{live.currentText}</div>
        </>
      )}
    </div>
  );
}

// One positioned stage element, rendered at native scale with live content bound in.
function StageElement({ el, live }) {
  const Bar = ({ label, value, valColor, children }) => (
    <div style={{ width: '100%', height: '100%', background: '#1a1c20', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', alignItems: alignJustify(el.align), justifyContent: 'center', gap: 8, overflow: 'hidden', padding: '0 2%' }}>
      {label && <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#424754', whiteSpace: 'nowrap' }}>{label}</div>}
      <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: valColor }}>{value}</div>
      {children}
    </div>
  );
  switch (el.type) {
    case 'clock':          return <Bar label={el.label} value={fmtStageClock(el, live.now)} valColor="#adc6ff" />;
    case 'timer': {
      // Colour states mirror stage.css .timer-idle / -running / -paused / -expired.
      const t = live.timer;
      const total = t?.totalSeconds || 0;
      const rem = live.remaining;
      const color = (t?.running && rem > 0) ? '#ffb3ad'
                  : (total > 0 && rem <= 0) ? '#ffb3ad'
                  : total === 0             ? '#2a2e38'
                  :                           '#c2c6d6';
      const pct = total > 0 ? (rem / total) * 100 : 0;
      const barFill = (t?.running || (total > 0 && rem <= 0)) ? '#a40217' : '#2a2e38';
      return (
        <Bar label={el.label} value={fmtStageTime(rem)} valColor={color}>
          {el.showBar !== false && (
            <div style={{ width: '65%', height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: barFill }} />
            </div>
          )}
        </Bar>
      );
    }
    case 'elapsedTimer':   return <Bar label={el.label} value={fmtStageTime(live.elapsed)} valColor={live.timer?.running ? '#ffb3ad' : '#e2e2e8'} />;
    case 'videoCountdown': {
      // stage.css .counter-idle / -active / -warning / -ended.
      if (live.vcdValue == null) return <Bar label={el.label} value="--:--" valColor="#2a2e38" />;
      const color = (!live.vcdLoop && live.vcdValue <= 0) ? '#424754'
                  : (live.vcdValue <= 15)                 ? '#ffb3ad'
                  :                                         '#4ae176';
      return <Bar label={el.label} value={fmtStageTime(live.vcdValue)} valColor={color} />;
    }
    case 'message':        return (
      <div style={{ width: '100%', height: '100%', background: '#1a1c20', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center', padding: '0 4%' }}>
        {live.message ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5%', background: 'rgba(164,2,23,0.3)', border: '1px solid rgba(255,179,173,0.25)', borderRadius: 10, padding: '1% 2%', width: '100%', overflow: 'hidden' }}>
            <span style={{ flexShrink: 0, fontSize: 42, color: '#ffb3ad', lineHeight: 1 }}>&#9888;</span>
            <span style={{ fontSize: el.fontPx || 50, fontWeight: 700, color: '#ffb3ad', letterSpacing: '0.04em', lineHeight: 1.25, textTransform: 'uppercase', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden' }}>{live.message}</span>
          </div>
        ) : (
          <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(140,144,159,0.25)' }}>NO MESSAGES</div>
        )}
      </div>
    );
    case 'staticText':     return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center', color: el.color || '#e2e2e8', fontSize: (el.fontPx || 32), fontWeight: 600, textAlign: el.align || 'center', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden', padding: '0 2%' }}>
        {el.text || ''}
      </div>
    );
    case 'nextText':       return (
      <div style={{ width: '100%', height: '100%', background: '#0c0e12', display: 'flex', alignItems: 'baseline', gap: '1.5%', padding: '1.2% 4%', overflow: 'hidden' }}>
        {el.label && <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#4d8eff', whiteSpace: 'nowrap' }}>{el.label}</span>}
        <span style={{ flex: 1, minWidth: 0, fontSize: (el.fontPx || 26), fontWeight: 400, lineHeight: 1.3, color: el.color || 'rgba(255,255,255,0.4)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden', textAlign: el.align || 'center' }}>{live.nextText || '—'}</span>
      </div>
    );
    case 'currentText':    return <StageCurrentText el={el} live={live} />;
    default: return null;
  }
}

// Presentation slide — a multi-element canvas, rendered at native 1920×1080 inside
// MonitorFrame's already-scaled box. JSX mirror of fullscreen.js renderElements (the
// React monitor and plain-DOM output template intentionally keep parallel renderers).
function PresentationCanvas({ elements, backgroundPath, hideText }) {
  const sorted = [...(elements || [])].sort((a, b) => (a.z || 0) - (b.z || 0));
  return (
    <>
      {backgroundPath && (
        <div style={{ position: 'absolute', inset: 0 }}>
          {/\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(backgroundPath)
            ? <video src={mediaUrl(backgroundPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} autoPlay loop muted />
            : <img src={mediaUrl(backgroundPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />}
        </div>
      )}
      {!hideText && sorted.map((el, i) => {
        const box = {
          position: 'absolute',
          left: `${el.x ?? 0}%`, top: `${el.y ?? 0}%`,
          width: `${el.w ?? 20}%`, height: `${el.h ?? 20}%`,
          transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
          opacity: el.opacity != null ? el.opacity : undefined,
          zIndex: el.z != null ? el.z : undefined,
          overflow: 'hidden',
          boxSizing: 'border-box',
        };
        if (el.type === 'text') {
          const s = el.style || {};
          const shadow = s.textShadow;
          const shadowCss = shadow?.enabled
            ? `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}`
            : 'none';
          return (
            <div key={el.id || i} style={{ ...box, display: 'flex', flexDirection: 'column',
              justifyContent: s.verticalAlign === 'top' ? 'flex-start' : s.verticalAlign === 'bottom' ? 'flex-end' : 'center',
              ...buildBoxFillCss(s.boxFill) }}>
              <div style={{ width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: s.fontFamily || undefined,
                fontSize: (s.fontSize ?? 48) + 'px',
                textAlign: s.align || 'center',
                fontWeight: s.bold ? 700 : 400,
                fontStyle: s.italic ? 'italic' : 'normal',
                textDecoration: buildDecorationCss(s),
                textTransform: s.uppercase ? 'uppercase' : 'none',
                color: s.color || '#ffffff',
                lineHeight: s.lineSpacing ? String(s.lineSpacing) : '1.25',
                letterSpacing: s.letterSpacing ? `${s.letterSpacing}em` : undefined,
                textShadow: shadowCss,
                WebkitTextStroke: (s.textStroke?.enabled) ? `${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}` : undefined,
              }} dangerouslySetInnerHTML={{ __html: renderWithRuns(el.text || '', s.runs) }} />
            </div>
          );
        }
        if (el.type === 'image' && el.path) {
          const fit = el.fit === 'cover' ? 'cover' : 'contain';
          const isVideo = el.mediaType === 'video' || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(el.path);
          return (
            <div key={el.id || i} style={box}>
              {isVideo
                ? <video src={mediaUrl(el.path)} style={{ width: '100%', height: '100%', objectFit: fit }} autoPlay loop muted />
                : <img src={mediaUrl(el.path)} style={{ width: '100%', height: '100%', objectFit: fit }} alt="" />}
            </div>
          );
        }
        if (el.type === 'shape') {
          const stroke = el.stroke || {};
          const shapeStyle = el.shape === 'line'
            ? { background: stroke.color || el.fill || '#fff' }
            : {
                background: el.fill || 'transparent',
                border: (stroke.color && stroke.width) ? `${stroke.width}px solid ${stroke.color}` : undefined,
                borderRadius: el.shape === 'ellipse' ? '50%' : (el.radius ? `${el.radius}px` : undefined),
              };
          return <div key={el.id || i} style={box}><div style={{ width: '100%', height: '100%', ...shapeStyle }} /></div>;
        }
        return null;
      })}
    </>
  );
}

// Split-verse (compare) blocks for the monitor — mirrors the output templates'
// stacked two-translation layout (fullscreen.js / lowerthird.js). Each block keeps the
// shared verse style at a reduced size, with its attribution inline beneath.
// Split-verse (compare) block — mirrors fullscreen.js / lowerthird.js: the two stacked
// translations are auto-fit to the largest font (≤ maxFontPx) that fits maxHeightPx, so
// short verses fill the area and long readings shrink. A thin rule separates them.
function SplitVerses({ verses, baseStyle, maxFontPx, maxHeightPx, runs, scale = 1, attrColor }) {
  const ref = useRef(null);
  const [fontPx, setFontPx] = useState(maxFontPx);
  useLayoutEffect(() => {
    const el = ref.current;
    const cap = Math.max(18, maxFontPx);
    if (!el || !maxHeightPx) { setFontPx(cap); return; }
    el.style.fontSize = cap + 'px';
    let best = cap;
    if (el.scrollHeight > maxHeightPx) {
      let lo = 18, hi = cap;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        el.style.fontSize = mid + 'px';
        if (el.scrollHeight <= maxHeightPx) lo = mid; else hi = mid;
      }
      best = lo;
    }
    setFontPx(best);
  }, [verses, maxFontPx, maxHeightPx, scale]);
  return (
    <div ref={ref} style={{ ...baseStyle, fontSize: fontPx + 'px', maxHeight: maxHeightPx ? maxHeightPx + 'px' : undefined, overflow: 'hidden' }}>
      {verses.map((b, i) => (
        <div key={i} style={i ? { marginTop: '0.5em', paddingTop: '0.55em', borderTop: '2px solid rgba(255,255,255,0.22)' } : undefined}>
          <div dangerouslySetInnerHTML={{ __html: renderWithRuns(b.text || '', runs, scale) }} />
          <div style={{ fontSize: '0.42em', opacity: 0.78, fontWeight: 600, letterSpacing: '0.03em', marginTop: '0.18em', color: attrColor || undefined }}>
            {b.attribution}
          </div>
        </div>
      ))}
    </div>
  );
}

// Live video input monitor — renders the low-rate JPEG thumbnail stream pushed by
// main's NDI receiver (decoded frames pushed over IPC, NOT a screen-capture loop).
// previewStart/Stop are ref-counted per source in main, so the preview and live
// monitors can both subscribe to the same camera safely.
function LiveInputMonitor({ liveInput }) {
  const src = liveInput?.sourceName;
  const [frame, setFrame] = useState(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!src) return;
    setFrame(null);
    setConnected(false);
    window.cue.liveInput.previewStart(src);
    const offPrev = window.cue.on('liveinput:preview', (p) => {
      if (p?.sourceName === src) { setFrame(p.dataUrl); setConnected(true); }
    });
    const offStat = window.cue.on('liveinput:status', (p) => {
      if (p?.sourceName === src) setConnected(!!p.connected);
    });
    return () => { offPrev(); offStat(); window.cue.liveInput.previewStop(src); };
  }, [src]);
  // Rendered inside the scaled 1920×1080 monitor canvas — px values are native-scale.
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
      {frame && <img src={frame} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />}
      <div style={{ position: 'absolute', top: 32, left: 32, display: 'flex', alignItems: 'center', gap: 16, padding: '12px 22px', background: 'rgba(0,0,0,0.55)', borderRadius: 10 }}>
        <span style={{ width: 16, height: 16, borderRadius: '50%', background: connected ? '#4ae176' : '#8c909f' }} />
        <span style={{ fontSize: 30, fontWeight: 600, color: '#e2e2e8', letterSpacing: '0.04em' }}>
          {liveInput?.name || src || 'Live Input'}
        </span>
      </div>
      {!frame && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#424754', fontSize: 40, fontWeight: 600, letterSpacing: '0.12em' }}>
          {src ? 'CONNECTING…' : 'NO SOURCE'}
        </div>
      )}
    </div>
  );
}

function MonitorFrame({ item, slideIdx, getSlides, emptyLabel, isLive, backgroundPath, displayMode, channelTemplate, stageChannelId, ltFontScale = 1, transport, overlay, hideProgram }) {
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
  const isPresentation = item?.item_type === 'presentation';
  const isLiveInput = item?.item_type === 'live-input';

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

  // Text styles at native 1920×1080 resolution — no scaling needed, CSS transform handles it.
  // Lower-third lyric size mirrors output/lowerthird.js exactly: base = authored size or
  // the FULLSCREEN default (72px), then × the global L3 font scale. Fullscreen is unscaled.
  const ltScale = isLT ? (Number(ltFontScale) > 0 ? Number(ltFontScale) : 1) : 1;
  const baseFontPx = isLT ? (Number(style?.fontSize) || 72) * ltScale : (style?.fontSize ?? 72);
  const textStyle = {
    fontFamily:       style?.fontFamily || undefined,
    fontSize:         baseFontPx + 'px',
    textAlign:        style?.align || 'center',
    fontWeight:       style?.bold ? 700 : 400,
    fontStyle:        style?.italic ? 'italic' : 'normal',
    textDecoration:   buildDecorationCss(style),
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
      {/* Scaled 1920×1080 canvas — pixel-accurate match of the output template.
          A stage channel renders even with nothing live: the real stage screen is
          still showing its clock, presenter timer and message bar, so an idle
          rundown must not blank the monitor. */}
      {(slide || isStage) ? (
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
                    channelId={stageChannelId}
                    displayMode={displayMode}
                    isLive={isLive}
                  />
                ) : isLiveInput ? (
                  <LiveInputMonitor liveInput={slide.liveInput || item.liveInput} />
                ) : isPresentation ? (
                  <PresentationCanvas
                    elements={slide.elements}
                    backgroundPath={slide.background_path || backgroundPath}
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
                ) : backgroundPath ? (
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
                ) : style?.bgCss ? (
                  // Theme CSS gradient/solid background (no media asset) — matches fullscreen.js setBackground
                  <div style={{ position: 'absolute', inset: 0, background: style.bgCss }} />
                ) : null}

                {/* Background scrim (style.bgScrim) — matches fullscreen.js #scrim */}
                {!isLT && style?.bgScrim ? (
                  <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: Math.max(0, Math.min(1, style.bgScrim)), pointerEvents: 'none' }} />
                ) : null}

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
                    {slide.splitVerses ? (
                      <SplitVerses verses={slide.splitVerses} baseStyle={textStyle} maxFontPx={baseFontPx} maxHeightPx={Math.round(NATIVE_H * 0.6)} runs={style?.runs} scale={ltScale} attrColor={copyrightStyle?.color} />
                    ) : (
                      <p style={textStyle} dangerouslySetInnerHTML={{ __html: renderWithRuns(slide.content, style?.runs, ltScale) }} />
                    )}
                    {copyrightText && !slide.splitVerses && (
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
                      boxSizing: 'border-box',
                      ...buildBoxFillCss(style?.boxFill),
                    }}>
                      {slide.splitVerses ? (
                        <SplitVerses verses={slide.splitVerses} baseStyle={textStyle} maxFontPx={baseFontPx} maxHeightPx={Math.round((tb.h / 100) * NATIVE_H)} runs={style?.runs} scale={1} attrColor={copyrightStyle?.color} />
                      ) : (
                        <p style={textStyle} dangerouslySetInnerHTML={{ __html: renderWithRuns(slide.content, style?.runs) }} />
                      )}
                    </div>
                  );
                })())}

                {/* Attribution / copyright — matches fullscreen.css #copyright */}
                {!hideText && !isLT && copyrightText && !slide.splitVerses && (
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
  ltFontScale = 1,
  allChannels = [], liveChannelIdx = 0, onSetLiveChannelIdx,
  onToggleLoop,
  jumpKeys = null,
  jumpArmed = false,
  onToggleJumpArmed,
  bareArmed = true,
  onToggleBareArmed,
}) {
  const previewSlides = previewItem ? getSlides(previewItem) : [];
  const liveSlides    = liveItem    ? getSlides(liveItem)    : [];

  const selectedChannel  = allChannels[liveChannelIdx] ?? allChannels[0] ?? null;
  const selectedTemplate = selectedChannel?.template ?? channelTemplate;
  const multiChannel = allChannels.length > 1;

  // Foreground media transport — shown when a video/audio clip is live. A YouTube
  // cue becomes an ordinary local video once downloaded, so it shares these controls.
  const liveMediaType = liveItem?.item_type === 'media' ? liveItem.asset?.type
    : (liveItem?.item_type === 'youtube' && liveItem.youtube?.status === 'ready') ? 'video'
    : null;
  const liveMediaPath = liveItem?.item_type === 'media' ? liveItem.asset?.path
    : liveItem?.item_type === 'youtube' ? (liveItem.youtube?.status === 'ready' ? liveItem.youtube.path : null)
    : null;
  const liveMediaName = liveItem?.asset?.filename || liveItem?.youtube?.title || '';
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

  // Each overlay slot now holds one occupant per destination kind ({ screen, ndi }).
  // Pick the occupant for this monitor's kind so it matches exactly what that output
  // shows (a graphic targeted Online won't appear on an In-Room monitor, and a
  // different one can run on each).
  const selKind = selectedChannel?.type === 'ndi' ? 'ndi' : 'screen';
  const pick = (slot) => (slot ? slot[selKind] : null);
  // The overlay rides on top of any program output (fullscreen + lower-third), not stage.
  // A channel with graphics turned off (Lyrics Only) shows no overlay on its monitor.
  const hideGraphics = selectedChannel?.show_graphics === 0;
  const monitorOverlay = (selectedTemplate !== 'stage' && overlay && !hideGraphics)
    ? { nameTitle: pick(overlay.nameTitle), ticker: pick(overlay.ticker), custom: pick(overlay.custom), countdown: pick(overlay.countdown) }
    : null;
  // Graphics-only lower-third channel → don't render the song lyric band on the monitor.
  const hideProgram = selectedTemplate === 'lowerthird' && selectedChannel?.show_program === 0;

  const isPaused = transport?.pausedAt != null;
  const isMuted  = !!transport?.muted;
  // Live transport is the source of truth (reflects a loop toggle instantly); fall
  // back to the item's persisted media_loop before the first transport arrives.
  const loopOn   = transport ? !!transport.loop : !!liveItem?.media_loop;

  const mediaDuration = useMediaDuration(liveMediaPath, liveMediaType);

  // Advance the scrubber/readout ~4×/s while playing.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!showTransport || isPaused) return;
    const id = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [showTransport, isPaused]);

  const [scrub, setScrub] = useState(null); // non-null while dragging the timeline
  const position = scrub != null ? scrub : transportPosition(transport, mediaDuration);

  // Commit the scrub on a window-level pointer release. A range thumb drag very
  // often ends with the pointer OUTSIDE the input, so the input's own onMouseUp
  // never fires and `scrub` would otherwise stay stuck — pinning the scrubber to the
  // dragged value and making it ignore transport changes (e.g. Restart → 0).
  useEffect(() => {
    if (scrub == null) return;
    const commit = () => setScrub(null);
    window.addEventListener('pointerup', commit);
    window.addEventListener('pointercancel', commit);
    return () => {
      window.removeEventListener('pointerup', commit);
      window.removeEventListener('pointercancel', commit);
    };
  }, [scrub]);

  function handleTogglePlayPause() { window.cue.output.media?.control(isPaused ? 'play' : 'pause'); }
  function handleRestart()         { setScrub(null); window.cue.output.media?.control('restart'); }
  function handleMute()            { window.cue.output.media?.setMuted(!isMuted); }
  function handleScrub(e)          { const v = Number(e.target.value); setScrub(v); window.cue.output.media?.seek(v); }
  function handleScrubCommit()     { setScrub(null); }
  function handleRate(e)           { window.cue.output.media?.setRate(Number(e.target.value)); }
  const playRate = transport?.rate || 1;

  return (
    <div className="flex flex-col h-full gap-gutter">
      {/* Monitors row */}
      <div className="flex flex-1 gap-gutter min-h-0">

        {/* PREVIEW column */}
        <div className="flex-1 min-w-0 flex flex-col gap-sm min-h-0">
          <MonitorFrame
            item={previewItem}
            slideIdx={previewSlideIdx}
            getSlides={getSlides}
            emptyLabel="Nothing in Preview"
            isLive={false}
            backgroundPath={previewBgPath}
            channelTemplate={channelTemplate}
            stageChannelId={selectedChannel?.id}
            ltFontScale={ltFontScale}
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
        <div className="flex-1 min-w-0 flex flex-col gap-sm min-h-0">
          <MonitorFrame
            item={liveItem}
            slideIdx={liveSlideIdx}
            getSlides={getSlides}
            emptyLabel="Nothing Live"
            isLive={true}
            backgroundPath={liveBgPath}
            displayMode={displayMode}
            channelTemplate={selectedTemplate}
            stageChannelId={selectedChannel?.id}
            ltFontScale={ltFontScale}
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
                  {liveMediaName}
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
                  onClick={() => onToggleLoop?.()}
                  title={loopOn ? 'Looping — click to stop at end' : 'Loop this clip'}
                  className={`flex items-center justify-center w-7 h-6 rounded border transition-colors cursor-pointer shrink-0 ${
                    loopOn
                      ? 'border-primary/50 bg-surface-container text-primary'
                      : 'border-outline-variant/30 bg-surface-container text-on-surface-variant hover:border-primary/50 hover:text-primary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">repeat</span>
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
                <select
                  value={playRate}
                  onChange={handleRate}
                  title="Playback speed"
                  className={`h-6 rounded border bg-surface-container text-[10px] font-mono tabular-nums px-xs outline-none cursor-pointer shrink-0 transition-colors ${
                    playRate !== 1
                      ? 'border-primary/50 text-primary'
                      : 'border-outline-variant/30 text-on-surface-variant hover:border-primary/50'
                  }`}
                >
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <option key={r} value={r}>{r}×</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Monitor switches (scrollable, left) + Hotkeys/Jump arm toggles (fixed, right) */}
          {(multiChannel || onToggleBareArmed || (liveSlides.length > 1 && onToggleJumpArmed)) && (
            <div className="flex items-center gap-xs w-full min-w-0">
              {multiChannel && (
                <div className="flex items-center gap-xs flex-1 min-w-0 overflow-x-auto custom-scrollbar pb-[2px]">
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
              <div className="flex items-center gap-xs shrink-0 ml-auto">
                {onToggleBareArmed && (
                  <button
                    onClick={onToggleBareArmed}
                    title="Arm the bare transport keys (GO / Output / Clear). Disarmed, they're ignored so a stray keystroke can't air."
                    className={`flex items-center gap-xs text-[9px] font-mono uppercase tracking-[0.05em] px-xs py-[2px] rounded border transition-colors cursor-pointer ${
                      bareArmed
                        ? 'bg-tertiary/10 border-tertiary/40 text-tertiary'
                        : 'bg-surface-container border-outline-variant/30 text-on-surface-variant/60 hover:text-on-surface-variant'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[10px]">bolt</span>
                    Hotkeys {bareArmed ? 'ON' : 'OFF'}
                  </button>
                )}
                {liveSlides.length > 1 && onToggleJumpArmed && (
                  <button
                    onClick={onToggleJumpArmed}
                    title="Toggle Q/W/E… verse-jump keys for the live item"
                    className={`flex items-center gap-xs text-[9px] font-mono uppercase tracking-[0.05em] px-xs py-[2px] rounded border transition-colors cursor-pointer ${
                      jumpArmed
                        ? 'bg-tertiary/10 border-tertiary/40 text-tertiary'
                        : 'bg-surface-container border-outline-variant/30 text-on-surface-variant/60 hover:text-on-surface-variant'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[10px]">keyboard</span>
                    Jump {jumpArmed ? 'ON' : 'OFF'}
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto pr-xs">
            {liveSlides.length > 0 ? (
              <SlideList
                slides={liveSlides}
                activeIdx={liveSlideIdx}
                onSelect={onSelectLiveSlide}
                variant="live"
                jumpKeys={jumpKeys}
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
