import { BrowserWindow, screen, app, systemPreferences } from 'electron';
import path from 'path';
import { getDb } from '../db/schema.js';
import { get as getSetting, set as setSetting } from '../db/settings.js';
import * as ndi from './ndi.js';
import * as rtmp from '../stream/rtmp.js';
import { ensureBinaries } from '../youtube/bin.js';
import { resolveAnchors, pruneExpired, nextPruneDelay } from '../../shared/stage-schedule.js';

// windows keyed by monitor.id (integer) for screen monitors,
// or 'ndi-{channelId}' (string) for NDI channels.
const windows = new Map();
// Per-NDI-channel paint listeners: channelId → { win, onPaint, timer }
const ndiCaptureLoops = new Map();
// RTMP streaming: a dedicated offscreen window renders the program for the encoder,
// kept OUTSIDE the `windows` map so its lifecycle is independent of output toggling.
let streamWin = null;          // offscreen BrowserWindow compositing the stream program
let streamCapture = null;      // { win, onPaint, timer }
let streaming = false;         // ffmpeg encode is live (Go Live), independent of preview
let streamEncodeConfig = null; // url + bitrates, set at Go Live, consumed on first paint
let streamPreviewRefCount = 0; // Stream tab(s) open → keep the compositor window alive
// NDI channels currently emitting program audio (id set), refreshed on topology
// changes. The program-audio tap runs only while a consumer (NDI audio or stream)
// needs it.
let audioEnabledNdi = new Set();
// Latest downscaled JPEG per NDI channel for multiview thumbnails (1fps cache)
const ndiLastFrames = new Map(); // channelId → Buffer
let mainWindowRef = null;
// Network-control remote: notified on every state change so it can push STATE to
// connected Stream Deck / Companion / phone clients. Set by index.js; decoupled
// so this module never imports the remote server.
let remoteStateCb = null;
// Remote OUTPUT mirror: pushes the canonical program (screen-kind) buses — slide,
// transport, overlay — to the network remote so a phone/laptop can re-render the
// live program in a browser. Decoupled like remoteStateCb (set by index.js).
let remoteProgramCb = null;
// Last screen-kind values, cached so a late-joining viewer gets the current frame.
let mirrorSlide = { type: 'clear', text: null, backgroundPath: null, logoPath: null, copyright: null, sectionLabel: null };
let mirrorTransport = null;
let mirrorOverlay = null;
let lastTransition = { type: 'none' };
let multiviewInterval = null;
let multiviewRefCount = 0;
let multiviewCapturing = false; // in-flight guard so slow capturePage calls don't pile up
let outputsEnabled = true;

// Lower-third font scale — a GLOBAL percentage of the authored (fullscreen) font
// size, applied ONLY to the lower-third output so the L3 band can run a smaller
// relative font than the screen. Lazy-loaded from settings and cached; it rides
// every content payload as `ltFontScale` (a fraction). fullscreen.js ignores the
// field; lowerthird.js multiplies its effective font size by it. Default 100 (=
// same size as the screen, which is the neutral baseline).
let lowerthirdFontScale = null; // percent | null until first read
function getLtFontScalePct() {
  if (lowerthirdFontScale == null) {
    try {
      const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('lowerthird_font_scale');
      lowerthirdFontScale = row ? Number(JSON.parse(row.value)) : 100;
    } catch { lowerthirdFontScale = 100; }
    if (!isFinite(lowerthirdFontScale) || lowerthirdFontScale <= 0) lowerthirdFontScale = 100;
  }
  return lowerthirdFontScale;
}
function ltFontScaleFraction() { return getLtFontScalePct() / 100; }

// Stage display state — persisted so newly opened stage windows can be synced.
// `scheduled` holds timed messages as ABSOLUTE epoch-ms anchors ({ showAt, clearAt });
// main resolves the anchors once and the stage template ticks them against Date.now()
// (never per-second updates over the bus — same model as the countdown graphics).
let stageState = {
  timer: { totalSeconds: 0, remainingSeconds: 0, running: false, startedAt: null },
  message: '',
  scheduled: [],
};
let stageScheduleSeq = 1;
let stagePruneTimer = null;

// Broadcast-graphics overlay — an independent bus from the program slide bus.
// nameTitle = { name, title } | null (built-in lower-third bug); ticker = { text, speed }
// | null (bottom crawl); custom = { html } | null (user HTML/CSS rendered in a shadow
// root); countdown = { mode, endsAt|startAt, … } | null (a self-ticking timer/clock —
// the output template runs the per-second tick, this bus only carries the target time).
// Dispatched as graphic:update to lower-third windows only, so a graphic never
// disturbs the fullscreen program. Persisted for newly opened windows.
//
// Each slot holds ONE occupant PER DESTINATION KIND ({ screen, ndi, stream }) so
// different graphics can run In-Room vs Online vs Stream at the same time. A fire
// targeted 'all' fills every kind; a single kind ('screen'/'ndi'/'stream') or an
// ARRAY of kinds (e.g. ['ndi','stream']) fills just those, leaving the others'
// occupants running. The output windows are already tagged by kind, so each receives
// only its kind's occupant — the inner slot-value shape is unchanged, so the output
// templates need no changes.
const OVERLAY_KINDS = ['screen', 'ndi', 'stream'];
const emptySlot = () => ({ screen: null, ndi: null, stream: null });
let overlay = { nameTitle: emptySlot(), ticker: emptySlot(), custom: emptySlot(), countdown: emptySlot() };
// One-shot timer for countdown end-actions (clear / next / loop). Replaced on each
// countdownShow; cleared on countdownHide. Only set when onEnd is not 'hold'/'overflow'
// (those are template-only and need no main-process action).
let cdEndTimer = null;

// The destination kinds a `target` touches: 'all' → every kind; a string → that one;
// an array → exactly those.
const kindsForTarget = (target) => {
  if (!target || target === 'all') return OVERLAY_KINDS;
  return Array.isArray(target) ? target.filter((k) => OVERLAY_KINDS.includes(k)) : [target];
};

// Assign a slot value to the destination(s) named by `target`. value=null clears the
// targeted kind(s). Leaves untargeted kinds untouched.
function setSlot(name, value, target) {
  const slot = overlay[name];
  for (const k of kindsForTarget(target)) slot[k] = value;
}

// ── Auto-dismiss ──────────────────────────────────────────────────────────────
// A name/title, ticker or custom graphic can carry `autoDismissSec` — fire it and it
// hides itself after that many seconds. Main owns the overlay bus, so it owns the hide:
// ONE one-shot setTimeout per (slot, kind), NOT a per-second stream over the bus (cf.
// the countdown guard rail — only the resolved anchor crosses the bus, never ticks).
// The timer verifies the slot still holds the SAME occupant before hiding, so a graphic
// that has since replaced this one (its own fire re-armed/cleared the timer) is never
// dropped out from under the new occupant.
const dismissTimers = new Map(); // `${name}:${kind}` -> timeout handle

function clearDismiss(name, kind) {
  const key = `${name}:${kind}`;
  const h = dismissTimers.get(key);
  if (h) { clearTimeout(h); dismissTimers.delete(key); }
}

// Arm (or re-arm) the dismiss for one slot+kind. sec<=0 just disarms. `expected` is the
// slot value the timer is allowed to hide — identity-checked at fire time.
function armDismiss(name, kind, sec, expected) {
  clearDismiss(name, kind);
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0 || !expected) return;
  const key = `${name}:${kind}`;
  dismissTimers.set(key, setTimeout(() => {
    dismissTimers.delete(key);
    if (overlay[name] && overlay[name][kind] === expected) {
      overlay[name][kind] = null;
      broadcastGraphic();
    }
  }, s * 1000));
}

// Stamp a value with a fresh auto-dismiss anchor and arm timers for every kind `target`
// fills (used by graphicShow/tickerShow/customShow). A null/0 sec disarms those kinds.
function applyDismiss(name, value, sec, target) {
  for (const kind of kindsForTarget(target)) armDismiss(name, kind, value ? sec : 0, value);
}

// displayMode drives what every output window shows:
//   'idle'    — nothing was ever GO'd; outputs show black
//   'content' — slide text + background showing
//   'cleared' — text hidden, background stays (clear is a toggle)
//   'logo'    — logo asset showing; preLogoMode remembers what to restore
let state = {
  livePayload: null,       // last GO'd payload; preserved through clear/logo toggles
  displayMode: 'idle',
  preLogoMode: null,       // mode to restore when logo is toggled off
};

// Foreground-media transport. Machine-clock based so every output window and the
// operator renderer derive the SAME playhead (no skew, no clock-master election).
//   position(now) = ((pausedAt ?? now) - startAt) / 1000 * rate   (mod duration if loop)
let transport = {
  active: false,   // a foreground media item is loaded
  startAt: 0,      // Date.now() baseline for position 0
  pausedAt: null,  // Date.now() when paused, else null
  loop: false,
  muted: false,    // program (audience) audio mute — layered on top of per-window base mute
  rate: 1,         // operator playback speed; baseline rate the convergence nudges around
};

function getOutputPreloadPath() {
  return path.join(__dirname, 'output-preload.js');
}

function getTemplatePath(template) {
  return path.join(app.getAppPath(), 'src', 'output', `${template}.html`);
}

function createMonitorWindow(channel, monitor) {
  if (!monitor.display_bounds) return null;
  const bounds = JSON.parse(monitor.display_bounds);
  const displays = screen.getAllDisplays();
  const display = displays.find(
    (d) =>
      d.bounds.x === bounds.x &&
      d.bounds.y === bounds.y &&
      d.bounds.width === bounds.width &&
      d.bounds.height === bounds.height,
  );
  if (!display) return null;

  const preload = getOutputPreloadPath();
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    fullscreen: true,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload, contextIsolation: true, nodeIntegration: false, sandbox: false,
      // Allow foreground media (bumpers/clips) to autoplay with audio.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // Program audio comes from a single primary source. Only the primary screen
  // output is unmuted; stage/confidence monitors never carry audio. Layered with
  // the live program mute inside the template (el.muted = baseMuted || transport.muted).
  const baseMuted = channel.template === 'stage' || !isPrimaryAudioMonitor(channel.id, monitor.id);
  // In-room program audio can be routed to a chosen output device (setSinkId in
  // the template). The descriptor {deviceId,label,groupId} rides in as a query
  // param; runtime changes arrive via the 'audio:output-device' broadcast.
  const audioDevice = getSetting('program_audio_device');
  win.loadFile(getTemplatePath(channel.template || 'fullscreen'), {
    // program=0 hides the song lyric band; graphics=0 hides the broadcast-graphics
    // overlay — together they give a lower-third channel its 3 content modes.
    query: {
      mute: baseMuted ? '1' : '0',
      audioDevice: audioDevice ? JSON.stringify(audioDevice) : '',
      program: channel.show_program === 0 ? '0' : '1',
      graphics: channel.show_graphics === 0 ? '0' : '1',
    },
  });
  // Re-dispatch current display state once the template JS is ready.
  // Without this, IPC sent before onSlideUpdate is registered is silently dropped.
  win.webContents.once('did-finish-load', () => {
    sendStateToWindow(win, channel);
    if (channel.template === 'stage') sendStageState(win, channel);
    else sendGraphicToWindow(win, 'screen'); // fullscreen + lower-third carry the overlay
  });
  return win;
}

