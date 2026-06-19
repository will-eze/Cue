// ── Cue output transitions ───────────────────────────────────────────────────
// Shared by the program output templates (fullscreen.js, lowerthird.js). Animates
// the swap between the outgoing and incoming slide by snapshotting the current
// stage as a "ghost" overlay layered directly on top of the live stage, rendering
// the new content underneath, then animating the two.
//
// WHY a clone and not a per-layer A/B buffer: it needs ZERO changes to the render
// path — fullscreen.js / lowerthird.js keep mutating their existing element refs.
// The clone keeps its ids on purpose: it relies on its id-based CSS to position
// itself, and the render path uses module-cached element refs (the live originals,
// which precede the ghost in the DOM), so the duplicate ids never resolve to it.
//
// SMOOTH FADE / ZOOM — the foreground/background split. The whole OLD stage (ghost)
// fades/slides out, but the new BACKGROUND is left fully opaque underneath, so the
// screen never dips to black mid-transition (a same-background verse advance shows
// no flash at all). Only the new FOREGROUND (the text/content layer, `fgSel`) fades
// — and for zoom, scales — IN, which is the smooth cross-dissolve the eye expects.
// Slides move the whole frame together (bg + text), so they need no fg/bg split.
//
// VIDEO RULE (Option 2): the CALLER passes {type:'none'} whenever a video is
// involved on either side. Two live video decoders + the single-element transport
// clock don't mix (see CLAUDE.md / media-player.js), so any video swap is a hard
// cut — this module therefore never clones a playing video.
(function () {
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The selectable library. Mirrored (for labels) in renderer/TransitionSettings.jsx.
  const CATALOG = ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom-in', 'zoom-out'];

  // type → [incoming-from, outgoing-to] whole-frame transforms.
  const SLIDE = {
    'slide-left':  ['translateX(100%)',  'translateX(-100%)'],
    'slide-right': ['translateX(-100%)', 'translateX(100%)'],
    'slide-up':    ['translateY(100%)',  'translateY(-100%)'],
    'slide-down':  ['translateY(-100%)', 'translateY(100%)'],
  };

  let active = null; // { ghost, stage, fg, timer }

  function strip(el) {
    if (!el) return;
    el.style.transition = '';
    el.style.transform = '';
    el.style.opacity = '';
    el.style.willChange = '';
  }

  // Settle any in-flight transition instantly: drop the ghost and strip the inline
  // animation styles off the live layers. Called at the start of every run() so
  // rapid GO / advance is latest-wins and never stacks ghosts or lags the operator.
  function finish() {
    if (!active) return;
    const a = active;
    active = null;
    if (a.timer) clearTimeout(a.timer);
    if (a.ghost && a.ghost.parentNode) a.ghost.parentNode.removeChild(a.ghost);
    strip(a.stage);
    if (a.fg && a.fg !== a.stage) strip(a.fg);
  }

  function set(el, s) {
    if (!el || !s) return;
    if ('transform' in s) el.style.transform = s.transform;
    if ('opacity' in s) el.style.opacity = s.opacity;
  }

  // stage: the element to animate and clone. transition: {type, durationMs, easing}.
  // render: synchronously mutates the live stage to the new content.
  // opts.fgSel: selector of the foreground (text/content) layer within the stage that
  //   should fade/zoom in while the background stays solid. Omit to fade the whole stage.
  function run(stage, transition, render, opts) {
    finish();
    opts = opts || {};

    const type = (transition && transition.type) || 'none';
    const dur = Math.max(0, Math.min(2000, Number(transition && transition.durationMs) || 0));
    const easing = (transition && transition.easing) || 'ease';

    if (!stage || type === 'none' || dur === 0 || REDUCED || (!SLIDE[type] && type !== 'fade' && !type.startsWith('zoom'))) {
      render();
      return;
    }

    // Snapshot the current look as a ghost layered directly above the live stage.
    const ghost = stage.cloneNode(true);
    ghost.style.pointerEvents = 'none';
    ghost.style.willChange = 'transform, opacity';
    // Defensive: a ghost should never hold a playing video (those swaps arrive as
    // 'none'), but if one slips through, neutralise it rather than spawn a 2nd decoder.
    ghost.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); } catch {} m.remove(); });
    stage.after(ghost); // right above the live stage, below the #cue-gfx overlay

    // Render the new content into the live stage (underneath the ghost).
    render();

    const t = `transform ${dur}ms ${easing}, opacity ${dur}ms ${easing}`;
    const fg = opts.fgSel ? stage.querySelector(opts.fgSel) : stage;

    // Prime with transitions OFF, force one reflow, then flip to the end state so the
    // browser animates from the primed start (the classic reflow-gated transition).
    if (SLIDE[type]) {
      // Whole-frame push: bg + text travel together; the new frame is solid → no dip.
      const [inFrom, outTo] = SLIDE[type];
      stage.style.willChange = 'transform';
      stage.style.transition = 'none';
      ghost.style.transition = 'none';
      set(stage, { transform: inFrom });
      set(ghost, { transform: 'translate(0,0)' });
      void stage.offsetWidth;
      stage.style.transition = t;
      ghost.style.transition = t;
      set(stage, { transform: 'translate(0,0)' });
      set(ghost, { transform: outTo });
    } else {
      // fade / zoom: the whole OLD stage fades out over the SOLID new background; the
      // new foreground fades (and, for zoom, scales) IN. Background untouched = no dip.
      const zoomFrom = type === 'zoom-in' ? 'scale(0.92)' : type === 'zoom-out' ? 'scale(1.08)' : null;
      if (fg && fg !== stage) fg.style.willChange = 'transform, opacity';
      ghost.style.transition = 'none';
      if (fg) fg.style.transition = 'none';
      set(ghost, { opacity: '1' });
      set(fg, zoomFrom ? { opacity: '0', transform: zoomFrom } : { opacity: '0' });
      void stage.offsetWidth;
      ghost.style.transition = t;
      if (fg) fg.style.transition = t;
      set(ghost, { opacity: '0' });
      set(fg, zoomFrom ? { opacity: '1', transform: 'none' } : { opacity: '1' });
    }

    active = { ghost, stage, fg, timer: setTimeout(finish, dur + 80) };
  }

  window.CueTransitions = { run, CATALOG };
})();
