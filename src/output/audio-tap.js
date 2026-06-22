// ── Program-audio tap (renderer side) ────────────────────────────────────────
// Builds a non-intrusive copy of the in-room program audio and streams it as PCM
// to the main process, which forwards it to the NDI sender(s) and/or the RTMP
// encoder. This is the shared foundation for "NDI with sound" and "stream to
// YouTube with sound".
//
// Design notes:
//  • Only the AUDIBLE window taps (baseMuted === false). The architecture
//    guarantees exactly one such primary audio monitor; every other output window
//    is muted and ignores the tap entirely.
//  • We tap via el.captureStream() rather than createMediaElementSource() so the
//    element's own playback + setSinkId routing (the in-room device picker) are
//    left completely untouched. captureStream needs a CORS-clean element — the
//    foreground media element sets crossOrigin='anonymous' and the cue-media://
//    handler returns Access-Control-Allow-Origin, so the stream is not tainted.
//  • The AudioContext is pinned to 48 kHz so NDI/ffmpeg get a known, fixed rate.
//  • Main toggles the tap on/off via the 'audio:tap' event — it only runs while a
//    consumer (NDI audio channel or active stream) actually needs it.
(function () {
  let enabled = false;     // main says a consumer needs the tap
  let curEl = null;        // current foreground media element
  let curBaseMuted = true; // is THIS window the audible one?

  let ctx = null;
  let workletReady = null; // Promise from addModule
  let srcNode = null;      // MediaStreamAudioSourceNode
  let tapNode = null;      // AudioWorkletNode
  let sinkNode = null;     // zero-gain sink (keeps the graph "pulled")
  let stream = null;

  // Load the worklet from a blob: URL built from source read in main. A relative
  // file path works in dev but AudioWorklet.addModule cannot reliably fetch a
  // module from inside app.asar in a packaged build (src/output isn't unpacked) —
  // the blob path is asar-proof and CSP allows blob: in script-src/worker-src.
  async function loadWorklet() {
    let url = 'pcm-tap-worklet.js'; // dev fallback
    try {
      const src = await window.cueOutput?.getWorkletSource?.();
      if (src) url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    } catch { /* fall back to relative path */ }
    return ctx.audioWorklet.addModule(url)
      .catch((e) => { console.error('[audio-tap] worklet load failed', e); throw e; });
  }

  function ensureCtx() {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx({ sampleRate: 48000 });
    workletReady = loadWorklet();
    return ctx;
  }

  function teardown() {
    try { if (srcNode) srcNode.disconnect(); } catch {}
    try { if (tapNode) { tapNode.port.onmessage = null; tapNode.disconnect(); } } catch {}
    try { if (sinkNode) sinkNode.disconnect(); } catch {}
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch {}
    srcNode = tapNode = sinkNode = stream = null;
  }

  async function start() {
    if (!enabled || !curEl || curBaseMuted) return;
    teardown();
    try {
      ensureCtx();
      await workletReady;
      if (ctx.state === 'suspended') await ctx.resume();

      const capture = curEl.captureStream || curEl.mozCaptureStream;
      if (!capture) return;
      stream = capture.call(curEl);
      if (!stream || stream.getAudioTracks().length === 0) {
        // Track may not exist until playback actually starts — retry on 'playing'.
        if (curEl) curEl.addEventListener('playing', () => start(), { once: true });
        return;
      }

      srcNode = ctx.createMediaStreamSource(stream);
      tapNode = new AudioWorkletNode(ctx, 'cue-pcm-tap');
      tapNode.port.onmessage = (ev) => {
        const { planar, channels, samples, sampleRate } = ev.data;
        try { window.cueOutput?.sendAudioPcm?.(planar, { channels, samples, sampleRate }); } catch {}
      };
      // A worklet node only runs while it has a path to the destination, so route
      // it through a muted gain — it analyses, it does not re-output audio.
      sinkNode = ctx.createGain();
      sinkNode.gain.value = 0;
      srcNode.connect(tapNode);
      tapNode.connect(sinkNode);
      sinkNode.connect(ctx.destination);
    } catch (e) {
      console.error('[audio-tap] start failed', e);
      teardown();
    }
  }

  if (window.cueOutput && window.cueOutput.onAudioTap) {
    window.cueOutput.onAudioTap((on) => {
      enabled = !!on;
      if (enabled) start(); else teardown();
    });
  }

  // media-player.js calls this on every foreground media element it attaches.
  window.CueAudioTap = {
    setElement(el, baseMuted) {
      curEl = el || null;
      curBaseMuted = !!baseMuted;
      if (enabled && curEl && !curBaseMuted) start();
      else teardown();
    },
  };
})();
