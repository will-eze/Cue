// IPC + settings orchestration for the network control API (remote/server.js).
// Settings keys (key/value settings table):
//   remote_enabled (bool, default false) · remote_port (int, default 7373)
//   remote_lan (bool, default false)      · remote_token (string, generated on enable)
//   remote_output_enabled (bool, default false) — view-only program mirror surface
//   remote_view_token (string, generated on enable) — separate secret for /output

import { ipcMain } from 'electron';
import crypto from 'crypto';
import * as remoteServer from '../remote/server.js';
import * as settings from '../db/settings.js';

function readConfig() {
  return {
    enabled: settings.get('remote_enabled') ?? false,
    port:    settings.get('remote_port')    ?? 7373,
    lan:     settings.get('remote_lan')     ?? false,
    token:   settings.get('remote_token')   ?? null,
    outputEnabled: settings.get('remote_output_enabled') ?? false,
    viewToken:     settings.get('remote_view_token')     ?? null,
  };
}

function ensureToken(cfg) {
  if (!cfg.token) {
    cfg.token = crypto.randomBytes(16).toString('hex');
    settings.set('remote_token', cfg.token);
  }
  return cfg;
}

function ensureViewToken(cfg) {
  if (!cfg.viewToken) {
    cfg.viewToken = crypto.randomBytes(16).toString('hex');
    settings.set('remote_view_token', cfg.viewToken);
  }
  return cfg;
}

// Read settings, mint tokens if enabling without one, and (re)start the server.
// Called at boot and after every settings change. Returns the live config.
export async function applyRemoteConfig() {
  const cfg = readConfig();
  if (cfg.enabled) ensureToken(cfg);
  if (cfg.outputEnabled) ensureViewToken(cfg);
  return remoteServer.start(cfg);
}

export function registerRemoteIpc() {
  ipcMain.handle('remote:getConfig', () => remoteServer.getConfig());

  ipcMain.handle('remote:setConfig', async (_e, data = {}) => {
    if ('enabled' in data) settings.set('remote_enabled', !!data.enabled);
    if ('port' in data)    settings.set('remote_port', Math.max(1, Math.min(65535, parseInt(data.port, 10) || 7373)));
    if ('lan' in data)     settings.set('remote_lan', !!data.lan);
    if ('outputEnabled' in data) settings.set('remote_output_enabled', !!data.outputEnabled);
    return applyRemoteConfig();
  });

  ipcMain.handle('remote:regenerateToken', async () => {
    settings.set('remote_token', crypto.randomBytes(16).toString('hex'));
    return applyRemoteConfig();
  });

  ipcMain.handle('remote:regenerateViewToken', async () => {
    settings.set('remote_view_token', crypto.randomBytes(16).toString('hex'));
    return applyRemoteConfig();
  });

  // Renderer pushes the current rundown + preview/live selection so remote
  // clients can list and SELECT items. No-op if the server is stopped.
  ipcMain.handle('remote:navState', (_e, s) => remoteServer.setNavState(s));
}
