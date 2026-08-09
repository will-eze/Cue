const bg       = document.getElementById('background');
const scrim    = document.getElementById('scrim');
const textWrap = document.getElementById('text-wrap');
const textEl   = document.getElementById('text');
const logoWrap = document.getElementById('logo-wrap');
const copyright = document.getElementById('copyright');

const IS_NDI    = new URLSearchParams(location.search).get('alpha') === '1';
const MUTE_AUDIO = new URLSearchParams(location.search).get('mute')  === '1';
if (IS_NDI) {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
}

function pathToUrl(p) {
  if (!p) return null;
  const normalized = p.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  // Default cue-media:// for real output windows; the remote-output browser sets
  // CUE_MEDIA_BASE (an http /output/media endpoint) + CUE_MEDIA_SUFFIX (?vt=token).
  const base = (typeof window !== 'undefined' && window.CUE_MEDIA_BASE) || 'cue-media://localhost';
  const suffix = (typeof window !== 'undefined' && window.CUE_MEDIA_SUFFIX) || '';
  return base + pathPart.split('/').map(encodeURIComponent).join('/') + suffix;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderWithRuns(text, runs) {
  if (!text) return '';
  if (!runs || runs.length === 0) return esc(text).replace(/\n/g, '<br>');
  const sorted = [...runs].sort((a, b) => a.start - b.start);
  let html = '', pos = 0;
  for (const run of sorted) {
    const s = Math.min(Math.max(0, run.start), text.length);
    const e = Math.min(Math.max(s, run.end),   text.length);
    if (pos < s) html += esc(text.slice(pos, s)).replace(/\n/g, '<br>');
    const st = [];
    if (run.bold)       st.push('font-weight:700');
    if (run.italic)     st.push('font-style:italic');
    const deco = [run.underline && 'underline', run.strikethrough && 'line-through'].filter(Boolean).join(' ');
    if (deco)           st.push('text-decoration:' + deco);
    if (run.color)      st.push('color:' + run.color);
    if (run.fontFamily) st.push("font-family:" + String(run.fontFamily).replace(/"/g, "'"));
    if (run.fontSize)   st.push('font-size:' + Number(run.fontSize) + 'px');
    const inner = esc(text.slice(s, e)).replace(/\n/g, '<br>');
    html += st.length ? '<span style="' + st.join(';') + '">' + inner + '</span>' : inner;
    pos = e;
  }
  if (pos < text.length) html += esc(text.slice(pos)).replace(/\n/g, '<br>');
  return html;
}

// List-style / paragraph-spacing wrapper around renderWithRuns. Mirrors the React
// version in SongEditor.jsx — keep the two in sync when changing the logic.
function renderTextContent(text, runs, style) {
  const listStyle = style?.listStyle;
  const bulletSpacing = style?.bulletSpacing;
  const paragraphSpacing = style?.paragraphSpacing;

  if (listStyle && listStyle !== 'none') {
    const tag = listStyle === 'decimal' ? 'ol' : 'ul';
    const lines = (text || '').split('\n');
    let curPos = 0;
    const items = [];
    for (const line of lines) {
      const lineStart = curPos;
      const lineEnd = curPos + line.length;
      curPos += line.length + 1;
      if (!line.trim()) continue;
      const lineRuns = (runs || [])
        .filter((r) => r.end > lineStart && r.start < lineEnd)
        .map((r) => ({ ...r, start: Math.max(0, r.start - lineStart), end: Math.min(line.length, r.end - lineStart) }));
      const bsStyle = bulletSpacing ? `margin-bottom:${bulletSpacing}em` : '';
      items.push(`<li style="${bsStyle}">${renderWithRuns(line, lineRuns)}</li>`);
    }
    return `<${tag} style="padding-left:1.5em;margin:0;list-style-type:${listStyle}">${items.join('')}</${tag}>`;
  }

  if (paragraphSpacing) {
    const parts = (text || '').split('\n\n');
    let curPos = 0;
    return parts.map((para, i) => {
      const paraStart = curPos;
      curPos += para.length + 2;
      const paraRuns = (runs || [])
        .filter((r) => r.end > paraStart && r.start < paraStart + para.length)
        .map((r) => ({ ...r, start: Math.max(0, r.start - paraStart), end: Math.min(para.length, r.end - paraStart) }));
      const mbStyle = i < parts.length - 1 ? `margin-bottom:${paragraphSpacing}em` : '';
      return `<div style="${mbStyle}">${renderWithRuns(para, paraRuns)}</div>`;
    }).join('');
  }

  return renderWithRuns(text, runs);
}

// noDefault suppresses the song readability fallback for presentation elements,
// where shadow Off should mean truly no shadow (not a dark auto-shadow).
function buildShadow(shadow, noDefault = false) {
  if (!shadow) return noDefault ? 'none' : '0 2px 16px rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.6)';
  if (!shadow.enabled) return 'none';
  return `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}`;
}

// underline + strikethrough combine into one text-decoration value.
function buildDecoration(s) {
  const deco = [s && s.underline && 'underline', s && s.strikethrough && 'line-through'].filter(Boolean).join(' ');
  return deco || 'none';
}

// style.boxFill → rgba() background for the fill panel behind the text box.
function boxFillBg(bf) {
  const c = (bf && bf.color) || '#000000';
  const r = parseInt(c.slice(1, 3), 16) || 0;
  const g = parseInt(c.slice(3, 5), 16) || 0;
  const b = parseInt(c.slice(5, 7), 16) || 0;
  return `rgba(${r},${g},${b},${bf.opacity != null ? bf.opacity : 0.5})`;
}

// Scale authored 1920×1080 px values to the current viewport size.
// Uses min(x,y) so the design fits without stretching on any aspect ratio.
function viewportScale() {
  return Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
}

// Last-rendered lyric/scripture style — stored so the resize handler can re-apply
// scaled px values without re-triggering slide transitions.
let _liveStyle = null;
let _liveCopyrightStyle = null;
let _liveCopyrightDefaultAlign = 'center';

function applyStyle(s) {
  _liveStyle = s;
  // Background scrim (transparent→black) — clamp 0..1; clear when there's no slide.
  if (scrim) scrim.style.opacity = String(Math.max(0, Math.min(1, (s && s.bgScrim) || 0)));
  if (!s) {
    textWrap.style.cssText = '';
    textEl.style.cssText   = '';
    return;
  }

  const vs = viewportScale();

  // Position/size the text box
  const tb = s.textBox;
  textWrap.style.position      = 'absolute';
  textWrap.style.left          = (tb ? tb.x : 5) + '%';
  textWrap.style.top           = (tb ? tb.y : 5) + '%';
  textWrap.style.width         = (tb ? tb.w : 90) + '%';
  textWrap.style.height        = (tb ? tb.h : 90) + '%';
  textWrap.style.display       = 'flex';
  textWrap.style.flexDirection = 'column';
  textWrap.style.justifyContent = s.verticalAlign === 'top'    ? 'flex-start'
                                : s.verticalAlign === 'bottom' ? 'flex-end'
                                : 'center';
  textWrap.style.overflow  = 'hidden';
  textWrap.style.boxSizing = 'border-box';

  // Box fill — colour panel behind the text box (legibility on busy backgrounds).
  // px values (radius/padding) scale with the output resolution like font sizes.
  if (s.boxFill && s.boxFill.enabled) {
    textWrap.style.background   = boxFillBg(s.boxFill);
    textWrap.style.borderRadius = Math.round((s.boxFill.radius != null ? s.boxFill.radius : 0) * vs) + 'px';
    textWrap.style.padding      = Math.round((s.boxFill.pad != null ? s.boxFill.pad : 24) * vs) + 'px';
  } else {
    textWrap.style.background   = '';
    textWrap.style.borderRadius = '';
    textWrap.style.padding      = '0';
  }

  // Text styles — px values scaled to the current output resolution
  textEl.style.fontFamily      = s.fontFamily   || '';
  textEl.style.textAlign       = s.align        || 'center';
  textEl.style.fontWeight      = s.bold         ? '700' : '400';
  textEl.style.fontStyle       = s.italic       ? 'italic' : 'normal';
  textEl.style.textDecoration  = buildDecoration(s);
  textEl.style.fontSize        = s.fontSize     ? Math.round(s.fontSize * vs * CONTENT_FONT_SCALE) + 'px' : '';
  textEl.style.color           = s.color        || '';
  textEl.style.lineHeight      = s.lineSpacing  ? String(s.lineSpacing) : '';
  textEl.style.letterSpacing   = s.letterSpacing ? s.letterSpacing + 'em' : '';
  textEl.style.textTransform   = s.uppercase    ? 'uppercase' : 'none';
  textEl.style.textShadow      = buildShadow(s.textShadow);
  textEl.style.webkitTextStroke = (s.textStroke && s.textStroke.enabled)
    ? `${Math.round((s.textStroke.width ?? 2) * vs)}px ${s.textStroke.color ?? '#000'}`
    : '';
  textEl.style.whiteSpace = 'pre-wrap';
  textEl.style.wordBreak  = 'break-word';
  textEl.style.width      = '100%';
}

// Per-output-channel content font scale. Read once from the ?cfs= query param main
// sets at window creation, live-updated via the 'content:scale' IPC. 1 = author's
// size (neutral); >1 grows every slide's text for a large screen (an 80" TV), <1
// shrinks it. Mirrors the lower-third ltFontScale model, but per screen — it's a
// straight multiplier on the authored font size, NOT an auto-fill-the-box target.
let CONTENT_FONT_SCALE = (() => {
  const v = Number(new URLSearchParams(location.search).get('cfs'));
  return isFinite(v) && v > 0 ? v : 1;
})();

// Split-verse auto-fit: binary-search the font size so the stacked translations fill
// — but never overflow — the text box. `maxPx` caps it at the authored scripture size
// (× the per-channel content scale) so a single short verse pair never blows up larger
// than normal scripture, while a large-screen channel still scales the cap up.
let lastSplitMax = 0;
function fitSplitText(maxPx) {
  const vs = viewportScale();
  const maxH = textWrap.clientHeight;
  const cap = Math.max(Math.round(22 * vs), Math.round(maxPx * CONTENT_FONT_SCALE * vs));
  if (!maxH) { textEl.style.fontSize = cap + 'px'; return; }
  textEl.style.fontSize = cap + 'px';
  if (textEl.scrollHeight <= maxH) return;
  let lo = Math.round(22 * vs), hi = cap;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    textEl.style.fontSize = mid + 'px';
    if (textEl.scrollHeight <= maxH) lo = mid; else hi = mid;
  }
  textEl.style.fontSize = lo + 'px';
}

function showLogo(p, scaleMode) {
  if (!p) { logoWrap.innerHTML = ''; logoWrap.className = ''; return; }
  const url = pathToUrl(p);
  const ext = p.split('.').pop().toLowerCase();
  const fit = scaleMode === 'cover' ? 'cover' : 'contain';
  logoWrap.innerHTML = ['mp4','webm','mov','avi','m4v'].includes(ext)
    ? `<video class="logo-img" style="object-fit:${fit}" autoplay loop muted playsinline src="${url}"></video>`
    : `<img class="logo-img" style="object-fit:${fit}" src="${url}" alt="Logo" />`;
  logoWrap.className = 'logo-active';
}

function hideLogo() {
  logoWrap.innerHTML = '';
  logoWrap.className = '';
}

// ── Background video loop-blend ───────────────────────────────────────────────
// For muted background videos only: crossfade the near-end frame into a fresh
// copy playing from the start so the loop feels continuous rather than a jump cut.
// Two <video> elements (active + standby) swap roles on each cycle. This is safe
// for background (always muted) and does not affect the transport-synced foreground
// player (which keeps native `loop` for gapless audio).
let LOOP_BLEND_SECS = 2.0; // updated per slide:update payload (bg_loop_blend_secs setting)
let LOOP_MODE = 'blend';   // 'blend' | 'jump', updated per slide:update payload
let _bgController = null;

function destroyBgController() {
  if (_bgController) { _bgController.destroy(); _bgController = null; }
}

function createLoopBlendBackground(url) {
  function makeVid() {
    const v = document.createElement('video');
    v.setAttribute('playsinline', '');
    v.muted = true;
    v.preload = 'auto';
    Object.assign(v.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' });
    v.src = url;
    bg.appendChild(v);
    return v;
  }

  let active = makeVid();
  let standby = makeVid();
  active.style.opacity = '1';
  standby.style.opacity = '0';

  let blending = false;
  let destroyed = false;

  function startBlend() {
    if (blending || destroyed) return;
    blending = true;
    standby.currentTime = 0;
    standby.play().catch(() => {});
    const t = LOOP_BLEND_SECS + 's';
    active.style.transition  = `opacity ${t} linear`;
    active.style.opacity     = '0';
    standby.style.transition = `opacity ${t} linear`;
    standby.style.opacity    = '1';
  }

  function onEnded() {
    if (destroyed) return;
    // Swap roles: standby (now at full opacity, playing) becomes active.
    const old = active;
    active  = standby;
    standby = old;
    // Reset old active: instant opacity reset, pause, rewind.
    standby.style.transition = '';
    standby.style.opacity    = '0';
    standby.pause();
    active.style.transition = '';
    active.style.opacity    = '1';
    blending = false;
    old.removeEventListener('timeupdate', onTimeUpdate);
    old.removeEventListener('ended',      onEnded);
    active.addEventListener('timeupdate', onTimeUpdate);
    active.addEventListener('ended',      onEnded);
  }

  function onTimeUpdate() {
    if (blending || destroyed) return;
    const dur = active.duration;
    if (!Number.isFinite(dur) || dur <= LOOP_BLEND_SECS) return;
    if (dur - active.currentTime < LOOP_BLEND_SECS) startBlend();
  }

  active.addEventListener('timeupdate', onTimeUpdate);
  active.addEventListener('ended',      onEnded);
  active.play().catch(() => {});

  return {
    destroy() {
      destroyed = true;
      active.removeEventListener('timeupdate', onTimeUpdate);
      active.removeEventListener('ended',      onEnded);
      standby.removeEventListener('timeupdate', onTimeUpdate);
      standby.removeEventListener('ended',      onEnded);
      active.pause();  active.src  = '';
      standby.pause(); standby.src = '';
    },
  };
}

// Media path wins; otherwise fall back to a theme's CSS gradient/solid (bgCss,
// from style_json) so a license-free authored background renders with no asset.
let _lastBgPath = null;

function setBackground(path, bgCss) {
  if (path && path === _lastBgPath) return; // same video already playing — don't restart
  _lastBgPath = path || null;
  destroyBgController();
  bg.style.background = '';
  if (path) {
    const url = pathToUrl(path);
    const ext = path.split('.').pop().toLowerCase();
    bg.innerHTML = '';
    if (['mp4','webm','mov','avi','m4v','mkv'].includes(ext)) {
      if (LOOP_MODE === 'jump') {
        const v = document.createElement('video');
        v.setAttribute('playsinline', '');
        v.muted = true;
        v.autoplay = true;
        v.loop = true;
        Object.assign(v.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' });
        v.src = url;
        bg.appendChild(v);
      } else {
        _bgController = createLoopBlendBackground(url);
      }
    } else {
      bg.innerHTML = `<img src="${url}" alt="" />`;
    }
    return;
  }
  bg.innerHTML = '';
  if (bgCss) bg.style.background = bgCss;
}

// ── Foreground media (bumpers/clips) ─────────────────────────────────────────
// A single <video>/<audio> element driven by the shared CueMediaPlayer, which
// locks it to the main-process transport (wall-clock derived position, smooth
// playbackRate convergence, native looping for clean gapless audio). Pause /
// play / restart / scrub / mute all arrive as transport updates — no per-window
// clock-master reporting, no dual-element loop swap.
let mediaPlayer = null;

function clearForegroundMedia() {
  if (mediaPlayer) { mediaPlayer.destroy(); mediaPlayer = null; }
  // Detach from the stream-audio mixer (stream window only; no-op elsewhere).
  if (window.CueStreamFeed) window.CueStreamFeed.onMediaElement(null);
}

function setForegroundMedia(media, transport) {
  destroyBgController();
  _lastBgPath = null;
  clearForegroundMedia();
  bg.style.background = '';
  bg.innerHTML = '';
  if (!media || !media.path) return;
  const url = pathToUrl(media.path);

  if (media.type === 'image') {
    bg.innerHTML = `<img src="${url}" alt="" />`;
    return;
  }

  const el = document.createElement(media.type === 'audio' ? 'audio' : 'video');
  el.id = 'cue-media-el';
  // CORS-clean so the program-audio tap (captureStream → Web Audio) isn't tainted.
  // Must be set before src; the cue-media:// handler returns Access-Control-Allow-Origin.
  el.crossOrigin = 'anonymous';
  el.src = url;
  if (media.type === 'video') {
    el.setAttribute('playsinline', '');
    Object.assign(el.style, {
      position: 'absolute', inset: '0',
      width: '100%', height: '100%', objectFit: 'cover',
    });
  }
  el.preload = 'auto';
  bg.appendChild(el);

  // baseMuted = MUTE_AUDIO (window role); the player layers the live program
  // mute (transport.muted) on top so only the audience feed is silenced.
  mediaPlayer = window.CueMediaPlayer.attach(el, {
    loop: !!media.loop,
    baseMuted: MUTE_AUDIO,
    transport,
  });
  // Offer this element to the stream-audio mixer (stream window only; no-op elsewhere).
  if (window.CueStreamFeed) window.CueStreamFeed.onMediaElement(el);
}

// ── Live video input (NDI receive) ───────────────────────────────────────────
// A full-frame canvas painted from main's framesync pull loop (live:frame bus).
// Frames are RGBA at the source's native size; the canvas is cover-fitted like a
// background video. Only the frames for the CURRENT payload's source are painted.
let liveInputSource = null;
let liveCanvas = null;
let liveCtx = null;

function clearLiveInput() {
  liveInputSource = null;
  if (liveCanvas) { liveCanvas.remove(); liveCanvas = null; liveCtx = null; }
  destroyLiveAudio();
}

function setLiveInput(liveInput) {
  const src = liveInput && liveInput.sourceName;
  if (!src) { clearLiveInput(); return; }
  if (src === liveInputSource && liveCanvas) return; // already showing this source
  clearLiveInput();
  liveInputSource = src;
  liveCanvas = document.createElement('canvas');
  Object.assign(liveCanvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover',
  });
  bg.appendChild(liveCanvas);
  liveCtx = liveCanvas.getContext('2d');
}

if (window.cueOutput.onLiveFrame) {
  window.cueOutput.onLiveFrame((f) => {
    if (!liveCtx || !f || f.sourceName !== liveInputSource) return;
    const { w, h, stride, data } = f;
    if (!w || !h || !data) return;
    if (liveCanvas.width !== w || liveCanvas.height !== h) {
      liveCanvas.width = w;
      liveCanvas.height = h;
    }
    // data arrives as a Uint8Array; ImageData wants exactly w*h*4 clamped bytes.
    // NDI rows can be padded (stride > w*4) — repack only in that case.
    let pixels;
    if (!stride || stride === w * 4) {
      pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, w * h * 4);
    } else {
      pixels = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        pixels.set(new Uint8ClampedArray(data.buffer, data.byteOffset + y * stride, w * 4), y * w * 4);
      }
    }
    liveCtx.putImageData(new ImageData(pixels, w, h), 0, 0);
  });
}

// ── Live input audio ──────────────────────────────────────────────────────────
// Planar Float32 PCM from main's framesync audio pump (live:audio), scheduled
// back-to-back into a Web Audio graph behind a small jitter buffer. The graph
// exits through a MediaStreamDestination → hidden <audio> element so the in-room
// output-device picker (element setSinkId, matched by CueMediaPlayer) applies to
// live audio exactly like program media. Main only sends this bus to the audible
// window and the stream compositor; MUTE_AUDIO guards the rest.
let liveAudio = null; // { ctx, gain, el, detachSink, nextAt }

function ensureLiveAudio(sampleRate) {
  if (liveAudio && liveAudio.ctx.sampleRate === sampleRate) return liveAudio;
  destroyLiveAudio();
  const ctx = new AudioContext({ sampleRate });
  const gain = ctx.createGain();
  const dest = ctx.createMediaStreamDestination();
  gain.connect(dest);
  const el = document.createElement('audio');
  el.srcObject = dest.stream;
  el.play().catch(() => {});
  const detachSink = window.CueMediaPlayer && window.CueMediaPlayer.attachAuxAudio
    ? window.CueMediaPlayer.attachAuxAudio(el) : null;
  liveAudio = { ctx, gain, el, detachSink, nextAt: 0 };
  window.__cueLiveAudioDebug = { ctx, gain }; // introspection/testing handle
  return liveAudio;
}

function destroyLiveAudio() {
  if (!liveAudio) return;
  try { if (liveAudio.detachSink) liveAudio.detachSink(); } catch {}
  try { liveAudio.el.pause(); liveAudio.el.srcObject = null; } catch {}
  try { liveAudio.ctx.close(); } catch {}
  liveAudio = null;
  delete window.__cueLiveAudioDebug;
}

if (window.cueOutput.onLiveAudio) {
  window.cueOutput.onLiveAudio((f) => {
    if (!f || f.sourceName !== liveInputSource || !f.samples) return;
    // Stream window: hand the PCM to the stream mixer ('mixed' mode gates there);
    // the compositor window is locally muted, so never play it here too.
    if (window.CueStreamFeed) {
      if (window.CueStreamFeed.pushLivePcm) window.CueStreamFeed.pushLivePcm(f);
      return;
    }
    if (MUTE_AUDIO) return;
    const { sampleRate, channels, samples } = f;
    const la = ensureLiveAudio(sampleRate);
    const ctx = la.ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // Copy to an aligned buffer (IPC hands us a Uint8Array view whose offset may
    // not be float-aligned), then split the planar layout per channel.
    const bytes = f.data;
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + samples * channels * 4);
    const all = new Float32Array(ab);
    const buf = ctx.createBuffer(channels, samples, sampleRate);
    for (let ch = 0; ch < channels; ch++) buf.copyToChannel(all.subarray(ch * samples, (ch + 1) * samples), ch);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(la.gain);
    // Gapless scheduling: chunks queue back-to-back; (re)prime an ~80ms jitter
    // buffer when the queue drained (start/underrun) so pulls never race the clock.
    const now = ctx.currentTime;
    if (la.nextAt < now + 0.02) la.nextAt = now + 0.08;
    src.start(la.nextAt);
    la.nextAt += buf.duration;
  });
}

