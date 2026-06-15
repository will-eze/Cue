import { ipcMain } from 'electron';
import * as graphics from '../db/graphics.js';

export function registerGraphicsIpc() {
  ipcMain.handle('graphics:list', () => graphics.list());
  ipcMain.handle('graphics:get', (_e, id) => graphics.get(id));
  ipcMain.handle('graphics:create', (_e, data) => graphics.create(data));
  ipcMain.handle('graphics:update', (_e, id, data) => graphics.update(id, data));
  ipcMain.handle('graphics:delete', (_e, id) => graphics.del(id));
  ipcMain.handle('graphics:reorder', (_e, orderedIds) => graphics.reorder(orderedIds));
  ipcMain.handle('graphics:presets', () => graphics.presets());
}
