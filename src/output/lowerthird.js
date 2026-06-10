const ltDiv     = document.getElementById('lowerthird');
const textEl    = document.getElementById('text');
const copyright = document.getElementById('copyright');

function pathToUrl(p) {
  if (!p) return null;
  // Normalize Windows backslashes and ensure a leading / before encoding
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
  if (!shadow) return '';
  if (!shadow.enabled) return 'none';
  return `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}`;
}

function buildBarBg(ltBar) {
  if (!ltBar) return 'transparent';
  const c  = ltBar.color   ?? '#000000';
  const op = ltBar.opacity ?? 0.8;
  const r  = parseInt(c.slice(1, 3), 16) || 0;
  const g  = parseInt(c.slice(3, 5), 16) || 0;
  const b  = parseInt(c.slice(5, 7), 16) || 0;
  if (ltBar.solid) return `rgba(${r},${g},${b},${op})`;
  return `linear-gradient(to top, rgba(${r},${g},${b},${op}) 0%, rgba(${r},${g},${b},${(op * 0.7).toFixed(2)}) 70%, transparent 100%)`;
}

function applyStyle(el, s) {
  if (!s) { ltDiv.style.background = 'transparent'; return; }
  el.style.fontFamily      = s.fontFamily   || '';
  el.style.textAlign       = s.align        || '';
  el.style.fontWeight      = s.bold         ? '700' : '400';
  el.style.fontStyle       = s.italic       ? 'italic' : 'normal';
  el.style.textDecoration  = s.underline    ? 'underline' : 'none';
  el.style.fontSize        = s.fontSize     ? s.fontSize + 'px' : '';
  el.style.color           = s.color        || '';
  el.style.lineHeight      = s.lineSpacing  ? String(s.lineSpacing) : '';
  el.style.letterSpacing   = s.letterSpacing ? s.letterSpacing + 'em' : '';
  el.style.textTransform   = s.uppercase    ? 'uppercase' : 'none';
  const sh = buildShadow(s.textShadow);
  if (sh) el.style.textShadow = sh;
  el.style.webkitTextStroke = (s.textStroke && s.textStroke.enabled)
    ? `${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}`
    : '';
  ltDiv.style.background = buildBarBg(s.ltBar);
}

window.cueOutput.onSlideUpdate((payload) => {
  const { type, text, copyright: copy, logoPath, styleJson } = payload;

  if (type === 'clear') {
    ltDiv.style.background = 'transparent';
    textEl.className = '';
    textEl.innerHTML = '';
    copyright.textContent = '';
    return;
  }

  if (type === 'logo') {
    ltDiv.style.background = 'transparent';
    textEl.className = '';
    textEl.innerHTML = '';
    copyright.textContent = '';
    return;
  }

  // Foreground media belongs on the fullscreen channel — the lower-third overlay
  // shows nothing for it.
  if (payload.media) {
    ltDiv.style.background = 'transparent';
    textEl.className = '';
    textEl.innerHTML = '';
    copyright.textContent = '';
    return;
  }

  textEl.className = '';
  applyStyle(textEl, styleJson);
  textEl.innerHTML = renderWithRuns(text || '', styleJson?.runs);
  copyright.textContent = copy || '';
});
