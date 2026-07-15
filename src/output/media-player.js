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

  // ── In-room program-audio output device (setSinkId) ────────────────────────
  // Route audible program audio to a chosen physical device. The descriptor
  // arrives as a query param at load and via the onAudioOutputDevice runtime
  // event. deviceIds are salted per-origin, so a value chosen in the operator
  // renderer is matched back here by deviceId → label → groupId. Only the audible
  // window (baseMuted === false) routes; muted role-windows leave the default.
  let desiredSink = null;
  try {
    const raw = new URLSearchParams(location.search).get('audioDevice');
    if (raw) desiredSink = JSON.parse(raw);
  } catch { /* malformed param → system default */ }

  async function resolveSinkId(desc) {
    if (!desc || !desc.deviceId) return ''; // '' = system default device
    try {
      const outs = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'audiooutput');
      const match = outs.find((d) => d.deviceId === desc.deviceId)
        || (desc.label   && outs.find((d) => d.label === desc.label))
        || (desc.groupId && outs.find((d) => d.groupId === desc.groupId));
      return match ? match.deviceId : '';
    } catch { return ''; }
  }

  async function applySink(el) {
    if (!el || typeof el.setSinkId !== 'function') return;
    try { await el.setSinkId(await resolveSinkId(desiredSink)); } catch { /* unsupported / denied */ }
  }

  // Auxiliary audio elements (e.g. the live-input Web Audio graph routed out
  // through a MediaStream <audio>). Registered elements follow the in-room
  // device picker exactly like the program media element — the salted-deviceId
  // matching stays in this one place.
  const auxSinkEls = new Set();
  function attachAuxAudio(el) {
    auxSinkEls.add(el);
    applySink(el);
    return () => auxSinkEls.delete(el);
  }

  if (window.cueOutput && window.cueOutput.onAudioOutputDevice) {
    window.cueOutput.onAudioOutputDevice((desc) => {
      desiredSink = desc || null;
      // Re-route the currently-playing element if this window emits audio.
      if (activePlayer && activePlayer.element && !activePlayer.baseMuted) {
        applySink(activePlayer.element);
      }
      for (const el of auxSinkEls) applySink(el);
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
    let loop        = !!opts.loop; // reactive: follows transport.loop so a live loop toggle applies without re-GO
    const baseMuted = !!opts.baseMuted;

    el.loop = loop;
    try { el.preservesPitch = true; } catch {}
    el.muted = baseMuted;
    // Route this element's audio to the configured output device (audible windows
    // only; muted role-windows stay on the default). Re-applied per element because
    // each new foreground clip creates a fresh element.
    if (!baseMuted) applySink(el);
    // Offer the element to the program-audio tap (NDI audio / streaming). The tap
    // only engages on the audible window and only while main has enabled it.
    try { window.CueAudioTap?.setElement(el, baseMuted); } catch {}

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
      _apply(t) {
        transport = t;
        // Live loop toggle: the operator flipped loop while this clip is on air.
        if (t && typeof t.loop === 'boolean' && t.loop !== loop) { loop = t.loop; el.loop = loop; }
        tick();
      },   // react immediately to control events
      get transport() { return transport; },
      get element() { return el; },
      get baseMuted() { return baseMuted; },
      destroy() {
        destroyed = true;
        if (timer) { clearInterval(timer); timer = null; }
        try { el.pause(); } catch {}
        try { window.CueAudioTap?.setElement(null, true); } catch {}
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
    attachAuxAudio,
    get transport() { return latestTransport; },
  };
})();
