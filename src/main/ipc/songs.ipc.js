import { ipcMain } from 'electron';
import * as songs from '../db/songs.js';
import { parseSongFiles } from '../import/songs-import.js';
import { searchSongs, fetchLyrics } from '../songs/song-scrape.js';

const h = (fn) => async (e, ...args) => {
  try { return await fn(e, ...args); } catch (err) { throw new Error(err.message); }
};

export function registerSongsIpc() {
  ipcMain.handle('songs:search', h((_e, query) => songs.search(query)));

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
  ipcMain.handle('songs:matchTitles', h((_e, rawText) => songs.matchTitles(rawText)));
  ipcMain.handle('songs:importParse', h((_e, filePaths) => parseSongFiles(filePaths)));
  ipcMain.handle('songs:importGhs', h(() => songs.readBundledGhsRows()));
  ipcMain.handle('songs:importCommit', h((_e, parsedSongs) => songs.importSongs(parsedSongs)));
  ipcMain.handle('songs:listAll', h(() => songs.listAll()));
  ipcMain.handle('songs:get', h((_e, id) => songs.getById(id)));
  ipcMain.handle('songs:create', h((_e, data) => songs.create(data)));
  ipcMain.handle('songs:update', h((_e, id, data) => songs.update(id, data)));
  ipcMain.handle('songs:delete', h((_e, id) => songs.del(id)));
  ipcMain.handle('songs:addTag', h((_e, songId, tagId) => songs.addTag(songId, tagId)));
  ipcMain.handle('songs:removeTag', h((_e, songId, tagId) => songs.removeTag(songId, tagId)));
  ipcMain.handle('songs:setBackground', h((_e, songId, mediaId) => songs.setBackground(songId, mediaId)));
  ipcMain.handle('songs:setLock', h((_e, songId, locked) => songs.setLock(songId, locked)));
  ipcMain.handle('songs:deleteAll', h(() => songs.deleteAll()));
  ipcMain.handle('songs:applyStyleToSong', h((_e, songId, styleJson) => songs.applyStyleToSong(songId, styleJson)));

  // CCLI usage reporting — log fires when a song goes live (deduped in db layer);
  // report aggregates a date range for display/CSV export.
  ipcMain.handle('songs:logUsage', h((_e, songId) => songs.logUsage(songId)));
  ipcMain.handle('songs:usageReport', h((_e, fromIso, toIso) => songs.usageReport(fromIso, toIso)));
  ipcMain.handle('songs:usageClear', h(() => songs.usageClear()));

  ipcMain.handle('tags:list', h(() => songs.listTags()));
  ipcMain.handle('tags:create', h((_e, data) => songs.createTag(data)));
  ipcMain.handle('tags:update', h((_e, id, data) => songs.updateTag(id, data)));
  ipcMain.handle('tags:delete', h((_e, id) => songs.deleteTag(id)));
}
