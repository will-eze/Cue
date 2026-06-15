import { BrowserWindow, screen, app } from 'electron';
import path from 'path';
import { getDb } from '../db/schema.js';
import * as ndi from './ndi.js';

// windows keyed by monitor.id (integer) for screen monitors,
// or 'ndi-{channelId}' (string) for NDI channels.
const windows = new Map();
// Per-NDI-channel paint listeners: channelId → { win, onPaint, timer }
const ndiCaptureLoops = new Map();
// Latest downscaled JPEG per NDI channel for multiview thumbnails (1fps cache)
const ndiLastFrames = new Map(); // channelId → Buffer
let mainWindowRef = null;
// Network-control remote: notified on every state change so it can push STATE to
// connected Stream Deck / Companion / phone clients. Set by index.js; decoupled
// so this module never imports the remote server.
let remoteStateCb = null;
let multiviewInterval = null;
let multiviewRefCount = 0;
let outputsEnabled = true;

// Stage display state — persisted so newly opened stage windows can be synced.
let stageState = {
  timer: { totalSeconds: 0, remainingSeconds: 0, running: false, startedAt: null },
  message: '',
};

// Broadcast-graphics overlay — an independent bus from the program slide bus.
// nameTitle = { name, title } | null (built-in lower-third bug); ticker = { text, speed }
// | null (bottom crawl); custom = { html } | null (user HTML/CSS rendered in a shadow
// root); countdown = { mode, endsAt|startAt, … } | null (a self-ticking timer/clock —
// the output template runs the per-second tick, this bus only carries the target time).
// Dispatched as graphic:update to lower-third windows only, so a graphic never
// disturbs the fullscreen program. Persisted for newly opened windows.
//
// Each slot holds ONE occupant PER DESTINATION KIND ({ screen, ndi }) so different
// graphics can run In-Room vs Online at the same time (e.g. two different tickers).
// A fire targeted 'all' fills both kinds with the same object; 'screen'/'ndi' fills
// just that one (leaving the other kind's occupant running). The output windows are
// already tagged screen/ndi, so each receives only its kind's occupant — the inner
// slot-value shape is unchanged, so the output templates need no changes.
const emptySlot = () => ({ screen: null, ndi: null });
let overlay = { nameTitle: emptySlot(), ticker: emptySlot(), custom: emptySlot(), countdown: emptySlot() };