// The primary audio monitor = first active monitor of the first active non-NDI,
// non-stage channel. Exactly one window emits program audio, avoiding doubled /
// phased audio when several outputs run on the same machine.
function isPrimaryAudioMonitor(channelId, monitorId) {
  const db = getDb();
  const channels = db
    .prepare("SELECT * FROM output_channels WHERE active = 1 AND type != 'ndi' ORDER BY id")
    .all()
    .filter((c) => c.template !== 'stage');
  if (channels.length === 0) return false;
  const primaryChannel = channels[0];
  if (primaryChannel.id !== channelId) return false;
  const monitor = db
    .prepare('SELECT * FROM channel_monitors WHERE channel_id = ? AND active = 1 ORDER BY id LIMIT 1')
    .get(channelId);
  return !!monitor && monitor.id === monitorId;
}

function createNdiWindow(channel) {
  // Create the NDI sender immediately — the source appears on the NDI network as
  // soon as grandi.send() resolves, independently of the window render lifecycle.
  // (Gating this on did-finish-load caused the sender to never be created on
  // macOS because transparent+hidden windows may not initialize a render surface.)
  ndi.createSender(channel.id, channel.name);

  const preload = getOutputPreloadPath();
  const win = new BrowserWindow({
    width: channel.ndi_width || 1920,
    height: channel.ndi_height || 1080,
    show: false,
    frame: false,
    // Offscreen rendering renders to an in-memory BGRA buffer via the 'paint'
    // event. This is more reliable than transparent+show:false (which has known
    // macOS issues where the render surface never initializes) and gives direct
    // per-frame access without polling capturePage().
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.loadFile(getTemplatePath(channel.template || 'fullscreen'), {
    query: {
      alpha: '1',
      // The offscreen NDI window is ALWAYS muted locally: its audio is sent over
      // NDI via the program-audio tap (ndi.sendAudio), gated per channel by
      // `ndi_audio_muted` in updateAudioTapState/ingestAudioPcm. An unmuted
      // offscreen window would both leak audio to the default device and double the
      // tap (it would capture too), so keep it '1'.
      mute: '1',
      program: channel.show_program === 0 ? '0' : '1',
      graphics: channel.show_graphics === 0 ? '0' : '1',
    },
  });
  win.webContents.once('did-finish-load', () => {
    sendStateToWindow(win, channel);
    if (channel.template === 'stage') sendStageState(win, channel);
    else sendGraphicToWindow(win, 'ndi'); // fullscreen + lower-third carry the overlay
    startNdiCapture(channel.id, win, channel);
  });
  return win;
}

function startNdiCapture(channelId, win, channel) {
  const fps = channel.ndi_fps || 30;
  const frameMs = Math.round(1000 / fps);

  win.webContents.setFrameRate(fps);
  win.webContents.startPainting();

  // The 'paint' event delivers the BGRA buffer directly from Chromium's
  // compositor — no async GPU→CPU readback, no copy overhead.
  // capturePage() was causing 4s+ delays because: (a) it's async and slow at
  // 1920×1080, and (b) Chromium throttles offscreen repaints for hidden windows,
  // so stale frames could linger until the compositor decided to re-render.
  //
  // invalidate() on a setInterval drives the offscreen compositor at the target
  // frame rate. Without it, the compositor only repaints when content changes,
  // and may batch/defer those repaints for hidden windows. With it, every tick
  // produces a fresh paint event — slide changes appear within one frame interval.
  let lastSentAt = 0;
  let lastCachedAt = 0;
  const onPaint = (_event, _dirty, image) => {
    const now = Date.now();
    // Enforce the target frame interval in case invalidate() fires paint events
    // faster than expected (e.g. when content changes coincide with our timer tick).
    if (now - lastSentAt < frameMs - 2) return;
    const { width, height } = image.getSize();
    if (width > 0 && height > 0) {
      lastSentAt = now;
      if (ndi.isAvailable()) ndi.sendFrame(channelId, image.toBitmap(), width, height, fps);
      // Cache a downscaled JPEG at ~1fps for the multiview thumbnail
      if (multiviewRefCount > 0 && now - lastCachedAt >= 950) {
        lastCachedAt = now;
        try {
          const small = image.resize({ width: 640 });
          ndiLastFrames.set(channelId, small.toJPEG(72));
        } catch {}
      }
    }
  };
  win.webContents.on('paint', onPaint);

  const timer = setInterval(() => {
    if (!win.isDestroyed()) win.webContents.invalidate();
  }, frameMs);

  ndiCaptureLoops.set(channelId, { win, onPaint, timer });
}

function stopNdiCapture(channelId) {
  const entry = ndiCaptureLoops.get(channelId);
  if (entry) {
    clearInterval(entry.timer);
    if (!entry.win.isDestroyed()) {
      try {
        entry.win.webContents.off('paint', entry.onPaint);
        entry.win.webContents.stopPainting();
      } catch {}
    }
  }
  ndiCaptureLoops.delete(channelId);
  ndiLastFrames.delete(channelId);
  ndi.destroySender(channelId);
}

export async function init() {
  const db = getDb();
  const channels = db.prepare('SELECT * FROM output_channels WHERE active = 1').all();
  const unresolved = [];

  for (const channel of channels) {
    if (channel.type === 'ndi') {
      const win = createNdiWindow(channel);
      if (win) windows.set(`ndi-${channel.id}`, win);
      continue;
    }

    const monitors = db
      .prepare('SELECT * FROM channel_monitors WHERE channel_id = ? AND active = 1')
      .all(channel.id);

    for (const monitor of monitors) {
      const win = createMonitorWindow(channel, monitor);
      if (!win) {
        unresolved.push({ ...channel, _monitorId: monitor.id, _monitorBounds: monitor.display_bounds });
      } else {
        windows.set(monitor.id, win);
      }
    }
  }

  updateAudioTapState();
  return unresolved;
}

// Open a single monitor window (after creating a new monitor record).
export async function openMonitor(channelId, monitor) {
  const db = getDb();
  const channel = db.prepare('SELECT * FROM output_channels WHERE id = ?').get(channelId);
  if (!channel || !channel.active) return;

  const win = createMonitorWindow(channel, monitor);
  if (!win) return;
  windows.set(monitor.id, win);

  // Re-dispatch current state once the template is ready.
  win.webContents.once('did-finish-load', () => {
    sendStateToWindow(win, channel);
  });
}

export function closeMonitor(monitorId) {
  const win = windows.get(monitorId);
  if (win && !win.isDestroyed()) win.close();
  windows.delete(monitorId);
}

// Re-sync all windows for a channel (e.g. after template/active change).
export async function syncChannel(channelId) {
  const db = getDb();

  // Close all existing monitor windows for this channel.
  const allMonitors = db
    .prepare('SELECT * FROM channel_monitors WHERE channel_id = ?')
    .all(channelId);
  for (const m of allMonitors) closeMonitor(m.id);

  // Close NDI window if present.
  stopNdiCapture(channelId);
  const ndiKey = `ndi-${channelId}`;
  const ndiWin = windows.get(ndiKey);
  if (ndiWin && !ndiWin.isDestroyed()) ndiWin.close();
  windows.delete(ndiKey);

  const channel = db.prepare('SELECT * FROM output_channels WHERE id = ?').get(channelId);
  if (!channel || !channel.active) return;

  if (channel.type === 'ndi') {
    const win = createNdiWindow(channel);
    if (win) windows.set(ndiKey, win);
  } else {
    const activeMonitors = db
      .prepare('SELECT * FROM channel_monitors WHERE channel_id = ? AND active = 1')
      .all(channelId);
    for (const monitor of activeMonitors) {
      const win = createMonitorWindow(channel, monitor);
      if (win) windows.set(monitor.id, win);
    }
  }

  // Notify the renderer so the operator UI re-reads channel topology/flags
  // (e.g. the live monitor's content-mode awareness after a mode switch).
  notifyMainWindow('output:state-changed', getState());
  // Topology changed → recompute which NDI channels want audio and (de)activate
  // the program-audio tap accordingly.
  updateAudioTapState();
}

// Toggle a channel's content mode (lyric band / graphics overlay) at RUNTIME by
// messaging its existing windows — no window recreate, so the NDI sender is never
// dropped. Used for the live mode switcher; structural changes still use syncChannel.
export function setChannelContentMode(channelId) {
  const db = getDb();
  const channel = db.prepare('SELECT * FROM output_channels WHERE id = ?').get(channelId);
  if (!channel) return;
  const msg = { program: channel.show_program === 0 ? 0 : 1, graphics: channel.show_graphics === 0 ? 0 : 1 };

  const wins = [];
  if (channel.type === 'ndi') {
    const w = windows.get(`ndi-${channelId}`);
    if (w) wins.push(w);
  } else {
    const monitors = db.prepare('SELECT * FROM channel_monitors WHERE channel_id = ? AND active = 1').all(channelId);
    for (const m of monitors) { const w = windows.get(m.id); if (w) wins.push(w); }
  }
  for (const w of wins) {
    try { if (!w.isDestroyed()) w.webContents.send('content:mode', msg); } catch {}
  }
  notifyMainWindow('output:state-changed', getState());
}

export function closeChannel(channelId) {
  const db = getDb();
  const monitors = db
    .prepare('SELECT * FROM channel_monitors WHERE channel_id = ?')
    .all(channelId);
  for (const m of monitors) closeMonitor(m.id);

  stopNdiCapture(channelId);
  const ndiKey = `ndi-${channelId}`;
  const ndiWin = windows.get(ndiKey);
  if (ndiWin && !ndiWin.isDestroyed()) ndiWin.close();
  windows.delete(ndiKey);
}

export function closeAll() {
  for (const [key, win] of windows) {
    if (typeof key === 'string' && key.startsWith('ndi-')) {
      stopNdiCapture(parseInt(key.slice(4)));
    }
    if (win && !win.isDestroyed()) win.close();
  }
  windows.clear();
  stopStream();
}

// Returns all live output BrowserWindows in channel → monitor order.
function getAllOutputWindows() {
  const db = getDb();
  const channels = db.prepare('SELECT * FROM output_channels WHERE active = 1').all();
  const wins = [];
  for (const channel of channels) {
    if (channel.type === 'ndi') {
      const win = windows.get(`ndi-${channel.id}`);
      if (win && !win.isDestroyed()) wins.push(win);
    } else {
      const monitors = db
        .prepare('SELECT * FROM channel_monitors WHERE channel_id = ? AND active = 1')
        .all(channel.id);
      for (const monitor of monitors) {
        const win = windows.get(monitor.id);
        if (win && !win.isDestroyed()) wins.push(win);
      }
    }
  }
  // The stream window mirrors the program exactly like a fullscreen screen channel.
  if (streamWin && !streamWin.isDestroyed()) wins.push(streamWin);
  return wins;
}

// ── Output transitions ────────────────────────────────────────────────────────
// The operator picks a transition per trigger (slide / logo / clear) in Settings;
// the resolved spec rides ONE slide:update dispatch in `payload.transition`, and the
// output template animates the swap (the template enforces the no-video rule). Main
// only resolves the configured spec — `pendingTransition` is set by go/clear/logo
// right before sendCurrentState(), consumed once, then cleared, so late-attach syncs
// (sendStateToWindow), scene recalls and output refreshes never animate.
const DEFAULT_TRANSITIONS = {
  slide: { type: 'fade', durationMs: 350, easing: 'ease' },
  logo:  { type: 'fade', durationMs: 350, easing: 'ease' },
  clear: { type: 'fade', durationMs: 250, easing: 'ease' },
};
let pendingTransition = null;

function transitionFor(kind) {
  const def = DEFAULT_TRANSITIONS[kind];
  let cfg = null;
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('output_transitions');
    cfg = row ? JSON.parse(row.value) : null;
  } catch { cfg = null; }
  const t = (cfg && cfg[kind]) || def;
  return {
    type: t.type || 'none',
    durationMs: Math.max(0, Math.min(2000, Number(t.durationMs ?? def.durationMs))),
    easing: t.easing || def.easing,
  };
}

// ── Display state machine ─────────────────────────────────────────────────────

// Send the current display state to a single window only.
// Used when a window is first opened so that already-playing windows
// are not disturbed (avoids restarting media on screen output windows).
function sendStateToWindow(win, channel) {
  if (win.isDestroyed()) return;

  if (state.displayMode === 'idle') {
    win.webContents.send('slide:update', {
      type: 'clear', text: null, backgroundPath: null, logoPath: null,
      copyright: null, sectionLabel: null,
    });
    return;
  }

  if (state.displayMode === 'cleared') {
    win.webContents.send('slide:update', {
      type: 'clear', text: null, backgroundPath: state.livePayload?.backgroundPath ?? null,
      logoPath: null, copyright: null, sectionLabel: null,
    });
    return;
  }

  if (state.displayMode === 'logo') {
    const db = getDb();
    const scaleSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('logo_scale_mode');
    const logoScaleMode = scaleSetting ? JSON.parse(scaleSetting.value) : 'cover';
    const logoPath = channel ? resolveLogo(channel) : null;
    win.webContents.send('slide:update', {
      type: 'logo', logoPath, logoScaleMode, text: null,
      backgroundPath: null, copyright: null, sectionLabel: null,
    });
    return;
  }

  // content
  win.webContents.send('slide:update', { ...state.livePayload, type: 'content', transport: { ...transport }, ltFontScale: ltFontScaleFraction() });
}

function emitSlides() {
  // Consume the pending transition once: it rides exactly this dispatch, then clears
  // so a later re-sync (e.g. a window reopening) doesn't replay the animation.
  const transition = pendingTransition || { type: 'none' };
  pendingTransition = null;
  lastTransition = transition; // remembered for the remote-output mirror payload

  if (state.displayMode === 'idle') {
    for (const win of getAllOutputWindows()) {
      win.webContents.send('slide:update', {
        type: 'clear', text: null, backgroundPath: null, logoPath: null,
        copyright: null, sectionLabel: null, transition,
      });
    }
    return;
  }

  if (state.displayMode === 'cleared') {
    const bgPath = state.livePayload?.backgroundPath ?? null;
    for (const win of getAllOutputWindows()) {
      win.webContents.send('slide:update', {
        type: 'clear', text: null, backgroundPath: bgPath, logoPath: null,
        copyright: null, sectionLabel: null, transition,
      });
    }
    return;
  }

  if (state.displayMode === 'logo') {
    // Per-channel dispatch so each channel can use its own logo_override_id.
    const db = getDb();
    const scaleSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('logo_scale_mode');
    const logoScaleMode = scaleSetting ? JSON.parse(scaleSetting.value) : 'cover';

    const channels = db.prepare('SELECT * FROM output_channels WHERE active = 1').all();
    for (const channel of channels) {
      const logoPath = resolveLogo(channel);
      const logoPayload = { type: 'logo', logoPath, logoScaleMode, text: null,
        backgroundPath: null, copyright: null, sectionLabel: null, transition };
      if (channel.type === 'ndi') {
        const win = windows.get(`ndi-${channel.id}`);
        if (win && !win.isDestroyed()) win.webContents.send('slide:update', logoPayload);
      } else {
        const monitors = db
          .prepare('SELECT * FROM channel_monitors WHERE channel_id = ? AND active = 1')
          .all(channel.id);
        for (const monitor of monitors) {
          const win = windows.get(monitor.id);
          if (win && !win.isDestroyed()) win.webContents.send('slide:update', logoPayload);
        }
      }
    }
    // Stream window uses the global logo (no per-channel override).
    if (streamWin && !streamWin.isDestroyed()) {
      streamWin.webContents.send('slide:update', {
        type: 'logo', logoPath: resolveLogo({}), logoScaleMode, text: null,
        backgroundPath: null, copyright: null, sectionLabel: null, transition,
      });
    }
    return;
  }

  // displayMode === 'content'
  for (const win of getAllOutputWindows()) {
    win.webContents.send('slide:update', { ...state.livePayload, type: 'content', transport: { ...transport }, transition, ltFontScale: ltFontScaleFraction() });
  }
}

// Dispatch the program to the local output windows, then mirror the canonical
// screen-kind slide to the network remote (browser viewers). The wrapper keeps
// every existing caller (go/clear/logo/refresh) unchanged.
function sendCurrentState() {
  emitSlides();
  mirrorSlide = buildMirrorSlide();
  emitProgramChange({ slide: mirrorSlide });
}

// ── Remote-output mirror (browser program viewers) ───────────────────────────
// Re-derives the SAME payload a screen/in-room window receives for the current
// displayMode, so the remote browser renders identical program output. NDI
// (alpha) and stream-kind payloads are deliberately NOT mirrored.
function buildMirrorSlide() {
  const transition = lastTransition;
  if (state.displayMode === 'idle') {
    return { type: 'clear', text: null, backgroundPath: null, logoPath: null, copyright: null, sectionLabel: null, transition };
  }
  if (state.displayMode === 'cleared') {
    return { type: 'clear', text: null, backgroundPath: state.livePayload?.backgroundPath ?? null, logoPath: null, copyright: null, sectionLabel: null, transition };
  }
  if (state.displayMode === 'logo') {
    let logoScaleMode = 'cover';
    try {
      const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('logo_scale_mode');
      if (row) logoScaleMode = JSON.parse(row.value);
    } catch { /* default cover */ }
    // The mirror uses the global logo (no per-channel override).
    return { type: 'logo', logoPath: resolveLogo({}), logoScaleMode, text: null, backgroundPath: null, copyright: null, sectionLabel: null, transition };
  }
  // content
  return { ...state.livePayload, type: 'content', transport: { ...transport }, transition, ltFontScale: ltFontScaleFraction() };
}

function emitProgramChange(delta) {
  if (!remoteProgramCb) return;
  try { remoteProgramCb(delta); } catch {}
}

// Current full program frame for a viewer that just connected.
export function getProgramSnapshot() {
  if (mirrorOverlay == null) mirrorOverlay = overlayForKind('screen');
  if (mirrorTransport == null) mirrorTransport = { ...transport };
  return { slide: mirrorSlide, transport: mirrorTransport, overlay: mirrorOverlay };
}

export function setRemoteProgramListener(cb) {
  remoteProgramCb = cb;
}

export function go(payload) {
  // Stamp a fresh transport so every output window — and the operator preview —
  // derive the same playhead from the shared machine clock (no skew, no capture).
  if (payload && payload.media) {
    transport = {
      active: true,
      startAt: Date.now(),
      pausedAt: null,
      loop: !!payload.media.loop,
      muted: false,          // new clip starts audible; operator can mute live
      rate: 1,               // every new clip starts at normal speed
    };
    payload.mediaStartAt = transport.startAt; // kept for backward-compat consumers
  } else {
    transport = { active: false, startAt: 0, pausedAt: null, loop: false, muted: false, rate: 1 };
  }
  state.livePayload = payload;
  state.displayMode = 'content';
  state.preLogoMode = null;
  pendingTransition = transitionFor('slide');
  sendCurrentState();
  broadcastTransport();
  notifyMainWindow('output:state-changed', getState());
}

// Toggle: content ↔ cleared (background stays, text hidden).
export function clear() {
  if (state.displayMode === 'idle') return;

  if (state.displayMode === 'content') {
    state.displayMode = 'cleared';
  } else if (state.displayMode === 'cleared') {
    state.displayMode = 'content';
  } else if (state.displayMode === 'logo') {
    // Exit logo, land on cleared.
    state.displayMode = 'cleared';
    state.preLogoMode = null;
  }

  pendingTransition = transitionFor('clear');
  sendCurrentState();
  notifyMainWindow('output:state-changed', getState());
}

// Toggle: current mode ↔ logo.
export function logo() {
  if (state.displayMode === 'logo') {
    state.displayMode = state.preLogoMode ?? 'idle';
    state.preLogoMode = null;
  } else {
    state.preLogoMode = state.displayMode;
    state.displayMode = 'logo';
  }

  pendingTransition = transitionFor('logo');
  sendCurrentState();
  notifyMainWindow('output:state-changed', getState());
}

export function shortcut(direction) {
  notifyMainWindow(direction === 'next' ? 'shortcut:next' : 'shortcut:prev');
}

// Broadcast the current transport to every output window (screen, NDI, stage)
// and to the operator renderer. Using the windows Map directly ensures stage
// windows are never excluded. Every player derives its playhead from this.
function broadcastTransport() {
  const snapshot = { ...transport };
  for (const [, win] of windows) {
    try { if (!win.isDestroyed()) win.webContents.send('media:transport', snapshot); } catch {}
  }
  if (streamWin && !streamWin.isDestroyed()) {
    try { streamWin.webContents.send('media:transport', snapshot); } catch {}
  }
  mirrorTransport = snapshot;
  emitProgramChange({ transport: snapshot });
  notifyMainWindow('output:media-transport', snapshot);
}

// ── In-room program audio output device ──────────────────────────────────────
// Which physical output device the audible program audio plays through. One
// global descriptor (the architecture guarantees a single primary audio monitor);
// null = system default. Stored as {deviceId,label,groupId}; the template matches
// it back to a live device (deviceId → label → groupId) because device IDs are
// salted per-origin.
export function getProgramAudioDevice() {
  return getSetting('program_audio_device') || null;
}

export function setProgramAudioDevice(device) {
  const snapshot = device || null;
  setSetting('program_audio_device', snapshot);
  // Push to every open output window so a live change applies without re-GO.
  for (const [, win] of windows) {
    try { if (!win.isDestroyed()) win.webContents.send('audio:output-device', snapshot); } catch {}
  }
  return snapshot;
}

// ── Program-audio tap → NDI audio + RTMP audio ───────────────────────────────
// One Web Audio tap in the primary audio window feeds both NDI audio and the
// stream. Decide whether it needs to run, and which NDI channels want audio.
function updateAudioTapState() {
  const db = getDb();
  let ndiCh = [];
  try {
    ndiCh = db.prepare("SELECT id, ndi_audio_muted FROM output_channels WHERE active = 1 AND type = 'ndi'").all();
  } catch { ndiCh = []; }
  audioEnabledNdi = new Set(
    ndiCh.filter((c) => c.ndi_audio_muted === 0 && windows.has(`ndi-${c.id}`)).map((c) => c.id),
  );
  // The in-room tap now feeds NDI ONLY. Stream audio diverges from in-room audio:
  // it is the EXTERNAL feed (+ optional Cue media), tapped inside the stream window
  // itself (stream-feed.js → ingestStreamAudioPcm), never this in-room program tap.
  const needed = audioEnabledNdi.size > 0;
  // Broadcast to every output window; only the audible (primary) one taps.
  for (const [, win] of windows) {
    try { if (!win.isDestroyed()) win.webContents.send('audio:tap', needed); } catch {}
  }
}

// Split a batched planar Float32 PCM frame ([ch0 samples…, ch1 samples…]) into its
// two channel views, normalised to stereo. Returns null when there is nothing to do.
function splitStereo(arrayBuffer, meta) {
  if (!arrayBuffer || !meta) return null;
  const channels = meta.channels || 1;
  const samples = meta.samples || 0;
  if (samples <= 0) return null;
  const sampleRate = meta.sampleRate || 48000;
  const all = new Float32Array(arrayBuffer);
  const ch0 = all.subarray(0, samples);
  const ch1 = channels >= 2 ? all.subarray(samples, samples * 2) : ch0;
  return { ch0, ch1, samples, sampleRate };
}

// Receive a batched PCM frame from the primary IN-ROOM audio window's tap and fan it
// out to the NDI sender(s). Stream audio is handled separately (ingestStreamAudioPcm).
export function ingestAudioPcm(arrayBuffer, meta) {
  if (audioEnabledNdi.size === 0) return;
  const f = splitStereo(arrayBuffer, meta);
  if (!f) return;
  // Planar Float32 (FLTp), stereo.
  const planar = Buffer.allocUnsafe(f.samples * 2 * 4);
  Buffer.from(f.ch0.buffer, f.ch0.byteOffset, f.samples * 4).copy(planar, 0);
  Buffer.from(f.ch1.buffer, f.ch1.byteOffset, f.samples * 4).copy(planar, f.samples * 4);
  for (const id of audioEnabledNdi) ndi.sendAudio(id, planar, f.sampleRate, 2, f.samples);
}

// Receive a batched PCM frame from the STREAM window's own tap (external audio input
// + optional Cue media, mixed in stream-feed.js) and write it to the RTMP encoder.
// This is the stream's audio source — independent of the in-room program audio.
export function ingestStreamAudioPcm(arrayBuffer, meta) {
  if (!rtmp.isActive()) return;
  const f = splitStereo(arrayBuffer, meta);
  if (!f) return;
  // Interleaved f32le, stereo.
  const inter = Buffer.allocUnsafe(f.samples * 2 * 4);
  for (let i = 0; i < f.samples; i++) {
    inter.writeFloatLE(f.ch0[i], i * 8);
    inter.writeFloatLE(f.ch1[i], i * 8 + 4);
  }
  rtmp.writeAudio(inter);
}

// Relay stereo peak levels (0..1) from the stream window's meter to the Stream tab.
export function ingestStreamLevels(lv) {
  notifyMainWindow('output:stream-levels', lv || { l: 0, r: 0 });
}

// ── Stream studio (external feed + composited Cue program → RTMP) ─────────────
// The stream is its OWN program: an offscreen window composites an external video
// feed (capture device) with Cue's program + stream-targeted graphics, and taps an
// external audio interface (+ optional Cue media) for the encoder. The compositor
// window runs for PREVIEW while a Stream tab is open; ffmpeg only spawns at Go Live.
const STREAM_DEFAULTS = {
  server: '', key: '', width: 1920, height: 1080, fps: 30,
  videoBitrate: '4500k', audioBitrate: '160k',
};
// ── Stream layout model ───────────────────────────────────────────────────────
// A layout is a free-form composition of two boxes — the external camera/mixer FEED
// and the Cue PROGRAM (background + lyrics/content) — over a black backdrop. Boxes are
// in PERCENT of the 16:9 frame; `front` decides z-order when they overlap; `fit` is the
// feed's object-fit. This one model expresses every arrangement (fullscreen feed,
// fullscreen program, PiP either way, side-by-side, top/bottom split, custom). Presets
// are named snapshots of this layout (stored separately in `stream_presets`).
const DEFAULT_LAYOUT = {
  feed:    { visible: true,  x: 0, y: 0, w: 100, h: 100, fit: 'cover' },   // fit: cover|contain
  program: { visible: false, x: 0, y: 0, w: 100, h: 100, fit: 'fit' },     // fit: fit|fill
  front: 'program',
  lyricsOverFeed: false,
};
const clampPct = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : d; };
function normBox(b, def) {
  b = b || {};
  return { x: clampPct(b.x, def.x), y: clampPct(b.y, def.y), w: clampPct(b.w, def.w || 100), h: clampPct(b.h, def.h || 100) };
}
// Accept the new box model OR migrate the legacy {mode,lyricsOverFeed,pip} shape.
function normalizeLayout(L) {
  L = L || {};
  if (L.mode || L.pip) { // legacy → box model
    const pip = L.pip || { which: 'feed', x: 66, y: 4, w: 30, h: 30 };
    const lof = !!L.lyricsOverFeed;
    if (L.mode === 'program') return { ...DEFAULT_LAYOUT, feed: { ...DEFAULT_LAYOUT.feed, visible: false }, program: { ...DEFAULT_LAYOUT.program, visible: true }, front: 'program', lyricsOverFeed: false };
    if (L.mode === 'pip') {
      const inset = normBox(pip, { x: 66, y: 4, w: 30, h: 30 });
      if (pip.which === 'program') // feed full base, program inset
        return { feed: { ...DEFAULT_LAYOUT.feed, visible: true }, program: { ...DEFAULT_LAYOUT.program, visible: true, ...inset }, front: 'program', lyricsOverFeed: false };
      // program full base, feed inset
      return { feed: { ...DEFAULT_LAYOUT.feed, visible: true, ...inset }, program: { ...DEFAULT_LAYOUT.program, visible: true }, front: 'feed', lyricsOverFeed: false };
    }
    // 'feed'
    return { ...DEFAULT_LAYOUT, feed: { ...DEFAULT_LAYOUT.feed, visible: true }, program: { ...DEFAULT_LAYOUT.program, visible: false }, lyricsOverFeed: lof };
  }
  const F = L.feed || {}, P = L.program || {};
  return {
    feed:    { visible: F.visible !== false, ...normBox(F, DEFAULT_LAYOUT.feed), fit: F.fit === 'contain' ? 'contain' : 'cover' },
    program: { visible: !!P.visible, ...normBox(P, DEFAULT_LAYOUT.program), fit: P.fit === 'fill' ? 'fill' : 'fit' },
    front: L.front === 'feed' ? 'feed' : 'program',
    lyricsOverFeed: !!L.lyricsOverFeed,
  };
}

