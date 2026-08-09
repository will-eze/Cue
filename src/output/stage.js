// ── Customisable WYSIWYG stage display ────────────────────────────────────────
// The stage/confidence monitor is a free-form set of positioned elements. The layout
// arrives via stage:layout (per channel); this script rebuilds #stage-root into one
// absolutely-positioned node per element and routes the live slide bus + the local
// tickers (clock / presenter timer / elapsed / video countdown / message) into whichever
// element nodes currently exist. Per the output guard rails: clocks/timers tick LOCALLY
// against Date.now() (never per-second IPC); media uses cue-media:// (never file://); the
// confidence monitor is always muted (no audio tap).

const rootEl = document.getElementById('stage-root');

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
const alignItems = (a) => (a === 'left' ? 'flex-start' : a === 'right' ? 'flex-end' : 'center');

// The built-in default layout — mirrors DEFAULT_STAGE_LAYOUT in main/output/manager.js so
// the window shows the classic look before the per-channel layout arrives.
const DEFAULT_ELEMENTS = [
  { id: 'clock',   type: 'clock',          x: 2.5, y: 2.5,  w: 30.5, h: 12, hour12: true, showSeconds: true },
  { id: 'timer',   type: 'timer',          x: 34.5, y: 2.5, w: 31,   h: 12, showBar: true },
  { id: 'video',   type: 'videoCountdown', x: 67,  y: 2.5,  w: 30.5, h: 12 },
  { id: 'current', type: 'currentText',    x: 2.5, y: 16,   w: 95,   h: 54, align: 'center', color: '#ffffff', fit: 'auto', showRef: true },
  { id: 'next',    type: 'nextText',       x: 2.5, y: 71.5, w: 95,   h: 14, color: 'rgba(255,255,255,0.4)', align: 'center' },
  { id: 'message', type: 'message',        x: 2.5, y: 87.5, w: 95,   h: 10, align: 'center' },
];

// ── Live state ──────────────────────────────────────────────────────────────
let lastContent   = { text: '', nextText: '', ref: '' };
let statusMode    = 'idle'; // 'live' | 'cleared' | 'logo' | 'idle'
let stageTransport = null;
const timer = { totalSeconds: 0, remainingSeconds: 0, running: false, startedAt: null, remainingAtStart: 0 };
let vcd = { active: false, loop: false, duration: 0 };
let stageVideoEl = null, stagePlayer = null, stageVideoNodeId = null;
let immediateMessage = '', scheduledMessages = [];

// ── Element registry (rebuilt on every layout) ────────────────────────────────
// byId: id → { spec, box, refs:{…} }. byType: type → [node, …] for the engines.
let nodes = { byId: new Map(), byType: {} };
function nodesOf(type) { return nodes.byType[type] || []; }

// Type → CSS class. Explicit map (NOT a kebab-case of the type) so compound types resolve
// to the stylesheet's short names — e.g. nextText → `el-next` (whose `flex-direction:row`
// makes alignment horizontal). A generic kebab transform produced `el-next-text`, which
// matched no rule, so the box fell back to the base column and alignment ran vertically.
const TYPE_CLASS = {
  currentText: 'el-current', nextText: 'el-next', clock: 'el-clock', timer: 'el-timer',
  elapsedTimer: 'el-elapsed', videoCountdown: 'el-video', message: 'el-message', staticText: 'el-static',
};

function buildLayout(elements) {
  // Tear down any live stage video before discarding its node.
  clearStageVideo();
  rootEl.innerHTML = '';
  nodes = { byId: new Map(), byType: {} };

  (elements && elements.length ? elements : DEFAULT_ELEMENTS).forEach((spec, i) => {
    const box = document.createElement('div');
    box.className = 'stage-el ' + (TYPE_CLASS[spec.type] || '');
    box.style.left   = spec.x + '%';
    box.style.top    = spec.y + '%';
    box.style.width  = spec.w + '%';
    box.style.height = spec.h + '%';
    box.style.zIndex = String(i + 1);
    const node = { spec, box, refs: {} };
    (BUILDERS[spec.type] || (() => {}))(node);
    rootEl.appendChild(box);
    nodes.byId.set(spec.id, node);
    (nodes.byType[spec.type] = nodes.byType[spec.type] || []).push(node);
  });

  // Re-apply all live state to the freshly-built nodes.
  applyMutedClass();
  renderContent();
  renderTimers();
  renderCounter();
  applyMessage();
  tickClock();
}

