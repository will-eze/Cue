import React, { useState, useEffect, useCallback, useRef } from 'react';
import RundownPanel from '../panels/RundownPanel';
import PreviewLivePanel from '../panels/PreviewLivePanel';
import LibraryPanel from '../panels/LibraryPanel';
import ScriptureDetectionPanel from '../panels/ScriptureDetectionPanel';
import { useScriptureCapture } from '../audio/useScriptureCapture';
import { sectionLabels, sectionLabelAt } from '../utils/sectionLabels';

const isMac = window.cue.platform === 'darwin';

// Display label for a slide. Songs get numbered section labels (Verse 1/Verse 2);
// scripture/media slides keep their own label (the reference / type).
function labelForSlide(item, slides, idx) {
  if (item?.item_type === 'song') return sectionLabelAt(slides, idx);
  return slides[idx]?.type || '';
}

// A short text preview of a presentation slide (its first text element) — used for
// the stage "coming next" text and the network-remote slide preview. Presentation
// slides carry no single `content` string (they're a multi-element canvas).
function presentationSlideText(slide) {
  const el = (slide?.elements || []).find((e) => e?.type === 'text' && e.text);
  return el ? el.text : '';
}

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
  transportRef, onStateChange, displayMode = 'idle', liveMediaStartAt = null, bgRefreshTick = 0,
  activeServiceId, onServiceChange, onToggleLive,
}) {
  const [services, setServices] = useState([]);
  const [serviceData, setServiceData] = useState(null);
  const [songEditTick, setSongEditTick] = useState(0); // bumped when a song is edited from the rundown, to refresh the library
  const [channels, setChannels] = useState([]);
  const [liveChannelIdx, setLiveChannelIdx] = useState(0);

  const [previewItemId, setPreviewItemId] = useState(null);
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  const [liveItemId, setLiveItemId] = useState(null);
  const [liveSlideIdx, setLiveSlideIdx] = useState(0);
  // Scripture sent live directly from the Scriptures tab — a synthetic live source
  // that isn't a rundown item. Mutually exclusive with a live rundown item.
  const [liveScripture, setLiveScripture] = useState(null); // { item } | null

  // Global scripture appearance — style applied to every verse + default background.
  // Edited in the Scriptures tab (ScriptureEditor) / Settings; resolution mirrors songs.
  const [scriptureStyle, setScriptureStyle] = useState(null);     // verse style_json | null
  const [scriptureRefStyle, setScriptureRefStyle] = useState(null); // reference style_json | null
  const [scriptureBgPath, setScriptureBgPath] = useState(null);   // resolved media path | null
  const [slideBgPath, setSlideBgPath] = useState(null);           // global presentation/slide bg | null

  const loadScriptureDefaults = useCallback(async () => {
    const styleJson = await window.cue.settings.get('scripture_style_json');
    setScriptureStyle(styleJson || null);
    const refJson = await window.cue.settings.get('scripture_ref_style_json');
    setScriptureRefStyle(refJson || null);
    const bgId = await window.cue.settings.get('global_bg_scripture_id');
    const bg = bgId ? await window.cue.media.get(bgId) : null;
    setScriptureBgPath(bg?.path || null);
    const slideBgId = await window.cue.settings.get('global_bg_slide_id');
    const slideBg = slideBgId ? await window.cue.media.get(slideBgId) : null;
    setSlideBgPath(slideBg?.path || null);
  }, []);
  useEffect(() => { loadScriptureDefaults(); }, [loadScriptureDefaults, bgRefreshTick]);

  // ── Scripture detection (listen → suggest verse) ──────────────────────────
  // Detection is a virtual operator, like the network remote: main resolves a
  // candidate and sends 'scripture:detected'; OperatorView resolves the passage
  // via the EXISTING bible.resolve IPC and reuses handleScriptureLive — no new
  // payload building, no scripture preview machinery.
  const [detectCfg, setDetectCfg] = useState(null);
  const [detectArmed, setDetectArmed] = useState(false);
  const [detectTail, setDetectTail] = useState('');
  const [detectSuggestions, setDetectSuggestions] = useState([]);
  const { active: captureActive, error: captureError } = useScriptureCapture(detectArmed, detectCfg?.deviceId);

  useEffect(() => {
    window.cue.scriptureDetect.getConfig().then(setDetectCfg);
  }, [bgRefreshTick]);

  // Arm/disarm drives the main-process ASR loop (capture is driven by the hook).
  useEffect(() => {
    if (!detectCfg?.enabled) return;
    if (detectArmed) window.cue.scriptureDetect.start();
    else window.cue.scriptureDetect.stop();
  }, [detectArmed, detectCfg?.enabled]);

  // Disarm if the feature is turned off in Settings.
  useEffect(() => { if (detectCfg && !detectCfg.enabled) setDetectArmed(false); }, [detectCfg?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const goLiveFromPassage = useCallback((passage) => {
    const v0 = passage?.verses?.[0];
    if (!v0) return;
    handleScriptureLive({
      versionId: passage.versionId, versionAbbrev: passage.versionAbbrev, versionName: passage.versionName,
      bookNum: passage.bookNum, bookName: passage.bookName, chapter: v0.chapter, verse: v0.verse, text: v0.text,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const offTail = window.cue.on('scripture:transcript', (t) => {
      setDetectTail(`${t.committed || ''} ${t.tail || ''}`.trim().split(/\s+/).slice(-18).join(' '));
    });
    const offDet = window.cue.on('scripture:detected', async (d) => {
      const passage = await window.cue.bible.resolve(d.versionId, d.ref, 1);
      if (!passage) return;
      const sugg = { id: `${d.mode}-${passage.reference}-${Date.now()}`, mode: d.mode, ref: passage.reference, confidence: d.confidence, passage };
      setDetectSuggestions((prev) => [sugg, ...prev.filter((s) => s.ref !== passage.reference)].slice(0, 4));
      if (d.autoAction === 'live') goLiveFromPassage(passage);
    });
    return () => { offTail(); offDet(); };
  }, [goLiveFromPassage]);

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
    window.cue.output.channels.list().then(setChannels);
  }, [bgRefreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the channel list (and thus the live monitor's content-mode awareness) in
  // sync when channels change anywhere — e.g. the Graphics panel's mode switcher.
  useEffect(() => {
    const off = window.cue.on('output:state-changed', () => {
      window.cue.output.channels.list().then(setChannels);
    });
    return off;
  }, []);

  useEffect(() => {
    if (!activeServiceId) { setServiceData(null); return; }
    window.cue.services.get(activeServiceId).then(setServiceData);
  }, [activeServiceId, bgRefreshTick]);

  // Live YouTube download progress → patch the matching rundown cue in place (keyed
  // by URL), so the rundown status badge and buildPayload's ready path stay current
  // as a clip resolves/downloads without a full service reload.
  useEffect(() => {
    const off = window.cue.on('youtube:status', (snap) => {
      if (!snap || !snap.url) return;
      setServiceData((prev) => {
        if (!prev?.items) return prev;
        let changed = false;
        const items = prev.items.map((it) => {
          if (it.item_type === 'youtube' && it.content === snap.url) {
            changed = true;
            return { ...it, youtube: { ...snap } };
          }
          return it;
        });
        return changed ? { ...prev, items } : prev;
      });
    });
    return off;
  }, []);

  // Pre-fetch any YouTube cue that isn't downloading yet — covers a saved service
  // reopened in a new session (cache was wiped) and undo-re-added cues. Idempotent
  // per video id, and only fires for 'idle' cues so the status stream doesn't loop it.
  useEffect(() => {
    for (const it of serviceData?.items || []) {
      if (it.item_type === 'youtube' && it.content && (!it.youtube || it.youtube.status === 'idle')) {
        window.cue.youtube.prefetch(it.content);
      }
    }
  }, [serviceData]);

  const shortcutRef = useRef({});
  shortcutRef.current = { handleNextSlide, handlePrevSlide, handleNextLiveSlide, handlePrevLiveSlide, handleGo, handleClear, handleLogo, handleLiveToggle, handleRemoteSelect, handleAutoAdvance };

  if (transportRef) {
    transportRef.current = { go: handleGo, clear: handleClear, logo: handleLogo };
  }

  useEffect(() => {
    const hasPreview = !!(serviceData?.items?.find((i) => i.id === previewItemId));
    onStateChange?.({ isLive: !!liveItemId || !!liveScripture, canGo: hasPreview });
  }, [liveItemId, liveScripture, previewItemId, serviceData]); // eslint-disable-line react-hooks/exhaustive-deps

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

      // Space always drives LIVE forward; arrow keys drive PREVIEW (auto-GOing
      // when preview and live are the same item).
      if (e.key === ' ')                          { e.preventDefault(); h.handleNextLiveSlide(); }
      else if (e.key === 'ArrowDown')             { e.preventDefault(); h.handleNextSlide(); }
      else if (e.key === 'ArrowUp')               { e.preventDefault(); h.handlePrevSlide(); }
      else if (e.key === 'Escape')                { h.handleClear(); }
      else if (e.key === 'g' || e.key === 'G')    { h.handleGo(); }
      else if (e.key === 'l' || e.key === 'L')    { h.handleLogo(); }
      else if (e.key === 's' || e.key === 'S')    { e.preventDefault(); focusSearchRef.current?.(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Network control remote (Stream Deck / Companion / phone). Commands arrive as
  // IPC and drive the SAME handlers the keyboard uses, so the operator UI stays
  // in sync — the remote is just a virtual operator. OperatorView is always
  // mounted (App CSS-hides it), so this listener is live across views.
  useEffect(() => {
    const off = window.cue.on('remote:command', (cmd) => {
      const h = shortcutRef.current;
      switch (cmd?.action) {
        case 'go':     h.handleGo(); break;
        case 'clear':  h.handleClear(); break;
        case 'logo':   h.handleLogo(); break;
        case 'next':   h.handleNextLiveSlide(); break;
        case 'prev':   h.handlePrevLiveSlide(); break;
        case 'live':   h.handleLiveToggle(); break;
        case 'select': h.handleRemoteSelect(cmd.itemId, cmd.slideIdx); break;
        default: break;
      }
    });
    return off;
  }, []);

  // Push the rundown (with each item's slides) + preview/live selection to the
  // remote server so remote clients can list items AND jump to a specific slide
  // (e.g. back to a particular verse) rather than only stepping with prev/next.
  // No-op when the server is disabled.
  useEffect(() => {
    const items = (serviceData?.items || []).map((i) => ({
      id: i.id,
      type: i.item_type,
      label: i.song?.title || i.asset?.filename || i.scripture?.reference || i.youtube?.title
        || (i.item_type === 'scripture' ? 'Scripture' : i.item_type === 'media' ? 'Media' : i.item_type === 'youtube' ? 'YouTube' : 'Item'),
      slides: slidesForRemote(i),
    }));
    window.cue.remote?.pushNavState?.({ items, previewItemId, liveItemId, liveSlideIdx });
  }, [serviceData, previewItemId, liveItemId, liveSlideIdx, scriptureStyle, scriptureRefStyle, scriptureBgPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance / timed loops. When a rundown item is live and carries an
  // advance_seconds interval, schedule a single timer to step forward; the effect
  // re-runs on every live slide/item change, so each advance restarts the countdown.
  // Scripture-live (synthetic) and items without an interval are skipped. The timer
  // calls the latest handler via shortcutRef so it always sees current live state.
  useEffect(() => {
    if (liveScripture || !liveItemId) return;
    const item = serviceData?.items?.find((i) => i.id === liveItemId);
    const secs = item?.advance_seconds;
    if (!secs || secs <= 0) return;
    const t = setTimeout(() => shortcutRef.current.handleAutoAdvance(), secs * 1000);
    return () => clearTimeout(t);
  }, [liveItemId, liveSlideIdx, liveScripture, serviceData]);

  const refreshService = useCallback(() => {
    if (!activeServiceId) return;
    window.cue.services.get(activeServiceId).then(setServiceData);
  }, [activeServiceId]);

  const previewItem = serviceData?.items?.find((i) => i.id === previewItemId) ?? null;
  const liveItem    = liveScripture
    ? liveScripture.item
    : (serviceData?.items?.find((i) => i.id === liveItemId) ?? null);

  function getSlides(item) {
    if (!item) return [];
    if (item.item_type === 'song') return item.sections || [];
    if (item.item_type === 'scripture') {
      const slides = item.scriptureSlides || [];
      // Inject the global scripture verse style + reference style so the monitors
      // render scripture exactly as the audience output does.
      if (!scriptureStyle && !scriptureRefStyle) return slides;
      const styleStr = scriptureStyle ? JSON.stringify(scriptureStyle) : null;
      return slides.map((s) => ({
        ...s,
        style_json: s.style_json ?? styleStr,
        _refStyle: scriptureRefStyle,
      }));
    }
    if (item.item_type === 'media') return [{ id: item.id, type: 'media', content: '', asset: item.asset }];
    // A YouTube cue is a single full-frame video slide. Its file (when ready) lives
    // in the ephemeral cache; status rides along on item.youtube.
    if (item.item_type === 'youtube') return [{ id: item.id, type: 'youtube', content: '', youtube: item.youtube }];
    if (item.item_type === 'presentation') {
      return (item.slides || []).map((s, idx) => ({
        ...s,
        type: s.label || `Slide ${idx + 1}`,
        content: presentationSlideText(s),
      }));
    }
    if (item.item_type === 'slide') return [{ id: item.id, type: 'slide', content: item.content }];
    return [];
  }

  // A compact slide list for the network remote: a label (e.g. "Verse 2",
  // "Chorus", or a scripture reference) + a short preview per slide, so a phone
  // can show a song's verses and jump straight to one. Single-slide items
  // (media, one-line slides) return [] — nothing to expand.
  function slidesForRemote(item) {
    const slides = getSlides(item);
    if (!slides || slides.length <= 1) return [];
    const songLabels = item.item_type === 'song' ? sectionLabels(slides) : null;
    return slides.map((s, idx) => {
      const label = songLabels
        ? songLabels[idx]
        : (s.type || (item.item_type === 'scripture' ? `Verse ${idx + 1}` : `Slide ${idx + 1}`));
      const preview = (s.content || '').replace(/\s+/g, ' ').trim().slice(0, 70);
      return { index: idx, label, preview };
    });
  }

  // Resolve the slide that follows (item, slideIdx) — rolling into the next
  // rundown item's first slide at an item boundary. Used to feed the stage display.
  function nextSlideInfo(item, slideIdx) {
    const slides = getSlides(item);
    if (slideIdx < slides.length - 1) {
      const n = slides[slideIdx + 1];
      return { text: n.content || '', label: labelForSlide(item, slides, slideIdx + 1) };
    }
    const items = serviceData?.items || [];
    const curIdx = items.findIndex((i) => i.id === item.id);
    if (curIdx >= 0 && curIdx < items.length - 1) {
      const nextItem = items[curIdx + 1];
      const nextSlides = getSlides(nextItem);
      if (nextSlides.length) return { text: nextSlides[0].content || '', label: labelForSlide(nextItem, nextSlides, 0) };
    }
    return { text: '', label: '' };
  }

  function buildPayload(item, slideIdx) {
    const slides = getSlides(item);
    const slide = slides[slideIdx];
    if (!slide) return null;
    const next = nextSlideInfo(item, slideIdx);
    const base = {
      type: 'content',
      sectionLabel: labelForSlide(item, slides, slideIdx),
      nextText: next.text,
      nextSectionLabel: next.label,
      title: item.song?.title || item.presentation?.title || item.asset?.filename || item.youtube?.title || null,
    };
    // Foreground media item — full-frame video/audio/image, no text.
    if (item.item_type === 'media' && item.asset) {
      return {
        ...base,
        text: '', copyright: null, backgroundPath: null, styleJson: null,
        media: { path: item.asset.path, type: item.asset.type, loop: !!item.media_loop },
      };
    }
    // YouTube cue — once downloaded it's an ordinary local video, so it flows through
    // the identical media transport. Not ready yet → no payload (GO is soft-blocked
    // until the cue shows Ready in the rundown).
    if (item.item_type === 'youtube') {
      const ytPath = item.youtube?.status === 'ready' ? item.youtube.path : null;
      if (!ytPath) return null;
      return {
        ...base,
        text: '', copyright: null, backgroundPath: null, styleJson: null,
        media: { path: ytPath, type: 'video', loop: !!item.media_loop },
      };
    }
    // Presentation slide — a multi-element canvas (text/image/shape). The output
    // template + operator monitor render the `elements` array; no single text block.
    if (item.item_type === 'presentation') {
      return {
        ...base,
        text: '', copyright: null, styleJson: null,
        backgroundPath: resolveBackground(item, slide),
        elements: slide.elements || [],
      };
    }
    return {
      ...base,
      text: slide.content || '',
      // Scripture slides carry their own attribution (reference (version));
      // songs use the song's copyright line.
      copyright: slide.copyright ?? item.song?.copyright ?? null,
      // Scripture attribution sits bottom-right; song copyright stays centred.
      copyrightAlign: item.item_type === 'scripture' ? 'right' : undefined,
      copyrightStyle: item.item_type === 'scripture' ? scriptureRefStyle : undefined,
      backgroundPath: resolveBackground(item),
      styleJson: slide.style_json ? JSON.parse(slide.style_json) : null,
    };
  }

  function resolveBackground(item, slide) {
    // Foreground media shows the asset itself in the preview/live monitors.
    if (item.item_type === 'media' && item.asset?.path) return item.asset.path;
    if (item.item_type === 'youtube') return item.youtube?.status === 'ready' ? item.youtube.path : null;
    if (item.background_override?.path) return item.background_override.path;
    if (item.item_type === 'scripture') return scriptureBgPath;
    // Presentation: per-slide background → global slide default.
    if (item.item_type === 'presentation') return slide?.background_path || slideBgPath || null;
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
      setLiveScripture(null);
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
      setLiveScripture(null);
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
      setLiveScripture(null);
    }
  }

  // Send a single scripture verse live, straight from the Scriptures tab. This is
  // a non-rundown live source, so it clears any live rundown item and renders the
  // live monitor from a synthetic scripture item.
  function handleScriptureLive(v) {
    const ref = `${v.bookName} ${v.chapter}:${v.verse}`;
    const slide = {
      id: `scripture-live-${v.bookNum}-${v.chapter}-${v.verse}`,
      type: ref,
      content: v.text,
      copyright: `${ref} (${v.versionAbbrev})`,
      style_json: null,
    };
    const payload = {
      type: 'content',
      sectionLabel: ref,
      nextText: '',
      nextSectionLabel: '',
      title: ref,
      text: v.text,
      copyright: `${ref} (${v.versionAbbrev})`,
      copyrightAlign: 'right',
      copyrightStyle: scriptureRefStyle,
      backgroundPath: scriptureBgPath,
      styleJson: scriptureStyle,
    };
    window.cue.output.go(payload);
    setLiveScripture({ item: { id: '__scripture_live__', item_type: 'scripture', scriptureSlides: [slide], scripture: { reference: ref } } });
    setLiveItemId(null);
    setLiveSlideIdx(0);
  }

  function handleClear() {
    window.cue.output.clear();
    setLiveScripture(null);
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

  // Space bar — advance the LIVE item forward. Within the live item it sends the
  // next slide; at the last slide it rolls into the next rundown item (and loads
  // it into preview too). Scripture-live (synthetic, not in the rundown) just
  // advances within its own slides.
  function handleNextLiveSlide() {
    if (!liveItem) {
      // Nothing live yet — GO the current preview to start the live bus.
      if (previewItem) handleGo();
      return;
    }
    const slides = getSlides(liveItem);
    if (liveSlideIdx < slides.length - 1) {
      const nextIdx = liveSlideIdx + 1;
      const payload = buildPayload(liveItem, nextIdx);
      if (payload) {
        window.cue.output.go(payload);
        setLiveSlideIdx(nextIdx);
        if (liveItemId === previewItemId) setPreviewSlideIdx(nextIdx);
      }
      return;
    }
    // At the last slide — advance to the next rundown item (scripture-live is not
    // in the rundown, so curIdx is -1 and we stop at the boundary).
    const items = serviceData?.items || [];
    const curIdx = items.findIndex((i) => i.id === liveItemId);
    if (curIdx >= 0 && curIdx < items.length - 1) {
      const nextItem = items[curIdx + 1];
      const payload = buildPayload(nextItem, 0);
      if (payload) {
        window.cue.output.go(payload);
        setLiveItemId(nextItem.id);
        setLiveSlideIdx(0);
        setLiveScripture(null);
        setPreviewItemId(nextItem.id);
        setPreviewSlideIdx(0);
      }
    }
  }

  // Mirror of handleNextLiveSlide for the remote's PREV button — steps the LIVE
  // item backward, rolling into the previous rundown item's last slide at the
  // boundary. Scripture-live (not in the rundown) just steps within its slides.
  function handlePrevLiveSlide() {
    if (!liveItem) { if (previewItem) handleGo(); return; }
    const slides = getSlides(liveItem);
    if (liveSlideIdx > 0) {
      const idx = liveSlideIdx - 1;
      const payload = buildPayload(liveItem, idx);
      if (payload) {
        window.cue.output.go(payload);
        setLiveSlideIdx(idx);
        if (liveItemId === previewItemId) setPreviewSlideIdx(idx);
      }
      return;
    }
    const items = serviceData?.items || [];
    const curIdx = items.findIndex((i) => i.id === liveItemId);
    if (curIdx > 0) {
      const prevItem = items[curIdx - 1];
      const prevSlides = getSlides(prevItem);
      const idx = Math.max(prevSlides.length - 1, 0);
      const payload = buildPayload(prevItem, idx);
      if (payload) {
        window.cue.output.go(payload);
        setLiveItemId(prevItem.id);
        setLiveSlideIdx(idx);
        setLiveScripture(null);
        setPreviewItemId(prevItem.id);
        setPreviewSlideIdx(idx);
      }
    }
  }

  // Auto-advance tick — fired by the per-slide timer when the live item has an
  // advance_seconds interval. Steps the live bus forward exactly like Space, but at
  // the very end of the rundown it wraps back to the first item so an unattended
  // pre-roll announcement loop cycles indefinitely. Scripture-live (synthetic, not
  // in the rundown) is excluded by the scheduler, so liveItem is always a rundown item.
  function handleAutoAdvance() {
    if (!liveItem) return;
    const slides = getSlides(liveItem);
    const atItemEnd = liveSlideIdx >= slides.length - 1;

    // Loop within the item: at the last slide, bounce back to its first slide and
    // keep rotating (a self-contained announcement loop). A single-slide item just
    // re-fires to restart any media/countdown timers.
    if (atItemEnd && liveItem.advance_loop === 'item') {
      const payload = buildPayload(liveItem, 0);
      if (payload) {
        window.cue.output.go(payload);
        setLiveSlideIdx(0);
        if (liveItemId === previewItemId) setPreviewSlideIdx(0);
      }
      return;
    }

    // Continue through the rundown (default).
    const items = serviceData?.items || [];
    const curIdx = items.findIndex((i) => i.id === liveItemId);
    if (!(atItemEnd && curIdx >= items.length - 1)) { handleNextLiveSlide(); return; }
    // At the very end of the rundown — wrap to the first item only if opted in;
    // otherwise stop (no state change means no new timer is scheduled).
    if (!liveItem.advance_wrap || !items.length) return;
    const first = items[0];
    const payload = buildPayload(first, 0);
    if (payload) {
      window.cue.output.go(payload);
      setLiveItemId(first.id);
      setLiveSlideIdx(0);
      setLiveScripture(null);
      setPreviewItemId(first.id);
      setPreviewSlideIdx(0);
    }
  }

  // Remote SELECT — jump straight to a rundown item live. With no slideIdx it
  // starts the item from its first slide (same as double-click); with a slideIdx
  // it jumps to that exact slide (e.g. a specific verse) and goes live there.
  function handleRemoteSelect(itemId, slideIdx) {
    const item = (serviceData?.items || []).find((i) => i.id === itemId);
    if (!item) return;
    if (slideIdx == null || !Number.isFinite(slideIdx)) { handleDoubleClickItem(item); return; }
    const payload = buildPayload(item, slideIdx);
    if (payload) {
      window.cue.output.go(payload);
      setLiveItemId(item.id);
      setLiveSlideIdx(slideIdx);
      setLiveScripture(null);
      setPreviewItemId(item.id);
      setPreviewSlideIdx(slideIdx);
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
    const label = item?.song?.title || item?.asset?.filename || item?.scripture?.reference || item?.youtube?.title || 'Item';
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

  async function handleAddScripture(passage) {
    const item = {
      item_type: 'scripture',
      ref_id: passage.versionId ?? null,
      content: JSON.stringify(passage),
    };
    if (!activeServiceId) {
      const id = await window.cue.services.create({
        title: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        date: new Date().toISOString().split('T')[0],
      });
      onServiceChange(id);
      setServices(await window.cue.services.list());
      await window.cue.services.addItem(id, item);
      window.cue.services.get(id).then(setServiceData);
    } else {
      await window.cue.services.addItem(activeServiceId, item);
      refreshService();
    }
  }

  async function handleAddMedia(assetId) {
    const item = { item_type: 'media', ref_id: assetId };
    if (!activeServiceId) {
      const id = await window.cue.services.create({
        title: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        date: new Date().toISOString().split('T')[0],
      });
      onServiceChange(id);
      setServices(await window.cue.services.list());
      await window.cue.services.addItem(id, item);
      window.cue.services.get(id).then(setServiceData);
    } else {
      await window.cue.services.addItem(activeServiceId, item);
      refreshService();
    }
  }

  async function handleAddYouTube(url) {
    // The speculative paste-time prefetch usually already started this; re-asserting
    // it here is idempotent (deduped per video id in main).
    window.cue.youtube.prefetch(url);
    const item = { item_type: 'youtube', content: url };
    if (!activeServiceId) {
      const id = await window.cue.services.create({
        title: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        date: new Date().toISOString().split('T')[0],
      });
      onServiceChange(id);
      setServices(await window.cue.services.list());
      await window.cue.services.addItem(id, item);
      window.cue.services.get(id).then(setServiceData);
    } else {
      await window.cue.services.addItem(activeServiceId, item);
      refreshService();
    }
  }

  async function handleAddPresentation(presentationId) {
    const item = { item_type: 'presentation', ref_id: presentationId };
    if (!activeServiceId) {
      const id = await window.cue.services.create({
        title: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        date: new Date().toISOString().split('T')[0],
      });
      onServiceChange(id);
      setServices(await window.cue.services.list());
      await window.cue.services.addItem(id, item);
      window.cue.services.get(id).then(setServiceData);
    } else {
      await window.cue.services.addItem(activeServiceId, item);
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

  function handleRestartMedia() {
    if (!liveItem) return;
    const payload = buildPayload(liveItem, liveSlideIdx);
    if (payload) window.cue.output.go(payload);
  }

  const previewBgPath = previewItem ? resolveBackground(previewItem) : null;
  const liveBgPath    = liveItem    ? resolveBackground(liveItem)    : null;

  // Use the first active program channel's template to drive the monitor frame
  // rendering. Stage channels are confidence monitors, not audience output, so
  // they never drive the operator preview. Falls back to 'fullscreen'.
  const channelTemplate =
    (channels.find((c) => c.active && c.template !== 'stage')
      ?? channels.find((c) => c.active)
      ?? channels[0])?.template ?? 'fullscreen';

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
            onSongEdited={() => setSongEditTick((t) => t + 1)}
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
            displayMode={displayMode}
            liveMediaStartAt={liveMediaStartAt}
            onRestartMedia={handleRestartMedia}
            getSlides={getSlides}
            previewBgPath={previewBgPath}
            liveBgPath={liveBgPath}
            onSelectPreviewSlide={handleSelectPreviewSlide}
            onGoAtPreviewSlide={handleGoAtPreviewSlide}
            onSelectLiveSlide={handleSelectLiveSlide}
            channelTemplate={channelTemplate}
            allChannels={channels}
            liveChannelIdx={liveChannelIdx}
            onSetLiveChannelIdx={setLiveChannelIdx}
          />
        </div>
      </div>

      {/* Scripture detection strip (only when enabled in Settings) */}
      {detectCfg?.enabled && (
        <ScriptureDetectionPanel
          armed={detectArmed}
          onToggleArm={() => setDetectArmed((a) => !a)}
          transcript={detectTail}
          suggestions={detectSuggestions}
          captureActive={captureActive}
          captureError={captureError}
          onGoLive={(s) => { goLiveFromPassage(s.passage); setDetectSuggestions((prev) => prev.filter((x) => x.id !== s.id)); }}
          onDismiss={(s) => setDetectSuggestions((prev) => prev.filter((x) => x.id !== s.id))}
        />
      )}

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
          onAddScripture={handleAddScripture}
          onScriptureLive={handleScriptureLive}
          onScriptureStyleSaved={loadScriptureDefaults}
          onAddMedia={handleAddMedia}
          onAddYouTube={handleAddYouTube}
          onAddPresentation={handleAddPresentation}
          onSongSave={refreshService}
          refreshTick={bgRefreshTick + songEditTick}
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
