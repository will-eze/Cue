import { ipcMain, screen } from 'electron';
import * as outputManager from '../output/manager.js';
import { getDb } from '../db/schema.js';

export function registerOutputIpc() {
  ipcMain.handle('output:go', (_e, payload) => outputManager.go(payload));
  ipcMain.handle('output:clear', () => outputManager.clear());
  ipcMain.handle('output:logo', () => outputManager.logo());
  ipcMain.handle('output:getState', () => outputManager.getState());

  ipcMain.handle('output:channels:list', () =>
    getDb().prepare('SELECT * FROM output_channels ORDER BY id').all()
  );

  ipcMain.handle('output:channels:create', async (_e, data) => {
    const db = getDb();
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO output_channels (name, type, template, ndi_fps, ndi_width, ndi_height, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name, data.type,
      data.template || 'fullscreen',
      data.ndi_fps || 30,
      data.ndi_width || 1920,
      data.ndi_height || 1080,
      1
    );
    const channel = db.prepare('SELECT * FROM output_channels WHERE id = ?').get(lastInsertRowid);
    await outputManager.openChannel(channel);
    return channel;
  });

  ipcMain.handle('output:channels:update', async (_e, id, data) => {
    const db = getDb();
    const fields = [];
    const vals = [];
    const allowed = ['name', 'type', 'template', 'display_bounds', 'display_index',
      'linked_channel_id', 'ndi_fps', 'ndi_width', 'ndi_height', 'logo_override_id', 'active'];
    for (const k of allowed) {
      if (k in data) { fields.push(`${k} = ?`); vals.push(data[k]); }
    }
    if (fields.length) {
      db.prepare(`UPDATE output_channels SET ${fields.join(', ')} WHERE id = ?`).run(...vals, id);
    }
    await outputManager.syncChannel(id);
    return db.prepare('SELECT * FROM output_channels WHERE id = ?').get(id);
  });

  ipcMain.handle('output:channels:delete', async (_e, id) => {
    outputManager.closeChannel(id);
    getDb().prepare('DELETE FROM output_channels WHERE id = ?').run(id);
  });

  ipcMain.handle('output:screens:list', () => {
    const displays = screen.getAllDisplays();
    return displays.map((d) => ({
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      label: `${d.bounds.width}×${d.bounds.height} at (${d.bounds.x},${d.bounds.y})`,
    }));
  });
}