// ── Per-type DOM builders ─────────────────────────────────────────────────────
function barBlock(node, valueClass) {
  const { spec, box } = node;
  box.classList.add('el-bar');
  box.style.alignItems = alignItems(spec.align); // honor horizontal alignment
  if (spec.label) {
    const lbl = document.createElement('div');
    lbl.className = 'el-label';
    lbl.textContent = spec.label;
    box.appendChild(lbl);
  }
  const val = document.createElement('div');
  val.className = 'el-value ' + (valueClass || '');
  box.appendChild(val);
  node.refs.value = val;
  return val;
}

const BUILDERS = {
  clock(node)          { node.refs.value = barBlock(node, ''); },
  videoCountdown(node) { node.refs.value = barBlock(node, 'counter-idle'); },
  elapsedTimer(node)   { node.refs.value = barBlock(node, ''); },
  timer(node) {
    barBlock(node, 'timer-idle');
    if (node.spec.showBar !== false) {
      const track = document.createElement('div');
      track.className = 'progress-track';
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      track.appendChild(bar);
      node.box.appendChild(track);
      node.refs.bar = bar;
    }
  },
  currentText(node) {
    const { spec, box } = node;
    const media = document.createElement('div');
    media.className = 'media-wrap';
    const ref = document.createElement('div');
    ref.className = 'current-ref';
    const text = document.createElement('div');
    text.className = 'current-text';
    text.style.color = spec.color || '#ffffff';
    text.style.textAlign = spec.align || 'center';
    box.appendChild(media);
    box.appendChild(ref);
    box.appendChild(text);
    node.refs = { media, ref, text };
  },
  nextText(node) {
    const { spec, box } = node;
    if (spec.label) {
      const cap = document.createElement('span');
      cap.className = 'next-caption';
      cap.textContent = spec.label;
      box.appendChild(cap);
    }
    const text = document.createElement('span');
    text.className = 'next-text';
    text.style.color = spec.color || 'rgba(255,255,255,0.4)';
    text.style.textAlign = spec.align || 'center';
    box.appendChild(text);
    node.refs.text = text;
  },
  staticText(node) {
    const { spec, box } = node;
    box.style.color = spec.color || '#e2e2e8';
    box.style.textAlign = spec.align || 'center';
    box.style.alignItems = alignItems(spec.align);
    const span = document.createElement('span');
    span.textContent = spec.text || '';
    box.appendChild(span);
    node.refs.text = span;
  },
  message(node) {
    node.box.style.alignItems = alignItems(node.spec.align);
    const inner = document.createElement('div');
    inner.className = 'msg-empty';
    node.box.appendChild(inner);
    node.refs.inner = inner;
  },
};

