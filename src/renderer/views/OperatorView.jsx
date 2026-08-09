import React, { useState, useEffect, useCallback, useRef } from 'react';
import RundownPanel from '../panels/RundownPanel';
import PreviewLivePanel from '../panels/PreviewLivePanel';
import LibraryPanel from '../panels/LibraryPanel';
import ScriptureDetectionPanel from '../panels/ScriptureDetectionPanel';
import { useScriptureCapture } from '../audio/useScriptureCapture';
import { useScriptureAsr } from '../audio/useScriptureAsr';
import { sectionLabelAt, expandSongSections } from '../utils/sectionLabels';
import { useToast } from '../components/Toast';
import ShortcutsOverlay from '../components/ShortcutsOverlay';
import CommandPalette from '../components/CommandPalette';
import { hasOpenModal } from '../utils/modalGuard';

const isMac = window.cue.platform === 'darwin';

// Positional verse/slide jump keys. Pressing the Nth key airs slide N of the
// current LIVE item (Q = slide 1, W = slide 2, …). The set is fixed and
// positional so the muscle memory is the same every service; it deliberately
// skips the bare operator keys (S = search, G = GO, L = Logo) and never overlaps
// the 1–9 Scene keys. Armed via Settings (off by default — bare letters can fire
// mid-task). Lowercase for matching; rendered uppercase in the slide legend.
// Positional verse-jump letters. Excludes the bare transport keys (G/L/O/S) so a
// jump letter never shadows GO / Logo / Output-toggle / Search when jump is armed.
const JUMP_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'p', 'a', 'd', 'f', 'h', 'j', 'k'];

// Display label for a slide. Songs get numbered section labels (Verse 1/Verse 2);
// scripture/media slides keep their own label (the reference / type).
function labelForSlide(item, slides, idx) {
  if (item?.item_type === 'song') return slides[idx]?._label ?? sectionLabelAt(slides, idx);
  return slides[idx]?.type || '';
}

