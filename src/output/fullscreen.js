const bg       = document.getElementById('background');
const textWrap = document.getElementById('text-wrap');
const textEl   = document.getElementById('text');
const logoWrap = document.getElementById('logo-wrap');
const copyright = document.getElementById('copyright');

if (new URLSearchParams(location.search).get('alpha') === '1') {
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

// Drift-correction timer for the active foreground media element. Cleared
// whenever the media element is torn down (slide change / clear / logo).
let mediaSyncTimer = null;
function clearMediaSync() {
  if (mediaSyncTimer) { clearInterval(mediaSyncTimer); mediaSyncTimer = null; }
}

// Keep a media element aligned to the shared start time so all outputs (and the
// operator preview) stay within a frame or two. Seeks only when drift exceeds a
// threshold to avoid stutter.
function syncMediaEl(el, startAt) {
  clearMediaSync();
  if (!el || !startAt) return;
  const seek = () => {
    const expected = (Date.now() - startAt) / 1000;
    if (expected < 0) return;
    if (Number.isFinite(el.duration) && expected > el.duration) return;
    if (Math.abs((el.currentTime || 0) - expected) > 0.25) {
      try { el.currentTime = expected; } catch {}
    }
  };
  el.addEventListener('loadedmetadata', () => { seek(); el.play && el.play().catch(() => {}); }, { once: true });
  if (el.readyState >= 1) seek();
  mediaSyncTimer = setInterval(seek, 3000);
}

// Foreground media item (bumper/clip) — full-frame, with audio, controllable.
// Rendered into #background but tagged so media:control can find it.
function setForegroundMedia(media, startAt) {
  clearMediaSync();
  if (!media || !media.path) { bg.innerHTML = ''; return; }
  const url = pathToUrl(media.path);
  if (media.type === 'audio') {
    bg.innerHTML = `<audio id="cue-media-el" autoplay src="${url}"></audio>`;
    syncMediaEl(document.getElementById('cue-media-el'), startAt);
  } else if (media.type === 'video') {
    bg.innerHTML = `<video id="cue-media-el" autoplay playsinline src="${url}"></video>`;
    syncMediaEl(document.getElementById('cue-media-el'), startAt);
  } else {
    bg.innerHTML = `<img src="${url}" alt="" />`;
  }
}

window.cueOutput.onMediaControl((action) => {
  const el = document.getElementById('cue-media-el');
  if (!el) return;
  if (action === 'play') el.play();
  else if (action === 'pause') el.pause();
  else if (action === 'restart') { el.currentTime = 0; el.play(); }
});

window.cueOutput.onSlideUpdate((payload) => {
  const { type, text, copyright: copy, backgroundPath, logoPath, logoScaleMode, styleJson } = payload;

  if (type === 'clear') {
    clearMediaSync();
    setBackground(backgroundPath);
    hideLogo();
    applyStyle(null);
    textEl.innerHTML = '';
    copyright.textContent = '';
    return;
  }

  if (type === 'logo') {
    clearMediaSync();
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
    setForegroundMedia(payload.media, payload.mediaStartAt);
    return;
  }

  // Content slide
  clearMediaSync();
  hideLogo();
  setBackground(backgroundPath);
  applyStyle(styleJson);
  textEl.innerHTML = renderWithRuns(text || '', styleJson?.runs);
  copyright.textContent = copy || '';
});
