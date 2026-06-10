import React, { useState, useEffect, useRef } from 'react';
import SlideList from '../components/SlideList';
import { renderWithRuns } from '../components/SongEditor';
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

function MonitorFrame({ item, slideIdx, getSlides, emptyLabel, isLive, liveCapture, backgroundPath, displayMode, channelTemplate }) {
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

  const showCapture = isLive && !!liveCapture && (displayMode === 'content' || displayMode === 'cleared');
  const showScaled  = !showCapture && !(isLive && displayMode === 'cleared');

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
      {showScaled && (
        <>
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
                    {/\.(mp4|webm|mov)$/i.test(backgroundPath)
                      ? <video src={mediaUrl(backgroundPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} autoPlay loop muted />
                      : <img src={mediaUrl(backgroundPath)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />}
                  </div>
                )}

                {/* Content */}
                {isLT ? (
                  // Lower third: bottom-anchored, matches lowerthird.html exactly
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    padding: '24px 60px 32px',
                    background: buildBarBg(style?.ltBar),
                    minHeight: 160,
                    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                  }}>
                    <p style={textStyle} dangerouslySetInnerHTML={{ __html: renderWithRuns(slide.content, style?.runs) }} />
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
                })()}
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
        </>
      )}

      {/* Live capture — replaces scaled canvas when available */}
      {showCapture && (
        <img src={liveCapture} className="absolute inset-0 w-full h-full object-cover" alt="live" style={{ zIndex: 2 }} />
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
  liveCapture, displayMode, getSlides, previewBgPath, liveBgPath,
  onSelectPreviewSlide, onGoAtPreviewSlide, onSelectLiveSlide,
  channelTemplate,
  allChannels = [], channelCaptures = {}, liveChannelIdx = 0, onSetLiveChannelIdx,
}) {
  const previewSlides = previewItem ? getSlides(previewItem) : [];
  const liveSlides    = liveItem    ? getSlides(liveItem)    : [];

  // Derive capture + template for the selected live channel
  const selectedChannel     = allChannels[liveChannelIdx] ?? allChannels[0] ?? null;
  const selectedTemplate    = selectedChannel?.template ?? channelTemplate;
  // For the selected channel: screen channels use liveCapture (fast 200ms path) at idx 0,
  // NDI or non-primary channels use the multiview cache.
  const liveCaptureForFrame = (liveChannelIdx === 0 && selectedChannel?.type !== 'ndi')
    ? liveCapture
    : (selectedChannel ? channelCaptures[selectedChannel.id] ?? null : liveCapture);

  const multiChannel = allChannels.length > 1;

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
            liveCapture={null}
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
            liveCapture={liveCaptureForFrame}
            backgroundPath={liveBgPath}
            displayMode={displayMode}
            channelTemplate={selectedTemplate}
          />

          {/* Channel selector — only shown when 2+ channels */}
          {multiChannel && (
            <div className="flex items-center gap-xs flex-shrink-0 flex-wrap">
              {allChannels.map((ch, idx) => {
                const isSelected = idx === liveChannelIdx;
                const isNdi = ch.type === 'ndi';
                const hasFrame = !!channelCaptures[ch.id];
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
                      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${hasFrame ? 'bg-tertiary' : 'bg-outline-variant'}`} />
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
