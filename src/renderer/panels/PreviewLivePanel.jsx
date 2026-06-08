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

      {/* Subtle vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)',
        zIndex: 1,
      }} />

      {/* Live capture override */}
      {isLive && liveCapture && (
        <img src={liveCapture} className="absolute inset-0 w-full h-full object-cover" alt="live" style={{ zIndex: 2 }} />
      )}

      {/* Slide text */}
      <div className="absolute inset-0 flex items-center justify-center z-10 px-4 text-center" style={{ zIndex: 3 }}>
        {slide ? (
          <p
            className="text-white text-[11px] leading-relaxed"
            style={{
              textShadow: '0 1px 12px rgba(0,0,0,1), 0 2px 24px rgba(0,0,0,0.8)',
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
          <span style={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.2em',
            color: '#1E2232',
            textTransform: 'uppercase',
          }}>
            {emptyLabel}
          </span>
        )}
      </div>

      {/* ON AIR badge */}
      {isLive && item && (
        <div className="absolute top-2 right-2 flex items-center gap-1.5" style={{
          zIndex: 20,
          background: 'rgba(185,28,28,0.92)',
          border: '1px solid rgba(239,68,68,0.5)',
          padding: '2px 7px 2px 5px',
          borderRadius: 2,
          backdropFilter: 'blur(4px)',
        }}>
          <span className="dot-pulse" style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: '#FCA5A5',
            flexShrink: 0,
            display: 'block',
          }} />
          <span style={{
            fontSize: 8.5,
            fontWeight: 800,
            letterSpacing: '0.18em',
            color: '#FEE2E2',
          }}>
            ON AIR
          </span>
        </div>
      )}
    </div>
  );
}

