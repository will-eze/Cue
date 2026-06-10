import { app, BrowserWindow, ipcMain, dialog, screen, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { initDb } from './db/schema.js';
import { registerSongsIpc } from './ipc/songs.ipc.js';
import { registerServicesIpc } from './ipc/services.ipc.js';
import { registerMediaIpc } from './ipc/media.ipc.js';
import { registerOutputIpc } from './ipc/output.ipc.js';
import { registerSettingsIpc } from './ipc/settings.ipc.js';
import { registerBibleIpc } from './ipc/bible.ipc.js';
import * as outputManager from './output/manager.js';
import { isAvailable as ndiAvailable } from './output/ndi.js';

// Must be called synchronously before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'cue-media', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
]);

const MEDIA_MIME = {
  // Images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', tiff: 'image/tiff',
  // Video
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  m4v: 'video/mp4', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  // Audio
  mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
  flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4',
};

let mainWindow;

function createMainWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#111317',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    // Center traffic lights vertically in the 38px titlebar row
    ...(isMac ? { trafficLightPosition: { x: 16, y: 11 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Window control IPC for Windows custom titlebar
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}


ipcMain.handle('dialog:openFile', async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

app.whenReady().then(async () => {
  // Serve local media files via fs — avoids file:// CORS block from http://localhost
  // and bypasses net.fetch limitations with file:// URIs on some platforms.
  // URL format: cue-media://localhost/absolute/path/to/file
  // "localhost" is used as a dummy host so Chromium's standard-scheme parser
  // doesn't promote the first path segment to the hostname field.
  // Async handler — all fs access is non-blocking so concurrent media reads
  // (e.g. the same clip decoded by both an output window and the operator
  // preview) never stall the main thread mid-playback.
  protocol.handle('cue-media', async (request) => {
    const { pathname } = new URL(request.url);
    let filePath = decodeURIComponent(pathname);
    // On Windows, URL pathname is /C:/... — strip the leading slash before the drive letter
    if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(filePath)) {
      filePath = filePath.slice(1);
    }
    try {
      const stat = await fs.promises.stat(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mimeType = MEDIA_MIME[ext] || 'application/octet-stream';
      const rangeHeader = request.headers.get('range');

      // Media files use UUID names and never change — cache forever.
      const cacheHeaders = { 'Cache-Control': 'public, max-age=31536000, immutable' };

      if (rangeHeader) {
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end   = match[2] ? parseInt(match[2], 10) : stat.size - 1;
        const chunkSize = end - start + 1;
        const buf = Buffer.allocUnsafe(chunkSize);
        const fh = await fs.promises.open(filePath, 'r');
        try {
          await fh.read(buf, 0, chunkSize, start);
        } finally {
          await fh.close();
        }
        return new Response(buf, {
          status: 206,
          headers: {
            'Content-Type': mimeType,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            ...cacheHeaders,
          },
        });
      }

      const data = await fs.promises.readFile(filePath);
      return new Response(data, {
        headers: {
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(stat.size),
          ...cacheHeaders,
        },
      });
    } catch (err) {
      console.error('[cue-media] Failed to serve:', filePath, err.code);
      return new Response('Not found', { status: 404 });
    }
  });

  initDb();

  registerSongsIpc();
  registerServicesIpc();
  registerMediaIpc();
  registerSettingsIpc();
  registerOutputIpc();
  registerBibleIpc();

  createMainWindow();
  outputManager.setMainWindow(mainWindow);

  const unresolvedChannels = await outputManager.init();
  mainWindow.webContents.once('did-finish-load', () => {
    if (unresolvedChannels.length > 0) {
      mainWindow.webContents.send('output:unresolved-channels', unresolvedChannels);
    }
    if (!ndiAvailable()) {
      mainWindow.webContents.send('output:ndi-unavailable');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  outputManager.closeAll();
});
