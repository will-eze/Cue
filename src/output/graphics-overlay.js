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

  // Mirrors fullscreen.js pathToUrl: respects CUE_MEDIA_BASE for Remote Output.
  function pathToUrl(p) {
    if (!p) return null;
    const normalized = p.replace(/\\/g, '/');
    const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
    const base = (typeof window !== 'undefined' && window.CUE_MEDIA_BASE) || 'cue-media://localhost';
    const suffix = (typeof window !== 'undefined' && window.CUE_MEDIA_SUFFIX) || '';
    return base + pathPart.split('/').map(encodeURIComponent).join('/') + suffix;
  }

  function isVideoPath(p) {
    if (!p) return false;
    return /\.(mp4|mov|webm|avi)$/i.test(p.split('?')[0]);
  }

  // ── Inject base layout (keyframes + ticker crawl + fallback look) ───────────
  const style = document.createElement('style');
  style.textContent = `
    #cue-gfx { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
    #cue-gfx #gfx-media-bg { display: none; position: absolute; inset: 0; overflow: hidden; }
    #cue-gfx #gfx-media-bg video,
    #cue-gfx #gfx-media-bg img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
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
    #cue-gfx #lt-countdown {
      display: none; position: absolute; box-sizing: border-box;
      flex-direction: column; overflow: hidden; padding: 16px 32px;
    }
    #cue-gfx #lt-countdown.active { display: flex; }
    #cue-gfx #cd-msg  { color: #adc6ff; font-size: 36px; font-weight: 500; line-height: 1.2; white-space: pre-wrap; }
    #cue-gfx #cd-msg:empty { display: none; }
    #cue-gfx #cd-time { color: #fff; font-size: 120px; font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; white-space: nowrap; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'cue-gfx';
  root.innerHTML =
    '<div id="gfx-media-bg"><video id="gfx-bg-video" autoplay loop muted playsinline></video><img id="gfx-bg-img" alt=""></div>' +
    '<div id="lt-namebar"><div id="nt-name"></div><div id="nt-title"></div></div>' +
    '<div id="lt-ticker"><div id="ticker-inner"></div></div>' +
    '<div id="lt-countdown"><div id="cd-msg"></div><div id="cd-time"></div></div>' +
    '<div id="lt-custom"></div>';
  document.body.appendChild(root);

  const bgDiv       = root.querySelector('#gfx-media-bg');
  const bgVideo     = root.querySelector('#gfx-bg-video');
  const bgImg       = root.querySelector('#gfx-bg-img');
  const namebar     = root.querySelector('#lt-namebar');
  const ntName      = root.querySelector('#nt-name');
  const ntTitle     = root.querySelector('#nt-title');
  const tickerEl    = root.querySelector('#lt-ticker');
  const tickerInner = root.querySelector('#ticker-inner');
  const countdownEl = root.querySelector('#lt-countdown');
  const cdMsg       = root.querySelector('#cd-msg');
  const cdTime      = root.querySelector('#cd-time');
  const customEl    = root.querySelector('#lt-custom');

  // ── Style helpers ───────────────────────────────────────────────────────────
  function buildShadow(shadow) {
    if (!shadow) return '';
    if (!shadow.enabled) return 'none';
    return `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}`;
  }

  function buildBarBg(bar) {
    if (!bar) return 'transparent';
    if (bar.css) return bar.css;
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
    el.style.textDecoration = [s.underline && 'underline', s.strikethrough && 'line-through'].filter(Boolean).join(' ') || 'none';
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
      // Full width within the bug box so text-align (centre/right) is honoured,
      // matching the editor's BugPreview (which stretches the lines full width).
      ntName.style.width  = '100%';
      ntTitle.style.width = '100%';

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
      if (st.bar) { tickerEl.style.background = st.bar.css || buildBarBg({ color: st.bar.color, opacity: st.bar.opacity, solid: true }); tickerEl.style.borderTop = 'none'; tickerEl.style.borderBottom = 'none'; }
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

  // ── Countdown / count-up / clock ────────────────────────────────────────────
  // The bus carries only the anchor time (endsAt / startAt) + config; this template
  // owns the per-second tick, so the operator never streams currentTime to outputs.
  const CD_TIME_DEFAULTS = { fontSize: 120, color: '#ffffff', textShadow: '0 2px 12px rgba(0,0,0,0.6)' };
  const CD_MSG_DEFAULTS  = { fontSize: 36, color: '#adc6ff', textShadow: '0 2px 8px rgba(0,0,0,0.6)' };
  const CD_DEFAULT_BOX   = { x: 25, y: 32, w: 50, h: 36 };

  function pad2(n) { return String(n).padStart(2, '0'); }

  // Seconds → "M:SS" / "MM:SS" / "H:MM:SS" (hours segment only when non-zero).
  function fmtDuration(totalSec) {
    if (totalSec < 0) totalSec = 0;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.floor(totalSec % 60);
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  }

  function fmtClock(date, format, showSeconds) {
    let h = date.getHours();
    let suffix = '';
    if (format === '12h') { suffix = h >= 12 ? ' PM' : ' AM'; h = h % 12 || 12; }
    const hh = format === '12h' ? String(h) : pad2(h);
    const body = showSeconds ? `${hh}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` : `${hh}:${pad2(date.getMinutes())}`;
    return body + suffix;
  }

  let cdTimer = null;
  let cdState = null; // the active slot, normalised

  function renderCountdown() {
    const c = cdState;
    if (!c) return;
    // While paused, render against the frozen instant instead of the live clock so the
    // displayed time holds still (the anchor is shifted on resume in main).
    const now = c.paused ? (c.frozenAt || Date.now()) : Date.now();
    if (c.mode === 'clock') {
      cdTime.textContent = fmtClock(new Date(now), c.format, c.showSeconds);
      return;
    }
    if (c.mode === 'countup') {
      cdTime.textContent = fmtDuration((now - c.startAt) / 1000);
      return;
    }
    // countdown
    const remainingSec = (c.endsAt - now) / 1000;
    if (remainingSec <= 0) {
      if (c.onEnd === 'overflow') {
        // Keep ticking past zero with a '+' prefix; don't clear the interval.
        const elapsed = -remainingSec;
        cdTime.textContent = '+' + fmtDuration(elapsed);
        cdMsg.textContent  = c.label || '';
        return;
      }
      cdTime.textContent = '0:00';
      cdMsg.textContent  = c.endMessage || c.label || '';
      if (cdTimer) { clearInterval(cdTimer); cdTimer = null; } // reached zero — stop ticking
      return;
    }
    // Ceil so a 5-second countdown shows 5 → 4 → 3 → 2 → 1 (not 4 → … → 0:00).
    cdTime.textContent = fmtDuration(Math.ceil(remainingSec));
  }

  function setCountdown(c) {
    if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
    if (c && c.mode) {
      const st  = (c.style && c.style.time)    || {};
      const mst = (c.style && c.style.message) || {};
      const box = st.textBox || { ...CD_DEFAULT_BOX };
      const bar = st.ltBar;
      const vAlign = st.verticalAlign || 'center';

      countdownEl.style.left   = box.x + '%';
      countdownEl.style.top    = box.y + '%';
      countdownEl.style.width  = box.w + '%';
      countdownEl.style.height = box.h + '%';
      countdownEl.style.justifyContent = vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center';
      countdownEl.style.alignItems = (st.align === 'left') ? 'flex-start' : (st.align === 'right') ? 'flex-end' : 'center';
      countdownEl.style.background = bar ? buildBarBg(bar) : 'transparent';

      applyTextStyle(cdTime, st,  CD_TIME_DEFAULTS);
      applyTextStyle(cdMsg,  mst, CD_MSG_DEFAULTS);

      cdMsg.textContent  = c.label || '';
      cdState = c;
      renderCountdown();
      countdownEl.classList.add('active');
      // Clock / count-up never end; countdown self-clears its timer at zero. A paused
      // timer shows a frozen value, so it needs no interval (resume re-broadcasts).
      if (!c.paused) cdTimer = setInterval(renderCountdown, 250);
    } else {
      cdState = null;
      countdownEl.classList.remove('active');
      cdTime.textContent = '';
      cdMsg.textContent = '';
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

  // ── Full-screen background media (video or image behind the overlay text) ──────
  let bgActivePath = null;

  function setGfxBackground(path, fit) {
    const url = pathToUrl(path);
    if (!url) {
      if (bgActivePath) {
        bgDiv.style.display = 'none';
        bgVideo.pause();
        bgVideo.removeAttribute('src');
        bgImg.removeAttribute('src');
        bgActivePath = null;
      }
      return;
    }
    bgDiv.style.display = 'block';
    const objFit = fit || 'cover';
    bgVideo.style.objectFit = objFit;
    bgImg.style.objectFit   = objFit;
    if (isVideoPath(path)) {
      bgImg.style.display   = 'none';
      bgVideo.style.display = 'block';
      if (bgActivePath !== path) {
        bgActivePath = path;
        bgVideo.src = url;
        bgVideo.load();
        bgVideo.play().catch(() => {});
      }
    } else {
      bgVideo.style.display = 'none';
      bgImg.style.display   = 'block';
      if (bgActivePath !== path) {
        bgActivePath = path;
        bgImg.src = url;
      }
    }
  }

  // ── Countdown audio track (in-room only) ─────────────────────────────────────
  // A timer graphic can carry an audio track that plays while it's live, tied to the
  // graphic's Start/Stop and Pause/Resume. It plays from ONE place only — the audible
  // program window (the primary audio monitor) — so it isn't heard N times across every
  // output. Gate: this window emits program audio (mute!=='1'), the media-player aux hook
  // exists (fullscreen template only), and it's NOT the Remote Output browser mirror
  // (CUE_MEDIA_BASE is set there) — audio is in-room only. Registered via attachAuxAudio
  // so it follows the in-room output-device picker exactly like program media.
  const AUDIO_ENABLED = new URLSearchParams(location.search).get('mute') !== '1'
    && !!(window.CueMediaPlayer && window.CueMediaPlayer.attachAuxAudio)
    && !window.CUE_MEDIA_BASE;
  let auxAudioEl = null;
  let auxAudioPath = null;

  function ensureAuxAudio() {
    if (auxAudioEl) return auxAudioEl;
    // A hidden <video> plays the audio track of both audio- and video-source files.
    const el = document.createElement('video');
    el.style.display = 'none';
    el.setAttribute('playsinline', '');
    el.crossOrigin = 'anonymous';
    document.body.appendChild(el);
    auxAudioEl = el;
    try { window.CueMediaPlayer.attachAuxAudio(el); } catch {}
    return el;
  }

  function stopAuxAudio() {
    if (!auxAudioEl) return;
    try { auxAudioEl.pause(); } catch {}
    auxAudioEl.removeAttribute('src');
    try { auxAudioEl.load(); } catch {}
    auxAudioPath = null;
  }

  // Drive the aux audio from the live countdown slot. A missing mode (cleared, or the
  // onEnd→media transition) or absent path stops it.
  function setCountdownAudio(c) {
    if (!AUDIO_ENABLED) return;
    const desired = (c && c.mode && c.audioPath) ? c.audioPath : null;
    if (!desired) { stopAuxAudio(); return; }
    const el = ensureAuxAudio();
    el.loop = !!c.audioLoop;
    if (auxAudioPath !== desired) {
      auxAudioPath = desired;
      el.src = pathToUrl(desired);
      try { el.load(); } catch {}
    }
    // Pause/resume follows the timer's paused flag; otherwise ensure it's playing.
    if (c.paused) { if (!el.paused) el.pause(); }
    else if (el.paused) el.play().catch(() => {});
  }

  function apply(o) {
    setNameTitle(o && o.nameTitle);
    setTicker(o && o.ticker);
    setCountdown(o && o.countdown);
    setCountdownAudio(o && o.countdown);
    setCustom(o && o.custom);

    // Background media: first active slot wins, priority: countdown > custom > nameTitle > ticker
    const bgSlot = (o && o.countdown && o.countdown.bgPath && o.countdown) ||
                   (o && o.custom    && o.custom.bgPath    && o.custom)    ||
                   (o && o.nameTitle && o.nameTitle.bgPath && o.nameTitle) ||
                   (o && o.ticker    && o.ticker.bgPath    && o.ticker)    ||
                   null;
    setGfxBackground(bgSlot ? bgSlot.bgPath : null, bgSlot ? bgSlot.bgFit : null);
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
