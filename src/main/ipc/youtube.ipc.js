import { ipcMain, BrowserWindow, clipboard } from 'electron';
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

  // Read the OS clipboard text (Electron's main-process clipboard — silent, no
  // permission prompt). Used to auto-detect a copied YouTube link when the operator
  // enters the Media library, so they can add it with one click. Read on demand only,
  // never polled, and acted on only when it matches a YouTube pattern.
  ipcMain.handle('clipboard:readText', () => clipboard.readText());
}
