import React, { useState, useEffect, useRef } from 'react';
import SlideList from '../components/SlideList';
import { renderWithRuns } from '../components/SongEditor';

function MonitorFrame({ item, slideIdx, getSlides, emptyLabel, isLive, liveCapture }) {
  const slides = getSlides(item ?? null);
  const slide = item ? slides[slideIdx] : null;
  const style = slide?.style_json ? JSON.parse(slide.style_json) : null;

  return (
    <div className={`w-full aspect-video relative overflow-hidden bg-black ${
      isLive ? 'monitor-live' : item ? 'monitor-preview' : 'monitor-idle'
    }`}>
      {/* Background */}
      {item?.background_override?.path && (
        <div className="absolute inset-0">
          {/\.(mp4|webm|mov)$/i.test(item.background_override.path) ? (
            <video src={`file://${item.background_override.path}`}
              className="w-full h-full object-cover" autoPlay loop muted />
          ) : (
            <img src={`file://${item.background_override.path}`}
              className="w-full h-full object-cover" alt="" />
          )}
        </div>
      )}

      {/* Live capture override */}
      {isLive && liveCapture && (
        <img src={liveCapture} className="absolute inset-0 w-full h-full object-cover" alt="live" />
      )}

      {/* Slide text */}
      <div className="absolute inset-0 flex items-center justify-center z-10 px-4 text-center">
        {slide ? (
          <p
            className="text-white text-[11px] leading-relaxed"
            style={{
              textShadow: '0 1px 8px rgba(0,0,0,0.98)',
              fontFamily: style?.fontFamily || undefined,
              fontSize:   style?.fontSize   ? style.fontSize + 'px' : undefined,
              textAlign:  style?.align      || 'center',
              fontWeight: style?.bold ? 700 : 400,
              fontStyle:  style?.italic     ? 'italic' : undefined,
              color:      style?.color      || undefined,
              lineHeight: style?.lineSpacing ? String(style.lineSpacing) : undefined,
            }}
            dangerouslySetInnerHTML={{ __html: renderWithRuns(slide.content, style?.runs) }}
          />
        ) : (
          <span className="text-slate-700 text-[10px] tracking-widest">{emptyLabel}</span>
        )}
      </div>

      {/* ON AIR badge — absolute so label row height is unaffected */}
      {isLive && item && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-red-600/90 border border-red-500/60 px-2 py-0.5 rounded-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span className="text-[9px] font-bold tracking-widest text-white">ON AIR</span>
        </div>
      )}
    </div>
  );
}