// Assign a slot value to the destination(s) named by `target` ('all'|'screen'|'ndi').
// value=null clears the targeted kind(s). Leaves the untargeted kind untouched.
function setSlot(name, value, target) {
  const slot = overlay[name];
  if ((target || 'all') === 'all') { slot.screen = value; slot.ndi = value; }
  else slot[target] = value;
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
  win.loadFile(getTemplatePath(channel.template || 'fullscreen'), {
    // program=0 hides the song lyric band; graphics=0 hides the broadcast-graphics
    // overlay — together they give a lower-third channel its 3 content modes.
    query: {
      mute: baseMuted ? '1' : '0',
      program: channel.show_program === 0 ? '0' : '1',
      graphics: channel.show_graphics === 0 ? '0' : '1',
    },
  });
  // Re-dispatch current display state once the template JS is ready.
  // Without this, IPC sent before onSlideUpdate is registered is silently dropped.
  win.webContents.once('did-finish-load', () => {
    sendStateToWindow(win, channel);
    if (channel.template === 'stage') sendStageState(win);
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
      mute: channel.ndi_audio_muted !== 0 ? '1' : '0',
      program: channel.show_program === 0 ? '0' : '1',
      graphics: channel.show_graphics === 0 ? '0' : '1',
    },
  });
  win.webContents.once('did-finish-load', () => {
    sendStateToWindow(win, channel);
    if (channel.template === 'stage') sendStageState(win);
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
  return wins;
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
  win.webContents.send('slide:update', { ...state.livePayload, type: 'content', transport: { ...transport } });
}

function sendCurrentState() {
  if (state.displayMode === 'idle') {
    for (const win of getAllOutputWindows()) {
      win.webContents.send('slide:update', {
        type: 'clear', text: null, backgroundPath: null, logoPath: null,
        copyright: null, sectionLabel: null,
      });
    }
    return;
  }

  if (state.displayMode === 'cleared') {
    const bgPath = state.livePayload?.backgroundPath ?? null;
    for (const win of getAllOutputWindows()) {
      win.webContents.send('slide:update', {
        type: 'clear', text: null, backgroundPath: bgPath, logoPath: null,
        copyright: null, sectionLabel: null,
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
        backgroundPath: null, copyright: null, sectionLabel: null };
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
    return;
  }

  // displayMode === 'content'
  for (const win of getAllOutputWindows()) {
    win.webContents.send('slide:update', { ...state.livePayload, type: 'content', transport: { ...transport } });
  }
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
  notifyMainWindow('output:media-transport', snapshot);
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

export function resolveBackground(item) {
  const db = getDb();
  if (item.background_override_id) {
    const a = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(item.background_override_id);
    return a ? a.path : null;
  }
  if (item.item_type === 'song' && item.song && item.song.default_background_id) {
    const a = db
      .prepare('SELECT * FROM media_assets WHERE id = ?')
      .get(item.song.default_background_id);
    if (a) return a.path;
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

function sendStageState(win) {
  win.webContents.send('stage:timer',   { ...stageState.timer });
  win.webContents.send('stage:message', { text: stageState.message });
}

export function setStageMessage(text) {
  stageState.message = text ?? '';
  for (const win of getAllStageWindows()) {
    win.webContents.send('stage:message', { text: stageState.message });
  }
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
  notifyMainWindow('output:overlay-changed', { ...overlay });
}

export function graphicShow(data) {
  const value = data && (data.name || data.title)
    ? { id: data.id ?? null, name: data.name ?? '', title: data.title ?? '', style: data.style ?? null, target: data.target || 'all' }
    : null;
  setSlot('nameTitle', value, data && data.target);
  broadcastGraphic();
}

export function graphicHide(target) {
  setSlot('nameTitle', null, target);
  broadcastGraphic();
}

export function tickerShow(data) {
  const value = data && data.text
    ? { id: data.id ?? null, text: data.text, speed: Number.isFinite(data.speed) ? data.speed : 100, style: data.style ?? null, target: data.target || 'all' }
    : null;
  setSlot('ticker', value, data && data.target);
  broadcastGraphic();
}

export function tickerHide(target) {
  setSlot('ticker', null, target);
  broadcastGraphic();
}

export function customShow(data) {
  const value = data && data.html
    ? { id: data.id ?? null, html: String(data.html), target: data.target || 'all' }
    : null;
  setSlot('custom', value, data && data.target);
  broadcastGraphic();
}

export function customHide(target) {
  setSlot('custom', null, target);
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
    format:  data.format || '24h',
    showSeconds: data.showSeconds !== false,
    style:   data.style ?? null,
    target:  data.target || 'all',
  };
  if (data.mode === 'countdown') {
    slot.endsAt = data.source === 'target'
      ? nextClockTime(data.targetClock)
      : Date.now() + Math.max(0, Number(data.durationSec) || 0) * 1000;
  } else if (data.mode === 'countup') {
    slot.startAt = Date.now();
  }
  setSlot('countdown', slot, data.target);
  broadcastGraphic();
}

export function countdownHide(target) {
  setSlot('countdown', null, target);
  broadcastGraphic();
}

export function getOverlay() {
  return { ...overlay };
}

// ── Multiview capture ────────────────────────────────────────────────────────
// Captures all active screen monitor windows at ~2fps and sends
// the result map to the renderer for the Multiview tab.

export function startMultiviewCapture() {
  multiviewRefCount++;
  if (multiviewRefCount === 1) {
    multiviewInterval = setInterval(runMultiviewCapture, 500);
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
