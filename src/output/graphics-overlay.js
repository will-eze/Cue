// Broadcast-graphics overlay — shared by fullscreen.html and lowerthird.html (NOT
// stage.html). An independent layer rendered on top of the program content, so an
// In-Room ticker/lower-third overlays the main auditorium output, and an Online
// graphic overlays the NDI feed. Self-contained: injects its own DOM + styles and
// registers the graphic:update handler. Driven by output/manager.js (overlay bus).

(function () {
  if (!window.cueOutput || !window.cueOutput.onGraphicUpdate) return;
  if (document.getElementById('cue-gfx')) return; // guard against double-include

  // graphics=0 → this channel suppresses the broadcast-graphics overlay (e.g. a
  // lower-third channel in "Lyrics Only" mode). Mutable so the operator can toggle
  // it live via content:mode without recreating the window (no NDI sender drop).
  let showGfx = new URLSearchParams(location.search).get('graphics') !== '0';
  let lastOverlay = null; // cached so re-enabling restores the current graphics

  // ── Inject base layout (keyframes + ticker crawl + fallback look) ───────────
  const style = document.createElement('style');
  style.textContent = `
    #cue-gfx { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
    #cue-gfx #lt-namebar {
      display: none; position: absolute; box-sizing: border-box;
      flex-direction: column; overflow: hidden;
      bottom: 0; left: 0; max-width: 70%; padding: 22px 48px 22px 32px;
      border-left: 8px solid #4d8eff;
      background: linear-gradient(to right, rgba(12,14,18,0.92) 0%, rgba(12,14,18,0.78) 80%, rgba(12,14,18,0) 100%);
    }
    #cue-gfx #lt-namebar.active { display: flex; }
    #cue-gfx #nt-name  { color: #fff; font-size: 54px; font-weight: 700; line-height: 1.1; text-shadow: 0 2px 8px rgba(0,0,0,0.6); white-space: pre-wrap; }
    #cue-gfx #nt-title { color: #adc6ff; font-size: 28px; font-weight: 500; line-height: 1.2; margin-top: 4px; white-space: pre-wrap; }
    #cue-gfx #nt-title:empty { display: none; }
    #cue-gfx #lt-ticker {
      display: none; position: absolute; left: 0; right: 0; bottom: 0; height: 64px;
      background: rgba(12,14,18,0.9); border-top: 3px solid #4d8eff; overflow: hidden; align-items: center;
    }
    #cue-gfx #lt-ticker.active { display: flex; }
    #cue-gfx #ticker-inner {
      white-space: nowrap; flex-shrink: 0; padding-left: 100%;
      color: #fff; font-size: 30px; font-weight: 500; line-height: 64px; will-change: transform;
    }
    #cue-gfx #ticker-inner.run { animation: cue-ticker-crawl linear infinite; }
    @keyframes cue-ticker-crawl { from { transform: translateX(0); } to { transform: translateX(-100%); } }
    #cue-gfx #lt-custom { display: none; position: absolute; inset: 0; }
    #cue-gfx #lt-custom.active { display: block; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'cue-gfx';
  root.innerHTML =
    '<div id="lt-namebar"><div id="nt-name"></div><div id="nt-title"></div></div>' +
    '<div id="lt-ticker"><div id="ticker-inner"></div></div>' +
    '<div id="lt-custom"></div>';
  document.body.appendChild(root);

  const namebar     = root.querySelector('#lt-namebar');
  const ntName      = root.querySelector('#nt-name');
  const ntTitle     = root.querySelector('#nt-title');
  const tickerEl    = root.querySelector('#lt-ticker');
  const tickerInner = root.querySelector('#ticker-inner');
  const customEl    = root.querySelector('#lt-custom');

  // ── Style helpers ───────────────────────────────────────────────────────────
  function buildShadow(shadow) {
    if (!shadow) return '';
    if (!shadow.enabled) return 'none';
    return `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}`;
  }

  function buildBarBg(bar) {
    if (!bar) return 'transparent';
    const c  = bar.color   ?? '#000000';
    const op = bar.opacity ?? 0.8;
    const r  = parseInt(c.slice(1, 3), 16) || 0;
    const g  = parseInt(c.slice(3, 5), 16) || 0;
    const b  = parseInt(c.slice(5, 7), 16) || 0;
    if (bar.solid) return `rgba(${r},${g},${b},${op})`;
    return `linear-gradient(to top, rgba(${r},${g},${b},${op}) 0%, rgba(${r},${g},${b},${(op * 0.7).toFixed(2)}) 70%, transparent 100%)`;
  }

  function applyTextStyle(el, s, defaults) {
    s = s || {};
    const d = defaults || {};
    el.style.fontFamily     = s.fontFamily || d.fontFamily || '';
    el.style.fontSize       = (s.fontSize ?? d.fontSize) ? (s.fontSize ?? d.fontSize) + 'px' : '';
    el.style.color          = s.color || d.color || '';
    el.style.fontWeight     = s.bold ? '700' : '400';
    el.style.fontStyle      = s.italic ? 'italic' : 'normal';
    el.style.textDecoration = s.underline ? 'underline' : 'none';
    el.style.textTransform  = s.uppercase ? 'uppercase' : 'none';
    el.style.textAlign      = s.align || d.align || '';
    el.style.lineHeight     = s.lineSpacing ? String(s.lineSpacing) : '';
    el.style.letterSpacing  = s.letterSpacing ? s.letterSpacing + 'em' : '';
    const sh = buildShadow(s.textShadow);
    el.style.textShadow = sh ? sh : (d.textShadow || '');
    el.style.webkitTextStroke = (s.textStroke && s.textStroke.enabled)
      ? `${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}` : '';
  }

  const NAME_DEFAULTS  = { fontSize: 54, color: '#ffffff', textShadow: '0 2px 8px rgba(0,0,0,0.6)' };
  const TITLE_DEFAULTS = { fontSize: 28, color: '#adc6ff', textShadow: '0 2px 8px rgba(0,0,0,0.6)' };

  // ── Name/title bug ──────────────────────────────────────────────────────────
  function setNameTitle(nt) {
    if (nt && (nt.name || nt.title)) {
      const st  = nt.style || {};
      const box = (st.name && st.name.textBox) || { x: 4, y: 70, w: 55, h: 22 };
      const bar = st.name && st.name.ltBar;
      const vAlign = (st.name && st.name.verticalAlign) || 'bottom';

      namebar.style.left   = box.x + '%';
      namebar.style.top    = box.y + '%';
      namebar.style.width  = box.w + '%';
      namebar.style.height = box.h + '%';
      namebar.style.right  = 'auto';
      namebar.style.bottom = 'auto';
      namebar.style.maxWidth = 'none';
      namebar.style.justifyContent = vAlign === 'top' ? 'flex-start' : vAlign === 'center' ? 'center' : 'flex-end';
      if (st.name && 'ltBar' in st.name) {
        namebar.style.background = buildBarBg(bar);
        namebar.style.borderLeft = 'none';
        namebar.style.padding    = '12px 32px';
      }
      applyTextStyle(ntName,  st.name,  NAME_DEFAULTS);
      applyTextStyle(ntTitle, st.title, TITLE_DEFAULTS);

      ntName.textContent  = nt.name  || '';
      ntTitle.textContent = nt.title || '';
      namebar.classList.add('active');
    } else {
      namebar.classList.remove('active');
      ntName.textContent = '';
      ntTitle.textContent = '';
    }
  }

  // ── Ticker crawl ────────────────────────────────────────────────────────────
  function setTicker(t) {
    if (t && t.text) {
      const st = t.style || {};
      if (st.position === 'top') { tickerEl.style.top = '0'; tickerEl.style.bottom = 'auto'; tickerEl.style.borderTop = 'none'; tickerEl.style.borderBottom = '3px solid #4d8eff'; }
      else { tickerEl.style.bottom = '0'; tickerEl.style.top = 'auto'; tickerEl.style.borderBottom = 'none'; tickerEl.style.borderTop = '3px solid #4d8eff'; }
      if (st.bar) { tickerEl.style.background = buildBarBg({ color: st.bar.color, opacity: st.bar.opacity, solid: true }); tickerEl.style.borderTop = 'none'; tickerEl.style.borderBottom = 'none'; }
      else tickerEl.style.background = 'rgba(12,14,18,0.9)';
      applyTextStyle(tickerInner, st, { fontSize: 30, color: '#ffffff' });
      tickerInner.style.textAlign = '';

      tickerInner.textContent = t.text;
      tickerEl.classList.add('active');
      tickerInner.classList.remove('run');
      void tickerInner.offsetWidth; // force reflow so the animation restarts cleanly
      const distance = tickerInner.scrollWidth;
      const speed = Math.max(20, Number(t.speed) || 100);
      tickerInner.style.animationDuration = (distance / speed) + 's';
      tickerInner.classList.add('run');
    } else {
      tickerEl.classList.remove('active');
      tickerInner.classList.remove('run');
      tickerInner.textContent = '';
    }
  }

  // ── Custom HTML (isolated shadow root) ──────────────────────────────────────
  const customShadow = customEl.attachShadow ? customEl.attachShadow({ mode: 'open' }) : null;
  const HOST_CSS = ':host{position:absolute;inset:0;display:block;overflow:hidden}.cue-root{position:absolute;inset:0}';
  let customOutTimer = null;

  function setCustom(c) {
    if (!customShadow) return;
    clearTimeout(customOutTimer);
    if (c && c.html) {
      customEl.classList.add('active');
      customShadow.innerHTML = `<style>${HOST_CSS}</style><div class="cue-root cue-in">${c.html}</div>`;
    } else {
      const r = customShadow.querySelector('.cue-root');
      if (r) {
        r.classList.remove('cue-in');
        r.classList.add('cue-out');
        customOutTimer = setTimeout(() => { customShadow.innerHTML = ''; customEl.classList.remove('active'); }, 800);
      } else {
        customShadow.innerHTML = '';
        customEl.classList.remove('active');
      }
    }
  }

  function apply(o) {
    setNameTitle(o && o.nameTitle);
    setTicker(o && o.ticker);
    setCustom(o && o.custom);
  }

  window.cueOutput.onGraphicUpdate(function (o) {
    lastOverlay = o;
    apply(showGfx ? o : null);
  });

  // Live content-mode toggle — show/hide the overlay without a window reload.
  if (window.cueOutput.onContentMode) {
    window.cueOutput.onContentMode(function (m) {
      showGfx = m.graphics !== 0;
      apply(showGfx ? lastOverlay : null);
    });
  }
})();
