import React, { useState, useEffect, useRef } from 'react';
import SlideList from '../components/SlideList';
import { renderWithRuns, copyrightCss } from '../components/SongEditor';
import { mediaUrl } from '../utils/mediaUrl';

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

function MonitorFrame({ item, slideIdx, getSlides, emptyLabel, isLive, backgroundPath, displayMode, channelTemplate, transport }) {
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

  // Attribution line — scripture slides carry "Book c:v (VERSION)", songs use the
  // song copyright. Scripture sits bottom-right; everything else stays centred.
  const copyrightText  = slide ? (slide.copyright ?? item?.song?.copyright ?? null) : null;
  const copyrightRight = item?.item_type === 'scripture';
  const copyrightStyle = slide?._refStyle ?? null; // scripture reference style

  // The monitor renders the slide from the payload (no screen-capture). In the
  // live 'cleared' state the audience output keeps the background but hides the
  // text, so we mirror that by suppressing the text block.
  const hideText = isLive && displayMode === 'cleared';

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
