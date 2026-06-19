import { ipcMain } from 'electron';
import * as scenes from '../db/scenes.js';
import * as outputManager from '../output/manager.js';

export function registerScenesIpc() {
  ipcMain.handle('scenes:list', () => scenes.list());
  ipcMain.handle('scenes:get', (_e, id) => scenes.get(id));
  ipcMain.handle('scenes:create', (_e, data) => scenes.create(data));
  ipcMain.handle('scenes:update', (_e, id, data) => scenes.update(id, data));
  ipcMain.handle('scenes:delete', (_e, id) => scenes.del(id));
  ipcMain.handle('scenes:reorder', (_e, orderedIds) => scenes.reorder(orderedIds));
  // Apply — accepts a DB row OR a live-preview object; normalize, then drive the
  // live output bus atomically in the manager.
  ipcMain.handle('scenes:apply', (_e, scene) => outputManager.applyScene(scenes.normalizeScene(scene)));
}
