import React, { useState, useEffect, useRef } from 'react';
import SlideList from '../components/SlideList';
import { renderWithRuns } from '../components/SongEditor';
import { mediaUrl } from '../utils/mediaUrl';

function MonitorFrame({ item, slideIdx, getSlides, emptyLabel, isLive, liveCapture, backgroundPath, displayMode }) {
  const slides = getSlides(item ?? null);
  const slide = item ? slides[slideIdx] : null;
  const style = slide?.style_json ? JSON.parse(slide.style_json) : null;

  // Show the live capture only for content/cleared — not for logo (keep showing the song)
  // or idle (stale capture from a previous session).
  const showCapture = isLive && !!liveCapture && (displayMode === 'content' || displayMode === 'cleared');
  // Show the text/empty overlay unless the capture is taking the full frame,
  // or we're in cleared mode (background shows, no text on output).
  const showTextOverlay = !showCapture && !(isLive && displayMode === 'cleared');

  const className = `w-full aspect-video relative overflow-hidden bg-black rounded-lg shrink-0 ${
    isLive ? 'monitor-live' : item ? 'monitor-preview' : 'monitor-idle'
  }`;

  return (
    <div className={className}>
      {/* Background media */}
      {backgroundPath && (
        <div className="absolute inset-0">
          {/\.(mp4|webm|mov)$/i.test(backgroundPath) ? (
            <video src={mediaUrl(backgroundPath)}
              className="w-full h-full object-cover opacity-60" autoPlay loop muted />
          ) : (
            <img src={mediaUrl(backgroundPath)}
              className="w-full h-full object-cover opacity-60" alt="" />
          )}
        </div>
      )}

      {/* Live capture — only shown for content/cleared; logo mode keeps song visible */}
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

      {/* Slide text — suppressed when capture covers the frame or output is cleared */}
      {showTextOverlay && (
        <div className="absolute inset-0 flex items-center justify-center px-md text-center" style={{ zIndex: 3 }}>
          {slide ? (
            <p className="text-white text-[11px] leading-relaxed drop-shadow-lg" style={{
              fontFamily: style?.fontFamily || undefined,
              fontSize: style?.fontSize ? style.fontSize + 'px' : undefined,
              textAlign: style?.align || 'center',
              fontWeight: style?.bold ? 700 : 400,
              fontStyle: style?.italic ? 'italic' : undefined,
              color: style?.color || undefined,
              lineHeight: style?.lineSpacing ? String(style.lineSpacing) : undefined,
              textShadow: '0 1px 10px rgba(0,0,0,1), 0 2px 24px rgba(0,0,0,0.9)',
            }}
            dangerouslySetInnerHTML={{ __html: renderWithRuns(slide.content, style?.runs) }}
            />
          ) : (
            <span className="text-label-sm font-label-sm uppercase tracking-widest text-outline-variant">
              {emptyLabel}
            </span>
          )}
        </div>
      )}

      {/* ON AIR pulsing dot */}
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
}) {
  const previewSlides = previewItem ? getSlides(previewItem) : [];
  const liveSlides = liveItem ? getSlides(liveItem) : [];

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
          />
          {/* Preview slide list */}
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
            liveCapture={liveCapture}
            backgroundPath={liveBgPath}
            displayMode={displayMode}
          />
          {/* Live slide list */}
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
