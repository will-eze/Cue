import { ipcMain } from 'electron';
import * as media from '../db/media.js';

export function registerMediaIpc() {
  ipcMain.handle('media:import', (_e, filePaths) => media.importFiles(filePaths));
  ipcMain.handle('media:get', (_e, id) => media.getById(id));
  ipcMain.handle('media:list', (_e, folderId) => media.list(folderId));
  ipcMain.handle('media:delete', (_e, id) => media.del(id));
  ipcMain.handle('media:deleteMany', (_e, ids) => media.deleteMany(ids));
  ipcMain.handle('media:findUnused', () => media.findUnused());
  ipcMain.handle('media:folders:create', (_e, name, parentId) => media.createFolder(name, parentId));
  ipcMain.handle('media:folders:rename', (_e, id, name) => media.renameFolder(id, name));
  ipcMain.handle('media:folders:delete', (_e, id) => media.deleteFolder(id));
  ipcMain.handle('media:folders:tree', () => media.getFolderTree());
  ipcMain.handle('media:getDiskUsage', () => media.getDiskUsage());
  ipcMain.handle('media:getMediaDir', () => media.getMediaDir());
}
