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
  return 'cue-media://localhost' + pathPart.split('/').map(encodeURIComponent).join('/');
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

function buildShadow(shadow) {
  if (!shadow) return '0 2px 16px rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.6)';
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
    'text-shadow:' + buildShadow(s.textShadow),
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
    inner = `<div class="cue-el-text" style="${textInnerCss(el.style)}"><div style="width:100%">${renderWithRuns(el.text || '', el.style && el.style.runs)}</div></div>`;
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

window.cueOutput.onSlideUpdate((payload) => {
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
  textEl.innerHTML = renderWithRuns(text || '', styleJson?.runs);
  copyright.textContent = copy || '';
  // Scripture attribution ("John 1:1 (KJV)") sits bottom-right (stylable); song copyright centred.
  applyCopyrightStyle(copyright, payload.copyrightStyle, payload.copyrightAlign === 'right' ? 'right' : 'center');
});
