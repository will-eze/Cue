// ── Stream compositor (renderer side, stream window only) ────────────────────
// The stream program diverges from the in-room/NDI program: its BASE layer is an
// external video feed (the operator's video mixer, via a capture device read with
// getUserMedia), with Cue's own program (#stage: background + lyrics + elements) and
// the broadcast-graphics overlay composited on top. Its AUDIO is the external audio
// interface (+ optionally Cue's own media), tapped here and sent to the RTMP encoder.
//
// Loaded by fullscreen.html for EVERY output window but a strict no-op unless the
// window was opened with ?stream=1 (only the offscreen stream window). In-room and
// NDI windows are untouched.
//
// Layers (paint order via z-index):
//   #cue-feed  — external camera/mixer feed (base or PiP inset)
//   #stage     — Cue program (transparent over feed, opaque when cut fullscreen, or
//                scaled into a PiP inset)
//   #cue-gfx   — broadcast graphics overlay (graphics-overlay.js, unchanged)
//
// Design notes mirror audio-tap.js: tap via captureStream() (never
// createMediaElementSource), route through a zero-gain sink so the worklet runs
// without audible output (the stream window is locally muted), load the PCM worklet
// from a blob: URL (asar-proof).
(function () {
  if (new URLSearchParams(location.search).get('stream') !== '1') return;
  if (!window.cueOutput) return;
  window.__cueStream = true;

  // Stream window is opaque (an RTMP frame, not an alpha NDI key): keep body black.
  document.documentElement.style.background = '#000';
  document.body.style.background = '#000';

  const stage   = document.getElementById('stage');
  const bg      = document.getElementById('background');
  const content = document.getElementById('content');

  // External feed base layer, inserted behind everything.
  const feed = document.createElement('video');
  feed.id = 'cue-feed';
  feed.autoplay = true;
  feed.muted = true;        // its audio is tapped via the audio graph, not played
  feed.setAttribute('playsinline', '');
  Object.assign(feed.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    objectFit: 'cover', background: '#000', zIndex: '1', display: 'none',
  });
  document.body.insertBefore(feed, document.body.firstChild);

  // ── Lower-third lyric band ────────────────────────────────────────────────────
  // Over the camera feed, Cue lyrics show as a LOWER THIRD (broadcast look), not the
  // fullscreen #content layout — the fullscreen layout is reserved for Program / PiP.
  // Mirrors lowerthird.html/css/js (ported here since the stream window loads the
  // fullscreen template). Sits above the program stage, below the graphics overlay.
  const ltStyle = document.createElement('style');
  ltStyle.textContent = `
    #cue-stream-lt { position: fixed; bottom: 0; left: 0; right: 0; padding: 24px 60px 32px;
      min-height: 160px; display: none; flex-direction: column; justify-content: flex-end;
      z-index: 6; pointer-events: none; background: transparent; }
    #cue-stream-lt.active { display: flex; }
    #cue-stream-lt-text { width: 100%; color: #fff; font-size: 48px; font-weight: 400; line-height: 1.2;
      text-align: center; text-shadow: 0 2px 8px rgba(0,0,0,0.6); white-space: pre-wrap; word-break: break-word; }
    #cue-stream-lt-copy { color: rgba(255,255,255,0.7); font-size: 18px; margin-top: 4px; }
    #cue-stream-lt-copy:empty { display: none; }
  `;
  document.head.appendChild(ltStyle);
  const ltBand = document.createElement('div');
  ltBand.id = 'cue-stream-lt';
  ltBand.innerHTML = '<div id="cue-stream-lt-text"></div><div id="cue-stream-lt-copy"></div>';
  document.body.appendChild(ltBand);
  const ltText = ltBand.querySelector('#cue-stream-lt-text');
  const ltCopy = ltBand.querySelector('#cue-stream-lt-copy');

  // Self-contained lower-third renderer (ported from lowerthird.js so run/scale/bar
  // styling matches the dedicated lower-third output exactly).
  const ltEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function ltRenderRuns(text, runs, scale = 1) {
    if (!text) return '';
    if (!runs || runs.length === 0) return ltEsc(text).replace(/\n/g, '<br>');
    const sorted = [...runs].sort((a, b) => a.start - b.start);
    let html = '', pos = 0;
    for (const run of sorted) {
      const s = Math.min(Math.max(0, run.start), text.length);
      const e = Math.min(Math.max(s, run.end), text.length);
      if (pos < s) html += ltEsc(text.slice(pos, s)).replace(/\n/g, '<br>');
      const st = [];
      if (run.bold) st.push('font-weight:700');
      if (run.italic) st.push('font-style:italic');
      const deco = [run.underline && 'underline', run.strikethrough && 'line-through'].filter(Boolean).join(' ');
      if (deco) st.push('text-decoration:' + deco);
      if (run.color) st.push('color:' + run.color);
      if (run.fontFamily) st.push("font-family:" + String(run.fontFamily).replace(/"/g, "'"));
      if (run.fontSize) st.push('font-size:' + (Number(run.fontSize) * scale) + 'px');
      const inner = ltEsc(text.slice(s, e)).replace(/\n/g, '<br>');
      html += st.length ? '<span style="' + st.join(';') + '">' + inner + '</span>' : inner;
      pos = e;
    }
    if (pos < text.length) html += ltEsc(text.slice(pos)).replace(/\n/g, '<br>');
    return html;
  }
  const ltBuildShadow = (sh) => !sh ? '' : (!sh.enabled ? 'none' : `${sh.x ?? 0}px ${sh.y ?? 2}px ${sh.blur ?? 16}px ${sh.color ?? '#000'}`);
  function ltBuildBarBg(bar) {
    if (!bar) return 'transparent';
    if (bar.css) return bar.css;
    const c = bar.color ?? '#000000', op = bar.opacity ?? 0.8;
    const r = parseInt(c.slice(1, 3), 16) || 0, g = parseInt(c.slice(3, 5), 16) || 0, b = parseInt(c.slice(5, 7), 16) || 0;
    if (bar.solid) return `rgba(${r},${g},${b},${op})`;
    return `linear-gradient(to top, rgba(${r},${g},${b},${op}) 0%, rgba(${r},${g},${b},${(op * 0.7).toFixed(2)}) 70%, transparent 100%)`;
  }
  function ltApplyStyle(el, s, scale = 1) {
    s = s || {};
    el.style.width = '100%';
    el.style.fontFamily = s.fontFamily || '';
    el.style.textAlign = s.align || 'center';
    el.style.fontWeight = s.bold ? '700' : '400';
    el.style.fontStyle = s.italic ? 'italic' : 'normal';
    el.style.textDecoration = [s.underline && 'underline', s.strikethrough && 'line-through'].filter(Boolean).join(' ') || 'none';
    el.style.fontSize = (Number(s.fontSize) || 72) * scale + 'px';
    el.style.color = s.color || '';
    el.style.lineHeight = s.lineSpacing ? String(s.lineSpacing) : '';
    el.style.letterSpacing = s.letterSpacing ? s.letterSpacing + 'em' : '';
    el.style.textTransform = s.uppercase ? 'uppercase' : 'none';
    el.style.textShadow = ltBuildShadow(s.textShadow) || '';
    el.style.webkitTextStroke = (s.textStroke && s.textStroke.enabled) ? `${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}` : '';
    ltBand.style.background = ltBuildBarBg(s.ltBar);
  }
  function ltApplyCopyright(el, cs, defAlign) {
    el.style.textAlign = (cs && cs.align) || defAlign || '';
    el.style.fontFamily = cs?.fontFamily || '';
    el.style.fontSize = cs?.fontSize ? cs.fontSize + 'px' : '';
    el.style.color = cs?.color || '';
    el.style.fontWeight = cs?.bold ? '700' : '';
    el.style.fontStyle = cs?.italic ? 'italic' : '';
  }

  let ltVisible = false;     // feed mode + lyrics-over-feed on
  let lastSlide = null;
  function clearLT() { ltBand.classList.remove('active'); ltText.innerHTML = ''; ltCopy.textContent = ''; ltBand.style.background = 'transparent'; }
  function renderLT(p) {
    if (!ltVisible || !p) { clearLT(); return; }
    const { type, text, copyright: copy, styleJson } = p;
    // clear / logo / media / presentation carry no lyric band (matches lowerthird.js).
    if (type === 'clear' || type === 'logo' || p.media || p.elements) { clearLT(); return; }
    const scale = (Number(p.ltFontScale) > 0) ? Number(p.ltFontScale) : 1;
    ltApplyStyle(ltText, styleJson, scale);
    ltText.innerHTML = ltRenderRuns(text || '', styleJson?.runs, scale);
    ltCopy.textContent = copy || '';
    ltApplyCopyright(ltCopy, p.copyrightStyle, p.copyrightAlign === 'right' ? 'right' : '');
    ltBand.classList.add('active');
  }
  window.cueOutput.onSlideUpdate?.((p) => { lastSlide = p; renderLT(p); });

  // ── Design space (resolution independence) ────────────────────────────────────
  // Cue content (the program #stage, the lower-third band, and the broadcast-graphics
  // overlay) is authored against a fixed 1920×1080 canvas — exactly like an output
  // monitor. We make those layers 1920×1080 boxes and SCALE them to the encode
  // resolution, so lyrics/graphics keep the same on-screen size whether the stream is
  // 720p or 4K. The camera feed is NOT design-scaled — it fills the frame natively, so
  // a 4K feed stays 4K. (#slide-elements already self-scales in fullscreen.js, so we
  // neutralise that here to avoid double-scaling inside the scaled stage.)
  const DW = 1920, DH = 1080;
  const gfx = document.getElementById('cue-gfx');
  function makeDesignBox(el) {
    if (!el) return;
    el.style.position = 'fixed';
    el.style.top = '0'; el.style.left = '0'; el.style.right = 'auto'; el.style.bottom = 'auto';
    el.style.width = DW + 'px'; el.style.height = DH + 'px';
    el.style.transformOrigin = 'top left';
  }
  // Stop fullscreen.js's scaleSlideCanvas() from scaling #slide-elements a second time
  // (the scaled #stage already provides the viewport scale).
  const dsStyle = document.createElement('style');
  dsStyle.textContent = '#slide-elements { transform: none !important; }';
  document.head.appendChild(dsStyle);
  makeDesignBox(stage); makeDesignBox(ltBand); makeDesignBox(gfx);
  // Use CSS `zoom`, NOT `transform: scale`, for the base design scale. transform caches
  // the layer at its 1920×1080 raster size and GPU-upscales it, so a 4K stream would
  // just show blurry-upscaled 1080 content. `zoom` re-rasterizes natively at the target
  // resolution, so text/graphics are crisp at 4K. (PiP still uses transform — but only
  // to shrink the already-crisp stage into an inset, which doesn't degrade quality.)
  function applyDesignScale() {
    const s = window.innerWidth / DW; // 16:9 → uniform scale
    if (ltBand) ltBand.style.zoom = s;
    if (gfx) gfx.style.zoom = s;
    stage.style.zoom = s;
    applyLayout(null); // re-apply stage transform (full or PiP) at the new scale
  }
  window.addEventListener('resize', applyDesignScale);

  // ── Layout / cut model ──────────────────────────────────────────────────────
  // Free-form composition of two layers over a black backdrop. Boxes are PERCENT of
  // the frame; `front` is the z-order when they overlap; the feed's `fit` is object-fit.
  //   { feed:{visible,x,y,w,h,fit}, program:{visible,x,y,w,h}, front:'feed'|'program',
  //     lyricsOverFeed:bool }
  let layout = {
    feed:    { visible: true,  x: 0, y: 0, w: 100, h: 100, fit: 'cover' },
    program: { visible: false, x: 0, y: 0, w: 100, h: 100 },
    front: 'program', lyricsOverFeed: false,
  };

  // The Cue program is a designed 16:9 surface; placed in a box it is scaled UNIFORM-FIT
  // and CENTRED (letterboxed) so lyrics/graphics never distort. Returns the actual
  // rendered rect inside the box, all in % of the frame. MUST stay identical to the copy
  // in StreamLayoutEditor.jsx (renderer can't import an output script) so the editor is
  // a true WYSIWYG of this output.
  function programFit(b) {
    const f = Math.min(b.w, b.h) / 100;          // uniform scale factor (frame-relative)
    const left = b.x + (b.w - 100 * f) / 2;      // centre within the box
    const top = b.y + (b.h - 100 * f) / 2;
    return { left, top, f, w: 100 * f, h: 100 * f };
  }

  // Position the feed <video> by percent box + object-fit.
  function boxFeed(b) {
    feed.style.inset = 'auto';
    feed.style.left = b.x + '%'; feed.style.top = b.y + '%';
    feed.style.width = b.w + '%'; feed.style.height = b.h + '%';
    feed.style.objectFit = b.fit === 'contain' ? 'contain' : 'cover';
  }
  // Position the Cue program (#stage). The stage is already `zoom`-scaled to fill the
  // frame (applyDesignScale); a transform shrinks/places it into its box. Down-scaling
  // crisp content doesn't degrade it. Two fit modes: 'fit' scales UNIFORM and CENTRES
  // (letterbox — preserves the program's 16:9, the default), 'fill' STRETCHES to the box.
  // CRITICAL: translate in ELEMENT-RELATIVE % (not vw/vh). The stage carries a `zoom`,
  // and zoom multiplies viewport-unit translates — so `vw/vh` here would be double-scaled
  // and mis-place the box. `%` translates resolve against the stage's own 1920×1080 box
  // (which == the frame after zoom), so the geometry is preserved regardless of zoom.
  function boxStage(b) {
    if (b.fit === 'fill') {                       // stretch to fill the exact box
      stage.style.transform = `translate(${b.x}%, ${b.y}%) scale(${b.w / 100}, ${b.h / 100})`;
      return;
    }
    const { left, top, f } = programFit(b);        // letterbox, centred
    stage.style.transform = `translate(${left}%, ${top}%) scale(${f})`;
  }

  function applyLayout(L) {
    if (L) layout = {
      feed: { ...layout.feed, ...(L.feed || {}) },
      program: { ...layout.program, ...(L.program || {}) },
      front: L.front || layout.front,
      lyricsOverFeed: 'lyricsOverFeed' in L ? !!L.lyricsOverFeed : layout.lyricsOverFeed,
    };
    const { feed: F, program: P, front, lyricsOverFeed } = layout;

    // Feed layer.
    if (F.visible) { feed.style.display = ''; boxFeed(F); }
    else feed.style.display = 'none';

    // Program layer — opacity gates its background AND content together (a hidden
    // program must drop both, exactly like the old 'feed' mode).
    if (P.visible) { bg.style.opacity = '1'; content.style.opacity = '1'; boxStage(P); }
    else { bg.style.opacity = '0'; content.style.opacity = '0'; }

    // Z-order: the chosen layer sits on top. (gfx overlay stays above both at z 6+.)
    if (front === 'feed') { feed.style.zIndex = '3'; stage.style.zIndex = '2'; }
    else { feed.style.zIndex = '2'; stage.style.zIndex = '3'; }

    // The lower-third lyric band is the broadcast alternative to the fullscreen program
    // content — shown over the feed when enabled (independent of the program box).
    ltVisible = !!lyricsOverFeed;
    renderLT(lastSlide);
  }
  applyDesignScale(); // sets stage + band + overlay transforms, then applyLayout

  // Chromium hides device labels and salts deviceIds PER ORIGIN, so the id the
  // operator picked (a different origin) won't resolve here. Unlock labels once, then
  // resolve the chosen device by LABEL (falling back to the id, then any device).
  let labelsUnlocked = false;
  async function unlockLabels() {
    if (labelsUnlocked) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {}
    labelsUnlocked = true;
  }
  async function resolveId(kind, id, label) {
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind);
      if (label) { const m = devices.find((d) => d.label === label); if (m) return m.deviceId; }
      if (id && devices.some((d) => d.deviceId === id)) return id;
    } catch {}
    return id || null;
  }

  // ── External video input ─────────────────────────────────────────────────────
  let videoStream = null;
  let curVideoKey = null;
  async function openVideo(deviceId, label) {
    const key = deviceId || label || null;
    if (key === curVideoKey && videoStream) return;
    if (videoStream) { try { videoStream.getTracks().forEach((t) => t.stop()); } catch {} videoStream = null; }
    feed.srcObject = null;
    curVideoKey = key;
    if (!key) return;
    try {
      await unlockLabels();
      const id = await resolveId('videoinput', deviceId, label);
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1080 } } : true,
        audio: false,
      });
      feed.srcObject = videoStream;
      await feed.play().catch(() => {});
    } catch (e) { console.error('[stream-feed] video open failed', e); }
  }

  // ── Stream audio graph (external interface + optional Cue media) → RTMP tap ───
  let ctx = null, workletReady = null, tapNode = null, sinkNode = null, mixBus = null;
  let meterL = null, meterR = null, meterBufL = null, meterBufR = null, meterTimer = null;
  let micStream = null, micSrc = null, curAudioKey = null;
  let mediaSrc = null, curMediaEl = null;
  let audioMode = 'external';   // 'external' | 'mixed'
  let tapEnabled = false;       // main turns the PCM send on at Go Live

  async function loadWorklet() {
    let url = 'pcm-tap-worklet.js';
    try {
      const src = await window.cueOutput?.getWorkletSource?.();
      if (src) url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    } catch {}
    return ctx.audioWorklet.addModule(url);
  }

  async function ensureCtx() {
    if (ctx) { if (ctx.state === 'suspended') await ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx({ sampleRate: 48000 });
    mixBus = ctx.createGain(); mixBus.gain.value = 1;
    workletReady = loadWorklet();
    await workletReady;
    tapNode = new AudioWorkletNode(ctx, 'cue-pcm-tap');
    tapNode.port.onmessage = (ev) => {
      if (!tapEnabled) return;
      const { planar, channels, samples, sampleRate } = ev.data;
      try { window.cueOutput?.sendStreamAudioPcm?.(planar, { channels, samples, sampleRate }); } catch {}
    };
    // Zero-gain sink keeps the graph pulled without leaking audio to the device.
    sinkNode = ctx.createGain(); sinkNode.gain.value = 0;
    mixBus.connect(tapNode); tapNode.connect(sinkNode); sinkNode.connect(ctx.destination);

    // Stereo peak meters for the Stream tab — split the mix and analyse each channel.
    const splitter = ctx.createChannelSplitter(2);
    mixBus.connect(splitter);
    meterL = ctx.createAnalyser(); meterR = ctx.createAnalyser();
    meterL.fftSize = 1024; meterR.fftSize = 1024;
    splitter.connect(meterL, 0); splitter.connect(meterR, 1);
    meterBufL = new Float32Array(meterL.fftSize); meterBufR = new Float32Array(meterR.fftSize);
    const peak = (an, buf) => { an.getFloatTimeDomainData(buf); let p = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; } return p; };
    meterTimer = setInterval(() => {
      try { window.cueOutput?.sendStreamLevels?.({ l: peak(meterL, meterBufL), r: peak(meterR, meterBufR) }); } catch {}
    }, 50);
  }

  async function openAudio(deviceId, label) {
    await ensureCtx();
    const key = deviceId || label || null;
    if (key === curAudioKey && micStream) return;
    if (micSrc) { try { micSrc.disconnect(); } catch {} micSrc = null; }
    if (micStream) { try { micStream.getTracks().forEach((t) => t.stop()); } catch {} micStream = null; }
    curAudioKey = key;
    if (!key) return;
    try {
      await unlockLabels();
      const id = await resolveId('audioinput', deviceId, label);
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      micSrc = ctx.createMediaStreamSource(micStream);
      micSrc.connect(mixBus);
    } catch (e) { console.error('[stream-feed] audio open failed', e); }
  }

  // Mix Cue's own foreground media into the stream audio (the "external + Cue media"
  // mode), tapped via captureStream so the element's playback/mute is untouched.
  function attachMedia(el) {
    if (mediaSrc) { try { mediaSrc.disconnect(); } catch {} mediaSrc = null; }
    curMediaEl = el || null;
    if (!el || audioMode !== 'mixed' || !ctx) return;
    const cap = el.captureStream || el.mozCaptureStream;
    if (!cap) return;
    let ms;
    try { ms = cap.call(el); } catch { return; }
    if (!ms || ms.getAudioTracks().length === 0) {
      el.addEventListener('playing', () => attachMedia(el), { once: true });
      return;
    }
    mediaSrc = ctx.createMediaStreamSource(ms);
    mediaSrc.connect(mixBus);
  }
  // Live-input (NDI receive) audio in 'mixed' mode: fullscreen.js hands the raw
  // planar Float32 PCM from the live:audio bus here (a live input has no media
  // element to captureStream). Chunks are scheduled back-to-back into the mixBus
  // behind an ~80ms jitter buffer; the AudioBufferSourceNode resamples to the
  // mixer's 48k automatically when the source rate differs.
  let liveNextAt = 0;
  function pushLivePcm(f) {
    if (audioMode !== 'mixed' || !ctx || !mixBus || !f || !f.samples) return;
    try {
      const { sampleRate, channels, samples } = f;
      const bytes = f.data;
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + samples * channels * 4);
      const all = new Float32Array(ab);
      const buf = ctx.createBuffer(channels, samples, sampleRate);
      for (let ch = 0; ch < channels; ch++) buf.copyToChannel(all.subarray(ch * samples, (ch + 1) * samples), ch);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(mixBus);
      const now = ctx.currentTime;
      if (liveNextAt < now + 0.02) liveNextAt = now + 0.08;
      src.start(liveNextAt);
      liveNextAt += buf.duration;
    } catch {}
  }

  // fullscreen.js calls onMediaElement whenever it attaches/clears a foreground
  // media element, and pushLivePcm for each live-input audio chunk.
  window.CueStreamFeed = { onMediaElement: (el) => attachMedia(el), pushLivePcm };

  // ── Bus from main ─────────────────────────────────────────────────────────────
  window.cueOutput.onStreamInput?.((cfg) => {
    cfg = cfg || {};
    if ('audioMode' in cfg) { audioMode = cfg.audioMode || 'external'; attachMedia(curMediaEl); }
    if ('videoDeviceId' in cfg || 'videoLabel' in cfg) openVideo(cfg.videoDeviceId, cfg.videoLabel);
    if ('audioDeviceId' in cfg || 'audioLabel' in cfg) openAudio(cfg.audioDeviceId, cfg.audioLabel);
  });
  window.cueOutput.onStreamLayout?.((L) => applyLayout(L));
  window.cueOutput.onStreamAudioTap?.((on) => {
    tapEnabled = !!on;
    if (on) ensureCtx();
  });
})();
