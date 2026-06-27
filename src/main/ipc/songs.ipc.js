import { ipcMain } from 'electron';
import * as songs from '../db/songs.js';
import { parseSongFiles } from '../import/songs-import.js';
import { searchSongs, fetchLyrics } from '../songs/song-scrape.js';

export function registerSongsIpc() {
  ipcMain.handle('songs:search', (_e, query) => songs.search(query));

  // Online Song Finder — search the web, then fetch+clean one candidate. Both
  // wrap errors into an { ok } envelope so a dead provider/network surfaces in the
  // modal instead of rejecting the IPC.
  ipcMain.handle('songScrape:search', async (_e, query) => {
    try { return { ok: true, results: await searchSongs(query) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('songScrape:fetch', async (_e, candidate) => {
    try { return { ok: true, ...(await fetchLyrics(candidate)) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('songs:matchTitles', (_e, rawText) => songs.matchTitles(rawText));
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
  ipcMain.handle('songs:setLock', (_e, songId, locked) => songs.setLock(songId, locked));
  ipcMain.handle('songs:deleteAll', () => songs.deleteAll());
  ipcMain.handle('songs:applyStyleToSong', (_e, songId, styleJson) => songs.applyStyleToSong(songId, styleJson));
  ipcMain.handle('tags:list', () => songs.listTags());
  ipcMain.handle('tags:create', (_e, data) => songs.createTag(data));
  ipcMain.handle('tags:update', (_e, id, data) => songs.updateTag(id, data));
  ipcMain.handle('tags:delete', (_e, id) => songs.deleteTag(id));
}
