import { ipcMain } from 'electron';
import * as scenes from '../db/scenes.js';
import * as outputManager from '../output/manager.js';

const h = (fn) => async (e, ...args) => {
  try { return await fn(e, ...args); } catch (err) { throw new Error(err.message); }
};

export function registerScenesIpc() {
  ipcMain.handle('scenes:list', h(() => scenes.list()));
  ipcMain.handle('scenes:get', h((_e, id) => scenes.get(id)));
  ipcMain.handle('scenes:create', h((_e, data) => scenes.create(data)));
  ipcMain.handle('scenes:update', h((_e, id, data) => scenes.update(id, data)));
  ipcMain.handle('scenes:delete', h((_e, id) => scenes.del(id)));
  ipcMain.handle('scenes:reorder', h((_e, orderedIds) => scenes.reorder(orderedIds)));
  // Apply — accepts a DB row OR a live-preview object; normalize, then drive the
  // live output bus atomically in the manager.
  ipcMain.handle('scenes:apply', h((_e, scene) => outputManager.applyScene(scenes.normalizeScene(scene))));
}
