import { ipcMain } from 'electron';
import * as services from '../db/services.js';
import { exportRundownPdf } from '../export/rundown-pdf.js';

export function registerServicesIpc() {
  ipcMain.handle('services:list', () => services.list());
  ipcMain.handle('services:get', (_e, id) => services.getById(id));
  ipcMain.handle('services:create', (_e, data) => services.create(data));
  ipcMain.handle('services:update', (_e, id, data) => services.update(id, data));
  ipcMain.handle('services:delete', (_e, id) => services.del(id));
  ipcMain.handle('services:reorderItems', (_e, serviceId, orderedIds) => services.reorderItems(serviceId, orderedIds));
  ipcMain.handle('services:addItem', (_e, serviceId, item) => services.addItem(serviceId, item));
  ipcMain.handle('services:addItems', (_e, serviceId, items) => services.addItems(serviceId, items));
  ipcMain.handle('services:removeItem', (_e, itemId) => services.removeItem(itemId));
  ipcMain.handle('services:setItemBackground', (_e, itemId, mediaId) => services.setItemBackground(itemId, mediaId));
  ipcMain.handle('services:setItemNotes', (_e, itemId, notes) => services.setItemNotes(itemId, notes));
  ipcMain.handle('services:setItemLoop',  (_e, itemId, loop)  => services.setItemLoop(itemId, loop));
  ipcMain.handle('services:setItemAdvance', (_e, itemId, seconds, loop, wrap) => services.setItemAdvance(itemId, seconds, loop, wrap));
  ipcMain.handle('services:duplicateItem', (_e, itemId) => services.duplicateItem(itemId));
  ipcMain.handle('services:applyBackgroundToRundown', (_e, serviceId, mediaId) =>
    services.applyBackgroundToRundown(serviceId, mediaId));
  ipcMain.handle('services:clearItems', (_e, serviceId) => services.clearItems(serviceId));
  ipcMain.handle('services:exportPdf', (_e, serviceId) => exportRundownPdf(serviceId));
}
