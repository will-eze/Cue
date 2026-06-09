import { app, BrowserWindow, ipcMain, dialog, screen } from 'electron';
import path from 'path';
import { initDb } from './db/schema.js';
import { registerSongsIpc } from './ipc/songs.ipc.js';
import { registerServicesIpc } from './ipc/services.ipc.js';
import { registerMediaIpc } from './ipc/media.ipc.js';
import { registerOutputIpc } from './ipc/output.ipc.js';
import { registerSettingsIpc } from './ipc/settings.ipc.js';
import * as outputManager from './output/manager.js';
import { isAvailable as ndiAvailable } from './output/ndi.js';

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
  initDb();

  registerSongsIpc();
  registerServicesIpc();
  registerMediaIpc();
  registerSettingsIpc();
  registerOutputIpc();

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
