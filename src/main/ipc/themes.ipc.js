import { ipcMain } from 'electron';
import * as themes from '../db/themes.js';

export function registerThemesIpc() {
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
}
