import { ipcMain } from 'electron';
import * as media from '../db/media.js';

const h = (fn) => async (e, ...args) => {
  try { return await fn(e, ...args); } catch (err) { throw new Error(err.message); }
};

export function registerMediaIpc() {
  ipcMain.handle('media:import', h((_e, filePaths) => media.importFiles(filePaths)));
  ipcMain.handle('media:get', h((_e, id) => media.getById(id)));
  ipcMain.handle('media:list', h((_e, folderId) => media.list(folderId)));
  ipcMain.handle('media:listAll', h(() => media.listAll()));
  ipcMain.handle('media:delete', h((_e, id) => media.del(id)));
  ipcMain.handle('media:deleteMany', h((_e, ids) => media.deleteMany(ids)));
  ipcMain.handle('media:deleteAll', h(() => media.deleteAllMedia()));
  ipcMain.handle('media:findUnused', h(() => media.findUnused()));
  ipcMain.handle('media:folders:create', h((_e, name, parentId) => media.createFolder(name, parentId)));
  ipcMain.handle('media:folders:rename', h((_e, id, name) => media.renameFolder(id, name)));
  ipcMain.handle('media:folders:delete', h((_e, id) => media.deleteFolder(id)));
  ipcMain.handle('media:folders:tree', h(() => media.getFolderTree()));
  ipcMain.handle('media:getDiskUsage', h(() => media.getDiskUsage()));
  ipcMain.handle('media:getMediaDir', h(() => media.getMediaDir()));
}
