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

      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.6) 100%)',
        zIndex: 1,
      }} />

      {isLive && liveCapture && (
        <img src={liveCapture} className="absolute inset-0 w-full h-full object-cover"
          alt="live" style={{ zIndex: 2 }} />
      )}

      <div className="absolute inset-0 flex items-center justify-center px-4 text-center" style={{ zIndex: 3 }}>
        {slide ? (
          <p className="text-white text-[11px] leading-relaxed" style={{
            textShadow: '0 1px 10px rgba(0,0,0,1), 0 2px 24px rgba(0,0,0,0.9)',
            fontFamily: style?.fontFamily || undefined,
            fontSize: style?.fontSize ? style.fontSize + 'px' : undefined,
            textAlign: style?.align || 'center',
            fontWeight: style?.bold ? 700 : 400,
            fontStyle: style?.italic ? 'italic' : undefined,
            color: style?.color || undefined,
            lineHeight: style?.lineSpacing ? String(style.lineSpacing) : undefined,
          }}
          dangerouslySetInnerHTML={{ __html: renderWithRuns(slide.content, style?.runs) }}
          />
        ) : (
          <span style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9,
            fontWeight: 400,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: '#201D18',
          }}>
            {emptyLabel}
          </span>
        )}
      </div>

      {/* ON AIR badge */}
      {isLive && item && (
        <div className="absolute top-2 right-2 flex items-center gap-1.5" style={{
          zIndex: 20,
          background: 'rgba(160,20,20,0.9)',
          border: '1px solid rgba(224,53,53,0.5)',
          padding: '2px 8px 2px 5px',
          borderRadius: 1,
        }}>
          <span className="dot-pulse" style={{
            width: 5, height: 5, borderRadius: '50%',
            background: '#FCA5A5', flexShrink: 0, display: 'block',
          }} />
          <span style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: '0.22em',
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, height: 16, flexShrink: 0 }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
        background: isActive ? '#E03535' : dot ? '#C8780A' : '#201D18',
        boxShadow: isActive ? '0 0 6px rgba(224,53,53,0.6)' : dot ? '0 0 4px rgba(200,120,10,0.4)' : 'none',
      }} />
      <span className={isActive ? 'live-text-glow' : ''} style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: isActive ? undefined : '#403830',
        flexShrink: 0,
      }}>
        {label}
      </span>
      {item && (
        <span style={{
          fontSize: 10,
          color: '#2A2218',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: "'Inter', sans-serif",
        }}>
          — {titleFor(item)}
        </span>
      )}
    </div>
  );
}

