import { ipcMain, screen } from 'electron';
import * as outputManager from '../output/manager.js';
import { getDb } from '../db/schema.js';

export function registerOutputIpc() {
  // ── Transport ──────────────────────────────────────────────────────────────
  ipcMain.handle('output:go', (_e, payload) => outputManager.go(payload));
  ipcMain.handle('output:clear', () => outputManager.clear());
  ipcMain.handle('output:logo', () => outputManager.logo());
  ipcMain.handle('output:setLive', (_e, enabled) => outputManager.setOutputsEnabled(enabled));
  ipcMain.handle('output:getState', () => outputManager.getState());

  // ── Screens (connected displays) ───────────────────────────────────────────
  ipcMain.handle('output:screens:list', () => {
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      label: `${d.bounds.width}×${d.bounds.height} at (${d.bounds.x},${d.bounds.y})`,
    }));
  });

  // ── Channels (content streams) ─────────────────────────────────────────────
  ipcMain.handle('output:channels:list', () =>
    getDb().prepare('SELECT * FROM output_channels ORDER BY id').all(),
  );

  ipcMain.handle('output:channels:create', async (_e, data) => {
    const db = getDb();
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO output_channels (name, type, template, ndi_fps, ndi_width, ndi_height, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.type || 'screen',
        data.template || 'fullscreen',
        data.ndi_fps || 30,
        data.ndi_width || 1920,
        data.ndi_height || 1080,
        1,
      );
    const channel = db.prepare('SELECT * FROM output_channels WHERE id = ?').get(lastInsertRowid);
    // NDI channels get a window immediately; screen channels wait for monitor assignment.
    if (channel.type === 'ndi') await outputManager.syncChannel(channel.id);
    return channel;
  });

  ipcMain.handle('output:channels:update', async (_e, id, data) => {
    const db = getDb();
    const fields = [];
    const vals = [];
    const allowed = ['name', 'type', 'template', 'ndi_fps', 'ndi_width', 'ndi_height',
      'logo_override_id', 'active'];
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
    // CASCADE deletes channel_monitors rows too (FK ON DELETE CASCADE).
    getDb().prepare('DELETE FROM output_channels WHERE id = ?').run(id);
  });

  // ── Multiview capture ──────────────────────────────────────────────────────
  ipcMain.handle('output:multiview:start', () => outputManager.startMultiviewCapture());
  ipcMain.handle('output:multiview:stop', () => outputManager.stopMultiviewCapture());

  // ── Monitors (physical screens assigned to a channel) ──────────────────────
  ipcMain.handle('output:monitors:list', (_e, channelId) => {
    const db = getDb();
    if (channelId != null) {
      return db
        .prepare('SELECT * FROM channel_monitors WHERE channel_id = ? ORDER BY id')
        .all(channelId);
    }
    return db.prepare('SELECT * FROM channel_monitors ORDER BY channel_id, id').all();
  });

  ipcMain.handle('output:monitors:create', async (_e, channelId, data) => {
    const db = getDb();
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO channel_monitors (channel_id, display_bounds, label, active)
         VALUES (?, ?, ?, 1)`,
      )
      .run(channelId, data.display_bounds, data.label || null);
    const monitor = db
      .prepare('SELECT * FROM channel_monitors WHERE id = ?')
      .get(lastInsertRowid);
    await outputManager.openMonitor(channelId, monitor);
    return monitor;
  });

  ipcMain.handle('output:monitors:delete', async (_e, monitorId) => {
    outputManager.closeMonitor(monitorId);
    getDb().prepare('DELETE FROM channel_monitors WHERE id = ?').run(monitorId);
  });
}
