import { ipcMain, BrowserWindow } from 'electron';
import * as youtube from '../youtube/downloader.js';
import { detect } from '../youtube/bin.js';

export function registerYoutubeIpc() {
  // Push live download progress to every renderer window (the operator UI keys
  // status off the cue's URL — see LibraryPanel / RundownPanel subscriptions).
  youtube.setStatusListener((snap) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('youtube:status', snap);
    }
  });

  // Speculative on paste, again (idempotent) on Confirm. Returns the snapshot;
  // resolves when the download completes, but callers usually fire-and-forget and
  // watch the 'youtube:status' stream instead.
  ipcMain.handle('youtube:prefetch', (_e, url) => youtube.prefetch(url));
  ipcMain.handle('youtube:status', (_e, url) => youtube.getStatus(url));
  ipcMain.handle('youtube:cancel', (_e, url) => { youtube.cancel(url); });
  ipcMain.handle('youtube:detect', () => detect());
}
