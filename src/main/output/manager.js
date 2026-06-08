import { BrowserWindow, screen, app } from 'electron';
import path from 'path';
import { getDb } from '../db/schema.js';

const windows = new Map();
let mainWindowRef = null;
let captureInterval = null;

let state = {
  previewPayload: null,
  livePayload: null,
};

function getOutputPreloadPath() {
  return path.join(__dirname, 'output-preload.js');
}

function getTemplatePath(template) {
  return path.join(app.getAppPath(), 'src', 'output', `${template}.html`);
}

function createWindow(channel) {
  const preload = getOutputPreloadPath();

  if (channel.type === 'ndi') {
    const win = new BrowserWindow({
      width: channel.ndi_width || 1920,
      height: channel.ndi_height || 1080,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    win.loadFile(getTemplatePath(channel.template));
    return win;
  }

  if (!channel.display_bounds) return null;
  const bounds = JSON.parse(channel.display_bounds);
  const displays = screen.getAllDisplays();
  const display = displays.find(
    (d) =>
      d.bounds.x === bounds.x &&
      d.bounds.y === bounds.y &&
      d.bounds.width === bounds.width &&
      d.bounds.height === bounds.height
  );
  if (!display) return null;

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
  win.loadFile(getTemplatePath(channel.template));
  return win;
}

export async function init() {
  const db = getDb();
  const channels = db.prepare('SELECT * FROM output_channels WHERE active = 1').all();
  const unresolved = [];

  for (const channel of channels) {
    if (channel.type === 'screen') {
      if (!channel.display_bounds) {
        unresolved.push(channel);
        continue;
      }
      const bounds = JSON.parse(channel.display_bounds);
      const displays = screen.getAllDisplays();
      const match = displays.find(
        (d) =>
          d.bounds.x === bounds.x &&
          d.bounds.y === bounds.y &&
          d.bounds.width === bounds.width &&
          d.bounds.height === bounds.height
      );
      if (!match) {
        unresolved.push(channel);
        continue;
      }
    }
    const win = createWindow(channel);
    if (win) windows.set(channel.id, win);
  }

  return unresolved;
}

export async function openChannel(channel) {
  if (!channel.active) return;
  const win = createWindow(channel);
  if (win) windows.set(channel.id, win);
}

export async function syncChannel(id) {
  closeChannel(id);
  const channel = getDb().prepare('SELECT * FROM output_channels WHERE id = ?').get(id);
  if (channel && channel.active) await openChannel(channel);
}

export function closeChannel(id) {
  const win = windows.get(id);
  if (win && !win.isDestroyed()) win.close();
  windows.delete(id);
}

export function closeAll() {
  for (const [id] of windows) closeChannel(id);
}

function dispatchToChannel(channel, payload, win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('slide:update', payload);
}

function resolveBackground(item) {
  const db = getDb();
  if (item.background_override_id) {
    const a = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(item.background_override_id);
    return a ? a.path : null;
  }
  if (item.item_type === 'song' && item.song && item.song.default_background_id) {
    const a = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(item.song.default_background_id);
    if (a) return a.path;
  }
  const bgKey = item.item_type === 'song' ? 'global_bg_song_id' : 'global_bg_slide_id';
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get(bgKey);
  if (setting) {
    const mediaId = JSON.parse(setting.value);
    const a = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(mediaId);
    if (a) return a.path;
  }
  return null;
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

export function go(payload) {
  state.livePayload = payload;
  startLiveCapture();
  const db = getDb();
  const channels = db.prepare('SELECT * FROM output_channels WHERE active = 1').all();

  for (const channel of channels) {
    const win = windows.get(channel.id);
    if (!win) continue;
    dispatchToChannel(channel, { ...payload, type: 'content' }, win);
  }

  notifyMainWindow('output:state-changed', getState());
}

export function clear() {
  state.livePayload = null;
  stopLiveCapture();
  const db = getDb();
  const channels = db.prepare('SELECT * FROM output_channels WHERE active = 1').all();
  const clearPayload = { type: 'clear', text: null, backgroundPath: null, logoPath: null, copyright: null, sectionLabel: null };

  for (const channel of channels) {
    const win = windows.get(channel.id);
    dispatchToChannel(channel, clearPayload, win);
  }

  notifyMainWindow('output:state-changed', getState());
}

export function logo() {
  const db = getDb();
  const channels = db.prepare('SELECT * FROM output_channels WHERE active = 1').all();

  for (const channel of channels) {
    const win = windows.get(channel.id);
    const logoPath = resolveLogo(channel);
    dispatchToChannel(channel, { type: 'logo', logoPath, text: null, backgroundPath: null, copyright: null, sectionLabel: null }, win);
  }

  notifyMainWindow('output:state-changed', getState());
}

export function shortcut(direction) {
  notifyMainWindow(direction === 'next' ? 'shortcut:next' : 'shortcut:prev');
}

export function getState() {
  return {
    isLive: !!state.livePayload,
    livePayload: state.livePayload,
    activeChannels: [...windows.keys()],
  };
}

export function setMainWindow(win) {
  mainWindowRef = win;
}

export { resolveBackground };

function notifyMainWindow(channel, ...args) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, ...args);
  }
}

function startLiveCapture() {
  stopLiveCapture();
  captureInterval = setInterval(async () => {
    const entries = [...windows.entries()];
    if (!entries.length) return;
    const [, win] = entries[0];
    if (!win || win.isDestroyed()) return;
    try {
      const img = await win.webContents.capturePage();
      const dataUrl = img.toDataURL();
      notifyMainWindow('output:live-capture', dataUrl);
    } catch {}
  }, 200);
}

function stopLiveCapture() {
  if (captureInterval) { clearInterval(captureInterval); captureInterval = null; }
}
