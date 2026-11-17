// Log-only failure visibility (shared guard with the other output scripts).
if (!window.__cueErrLog) {
  window.__cueErrLog = true;
  window.addEventListener('error', (e) => { try { console.error('[cue-output] uncaught error:', e.message, e.filename + ':' + e.lineno); } catch {} });
  window.addEventListener('unhandledrejection', (e) => { try { console.error('[cue-output] unhandled rejection:', e.reason); } catch {} });
}

const ltDiv     = document.getElementById('lowerthird');
const textEl    = document.getElementById('text');
const copyright = document.getElementById('copyright');

function pathToUrl(p) {
  if (!p || typeof p !== 'string') return null;
  // Normalize Windows backslashes and ensure a leading / before encoding
  const normalized = p.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  return 'cue-media://localhost' + pathPart.split('/').map(encodeURIComponent).join('/');
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderWithRuns(text, runs, scale = 1) {
  if (text == null || text === '') return '';
  text = String(text);
  // Drop malformed runs (null entries, non-numeric offsets) rather than throwing.
  const good = Array.isArray(runs)
    ? runs.filter((r) => r && typeof r === 'object' && Number.isFinite(Number(r.start)) && Number.isFinite(Number(r.end)))
        .map((r) => ({ ...r, start: Number(r.start), end: Number(r.end) }))
    : [];
  if (good.length === 0) return esc(text).replace(/\n/g, '<br>');
  const sorted = good.sort((a, b) => a.start - b.start);
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
    // Inline run sizes scale with the global L3 font scale too, so a styled span
    // stays proportional to the surrounding lyric.
    if (run.fontSize)   st.push('font-size:' + (Number(run.fontSize) * scale) + 'px');
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

// Lower-third role overrides — mirrors renderer resolveLtStyle (SongEditor.jsx).
// A field present in style.lt overrides the matching fullscreen value; absent =
// inherit. So a theme can drop the shadow (or change font/colour) on the overlay
// without touching the fullscreen slide.
const LT_OVERRIDE_KEYS = ['fontFamily', 'color', 'uppercase', 'align', 'bold', 'italic', 'letterSpacing', 'lineSpacing', 'textShadow', 'textStroke', 'fontSize'];
function resolveLtStyle(style) {
  if (!style || !style.lt) return style;
  const out = { ...style };
  for (const k of LT_OVERRIDE_KEYS) if (k in style.lt) out[k] = style.lt[k];
  return out;
}

// The optional accent rule beneath the lower-third text (theme accent, toggleable).
// Created once and reused; hidden when the theme has no accent or it's disabled.
let accentEl = null;
function accentBar() {
  if (accentEl) return accentEl;
  accentEl = document.createElement('div');
  accentEl.id = 'lt-accent';
  accentEl.style.cssText = 'height:6px;width:160px;border-radius:3px;margin:18px auto 0;display:none';
  textEl.insertAdjacentElement('afterend', accentEl);
  return accentEl;
}
function applyAccent(accent) {
  const el = accentBar();
  if (accent && accent.enabled) {
    el.style.background = accent.color || '#e7c98a';
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
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

function applyStyle(el, s, scale = 1) {
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
  // Clear any split-verse auto-fit constraints left from a previous slide.
  el.style.maxHeight       = '';
  el.style.overflow        = '';
  el.style.fontFamily      = s.fontFamily   || '';
  el.style.textAlign       = s.align        || 'center';
  el.style.fontWeight      = s.bold         ? '700' : '400';
  el.style.fontStyle       = s.italic       ? 'italic' : 'normal';
  el.style.textDecoration  = [s.underline && 'underline', s.strikethrough && 'line-through'].filter(Boolean).join(' ') || 'none';
  // L3 font size = the authored size × the global L3 scale. The base mirrors the
  // FULLSCREEN default (72px in fullscreen.css) when the style sets none, so at
  // 100% the lower-third matches the screen and the operator can dial it smaller.
  el.style.fontSize        = (Number(s.fontSize) || 72) * scale + 'px';
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

// Per-theme lower-third entrance animation (style.lt.anim). Applied to #text (a child
// of #lowerthird) so it never fights the band-level slide transition on #lowerthird.
// Re-triggered each render by toggling the class off→reflow→on. Default 'none'.
const LT_ANIM_CLASS = { fade: 'ltin-fade', 'slide-up': 'ltin-up', 'slide-left': 'ltin-left', 'slide-down': 'ltin-down' };
function applyLtAnim(anim) {
  const cls = LT_ANIM_CLASS[anim];
  textEl.classList.remove('ltin-fade', 'ltin-up', 'ltin-left', 'ltin-down');
  if (!cls) return;
  void textEl.offsetWidth; // force reflow so the animation restarts
  textEl.classList.add(cls);
}

// Per-theme lower-third FORM + ANCHOR (style.lt.form / style.lt.anchor). The bar fill
// (ltBar) provides the colour; the form decides where it lives:
//   band  — full-width strap (default, fill on #lowerthird)
//   box   — a padded rounded panel sized to the text
//   pill  — a fully-rounded panel sized to the text
//   none  — no fill, just text
// anchor moves the strap: bottom (default) / top / center. Called after applyStyle.
function applyLtForm(form, anchor, barBg) {
  form = form || 'band';
  anchor = anchor || 'bottom';
  if (anchor === 'top') { ltDiv.style.top = '0'; ltDiv.style.bottom = 'auto'; ltDiv.style.justifyContent = 'flex-start'; }
  else if (anchor === 'center') { ltDiv.style.top = '0'; ltDiv.style.bottom = '0'; ltDiv.style.justifyContent = 'center'; }
  else { ltDiv.style.top = 'auto'; ltDiv.style.bottom = '0'; ltDiv.style.justifyContent = 'flex-end'; }

  const align = textEl.style.textAlign || 'center';
  if (form === 'box' || form === 'pill') {
    ltDiv.style.background = 'transparent';
    ltDiv.style.alignItems = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
    textEl.style.width = 'auto';
    textEl.style.display = 'inline-block';
    textEl.style.background = barBg;
    textEl.style.padding = form === 'pill' ? '0.35em 1.1em' : '0.4em 0.85em';
    textEl.style.borderRadius = form === 'pill' ? '999px' : '16px';
  } else {
    ltDiv.style.alignItems = '';
    textEl.style.width = '100%';
    textEl.style.display = '';
    textEl.style.padding = '';
    textEl.style.borderRadius = '';
    ltDiv.style.background = form === 'none' ? 'transparent' : barBg;
    textEl.style.background = '';
  }
}

// program=0 → graphics-only channel: ignore the program slide entirely so the song
// lyric band never renders (only the broadcast-graphics overlay shows). Mutable so
// the operator can toggle it live via content:mode without recreating the window.
let showProgram = new URLSearchParams(location.search).get('program') !== '0';
let lastPayload = null; // cached so re-enabling restores the current slide
// The entrance animation (lt.anim) should play only when the band first APPEARS on air —
// line-to-line advances are handled by the slide transition, so re-firing it there just
// double-fades and reads as nothing. This tracks whether the lyric band is currently up.
let bandVisible = false;

function clearBand() {
  ltDiv.style.background = 'transparent';
  ltDiv.classList.remove('logo-fullscreen');
  textEl.className = '';
  textEl.innerHTML = '';
  textEl.style.fontSize = '';
  textEl.style.maxHeight = '';
  textEl.style.overflow = '';
  copyright.textContent = '';
  if (accentEl) accentEl.style.display = 'none';
  bandVisible = false;
}

// Render this channel's logo FULLSCREEN (cover), filling the L3 output — the operator
// designs a PNG in whatever proportions they want and it shows edge-to-edge. Only fired
// when the channel has its OWN logo override (no global fallback); see renderProgram.
const LOGO_VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'];
function showLtLogo(path, scaleMode) {
  const url = pathToUrl(path);
  if (!url) { clearBand(); return; }
  const isVideo = LOGO_VIDEO_EXT.includes(String(path).split('.').pop().toLowerCase());
  const fit = scaleMode === 'contain' ? 'contain' : 'cover'; // fullscreen defaults to cover
  ltDiv.style.background = 'transparent';
  ltDiv.classList.add('logo-fullscreen');
  textEl.style.cssText = '';
  textEl.className = 'logo-mode';
  textEl.innerHTML = isVideo
    ? `<video class="logo-img" style="object-fit:${fit}" autoplay loop muted playsinline src="${url}"></video>`
    : `<img class="logo-img" style="object-fit:${fit}" src="${url}" alt="" />`;
  copyright.textContent = '';
  if (accentEl) accentEl.style.display = 'none';
  bandVisible = false;
}

// Split-verse auto-fit for the lower third: largest font (≤ maxPx) at which both
// stacked translations fit within maxH; clips beyond that as a safety net.
function fitSplitText(maxPx, maxH) {
  const cap = Math.max(20, maxPx);
  textEl.style.maxHeight = maxH + 'px';
  textEl.style.overflow = 'hidden';
  textEl.style.fontSize = cap + 'px';
  if (textEl.scrollHeight > maxH) {
    let lo = 20, hi = cap;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      textEl.style.fontSize = mid + 'px';
      if (textEl.scrollHeight <= maxH) lo = mid; else hi = mid;
    }
    textEl.style.fontSize = lo + 'px';
  }
}

// Presentation pages are explicit lines (each its own nowrap block), so fit both ways: shrink the
// font until the block is within maxH tall AND no line is wider than the band.
function fitPresLines(maxPx, maxH) {
  const cap = Math.max(20, maxPx);
  textEl.style.maxHeight = maxH + 'px';
  textEl.style.overflow = 'hidden';
  const fits = () => textEl.scrollHeight <= maxH && textEl.scrollWidth <= textEl.clientWidth + 1;
  textEl.style.fontSize = cap + 'px';
  if (fits()) return;
  let lo = 20, hi = cap;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    textEl.style.fontSize = mid + 'px';
    if (fits()) lo = mid; else hi = mid;
  }
  textEl.style.fontSize = lo + 'px';
}

// The lines + title a presentation payload puts in the band. Current payloads carry `ltLines`
// (one string per line, the current page) and `ltTitle`; an older payload only has `ltText`
// (title as its first line), which is split here so both render the same way.
function presLinesOf(payload) {
  if (payload.ltMode === 'hide') return { title: '', lines: [] };
  const title = (typeof payload.ltTitle === 'string' ? payload.ltTitle : '').trim();
  if (Array.isArray(payload.ltLines)) {
    return { title, lines: payload.ltLines.map((l) => String(l ?? '').trim()).filter(Boolean) };
  }
  let lines = (typeof payload.ltText === 'string' ? payload.ltText : '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (title && lines[0] === title) lines = lines.slice(1);
  return { title, lines };
}

function renderProgram(payload) {
  if (!showProgram || !payload) { clearBand(); return; }

  if (typeof payload !== 'object') { clearBand(); return; }
  const { type } = payload;
  const copy = typeof payload.copyright === 'string' ? payload.copyright : '';
  // A non-object style is treated as null (= all-default, centre aligned), never a bail-out.
  const styleJson = payload.styleJson && typeof payload.styleJson === 'object' ? payload.styleJson : null;

  // clear / foreground-media / live-input blank the lower-third band.
  if (type === 'clear' || payload.media || payload.liveInput) { clearBand(); return; }
  // Presentation slide: the full canvas (`elements`) never fits a band, so the operator
  // sends the slide's derived text (`ltText`, optional `ltTitle` first line, see
  // shared/presentation-lt-text.js). No text / hidden / image-only slide → blank band.
  const isPres = !!payload.elements;
  const pres = isPres ? presLinesOf(payload) : null;
  if (isPres && !pres.lines.length && !pres.title) { clearBand(); return; }
  const text = isPres ? '' : (typeof payload.text === 'string' ? payload.text : '');
  // Logo: an L3 channel shows a logo ONLY when it has its OWN logo override — no global
  // fallback (so by default an L3 output stays blank on a logo cue while the fullscreen
  // output shows the global logo). When set, it renders FULLSCREEN so the operator can
  // design a PNG in any proportions. `logoFromOverride` is main's per-channel flag.
  if (type === 'logo') {
    if (payload.logoPath && payload.logoFromOverride) showLtLogo(payload.logoPath, payload.logoScaleMode);
    else clearBand();
    return;
  }

  // Global lower-third font scale (fraction of the authored/fullscreen size). Main
  // attaches it to every content payload; default to 1 when absent.
  const scale = (Number(payload.ltFontScale) > 0) ? Number(payload.ltFontScale) : 1;

  // The lower third resolves its own style: the fullscreen look with any `lt`
  // overrides applied. Everything below styles from ltStyle, not the raw styleJson.
  const ltStyle = resolveLtStyle(styleJson);

  // Entrance fires only on the band's first appearance (not line-to-line — the slide
  // transition owns those).
  const appearing = !bandVisible;
  bandVisible = true;

  ltDiv.classList.remove('logo-fullscreen'); // drop fullscreen-logo layout when lyrics resume
  textEl.className = '';
  applyStyle(textEl, ltStyle, scale);
  applyLtForm(styleJson && styleJson.lt && styleJson.lt.form, styleJson && styleJson.lt && styleJson.lt.anchor, buildBarBg(ltStyle && ltStyle.ltBar));
  applyAccent(ltStyle && ltStyle.accent);

  // Split-verse (compare) view: stack both translations in the band, each with its
  // own attribution. Shrink the base a touch more so two verses fit the lower third.
  const sv = payload.scriptureVerses;
  if (Array.isArray(sv) && sv.length > 1) {
    textEl.classList.add('split');
    textEl.innerHTML = sv.filter((b) => b && typeof b === 'object').map((b) =>
      `<div class="split-verse"><div class="split-verse-body">${renderWithRuns(b.text || '', ltStyle?.runs, scale)}</div>`
      + `<div class="split-verse-attr">${esc(b.attribution || '')}</div></div>`).join('');
    copyright.textContent = '';
    // Auto-fit the stacked translations to fill the band at the largest size that still
    // fits within ~60% of the screen (so a long two-translation reading can't run off
    // the top of the frame). Mirrors fullscreen's approach, capped for the lower third.
    fitSplitText((Number(ltStyle?.fontSize) || 72) * scale, Math.round(window.innerHeight * 0.6));
    applyLtAnim(appearing ? (styleJson && styleJson.lt && styleJson.lt.anim) : null);
    return;
  }
  if (isPres) {
    // Plain text through the same band as lyrics: one nowrap block per page line, the title
    // (repeated on every page) as a bolder first line.
    textEl.innerHTML = (pres.title ? '<div style="font-weight:700;white-space:nowrap">' + esc(pres.title) + '</div>' : '')
      + pres.lines.map((l) => '<div style="white-space:nowrap">' + esc(l) + '</div>').join('');
  } else {
    textEl.innerHTML = renderWithRuns(text || '', ltStyle?.runs, scale);
  }
  // Lower-third line budget. Primary tool is the shared Max-Lines/slide cap (§A) which
  // paginates the slide; the L3 INHERITS that cap by default (payload.slideMaxLines) and
  // auto-fits to it. A theme may override with its own tighter cap (lt.maxLines). Either
  // way, a permanent safety net keeps the band within ~45% of the frame so a long slide
  // can never run off screen (§B backup).
  const ltOverride = Number(styleJson && styleJson.lt && styleJson.lt.maxLines) || 0; // custom, absent = inherit
  const ltMax = ltOverride || Number(payload.slideMaxLines) || 0;
  const baseFontPx = (Number(ltStyle?.fontSize) || 72) * scale;
  const lh = Number(ltStyle?.lineSpacing) || 1.2;
  const capH = ltMax > 0 ? Math.ceil(ltMax * lh * baseFontPx) : Infinity;
  if (isPres) fitPresLines(baseFontPx, Math.round(window.innerHeight * 0.45));
  else {
    const maxH = Math.min(capH, Math.round(window.innerHeight * 0.45));
    if (Number.isFinite(maxH)) fitSplitText(baseFontPx, maxH);
  }
  applyLtAnim(appearing ? (styleJson && styleJson.lt && styleJson.lt.anim) : null);
  copyright.textContent = copy || '';
  // Scripture attribution ("John 1:1 (KJV)") right-aligned + stylable; song copyright inherits.
  applyCopyrightStyle(copyright, payload.copyrightStyle && typeof payload.copyrightStyle === 'object' ? payload.copyrightStyle : null, payload.copyrightAlign === 'right' ? 'right' : '');
}

// The lyric band never contains a video, so transitions are always safe here — the
// band cross-fades/slides between lyric lines and fades out when an item with no band
// (media/presentation/clear/logo) goes live. Only the slide-update path animates;
// the content-mode toggle below snaps (it's a mode change, not a slide change).
const stageEl = document.getElementById('lowerthird');

// A malformed payload must never throw out of an IPC handler (it would leave the band
// half-rendered on air): fall back to a clean, blank band.
function safeRender(payload) {
  try { renderProgram(payload); }
  catch (err) { console.error('[lowerthird] render failed', err); try { clearBand(); } catch {} }
}

window.cueOutput.onSlideUpdate((payload) => {
  lastPayload = payload;
  if (window.CueTransitions) window.CueTransitions.run(stageEl, payload && payload.transition, () => safeRender(payload));
  else safeRender(payload);
});

// Live content-mode toggle — switch the lyric band on/off without a window reload.
if (window.cueOutput.onContentMode) {
  window.cueOutput.onContentMode((m) => {
    showProgram = !m || m.program !== 0;
    safeRender(lastPayload);
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
  el.style.textDecoration  = [cs?.underline && 'underline', cs?.strikethrough && 'line-through'].filter(Boolean).join(' ') || '';
  el.style.textTransform   = cs?.uppercase ? 'uppercase' : '';
  el.style.letterSpacing   = cs?.letterSpacing ? cs.letterSpacing + 'em' : '';
  el.style.textShadow      = cs?.textShadow?.enabled
    ? `${cs.textShadow.x ?? 0}px ${cs.textShadow.y ?? 2}px ${cs.textShadow.blur ?? 16}px ${cs.textShadow.color ?? '#000'}` : '';
  el.style.webkitTextStroke = cs?.textStroke?.enabled
    ? `${cs.textStroke.width ?? 2}px ${cs.textStroke.color ?? '#000'}` : '';
}
