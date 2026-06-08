import { ipcMain } from 'electron';
import * as settings from '../db/settings.js';

export function registerSettingsIpc() {
  ipcMain.handle('settings:get', (_e, key) => settings.get(key));
  ipcMain.handle('settings:set', (_e, key, value) => settings.set(key, value));
  ipcMain.handle('settings:setGlobalLogo', (_e, mediaId) => settings.setGlobalLogo(mediaId));
  ipcMain.handle('settings:setGlobalBackground', (_e, type, mediaId) => settings.setGlobalBackground(type, mediaId));
  ipcMain.handle('settings:applyBackgroundToAll', (_e, type, mediaId) => settings.applyBackgroundToAll(type, mediaId));
  ipcMain.handle('settings:getDiskUsage', () => settings.getDiskUsage());
  ipcMain.handle('settings:getDataPath', () => settings.getDataPath());
  ipcMain.handle('settings:openDataFolder', () => settings.openDataFolder());
}