// ── Auto-fit text — binary-search the largest font-size (px) that fits vertically ──
// Runs for every fittable element type on content change and window resize. Each node
// stores its text target in refs.text (or refs.value for bar elements); fitNode picks
// the right one by spec.type and subtracts the appropriate chrome (label, progress bar,
// scripture ref) from availH before searching.
let fitRaf = null;
const FITTABLE = ['currentText', 'nextText', 'clock', 'timer', 'elapsedTimer', 'videoCountdown', 'staticText'];
function fitAllText() {
  if (fitRaf) cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    for (const type of FITTABLE) for (const node of nodesOf(type)) fitNode(node);
  });
}
function fitNode(node) {
  const { spec, box, refs } = node;

  if (spec.fit === 'fixed') {
    const el = refs.text || refs.value;
    if (el && spec.fontPx) el.style.fontSize = spec.fontPx + 'px';
    return;
  }

  const cs = getComputedStyle(box);
  let availH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  let textEl;

  if (spec.type === 'currentText') {
    textEl = refs.text;
    availH -= 4;
    if (refs.ref && refs.ref.classList.contains('active')) availH -= refs.ref.offsetHeight + 8;
  } else if (spec.type === 'nextText') {
    textEl = refs.text;
  } else if (spec.type === 'staticText') {
    textEl = refs.text;
  } else {
    // bar types: clock, timer, elapsedTimer, videoCountdown
    textEl = refs.value;
    const lbl = box.querySelector('.el-label');
    if (lbl) availH -= lbl.offsetHeight + 4;
    const track = box.querySelector('.progress-track');
    if (track) availH -= track.offsetHeight + 6;
  }

  if (!textEl || availH <= 10) return;
  const wCap = spec.type === 'currentText' ? box.clientWidth * 0.6 : box.clientWidth * 0.85;
  const hiCap = Math.min(availH * 0.88, wCap, 400);
  let lo = 8, hi = hiCap;
  textEl.style.fontSize = hi + 'px';
  if (textEl.scrollHeight <= availH) return;
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2;
    textEl.style.fontSize = mid + 'px';
    if (textEl.scrollHeight <= availH) lo = mid; else hi = mid;
  }
  textEl.style.fontSize = lo + 'px';
}

let resizeDebounce = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(fitAllText, 60);
});

// ── Clock ─────────────────────────────────────────────────────────────────────
function fmtClock(spec) {
  const now = new Date();
  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  if (spec.hour12 !== false) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = String(h % 12 || 12).padStart(2, '0');
    return spec.showSeconds !== false ? `${h12}:${m}:${s} ${ampm}` : `${h12}:${m} ${ampm}`;
  }
  const h24 = String(h).padStart(2, '0');
  return spec.showSeconds !== false ? `${h24}:${m}:${s}` : `${h24}:${m}`;
}
function tickClock() {
  for (const node of nodesOf('clock')) node.refs.value.textContent = fmtClock(node.spec);
}
setInterval(tickClock, 1000);

// ── Presenter timer (countdown) + elapsed (count-up) ──────────────────────────
function currentRemaining() {
  return Math.max(0, (timer.running && timer.startedAt)
    ? timer.remainingAtStart - (Date.now() - timer.startedAt) / 1000
    : timer.remainingSeconds);
}
function renderTimers() {
  const remaining = currentRemaining();
  // Countdown timers
  for (const node of nodesOf('timer')) {
    node.refs.value.textContent = fmtTime(remaining);
    const cls = timer.running && remaining > 0      ? 'timer-running'
              : timer.totalSeconds > 0 && remaining <= 0 ? 'timer-expired'
              : timer.totalSeconds === 0              ? 'timer-idle'
              :                                         'timer-paused';
    node.refs.value.className = 'el-value ' + cls;
    if (node.refs.bar) {
      const pct = timer.totalSeconds > 0 ? (remaining / timer.totalSeconds) * 100 : 0;
      node.refs.bar.style.width = pct + '%';
      node.refs.bar.style.background = (timer.running || (timer.totalSeconds > 0 && remaining <= 0)) ? '#a40217' : '#2a2e38';
    }
  }
  // Elapsed = total − remaining (0 until a timer is set)
  const elapsed = timer.totalSeconds > 0 ? Math.max(0, timer.totalSeconds - remaining) : 0;
  for (const node of nodesOf('elapsedTimer')) {
    node.refs.value.textContent = fmtTime(elapsed);
    node.refs.value.className = 'el-value' + (timer.running ? ' timer-running' : '');
  }
}
let timerTick = null;
function startLocalCountdown() {
  stopLocalCountdown();
  timerTick = setInterval(() => {
    renderTimers();
    if (currentRemaining() <= 0) { timer.running = false; timer.remainingSeconds = 0; stopLocalCountdown(); renderTimers(); }
  }, 200);
}
function stopLocalCountdown() { if (timerTick) { clearInterval(timerTick); timerTick = null; } }
function applyTimerCmd(cmd) {
  stopLocalCountdown();
  if ('totalSeconds' in cmd) timer.totalSeconds = cmd.totalSeconds;
  if ('remainingSeconds' in cmd) { timer.remainingSeconds = cmd.remainingSeconds; timer.remainingAtStart = cmd.remainingSeconds; }
  timer.running   = cmd.running ?? false;
  timer.startedAt = cmd.startedAt ?? null;
  if (timer.running && timer.startedAt) startLocalCountdown();
  renderTimers();
}

