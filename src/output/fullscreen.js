const bg        = document.getElementById('background');
const textEl    = document.getElementById('text');
const copyright = document.getElementById('copyright');

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

function applyStyle(el, s) {
  if (!s) return;
  el.style.fontFamily = s.fontFamily || '';
  el.style.textAlign  = s.align      || '';
  el.style.fontWeight = s.bold       ? '700' : '400';
  el.style.fontStyle  = s.italic     ? 'italic' : 'normal';
  el.style.fontSize   = s.fontSize   ? s.fontSize + 'px' : '';
  el.style.color      = s.color      || '';
  el.style.lineHeight = s.lineSpacing ? String(s.lineSpacing) : '';
}

function setBackground(path) {
  if (!path) { bg.innerHTML = ''; return; }
  const ext = path.split('.').pop().toLowerCase();
  if (['mp4','webm','mov','avi','m4v'].includes(ext)) {
    bg.innerHTML = `<video autoplay loop muted playsinline src="file://${path}"></video>`;
  } else {
    bg.innerHTML = `<img src="file://${path}" alt="" />`;
  }
}

window.cueOutput.onSlideUpdate((payload) => {
  const { type, text, copyright: copy, backgroundPath, logoPath, styleJson } = payload;

  if (type === 'clear') {
    bg.innerHTML = '';
    textEl.className = '';
    textEl.innerHTML = '';
    copyright.textContent = '';
    return;
  }

  if (type === 'logo') {
    bg.innerHTML = '';
    textEl.className = 'logo-mode';
    textEl.innerHTML = logoPath ? `<img class="logo-img" src="file://${logoPath}" alt="Logo" />` : '';
    copyright.textContent = '';
    return;
  }

  setBackground(backgroundPath);
  textEl.className = '';
  applyStyle(textEl, styleJson);
  textEl.innerHTML = renderWithRuns(text || '', styleJson?.runs);
  copyright.textContent = copy || '';
});
