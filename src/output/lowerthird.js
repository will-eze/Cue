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
  // A theme may author an explicit CSS background (gradient/solid) for the bar;
  // it wins over the computed rgba fade. License-free, matches fullscreen bgCss.
  if (ltBar.css) return ltBar.css;
  const c  = ltBar.color   ?? '#000000';
  const op = ltBar.opacity ?? 0.8;
  const r  = parseInt(c.slice(1, 3), 16) || 0;
  const g  = parseInt(c.slice(3, 5), 16) || 0;
  const b  = parseInt(c.slice(5, 7), 16) || 0;
  if (ltBar.solid) return `rgba(${r},${g},${b},${op})`;
  return `linear-gradient(to top, rgba(${r},${g},${b},${op}) 0%, rgba(${r},${g},${b},${(op * 0.7).toFixed(2)}) 70%, transparent 100%)`;
}

function applyStyle(el, s) {
  // Treat a missing style_json as the app default rather than bailing out: a song
  // whose style is all-default saves style_json = null, and the default alignment
  // is CENTRE. The old early-return left #text on the CSS default (left), so
  // centred lyrics rendered left-aligned in the output (fullscreen.css defaults
  // #text to centre, which is why only the lower-third was affected).
  s = s || {};
  // Full width so text-align has the whole band to work within (matches the editor
  // preview, which renders the text in a full-width bar) — without it a flex edge
  // case could shrink the element and make centre/right alignment look like no-op.
  el.style.width           = '100%';
  el.style.fontFamily      = s.fontFamily   || '';
  el.style.textAlign       = s.align        || 'center';
  el.style.fontWeight      = s.bold         ? '700' : '400';
  el.style.fontStyle       = s.italic       ? 'italic' : 'normal';
  el.style.textDecoration  = s.underline    ? 'underline' : 'none';
  el.style.fontSize        = s.fontSize     ? s.fontSize + 'px' : '';
  el.style.color           = s.color        || '';
  el.style.lineHeight      = s.lineSpacing  ? String(s.lineSpacing) : '';
  el.style.letterSpacing   = s.letterSpacing ? s.letterSpacing + 'em' : '';
  el.style.textTransform   = s.uppercase    ? 'uppercase' : 'none';
  // Mirror the editor exactly: an explicitly-disabled shadow → none; an enabled one
  // → its values; no shadow config → fall back to the stylesheet default.
  const sh = buildShadow(s.textShadow);
  el.style.textShadow = sh || '';
  el.style.webkitTextStroke = (s.textStroke && s.textStroke.enabled)
    ? `${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}`
    : '';
  ltDiv.style.background = buildBarBg(s.ltBar);
}

// program=0 → graphics-only channel: ignore the program slide entirely so the song
// lyric band never renders (only the broadcast-graphics overlay shows). Mutable so
// the operator can toggle it live via content:mode without recreating the window.
let showProgram = new URLSearchParams(location.search).get('program') !== '0';
let lastPayload = null; // cached so re-enabling restores the current slide

function clearBand() {
  ltDiv.style.background = 'transparent';
  textEl.className = '';
  textEl.innerHTML = '';
  copyright.textContent = '';
}

function renderProgram(payload) {
  if (!showProgram || !payload) { clearBand(); return; }

  const { type, text, copyright: copy, styleJson } = payload;

  // clear / logo / foreground-media / presentation all blank the lower-third lyric
  // band (a presentation is a full-canvas item with no lyric band in v1).
  if (type === 'clear' || type === 'logo' || payload.media || payload.elements) { clearBand(); return; }

  textEl.className = '';
  applyStyle(textEl, styleJson);
  textEl.innerHTML = renderWithRuns(text || '', styleJson?.runs);
  copyright.textContent = copy || '';
  // Scripture attribution ("John 1:1 (KJV)") right-aligned + stylable; song copyright inherits.
  applyCopyrightStyle(copyright, payload.copyrightStyle, payload.copyrightAlign === 'right' ? 'right' : '');
}

window.cueOutput.onSlideUpdate((payload) => {
  lastPayload = payload;
  renderProgram(payload);
});

// Live content-mode toggle — switch the lyric band on/off without a window reload.
if (window.cueOutput.onContentMode) {
  window.cueOutput.onContentMode((m) => {
    showProgram = m.program !== 0;
    renderProgram(lastPayload);
  });
}

// The broadcast-graphics overlay (name/title bug, ticker, custom HTML) is rendered
// by the shared graphics-overlay.js, included after this script — it injects its own
// DOM/styles and handles graphic:update. The lyric band above is untouched by it.

// Apply an optional reference style (scripture) to the lower-third #copyright.
function applyCopyrightStyle(el, cs, defaultAlign) {
  el.style.textAlign       = (cs && cs.align) || defaultAlign || '';
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
}
