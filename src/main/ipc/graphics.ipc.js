import { ipcMain } from 'electron';
import * as graphics from '../db/graphics.js';

const h = (fn) => async (e, ...args) => {
  try { return await fn(e, ...args); } catch (err) { throw new Error(err.message); }
};

export function registerGraphicsIpc() {
  ipcMain.handle('graphics:list', h(() => graphics.list()));
  ipcMain.handle('graphics:get', h((_e, id) => graphics.get(id)));
  ipcMain.handle('graphics:create', h((_e, data) => graphics.create(data)));
  ipcMain.handle('graphics:update', h((_e, id, data) => graphics.update(id, data)));
  ipcMain.handle('graphics:delete', h((_e, id) => graphics.del(id)));
  ipcMain.handle('graphics:reorder', h((_e, orderedIds) => graphics.reorder(orderedIds)));
  ipcMain.handle('graphics:presets', h(() => graphics.presets()));
}