const STREAM_STUDIO_DEFAULTS = {
  // Labels accompany the ids because deviceIds are salted per-origin — the compositor
  // window resolves the chosen device by label (see stream-feed.js).
  videoDeviceId: null, videoLabel: null, audioDeviceId: null, audioLabel: null,
  audioMode: 'external', // 'external' | 'mixed'
  layout: DEFAULT_LAYOUT,
};

export function getStreamConfig() {
  return { ...STREAM_DEFAULTS, ...(getSetting('stream_config') || {}) };
}
export function setStreamConfig(cfg) {
  const prev = getStreamConfig();
  const merged = { ...prev, ...(cfg || {}) };
  setSetting('stream_config', merged);
  // A resolution/fps change must resize the offscreen surface. Recreate the preview
  // window when it's up and idle so the monitor (and a subsequent Go Live) matches.
  const dimsChanged = merged.width !== prev.width || merged.height !== prev.height || merged.fps !== prev.fps;
  if (dimsChanged && !streaming && streamWin && !streamWin.isDestroyed()) {
    stopStreamCapture();
    try { streamWin.close(); } catch {}
    streamWin = null;
    if (streamPreviewRefCount > 0) prepareStream();
  }
  return merged;
}

export function getStreamStudio() {
  const s = getSetting('stream_studio') || {};
  return { ...STREAM_STUDIO_DEFAULTS, ...s, layout: normalizeLayout(s.layout) };
}
// Merge & persist a partial studio config (input device / audio mode / layout), then
// push it live to the open compositor window. A `layout` patch REPLACES the whole
// layout (it's the free-form box model — partial layer merges would orphan stale boxes);
// callers send the complete layout object.
export function setStreamStudio(cfg) {
  const cur = getStreamStudio();
  const merged = { ...cur, ...(cfg || {}) };
  if (cfg && cfg.layout) merged.layout = normalizeLayout(cfg.layout);
  setSetting('stream_studio', merged);
  pushStreamConfig();
  return merged;
}

