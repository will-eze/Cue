import { ipcMain } from 'electron';
import * as services from '../db/services.js';
import { exportRundownPdf } from '../export/rundown-pdf.js';

const h = (fn) => async (e, ...args) => {
  try { return await fn(e, ...args); } catch (err) { throw new Error(err.message); }
};

export function registerServicesIpc() {
  ipcMain.handle('services:list', h(() => services.list()));
  ipcMain.handle('services:get', h((_e, id) => services.getById(id)));
  ipcMain.handle('services:create', h((_e, data) => services.create(data)));
  ipcMain.handle('services:update', h((_e, id, data) => services.update(id, data)));
  ipcMain.handle('services:delete', h((_e, id) => services.del(id)));
  ipcMain.handle('services:reorderItems', h((_e, serviceId, orderedIds) => services.reorderItems(serviceId, orderedIds)));
  ipcMain.handle('services:addItem', h((_e, serviceId, item) => services.addItem(serviceId, item)));
  ipcMain.handle('services:addItems', h((_e, serviceId, items) => services.addItems(serviceId, items)));
  ipcMain.handle('services:removeItem', h((_e, itemId) => services.removeItem(itemId)));
  ipcMain.handle('services:setItemBackground', h((_e, itemId, mediaId) => services.setItemBackground(itemId, mediaId)));
  ipcMain.handle('services:setItemLoop', h((_e, itemId, loop) => services.setItemLoop(itemId, loop)));
  ipcMain.handle('services:setItemAdvance', h((_e, itemId, seconds, loop, wrap) => services.setItemAdvance(itemId, seconds, loop, wrap)));
  ipcMain.handle('services:setServiceTheme', h((_e, serviceId, themeId) => services.setServiceTheme(serviceId, themeId)));
  ipcMain.handle('services:setItemTheme', h((_e, itemId, themeId) => services.setItemTheme(itemId, themeId)));
  ipcMain.handle('services:duplicateItem', h((_e, itemId) => services.duplicateItem(itemId)));
  ipcMain.handle('services:applyBackgroundToRundown', h((_e, serviceId, mediaId) =>
    services.applyBackgroundToRundown(serviceId, mediaId)));
  ipcMain.handle('services:clearItems', h((_e, serviceId) => services.clearItems(serviceId)));
  ipcMain.handle('services:exportPdf', h((_e, serviceId) => exportRundownPdf(serviceId)));
}
