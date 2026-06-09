import React, { useState, useEffect, useCallback, useRef } from 'react';
import RundownPanel from '../panels/RundownPanel';
import PreviewLivePanel from '../panels/PreviewLivePanel';
import LibraryPanel from '../panels/LibraryPanel';

function useResizeH(containerRef, defaultPct = 40) {
  const [pct, setPct] = useState(defaultPct);
  function start(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startPct = pct;
    function move(ev) {
      const w = containerRef.current?.offsetWidth ?? window.innerWidth;
      setPct(Math.max(22, Math.min(startPct + (ev.clientX - startX) / w * 100, 72)));
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
  return [pct, start];
}

function useResizeV(containerRef, defaultPct = 62) {
  const [pct, setPct] = useState(defaultPct);
  function start(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startPct = pct;
    function move(ev) {
      const h = containerRef.current?.offsetHeight ?? window.innerHeight;
      setPct(Math.max(35, Math.min(startPct + (ev.clientY - startY) / h * 100, 80)));
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
  return [pct, start];
}

export default function OperatorView({ transportRef, onStateChange }) {
  const [services, setServices] = useState([]);
  const [activeServiceId, setActiveServiceId] = useState(null);
  const [serviceData, setServiceData] = useState(null);

  const [previewItemId, setPreviewItemId] = useState(null);
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  const [liveItemId, setLiveItemId] = useState(null);
  const [liveSlideIdx, setLiveSlideIdx] = useState(0);
  const [liveCapture, setLiveCapture] = useState(null);

  useEffect(() => {
    window.cue.services.list().then((list) => {
      setServices(list);
      if (list.length > 0) setActiveServiceId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!activeServiceId) { setServiceData(null); return; }
    window.cue.services.get(activeServiceId).then(setServiceData);
  }, [activeServiceId]);

  useEffect(() => {
    window.cue.on('output:live-capture', (dataUrl) => setLiveCapture(dataUrl));
  }, []);

  const shortcutRef = useRef({});
  shortcutRef.current = { handleNextSlide, handlePrevSlide, handleGo, handleClear, handleLogo };

  // Bind transport handlers to App header ref (updated every render — no stale closures)
  if (transportRef) {
    transportRef.current = { go: handleGo, clear: handleClear, logo: handleLogo };
  }

  // Notify App header of live/preview state changes
  // Uses previewItemId + serviceData (not previewItem, which is declared later)
  useEffect(() => {
    const hasPreview = !!(serviceData?.items?.find((i) => i.id === previewItemId));
    onStateChange?.({ isLive: !!liveItemId, canGo: hasPreview });
  }, [liveItemId, previewItemId, serviceData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKeyDown(e) {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const h = shortcutRef.current;
      if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); h.handleNextSlide(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); h.handlePrevSlide(); }
      else if (e.key === 'Escape') h.handleClear();
      else if (e.key === 'g' || e.key === 'G') h.handleGo();
      else if (e.key === 'l' || e.key === 'L') h.handleLogo();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const refreshService = useCallback(() => {
    if (!activeServiceId) return;
    window.cue.services.get(activeServiceId).then(setServiceData);
  }, [activeServiceId]);

  const previewItem = serviceData?.items?.find((i) => i.id === previewItemId) ?? null;
  const liveItem = serviceData?.items?.find((i) => i.id === liveItemId) ?? null;

  function getSlides(item) {
    if (!item) return [];
    if (item.item_type === 'song') return item.sections || [];
    if (item.item_type === 'slide') return [{ id: item.id, type: 'slide', content: item.content }];
    return [];
  }

  function buildPayload(item, slideIdx) {
    const slides = getSlides(item);
    const slide = slides[slideIdx];
    if (!slide) return null;
    return {
      type: 'content',
      text: slide.content || '',
      sectionLabel: slide.type || '',
      copyright: item.song?.copyright || null,
      backgroundPath: resolveBackground(item),
      styleJson: slide.style_json ? JSON.parse(slide.style_json) : null,
    };
  }

  function resolveBackground(item) {
    if (item.background_override) return item.background_override.path;
    if (item.song?.default_background_id) {
      const bg = serviceData?.items?.find(i => i.id === item.id);
      if (bg?.background_override?.path) return bg.background_override.path;
    }
    return null;
  }

  function handleClickItem(item) {
    setPreviewItemId(item.id);
    setPreviewSlideIdx(0);
  }

  function handleDoubleClickItem(item) {
    setPreviewItemId(item.id);
    const slides = getSlides(item);
    if (!slides.length) return;
    const payload = buildPayload(item, 0);
    if (payload) {
      window.cue.output.go(payload);
      setLiveItemId(item.id);
      setLiveSlideIdx(0);
    }
  }

  function handleSelectPreviewSlide(idx) { setPreviewSlideIdx(idx); }

  function handleGoAtPreviewSlide(idx) {
    if (!previewItem) return;
    const payload = buildPayload(previewItem, idx);
    if (payload) {
      window.cue.output.go(payload);
      setLiveItemId(previewItem.id);
      setLiveSlideIdx(idx);
      setPreviewSlideIdx(idx);
    }
  }

  function handleSelectLiveSlide(idx) {
    if (!liveItem) return;
    const payload = buildPayload(liveItem, idx);
    if (payload) {
      window.cue.output.go(payload);
      setLiveSlideIdx(idx);
    }
  }

  function handleGo() {
    if (!previewItem) return;
    const payload = buildPayload(previewItem, previewSlideIdx);
    if (payload) {
      window.cue.output.go(payload);
      setLiveItemId(previewItem.id);
      setLiveSlideIdx(previewSlideIdx);
    }
  }

  function handleClear() {
    window.cue.output.clear();
    setLiveItemId(null);
  }

  function handleLogo() { window.cue.output.logo(); }

  function handleNextSlide() {
    if (!previewItem) return;
    const slides = getSlides(previewItem);
    setPreviewSlideIdx((idx) => Math.min(idx + 1, slides.length - 1));
  }

  function handlePrevSlide() {
    if (!previewItem) return;
    setPreviewSlideIdx((idx) => Math.max(idx - 1, 0));
  }

  async function handleReorder(orderedIds) {
    await window.cue.services.reorderItems(activeServiceId, orderedIds);
    refreshService();
  }

  async function handleRemoveItem(itemId) {
    await window.cue.services.removeItem(itemId);
    if (previewItemId === itemId) setPreviewItemId(null);
    if (liveItemId === itemId) setLiveItemId(null);
    refreshService();
  }

  async function handleAddToRundown(songId) {
    if (!activeServiceId) {
      const id = await window.cue.services.create({
        title: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        date: new Date().toISOString().split('T')[0],
      });
      setActiveServiceId(id);
      const list = await window.cue.services.list();
      setServices(list);
      await window.cue.services.addItem(id, { item_type: 'song', ref_id: songId });
      window.cue.services.get(id).then(setServiceData);
    } else {
      await window.cue.services.addItem(activeServiceId, { item_type: 'song', ref_id: songId });
      refreshService();
    }
  }

  async function handleAddService(title) {
    const id = await window.cue.services.create({ title, date: new Date().toISOString().split('T')[0] });
    const list = await window.cue.services.list();
    setServices(list);
    setActiveServiceId(id);
  }

  const containerRef = useRef(null);
  const [hPct, startHDrag] = useResizeH(containerRef, 25);
  const [vPct, startVDrag] = useResizeV(containerRef, 62);

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-background">
      {/* Top work area */}
      <div style={{ height: `${vPct}%` }} className="flex shrink-0 min-h-0 p-gutter gap-gutter">
        <div style={{ width: `${hPct}%` }} className="shrink-0 min-w-0 overflow-hidden">
          <RundownPanel
            services={services}
            activeServiceId={activeServiceId}
            serviceData={serviceData}
            previewItemId={previewItemId}
            liveItemId={liveItemId}
            onSelectService={setActiveServiceId}
            onClickItem={handleClickItem}
            onDoubleClickItem={handleDoubleClickItem}
            onReorder={handleReorder}
            onRemoveItem={handleRemoveItem}
            onAddService={handleAddService}
            onRefresh={refreshService}
          />
        </div>

        {/* Horizontal resize handle */}
        <div
          className="resize-h shrink-0 rounded-full transition-colors duration-100"
          style={{ width: 3, background: '#424754', cursor: 'col-resize' }}
          onMouseDown={startHDrag}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#adc6ff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#424754'; }}
        />

        <div className="flex-1 min-w-0 overflow-hidden">
          <PreviewLivePanel
            previewItem={previewItem}
            liveItem={liveItem}
            previewSlideIdx={previewSlideIdx}
            liveSlideIdx={liveSlideIdx}
            liveCapture={liveCapture}
            getSlides={getSlides}
            onSelectPreviewSlide={handleSelectPreviewSlide}
            onGoAtPreviewSlide={handleGoAtPreviewSlide}
            onSelectLiveSlide={handleSelectLiveSlide}
          />
        </div>
      </div>

      {/* Vertical resize handle */}
      <div
        className="resize-v shrink-0 transition-colors duration-100"
        style={{ height: 3, background: '#1e2024', cursor: 'row-resize' }}
        onMouseDown={startVDrag}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#adc6ff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#1e2024'; }}
      />

      {/* Library */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <LibraryPanel onAddToRundown={handleAddToRundown} onSongSave={refreshService} />
      </div>
    </div>
  );
}