// ── Stream layout presets ─────────────────────────────────────────────────────
// Named snapshots of a layout. Stored as an array in settings; applying one copies its
// layout into the live studio layout via setStreamStudio.
export function getStreamPresets() {
  const arr = getSetting('stream_presets');
  return Array.isArray(arr) ? arr.map((p) => ({ id: p.id, name: p.name, layout: normalizeLayout(p.layout) })) : [];
}
export function saveStreamPreset(preset) {
  preset = preset || {};
  const list = getStreamPresets();
  const id = preset.id || `lp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const entry = { id, name: String(preset.name || 'Untitled').slice(0, 60), layout: normalizeLayout(preset.layout) };
  const idx = list.findIndex((p) => p.id === id);
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  setSetting('stream_presets', list);
  return { presets: list, id };
}
export function deleteStreamPreset(id) {
  const list = getStreamPresets().filter((p) => p.id !== id);
  setSetting('stream_presets', list);
  return list;
}

export function getStreamStatus() {
  return { active: streaming, previewing: !!(streamWin && !streamWin.isDestroyed()), ...rtmp.getStatus() };
}

function emitStreamStatus(s) {
  notifyMainWindow('stream:status', { active: streaming, ...(s || {}) });
}

// Push current input selection + layout to the offscreen compositor window.
function pushStreamConfig() {
  if (!streamWin || streamWin.isDestroyed()) return;
  const s = getStreamStudio();
  try {
    streamWin.webContents.send('stream:input', {
      videoDeviceId: s.videoDeviceId, videoLabel: s.videoLabel,
      audioDeviceId: s.audioDeviceId, audioLabel: s.audioLabel,
      audioMode: s.audioMode,
    });
    streamWin.webContents.send('stream:layout', s.layout);
  } catch {}
}

// Open the offscreen compositor for preview/encoding (idempotent, NO ffmpeg).
export function prepareStream() {
  if (streamWin && !streamWin.isDestroyed()) return { ok: true };
  const cfg = getStreamConfig();
  streamWin = createStreamWindow({ width: cfg.width, height: cfg.height, fps: cfg.fps || 30 });
  return { ok: true };
}

// macOS gates camera/mic behind TCC. An offscreen window's getUserMedia never surfaces
// the system prompt, so request access from MAIN (with the Info.plist usage strings) —
// once granted, the compositor window's getUserMedia succeeds. No-op off macOS / when
// already determined.
async function ensureMediaAccess() {
  if (process.platform !== 'darwin' || !systemPreferences.askForMediaAccess) return;
  for (const type of ['camera', 'microphone']) {
    try {
      if (systemPreferences.getMediaAccessStatus(type) !== 'granted') {
        await systemPreferences.askForMediaAccess(type);
      }
    } catch {}
  }
}

// Ref-counted by the Stream tab: while open, the compositor window stays alive so the
// operator can configure inputs and watch the live preview before going live.
export async function openStreamStudio() {
  streamPreviewRefCount++;
  await ensureMediaAccess(); // prompt for camera/mic before the offscreen window taps them
  prepareStream();
  return getStreamStudio();
}
export function closeStreamStudio() {
  streamPreviewRefCount = Math.max(0, streamPreviewRefCount - 1);
  maybeTeardownStream();
}
// Tear the compositor down only when nothing needs it (not live AND no tab open).
function maybeTeardownStream() {
  if (streaming || streamPreviewRefCount > 0) return;
  stopStreamCapture();
  if (streamWin && !streamWin.isDestroyed()) { try { streamWin.close(); } catch {} }
  streamWin = null;
}

export async function startStream() {
  const cfg = getStreamConfig();
  if (!cfg.server || !cfg.key) return { ok: false, error: 'Stream server and key are required' };
  if (streaming) return { ok: false, error: 'already streaming' };

  // ffmpeg is only fetched on first YouTube use — make sure it exists.
  emitStreamStatus({ state: 'starting', detail: 'preparing encoder' });
  const ready = await ensureBinaries();
  if (!ready.ok) {
    emitStreamStatus({ state: 'error', detail: ready.error || 'ffmpeg unavailable' });
    return { ok: false, error: ready.error || 'ffmpeg unavailable' };
  }

  prepareStream(); // ensure the compositor window + capture loop exist
  const url = `${String(cfg.server).replace(/\/+$/, '')}/${cfg.key}`;
  streamEncodeConfig = {
    url, fps: cfg.fps || 30,
    videoBitrate: cfg.videoBitrate, audioBitrate: cfg.audioBitrate,
    width: cfg.width, height: cfg.height,
  };
  streaming = true; // the capture loop spawns ffmpeg on the next paint
  // Enable the stream window's own audio tap (external feed + optional Cue media).
  try { streamWin?.webContents.send('stream:audio-tap', true); } catch {}
  return { ok: true };
}

export async function stopStream() {
  if (!streaming && !rtmp.isActive()) { maybeTeardownStream(); return { ok: true }; }
  streaming = false;
  streamEncodeConfig = null;
  try { if (streamWin && !streamWin.isDestroyed()) streamWin.webContents.send('stream:audio-tap', false); } catch {}
  await rtmp.stop();
  emitStreamStatus({ state: 'idle', detail: null });
  maybeTeardownStream(); // keep the window if a Stream tab is still previewing
  return { ok: true };
}

function createStreamWindow(config) {
  const preload = getOutputPreloadPath();
  const win = new BrowserWindow({
    width: config.width || 1920,
    height: config.height || 1080,
    show: false,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      offscreen: true, preload, contextIsolation: true, nodeIntegration: false,
      sandbox: false, autoplayPolicy: 'no-user-gesture-required',
      // The window is never shown, so Chromium treats it as hidden and throttles its
      // timers + media (the camera <video> stutters/freezes, esp. once the operator
      // switches tabs). Disable throttling so the feed keeps rendering at full rate —
      // essential for a live broadcast that must survive leaving the Stream tab.
      backgroundThrottling: false,
    },
  });
  // stream=1 turns on the compositor (external feed base + Cue program + PiP/cut).
  // mute=1: locally silent; its audio is its OWN tap (external feed + Cue media),
  // never the in-room program tap. program+graphics on = full Cue program available.
  win.loadFile(getTemplatePath('fullscreen'), { query: { mute: '1', program: '1', graphics: '1', stream: '1' } });
  win.webContents.once('did-finish-load', () => {
    sendStateToWindow(win, {});            // sync the current Cue program
    sendGraphicToWindow(win, 'stream');    // stream-targeted broadcast graphics
    pushStreamConfig();                    // input devices + layout
    startStreamCapture(win, config);
    if (streaming) { try { win.webContents.send('stream:audio-tap', true); } catch {} }
  });
  win.on('closed', () => { if (win === streamWin) streamWin = null; });
  return win;
}

function startStreamCapture(win, config) {
  const fps = config.fps || 30;
  const frameMs = Math.round(1000 / fps);
  win.webContents.setFrameRate(fps);
  win.webContents.startPainting();

  // The 'paint' event only fires when the offscreen compositor produces a new frame —
  // a largely-static scene coalesces paints, so feeding ffmpeg straight from 'paint'
  // delivers fewer than `fps` frames with gaps, which starves YouTube ("not receiving
  // enough video" → viewer buffering). Instead we cache the LATEST painted frame and
  // pump it to the encoder at a STEADY fps from a timer, duplicating the last frame
  // when no new paint arrived → true CFR, no starvation.
  let lastBitmap = null;   // Buffer (BGRA) — copied in onPaint so it stays valid
  let lastImage = null;    // NativeImage for preview resize (best-effort)
  let lastW = 0, lastH = 0;
  let rtmpReady = false;
  let rtmpStarting = false;
  let lastPreviewAt = 0;
  let lastHealthAt = 0;
  // Stream-tab PREVIEW thumbnail only — the live stream is the full-resolution buffer
  // at the target fps/bitrate, so preview sharpness does NOT reflect stream quality.
  const PREVIEW_MS = 100;
  const PREVIEW_W = 1280;

  const onPaint = (_e, _dirty, image) => {
    const { width, height } = image.getSize();
    if (width <= 0 || height <= 0) return;
    lastImage = image; lastW = width; lastH = height;
    try { lastBitmap = image.toBitmap(); } catch {}
  };
  win.webContents.on('paint', onPaint);

  const tick = async () => {
    if (win.isDestroyed()) return;
    win.webContents.invalidate(); // request the next paint (refreshes lastBitmap)
    if (!lastBitmap) return;

    if (streaming && streamEncodeConfig) {
      // Spawn ffmpeg on the FIRST real frame so -video_size matches the actual surface.
      if (!rtmpReady && !rtmpStarting) {
        rtmpStarting = true;
        const res = await rtmp.start(
          { ...streamEncodeConfig, width: lastW, height: lastH, sampleRate: 48000, channels: 2 },
          (s) => emitStreamStatus(s),
        );
        rtmpStarting = false;
        rtmpReady = !!res.ok;
      }
      if (rtmpReady) rtmp.writeVideo(lastBitmap); // every tick → steady CFR to YouTube
    } else {
      rtmpReady = false; // reset so a subsequent Go Live re-spawns the encoder
    }

    const now = Date.now();
    // Push stream health (dropped/sent frame counts) once a second so the Stream tab
    // can show whether the connection/encoder is keeping up.
    if (streaming && rtmpReady && now - lastHealthAt >= 1000) {
      lastHealthAt = now;
      emitStreamStatus(rtmp.getStatus());
    }
    if (streamPreviewRefCount > 0 && now - lastPreviewAt >= PREVIEW_MS && lastImage) {
      lastPreviewAt = now;
      try {
        const small = lastImage.resize({ width: PREVIEW_W });
        notifyMainWindow('output:stream-preview', `data:image/jpeg;base64,${small.toJPEG(82).toString('base64')}`);
      } catch {}
    }
  };

  const timer = setInterval(tick, frameMs);
  streamCapture = { win, onPaint, timer };
}

function stopStreamCapture() {
  if (!streamCapture) return;
  clearInterval(streamCapture.timer);
  if (streamCapture.win && !streamCapture.win.isDestroyed()) {
    try {
      streamCapture.win.webContents.off('paint', streamCapture.onPaint);
      streamCapture.win.webContents.stopPainting();
    } catch {}
  }
  streamCapture = null;
}

// Transport command from the operator: play / pause / restart.
export function mediaControl(action) {
  if (!transport.active) return;
  const now = Date.now();
  if (action === 'pause') {
    if (transport.pausedAt == null) transport.pausedAt = now;
  } else if (action === 'play') {
    if (transport.pausedAt != null) {
      transport.startAt += now - transport.pausedAt; // keep elapsed continuous
      transport.pausedAt = null;
    }
  } else if (action === 'restart') {
    transport.startAt = now;
    transport.pausedAt = null;
  }
  broadcastTransport();
}

// Scrub to an absolute position (seconds). Preserves the paused state.
export function mediaSeek(pos) {
  if (!transport.active || !Number.isFinite(pos)) return;
  const now = Date.now();
  const rate = transport.rate || 1;
  transport.startAt = now - (pos / rate) * 1000;
  if (transport.pausedAt != null) transport.pausedAt = now;
  broadcastTransport();
}

// Toggle program (audience) audio. Stage + operator preview stay silent always.
export function mediaSetMuted(muted) {
  transport.muted = !!muted;
  broadcastTransport();
}

// Toggle native looping live, without restarting the clip. Output players read
// transport.loop and update the <video> loop attribute in place (see media-player.js).
export function mediaSetLoop(loop) {
  if (!transport.active) return;
  transport.loop = !!loop;
  broadcastTransport();
}

// Operator playback speed. Rebase startAt so the CURRENT position is continuous
// across the rate change (no jump), then every player adopts the new baseline rate.
export function mediaSetRate(rate) {
  if (!transport.active) return;
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return;
  const now = Date.now();
  const ref = transport.pausedAt != null ? transport.pausedAt : now;
  const oldRate = transport.rate || 1;
  transport.startAt = ref - (ref - transport.startAt) * (oldRate / r);
  transport.rate = r;
  broadcastTransport();
}

// Re-open all active channel windows (used when toggling outputs back on).
async function reopenAllChannels() {
  const db = getDb();
  const channels = db.prepare('SELECT * FROM output_channels WHERE active = 1').all();
  for (const channel of channels) {
    if (channel.type === 'ndi') {
      const key = `ndi-${channel.id}`;
      if (!windows.has(key)) {
        const win = createNdiWindow(channel);
        if (win) windows.set(key, win);
      }
      continue;
    }
    const monitors = db
      .prepare('SELECT * FROM channel_monitors WHERE channel_id = ? AND active = 1')
      .all(channel.id);
    for (const monitor of monitors) {
      if (!windows.has(monitor.id)) {
        const win = createMonitorWindow(channel, monitor);
        if (win) windows.set(monitor.id, win);
      }
    }
  }
  updateAudioTapState();
}

// Toggle all output BrowserWindows on or off.
export async function setOutputsEnabled(enabled) {
  if (outputsEnabled === enabled) return;
  outputsEnabled = enabled;

  // Push the flag change immediately so listeners (operator UI, network remote)
  // reflect it without waiting for the window open/close work below — opening
  // BrowserWindows is slow and would otherwise make the indicator feel laggy.
  notifyMainWindow('output:state-changed', getState());

  if (!enabled) {
    for (const [key, win] of windows) {
      if (typeof key === 'string' && key.startsWith('ndi-')) {
        stopNdiCapture(parseInt(key.slice(4)));
      }
      if (win && !win.isDestroyed()) win.close();
    }
    windows.clear();
  } else {
    await reopenAllChannels();
    // Restore current display mode on newly opened windows.
    if (state.displayMode !== 'idle') sendCurrentState();
  }

  notifyMainWindow('output:state-changed', getState());
}

export function getState() {
  return {
    isLive: state.displayMode !== 'idle',
    displayMode: state.displayMode,
    livePayload: state.livePayload,
    activeWindows: windows.size,
    activeChannels: [...windows.keys()],
    outputsEnabled,
    transport: { ...transport },
    overlay: { ...overlay },
  };
}

export function setMainWindow(win) {
  mainWindowRef = win;
}

export function setRemoteStateListener(cb) {
  remoteStateCb = cb;
}

function resolveLogo(channel) {
  const db = getDb();
  if (channel.logo_override_id) {
    const a = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(channel.logo_override_id);
    if (a) return a.path;
  }
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('global_logo_id');
  if (setting) {
    const mediaId = JSON.parse(setting.value);
    const a = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(mediaId);
    if (a) return a.path;
  }
  return null;
}

// Flat background cascade: lock → slot override → song default → live global → black.
// (Renderer OperatorView.resolveBackground is the live source of truth; this mirror
// keeps the exported helper honest.)
export function resolveBackground(item) {
  const db = getDb();
  const pathOf = (id) => {
    if (!id) return null;
    const a = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id);
    return a ? a.path : null;
  };
  // Locked song: its own default is pinned above everything (override + global ignored).
  if (item.item_type === 'song' && item.song?.background_locked) {
    return pathOf(item.song.default_background_id);
  }
  if (item.background_override_id) return pathOf(item.background_override_id);
  if (item.item_type === 'song' && item.song?.default_background_id) {
    const p = pathOf(item.song.default_background_id);
    if (p) return p;
    // fall through to the live global below
  }
  if (item.item_type === 'song') {
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('global_bg_song_id');
    if (setting) return pathOf(JSON.parse(setting.value));
  }
  return null;
}

function getAllStageWindows() {
  // Detect by loaded URL rather than DB template value — avoids misses from
  // type coercion, stale cache, or windows opened before the template column
  // was set correctly.
  const wins = [];
  for (const [, win] of windows) {
    if (!win || win.isDestroyed()) continue;
    try {
      if (win.webContents.getURL().includes('stage.html')) wins.push(win);
    } catch {}
  }
  return wins;
}

function sendStageState(win, channel) {
  win.webContents.send('stage:timer',    { ...stageState.timer });
  win.webContents.send('stage:message',  { text: stageState.message });
  win.webContents.send('stage:schedule', { scheduled: stageState.scheduled });
  // Per-channel layout — the window builds its DOM from this. NULL column → default.
  if (channel) {
    const layout = getStageLayout(channel.id);
    win.webContents.send('stage:layout', { channelId: channel.id, elements: layout.elements });
  }
}

// Push the scheduled-message list to every stage window AND the operator (so its
// pending list stays live). The anchors are absolute — windows tick them locally.
function broadcastStageSchedule() {
  for (const win of getAllStageWindows()) {
    win.webContents.send('stage:schedule', { scheduled: stageState.scheduled });
  }
  notifyMainWindow('stage:schedule', { scheduled: stageState.scheduled });
}

// Drop messages whose clearAt has passed (keeps the operator's pending list tidy).
// Driven by a single setTimeout aimed at the next boundary — event-driven, never
// a per-second poll.
function pruneStageSchedule() {
  const before = stageState.scheduled.length;
  stageState.scheduled = pruneExpired(stageState.scheduled, Date.now());
  if (stageState.scheduled.length !== before) broadcastStageSchedule();
  scheduleNextStagePrune();
}

function scheduleNextStagePrune() {
  if (stagePruneTimer) { clearTimeout(stagePruneTimer); stagePruneTimer = null; }
  const delay = nextPruneDelay(stageState.scheduled, Date.now());
  if (delay == null) return;
  stagePruneTimer = setTimeout(pruneStageSchedule, Math.max(250, delay));
}

export function getStageSchedule() {
  return stageState.scheduled;
}

// Schedule a timed message. `afterSeconds` → countdown from now; `atHour`/`atMinute`
// → next occurrence of that wall-clock time; `clearAfter` (seconds) → auto-clear that
// long after it appears. Main resolves the absolute showAt/clearAt once here.
export function scheduleStageMessage({ text, afterSeconds, atHour, atMinute, clearAfter } = {}) {
  const t = (text ?? '').trim();
  if (!t) return stageState.scheduled;
  const { showAt, clearAt } = resolveAnchors({ afterSeconds, atHour, atMinute, clearAfter }, Date.now());
  const entry = { id: stageScheduleSeq++, text: t, showAt, clearAt };
  stageState.scheduled = [...stageState.scheduled, entry].sort((a, b) => a.showAt - b.showAt);
  broadcastStageSchedule();
  scheduleNextStagePrune();
  return stageState.scheduled;
}

export function unscheduleStageMessage(id) {
  stageState.scheduled = stageState.scheduled.filter((m) => m.id !== id);
  broadcastStageSchedule();
  scheduleNextStagePrune();
  return stageState.scheduled;
}

export function setStageMessage(text) {
  stageState.message = text ?? '';
  for (const win of getAllStageWindows()) {
    win.webContents.send('stage:message', { text: stageState.message });
  }
}

// Persist the global lower-third font scale (percent) and push it live so any
// on-air lower-third updates immediately with no reload. fullscreen output is
// unaffected (it ignores `ltFontScale`).
export function setLowerthirdFontScale(pct) {
  const n = Math.max(1, Math.min(150, Math.round(Number(pct) || 100)));
  lowerthirdFontScale = n;
  try {
    getDb().prepare(
      'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
    ).run('lowerthird_font_scale', JSON.stringify(n));
  } catch {}
  // Re-broadcast the current slide (no transition) so live L3 windows re-style now.
  if (state.displayMode === 'content' && state.livePayload) {
    for (const win of getAllOutputWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('slide:update', {
        ...state.livePayload, type: 'content',
        transport: { ...transport }, transition: { type: 'none' },
        ltFontScale: ltFontScaleFraction(),
      });
    }
  }
  return n;
}

export function stageTimerCmd(action, seconds) {
  const t = stageState.timer;
  if (action === 'set') {
    t.totalSeconds     = seconds;
    t.remainingSeconds = seconds;
    t.running          = false;
    t.startedAt        = null;
  } else if (action === 'start') {
    if (!t.running) {
      t.startedAt = Date.now();
      t.running   = true;
    }
  } else if (action === 'pause') {
    if (t.running && t.startedAt) {
      const elapsed = (Date.now() - t.startedAt) / 1000;
      t.remainingSeconds = Math.max(0, t.remainingSeconds - elapsed);
      t.running   = false;
      t.startedAt = null;
    }
  } else if (action === 'reset') {
    t.remainingSeconds = t.totalSeconds;
    t.running          = false;
    t.startedAt        = null;
  }
  for (const win of getAllStageWindows()) {
    win.webContents.send('stage:timer', { ...t });
  }
}

// ── Stage display layout (per-channel) + presets ──────────────────────────────
// The stage/confidence monitor is a free-form set of positioned elements (each box in
// PERCENT of a 1920×1080 frame). Each channel of template 'stage' carries its own layout
// in output_channels.stage_layout_json (NULL → the built-in default below, which
// reproduces the previous fixed look so existing stage channels are visually unchanged).
// Reusable named layouts live in the `stage_presets` setting. Clock/timer/elapsed/video/
// message elements tick LOCALLY in the output template (resolved against Date.now()) — no
// per-second IPC. Same WYSIWYG-box discipline as the stream layout above.
// Insets ~2.5% from the frame edges with ~1.5% gutters between elements, so a fresh
// stage channel looks intentional (not full-bleed). Mirrors the "Classic" template in
// StageLayoutEditor.jsx — keep the two in sync.
const DEFAULT_STAGE_LAYOUT = {
  elements: [
    { id: 'clock',   type: 'clock',          x: 2.5, y: 2.5,  w: 30.5, h: 12, hour12: true, showSeconds: true },
    { id: 'timer',   type: 'timer',          x: 34.5, y: 2.5, w: 31,   h: 12, showBar: true },
    { id: 'video',   type: 'videoCountdown', x: 67,  y: 2.5,  w: 30.5, h: 12 },
    { id: 'current', type: 'currentText',    x: 2.5, y: 16,   w: 95,   h: 54, align: 'center', color: '#ffffff', fit: 'auto', showRef: true },
    { id: 'next',    type: 'nextText',       x: 2.5, y: 71.5, w: 95,   h: 14, color: 'rgba(255,255,255,0.4)' },
    { id: 'message', type: 'message',        x: 2.5, y: 87.5, w: 95,   h: 10, align: 'center' },
  ],
};
const STAGE_ELEMENT_TYPES = new Set(['currentText', 'nextText', 'clock', 'timer', 'elapsedTimer', 'videoCountdown', 'message', 'staticText']);
let stageElSeq = 1;
function normStageElement(e) {
  if (!e || !STAGE_ELEMENT_TYPES.has(e.type)) return null;
  const box = normBox(e, { x: 0, y: 0, w: 30, h: 12 });
  const out = { id: typeof e.id === 'string' && e.id ? e.id : `el_${Date.now()}_${stageElSeq++}`, type: e.type, ...box };
  const S = (v, d) => (typeof v === 'string' ? v : d);
  const B = (v, d) => (typeof v === 'boolean' ? v : d);
  const N = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const A = (v) => (['left', 'center', 'right'].includes(v) ? v : 'center');
  out.align = A(e.align); // alignment is a universal control on every element
  switch (e.type) {
    case 'currentText':
      out.color = S(e.color, '#ffffff');
      out.fit = e.fit === 'fixed' ? 'fixed' : 'auto'; out.fontPx = N(e.fontPx, 88); out.showRef = B(e.showRef, true);
      break;
    case 'nextText':
      out.label = S(e.label, ''); out.color = S(e.color, 'rgba(255,255,255,0.4)'); out.fontPx = N(e.fontPx, 26);
      break;
    case 'clock':
      out.label = S(e.label, ''); out.hour12 = B(e.hour12, true); out.showSeconds = B(e.showSeconds, true);
      break;
    case 'timer':
      out.label = S(e.label, ''); out.showBar = B(e.showBar, true);
      break;
    case 'elapsedTimer':
      out.label = S(e.label, '');
      break;
    case 'videoCountdown':
      out.label = S(e.label, '');
      break;
    case 'message':
      break;
    case 'staticText':
      out.text = S(e.text, 'Text'); out.color = S(e.color, '#e2e2e8'); out.fontPx = N(e.fontPx, 32);
      break;
  }
  return out;
}
function normalizeStageLayout(L) {
  const src = (L && Array.isArray(L.elements)) ? L.elements : DEFAULT_STAGE_LAYOUT.elements;
  const els = src.map(normStageElement).filter(Boolean);
  return { elements: els.length ? els : DEFAULT_STAGE_LAYOUT.elements.map(normStageElement) };
}

// Resolve every open stage window belonging to a channel (screen windows are keyed by
// monitor id, NDI by `ndi-<id>` — mirror setChannelContentMode's lookup).
function getChannelStageWindows(channelId) {
  const db = getDb();
  const channel = db.prepare('SELECT * FROM output_channels WHERE id = ?').get(channelId);
  if (!channel) return [];
  const wins = [];
  if (channel.type === 'ndi') {
    const w = windows.get(`ndi-${channelId}`);
    if (w && !w.isDestroyed()) wins.push(w);
  } else {
    const monitors = db.prepare('SELECT * FROM channel_monitors WHERE channel_id = ? AND active = 1').all(channelId);
    for (const m of monitors) { const w = windows.get(m.id); if (w && !w.isDestroyed()) wins.push(w); }
  }
  return wins;
}

export function getStageLayout(channelId) {
  let parsed = null;
  try {
    const row = getDb().prepare('SELECT stage_layout_json FROM output_channels WHERE id = ?').get(channelId);
    if (row && row.stage_layout_json) parsed = JSON.parse(row.stage_layout_json);
  } catch {}
  return normalizeStageLayout(parsed);
}

export function setStageLayout(channelId, layout) {
  const norm = normalizeStageLayout(layout);
  try {
    getDb().prepare('UPDATE output_channels SET stage_layout_json = ? WHERE id = ?').run(JSON.stringify(norm), channelId);
  } catch {}
  const msg = { channelId: Number(channelId), elements: norm.elements };
  for (const win of getChannelStageWindows(channelId)) {
    try { win.webContents.send('stage:layout', msg); } catch {}
  }
  notifyMainWindow('stage:layout', msg);
  return norm;
}

export function getStagePresets() {
  const arr = getSetting('stage_presets');
  return Array.isArray(arr) ? arr.map((p) => ({ id: p.id, name: p.name, layout: normalizeStageLayout(p.layout) })) : [];
}
export function saveStagePreset(preset) {
  preset = preset || {};
  const list = getStagePresets();
  const id = preset.id || `sp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const entry = { id, name: String(preset.name || 'Untitled').slice(0, 60), layout: normalizeStageLayout(preset.layout) };
  const idx = list.findIndex((p) => p.id === id);
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  setSetting('stage_presets', list);
  return { presets: list, id };
}
export function deleteStagePreset(id) {
  const list = getStagePresets().filter((p) => p.id !== id);
  setSetting('stage_presets', list);
  return list;
}