// Apply an optional reference/attribution style (scripture) to the #copyright
// element. Empty values fall back to the stylesheet defaults; resets cleanly for
// songs (which pass no copyrightStyle).
function applyCopyrightStyle(el, cs, defaultAlign) {
  _liveCopyrightStyle = cs;
  _liveCopyrightDefaultAlign = defaultAlign || 'center';
  const vs = viewportScale();
  el.style.textAlign       = (cs && cs.align) || defaultAlign || 'center';
  el.style.fontFamily      = cs?.fontFamily || '';
  el.style.fontSize        = cs?.fontSize ? Math.round(cs.fontSize * vs) + 'px' : Math.round(20 * vs) + 'px';
  el.style.color           = cs?.color || '';
  el.style.fontWeight      = cs?.bold ? '700' : '';
  el.style.fontStyle       = cs?.italic ? 'italic' : '';
  el.style.textDecoration  = (cs?.underline || cs?.strikethrough) ? buildDecoration(cs) : '';
  el.style.textTransform   = cs?.uppercase ? 'uppercase' : '';
  el.style.letterSpacing   = cs?.letterSpacing ? cs.letterSpacing + 'em' : '';
  el.style.textShadow      = cs?.textShadow?.enabled
    ? `${cs.textShadow.x ?? 0}px ${cs.textShadow.y ?? 2}px ${cs.textShadow.blur ?? 16}px ${cs.textShadow.color ?? '#000'}` : '';
  el.style.webkitTextStroke = cs?.textStroke?.enabled
    ? `${Math.round((cs.textStroke.width ?? 2) * vs)}px ${cs.textStroke.color ?? '#000'}` : '';
  // Position: free (anchored at x%,y%) or default (bottom band, symmetric inset).
  if (cs?.pos) {
    el.style.left = cs.pos.x + '%';
    el.style.top = cs.pos.y + '%';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.whiteSpace = 'nowrap';
    el.style.paddingLeft = '0';
    el.style.paddingRight = '0';
    el.style.textAlign = cs.align || 'left';
  } else {
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = Math.round(40 * vs) + 'px';
    el.style.whiteSpace = '';
    el.style.paddingLeft = Math.round(60 * vs) + 'px';
    el.style.paddingRight = Math.round(60 * vs) + 'px';
  }
}

