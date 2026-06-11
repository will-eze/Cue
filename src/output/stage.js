// ── Element refs ──────────────────────────────────────────────────────────────
const appEl        = document.getElementById('app');
const currentEl    = document.getElementById('current-text');
const currentRefEl = document.getElementById('current-ref');
const mediaWrapEl  = document.getElementById('media-wrap');
const nextEl       = document.getElementById('next-text');
const timerEl      = document.getElementById('timer-value');
const timerBar     = document.getElementById('timer-bar');
const timeEl       = document.getElementById('time-value');
const counterEl    = document.getElementById('counter-value');
const counterLblEl = document.getElementById('counter-label');
const messageEl    = document.getElementById('message-text');

// ── Helpers ───────────────────────────────────────────────────────────────────
function pathToUrl(p) {
  if (!p) return null;
  const normalized = p.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  return 'cue-media://localhost' + pathPart.split('/').map(encodeURIComponent).join('/');
}
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${String(Math.floor(sec / 60)).padStart(2,'0')}:${String(sec % 60).padStart(2,'0')}`;
}

// ── Auto-fit current text to container ───────────────────────────────────────
// Binary-searches the largest font-size (px) where the text fits vertically.
let fitRaf = null;
function fitCurrentText() {
  if (fitRaf) cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    const section = currentEl.parentElement;
    const secStyles = getComputedStyle(section);
    let availH = section.clientHeight
      - parseFloat(secStyles.paddingTop)
      - parseFloat(secStyles.paddingBottom)
      - 4; // small safety gap

    // Reserve room for the scripture reference overlay (top) when shown.
    if (currentRefEl.classList.contains('active')) availH -= currentRefEl.offsetHeight + 8;

    if (availH <= 0) return;

    // Cap at something reasonable so we don't start excessively large
    const maxSize = Math.min(availH * 0.7, window.innerWidth * 0.12, 200);
    let lo = 10, hi = maxSize;

    // Quick check: does it already fit at max?
    currentEl.style.fontSize = hi + 'px';
    if (currentEl.scrollHeight <= availH) return;

    // Binary search
    while (hi - lo > 1) {
      const mid = (lo + hi) / 2;
      currentEl.style.fontSize = mid + 'px';
      if (currentEl.scrollHeight <= availH) lo = mid; else hi = mid;
    }
    currentEl.style.fontSize = lo + 'px';
  });
}

let resizeDebounce = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(fitCurrentText, 60);
});

// ── Clock ─────────────────────────────────────────────────────────────────────
function tickClock() {
  const now  = new Date();
  const h    = now.getHours();
  const m    = String(now.getMinutes()).padStart(2, '0');
  const s    = String(now.getSeconds()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = String(h % 12 || 12).padStart(2, '0');
  timeEl.textContent = `${h12}:${m}:${s} ${ampm}`;
}
tickClock();
setInterval(tickClock, 1000);

// ── Video countdown ───────────────────────────────────────────────────────────
// Counts down the time remaining in the live video, derived from the shared
// transport + the video's own duration. Looping clips show a repeating countdown
// (never ∞); the countdown freezes whenever playback is paused.
let vcd = { active: false, loop: false, duration: 0 };
let vcdTick = null;
let stageTransport = null; // last transport seen (for the countdown clock)

function computeRemaining() {
  if (!vcd.active || !stageTransport || !stageTransport.active) return null;
  const dur = vcd.duration;
  if (!isFinite(dur) || dur <= 0) return null;
  const now = Date.now();
  const ref = (stageTransport.pausedAt != null) ? stageTransport.pausedAt : now;
  let pos = (ref - stageTransport.startAt) / 1000;
  if (pos < 0) pos = 0;
  const within = vcd.loop ? pos % dur : Math.min(pos, dur);
  return Math.max(0, dur - within);
}

function renderCounter() {
  const remaining = computeRemaining();
  if (remaining == null) {
    counterEl.textContent = '--:--';
    counterEl.className = 'bar-value mono counter-idle';
    counterLblEl.textContent = 'VIDEO';
    return;
  }
  counterEl.textContent = fmtTime(remaining);
  counterLblEl.textContent = 'VIDEO';
  if (!vcd.loop && remaining <= 0) {
    counterEl.className = 'bar-value mono counter-ended';
  } else if (remaining <= 15) {
    counterEl.className = 'bar-value mono counter-warning';
  } else {
    counterEl.className = 'bar-value mono counter-active';
  }
}

function startCounter(duration, loop) {
  stopCounter();
  if (!isFinite(duration) || duration <= 0) return;
  vcd = { active: true, loop: !!loop, duration };
  vcdTick = setInterval(renderCounter, 250);
  renderCounter();
}

function stopCounter() {
  if (vcdTick) { clearInterval(vcdTick); vcdTick = null; }
  vcd = { active: false, loop: false, duration: 0 };
  renderCounter();
}

renderCounter();

// ── Stage video preview ───────────────────────────────────────────────────────
// Muted video locked to the shared transport via CueMediaPlayer — same engine as
// the screen outputs, so the confidence monitor stays frame-aligned and obeys
// pause / play / restart / scrub with no clock-master or self-replay logic.
let stageVideoEl = null;
let stagePlayer  = null;

function clearStageVideo() {
  if (stagePlayer) { stagePlayer.destroy(); stagePlayer = null; }
  if (stageVideoEl) { try { stageVideoEl.pause(); stageVideoEl.src = ''; } catch {} stageVideoEl = null; }
  mediaWrapEl.innerHTML = '';
  mediaWrapEl.classList.remove('active');
}

function showStageVideo(mediaPath, loop, transport) {
  clearStageVideo();
  const url = pathToUrl(mediaPath);
  if (!url) return;

  const v = document.createElement('video');
  v.src = url;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';

  mediaWrapEl.innerHTML = '';
  mediaWrapEl.appendChild(v);
  mediaWrapEl.classList.add('active');
  stageVideoEl = v;

  // The countdown uses the same element's duration — start it once known.
  v.addEventListener('loadedmetadata', () => startCounter(v.duration, loop), { once: true });

  // Confidence monitor never carries audio → baseMuted: true.
  stagePlayer = window.CueMediaPlayer.attach(v, { loop: !!loop, baseMuted: true, transport });
}

// ── Slide state ───────────────────────────────────────────────────────────────
let lastContent = { text: '', label: '', nextText: '', ref: '' };

function renderContent() {
  currentEl.innerHTML = esc(lastContent.text).replace(/\n/g, '<br>');
  if (lastContent.ref) {
    currentRefEl.textContent = lastContent.ref;
    currentRefEl.classList.add('active');
  } else {
    currentRefEl.textContent = '';
    currentRefEl.classList.remove('active');
  }
  nextEl.innerHTML = lastContent.nextText
    ? esc(lastContent.nextText).replace(/\n/g, '<br>')
    : '<span style="opacity:0.3;font-style:italic">—</span>';
  fitCurrentText();
}

function setStatus(mode) {
  appEl.classList.toggle('muted', mode === 'cleared' || mode === 'logo');
}

// ── Countdown timer ───────────────────────────────────────────────────────────
const timer = { totalSeconds: 0, remainingSeconds: 0, running: false, startedAt: null, remainingAtStart: 0 };
let timerTick = null;

function renderTimer() {
  const s = Math.max(0, (timer.running && timer.startedAt)
    ? timer.remainingAtStart - (Date.now() - timer.startedAt) / 1000
    : timer.remainingSeconds);

  timerEl.textContent = fmtTime(s);

  const pct = timer.totalSeconds > 0 ? (s / timer.totalSeconds) * 100 : 0;
  timerBar.style.width = `${pct}%`;

  const cls = timer.running && s > 0         ? 'timer-running'
            : timer.totalSeconds > 0 && s <= 0 ? 'timer-expired'
            : timer.totalSeconds === 0          ? 'timer-idle'
            :                                     'timer-paused';
  timerEl.className = `bar-value mono ${cls}`;

  timerBar.style.background = (timer.running || (timer.totalSeconds > 0 && s <= 0))
    ? '#a40217' : '#2a2e38';
}

function startLocalCountdown() {
  stopLocalCountdown();
  timerTick = setInterval(() => {
    const remaining = timer.remainingAtStart - (Date.now() - timer.startedAt) / 1000;
    renderTimer();
    if (remaining <= 0) {
      timer.running = false;
      timer.remainingSeconds = 0;
      stopLocalCountdown();
      renderTimer();
    }
  }, 200);
}
function stopLocalCountdown() {
  if (timerTick) { clearInterval(timerTick); timerTick = null; }
}

function applyTimerCmd(cmd) {
  stopLocalCountdown();
  if ('totalSeconds'     in cmd) timer.totalSeconds     = cmd.totalSeconds;
  if ('remainingSeconds' in cmd) {
    timer.remainingSeconds  = cmd.remainingSeconds;
    timer.remainingAtStart  = cmd.remainingSeconds;
  }
  timer.running   = cmd.running   ?? false;
  timer.startedAt = cmd.startedAt ?? null;
  if (timer.running && timer.startedAt) startLocalCountdown();
  renderTimer();
}

renderTimer();

// ── Stage message ─────────────────────────────────────────────────────────────
function setMessage(text) {
  if (text && text.trim()) {
    messageEl.className = '';
    messageEl.innerHTML = `
      <div class="msg-alert">
        <span class="msg-alert-icon">&#9888;</span>
        <span class="msg-alert-text">${esc(text)}</span>
      </div>`;
  } else {
    messageEl.className = 'msg-empty';
    messageEl.innerHTML = '';
  }
}
setMessage('');

// ── IPC: slide updates ────────────────────────────────────────────────────────
window.cueOutput.onSlideUpdate((payload) => {
  const { type, text, sectionLabel, nextText, media } = payload;

  if (type === 'content') {
    stageTransport = media ? (payload.transport || null) : null;
    // Scripture carries a "Book c:v (VERSION)" reference (copyrightAlign 'right').
    const ref = (!media && payload.copyrightAlign === 'right') ? (payload.copyright || '') : '';
    if (media && media.type === 'video') {
      // Muted video preview; the countdown starts on loadedmetadata.
      showStageVideo(media.path, !!media.loop, payload.transport);
      lastContent = { text: '', label: '', nextText: nextText || '', ref: '' };
    } else {
      clearStageVideo();
      stopCounter();
      if (media) {
        const icon = media.type === 'audio' ? '♪' : '⊞';
        lastContent = {
          text: icon + ' ' + (payload.title || media.path.split(/[\\/]/).pop()),
          label: '',
          nextText: nextText || '',
          ref: '',
        };
      } else {
        lastContent = { text: text || '', label: sectionLabel || '', nextText: nextText || '', ref };
      }
    }
    renderContent();
    setStatus('live');
    return;
  }

  if (type === 'logo') {
    stageTransport = null;
    clearStageVideo();
    stopCounter();
    renderContent();
    setStatus('logo');
    return;
  }

  // clear
  stageTransport = null;
  clearStageVideo();
  const isIdle = !lastContent.text && !lastContent.nextText;
  renderContent();
  setStatus(isIdle ? 'idle' : 'cleared');
  stopCounter();
});

// Keep the countdown clock in sync with transport (pause freezes it, etc.).
if (window.cueOutput.onMediaTransport) {
  window.cueOutput.onMediaTransport((t) => { stageTransport = t; renderCounter(); });
}

// ── IPC: stage-specific ───────────────────────────────────────────────────────
if (window.cueOutput.onStageTimer)   window.cueOutput.onStageTimer(applyTimerCmd);
if (window.cueOutput.onStageMessage) window.cueOutput.onStageMessage(({ text }) => setMessage(text));

// Initial fit (in case window opens with content already set)
fitCurrentText();