function notifyMainWindow(channel, ...args) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, ...args);
  }
  // Mirror display-state changes to the network-control remote (reads getState itself).
  if (channel === 'output:state-changed' && remoteStateCb) {
    try { remoteStateCb(); } catch {}
  }
}

// ── Broadcast graphics overlay ────────────────────────────────────────────────
// Independent of the program slide bus. Dispatched only to lower-third windows
// (detected by loaded URL, like getAllStageWindows) so the fullscreen program is
// untouched. The operator renderer follows output:overlay-changed for live state.
//
// Each slot carries a `target` ('all' | 'screen' | 'ndi') so a graphic can be
// routed to the in-room screens, the online NDI feed, or both. Every lower-third
// window therefore receives a per-window FILTERED overlay (only the slots whose
// target matches that window's kind), not the raw overlay object.

// The overlay renders on every program output (fullscreen + lower-third), so an
// In-Room graphic overlays the main auditorium output and an Online graphic overlays
// the NDI feed. Stage/confidence monitors are excluded. Kind comes from the
// windows-map key: numeric keys are monitor windows (screen / in-room); 'ndi-…'
// keys are NDI windows (online).
function getGraphicsWindowInfos() {
  const infos = [];
  for (const [key, win] of windows) {
    if (!win || win.isDestroyed()) continue;
    try {
      const url = win.webContents.getURL();
      if (!url.includes('fullscreen.html') && !url.includes('lowerthird.html')) continue;
    } catch { continue; }
    const kind = (typeof key === 'string' && key.startsWith('ndi-')) ? 'ndi' : 'screen';
    infos.push({ win, kind });
  }
  // The stream window is its own destination kind so its overlay can be targeted
  // independently from the in-room screens and the NDI feed.
  if (streamWin && !streamWin.isDestroyed()) infos.push({ win: streamWin, kind: 'stream' });
  return infos;
}