// ── Video countdown ───────────────────────────────────────────────────────────
function computeRemaining() {
  if (!vcd.active || !stageTransport || !stageTransport.active) return null;
  const dur = vcd.duration;
  if (!isFinite(dur) || dur <= 0) return null;
  const now = Date.now();
  const ref = (stageTransport.pausedAt != null) ? stageTransport.pausedAt : now;
  let pos = (ref - stageTransport.startAt) / 1000 * (stageTransport.rate || 1);
  if (pos < 0) pos = 0;
  const within = vcd.loop ? pos % dur : Math.min(pos, dur);
  return Math.max(0, dur - within);
}
function renderCounter() {
  const remaining = computeRemaining();
  for (const node of nodesOf('videoCountdown')) {
    if (remaining == null) { node.refs.value.textContent = '--:--'; node.refs.value.className = 'el-value counter-idle'; continue; }
    node.refs.value.textContent = fmtTime(remaining);
    const cls = (!vcd.loop && remaining <= 0) ? 'counter-ended' : (remaining <= 15) ? 'counter-warning' : 'counter-active';
    node.refs.value.className = 'el-value ' + cls;
  }
}
let vcdTick = null;
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

// ── Stage video preview (muted, transport-locked, in the first currentText box) ──
function clearStageVideo() {
  if (stagePlayer) { stagePlayer.destroy(); stagePlayer = null; }
  if (stageVideoEl) { try { stageVideoEl.pause(); stageVideoEl.src = ''; } catch {} stageVideoEl = null; }
  if (stageVideoNodeId) {
    const node = nodes.byId.get(stageVideoNodeId);
    if (node && node.refs.media) { node.refs.media.innerHTML = ''; node.refs.media.classList.remove('active'); }
    stageVideoNodeId = null;
  }
}
function showStageVideo(mediaPath, loop, transport) {
  clearStageVideo();
  const node = nodesOf('currentText')[0];
  if (!node) return;
  const url = pathToUrl(mediaPath);
  if (!url) return;
  const v = document.createElement('video');
  v.src = url;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  node.refs.media.innerHTML = '';
  node.refs.media.appendChild(v);
  node.refs.media.classList.add('active');
  stageVideoEl = v;
  stageVideoNodeId = node.spec.id;
  v.addEventListener('loadedmetadata', () => startCounter(v.duration, loop), { once: true });
  stagePlayer = window.CueMediaPlayer.attach(v, { loop: !!loop, baseMuted: true, transport });
}

// ── Current + next slide content ──────────────────────────────────────────────
function renderContent() {
  for (const node of nodesOf('currentText')) {
    const { text, ref } = node.refs;
    if (text) text.innerHTML = esc(lastContent.text).replace(/\n/g, '<br>');
    if (ref) {
      if (lastContent.ref && node.spec.showRef !== false) { ref.textContent = lastContent.ref; ref.classList.add('active'); }
      else { ref.textContent = ''; ref.classList.remove('active'); }
    }
  }
  for (const node of nodesOf('nextText')) {
    node.refs.text.innerHTML = lastContent.nextText
      ? esc(lastContent.nextText).replace(/\n/g, '<br>')
      : '<span style="opacity:0.3;font-style:italic">—</span>';
  }
  fitAllText();
}
function applyMutedClass() {
  rootEl.classList.toggle('muted', statusMode === 'cleared' || statusMode === 'logo');
}

