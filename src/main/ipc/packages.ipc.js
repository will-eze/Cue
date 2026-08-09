// IPC for the Settings → Packages manager. Thin handlers over packages/registry.js.
// Install streams progress back to the CALLING window via `packages:progress`
// (event.sender) so the modal's per-package bar updates without a global broadcast.
import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as pkg from '../packages/registry.js';

export function registerPackagesIpc() {
  ipcMain.handle('packages:list', () => pkg.list());
  ipcMain.handle('packages:reveal', (_e, id) => pkg.reveal(id));

  ipcMain.handle('packages:install', async (e, id) => {
    const res = await pkg.install(id, (percent, file) => {
      if (!e.sender.isDestroyed()) e.sender.send('packages:progress', { id, percent, file });
    });
    return res;
  });

  ipcMain.handle('packages:remove', (_e, id) => pkg.remove(id));

  // "Locate…": pick a binary manually (for a tool installed somewhere Cue doesn't
  // scan), persist it + re-detect. `id` picks the LibreOffice/yt-dlp/ffmpeg target.
  ipcMain.handle('packages:locate', async (e, id) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const titles = { libreoffice: 'Locate LibreOffice (soffice)', 'yt-dlp': 'Locate yt-dlp', ffmpeg: 'Locate ffmpeg' };
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: titles[id] || 'Locate binary',
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return { ok: false, canceled: true };
    return pkg.locate(id, filePaths[0]);
  });
}