function overlayForKind(kind) {
  return {
    nameTitle: overlay.nameTitle[kind],
    ticker:    overlay.ticker[kind],
    custom:    overlay.custom[kind],
    countdown: overlay.countdown[kind],
  };
}

// Sync one newly opened lower-third window. `kind` is known by the caller
// (createMonitorWindow → 'screen', createNdiWindow → 'ndi').
function sendGraphicToWindow(win, kind = 'screen') {
  if (win.isDestroyed()) return;
  win.webContents.send('graphic:update', overlayForKind(kind));
}

function broadcastGraphic() {
  for (const { win, kind } of getGraphicsWindowInfos()) {
    try { win.webContents.send('graphic:update', overlayForKind(kind)); } catch {}
  }
  mirrorOverlay = overlayForKind('screen');
  emitProgramChange({ overlay: mirrorOverlay });
  notifyMainWindow('output:overlay-changed', { ...overlay });
}

// A positive autoDismissSec auto-hides the graphic that many seconds after it airs;
// `dismissAt` (absolute ms) rides the slot for operator-side display only.
function dismissFields(data) {
  const sec = Number(data && data.autoDismissSec) || 0;
  return sec > 0 ? { autoDismissSec: sec, dismissAt: Date.now() + sec * 1000 } : { autoDismissSec: null, dismissAt: null };
}