// ── Stage message ─────────────────────────────────────────────────────────────
// NOTE: mirrors resolveActive() in src/shared/stage-schedule.js — plain DOM, no imports,
// so the logic is duplicated. Keep in sync. Immediate wins; else the latest-started
// active scheduled window wins (ties broken by id = scheduled later).
function resolveMessage() {
  if (immediateMessage && immediateMessage.trim()) return immediateMessage;
  const now = Date.now();
  let best = null;
  for (const m of scheduledMessages) {
    if (now < m.showAt) continue;
    if (m.clearAt != null && now >= m.clearAt) continue;
    if (!best || m.showAt > best.showAt || (m.showAt === best.showAt && m.id > best.id)) best = m;
  }
  return best ? best.text : '';
}
function renderMessage(text) {
  for (const node of nodesOf('message')) {
    const inner = node.refs.inner;
    if (text && text.trim()) {
      inner.className = '';
      const fs = node.spec.fontPx ? ` style="font-size:${node.spec.fontPx}px"` : '';
      inner.innerHTML = `<div class="msg-alert"><span class="msg-alert-icon">&#9888;</span><span class="msg-alert-text"${fs}>${esc(text)}</span></div>`;
    } else {
      inner.className = 'msg-empty';
      inner.innerHTML = '';
    }
  }
}
function applyMessage() {
  renderMessage(resolveMessage());
}
setInterval(applyMessage, 1000);

// ── IPC: slide updates ────────────────────────────────────────────────────────
window.cueOutput.onSlideUpdate((payload) => {
  const { type, text, nextText, media } = payload;

  if (type === 'content') {
    stageTransport = media ? (payload.transport || null) : null;
    const ref = (!media && payload.copyrightAlign === 'right') ? (payload.copyright || '') : '';
    if (media && media.type === 'video') {
      showStageVideo(media.path, !!media.loop, payload.transport);
      lastContent = { text: '', nextText: nextText || '', ref: '' };
    } else {
      clearStageVideo();
      stopCounter();
      if (media) {
        const icon = media.type === 'audio' ? '♪' : '⊞';
        lastContent = { text: icon + ' ' + (payload.title || media.path.split(/[\\/]/).pop()), nextText: nextText || '', ref: '' };
      } else {
        lastContent = { text: text || '', nextText: nextText || '', ref };
      }
    }
    statusMode = 'live';
    renderContent();
    applyMutedClass();
    return;
  }

  if (type === 'logo') {
    stageTransport = null; clearStageVideo(); stopCounter();
    statusMode = 'logo'; renderContent(); applyMutedClass();
    return;
  }

  // clear
  stageTransport = null; clearStageVideo(); stopCounter();
  const isIdle = !lastContent.text && !lastContent.nextText;
  statusMode = isIdle ? 'idle' : 'cleared';
  renderContent(); applyMutedClass();
});

// Keep the video countdown clock in sync with transport (pause freezes it, etc.).
if (window.cueOutput.onMediaTransport) {
  window.cueOutput.onMediaTransport((t) => { stageTransport = t; renderCounter(); });
}

// ── IPC: stage-specific ───────────────────────────────────────────────────────
if (window.cueOutput.onStageLayout)   window.cueOutput.onStageLayout(({ elements }) => buildLayout(elements));
if (window.cueOutput.onStageTimer)    window.cueOutput.onStageTimer(applyTimerCmd);
if (window.cueOutput.onStageMessage)  window.cueOutput.onStageMessage(({ text }) => { immediateMessage = text || ''; applyMessage(); });
if (window.cueOutput.onStageSchedule) window.cueOutput.onStageSchedule(({ scheduled }) => { scheduledMessages = scheduled || []; applyMessage(); });

// Render the default layout immediately; the per-channel layout (stage:layout) replaces it.
buildLayout(DEFAULT_ELEMENTS);
