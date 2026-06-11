import { ipcMain } from 'electron';
import * as songs from '../db/songs.js';
import { parseSongFiles } from '../import/songs-import.js';

export function registerSongsIpc() {
  ipcMain.handle('songs:search', (_e, query) => songs.search(query));
  ipcMain.handle('songs:importParse', (_e, filePaths) => parseSongFiles(filePaths));
  ipcMain.handle('songs:importGhs', () => songs.readBundledGhsRows());
  ipcMain.handle('songs:importCommit', (_e, parsedSongs) => songs.importSongs(parsedSongs));
  ipcMain.handle('songs:listAll', () => songs.listAll());
  ipcMain.handle('songs:get', (_e, id) => songs.getById(id));
  ipcMain.handle('songs:create', (_e, data) => songs.create(data));
  ipcMain.handle('songs:update', (_e, id, data) => songs.update(id, data));
  ipcMain.handle('songs:delete', (_e, id) => songs.del(id));
  ipcMain.handle('songs:addTag', (_e, songId, tagId) => songs.addTag(songId, tagId));
  ipcMain.handle('songs:removeTag', (_e, songId, tagId) => songs.removeTag(songId, tagId));
  ipcMain.handle('songs:setBackground', (_e, songId, mediaId) => songs.setBackground(songId, mediaId));
  ipcMain.handle('songs:deleteAll', () => songs.deleteAll());
  ipcMain.handle('tags:list', () => songs.listTags());
  ipcMain.handle('tags:create', (_e, data) => songs.createTag(data));
  ipcMain.handle('tags:update', (_e, id, data) => songs.updateTag(id, data));
  ipcMain.handle('tags:delete', (_e, id) => songs.deleteTag(id));
}
