const bg       = document.getElementById('background');
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

function setBackground(path) {
  if (!path) { bg.innerHTML = ''; return; }
  const url = pathToUrl(path);
  const ext = path.split('.').pop().toLowerCase();
  bg.innerHTML = ['mp4','webm','mov','avi','m4v','mkv'].includes(ext)
    ? `<video autoplay loop muted playsinline src="${url}"></video>`
    : `<img src="${url}" alt="" />`;
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

window.cueOutput.onSlideUpdate((payload) => {
  const { type, text, copyright: copy, backgroundPath, logoPath, logoScaleMode, styleJson } = payload;

  if (type === 'clear') {
    clearForegroundMedia();
    setBackground(backgroundPath);
    hideLogo();
    applyStyle(null);
    textEl.innerHTML = '';
    copyright.textContent = '';
    return;
  }

  if (type === 'logo') {
    clearForegroundMedia();
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
    applyStyle(null);
    textEl.innerHTML = '';
    copyright.textContent = '';
    setForegroundMedia(payload.media, payload.transport);
    return;
  }

  // Content slide
  clearForegroundMedia();
  hideLogo();
  setBackground(backgroundPath);
  applyStyle(styleJson);
  textEl.innerHTML = renderWithRuns(text || '', styleJson?.runs);
  copyright.textContent = copy || '';
});
