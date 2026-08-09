import { ipcMain, screen, app } from 'electron';
import path from 'path';
import fs from 'fs';
import * as outputManager from '../output/manager.js';
import { getDb } from '../db/schema.js';

export function registerOutputIpc() {
  // ── Transport ──────────────────────────────────────────────────────────────
  ipcMain.handle('output:go', (_e, payload) => outputManager.go(payload));
  ipcMain.handle('output:clear', () => outputManager.clear());
  ipcMain.handle('output:logo', () => outputManager.logo());
  // Read-only: what `channelId` would show in logo mode (per-channel override → global).
  ipcMain.handle('output:logo-info', (_e, channelId) => outputManager.getLogoInfo(channelId));
  ipcMain.handle('output:setLive', (_e, enabled) => outputManager.setOutputsEnabled(enabled));
  ipcMain.handle('output:getState', () => outputManager.getState());
  ipcMain.handle('output:media:control', (_e, action) => outputManager.mediaControl(action));
  ipcMain.handle('output:media:seek', (_e, pos) => outputManager.mediaSeek(pos));
  ipcMain.handle('output:media:set-muted', (_e, muted) => outputManager.mediaSetMuted(muted));
  ipcMain.handle('output:media:set-loop', (_e, loop) => outputManager.mediaSetLoop(loop));
  ipcMain.handle('output:media:set-rate', (_e, rate) => outputManager.mediaSetRate(rate));

  // In-room program audio output device (setSinkId routing). Get returns the stored
  // descriptor (or null = system default); set persists AND broadcasts to live
  // output windows so the change applies without restarting output.
  ipcMain.handle('output:audio-device:get', () => outputManager.getProgramAudioDevice());
  ipcMain.handle('output:audio-device:set', (_e, device) => outputManager.setProgramAudioDevice(device));

  // Program-audio PCM from the primary IN-ROOM audio window's tap → NDI audio.
  // One-way + high-rate, so it uses ipcMain.on (not handle/invoke).
  ipcMain.on('output:audio-pcm', (_e, buffer, meta) => outputManager.ingestAudioPcm(buffer, meta));
  // Stream-window tap PCM (external feed + optional Cue media) → RTMP audio.
  ipcMain.on('output:stream-audio-pcm', (_e, buffer, meta) => outputManager.ingestStreamAudioPcm(buffer, meta));
  // Stereo peak levels from the stream window's meter → Stream tab (one-way, ~20Hz).
  ipcMain.on('output:stream-levels', (_e, lv) => outputManager.ingestStreamLevels(lv));

  // Source of the PCM-tap AudioWorklet. Read in main (Node fs IS asar-aware) so the
  // output window can load it via a blob: URL — AudioWorklet.addModule cannot
  // reliably fetch a module from INSIDE app.asar, and src/output is not unpacked.
  ipcMain.handle('audio:worklet-source', () => {
    try {
      return fs.readFileSync(path.join(app.getAppPath(), 'src', 'output', 'pcm-tap-worklet.js'), 'utf8');
    } catch { return null; }
  });

  // ── Streaming (RTMP → YouTube/Facebook/Twitch) ─────────────────────────────
  ipcMain.handle('output:stream:start', () => outputManager.startStream());
  ipcMain.handle('output:stream:stop', () => outputManager.stopStream());
  ipcMain.handle('output:stream:status', () => outputManager.getStreamStatus());
  ipcMain.handle('output:stream:config:get', () => outputManager.getStreamConfig());
  ipcMain.handle('output:stream:config:set', (_e, cfg) => outputManager.setStreamConfig(cfg));
  // Stream studio (external feed + layout/cut). open/close ref-count the compositor
  // window so it stays up for live preview while the Stream tab is open.
  ipcMain.handle('output:stream:studio:get', () => outputManager.getStreamStudio());
  ipcMain.handle('output:stream:studio:set', (_e, cfg) => outputManager.setStreamStudio(cfg));
  ipcMain.handle('output:stream:studio:open', () => outputManager.openStreamStudio());
  ipcMain.handle('output:stream:studio:close', () => outputManager.closeStreamStudio());
  // Saveable layout presets (named snapshots of the free-form feed/program composition).
  ipcMain.handle('output:stream:presets:get', () => outputManager.getStreamPresets());
  ipcMain.handle('output:stream:presets:save', (_e, p) => outputManager.saveStreamPreset(p));
  ipcMain.handle('output:stream:presets:delete', (_e, id) => outputManager.deleteStreamPreset(id));

  // ── Screens (connected displays) ───────────────────────────────────────────
  ipcMain.handle('output:screens:list', () => {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      primary: d.id === primaryId,
      label: d.label || `Display ${i + 1} · ${d.bounds.width}×${d.bounds.height}`,
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
        `INSERT INTO output_channels (name, type, template, ndi_fps, ndi_width, ndi_height, ndi_audio_muted, show_program, show_graphics, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.name,
        data.type || 'screen',
        data.template || 'fullscreen',
        data.ndi_fps || 30,
        data.ndi_width || 1920,
        data.ndi_height || 1080,
        data.ndi_audio_muted !== undefined ? (data.ndi_audio_muted ? 1 : 0) : 1,
        data.show_program !== undefined ? (data.show_program ? 1 : 0) : 1,
        data.show_graphics !== undefined ? (data.show_graphics ? 1 : 0) : 1,
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
      'logo_override_id', 'ndi_audio_muted', 'show_program', 'show_graphics', 'active'];
    for (const k of allowed) {
      if (k in data) { fields.push(`${k} = ?`); vals.push(data[k]); }
    }
    if (fields.length) {
      db.prepare(`UPDATE output_channels SET ${fields.join(', ')} WHERE id = ?`).run(...vals, id);
    }
    // A content-mode-only change (lyrics/graphics visibility) is applied at runtime
    // so the window — and any NDI sender — is never recreated. Structural changes
    // (template, type, monitors, active…) still rebuild the window via syncChannel.
    const changedKeys = Object.keys(data);
    const contentModeOnly = changedKeys.length > 0 &&
      changedKeys.every((k) => k === 'show_program' || k === 'show_graphics');
    if (contentModeOnly) outputManager.setChannelContentMode(id);
    else await outputManager.syncChannel(id);
    return db.prepare('SELECT * FROM output_channels WHERE id = ?').get(id);
  });

  ipcMain.handle('output:channels:delete', async (_e, id) => {
    outputManager.closeChannel(id);
    // CASCADE deletes channel_monitors rows too (FK ON DELETE CASCADE).
    getDb().prepare('DELETE FROM output_channels WHERE id = ?').run(id);
  });

  // ── Stage display ──────────────────────────────────────────────────────────
  ipcMain.handle('output:stage:message', (_e, text) => outputManager.setStageMessage(text));
  ipcMain.handle('output:stage:timer',   (_e, action, seconds) => outputManager.stageTimerCmd(action, seconds));
  ipcMain.handle('output:stage:timer:get',       ()       => outputManager.getStageTimer());
  ipcMain.handle('output:stage:message:get',     ()       => outputManager.getStageMessage());
  ipcMain.handle('output:stage:schedule:get',    ()       => outputManager.getStageSchedule());
  ipcMain.handle('output:stage:schedule:add',    (_e, m)  => outputManager.scheduleStageMessage(m));
  ipcMain.handle('output:stage:schedule:remove', (_e, id) => outputManager.unscheduleStageMessage(id));

  // Customisable WYSIWYG stage layout (per channel) + reusable named presets.
  ipcMain.handle('output:stage:layout:get', (_e, channelId)         => outputManager.getStageLayout(channelId));
  ipcMain.handle('output:stage:layout:set', (_e, channelId, layout) => outputManager.setStageLayout(channelId, layout));
  ipcMain.handle('output:stage:preset:list',   ()        => outputManager.getStagePresets());
  ipcMain.handle('output:stage:preset:save',   (_e, p)   => outputManager.saveStagePreset(p));
  ipcMain.handle('output:stage:preset:delete', (_e, id)  => outputManager.deleteStagePreset(id));

  // ── Lower-third appearance ─────────────────────────────────────────────────
  ipcMain.handle('output:lowerthird:set-font-scale', (_e, pct) => outputManager.setLowerthirdFontScale(pct));

  // ── Broadcast graphics overlay (independent of the program bus) ────────────
  ipcMain.handle('output:graphic:show', (_e, data) => outputManager.graphicShow(data));
  ipcMain.handle('output:graphic:hide', (_e, target) => outputManager.graphicHide(target));
  ipcMain.handle('output:ticker:show',  (_e, data) => outputManager.tickerShow(data));
  ipcMain.handle('output:ticker:hide',  (_e, target) => outputManager.tickerHide(target));
  ipcMain.handle('output:custom:show',  (_e, data) => outputManager.customShow(data));
  ipcMain.handle('output:custom:hide',  (_e, target) => outputManager.customHide(target));
  ipcMain.handle('output:countdown:show', (_e, data) => outputManager.countdownShow(data));
  ipcMain.handle('output:countdown:hide', (_e, target) => outputManager.countdownHide(target));
  ipcMain.handle('output:countdown:pause', (_e, target) => outputManager.countdownPause(target));
  ipcMain.handle('output:countdown:resume', (_e, target) => outputManager.countdownResume(target));
  ipcMain.handle('output:overlay:get',  () => outputManager.getOverlay());

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
