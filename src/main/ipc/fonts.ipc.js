import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fonts from '../db/fonts.js';

// Tell every open window (operator + output) to re-pull the user/library font
// CSS, so a font downloaded mid-session renders immediately without a reload.
function broadcastFontRefresh() {
  for (const win of BrowserWindow.getAllWindows()) {
    try { win.webContents.send('fonts:refresh'); } catch { /* window gone */ }
  }
}

export function registerFontsIpc() {
  ipcMain.handle('fonts:listUser', () => fonts.listUserFonts());
  ipcMain.handle('fonts:css', () => fonts.buildUserFontCss());

  // Downloadable font library (open-licence, fetched on demand from @fontsource).
  ipcMain.handle('fonts:catalog', () => fonts.fontCatalog());
  // Preview faces for uninstalled fonts (tiny subsets, inlined) — empty until generated.
  ipcMain.handle('fonts:previewCss', () => fonts.buildPreviewFontCss());
  ipcMain.handle('fonts:download', async (_e, family) => {
    const r = await fonts.downloadLibraryFont(family);
    if (r.ok) broadcastFontRefresh();
    return r;
  });
  ipcMain.handle('fonts:deleteLibrary', (_e, family) => {
    const r = fonts.deleteLibraryFont(family);
    if (r.ok) broadcastFontRefresh();
    return r;
  });

  // Ensure-present-before-go-live: pre-download any downloadable font a rundown
  // references but doesn't have installed yet (determinism guard). Fired when a
  // rundown loads; refreshes font CSS if anything was fetched.
  ipcMain.handle('fonts:ensureService', async (_e, serviceId) => {
    if (!serviceId) return { missing: [], results: [] };
    const r = await fonts.ensureServiceFonts(serviceId);
    if (r.results.some((x) => x.ok && !x.already)) broadcastFontRefresh();
    return r;
  });

  // Open a file picker and import every chosen font file. Returns the new list
  // plus a per-file result so the UI can flag any unsupported/failed files.
  ipcMain.handle('fonts:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Install Fonts',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts', extensions: ['woff2', 'woff', 'ttf', 'otf'] }],
    });
    if (result.canceled || !result.filePaths?.length) return { ok: false, canceled: true };
    const added = [];
    const errors = [];
    for (const fp of result.filePaths) {
      const r = fonts.importFont(fp);
      if (r.ok) added.push(r.font);
      else errors.push({ file: fp, error: r.error });
    }
    return { ok: true, added, errors, list: fonts.listUserFonts() };
  });

  ipcMain.handle('fonts:delete', (_e, id) => fonts.deleteFont(id));
}