// ── Presentation elements (multi-element slide canvas) ───────────────────────
// A fixed 1920×1080 design box scaled to fill the viewport, so element % positions
// and px font sizes stay pixel-accurate on any output resolution. Each element is
// a positioned .cue-el; text reuses renderWithRuns + buildShadow.
const slideEls = document.getElementById('slide-elements');

function scaleSlideCanvas() {
  slideEls.style.transform = `scale(${window.innerWidth / 1920}, ${window.innerHeight / 1080})`;
}
window.addEventListener('resize', scaleSlideCanvas);
// Re-apply viewport-scaled px values on resize. Order matters: applyStyle first
// (sets provisional font size), then fitSplitText last (overrides for split verses).
window.addEventListener('resize', () => {
  if (_liveStyle) applyStyle(_liveStyle);
  if (_liveCopyrightStyle !== null) applyCopyrightStyle(copyright, _liveCopyrightStyle, _liveCopyrightDefaultAlign);
});
window.addEventListener('resize', () => { if (lastSplitMax) fitSplitText(lastSplitMax); });

// Runtime per-channel content scale change — update the multiplier and re-apply the
// live slide's style in place (no window recreation, so the NDI sender survives).
if (window.cueOutput.onContentScale) {
  window.cueOutput.onContentScale((frac) => {
    const v = Number(frac);
    CONTENT_FONT_SCALE = isFinite(v) && v > 0 ? v : 1;
    if (_liveStyle) applyStyle(_liveStyle);
    if (lastSplitMax) fitSplitText(lastSplitMax);
  });
}

