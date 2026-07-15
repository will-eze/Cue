import { ipcMain } from 'electron';
import * as outputPresets from '../db/output-presets.js';

const h = (fn) => async (e, ...args) => {
  try { return await fn(e, ...args); } catch (err) { throw new Error(err.message); }
};

// Pure CRUD. Apply is renderer-orchestrated (OutputPresetsPanel replays the snapshot
// through the existing output IPC), so there is no apply handler here — unlike scenes.
export function registerOutputPresetsIpc() {
  ipcMain.handle('outputPresets:list', h(() => outputPresets.list()));
  ipcMain.handle('outputPresets:get', h((_e, id) => outputPresets.get(id)));
  ipcMain.handle('outputPresets:create', h((_e, data) => outputPresets.create(data)));
  ipcMain.handle('outputPresets:update', h((_e, id, data) => outputPresets.update(id, data)));
  ipcMain.handle('outputPresets:delete', h((_e, id) => outputPresets.del(id)));
  ipcMain.handle('outputPresets:reorder', h((_e, orderedIds) => outputPresets.reorder(orderedIds)));
}
