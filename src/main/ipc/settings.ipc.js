import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import * as settings from '../db/settings.js';
import * as backup from '../db/backup.js';
import { closeDb } from '../db/schema.js';

export function registerSettingsIpc() {
  ipcMain.handle('settings:get', (_e, key) => settings.get(key));
  ipcMain.handle('settings:set', (_e, key, value) => settings.set(key, value));
  ipcMain.handle('settings:setGlobalLogo', (_e, mediaId) => settings.setGlobalLogo(mediaId));
  ipcMain.handle('settings:setGlobalBackground', (_e, type, mediaId) => settings.setGlobalBackground(type, mediaId));
  ipcMain.handle('settings:applyBackgroundToAll', (_e, type, mediaId) => settings.applyBackgroundToAll(type, mediaId));
  ipcMain.handle('settings:getDiskUsage', () => settings.getDiskUsage());
  ipcMain.handle('settings:getDataPath', () => settings.getDataPath());
  ipcMain.handle('settings:openDataFolder', () => settings.openDataFolder());

  // Backup / restore — a single .cuebackup bundle of cue.db + media/.
  ipcMain.handle('settings:exportBackup', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Backup',
      defaultPath: `Cue ${stamp}.cuebackup`,
      filters: [{ name: 'Cue Backup', extensions: ['cuebackup'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    return backup.exportBackup(result.filePath);
  });

  ipcMain.handle('settings:importBackup', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Restore Backup',
      properties: ['openFile'],
      filters: [{ name: 'Cue Backup', extensions: ['cuebackup'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true };

    const res = await backup.importBackup(result.filePaths[0]);
    // Relaunch so every process (renderer, output windows) re-reads the restored
    // database and media. Deferred a beat so this IPC reply reaches the renderer
    // and its toast paints before the window is torn down.
    if (res.ok) setTimeout(() => { app.relaunch(); app.exit(0); }, 400);
    return res;
  });

  // Factory reset — wipe every trace of user state (cue.db + media/) and relaunch.
  // On the next boot initDb() recreates a fresh schema and re-seeds the bundled
  // bibles + GHS hymnal, so the app comes back exactly as a first install.
  ipcMain.handle('settings:factoryReset', () => {
    const userData = app.getPath('userData');
    closeDb(); // release the cue.db handle (checkpoints WAL) before deleting files
    const dbPath = path.join(userData, 'cue.db');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
    }
    try { fs.rmSync(path.join(userData, 'media'), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(path.join(userData, 'fonts'), { recursive: true, force: true }); } catch {}
    setTimeout(() => { app.relaunch(); app.exit(0); }, 300);
    return { ok: true };
  });
}
