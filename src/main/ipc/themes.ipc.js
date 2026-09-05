import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import * as themes from '../db/themes.js';

export function registerThemesIpc() {
  // ── Portable theme files (.cuetheme) ─────────────────────────────────────────
  // A theme is tiny JSON, so it exports/imports cleanly to share a look between
  // machines or people. A photo/video theme keeps its `bgRef` (a media-library id),
  // which re-resolves on first use on the destination — nothing large is embedded.
  ipcMain.handle('themes:export', async (e, themeId) => {
    const t = themes.get(themeId);
    if (!t) return { ok: false, error: 'Theme not found' };
    let style = {};
    try { style = t.style_json ? JSON.parse(t.style_json) : {}; } catch {}
    const payload = { cue_theme: 1, name: t.name, category: t.category || 'song', style };
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Theme',
      defaultPath: `${t.name.replace(/[^\w .-]+/g, '_')}.cuetheme`,
      filters: [{ name: 'Cue Theme', extensions: ['cuetheme'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try { fs.writeFileSync(filePath, JSON.stringify(payload, null, 2)); return { ok: true, filePath }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('themes:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import Theme',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Cue Theme', extensions: ['cuetheme', 'json'] }],
    });
    if (canceled || !filePaths?.length) return { ok: false, canceled: true };
    const added = [];
    for (const fp of filePaths) {
      try {
        const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (!obj?.name || !obj?.style) continue;
        const id = themes.create({ name: obj.name, style_json: JSON.stringify(obj.style), category: obj.category || 'song' });
        added.push({ id, name: obj.name });
      } catch { /* skip a bad file */ }
    }
    return { ok: added.length > 0, added, error: added.length ? null : 'No valid theme files' };
  });

  ipcMain.handle('themes:list',           ()          => themes.list());
  ipcMain.handle('themes:get',            (_e, id)    => themes.get(id));
  ipcMain.handle('themes:create',         (_e, data)  => themes.create(data));
  ipcMain.handle('themes:update',         (_e, id, d) => themes.update(id, d));
  ipcMain.handle('themes:delete',         (_e, id)    => themes.del(id));
  // resolveThemeBackground first downloads a media theme's bgRef into the library
  // (no-op for gradient/text/local-media themes) so applyTo* sees a background_id.
  ipcMain.handle('themes:applyToSong',    async (_e, themeId, songId, setBg)    => { if (setBg) await themes.resolveThemeBackground(themeId); return themes.applyToSong(themeId, songId, setBg); });
  ipcMain.handle('themes:applyToRundown', async (_e, themeId, serviceId, setBg) => { if (setBg) await themes.resolveThemeBackground(themeId); return themes.applyToRundown(themeId, serviceId, setBg); });
  ipcMain.handle('themes:applyToAllSongs',async (_e, themeId, setBg)            => { if (setBg) await themes.resolveThemeBackground(themeId); return themes.applyToAllSongs(themeId, setBg); });
  // Resolve a photo-backed presentation theme: download bgRef into the media library
  // (no-op if already resolved) and return the updated theme row with background_id set.
  ipcMain.handle('themes:resolveBackground', async (_e, themeId)                => { await themes.resolveThemeBackground(themeId); return themes.get(themeId); });
  // Reset baked looks so the live theme cascade takes over (the override the old
  // paint-bucket bake never allowed).
  ipcMain.handle('themes:resetSongToTheme',  (_e, songId) => themes.resetSongToTheme(songId));
  ipcMain.handle('themes:resetAllSongsToTheme', ()        => themes.resetAllSongsToTheme());
}