export function graphicShow(data) {
  const value = data && (data.name || data.title)
    ? { id: data.id ?? null, name: data.name ?? '', title: data.title ?? '', style: data.style ?? null, target: data.target || 'all', bgPath: data.bgPath || null, bgFit: data.bgFit || null, ...dismissFields(data) }
    : null;
  setSlot('nameTitle', value, data && data.target);
  applyDismiss('nameTitle', value, value && value.autoDismissSec, data && data.target);
  broadcastGraphic();
}

export function graphicHide(target) {
  setSlot('nameTitle', null, target);
  for (const kind of kindsForTarget(target)) clearDismiss('nameTitle', kind);
  broadcastGraphic();
}

export function tickerShow(data) {
  const value = data && data.text
    ? { id: data.id ?? null, text: data.text, speed: Number.isFinite(data.speed) ? data.speed : 100, style: data.style ?? null, target: data.target || 'all', bgPath: data.bgPath || null, bgFit: data.bgFit || null, ...dismissFields(data) }
    : null;
  setSlot('ticker', value, data && data.target);
  applyDismiss('ticker', value, value && value.autoDismissSec, data && data.target);
  broadcastGraphic();
}

export function tickerHide(target) {
  setSlot('ticker', null, target);
  for (const kind of kindsForTarget(target)) clearDismiss('ticker', kind);
  broadcastGraphic();
}

export function customShow(data) {
  const value = data && data.html
    ? { id: data.id ?? null, html: String(data.html), target: data.target || 'all', bgPath: data.bgPath || null, bgFit: data.bgFit || null, ...dismissFields(data) }
    : null;
  setSlot('custom', value, data && data.target);
  applyDismiss('custom', value, value && value.autoDismissSec, data && data.target);
  broadcastGraphic();
}

export function customHide(target) {
  setSlot('custom', null, target);
  for (const kind of kindsForTarget(target)) clearDismiss('custom', kind);
  broadcastGraphic();
}

