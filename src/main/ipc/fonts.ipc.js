import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fonts from '../db/fonts.js';

export function registerFontsIpc() {
  ipcMain.handle('fonts:listUser', () => fonts.listUserFonts());
  ipcMain.handle('fonts:css', () => fonts.buildUserFontCss());

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