function hideElements() {
  slideEls.classList.remove('active');
  slideEls.innerHTML = '';
}

function textInnerCss(s) {
  s = s || {};
  const css = [
    'justify-content:' + (s.verticalAlign === 'top' ? 'flex-start' : s.verticalAlign === 'bottom' ? 'flex-end' : 'center'),
    'text-align:' + (s.align || 'center'),
    'font-weight:' + (s.bold ? '700' : '400'),
    'text-shadow:' + buildShadow(s.textShadow, true),
  ];
  if (s.fontFamily)    css.push('font-family:' + String(s.fontFamily).replace(/"/g, "'"));
  if (s.fontSize)      css.push('font-size:' + Number(s.fontSize) + 'px');
  if (s.italic)        css.push('font-style:italic');
  if (s.underline || s.strikethrough) css.push('text-decoration:' + buildDecoration(s));
  if (s.color)         css.push('color:' + s.color);
  if (s.lineSpacing)   css.push('line-height:' + s.lineSpacing);
  if (s.letterSpacing) css.push('letter-spacing:' + s.letterSpacing + 'em');
  if (s.uppercase)     css.push('text-transform:uppercase');
  if (s.textStroke && s.textStroke.enabled) css.push(`-webkit-text-stroke:${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}`);
  // Box fill — panel behind the text element (canvas is native 1920×1080 px).
  if (s.boxFill && s.boxFill.enabled) {
    css.push('background:' + boxFillBg(s.boxFill));
    css.push('border-radius:' + (s.boxFill.radius != null ? s.boxFill.radius : 0) + 'px');
    css.push('padding:' + (s.boxFill.pad != null ? s.boxFill.pad : 24) + 'px');
    css.push('box-sizing:border-box');
  }
  return css.join(';');
}

function shapeInnerCss(el) {
  const stroke = el.stroke || {};
  if (el.shape === 'line') return `background:${stroke.color || el.fill || '#fff'};width:100%;height:100%`;
  const css = [`background:${el.fill || 'transparent'}`, 'width:100%', 'height:100%'];
  if (stroke.color && stroke.width) css.push(`border:${stroke.width}px solid ${stroke.color}`);
  if (el.shape === 'ellipse') css.push('border-radius:50%');
  else if (el.radius) css.push(`border-radius:${el.radius}px`);
  return css.join(';');
}

function elementHtml(el) {
  if (!el) return '';
  const box = [
    `left:${el.x ?? 0}%`, `top:${el.y ?? 0}%`,
    `width:${el.w ?? 20}%`, `height:${el.h ?? 20}%`,
  ];
  if (el.rotation)        box.push(`transform:rotate(${el.rotation}deg)`);
  if (el.opacity != null) box.push(`opacity:${el.opacity}`);
  if (el.z != null)       box.push(`z-index:${el.z}`);
  let inner = '';
  if (el.type === 'text') {
    inner = `<div class="cue-el-text" style="${textInnerCss(el.style)}"><div style="width:100%">${renderTextContent(el.text || '', el.style && el.style.runs, el.style)}</div></div>`;
  } else if (el.type === 'image' && el.path) {
    const url = pathToUrl(el.path);
    const fit = el.fit === 'cover' ? 'cover' : 'contain';
    const isVideo = el.mediaType === 'video' || ['mp4','webm','mov','avi','m4v','mkv'].includes((el.path.split('.').pop() || '').toLowerCase());
    inner = isVideo
      ? `<video autoplay loop muted playsinline src="${url}" style="object-fit:${fit}"></video>`
      : `<img src="${url}" alt="" style="object-fit:${fit}" />`;
  } else if (el.type === 'shape') {
    inner = `<div style="${shapeInnerCss(el)}"></div>`;
  }
  return `<div class="cue-el" style="${box.join(';')}">${inner}</div>`;
}

function renderElements(elements) {
  scaleSlideCanvas();
  const sorted = [...(elements || [])].sort((a, b) => (a.z || 0) - (b.z || 0));
  slideEls.innerHTML = sorted.map(elementHtml).join('');
  slideEls.classList.add('active');
}

// ── Transition gating (Option 2: never animate when a video is involved) ──────
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'avi', 'm4v', 'mkv'];
function isVideoPath(p) {
  if (!p) return false;
  return VIDEO_EXT.includes(String(p).split('.').pop().toLowerCase());
}
// True if the INCOMING payload paints a video on the program layer.
function payloadHasVideo(p) {
  if (!p) return false;
  if (p.liveInput) return true; // live NDI input behaves like video: always hard-cut
  if (p.media && (p.media.type === 'video' || isVideoPath(p.media.path))) return true;
  if (isVideoPath(p.backgroundPath)) return true;
  if (isVideoPath(p.logoPath)) return true;
  if (Array.isArray(p.elements) && p.elements.some(
    (el) => el && el.type === 'image' && (el.mediaType === 'video' || isVideoPath(el.path)))) return true;
  return false;
}

const stageEl = document.getElementById('stage');

function renderSlide(payload) {
  const { type, text, copyright: copy, backgroundPath, logoPath, logoScaleMode, styleJson } = payload;

  if (type === 'clear') {
    clearForegroundMedia();
    clearLiveInput();
    hideElements();
    setBackground(backgroundPath);
    hideLogo();
    applyStyle(null);
    textEl.innerHTML = '';
    copyright.textContent = '';
    return;
  }

  if (type === 'logo') {
    clearForegroundMedia();
    clearLiveInput();
    hideElements();
    destroyBgController();
    _lastBgPath = null;
    bg.innerHTML = '';
    applyStyle(null);
    textEl.innerHTML = '';
    copyright.textContent = '';
    showLogo(logoPath, logoScaleMode);
    return;
  }

  // Live video input (full-frame NDI feed painted from the live:frame bus).
  if (payload.liveInput) {
    clearForegroundMedia();
    hideElements();
    hideLogo();
    applyStyle(null);
    textEl.innerHTML = '';
    copyright.textContent = '';
    destroyBgController();
    _lastBgPath = null;
    // Keep the canvas when re-GOing the same source; otherwise reset the layer.
    if (liveInputSource !== payload.liveInput.sourceName || !liveCanvas) {
      bg.innerHTML = '';
      bg.style.background = '';
      setLiveInput(payload.liveInput);
    }
    return;
  }

  // Foreground media item (full-frame video/audio/image, no text overlay)
  if (payload.media) {
    hideLogo();
    clearLiveInput();
    hideElements();
    applyStyle(null);
    textEl.innerHTML = '';
    copyright.textContent = '';
    setForegroundMedia(payload.media, payload.transport);
    return;
  }

  // Presentation slide — a multi-element canvas (text/image/shape), no lyric text.
  if (payload.elements) {
    clearForegroundMedia();
    clearLiveInput();
    hideLogo();
    applyStyle(null);
    textEl.innerHTML = '';
    copyright.textContent = '';
    setBackground(backgroundPath);
    renderElements(payload.elements);
    return;
  }

  // Content slide
  clearForegroundMedia();
  clearLiveInput();
  hideElements();
  hideLogo();
  setBackground(backgroundPath, styleJson?.bgCss);
  applyStyle(styleJson);

  // Split-verse (compare) view: one verse, two translations stacked. Each block keeps
  // the global verse style; its attribution rides inline (the bottom #copyright stays
  // empty so it doesn't collide with the lower block).
  const sv = payload.scriptureVerses;
  if (Array.isArray(sv) && sv.length > 1) {
    textEl.classList.add('split');
    textEl.innerHTML = sv.map((b) =>
      `<div class="split-verse"><div class="split-verse-body">${renderWithRuns(b.text || '', styleJson?.runs)}</div>`
      + `<div class="split-verse-attr">${esc(b.attribution || '')}</div></div>`).join('');
    copyright.textContent = '';
    // Auto-fit: pick the LARGEST font (up to the authored scripture size × content
    // scale) at which both translations still fit the verse box. Short verses keep
    // the full size; only long readings shrink.
    const splitMax = Number(styleJson?.fontSize) || 72;
    fitSplitText(splitMax);
    lastSplitMax = splitMax;
    return;
  }
  lastSplitMax = 0;
  textEl.classList.remove('split');
  textEl.innerHTML = renderTextContent(text || '', styleJson?.runs, styleJson);
  copyright.textContent = copy || '';
  // Scripture attribution ("John 1:1 (KJV)") sits bottom-right (stylable); song copyright centred.
  applyCopyrightStyle(copyright, payload.copyrightStyle, payload.copyrightAlign === 'right' ? 'right' : 'center');
}

// ── Decode-gated image swaps ─────────────────────────────────────────────────
// A fresh <img> (a logo, or a new background image) doesn't paint the instant it's
// inserted — the browser decodes it a frame or two later. Because renderSlide()
// blanks the outgoing layer synchronously (e.g. the logo path does bg.innerHTML=''),
// that decode latency shows as a brief cut to black, most visibly when swapping
// between lyrics and the logo. So when an incoming payload paints an image, we
// decode it OFFSCREEN first while the current frame stays up, then run the render.
// The decoded bitmap lands in the browser image cache, so the real <img> in
// showLogo()/setBackground() paints on its first frame — no gap. Videos stream and
// are never gated; a text-only or already-cached image renders synchronously so
// verse advances stay snap-instant.
const _imgReady = new Map(); // url → decoded HTMLImageElement (retained as the cache signal)
function decodeImg(url) {
  if (!url) return Promise.resolve();
  const cached = _imgReady.get(url);
  if (cached && cached.complete && cached.naturalWidth) return Promise.resolve();
  const img = new Image();
  img.src = url;
  const done = img.decode ? img.decode() : new Promise((r) => { img.onload = r; img.onerror = r; });
  return done.then(() => { _imgReady.set(url, img); }, () => {});
}
function payloadImageUrls(p) {
  if (!p) return [];
  if (p.type === 'logo') return p.logoPath && !isVideoPath(p.logoPath) ? [pathToUrl(p.logoPath)] : [];
  if (p.media) return p.media.type === 'image' && p.media.path ? [pathToUrl(p.media.path)] : [];
  if (p.liveInput || p.elements) return []; // live NDI / presentation canvas: not gated here
  return p.backgroundPath && !isVideoPath(p.backgroundPath) ? [pathToUrl(p.backgroundPath)] : [];
}
function imagesCached(urls) {
  return urls.every((u) => { const c = _imgReady.get(u); return c && c.complete && c.naturalWidth; });
}

let _renderSeq = 0;
window.cueOutput.onSlideUpdate((payload) => {
  // Sync loop settings from the payload. A mode change invalidates the cached path
  // so the next setBackground() re-mounts the video in the new mode.
  if (payload.bgLoopMode === 'jump' || payload.bgLoopMode === 'blend') {
    if (payload.bgLoopMode !== LOOP_MODE) { LOOP_MODE = payload.bgLoopMode; _lastBgPath = null; }
  }
  if (typeof payload.bgLoopBlendSecs === 'number' && payload.bgLoopBlendSecs > 0) LOOP_BLEND_SECS = payload.bgLoopBlendSecs;

  // latest-wins: a newer payload arriving mid-decode supersedes this one's commit.
  const seq = ++_renderSeq;
  const commit = () => {
    if (seq !== _renderSeq) return;
    // Hard-cut (no transition) whenever a video is on either side: the outgoing stage
    // already shows one, or the incoming payload brings one (Option 2 — transitions.js).
    const involvesVideo = !!(stageEl && stageEl.querySelector('video')) || payloadHasVideo(payload);
    const transition = involvesVideo ? { type: 'none' } : payload.transition;
    // fgSel '#content' fades/zooms only the text layer in; #background + #scrim stay
    // solid so a same-background advance never dips to black.
    if (window.CueTransitions) window.CueTransitions.run(stageEl, transition, () => renderSlide(payload), { fgSel: '#content' });
    else renderSlide(payload);
  };

  const urls = payloadImageUrls(payload);
  if (urls.length && !imagesCached(urls)) Promise.all(urls.map(decodeImg)).then(commit);
  else commit();
});