export default function PreviewLivePanel({
  previewItem, liveItem,
  previewSlideIdx, liveSlideIdx,
  liveCapture, getSlides,
  onGo, onClear, onLogo,
  onSelectPreviewSlide, onGoAtPreviewSlide,
  onSelectLiveSlide,
}) {
  const [layout, setLayout] = useState('stacked');
  const [monitorHeight, setMonitorHeight] = useState(270);
  const panelRef = useRef(null);
  const dragging = useRef(false);

  useEffect(() => {
    window.cue.settings.get('operator_preview_layout').then((v) => { if (v) setLayout(v); });
  }, []);

  function toggleLayout() {
    const next = layout === 'stacked' ? 'sidebyside' : 'stacked';
    setLayout(next);
    window.cue.settings.set('operator_preview_layout', next);
  }

  function startMonitorResize(e) {
    e.preventDefault();
    dragging.current = true;
    const startY = e.clientY;
    const startH = monitorHeight;
    function onMove(ev) {
      if (!dragging.current) return;
      const panelH = panelRef.current?.offsetHeight ?? 500;
      setMonitorHeight(Math.max(120, Math.min(startH + (ev.clientY - startY), panelH - 72)));
    }
    function onUp() {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  const titleFor = (item) => item?.song?.title || item?.asset?.filename || 'Slide';
  const previewSlides = previewItem ? getSlides(previewItem) : [];
  const liveSlides = liveItem ? getSlides(liveItem) : [];

  // Shared label row — fixed height prevents ON AIR badge from shifting layout
  function MonitorLabel({ dot, label, isActive, item }) {
    return (
      <div className="flex items-center gap-1.5 h-5 mb-1 flex-shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          isActive ? 'bg-red-500' : dot ? 'bg-indigo-500' : 'bg-slate-700'
        }`} />
        <span className={`text-[10px] font-bold tracking-[0.18em] uppercase flex-shrink-0 ${
          isActive ? 'live-text-glow' : 'text-slate-500'
        }`}>
          {label}
        </span>
        {item && (
          <span className="text-[10px] text-slate-600 truncate ml-0.5">
            — {titleFor(item)}
          </span>
        )}
      </div>
    );
  }

  function Transport() {
    return (
      <div className="flex gap-1.5 px-2 py-2 flex-shrink-0">
        <button onClick={onGo} disabled={!previewItem}
          className="btn-go flex-1 h-9 text-[11px] font-bold tracking-widest rounded-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.97]">
          GO <span className="opacity-30 font-normal text-[9px] tracking-normal">G</span>
        </button>
        <button onClick={onClear}
          className="btn-clear flex-1 h-9 text-[11px] font-bold tracking-widest rounded-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.97]">
          CLEAR <span className="opacity-30 font-normal text-[9px] tracking-normal">Esc</span>
        </button>
        <button onClick={onLogo}
          className="btn-logo flex-1 h-9 text-[11px] font-bold tracking-widest rounded-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.97]">
          LOGO <span className="opacity-30 font-normal text-[9px] tracking-normal">L</span>
        </button>
      </div>
    );
  }

  // Two side-by-side slide lists: preview (left) and live (right)
  const slideLists = (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Preview slides */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden border-r border-slate-800">
        <div className="flex items-center gap-1.5 px-3 h-7 flex-shrink-0 bg-slate-900 border-b border-slate-800">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
          <span className="panel-label">Preview Slides</span>
          {previewItem && (
            <span className="text-[10px] text-slate-600 truncate ml-1">— {titleFor(previewItem)}</span>
          )}
          <span className="text-[9px] text-slate-700 ml-auto flex-shrink-0">dbl-click → live</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {previewSlides.length > 0 ? (
            <SlideList
              slides={previewSlides}
              activeIdx={previewSlideIdx}
              onSelect={onSelectPreviewSlide}
              onDoubleClick={onGoAtPreviewSlide}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-700 text-[11px] tracking-wider">
              NOTHING IN PREVIEW
            </div>
          )}
        </div>
      </div>

      {/* Live slides */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 h-7 flex-shrink-0 bg-slate-900 border-b border-slate-800">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${liveItem ? 'bg-red-500' : 'bg-slate-700'}`} />
          <span className={`panel-label ${liveItem ? 'live-text-glow' : ''}`}>Live Slides</span>
          {liveItem && (
            <span className="text-[10px] text-slate-600 truncate ml-1">— {titleFor(liveItem)}</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {liveSlides.length > 0 ? (
            <SlideList
              slides={liveSlides}
              activeIdx={liveSlideIdx}
              onSelect={onSelectLiveSlide}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-700 text-[11px] tracking-wider">
              NOTHING LIVE
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Panel header */}
      <div className="panel-header flex-shrink-0 justify-between">
        <div className="flex items-center gap-2">
          <div className="w-0.5 h-3 bg-indigo-600 rounded-sm" />
          <span className="panel-label">Preview / Live</span>
        </div>
        <button onClick={toggleLayout}
          className="titlebar-nodrag text-[10px] text-slate-600 hover:text-slate-300 px-2 h-5 rounded-sm hover:bg-slate-700 transition-colors cursor-pointer tracking-wider">
          {layout === 'stacked' ? 'SIDE BY SIDE' : 'STACKED'}
        </button>
      </div>

      <div ref={panelRef} className="flex-1 overflow-hidden flex flex-col min-h-0">
        {layout === 'stacked' ? (
          <>
            {/* Monitor section — resizable height */}
            <div style={{ height: monitorHeight }} className="flex-none overflow-y-auto">
              <div className="p-2 flex flex-col gap-2">
                <div>
                  <MonitorLabel dot label="Preview" isActive={false} item={previewItem} />
                  <MonitorFrame item={previewItem} slideIdx={previewSlideIdx}
                    getSlides={getSlides} emptyLabel="NOTHING IN PREVIEW"
                    isLive={false} liveCapture={null} />
                </div>
                <div>
                  <MonitorLabel dot={false} label="Live" isActive={!!liveItem} item={liveItem} />
                  <MonitorFrame item={liveItem} slideIdx={liveSlideIdx}
                    getSlides={getSlides} emptyLabel="NOTHING LIVE"
                    isLive={!!liveItem} liveCapture={liveCapture} />
                </div>
              </div>
              <Transport />
            </div>

            {/* Resize handle */}
            <div className="resize-v flex-none h-[4px] bg-slate-800 hover:bg-indigo-500 transition-colors duration-150"
              onMouseDown={startMonitorResize} />

            {/* Dual slide lists */}
            {slideLists}
          </>
        ) : (
          /* Side-by-side */
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="p-2 flex gap-2 flex-none">
              <div className="flex-1 min-w-0">
                <MonitorLabel dot label="Preview" isActive={false} item={previewItem} />
                <MonitorFrame item={previewItem} slideIdx={previewSlideIdx}
                  getSlides={getSlides} emptyLabel="NOTHING IN PREVIEW"
                  isLive={false} liveCapture={null} />
              </div>
              <div className="flex-1 min-w-0">
                <MonitorLabel dot={false} label="Live" isActive={!!liveItem} item={liveItem} />
                <MonitorFrame item={liveItem} slideIdx={liveSlideIdx}
                  getSlides={getSlides} emptyLabel="NOTHING LIVE"
                  isLive={!!liveItem} liveCapture={liveCapture} />
              </div>
            </div>
            <Transport />
            <div className="border-t border-slate-800 flex-1 min-h-0 flex flex-col overflow-hidden">
              {slideLists}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
