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
    if (run.underline)  st.push('text-decoration:underline');
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

function applyStyle(s) {
  // Background scrim (transparent→black) — clamp 0..1; clear when there's no slide.
  if (scrim) scrim.style.opacity = String(Math.max(0, Math.min(1, (s && s.bgScrim) || 0)));
  if (!s) {
    textWrap.style.cssText = '';
    textEl.style.cssText   = '';
    return;
  }

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
  textWrap.style.padding   = '0';

  // Text styles
  textEl.style.fontFamily      = s.fontFamily   || '';
  textEl.style.textAlign       = s.align        || 'center';
  textEl.style.fontWeight      = s.bold         ? '700' : '400';
  textEl.style.fontStyle       = s.italic       ? 'italic' : 'normal';
  textEl.style.textDecoration  = s.underline    ? 'underline' : 'none';
  textEl.style.fontSize        = s.fontSize     ? s.fontSize + 'px' : '';
  textEl.style.color           = s.color        || '';
  textEl.style.lineHeight      = s.lineSpacing  ? String(s.lineSpacing) : '';
  textEl.style.letterSpacing   = s.letterSpacing ? s.letterSpacing + 'em' : '';
  textEl.style.textTransform   = s.uppercase    ? 'uppercase' : 'none';
  textEl.style.textShadow      = buildShadow(s.textShadow);
  textEl.style.webkitTextStroke = (s.textStroke && s.textStroke.enabled)
    ? `${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}`
    : '';
  textEl.style.whiteSpace = 'pre-wrap';
  textEl.style.wordBreak  = 'break-word';
  textEl.style.width      = '100%';
}

// Split-verse auto-fit: binary-search the font size so the stacked translations fill
// — but never overflow — the text box. `maxPx` caps it at the authored scripture size
// so a single short verse pair never blows up larger than normal scripture.
let lastSplitMax = 0;
function fitSplitText(maxPx) {
  const maxH = textWrap.clientHeight;
  const cap = Math.max(22, maxPx);
  if (!maxH) { textEl.style.fontSize = cap + 'px'; return; }
  textEl.style.fontSize = cap + 'px';
  if (textEl.scrollHeight <= maxH) return;
  let lo = 22, hi = cap;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    textEl.style.fontSize = mid + 'px';
    if (textEl.scrollHeight <= maxH) lo = mid; else hi = mid;
  }
  textEl.style.fontSize = lo + 'px';
}
// Refit a live split verse when the output window is resized (the box height changes).
window.addEventListener('resize', () => { if (lastSplitMax) fitSplitText(lastSplitMax); });

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

// Media path wins; otherwise fall back to a theme's CSS gradient/solid (bgCss,
// from style_json) so a license-free authored background renders with no asset.
function setBackground(path, bgCss) {
  bg.style.background = '';
  if (path) {
    const url = pathToUrl(path);
    const ext = path.split('.').pop().toLowerCase();
    bg.innerHTML = ['mp4','webm','mov','avi','m4v','mkv'].includes(ext)
      ? `<video autoplay loop muted playsinline src="${url}"></video>`
      : `<img src="${url}" alt="" />`;
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

// Apply an optional reference/attribution style (scripture) to the #copyright
// element. Empty values fall back to the stylesheet defaults; resets cleanly for
// songs (which pass no copyrightStyle).
function applyCopyrightStyle(el, cs, defaultAlign) {
  el.style.textAlign       = (cs && cs.align) || defaultAlign || 'center';
  el.style.fontFamily      = cs?.fontFamily || '';
  el.style.fontSize        = cs?.fontSize ? cs.fontSize + 'px' : '';
  el.style.color           = cs?.color || '';
  el.style.fontWeight      = cs?.bold ? '700' : '';
  el.style.fontStyle       = cs?.italic ? 'italic' : '';
  el.style.textDecoration  = cs?.underline ? 'underline' : '';
  el.style.textTransform   = cs?.uppercase ? 'uppercase' : '';
  el.style.letterSpacing   = cs?.letterSpacing ? cs.letterSpacing + 'em' : '';
  el.style.textShadow      = cs?.textShadow?.enabled
    ? `${cs.textShadow.x ?? 0}px ${cs.textShadow.y ?? 2}px ${cs.textShadow.blur ?? 16}px ${cs.textShadow.color ?? '#000'}` : '';
  el.style.webkitTextStroke = cs?.textStroke?.enabled
    ? `${cs.textStroke.width ?? 2}px ${cs.textStroke.color ?? '#000'}` : '';
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
    el.style.bottom = '';
    el.style.whiteSpace = '';
    el.style.paddingLeft = '60px';
    el.style.paddingRight = '60px';
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
  if (s.underline)     css.push('text-decoration:underline');
  if (s.color)         css.push('color:' + s.color);
  if (s.lineSpacing)   css.push('line-height:' + s.lineSpacing);
  if (s.letterSpacing) css.push('letter-spacing:' + s.letterSpacing + 'em');
  if (s.uppercase)     css.push('text-transform:uppercase');
  if (s.textStroke && s.textStroke.enabled) css.push(`-webkit-text-stroke:${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}`);
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
    hideElements();
    bg.innerHTML = '';
    applyStyle(null);
    textEl.innerHTML = '';
    copyright.textContent = '';
    showLogo(logoPath, logoScaleMode);
    return;
  }

  // Foreground media item (full-frame video/audio/image, no text overlay)
  if (payload.media) {
    hideLogo();
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
    // Auto-fit instead of a fixed shrink: pick the LARGEST font (up to the authored
    // scripture size) at which both translations still fit the verse box. Short verses
    // keep the full size and fill the screen; only long readings shrink.
    fitSplitText(Number(styleJson?.fontSize) || 72);
    lastSplitMax = Number(styleJson?.fontSize) || 72;
    return;
  }
  lastSplitMax = 0;
  textEl.classList.remove('split');
  textEl.innerHTML = renderTextContent(text || '', styleJson?.runs, styleJson);
  copyright.textContent = copy || '';
  // Scripture attribution ("John 1:1 (KJV)") sits bottom-right (stylable); song copyright centred.
  applyCopyrightStyle(copyright, payload.copyrightStyle, payload.copyrightAlign === 'right' ? 'right' : 'center');
}

window.cueOutput.onSlideUpdate((payload) => {
  // Hard-cut (no transition) whenever a video is on either side: the outgoing stage
  // already shows one, or the incoming payload brings one (Option 2 — see transitions.js).
  const involvesVideo = !!(stageEl && stageEl.querySelector('video')) || payloadHasVideo(payload);
  const transition = involvesVideo ? { type: 'none' } : payload.transition;
  // fgSel '#content' fades/zooms only the text layer in; #background + #scrim stay
  // solid so a same-background advance never dips to black.
  if (window.CueTransitions) window.CueTransitions.run(stageEl, transition, () => renderSlide(payload), { fgSel: '#content' });
  else renderSlide(payload);
});