// A short text preview of a presentation slide (its first text element) — used for
// the stage "coming next" text and the network-remote slide preview. Presentation
// slides carry no single `content` string (they're a multi-element canvas).
function presentationSlideText(slide) {
  const el = (slide?.elements || []).find((e) => e?.type === 'text' && e.text);
  return el ? el.text : '';
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
  activeServiceId, onServiceChange, onToggleLive, outputsEnabled = true, outputWindows = 0,
  viewActive = true,
}) {
  const toast = useToast();
  const [helpOpen, setHelpOpen] = useState(false);       // ? keyboard-shortcut overlay
  const [paletteOpen, setPaletteOpen] = useState(false); // ⌘K command palette
  const [services, setServices] = useState([]);
  const [serviceData, setServiceData] = useState(null);
  const [songEditTick, setSongEditTick] = useState(0); // bumped when a song is edited from the rundown, to refresh the library
  const [channels, setChannels] = useState([]);
  const [liveChannelIdx, setLiveChannelIdx] = useState(0);

  const [previewItemId, setPreviewItemId] = useState(null);
  const [previewSlideIdx, setPreviewSlideIdx] = useState(0);
  // Multi-select set for bulk operations (Ctrl/Cmd-click, Shift-range, marquee).
  // Distinct from previewItemId/liveItemId — selection drives bulk delete/background,
  // not what's on air. The anchor seeds Shift-range selection.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const selectionAnchorRef = useRef(null);
  const [liveItemId, setLiveItemId] = useState(null);
  const [liveSlideIdx, setLiveSlideIdx] = useState(0);
  // Scripture sent live directly from the Scriptures tab — a synthetic live source
  // that isn't a rundown item. Mutually exclusive with a live rundown item.
  const [liveScripture, setLiveScripture] = useState(null); // { item } | null
  const [previewScripture, setPreviewScripture] = useState(null); // { item, verse } | null — detected ref staged to preview

  // Global scripture appearance — style applied to every verse + default background.
  // Edited in the Scriptures tab (ScriptureEditor) / Settings; resolution mirrors songs.
  const [scriptureStyle, setScriptureStyle] = useState(null);     // verse style_json | null
  const [scriptureRefStyle, setScriptureRefStyle] = useState(null); // reference style_json | null
  const [scriptureBgPath, setScriptureBgPath] = useState(null);   // resolved media path | null
  // Split (compare) view — show every live verse in a SECOND translation alongside
  // the primary. Toggled in the Scriptures tab; read live like the styles above.
  const [scriptureSplit, setScriptureSplit] = useState({ enabled: false, versionId: null, abbrev: '', name: '' });
  const [slideBgPath, setSlideBgPath] = useState(null);           // global presentation/slide bg | null
  const [songGlobalBgPath, setSongGlobalBgPath] = useState(null); // live global song default bg | null
  const [ltFontScale, setLtFontScale] = useState(1);              // global lower-third font scale (fraction)

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
    // Songs now read the global default LIVE (like scripture/slides) instead of
    // snapshotting it at creation — changing it applies to every unlocked song.
    const songBgId = await window.cue.settings.get('global_bg_song_id');
    const songBg = songBgId ? await window.cue.media.get(songBgId) : null;
    setSongGlobalBgPath(songBg?.path || null);
    // Global lower-third font scale (percent → fraction); mirrors output/lowerthird.js.
    const ltPct = Number(await window.cue.settings.get('lowerthird_font_scale'));
    setLtFontScale(isFinite(ltPct) && ltPct > 0 ? ltPct / 100 : 1);
    // Split-verse (compare) setting — a second translation shown alongside the live
    // verse. Resolve the chosen version's abbrev/name once so the live path doesn't.
    const splitEnabled = (await window.cue.settings.get('scripture_split_enabled')) === '1';
    const splitVersionId = Number(await window.cue.settings.get('scripture_split_version_id')) || null;
    let split = { enabled: splitEnabled, versionId: splitVersionId, abbrev: '', name: '' };
    if (splitVersionId) {
      const sv = (await window.cue.bible.versions()).find((x) => x.id === splitVersionId);
      if (sv) { split.abbrev = sv.abbrev; split.name = sv.name; }
      else split.versionId = null; // version was deleted — fall back to single
    }
    setScriptureSplit(split);
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
  // candidateId currently staged into preview by detection — gates re-staging so a
  // commit confirming an interim doesn't flicker the preview monitor.
  const previewCandidateRef = useRef(null);
  // useScriptureAsr picks the engine (WebGPU worker vs main-process CPU) and owns the
  // engine-aware start/stop; useScriptureCapture feeds each frame to its pushFrame sink.
  const { engine: detectEngine, pushFrame: detectPushFrame } = useScriptureAsr(detectArmed, detectCfg);
  const { active: captureActive, error: captureError } = useScriptureCapture(detectArmed, detectCfg?.deviceId, detectPushFrame);

  useEffect(() => {
    window.cue.scriptureDetect.getConfig().then(setDetectCfg);
  }, [bgRefreshTick]);

  // Disarm if the feature is turned off in Settings.
  useEffect(() => { if (detectCfg && !detectCfg.enabled) setDetectArmed(false); }, [detectCfg?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Scriptures-tab mic toggle: enable on first use, kick off the ASR model
  // download if it isn't present yet, then arm (or disarm).
  const onToggleDetect = useCallback(async () => {
    if (detectArmed) { setDetectArmed(false); return; }
    let c = detectCfg;
    if (!c?.enabled) { c = await window.cue.scriptureDetect.setConfig({ enabled: true }); setDetectCfg(c); }
    // Arm; the engine-aware start() (driven by useScriptureAsr) provisions the CPU model
    // only when the CPU engine is actually chosen. GPU models are opt-in (downloaded from
    // Settings) and never auto-fetched here — so we don't call ensureAsrModel on arm.
    setDetectArmed(true);
  }, [detectArmed, detectCfg]);
  const detectDownloadPct = detectCfg?.download?.kind === 'asr' && detectCfg.download.percent != null
    ? Math.round(detectCfg.download.percent * 100) : null;

  const passageToVerse = (passage) => {
    const v0 = passage?.verses?.[0];
    if (!v0) return null;
    return {
      versionId: passage.versionId, versionAbbrev: passage.versionAbbrev, versionName: passage.versionName,
      bookNum: passage.bookNum, bookName: passage.bookName, chapter: v0.chapter, verse: v0.verse, text: v0.text,
    };
  };
  // Always call the LATEST handleScriptureLive (it closes over live scripture style /
  // background / split state, which load after mount) — mirrors shortcutRef below.
  const scriptureLiveRef = useRef(null);
  const goLiveFromPassage = useCallback((passage) => {
    const v = passageToVerse(passage);
    if (v) scriptureLiveRef.current?.(v);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const offTail = window.cue.on('scripture:transcript', (t) => {
      setDetectTail(`${t.committed || ''} ${t.tail || ''}`.trim().split(/\s+/).slice(-18).join(' '));
    });
    // action: 'live' → straight to air · 'preview' → stage to preview monitor ·
    // 'suggest' → strip only. Everything also lands in the suggestion strip so the
    // operator has a record and can re-fire or dismiss.
    //
    // Detection is progressive: an INTERIM hypothesis (heard mid-sentence) can
    // auto-Preview but NEVER auto-airs; the authoritative commit arrives with the
    // same `candidateId` and either confirms in place (no re-stage/flicker) or
    // corrects. We de-dupe + update by candidateId so the strip shows one evolving
    // entry per detection, not a stack of partials.
    const offDet = window.cue.on('scripture:detected', async (d) => {
      const passage = await window.cue.bible.resolve(d.versionId, d.ref, 1);
      if (!passage) return;
      const candidateId = d.candidateId || `${d.mode}:${passage.reference}`;
      const sugg = { id: candidateId, candidateId, mode: d.mode, ref: passage.reference, confidence: d.confidence, action: d.action, interim: !!d.interim, passage };
      setDetectSuggestions((prev) => {
        const exists = prev.some((s) => s.candidateId === candidateId);
        const next = exists
          ? prev.map((s) => (s.candidateId === candidateId ? { ...s, ...sugg } : s))
          : [sugg, ...prev.filter((s) => s.ref !== passage.reference && s.candidateId !== candidateId)];
        return next.slice(0, 4);
      });
      // Interim never auto-airs; only the confirmed commit can go live.
      if (!d.interim && d.action === 'live') {
        goLiveFromPassage(passage); previewCandidateRef.current = null;
      } else if (d.action === 'preview') {
        // Stage only when this candidate isn't already in preview — the commit
        // confirming an interim must not re-stage (would flicker the monitor).
        if (previewCandidateRef.current !== candidateId) {
          const v = passageToVerse(passage);
          if (v) { stageScripturePreview(v); previewCandidateRef.current = candidateId; }
        }
      }
    });
    const offStatus = window.cue.on('scripture:status', (s) => setDetectCfg(s));
    return () => { offTail(); offDet(); offStatus(); };
  }, [goLiveFromPassage]);

  // Selecting any rundown item for preview clears a staged detected verse.
  useEffect(() => { if (previewItemId) setPreviewScripture(null); }, [previewItemId]);


  // Shortcut config — loaded from settings, reloaded when bgRefreshTick changes (i.e. on return from Settings)
  // armBare = the bare G/Esc keys are ARMED (hot): a single press goes straight to air.
  // Disarmed, those bare keys are ignored (the operator uses the ⌘ shortcuts or the
  // on-screen buttons instead) so a stray keystroke can't air. Default armed.
  // armJump mirrors armBare but for the positional verse-jump keys (Q W E …). Off
  // by default — kept as state too so the SlideList legend can show/hide the hints.
  const [jumpArmed, setJumpArmed] = useState(false);
  // Mirror of armBare in state so the operator UI can show/toggle the bare-key
  // arm button (same pattern as jumpArmed). Default armed.
  const [bareArmed, setBareArmed] = useState(true);
  // Configurable BARE transport keys (no modifier) + arm flags. Clear is fixed to
  // Esc; the ⌘/Ctrl combos are all standard app shortcuts and aren't configurable.
  const shortcutsRef = useRef({ go: 'g', logo: 'l', live: 'o', armBare: true, armJump: false });
  useEffect(() => {
    Promise.all([
      window.cue.settings.get('keyboard_go'),
      window.cue.settings.get('keyboard_logo'),
      window.cue.settings.get('keyboard_live'),
      window.cue.settings.get('shortcut_arm_bare'),
      window.cue.settings.get('shortcut_arm_jump'),
    ]).then(([go, logo, live, armBare, armJump]) => {
      shortcutsRef.current = {
        go:       (go   ?? 'g').toLowerCase(),
        logo:     (logo ?? 'l').toLowerCase(),
        live:     (live ?? 'o').toLowerCase(),
        armBare:  armBare !== false, // default armed when unset
        armJump:  armJump === true,  // default disarmed when unset
      };
      setJumpArmed(armJump === true);
      setBareArmed(armBare !== false);
    });
  }, [bgRefreshTick]);

  // Arm/disarm the bare transport keys (G / O / Esc) from the operator UI, mirroring
  // the jump-arm button. Persists to the same setting Settings → Shortcuts reads.
  const toggleBareArmed = useCallback(async () => {
    const next = !shortcutsRef.current.armBare;
    setBareArmed(next);
    shortcutsRef.current.armBare = next;
    await window.cue.settings.set('shortcut_arm_bare', next);
  }, []);

  // Brief on-screen notice when a DISARMED bare key is pressed, so the no-op isn't silent.
  const noticeTimerRef = useRef(null);
  const [armNotice, setArmNotice] = useState(null); // 'go' | 'clear' | null
  const flashDisarmed = useCallback((kind) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setArmNotice(kind);
    noticeTimerRef.current = setTimeout(() => setArmNotice(null), 1800);
  }, []);
  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current); }, []);

  // Ref for imperatively focusing the library search bar (triggered by S key)
  const focusSearchRef = useRef(null);
  // Imperative cycler for the Library tabs (⌘. forward / ⌘, back).
  const cycleLibraryTabRef = useRef(null);

  // Scenes — one-press multi-output state recall (number keys 1–9). Kept in a ref so
  // the always-mounted keydown listener sees the latest set without re-binding. Reload
  // on return from Settings and whenever the Scenes panel mutates the set.
  const scenesRef = useRef([]);
  const loadScenes = useCallback(() => {
    window.cue.scenes.list().then((list) => { scenesRef.current = list || []; });
  }, []);
  useEffect(() => { loadScenes(); }, [loadScenes, bgRefreshTick]);
  useEffect(() => {
    const h = () => loadScenes();
    window.addEventListener('cue:scenes-changed', h);
    return () => window.removeEventListener('cue:scenes-changed', h);
  }, [loadScenes]);

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
  shortcutRef.current = { handleNextSlide, handlePrevSlide, handleNextLiveSlide, handlePrevLiveSlide, handleGo, handleClear, handleLogo, handleLiveToggle, handleRemoteSelect, handleAutoAdvance, handleJumpLiveSlide, handleSelectAll, handleEscape, handleDuplicateSelection };

  if (transportRef) {
    transportRef.current = { go: handleGo, clear: handleClear, logo: handleLogo };
  }

  // Mirror overlay state into a ref so the always-mounted keydown listener (deps: [])
  // sees current values without re-binding.
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = helpOpen || paletteOpen;

  // Mirror viewActive into a ref so the keydown listener sees it without re-binding.
  const viewActiveRef = useRef(viewActive);
  viewActiveRef.current = viewActive;

  // Debounce the "no output windows" toast so repeated GO presses don't stack toasts.
  const outputWarnRef = useRef(0);

  useEffect(() => {
    // canGo is true for a staged rundown item OR a detected/previewed scripture verse.
    const hasPreview = !!(serviceData?.items?.find((i) => i.id === previewItemId)) || !!previewScripture;
    onStateChange?.({ isLive: !!liveItemId || !!liveScripture, canGo: hasPreview, micActive: detectArmed && !!captureActive });
  }, [liveItemId, liveScripture, previewItemId, previewScripture, serviceData, detectArmed, captureActive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKeyDown(e) {
      // Stand down while any modal owns the screen (editors, pickers, context menus)
      // so Esc/Space/G don't fire transport actions under an open overlay.
      if (hasOpenModal()) return;

      // Command palette — operator-view only (don't open it from Settings/Stream/etc.).
      // Uses the OS modifier (⌘/Ctrl) regardless of the configurable shortcut modifier.
      if (viewActiveRef.current && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setPaletteOpen((v) => !v); return;
      }
      // While the palette / help overlay is open it owns the keyboard (it handles its
      // own Esc/arrows); don't let operator shortcuts fire underneath it.
      if (overlayOpenRef.current) return;

      // Library tab cycling — Ctrl+Tab / Ctrl+Shift+Tab (the standard tab-switch
      // keys, same on macOS and Windows). Moved off ⌘./⌘, so ⌘, opens Settings and
      // the OS modifier is reserved entirely for standard app shortcuts.
      if (viewActiveRef.current && e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Tab') {
        e.preventDefault(); cycleLibraryTabRef.current?.(e.shiftKey ? -1 : 1); return;
      }
      // Ctrl+. / Ctrl+, — quick forward/back through the Library tabs. Kept on the
      // literal Ctrl key (not the OS modifier) so ⌘, still opens Settings on macOS.
      if (viewActiveRef.current && e.ctrlKey && !e.altKey && !e.metaKey && (e.key === '.' || e.key === ',')) {
        e.preventDefault(); cycleLibraryTabRef.current?.(e.key === '.' ? 1 : -1); return;
      }

      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

      // `?` opens the shortcut cheatsheet (Shift+/). Operator-view only.
      if (viewActiveRef.current && e.key === '?') { e.preventDefault(); setHelpOpen((v) => !v); return; }

      const h = shortcutRef.current;
      const sc = shortcutsRef.current;

      // Standard app shortcuts on the OS modifier (⌘ on macOS, Ctrl elsewhere).
      // Transport NEVER lives on a modifier anymore — it's all bare keys below — so
      // every clipboard/undo accelerator (⌘C/X/V/Z…) passes straight through to the
      // browser untouched. We only claim the handful of app-nav combos here.
      const osMod = isMac ? e.metaKey : e.ctrlKey;
      if (osMod && !e.altKey) {
        const k = e.key.toLowerCase();
        // ⌘A → select all rundown items; defers to native select-all when text is
        // selected (so ⌘A still works inside/over editable text).
        if (k === 'a' && !e.shiftKey) {
          if (window.getSelection()?.toString()) return;
          if (viewActiveRef.current) { e.preventDefault(); h.handleSelectAll(); }
          return;
        }
        if (!viewActiveRef.current) return; // remaining combos are operator-only
        if (k === 'f' && !e.shiftKey) { e.preventDefault(); focusSearchRef.current?.(); return; } // find → focus search
        if (k === 'n' && !e.shiftKey) { e.preventDefault(); setPaletteOpen(true);        return; } // new → command palette
        if (k === 'd' && !e.shiftKey) { e.preventDefault(); h.handleDuplicateSelection(); return; } // duplicate item(s)
        return; // any other ⌘/Ctrl combo → native (clipboard, undo, etc.)
      }
      // A stray Alt / (Ctrl on macOS) modifier with no binding → let it pass so bare
      // handlers below never fire while a modifier is held.
      if (e.altKey || e.metaKey || e.ctrlKey) return;

      // Number keys 1–9 recall a Scene — active from any view so a director can
      // fire a scene without switching back to the Operator tab.
      if (/^[1-9]$/.test(e.key)) {
        const scene = scenesRef.current.find((s) => s.hotkey === e.key);
        if (scene) { e.preventDefault(); window.cue.scenes.apply(scene); return; }
      }

      // All remaining bare keys only fire when the operator view is visible —
      // prevents Space/Esc/G from invisibly changing the live program from
      // Settings, Stream, Multiview, or Stage views.
      if (!viewActiveRef.current) return;

      // Positional verse/slide jump (Q W E R …) — only when armed. Jumps the LIVE
      // item straight to slide N and airs it (direct on-air navigation). The key
      // set excludes the bare transport letters (G/L/O/S) so it never shadows them.
      if (sc.armJump) {
        const jIdx = JUMP_KEYS.indexOf(e.key.toLowerCase());
        if (jIdx >= 0) { e.preventDefault(); h.handleJumpLiveSlide(jIdx); return; }
      }

      // Space always drives LIVE forward; arrow keys drive PREVIEW (auto-GOing
      // when preview and live are the same item).
      if (e.key === ' ')                          { e.preventDefault(); h.handleNextLiveSlide(); }
      else if (e.key === 'ArrowDown')             { e.preventDefault(); h.handleNextSlide(); }
      else if (e.key === 'ArrowUp')               { e.preventDefault(); h.handlePrevSlide(); }
      // Bare Esc/G fire on a single press only when ARMED; disarmed, they're ignored
      // (a stray press can't air) and just flash a notice.
      else if (e.key === 'Escape')                { h.handleEscape(); }
      else if (e.key.toLowerCase() === sc.go)     { if (sc.armBare) h.handleGo(); else flashDisarmed('go'); }
      else if (e.key.toLowerCase() === sc.logo)   { h.handleLogo(); }
      else if (e.key.toLowerCase() === sc.live)   { if (sc.armBare) h.handleLiveToggle(); else flashDisarmed('output'); }
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
  const [autoAdvanceStartAt, setAutoAdvanceStartAt] = useState(null);
  useEffect(() => {
    if (liveScripture || !liveItemId) { setAutoAdvanceStartAt(null); return; }
    const item = serviceData?.items?.find((i) => i.id === liveItemId);
    const secs = item?.advance_seconds;
    if (!secs || secs <= 0) { setAutoAdvanceStartAt(null); return; }
    setAutoAdvanceStartAt(Date.now());
    const t = setTimeout(() => shortcutRef.current.handleAutoAdvance(), secs * 1000);
    return () => clearTimeout(t);
  }, [liveItemId, liveSlideIdx, liveScripture, serviceData]);

  const refreshService = useCallback(() => {
    if (!activeServiceId) return;
    window.cue.services.get(activeServiceId).then(setServiceData);
  }, [activeServiceId]);

  const previewItem = previewScripture
    ? previewScripture.item
    : (serviceData?.items?.find((i) => i.id === previewItemId) ?? null);
  const liveItem    = liveScripture
    ? liveScripture.item
    : (serviceData?.items?.find((i) => i.id === liveItemId) ?? null);

  // CCLI usage log: record every song that goes live. Main dedupes re-airs of the
  // same song within a service window, so slide jumps / GO-backs count once.
  const liveSongId = liveItem?.item_type === 'song' ? liveItem.song?.id : null;
  useEffect(() => {
    if (liveSongId) window.cue.songs.logUsage(liveSongId).catch?.(() => {});
  }, [liveSongId]);

  // Live-input master enable (the mid-service NDI kill switch). When off,
  // buildPayload soft-blocks live-video cues from going live (like a YouTube cue
  // that isn't ready) — main also refuses at its end, this just keeps the UX honest.
  const liveInputsEnabledRef = useRef(true);
  useEffect(() => {
    window.cue.liveInput?.getEnabled().then((v) => { liveInputsEnabledRef.current = !!v; });
    return window.cue.on('liveinput:enabled', (v) => { liveInputsEnabledRef.current = !!v; });
  }, []);

  function getSlides(item) {
    if (!item) return [];
    // Songs expand each section into its display parts (variable-size splits on
    // the ⁂ break marker); a section with no marker is one part — unchanged.
    // An arrangement (played section order with repeats) reorders the expansion.
    if (item.item_type === 'song') return expandSongSections(item.sections || [], item.song?.arrangement_json);
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
    // A live video input cue is a single full-frame live slide (NDI source).
    if (item.item_type === 'live-input') return [{ id: item.id, type: 'live', content: '', liveInput: item.liveInput }];
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
    return slides.map((s, idx) => {
      // Song slides carry a per-part label (`_label`); other items derive one.
      const label = s._label
        ?? (s.type || (item.item_type === 'scripture' ? `Verse ${idx + 1}` : `Slide ${idx + 1}`));
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
      title: item.song?.title || item.presentation?.title || item.asset?.filename || item.youtube?.title || item.liveInput?.name || null,
    };
    // Live video input — full-frame NDI feed; output windows paint the frame bus.
    // Soft-blocked while the live-input master enable is off (GO does nothing).
    if (item.item_type === 'live-input') {
      const src = item.liveInput?.sourceName;
      if (!src || !liveInputsEnabledRef.current) return null;
      return {
        ...base,
        text: '', copyright: null, backgroundPath: null, styleJson: null,
        liveInput: { sourceName: src, name: item.liveInput?.name || src },
      };
    }
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
    // template + operator monitor render the `elements` array; `text` is populated
    // from the first text element so stage/confidence monitors can display content.
    if (item.item_type === 'presentation') {
      return {
        ...base,
        text: slide.content || '', copyright: null, styleJson: null,
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
      // Split (compare) view baked into a rundown scripture item — output templates
      // render the two stacked translations; null for everything else.
      scriptureVerses: slide.splitVerses || null,
      backgroundPath: resolveBackground(item),
      styleJson: slide.style_json ? JSON.parse(slide.style_json) : null,
    };
  }

  function resolveBackground(item, slide) {
    // Foreground media shows the asset itself in the preview/live monitors.
    if (item.item_type === 'media' && item.asset?.path) return item.asset.path;
    if (item.item_type === 'youtube') return item.youtube?.status === 'ready' ? item.youtube.path : null;
    // A locked song pins its own background at the top of the cascade — it ignores
    // the per-slot override and the live global default below.
    if (item.song?.background_locked) return item.song.default_background?.path || null;
    if (item.background_override?.path) return item.background_override.path;
    if (item.item_type === 'scripture') return scriptureBgPath;
    // Presentation: per-slide background → global slide default.
    if (item.item_type === 'presentation') return slide?.background_path || slideBgPath || null;
    // Song: own default → live global default → black.
    if (item.song?.default_background?.path) return item.song.default_background.path;
    if (item.item_type === 'song') return songGlobalBgPath || null;
    return null;
  }

  function handleClickItem(item) {
    setPreviewItemId(item.id);
    setPreviewSlideIdx(0);
    // A plain click resets multi-selection and reseeds the range anchor.
    setSelectedIds(new Set());
    selectionAnchorRef.current = item.id;
  }

  // Ctrl/Cmd-click toggles one item in the selection (and moves the range anchor).
  function handleToggleSelect(itemId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
    selectionAnchorRef.current = itemId;
  }

  // Shift-click selects the contiguous range from the anchor to the clicked item.
  function handleRangeSelect(itemId) {
    const items = serviceData?.items || [];
    const anchor = selectionAnchorRef.current ?? previewItemId ?? items[0]?.id;
    const a = items.findIndex((i) => i.id === anchor);
    const b = items.findIndex((i) => i.id === itemId);
    if (a < 0 || b < 0) { handleToggleSelect(itemId); return; }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelectedIds(new Set(items.slice(lo, hi + 1).map((i) => i.id)));
  }

  // Marquee drag → replace the selection with the dragged-over ids.
  function handleSetSelection(ids) { setSelectedIds(new Set(ids)); }
  function handleClearSelection() { setSelectedIds(new Set()); }

  // ⌘A / Ctrl+A → select every rundown item.
  function handleSelectAll() {
    const items = serviceData?.items || [];
    if (!items.length) return;
    setSelectedIds(new Set(items.map((i) => i.id)));
  }

  // Bulk delete every selected item (one confirm lives in the bulk-action bar).
  async function handleBulkDelete() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    // Snapshot the items in their original order before deleting so undo can re-add.
    const itemsToDelete = (serviceData?.items || []).filter((i) => ids.includes(i.id));
    const snapshot = itemsToDelete.map((it) => ({
      item_type: it.item_type, ref_id: it.ref_id ?? null,
      content: it.content ?? null, background_override_id: it.background_override_id ?? null,
    }));
    for (const id of ids) await window.cue.services.removeItem(id);
    if (selectedIds.has(previewItemId)) setPreviewItemId(null);
    if (selectedIds.has(liveItemId)) setLiveItemId(null);
    setSelectedIds(new Set());
    refreshService();
    toast.show({
      message: `${ids.length} item${ids.length !== 1 ? 's' : ''} removed`,
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          await window.cue.services.addItems(activeServiceId, snapshot);
          refreshService();
        },
      },
    });
  }

  // Bulk apply a background to the selected song/scripture items. Locked songs and
  // non-song/scripture items are skipped (per the cascade rules); the count is reported.
  async function handleBulkSetBackground(mediaId) {
    const items = (serviceData?.items || []).filter((i) => selectedIds.has(i.id));
    let applied = 0, skipped = 0;
    for (const it of items) {
      const eligible = (it.item_type === 'song' && !it.song?.background_locked) || it.item_type === 'scripture';
      if (!eligible) { skipped++; continue; }
      await window.cue.services.setItemBackground(it.id, mediaId);
      applied++;
    }
    refreshService();
    toast.show({
      message: `Background set for ${applied} item${applied !== 1 ? 's' : ''}${skipped ? ` · ${skipped} skipped` : ''}`,
      duration: 5000,
    });
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

  // Verse/slide jump (positional Q W E … keys). Jumps the LIVE item straight to
  // slide `idx` and airs it — direct on-air navigation, the way Space/arrows step
  // but to an arbitrary verse. Keeps preview in sync when it's the same item.
  // Out-of-range presses (a key past the last slide) are a no-op.
  function handleJumpLiveSlide(idx) {
    if (!liveItem) return;
    const slides = getSlides(liveItem);
    if (idx < 0 || idx >= slides.length) return;
    const payload = buildPayload(liveItem, idx);
    if (payload) {
      window.cue.output.go(payload);
      setLiveSlideIdx(idx);
      if (liveItemId === previewItemId) setPreviewSlideIdx(idx);
    }
  }

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
    // A staged detected verse promotes through the scripture-live path, not the
    // rundown payload path (it's a non-rundown synthetic item).
    if (previewScripture) {
      handleScriptureLive(previewScripture.verse);
      warnIfNoOutputs();
      return;
    }
    if (!previewItem) return;
    const payload = buildPayload(previewItem, previewSlideIdx);
    if (payload) {
      window.cue.output.go(payload);
      setLiveItemId(previewItem.id);
      setLiveSlideIdx(previewSlideIdx);
      setLiveScripture(null);
      warnIfNoOutputs();
    }
  }

  // Show a one-per-8s toast when GO fires but no output windows are open.
  function warnIfNoOutputs() {
    if (outputWindows !== 0) return;
    const now = Date.now();
    if (now - outputWarnRef.current < 8000) return;
    outputWarnRef.current = now;
    if (!outputsEnabled) {
      toast.show({
        message: "Outputs are off — the audience can't see this.",
        duration: 6000,
        action: { label: 'Turn on outputs', onClick: () => onToggleLive?.() },
      });
    } else {
      toast.show({ message: 'No output windows are open — check Output Channels in Settings.', duration: 6000 });
    }
  }

  // Build a synthetic single-verse scripture item (the same shape the monitors +
  // buildPayload expect) — shared by the live and preview-staging paths.
  function makeScriptureItem(v, idSuffix, splitVerses) {
    const ref = `${v.bookName} ${v.chapter}:${v.verse}`;
    const slide = {
      id: `scripture-${idSuffix}-${v.bookNum}-${v.chapter}-${v.verse}`,
      type: ref,
      content: v.text,
      copyright: `${ref} (${v.versionAbbrev})`,
      style_json: null,
      // When split (compare) is active, carry both translations so the live monitor
      // mirrors the audience output. Null in the normal single-version case.
      splitVerses: splitVerses || null,
    };
    return { id: `__scripture_${idSuffix}__`, item_type: 'scripture', scriptureSlides: [slide], scripture: { reference: ref } };
  }

  // Resolve the same verse in the split (secondary) translation. Returns the two-block
  // [{text,attribution}] array, or null when split is off / unavailable so callers fall
  // back to the single-version path. Verses are matched by number across translations.
  async function resolveSplitVerses(v) {
    const sp = scriptureSplit;
    if (!sp.enabled || !sp.versionId || sp.versionId === v.versionId) return null;
    const ref = `${v.bookName} ${v.chapter}:${v.verse}`;
    try {
      const data = await window.cue.bible.verses(sp.versionId, v.bookNum, v.chapter);
      const sv = data?.verses?.find((x) => x.verse === v.verse);
      if (!sv || !sv.text) return null;
      return [
        { text: v.text, attribution: `${ref} (${v.versionAbbrev})` },
        { text: sv.text, attribution: `${ref} (${sp.abbrev})` },
      ];
    } catch { return null; }
  }

  // Send a single scripture verse live, straight from the Scriptures tab. This is
  // a non-rundown live source, so it clears any live rundown item and renders the
  // live monitor from a synthetic scripture item.
  async function handleScriptureLive(v) {
    const ref = `${v.bookName} ${v.chapter}:${v.verse}`;
    const splitVerses = await resolveSplitVerses(v);
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
      // Two-translation compare view; output templates render stacked blocks when
      // present, else fall back to `text`/`copyright`. Live monitor mirrors via the item.
      scriptureVerses: splitVerses,
    };
    window.cue.output.go(payload);
    setPreviewScripture(null);
    setLiveScripture({ item: makeScriptureItem(v, 'live', splitVerses) });
    setLiveItemId(null);
    setLiveSlideIdx(0);
  }
  scriptureLiveRef.current = handleScriptureLive;

  // Stage a detected verse into the PREVIEW monitor (high-confidence reference,
  // auto-action 'preview'). GO promotes it to live via handleScriptureLive.
  function stageScripturePreview(v) {
    setPreviewItemId(null);
    setPreviewSlideIdx(0);
    setPreviewScripture({ item: makeScriptureItem(v, 'preview'), verse: v });
  }

  function handleClear() {
    window.cue.output.clear();
    setLiveScripture(null);
  }

  // Esc: cancel a multi-selection first (a UI "escape"); only when nothing is
  // selected does Esc fall through to its Clear-output behaviour (armed/flash gate).
  function handleEscape() {
    if (selectedIds.size > 0) { setSelectedIds(new Set()); return; }
    if (shortcutsRef.current.armBare) handleClear(); else flashDisarmed('clear');
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

    const remainingIds = items.filter((i) => i.id !== itemId).map((i) => i.id);
    const label = item?.song?.title || item?.asset?.filename || item?.scripture?.reference
      || item?.presentation?.title || item?.youtube?.title
      || item?.liveInput?.name || item?.liveInput?.sourceName || 'Item';
    const serviceIdAtRemoval = activeServiceId;

    toast.show({
      message: `"${label}" removed from rundown`,
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          const newItemId = await window.cue.services.addItem(serviceIdAtRemoval, {
            item_type: item.item_type,
            ref_id: item.ref_id,
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
      },
    });
  }

  async function handleDuplicateItem(itemId) {
    await window.cue.services.duplicateItem(itemId);
    refreshService();
  }

  // ⌘D — duplicate the current selection (or the preview item if nothing is
  // multi-selected). Reuses the existing per-item duplicate IPC.
  async function handleDuplicateSelection() {
    const ids = selectedIds.size ? [...selectedIds] : (previewItemId ? [previewItemId] : []);
    if (!ids.length) return;
    for (const id of ids) await window.cue.services.duplicateItem(id);
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

  // Batch-append (Paste Song List). One service, one transaction, one refresh —
  // a per-song loop over the stale activeServiceId closure would otherwise spawn a
  // fresh service per song whenever none is active yet.
  async function handleAddManyToRundown(songIds) {
    const items = (songIds || []).map((id) => ({ item_type: 'song', ref_id: id }));
    if (!items.length) return;
    if (!activeServiceId) {
      const id = await window.cue.services.create({
        title: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        date: new Date().toISOString().split('T')[0],
      });
      onServiceChange(id);
      setServices(await window.cue.services.list());
      await window.cue.services.addItems(id, items);
      window.cue.services.get(id).then(setServiceData);
    } else {
      await window.cue.services.addItems(activeServiceId, items);
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

  // Double-click a media asset → set it as the background of the currently
  // previewed song/scripture item (a per-slot override, resolved through the
  // background cascade so the row thumbnail + output update together). Locked songs
  // are skipped with a notice; the confirmation toast carries an Undo that restores
  // the prior override.
  // Double-clicking a media asset applies it as the background of the selected
  // rundown item(s): the multi-selection if one exists, otherwise the previewed
  // item. Mirrors the pre-"unified-click" behaviour so operators can bulk-apply.
  async function handleApplyMediaBackground(assetId) {
    if (selectedIds.size > 0) { await handleBulkSetBackground(assetId); return; }
    await handleSetPreviewBackground(assetId);
  }

  async function handleSetPreviewBackground(assetId) {
    const item = serviceData?.items?.find((i) => i.id === previewItemId);
    if (!item) { toast.show({ message: 'Select a song to preview first', duration: 3000 }); return; }
    if (item.item_type !== 'song' && item.item_type !== 'scripture') {
      toast.show({ message: 'Backgrounds apply to songs and scripture only', duration: 3000 });
      return;
    }
    const label = item.song?.title || item.scripture?.reference || item.title || 'item';
    if (item.song?.background_locked) {
      toast.show({ message: `“${label}” background is locked`, duration: 4000 });
      return;
    }
    const prevOverrideId = item.background_override?.id ?? null;
    await window.cue.services.setItemBackground(item.id, assetId);
    refreshService();
    toast.show({
      message: `Background set for “${label}”`,
      duration: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          await window.cue.services.setItemBackground(item.id, prevOverrideId);
          refreshService();
        },
      },
    });
  }

  async function handleSetRundownItemBackground(itemId, assetId) {
    const item = serviceData?.items?.find((i) => i.id === itemId);
    if (!item || (item.item_type !== 'song' && item.item_type !== 'scripture')) return;
    if (item.song?.background_locked) {
      toast.show({ message: `"${item.song.title}" background is locked`, duration: 4000 }); return;
    }
    const label = item.song?.title || item.scripture?.reference || 'item';
    const prevOverrideId = item.background_override?.id ?? null;
    await window.cue.services.setItemBackground(itemId, assetId);
    refreshService();
    toast.show({
      message: `Background set for "${label}"`,
      duration: 6000,
      action: { label: 'Undo', onClick: async () => { await window.cue.services.setItemBackground(itemId, prevOverrideId); refreshService(); } },
    });
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

  // Add a live video input cue (NDI source). The source descriptor persists in the
  // item's content JSON; the feed itself is resolved live at GO time.
  async function handleAddLiveInput(source) {
    const item = {
      item_type: 'live-input',
      content: JSON.stringify({ sourceName: source.name, name: source.label || source.name }),
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
    await window.cue.services.update(activeServiceId, { title: newTitle, date: svc.date });
    const list = await window.cue.services.list();
    setServices(list);
  }

  async function handleDeleteService() {
    if (!activeServiceId) return;
    const deletedId = activeServiceId;
    // Snapshot the service and its items before deletion so undo can restore.
    // Mirrors the DangerZone approach: same fields, same re-create pattern.
    const svc = services.find((s) => s.id === deletedId);
    const name = svc?.title || 'Rundown';
    const full = await window.cue.services.get(deletedId);
    const snapshot = (full?.items || []).map((it) => ({
      item_type: it.item_type, ref_id: it.ref_id ?? null,
      content: it.content ?? null, background_override_id: it.background_override_id ?? null,
    }));
    await window.cue.services.delete(deletedId);
    if (previewItemId) setPreviewItemId(null);
    if (liveItemId) setLiveItemId(null);
    const list = await window.cue.services.list();
    setServices(list);
    onServiceChange(list.length > 0 ? list[0].id : null);
    toast.show({
      message: `"${name}" deleted`,
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: async () => {
          const newId = await window.cue.services.create({ title: name, date: svc?.date || new Date().toISOString().split('T')[0] });
          if (snapshot.length) await window.cue.services.addItems(newId, snapshot);
          const restored = await window.cue.services.list();
          setServices(restored);
          onServiceChange(newId);
        },
      },
    });
  }

  function handleRestartMedia() {
    if (!liveItem) return;
    const payload = buildPayload(liveItem, liveSlideIdx);
    if (payload) window.cue.output.go(payload);
  }

  // Toggle loop for the live media clip. Updates the live transport immediately (no
  // restart) and persists to media_loop so it sticks for the rundown badge + next GO.
  async function handleToggleLoop() {
    if (!liveItem) return;
    const next = !liveItem.media_loop;
    window.cue.output.media?.setLoop?.(next);
    await window.cue.services.setItemLoop(liveItem.id, next);
    refreshService();
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
      {/* Notice when a DISARMED bare key is pressed — the bare G/Esc do nothing while
          disarmed (toggle in Settings → Shortcuts); use the ⌘ shortcut or the buttons. */}
      {armNotice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-sm px-lg py-sm rounded-full border border-outline-variant/50 bg-surface-container-high pointer-events-none text-label-sm font-bold uppercase tracking-[0.06em] text-on-surface-variant">
          <span className="material-symbols-outlined text-[16px]">lock</span>
          Bare {armNotice === 'go' ? 'GO' : armNotice === 'output' ? 'Output toggle' : 'Clear'} is disarmed — turn Hotkeys ON (or arm it in Settings)
        </div>
      )}
      {/* Top work area */}
      <div style={{ height: `${vPct}%` }} className="flex shrink-0 min-h-0 p-gutter gap-gutter">
        <div style={{ width: `${hPct}%` }} className="shrink-0 min-w-0 overflow-hidden">
          <RundownPanel
            services={services}
            activeServiceId={activeServiceId}
            serviceData={serviceData}
            previewItemId={previewItemId}
            liveItemId={liveItemId}
            selectedIds={selectedIds}
            onSelectService={onServiceChange}
            onClickItem={handleClickItem}
            onToggleSelect={handleToggleSelect}
            onRangeSelect={handleRangeSelect}
            onSetSelection={handleSetSelection}
            onClearSelection={handleClearSelection}
            onBulkDelete={handleBulkDelete}
            onBulkSetBackground={handleBulkSetBackground}
            onDoubleClickItem={handleDoubleClickItem}
            onReorder={handleReorder}
            onRemoveItem={handleRemoveItem}
            onDuplicate={handleDuplicateItem}
            onAddService={handleAddService}
            onRenameService={handleRenameService}
            onDeleteService={handleDeleteService}
            onRefresh={refreshService}
            onSongEdited={() => setSongEditTick((t) => t + 1)}
            onSetItemBackground={handleSetRundownItemBackground}
            resolveItemBg={resolveBackground}
            liveSlideIdx={liveSlideIdx}
            liveSlideCount={getSlides(liveItem).length}
            autoAdvanceStartAt={autoAdvanceStartAt}
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
            outputsEnabled={outputsEnabled}
            liveMediaStartAt={liveMediaStartAt}
            onRestartMedia={handleRestartMedia}
            getSlides={getSlides}
            previewBgPath={previewBgPath}
            liveBgPath={liveBgPath}
            onSelectPreviewSlide={handleSelectPreviewSlide}
            onGoAtPreviewSlide={handleGoAtPreviewSlide}
            onSelectLiveSlide={handleSelectLiveSlide}
            channelTemplate={channelTemplate}
            ltFontScale={ltFontScale}
            allChannels={channels}
            liveChannelIdx={liveChannelIdx}
            onSetLiveChannelIdx={setLiveChannelIdx}
            onToggleLoop={handleToggleLoop}
            bareArmed={bareArmed}
            onToggleBareArmed={toggleBareArmed}
            jumpKeys={jumpArmed ? JUMP_KEYS : null}
            jumpArmed={jumpArmed}
            onToggleJumpArmed={async () => {
              const next = !jumpArmed;
              setJumpArmed(next);
              shortcutsRef.current.armJump = next;
              await window.cue.settings.set('shortcut_arm_jump', next);
            }}
          />
        </div>
      </div>

      {/* Scripture detection strip (shown once enabled in Settings or armed via the Scriptures-tab mic) */}
      {(detectCfg?.enabled || detectArmed) && (
        <ScriptureDetectionPanel
          armed={detectArmed}
          onToggleArm={onToggleDetect}
          transcript={detectTail}
          suggestions={detectSuggestions}
          captureActive={captureActive}
          captureError={captureError || detectCfg?.error}
          onGoLive={(s) => { goLiveFromPassage(s.passage); if (previewCandidateRef.current === s.candidateId) previewCandidateRef.current = null; setDetectSuggestions((prev) => prev.filter((x) => x.id !== s.id)); }}
          onDismiss={(s) => { if (previewCandidateRef.current === s.candidateId) previewCandidateRef.current = null; setDetectSuggestions((prev) => prev.filter((x) => x.id !== s.id)); }}
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
          onAddManyToRundown={handleAddManyToRundown}
          onAddScripture={handleAddScripture}
          onScriptureLive={handleScriptureLive}
          onScripturePreview={stageScripturePreview}
          onScriptureStyleSaved={loadScriptureDefaults}
          onBackgroundDefaultChanged={loadScriptureDefaults}
          detectArmed={detectArmed}
          detectActive={captureActive}
          detectDownloadPct={detectDownloadPct}
          onToggleDetect={onToggleDetect}
          onAddMedia={handleAddMedia}
          onApplyMediaBackground={handleApplyMediaBackground}
          onSetPreviewBackground={handleSetPreviewBackground}
          previewSongLabel={
            previewItem?.item_type === 'song'
              ? (previewItem.song?.title || previewItem.title || null)
              : previewItem?.item_type === 'scripture'
              ? (previewItem.scripture?.reference || previewItem.title || 'Scripture')
              : null
          }
          onAddYouTube={handleAddYouTube}
          onAddLiveInput={handleAddLiveInput}
          onAddPresentation={handleAddPresentation}
          onSongSave={refreshService}
          refreshTick={bgRefreshTick + songEditTick}
          focusSearchRef={focusSearchRef}
          cycleTabRef={cycleLibraryTabRef}
        />
      </div>

      {helpOpen && <ShortcutsOverlay onClose={() => setHelpOpen(false)} />}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onAddSong={handleAddToRundown}
          onAddScripture={handleAddScripture}
          onAddMedia={handleAddMedia}
          onAddPresentation={handleAddPresentation}
          onApplyScene={(scene) => window.cue.scenes.apply(scene)}
        />
      )}
    </div>
  );
}