function MonitorLabel({ dot, label, isActive, item }) {
  const titleFor = (i) => i?.song?.title || i?.asset?.filename || 'Slide';
  return (
    <div className="flex items-center gap-2 mb-1.5 flex-shrink-0" style={{ height: 18 }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: isActive ? '#EF4444' : dot ? '#4F6EF7' : '#1E2232',
        flexShrink: 0,
        ...(isActive ? { boxShadow: '0 0 6px rgba(239,68,68,0.6)' } : {}),
      }} />
      <span className={isActive ? 'live-text-glow' : ''} style={{
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: isActive ? undefined : '#404563',
        flexShrink: 0,
      }}>
        {label}
      </span>
      {item && (
        <span style={{
          fontSize: 10,
          color: '#2A2E42',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          — {titleFor(item)}
        </span>
      )}
    </div>
  );
}

function Transport({ onGo, onClear, onLogo, previewItem }) {
  return (
    <div className="flex gap-1.5 flex-shrink-0" style={{ padding: '6px 8px' }}>
      <button
        onClick={onGo}
        disabled={!previewItem}
        className="btn-go flex-1 cursor-pointer flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
        style={{ height: 42, borderRadius: 3, fontSize: 11, fontWeight: 800 }}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
          <path d="M3 2l7 4-7 4V2z"/>
        </svg>
        GO
        <span className="kbd-hint">G</span>
      </button>
      <button
        onClick={onClear}
        className="btn-clear cursor-pointer flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
        style={{ height: 42, flex: '0 0 auto', minWidth: 80, borderRadius: 3, fontSize: 11, fontWeight: 700 }}
      >
        CLEAR
        <span className="kbd-hint">Esc</span>
      </button>
      <button
        onClick={onLogo}
        className="btn-logo cursor-pointer flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
        style={{ height: 42, flex: '0 0 auto', minWidth: 72, borderRadius: 3, fontSize: 11, fontWeight: 700 }}
      >
        LOGO
        <span className="kbd-hint">L</span>
      </button>
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

  const previewSlides = previewItem ? getSlides(previewItem) : [];
  const liveSlides = liveItem ? getSlides(liveItem) : [];

  const slideLists = (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Preview slides */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{ borderRight: '1px solid #12151F' }}>
        <div className="flex items-center gap-2 flex-shrink-0" style={{
          padding: '0 10px',
          height: 28,
          background: '#0A0C14',
          borderBottom: '1px solid #12151F',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4F6EF7', flexShrink: 0 }} />
          <span className="panel-label">Preview</span>
          {previewItem && (
            <span style={{ fontSize: 10, color: '#2A2E42', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              — {previewItem?.song?.title || previewItem?.asset?.filename || 'Slide'}
            </span>
          )}
          <span style={{ fontSize: 8.5, color: '#272B3C', marginLeft: 'auto', flexShrink: 0, letterSpacing: '0.06em' }}>
            dbl-click → live
          </span>
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
            <div className="flex items-center justify-center h-full" style={{ color: '#1E2232', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Nothing in preview
            </div>
          )}
        </div>
      </div>

      {/* Live slides */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 flex-shrink-0" style={{
          padding: '0 10px',
          height: 28,
          background: '#0A0C14',
          borderBottom: '1px solid #12151F',
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: liveItem ? '#EF4444' : '#1E2232',
            flexShrink: 0,
            ...(liveItem ? { boxShadow: '0 0 5px rgba(239,68,68,0.5)' } : {}),
          }} />
          <span className={`panel-label ${liveItem ? 'live-text-glow' : ''}`}>Live</span>
          {liveItem && (
            <span style={{ fontSize: 10, color: '#2A2E42', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              — {liveItem?.song?.title || liveItem?.asset?.filename || 'Slide'}
            </span>
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
            <div className="flex items-center justify-center h-full" style={{ color: '#1E2232', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Nothing live
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full" style={{ background: '#060810' }}>
      {/* Panel header */}
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div className="flex items-center gap-2">
          <div style={{ width: 2, height: 14, background: 'linear-gradient(180deg, #EF4444 0%, #F59E0B 100%)', borderRadius: 1 }} />
          <span className="panel-label">Preview / Live</span>
        </div>
        <button
          onClick={toggleLayout}
          className="cursor-pointer transition-colors"
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#404563',
            background: '#0E1018',
            border: '1px solid #1E2232',
            padding: '2px 8px',
            borderRadius: 3,
            height: 20,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#8890A8'; e.currentTarget.style.borderColor = '#333852'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#404563'; e.currentTarget.style.borderColor = '#1E2232'; }}
        >
          {layout === 'stacked' ? 'Side by Side' : 'Stacked'}
        </button>
      </div>

      <div ref={panelRef} className="flex-1 overflow-hidden flex flex-col min-h-0">
        {layout === 'stacked' ? (
          <>
            {/* Monitor section — resizable height */}
            <div style={{ height: monitorHeight }} className="flex-none overflow-y-auto">
              <div style={{ padding: '8px 8px 0' }}>
                {/* Preview monitor */}
                <div style={{ marginBottom: 8 }}>
                  <MonitorLabel dot label="Preview" isActive={false} item={previewItem} />
                  <MonitorFrame item={previewItem} slideIdx={previewSlideIdx}
                    getSlides={getSlides} emptyLabel="Nothing in preview"
                    isLive={false} liveCapture={null} />
                </div>
                {/* Live monitor */}
                <div>
                  <MonitorLabel dot={false} label="Live" isActive={!!liveItem} item={liveItem} />
                  <MonitorFrame item={liveItem} slideIdx={liveSlideIdx}
                    getSlides={getSlides} emptyLabel="Nothing live"
                    isLive={!!liveItem} liveCapture={liveCapture} />
                </div>
              </div>
              <Transport onGo={onGo} onClear={onClear} onLogo={onLogo} previewItem={previewItem} />
            </div>

            {/* Resize handle */}
            <div
              className="resize-v flex-none transition-colors duration-150"
              style={{ height: 3, background: '#181C2A' }}
              onMouseDown={startMonitorResize}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#4F6EF7'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#181C2A'; }}
            />

            {slideLists}
          </>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <div style={{ padding: 8 }} className="flex gap-2 flex-none">
              <div className="flex-1 min-w-0">
                <MonitorLabel dot label="Preview" isActive={false} item={previewItem} />
                <MonitorFrame item={previewItem} slideIdx={previewSlideIdx}
                  getSlides={getSlides} emptyLabel="Nothing in preview"
                  isLive={false} liveCapture={null} />
              </div>
              <div className="flex-1 min-w-0">
                <MonitorLabel dot={false} label="Live" isActive={!!liveItem} item={liveItem} />
                <MonitorFrame item={liveItem} slideIdx={liveSlideIdx}
                  getSlides={getSlides} emptyLabel="Nothing live"
                  isLive={!!liveItem} liveCapture={liveCapture} />
              </div>
            </div>
            <Transport onGo={onGo} onClear={onClear} onLogo={onLogo} previewItem={previewItem} />
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ borderTop: '1px solid #12151F' }}>
              {slideLists}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
