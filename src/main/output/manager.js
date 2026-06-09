import { BrowserWindow, screen, app } from 'electron';
import path from 'path';
import { getDb } from '../db/schema.js';

// windows keyed by monitor.id (integer) for screen monitors,
// or 'ndi-{channelId}' (string) for NDI channels.
const windows = new Map();
let mainWindowRef = null;
let captureInterval = null;
let multiviewInterval = null;
let outputsEnabled = true;

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
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(getTemplatePath(channel.template || 'fullscreen'));
  // Re-dispatch current display state once the template JS is ready.
  // Without this, IPC sent before onSlideUpdate is registered is silently dropped.
  win.webContents.once('did-finish-load', () => {
    if (state.displayMode !== 'idle') sendCurrentState();
  });
  return win;
}

function createNdiWindow(channel) {
  const preload = getOutputPreloadPath();
  const win = new BrowserWindow({
    width: channel.ndi_width || 1920,
    height: channel.ndi_height || 1080,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(getTemplatePath(channel.template || 'fullscreen'));
  return win;
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
    if (state.displayMode !== 'idle') sendCurrentState();
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
}

export function closeChannel(channelId) {
  const db = getDb();
  const monitors = db
    .prepare('SELECT * FROM channel_monitors WHERE channel_id = ?')
    .all(channelId);
  for (const m of monitors) closeMonitor(m.id);

  const ndiKey = `ndi-${channelId}`;
  const ndiWin = windows.get(ndiKey);
  if (ndiWin && !ndiWin.isDestroyed()) ndiWin.close();
  windows.delete(ndiKey);
}

export function closeAll() {
  for (const [, win] of windows) {
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

function sendCurrentState() {
  if (state.displayMode === 'idle') {
    stopLiveCapture();
    for (const win of getAllOutputWindows()) {
      win.webContents.send('slide:update', {
        type: 'clear', text: null, backgroundPath: null, logoPath: null,
        copyright: null, sectionLabel: null,
      });
    }
    return;
  }

  // All non-idle modes keep the live capture running so the operator panel stays current.
  startLiveCapture();

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
    win.webContents.send('slide:update', { ...state.livePayload, type: 'content' });
  }
}

export function go(payload) {
  state.livePayload = payload;
  state.displayMode = 'content';
  state.preLogoMode = null;
  sendCurrentState();
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

  if (!enabled) {
    stopLiveCapture();
    for (const [, win] of windows) {
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
  };
}

export function setMainWindow(win) {
  mainWindowRef = win;
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

function notifyMainWindow(channel, ...args) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, ...args);
  }
}

function startLiveCapture() {
  stopLiveCapture();
  captureInterval = setInterval(async () => {
    const db = getDb();
    const channels = db
      .prepare('SELECT * FROM output_channels WHERE active = 1 AND type = "screen"')
      .all();
    for (const channel of channels) {
      const monitors = db
        .prepare('SELECT * FROM channel_monitors WHERE channel_id = ? AND active = 1')
        .all(channel.id);
      for (const monitor of monitors) {
        const win = windows.get(monitor.id);
        if (win && !win.isDestroyed()) {
          try {
            const img = await win.webContents.capturePage();
            notifyMainWindow('output:live-capture', img.toDataURL());
          } catch {}
          return;
        }
      }
    }
  }, 200);
}

function stopLiveCapture() {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
}

// ── Multiview capture ────────────────────────────────────────────────────────
// Captures all active screen monitor windows at ~2fps and sends
// the result map to the renderer for the Multiview tab.

export function startMultiviewCapture() {
  stopMultiviewCapture();
  multiviewInterval = setInterval(runMultiviewCapture, 500);
}

export function stopMultiviewCapture() {
  if (multiviewInterval) {
    clearInterval(multiviewInterval);
    multiviewInterval = null;
  }
}

async function runMultiviewCapture() {
  const db = getDb();
  const channels = db.prepare('SELECT * FROM output_channels ORDER BY id').all();

  // Build the list of (channel, monitor) pairs to capture in parallel.
  const jobs = [];
  for (const channel of channels) {
    if (channel.type === 'ndi') continue;
    const monitors = db
      .prepare('SELECT * FROM channel_monitors WHERE channel_id = ? ORDER BY id')
      .all(channel.id);
    for (const monitor of monitors) {
      jobs.push({ channel, monitor });
    }
  }

  const captures = await Promise.all(
    jobs.map(async ({ channel, monitor }) => {
      const win = windows.get(monitor.id);
      let dataUrl = null;
      if (win && !win.isDestroyed()) {
        try {
          const img = await win.webContents.capturePage();
          // Downscale to 640px wide JPEG — adequate for multiview thumbnails.
          const small = img.resize({ width: 640 });
          const buf = small.toJPEG(72);
          dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
        } catch {}
      }
      return {
        monitorId: monitor.id,
        channelId: channel.id,
        dataUrl,
      };
    }),
  );

  notifyMainWindow('output:multiview-captures', captures);
}