function Transport({ onGo, onClear, onLogo, previewItem }) {
  return (
    <div style={{ display: 'flex', gap: 5, padding: '6px 8px', flexShrink: 0 }}>
      <button
        onClick={onGo}
        disabled={!previewItem}
        className="btn-go cursor-pointer flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
        style={{ flex: 2, height: 44, borderRadius: 2, fontSize: 12 }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
          <path d="M3 2l7 4-7 4V2z"/>
        </svg>
        GO
        <span className="kbd-hint">G</span>
      </button>
      <button
        onClick={onClear}
        className="btn-clear cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.99] transition-transform"
        style={{ flex: 1, height: 44, borderRadius: 2, fontSize: 12, minWidth: 72 }}
      >
        CLEAR
        <span className="kbd-hint">Esc</span>
      </button>
      <button
        onClick={onLogo}
        className="btn-logo cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.99] transition-transform"
        style={{ flex: 1, height: 44, borderRadius: 2, fontSize: 12, minWidth: 66 }}
      >
        LOGO
        <span className="kbd-hint">L</span>
      </button>
    </div>
  );
}

export default function PreviewLivePanel({
  previewItem, liveItem, previewSlideIdx, liveSlideIdx,
  liveCapture, getSlides, onGo, onClear, onLogo,
  onSelectPreviewSlide, onGoAtPreviewSlide, onSelectLiveSlide,
}) {
  const [layout, setLayout] = useState('stacked');
  const [monitorHeight, setMonitorHeight] = useState(280);
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
      setMonitorHeight(Math.max(120, Math.min(startH + (ev.clientY - startY), panelH - 60)));
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
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Preview slides */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #181510' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
          height: 26, flexShrink: 0,
          background: 'linear-gradient(180deg, #141210 0%, #111008 100%)',
          borderBottom: '1px solid #181510',
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#C8780A', flexShrink: 0, boxShadow: '0 0 4px rgba(200,120,10,0.4)' }} />
          <span className="panel-label" style={{ fontSize: 9 }}>Preview</span>
          {previewItem && (
            <span style={{ fontSize: 10, color: '#2A2218', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'Inter', sans-serif" }}>
              — {previewItem?.song?.title || previewItem?.asset?.filename || 'Slide'}
            </span>
          )}
          <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 8, letterSpacing: '0.14em', color: '#2A2218', marginLeft: 'auto', flexShrink: 0, textTransform: 'uppercase' }}>
            dbl → live
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {previewSlides.length > 0 ? (
            <SlideList slides={previewSlides} activeIdx={previewSlideIdx}
              onSelect={onSelectPreviewSlide} onDoubleClick={onGoAtPreviewSlide} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: "'Oswald', sans-serif", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#201D18' }}>
              Nothing in Preview
            </div>
          )}
        </div>
      </div>

      {/* Live slides */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
          height: 26, flexShrink: 0,
          background: 'linear-gradient(180deg, #141210 0%, #111008 100%)',
          borderBottom: '1px solid #181510',
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
            background: liveItem ? '#E03535' : '#201D18',
            boxShadow: liveItem ? '0 0 5px rgba(224,53,53,0.55)' : 'none',
          }} />
          <span className={`panel-label ${liveItem ? 'live-text-glow' : ''}`} style={{ fontSize: 9 }}>Live</span>
          {liveItem && (
            <span style={{ fontSize: 10, color: '#2A2218', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'Inter', sans-serif" }}>
              — {liveItem?.song?.title || liveItem?.asset?.filename || 'Slide'}
            </span>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {liveSlides.length > 0 ? (
            <SlideList slides={liveSlides} activeIdx={liveSlideIdx} onSelect={onSelectLiveSlide} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: "'Oswald', sans-serif", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#201D18' }}>
              Nothing Live
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0C0A08' }}>
      {/* Panel header */}
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <span className="panel-label">Preview / Live</span>
        <button
          onClick={toggleLayout}
          className="cursor-pointer"
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9,
            fontWeight: 400,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: '#3A332A',
            background: '#141210',
            border: '1px solid #2A2520',
            padding: '2px 8px',
            borderRadius: 2,
            height: 18,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#7A7068'; e.currentTarget.style.borderColor = '#3A332A'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#3A332A'; e.currentTarget.style.borderColor = '#2A2520'; }}
        >
          {layout === 'stacked' ? 'Side by Side' : 'Stacked'}
        </button>
      </div>

      <div ref={panelRef} style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {layout === 'stacked' ? (
          <>
            <div style={{ height: monitorHeight, flexShrink: 0, overflowY: 'auto' }}>
              <div style={{ padding: '8px 8px 0' }}>
                <div style={{ marginBottom: 8 }}>
                  <MonitorLabel dot label="Preview" isActive={false} item={previewItem} />
                  <MonitorFrame item={previewItem} slideIdx={previewSlideIdx}
                    getSlides={getSlides} emptyLabel="Nothing in Preview"
                    isLive={false} liveCapture={null} />
                </div>
                <div>
                  <MonitorLabel dot={false} label="Live" isActive={!!liveItem} item={liveItem} />
                  <MonitorFrame item={liveItem} slideIdx={liveSlideIdx}
                    getSlides={getSlides} emptyLabel="Nothing Live"
                    isLive={!!liveItem} liveCapture={liveCapture} />
                </div>
              </div>
              <Transport onGo={onGo} onClear={onClear} onLogo={onLogo} previewItem={previewItem} />
            </div>

            <div
              className="resize-v flex-none transition-colors duration-100"
              style={{ height: 3, background: '#201D18', flexShrink: 0 }}
              onMouseDown={startMonitorResize}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#C8780A'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#201D18'; }}
            />

            {slideLists}
          </>
        ) : (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: 8, display: 'flex', gap: 8, flexShrink: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <MonitorLabel dot label="Preview" isActive={false} item={previewItem} />
                <MonitorFrame item={previewItem} slideIdx={previewSlideIdx}
                  getSlides={getSlides} emptyLabel="Nothing in Preview"
                  isLive={false} liveCapture={null} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <MonitorLabel dot={false} label="Live" isActive={!!liveItem} item={liveItem} />
                <MonitorFrame item={liveItem} slideIdx={liveSlideIdx}
                  getSlides={getSlides} emptyLabel="Nothing Live"
                  isLive={!!liveItem} liveCapture={liveCapture} />
              </div>
            </div>
            <Transport onGo={onGo} onClear={onClear} onLogo={onLogo} previewItem={previewItem} />
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTop: '1px solid #181510' }}>
              {slideLists}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
