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

  ipcMain.handle('bible:online:list', async () => {
    try { return { ok: true, versions: await bible.listOnlineVersions() }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bible:online:download', async (_e, abbrev) => {
    try { return { ok: true, ...(await bible.downloadOnlineVersion(abbrev)) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('bible:delete', (_e, id) => bible.deleteVersion(id));
  ipcMain.handle('bible:books', (_e, versionId) => bible.listBooks(versionId));
  ipcMain.handle('bible:chapters', (_e, versionId, bookNum) => bible.listChapters(versionId, bookNum));
  ipcMain.handle('bible:verses', (_e, versionId, bookNum, chapter) => bible.listVerses(versionId, bookNum, chapter));
  ipcMain.handle('bible:adjacent', (_e, versionId, bookNum, chapter, verse, dir) =>
    bible.adjacentVerse(versionId, bookNum, chapter, verse, dir),
  );
  ipcMain.handle('bible:resolve', (_e, versionId, ref, versesPerSlide) =>
    bible.resolvePassage(versionId, ref, versesPerSlide),
  );
  ipcMain.handle('bible:search', (_e, versionId, query) => bible.search(versionId, query));
}
