// ── Cue synced media player ──────────────────────────────────────────────────
// Shared by every plain output template (fullscreen.js, stage.js). Keeps a
// single <video>/<audio> element locked to the main-process transport state.
//
// The transport is machine-clock based — every window derives the SAME playhead
// position from `startAt`/`pausedAt` (same OS clock, no skew, no clock-master
// election). Convergence is done with gentle playbackRate nudging rather than
// hard seeks, so playback stays smooth and frame-aligned across all surfaces.
// Looping uses the element's native `loop` attribute (single decoder) for clean,
// gapless audio — no dual-element swap, no AudioRenderer flush artifacts.
//
// transport = { active, startAt, pausedAt, loop, muted }
//   position(now) = ((pausedAt ?? now) - startAt) / 1000   (mod duration if loop)
(function () {
  const TICK_MS   = 250;   // correction cadence
  const HARD_SEEK = 0.5;   // seconds of drift above which we hard-seek
  const NUDGE_K   = 0.5;   // playbackRate gain
  const MAX_RATE  = 1.06;  // ±6 % is inaudible with preservesPitch
  const MIN_RATE  = 0.94;

  let activePlayer    = null; // only one foreground media element at a time
  let latestTransport = null; // last transport broadcast, for late attaches

  // Subscribe once; fan transport updates out to the active player.
  if (window.cueOutput && window.cueOutput.onMediaTransport) {
    window.cueOutput.onMediaTransport((t) => {
      latestTransport = t;
      if (activePlayer) activePlayer._apply(t);
    });
  }

  // Signed drift that accounts for the loop wrap (shorter way around the loop).
  function wrappedDelta(cur, expected, duration, loop) {
    let d = cur - expected;
    if (loop && Number.isFinite(duration) && duration > 0) {
      if (d >  duration / 2) d -= duration;
      else if (d < -duration / 2) d += duration;
    }
    return d;
  }

  function attach(el, opts) {
    if (activePlayer) activePlayer.destroy();
    opts = opts || {};
    const loop      = !!opts.loop;
    const baseMuted = !!opts.baseMuted;

    el.loop = loop;
    try { el.preservesPitch = true; } catch {}
    el.muted = baseMuted;

    let transport = opts.transport || latestTransport || null;
    let timer = null;
    let destroyed = false;

    const computeExpected = () => {
      if (!transport || !transport.active) return null;
      const dur = el.duration;
      const now = Date.now();
      const ref = (transport.pausedAt != null) ? transport.pausedAt : now;
      const rate = transport.rate || 1;
      let pos = (ref - transport.startAt) / 1000 * rate;
      if (pos < 0) pos = 0;
      if (Number.isFinite(dur) && dur > 0) {
        pos = loop ? pos % dur : Math.min(pos, dur);
      }
      return pos;
    };

    const applyMuted = () => {
      const m = baseMuted || !!(transport && transport.muted);
      if (el.muted !== m) el.muted = m;
    };

    const tick = () => {
      if (destroyed || !transport || !transport.active) return;
      applyMuted();
      const expected = computeExpected();
      if (expected == null) return;
      const dur = el.duration;

      // Paused: hold exactly on the expected frame.
      if (transport.pausedAt != null) {
        if (!el.paused) el.pause();
        el.playbackRate = 1;
        if (Number.isFinite(expected) && Math.abs((el.currentTime || 0) - expected) > 0.05) {
          try { el.currentTime = expected; } catch {}
        }
        return;
      }

      // Playing: converge via playbackRate; hard-seek only on large drift. The
      // operator speed (transport.rate) is the baseline the ±6% nudge multiplies
      // around, so a 2× clip stays 2× while still converging to the shared clock.
      if (el.paused) el.play().catch(() => {});
      const base = transport.rate || 1;
      const drift = wrappedDelta(el.currentTime || 0, expected, dur, loop);
      if (Math.abs(drift) > HARD_SEEK) {
        try { el.currentTime = expected; } catch {}
        el.playbackRate = base;
      } else {
        let rate = base * (1 - drift * NUDGE_K);
        if (rate > base * MAX_RATE) rate = base * MAX_RATE;
        if (rate < base * MIN_RATE) rate = base * MIN_RATE;
        el.playbackRate = rate;
      }
    };

    const controller = {
      _apply(t) { transport = t; tick(); },   // react immediately to control events
      get transport() { return transport; },
      get element() { return el; },
      destroy() {
        destroyed = true;
        if (timer) { clearInterval(timer); timer = null; }
        try { el.pause(); } catch {}
        if (activePlayer === controller) activePlayer = null;
      },
    };

    // Seek to the right spot as soon as duration is known.
    const onMeta = () => {
      const expected = computeExpected();
      if (expected != null && Number.isFinite(expected)) {
        try { el.currentTime = expected; } catch {}
      }
      if (transport && transport.active && transport.pausedAt == null) el.play().catch(() => {});
      else if (transport && transport.pausedAt != null) el.pause();
    };
    el.addEventListener('loadedmetadata', onMeta, { once: true });
    if (el.readyState >= 1) onMeta();

    timer = setInterval(tick, TICK_MS);
    activePlayer = controller;
    return controller;
  }

  window.CueMediaPlayer = {
    attach,
    get transport() { return latestTransport; },
  };
})();
