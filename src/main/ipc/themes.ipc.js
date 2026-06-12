import { ipcMain } from 'electron';
import * as themes from '../db/themes.js';

export function registerThemesIpc() {
  ipcMain.handle('themes:list',           ()          => themes.list());
  ipcMain.handle('themes:get',            (_e, id)    => themes.get(id));
  ipcMain.handle('themes:create',         (_e, data)  => themes.create(data));
  ipcMain.handle('themes:update',         (_e, id, d) => themes.update(id, d));
  ipcMain.handle('themes:delete',         (_e, id)    => themes.del(id));
  ipcMain.handle('themes:applyToSong',    (_e, themeId, songId, setBg)    => themes.applyToSong(themeId, songId, setBg));
  ipcMain.handle('themes:applyToRundown', (_e, themeId, serviceId, setBg) => themes.applyToRundown(themeId, serviceId, setBg));
  ipcMain.handle('themes:applyToAllSongs',(_e, themeId, setBg)            => themes.applyToAllSongs(themeId, setBg));
}
