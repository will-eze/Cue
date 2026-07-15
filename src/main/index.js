import { app, BrowserWindow, ipcMain, dialog, screen, protocol, nativeImage, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { Readable } from 'node:stream';
import { initDb } from './db/schema.js';
import { registerSongsIpc } from './ipc/songs.ipc.js';
import { registerServicesIpc } from './ipc/services.ipc.js';
import { registerMediaIpc } from './ipc/media.ipc.js';
import { registerOutputIpc } from './ipc/output.ipc.js';
import { registerSettingsIpc } from './ipc/settings.ipc.js';
import { registerBibleIpc } from './ipc/bible.ipc.js';
import { registerGraphicsIpc } from './ipc/graphics.ipc.js';
import { registerThemesIpc } from './ipc/themes.ipc.js';
import { registerPresentationsIpc } from './ipc/presentations.ipc.js';
import { registerRemoteIpc, applyRemoteConfig } from './ipc/remote.ipc.js';
import { registerFontsIpc } from './ipc/fonts.ipc.js';
import { registerYoutubeIpc } from './ipc/youtube.ipc.js';
import { registerScriptureDetectIpc } from './ipc/scripture-detect.ipc.js';
import { registerBackgroundLibraryIpc } from './ipc/background-library.ipc.js';
import { registerScenesIpc } from './ipc/scenes.ipc.js';
import { registerOutputPresetsIpc } from './ipc/output-presets.ipc.js';
import { registerLiveInputIpc } from './ipc/live-input.ipc.js';
import * as scriptureDetect from './scripture-detect/manager.js';
import * as youtube from './youtube/downloader.js';
import { purgeYoutubeItems } from './db/services.js';
import { autoSnapshot } from './db/backup.js';
import * as remoteServer from './remote/server.js';
import { seedBundledBibles } from './db/bible.js';
import { seedGhsHymnal } from './db/songs.js';
import { seedBundledThemes, preloadPresentationThemeBgs } from './db/themes.js';
import * as outputManager from './output/manager.js';
import * as graphicsDb from './db/graphics.js';
import { isAvailable as ndiAvailable } from './output/ndi.js';
import { thumbCachePath, getThumbnailDir } from './db/media.js';

// Must be called synchronously before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'cue-media', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
  { scheme: 'cue-thumb', privileges: { secure: true, standard: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } },
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
  // Fonts (user-installed custom families)
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
};

let mainWindow;