// Next epoch-ms for a wall-clock "HH:MM" today; if already past, roll to tomorrow.
function nextClockTime(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((n) => parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return Date.now();
  const t = new Date();
  t.setHours(h, m, 0, 0);
  if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

// Countdown / count-up / clock graphic. The output template owns the per-second
// tick (see graphics-overlay.js); the bus only resolves and carries the anchor
// time so a window opened mid-countdown still lands on the right value. mode:
// 'countdown' (endsAt) | 'countup' (startAt) | 'clock' (no anchor).
export function countdownShow(data) {
  if (!data || !data.mode) { setSlot('countdown', null, data && data.target); broadcastGraphic(); return; }
  const slot = {
    id:      data.id ?? null,
    mode:    data.mode,
    label:   data.label ?? '',
    endMessage: data.endMessage ?? '',
    onEnd:   data.onEnd || 'hold',
    format:  data.format || '24h',
    showSeconds: data.showSeconds !== false,
    style:   data.style ?? null,
    target:  data.target || 'all',
    bgPath:  data.bgPath || null,
    bgFit:   data.bgFit || null,
    onEndMediaId:   data.onEndMediaId || null,
    onEndMediaPath: null, // resolved below
    // Retain the authoring spec (alongside the resolved anchor below) so a Scene can
    // re-resolve the timer to a FRESH anchor on recall (a stored absolute endsAt would
    // be stale by the time the scene is applied). Ignored by the output template.
    source:      data.source ?? null,
    targetClock: data.targetClock ?? null,
    durationSec: Number.isFinite(Number(data.durationSec)) ? Number(data.durationSec) : null,
  };
  if (data.mode === 'countdown') {
    slot.endsAt = data.source === 'target'
      ? nextClockTime(data.targetClock)
      : Date.now() + Math.max(0, Number(data.durationSec) || 0) * 1000;
  } else if (data.mode === 'countup') {
    slot.startAt = Date.now();
  }
  // Resolve onEndMediaPath from the DB so the output template doesn't need DB access.
  if (slot.onEnd === 'media' && slot.onEndMediaId) {
    const row = getDb().prepare('SELECT path FROM media_assets WHERE id = ?').get(Number(slot.onEndMediaId));
    slot.onEndMediaPath = row ? row.path : null;
  }
  setSlot('countdown', slot, data.target);
  // Arm an end-action timer for countdown mode. 'hold' and 'overflow' are
  // template-only (no main-process side-effect), so only arm for the others.
  if (cdEndTimer) { clearTimeout(cdEndTimer); cdEndTimer = null; }
  if (slot.mode === 'countdown' && slot.onEnd !== 'hold' && slot.onEnd !== 'overflow') {
    const delay = slot.endsAt - Date.now();
    if (delay >= 0) {
      const capturedSlot = { ...slot };
      cdEndTimer = setTimeout(() => { cdEndTimer = null; handleCountdownEnd(capturedSlot); }, delay);
    }
  }
  broadcastGraphic();
}

function handleCountdownEnd(slot) {
  switch (slot.onEnd) {
    case 'clear':
      countdownHide(slot.target);
      break;
    case 'loop':
      // Re-fire from the same authoring spec — endsAt gets a fresh resolution.
      countdownShow(slot);
      break;
    case 'media':
      if (slot.onEndMediaPath) {
        // Transition to fullscreen media: keep the slot (so the background layer
        // stays active) but null out `mode` so the countdown text elements hide.
        // The output template and operator preview both key on mode to show text.
        setSlot('countdown', { ...slot, mode: null, bgPath: slot.onEndMediaPath, bgFit: 'cover' }, slot.target);
        broadcastGraphic();
      } else {
        countdownHide(slot.target);
      }
      break;
    default:
      break;
  }
}

export function countdownHide(target) {
  if (cdEndTimer) { clearTimeout(cdEndTimer); cdEndTimer = null; }
  setSlot('countdown', null, target);
  broadcastGraphic();
}

export function getOverlay() {
  return { ...overlay };
}

// ── Scenes — one-press multi-output state recall ──────────────────────────────
// Apply a scene (feature-roadmap #11): set every output layer the scene MANAGES to a
// defined state, atomically, in one synchronous pass — one broadcastGraphic(), one
// sendCurrentState(), one broadcastTransport() — so every output window converges
// within a single frame. `scene` is the normalized shape from db/scenes.js
// normalizeScene: { overlay, program, audioMuted }.
//   overlay     — { nameTitle, ticker, custom, countdown }, each a { screen, ndi } slot
//                 of re-fire data, or null = leave the overlay untouched.
//   program     — 'none' (leave program as-is) | 'content' | 'clear' | 'logo'.
//   audioMuted  — true | false | null (null = don't touch).
export function applyScene(scene) {
  if (!scene) return;

  // 1) Overlay slots — restore each MANAGED slot per kind. A slot key absent from the
  // snapshot is left running; present-but-null hides that kind. Countdowns re-resolve
  // to a fresh anchor (see reviveSlotValue). One broadcast for the whole overlay.
  if (scene.overlay) {
    for (const name of ['nameTitle', 'ticker', 'custom', 'countdown']) {
      if (!(name in scene.overlay)) continue;
      const slot = scene.overlay[name] || {};
      overlay[name] = {
        screen: reviveSlotValue(name, slot.screen),
        ndi:    reviveSlotValue(name, slot.ndi),
        stream: reviveSlotValue(name, slot.stream),
      };
      // Re-arm auto-dismiss against the freshly revived occupant (or disarm if none /
      // not dismissable). reviveSlotValue already re-stamped a fresh dismissAt.
      if (name !== 'countdown') {
        for (const kind of OVERLAY_KINDS) {
          const v = overlay[name][kind];
          armDismiss(name, kind, v && v.autoDismissSec, v);
        }
      }
    }
    broadcastGraphic();
  }

  // 2) Program display layer — deterministic setters (NOT the clear/logo toggles), so
  // applying the same scene twice is idempotent.
  applyProgramAction(scene.program);

  // 3) Program (audience) audio — only when a foreground clip is loaded; muting an
  // empty transport is meaningless and a fresh GO resets it anyway.
  if ((scene.audioMuted === true || scene.audioMuted === false) && transport.active) {
    transport.muted = scene.audioMuted;
    broadcastTransport();
  }
}

// Re-fire data for one overlay slot value. Self-contained for name/title/ticker/custom
// (re-fired verbatim). Countdowns carry a resolved anchor that would be stale on recall,
// so re-stamp it from the retained authoring spec (see countdownShow).
function reviveSlotValue(name, v) {
  if (!v) return null;
  if (name !== 'countdown') {
    // Re-stamp a fresh auto-dismiss anchor so the timer runs full-length from recall
    // (a stored absolute dismissAt would be stale), mirroring the countdown anchor.
    return Number(v.autoDismissSec) > 0 ? { ...v, dismissAt: Date.now() + Number(v.autoDismissSec) * 1000 } : v;
  }
  const s = { ...v };
  if (s.mode === 'countup') {
    s.startAt = Date.now();
  } else if (s.mode === 'countdown') {
    if (s.source === 'target' && s.targetClock) s.endsAt = nextClockTime(s.targetClock);
    else if (Number.isFinite(s.durationSec)) s.endsAt = Date.now() + Math.max(0, s.durationSec) * 1000;
    // else: no spec to re-resolve from — keep the stored endsAt as a best effort.
  }
  return s;
}

// Drive the program displayMode to a scene's target without toggling. 'none' leaves it
// alone. 'content'/'clear' are no-ops from idle (nothing has been GO'd to show/blank).
// 'logo' works from any mode (logo resolves from settings/channel, not livePayload).
function applyProgramAction(action) {
  if (!action || action === 'none') return;
  if (action === 'logo') {
    if (state.displayMode !== 'logo') { state.preLogoMode = state.displayMode; state.displayMode = 'logo'; }
  } else if (action === 'clear') {
    if (state.displayMode === 'idle') return;
    state.displayMode = 'cleared';
    state.preLogoMode = null;
  } else if (action === 'content') {
    if (state.displayMode === 'idle') return;
    state.displayMode = 'content';
    state.preLogoMode = null;
  }
  sendCurrentState();
  notifyMainWindow('output:state-changed', getState());
}

// ── Multiview capture ────────────────────────────────────────────────────────
// Captures all active screen monitor windows at ~2fps and sends
// the result map to the renderer for the Multiview tab.

export function startMultiviewCapture() {
  multiviewRefCount++;
  if (multiviewRefCount === 1) {
    // ~1 fps: capturePage() on a live screen window is a full GPU readback that
    // contends with the program output's rendering (stutters playback). 1s matches
    // the NDI thumbnail cache cadence and is plenty for a monitoring wall.
    multiviewInterval = setInterval(runMultiviewCapture, 1000);
  }
}

export function stopMultiviewCapture() {
  multiviewRefCount = Math.max(0, multiviewRefCount - 1);
  if (multiviewRefCount === 0 && multiviewInterval) {
    clearInterval(multiviewInterval);
    multiviewInterval = null;
  }
}

async function runMultiviewCapture() {
  if (multiviewCapturing) return; // previous tick's capturePage still running — skip
  multiviewCapturing = true;
  try {
    await runMultiviewCaptureInner();
  } finally {
    multiviewCapturing = false;
  }
}

async function runMultiviewCaptureInner() {
  const db = getDb();
  const channels = db.prepare('SELECT * FROM output_channels ORDER BY id').all();

  // NDI channels — use cached frames from the paint event loop (no capturePage needed)
  const ndiCaptures = channels
    .filter((ch) => ch.type === 'ndi')
    .map((ch) => {
      const buf = ndiLastFrames.get(ch.id);
      return {
        isNdi:     true,
        channelId: ch.id,
        monitorId: null,
        dataUrl:   buf ? `data:image/jpeg;base64,${buf.toString('base64')}` : null,
      };
    });

  // Screen monitor channels — capturePage in parallel
  const jobs = [];
  for (const channel of channels) {
    if (channel.type === 'ndi') continue;
    const monitors = db
      .prepare('SELECT * FROM channel_monitors WHERE channel_id = ? ORDER BY id')
      .all(channel.id);
    for (const monitor of monitors) jobs.push({ channel, monitor });
  }

  const screenCaptures = await Promise.all(
    jobs.map(async ({ channel, monitor }) => {
      const win = windows.get(monitor.id);
      let dataUrl = null;
      if (win && !win.isDestroyed()) {
        try {
          const img = await win.webContents.capturePage();
          const small = img.resize({ width: 640 });
          dataUrl = `data:image/jpeg;base64,${small.toJPEG(72).toString('base64')}`;
        } catch {}
      }
      return { isNdi: false, monitorId: monitor.id, channelId: channel.id, dataUrl };
    }),
  );

  notifyMainWindow('output:multiview-captures', [...ndiCaptures, ...screenCaptures]);
}
