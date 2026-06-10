import { ipcMain } from 'electron';
import * as bible from '../db/bible.js';

export function registerBibleIpc() {
  ipcMain.handle('bible:versions:list', () => bible.listVersions());

  ipcMain.handle('bible:importFile', (_e, filePath, meta) => {
    try {
      return { ok: true, ...bible.importFromFile(filePath, meta || {}) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('bible:delete', (_e, id) => bible.deleteVersion(id));
  ipcMain.handle('bible:books', (_e, versionId) => bible.listBooks(versionId));
  ipcMain.handle('bible:resolve', (_e, versionId, ref, versesPerSlide) =>
    bible.resolvePassage(versionId, ref, versesPerSlide),
  );
  ipcMain.handle('bible:search', (_e, versionId, query) => bible.search(versionId, query));
}
