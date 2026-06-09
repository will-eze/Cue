import React, { useState, useEffect, useCallback, useRef } from 'react';
import RundownPanel from '../panels/RundownPanel';
import PreviewLivePanel from '../panels/PreviewLivePanel';
import LibraryPanel from '../panels/LibraryPanel';

const isMac = window.cue.platform === 'darwin';

function UndoToast({ message, onUndo, onDismiss }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-md bg-surface-container-high border border-outline-variant/40 rounded-xl shadow-2xl px-lg py-sm ring-1 ring-white/5 pointer-events-auto">
      <span className="material-symbols-outlined text-[16px] text-on-surface-variant">undo</span>
      <span className="text-body-sm text-on-surface truncate max-w-[280px]">{message}</span>
      <button
        onClick={onUndo}
        className="text-label-sm font-mono text-primary hover:text-primary/80 uppercase tracking-[0.05em] cursor-pointer transition-colors ml-sm flex-shrink-0"
      >Undo</button>
      <button
        onClick={onDismiss}
        className="text-on-surface-variant/50 hover:text-on-surface-variant cursor-pointer ml-xs flex-shrink-0"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}

function useResizeH(containerRef, storageKey, defaultPct = 40) {
  const [pct, setPct] = useState(() => {
    const stored = storageKey && localStorage.getItem(storageKey);
    return stored ? parseFloat(stored) : defaultPct;
  });
  function start(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startPct = pct;
    function move(ev) {
      const w = containerRef.current?.offsetWidth ?? window.innerWidth;
      const next = Math.max(22, Math.min(startPct + (ev.clientX - startX) / w * 100, 72));
      setPct(next);
      if (storageKey) localStorage.setItem(storageKey, next.toFixed(1));
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

function useResizeV(containerRef, storageKey, defaultPct = 62) {
  const [pct, setPct] = useState(() => {
    const stored = storageKey && localStorage.getItem(storageKey);
    return stored ? parseFloat(stored) : defaultPct;
  });
  function start(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startPct = pct;
    function move(ev) {
      const h = containerRef.current?.offsetHeight ?? window.innerHeight;
      const next = Math.max(35, Math.min(startPct + (ev.clientY - startY) / h * 100, 80));
      setPct(next);
      if (storageKey) localStorage.setItem(storageKey, next.toFixed(1));
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

export default function OperatorView({
  transportRef, onStateChange, displayMode = 'idle', bgRefreshTick = 0,
  activeServiceId, onServiceChange, outputsEnabled, onToggleLive,
}) {
  const [services, setServices] = useState([]);
  const [serviceData, setServiceData] = useState(null);

  const [previewItemId, setPreviewItemId] = useState(null);
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  const [liveItemId, setLiveItemId] = useState(null);
  const [liveSlideIdx, setLiveSlideIdx] = useState(0);
  const [liveCapture, setLiveCapture] = useState(null);
  const [undoStack, setUndoStack] = useState(null);
  const undoTimerRef = useRef(null);

  // Shortcut config — loaded from settings, reloaded when bgRefreshTick changes (i.e. on return from Settings)
  const shortcutsRef = useRef({ modifier: isMac ? 'meta' : 'ctrl', go: 'g', clear: 'c', logo: 'l', live: 'o' });
  useEffect(() => {
    Promise.all([
      window.cue.settings.get('keyboard_modifier'),
      window.cue.settings.get('keyboard_go'),
      window.cue.settings.get('keyboard_clear'),
      window.cue.settings.get('keyboard_logo'),
      window.cue.settings.get('keyboard_live'),
    ]).then(([mod, go, clear, logo, live]) => {
      shortcutsRef.current = {
        modifier: mod  ?? (isMac ? 'meta' : 'ctrl'),
        go:       go   ?? 'g',
        clear:    clear ?? 'c',
        logo:     logo  ?? 'l',
        live:     live  ?? 'o',
      };
    });
  }, [bgRefreshTick]);

  // Ref for imperatively focusing the library search bar (triggered by S key)
  const focusSearchRef = useRef(null);

  useEffect(() => {
    window.cue.services.list().then((list) => {
      setServices(list);
      if (list.length > 0 && !activeServiceId) onServiceChange(list[0].id);
    });
  }, [bgRefreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeServiceId) { setServiceData(null); return; }
    window.cue.services.get(activeServiceId).then(setServiceData);
  }, [activeServiceId, bgRefreshTick]);

  useEffect(() => {
    window.cue.on('output:live-capture', (dataUrl) => setLiveCapture(dataUrl));
  }, []);

  const shortcutRef = useRef({});
  shortcutRef.current = { handleNextSlide, handlePrevSlide, handleGo, handleClear, handleLogo, handleLiveToggle };

  if (transportRef) {
    transportRef.current = { go: handleGo, clear: handleClear, logo: handleLogo };
  }

  useEffect(() => {
    const hasPreview = !!(serviceData?.items?.find((i) => i.id === previewItemId));
    onStateChange?.({ isLive: !!liveItemId, canGo: hasPreview });
  }, [liveItemId, previewItemId, serviceData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKeyDown(e) {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

      const h = shortcutRef.current;
      const sc = shortcutsRef.current;
      const hasModifier = sc.modifier === 'meta' ? e.metaKey : sc.modifier === 'alt' ? e.altKey : e.ctrlKey;

      if (hasModifier) {
        const k = e.key.toLowerCase();
        if (k === sc.go.toLowerCase())    { e.preventDefault(); h.handleGo();          return; }
        if (k === sc.clear.toLowerCase()) { e.preventDefault(); h.handleClear();       return; }
        if (k === sc.logo.toLowerCase())  { e.preventDefault(); h.handleLogo();        return; }
        if (k === sc.live.toLowerCase())  { e.preventDefault(); h.handleLiveToggle();  return; }
        return;
      }

      if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); h.handleNextSlide(); }
      else if (e.key === 'ArrowUp')               { e.preventDefault(); h.handlePrevSlide(); }
      else if (e.key === 'Escape')                { h.handleClear(); }
      else if (e.key === 'g' || e.key === 'G')    { h.handleGo(); }
      else if (e.key === 'l' || e.key === 'L')    { h.handleLogo(); }
      else if (e.key === 's' || e.key === 'S')    { e.preventDefault(); focusSearchRef.current?.(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const refreshService = useCallback(() => {
    if (!activeServiceId) return;
    window.cue.services.get(activeServiceId).then(setServiceData);
  }, [activeServiceId]);

  const previewItem = serviceData?.items?.find((i) => i.id === previewItemId) ?? null;
  const liveItem    = serviceData?.items?.find((i) => i.id === liveItemId)    ?? null;

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
    if (item.background_override?.path) return item.background_override.path;
    if (item.song?.default_background?.path) return item.song.default_background.path;
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
  }

  function handleLogo() { window.cue.output.logo(); }

  function handleLiveToggle() { onToggleLive?.(); }

  function handleNextSlide() {
    if (!previewItem) {
      // Nothing in preview — load first rundown item
      const items = serviceData?.items || [];
      if (items.length > 0) { setPreviewItemId(items[0].id); setPreviewSlideIdx(0); }
      return;
    }
    const slides = getSlides(previewItem);
    if (previewSlideIdx < slides.length - 1) {
      const nextIdx = previewSlideIdx + 1;
      setPreviewSlideIdx(nextIdx);
      // Auto-GO when preview and live are on the same item
      if (previewItemId === liveItemId) {
        const payload = buildPayload(previewItem, nextIdx);
        if (payload) { window.cue.output.go(payload); setLiveSlideIdx(nextIdx); }
      }
    } else {
      // At last slide — advance to next rundown item
      const items = serviceData?.items || [];
      const curIdx = items.findIndex((i) => i.id === previewItemId);
      if (curIdx < items.length - 1) {
        setPreviewItemId(items[curIdx + 1].id);
        setPreviewSlideIdx(0);
      }
    }
  }

  function handlePrevSlide() {
    if (!previewItem) return;
    if (previewSlideIdx > 0) {
      const prevIdx = previewSlideIdx - 1;
      setPreviewSlideIdx(prevIdx);
      // Auto-GO when preview and live are on the same item
      if (previewItemId === liveItemId) {
        const payload = buildPayload(previewItem, prevIdx);
        if (payload) { window.cue.output.go(payload); setLiveSlideIdx(prevIdx); }
      }
    } else {
      // At first slide — go to previous rundown item (at its last slide)
      const items = serviceData?.items || [];
      const curIdx = items.findIndex((i) => i.id === previewItemId);
      if (curIdx > 0) {
        const prevItem = items[curIdx - 1];
        const prevSlides = getSlides(prevItem);
        setPreviewItemId(prevItem.id);
        setPreviewSlideIdx(Math.max(prevSlides.length - 1, 0));
      }
    }
  }

  async function handleReorder(orderedIds) {
    await window.cue.services.reorderItems(activeServiceId, orderedIds);
    refreshService();
  }

  async function handleRemoveItem(itemId) {
    const items = serviceData?.items || [];
    const idx = items.findIndex((i) => i.id === itemId);
    const item = items[idx];

    await window.cue.services.removeItem(itemId);
    if (previewItemId === itemId) setPreviewItemId(null);
    if (liveItemId === itemId) setLiveItemId(null);
    refreshService();

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const remainingIds = items.filter((i) => i.id !== itemId).map((i) => i.id);
    const label = item?.song?.title || item?.asset?.filename || 'Item';
    const serviceIdAtRemoval = activeServiceId;

    undoTimerRef.current = setTimeout(() => setUndoStack(null), 5000);
    setUndoStack({
      message: `"${label}" removed from rundown`,
      undo: async () => {
        clearTimeout(undoTimerRef.current);
        setUndoStack(null);
        const newItemId = await window.cue.services.addItem(serviceIdAtRemoval, {
          item_type: item.item_type,
          ref_id: item.ref_id,
          notes: item.notes,
          content: item.content,
          background_override_id: item.background_override_id ?? null,
        });
        const reordered = [
          ...remainingIds.slice(0, idx),
          newItemId,
          ...remainingIds.slice(idx),
        ];
        await window.cue.services.reorderItems(serviceIdAtRemoval, reordered);
        refreshService();
      },
    });
  }

  async function handleDuplicateItem(itemId) {
    await window.cue.services.duplicateItem(itemId);
    refreshService();
  }

  async function handleAddToRundown(songId) {
    if (!activeServiceId) {
      const id = await window.cue.services.create({
        title: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        date: new Date().toISOString().split('T')[0],
      });
      onServiceChange(id);
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
    onServiceChange(id);
  }

  async function handleRenameService(newTitle) {
    if (!activeServiceId) return;
    const svc = services.find((s) => s.id === activeServiceId);
    if (!svc) return;
    await window.cue.services.update(activeServiceId, { title: newTitle, date: svc.date, notes: svc.notes });
    const list = await window.cue.services.list();
    setServices(list);
  }

  async function handleDeleteService() {
    if (!activeServiceId) return;
    await window.cue.services.delete(activeServiceId);
    if (previewItemId) setPreviewItemId(null);
    if (liveItemId) setLiveItemId(null);
    const list = await window.cue.services.list();
    setServices(list);
    onServiceChange(list.length > 0 ? list[0].id : null);
  }

  const previewBgPath = previewItem ? resolveBackground(previewItem) : null;
  const liveBgPath    = liveItem    ? resolveBackground(liveItem)    : null;

  const containerRef = useRef(null);
  const [hPct, startHDrag] = useResizeH(containerRef, 'layout_h_pct', 25);
  const [vPct, startVDrag] = useResizeV(containerRef, 'layout_v_pct', 62);

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
            onSelectService={onServiceChange}
            onClickItem={handleClickItem}
            onDoubleClickItem={handleDoubleClickItem}
            onReorder={handleReorder}
            onRemoveItem={handleRemoveItem}
            onDuplicate={handleDuplicateItem}
            onAddService={handleAddService}
            onRenameService={handleRenameService}
            onDeleteService={handleDeleteService}
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
            displayMode={displayMode}
            getSlides={getSlides}
            previewBgPath={previewBgPath}
            liveBgPath={liveBgPath}
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
        <LibraryPanel
          onAddToRundown={handleAddToRundown}
          onSongSave={refreshService}
          refreshTick={bgRefreshTick}
          focusSearchRef={focusSearchRef}
        />
      </div>

      {undoStack && (
        <UndoToast
          message={undoStack.message}
          onUndo={undoStack.undo}
          onDismiss={() => { clearTimeout(undoTimerRef.current); setUndoStack(null); }}
        />
      )}
    </div>
  );
}
