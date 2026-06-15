import { ipcMain } from 'electron';
import * as bg from '../db/background-library.js';

export function registerBackgroundLibraryIpc() {
  ipcMain.handle('backgrounds:list', () => bg.list());
  ipcMain.handle('backgrounds:tagCounts', () => bg.tagCounts());
  ipcMain.handle('backgrounds:download', (_e, id) => bg.download(id));
  ipcMain.handle('backgrounds:applyAsDefault', (_e, id, surface, toAll) => bg.applyAsDefault(id, surface, toAll));
}