// Containment guard for the cue-media:// / cue-thumb:// protocols. Every file they
// serve (media, thumbnails + their source, user fonts, yt-cache, bin) lives under
// userData, so a decoded path that resolves OUTSIDE userData is a traversal attempt
// (e.g. cue-media://localhost/etc/passwd) — reject it. path.resolve normalises any
// `..` segments, so this can't be walked around.
function isUnderUserData(p) {
  const root = path.resolve(app.getPath('userData'));
  const resolved = path.resolve(p);
  return resolved === root || resolved.startsWith(root + path.sep);
}

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
  // Dev-mode Dock icon. In a packaged build the icon comes from the .app bundle
  // (packagerConfig.icon in forge.config.js); `npm start` runs the generic
  // Electron binary, so set it explicitly here. assets/ isn't packaged, so this
  // only fires in dev (app.getAppPath() is the repo root).
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    const dockIcon = nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'icon.png'));
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

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
    if (!isUnderUserData(filePath)) {
      console.error('[cue-media] Blocked out-of-bounds path:', filePath);
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const stat = await fs.promises.stat(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mimeType = MEDIA_MIME[ext] || 'application/octet-stream';
      const rangeHeader = request.headers.get('range');

      // Media files use UUID names and never change — cache forever. ACAO lets the
      // output window tap program audio via Web Audio (captureStream) without the
      // cross-origin (file:// → cue-media://) media tainting the stream.
      const cacheHeaders = {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      };

      if (rangeHeader) {
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end   = match[2] ? parseInt(match[2], 10) : stat.size - 1;
        // Defensive: a range whose start is at/past EOF (e.g. a file being written, or
        // a malformed request) must not hand fs.createReadStream an invalid window.
        // Answer 416 so Chromium backs off cleanly instead of hanging on a bad stream.
        if (start >= stat.size) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' },
          });
        }
        const chunkSize = end - start + 1;
        // STREAM the requested range — never buffer it. A media element opens
        // playback with `bytes=0-` (the whole remaining file); reading that into one
        // allocation froze the main process and spiked memory on multi-GB videos,
        // while capping it to a fixed window starved the player of the (multi-MB)
        // moov index on hour-long clips, so it could only loop the first few seconds.
        // A lazy read stream serves ANY range with bounded memory and lets Chromium
        // read, seek and cancel freely. Chromium cancels the open-ended request and
        // re-asks for specific windows as it plays, so the full file is never read.
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', () => {}); // file vanished mid-stream (e.g. cache wiped) — drop quietly
        return new Response(Readable.toWeb(stream), {
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

      // No range header (images, or a client that wants the whole file). Stream it
      // too, so a large asset never lands in a single buffer.
      const fullStream = fs.createReadStream(filePath);
      fullStream.on('error', () => {});
      return new Response(Readable.toWeb(fullStream), {
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

  // Thumbnail protocol: serves a small, cached JPEG poster for a media asset so
  // grids/lists don't decode the full-resolution original for every tile. The
  // poster is generated lazily by the OS thumbnail service (QuickLook on macOS,
  // the shell thumbnail handler on Windows) — cross-platform, async, and able to
  // poster videos as well as images — then cached to userData/thumbnails keyed by
  // a hash of the source path. URL format: cue-thumb://localhost/absolute/path.
  const THUMB_MAX = 480;
  const THUMB_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'svg']);
  protocol.handle('cue-thumb', async (request) => {
    const { pathname } = new URL(request.url);
    let srcPath = decodeURIComponent(pathname);
    if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(srcPath)) srcPath = srcPath.slice(1);
    if (!isUnderUserData(srcPath)) {
      console.error('[cue-thumb] Blocked out-of-bounds path:', srcPath);
      return new Response('Forbidden', { status: 403 });
    }
    // Thumbnails are derived from immutable UUID-named files — cache forever.
    const cacheHeaders = { 'Cache-Control': 'public, max-age=31536000, immutable' };
    const cachePath = thumbCachePath(srcPath);

    // Already generated? Serve the cached JPEG.
    try {
      const cached = await fs.promises.readFile(cachePath);
      return new Response(cached, {
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(cached.length), ...cacheHeaders },
      });
    } catch {}

    // Generate via the OS thumbnail service, downscaled to THUMB_MAX.
    let buf = null;
    try {
      const img = await nativeImage.createThumbnailFromPath(srcPath, { width: THUMB_MAX, height: THUMB_MAX });
      if (img && !img.isEmpty()) buf = img.toJPEG(72);
    } catch {}

    if (buf && buf.length) {
      // Cache write is fire-and-forget so the first request isn't blocked on disk.
      fs.promises.mkdir(getThumbnailDir(), { recursive: true })
        .then(() => fs.promises.writeFile(cachePath, buf))
        .catch(() => {});
      return new Response(buf, {
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(buf.length), ...cacheHeaders },
      });
    }

    // Couldn't make a thumbnail. For an image, fall back to the original bytes so
    // the tile still renders; for anything else (e.g. a video the OS can't
    // thumbnail) return 404 so the renderer shows its own placeholder rather than
    // feeding video bytes into an <img>.
    const ext = path.extname(srcPath).slice(1).toLowerCase();
    if (THUMB_IMAGE_EXTS.has(ext)) {
      try {
        const data = await fs.promises.readFile(srcPath);
        return new Response(data, {
          headers: { 'Content-Type': MEDIA_MIME[ext] || 'image/jpeg', 'Content-Length': String(data.length), ...cacheHeaders },
        });
      } catch {}
    }
    return new Response('No thumbnail', { status: 404 });
  });

  // Content-Security-Policy (packaged only). In dev, Vite's HMR needs inline/eval +
  // ws:, so skip it there. The policy allows the app's real remote deps: Google Fonts
  // (Material Symbols) and HuggingFace (WebGPU ASR model fetch, allowRemoteModels:true);
  // ORT-web WASM is served locally, needing only 'wasm-unsafe-eval' + blob workers. The
  // hardening that matters: scripts can't be inline or arbitrary-remote, no <object>,
  // locked base-uri/frames.
  if (app.isPackaged) {
    const CSP = [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com cue-media: data:",
      // The background/theme library picker hotlinks each item's remote `thumb`
      // (manifest CDNs) into <img> tags — without these hosts the grids render
      // blank in the packaged app (CSP is dev-invisible). Origin `url` hosts
      // (e.g. videos.pexels.com) are fetched in main, not here, so omitted.
      "img-src 'self' cue-media: cue-thumb: data: blob: https://cdn.coverr.co https://images.unsplash.com https://images.pexels.com https://cdn.pixabay.com https://assets.mixkit.co",
      "media-src 'self' cue-media: blob:",
      "connect-src 'self' cue-media: cue-thumb: https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn-lfs.huggingface.co data: blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-src 'none'",
    ].join('; ');
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
    });
  }

  // Audio-output device selection: routing program audio via setSinkId requires
  // the 'speaker-selection' permission, and exposing device labels needs 'media'.
  // Electron's default grants these, but register an explicit allow-handler so the
  // in-room audio-output picker works reliably in packaged builds. The app loads
  // only local + known-trusted remote content, so granting requests is acceptable.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));

  initDb();
  seedBundledBibles();
  seedGhsHymnal();
  seedBundledThemes();
  setImmediate(() => preloadPresentationThemeBgs().catch(() => {}));

  // Ephemeral YouTube downloads never survive a session. Wipe any leftover files
  // from a previous run (e.g. a crash where will-quit never fired), and drop the
  // single-use cues themselves so they don't reappear in the rundown and re-download.
  youtube.wipeCache();
  purgeYoutubeItems();

  registerSongsIpc();
  registerServicesIpc();
  registerMediaIpc();
  registerSettingsIpc();
  registerOutputIpc();
  registerBibleIpc();
  registerGraphicsIpc();
  registerThemesIpc();
  registerPresentationsIpc();
  registerRemoteIpc();
  registerFontsIpc();
  registerYoutubeIpc();
  registerScriptureDetectIpc();
  registerBackgroundLibraryIpc();
  registerScenesIpc();
  registerOutputPresetsIpc();
  registerLiveInputIpc();

  createMainWindow();
  outputManager.setMainWindow(mainWindow);
  scriptureDetect.setMainWindow(mainWindow);
  await scriptureDetect.init();

  // Network control API: read state from the manager, forward transport commands
  // to the renderer (which owns rundown/preview/live and resolves GO payloads),
  // and push STATE on every output change. Start it from saved settings.
  remoteServer.configure({
    getState: () => outputManager.getState(),
    onCommand: (cmd) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('remote:command', cmd);
    },
    // Program mirror: the current screen-kind program frame for a viewer that joins
    // the read-only /output surface.
    getProgram: () => outputManager.getProgramSnapshot(),
    // Broadcast-graphics bus — lets Stream Deck / Companion fire graphics directly
    // without going through the renderer IPC path.
    graphics: {
      graphicShow:    (d) => outputManager.graphicShow(d),
      graphicHide:    (t) => outputManager.graphicHide(t),
      tickerShow:     (d) => outputManager.tickerShow(d),
      tickerHide:     (t) => outputManager.tickerHide(t),
      customHide:     (t) => outputManager.customHide(t),
      countdownShow:  (d) => outputManager.countdownShow(d),
      countdownHide:  (t) => outputManager.countdownHide(t),
      countdownPause: (t) => outputManager.countdownPause(t),
      countdownResume:(t) => outputManager.countdownResume(t),
      // Saved-graphic list + fire/clear by id — the phone remote's "take graphic live".
      list:      () => graphicsDb.list(),
      overlay:   () => outputManager.getOverlay(),
      fireById:  (id, t) => outputManager.graphicShowById(id, t),
      clearById: (id, t) => outputManager.graphicClearById(id, t),
      pauseById:  (id) => outputManager.graphicPauseById(id),
      resumeById: (id) => outputManager.graphicResumeById(id),
    },
  });
  outputManager.setRemoteStateListener(() => remoteServer.pushState());
  // Push program bus deltas (slide / transport / overlay) to browser viewers.
  outputManager.setRemoteProgramListener((delta) => remoteServer.pushProgram(delta));
  await applyRemoteConfig();

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
  // Auto-backup FIRST, while the cue.db handle is still open (it checkpoints the WAL).
  autoSnapshot();
  outputManager.closeAll();
  remoteServer.stop();
  scriptureDetect.dispose();
  // Single-use clips: delete every downloaded YouTube file on quit.
  youtube.wipeCache();
});
