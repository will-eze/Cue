// Network control API — Stream Deck / Companion / phone transport surface.
//
// A small main-process HTTP server (no extra dependencies — Node's http +
// Server-Sent Events for the live STATE push). It NEVER exposes Node or the DB:
// it only reads outputManager.getState() and forwards transport commands to the
// renderer, exactly the same actions the operator keyboard already drives. The
// renderer resolves GO/NEXT/PREV payloads (it owns the rundown + preview/live
// state), so navigation commands are sent on to it as `remote:command` events.
//
// Security: bound to 127.0.0.1 by default; LAN binding (0.0.0.0) is opt-in. Every
// /api/* request requires the pairing token (X-Cue-Token header or ?token=). The
// control page itself carries no secrets — it asks for the token in its URL.

import http from 'http';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { CONTROL_PAGE } from './control-page.js';
import { OUTPUT_PAGE } from './output-page.js';
import { serveLocalFile, MEDIA_MIME } from './media-serve.js';

let server = null;
// `token` gates the CONTROL surface (transport). `viewToken` gates the read-only
// OUTPUT surface (program mirror) — a separate secret so handing out a view link
// can never drive the service. `outputEnabled` toggles the output surface alone.
let config = { enabled: false, port: 7373, lan: false, token: null, viewToken: null, outputEnabled: false };

// Injected by index.js so this module stays decoupled from the manager/window.
let getStateFn = () => ({});
let commandHandler = () => {};
let getProgramFn = () => ({ slide: null, transport: null, overlay: null });

// Rundown snapshot pushed from the renderer so remote clients can list and
// SELECT items. Kept here (not the DB) because the operator's live/preview
// selection is renderer state, not persisted.
let navState = { items: [], previewItemId: null, liveItemId: null, liveSlideIdx: 0 };

// Open SSE responses — each receives a fresh state frame on every change.
const sseClients = new Set();
// Open SSE responses for the OUTPUT mirror — each gets program bus deltas.
const outputSseClients = new Set();

const ACTIONS = ['go', 'clear', 'logo', 'next', 'prev', 'live', 'select'];

export function configure({ getState, onCommand, getProgram }) {
  if (getState)   getStateFn = getState;
  if (onCommand)  commandHandler = onCommand;
  if (getProgram) getProgramFn = getProgram;
}

// ── Remote output (program mirror) ────────────────────────────────────────────
// Push a program bus delta ({slide} | {transport} | {overlay}) to browser viewers,
// stamped with serverNow so a viewer can correct its clock offset (its Date.now()
// may differ from this host's, which would desync media playback / countdowns).
export function pushProgram(delta) {
  if (!outputSseClients.size) return;
  const frame = `data: ${JSON.stringify({ serverNow: Date.now(), ...delta })}\n\n`;
  for (const res of outputSseClients) {
    try { res.write(frame); } catch {}
  }
}

// ── State ────────────────────────────────────────────────────────────────────

function fullState() {
  const base = getStateFn() || {};
  return {
    isLive:        base.isLive ?? false,
    displayMode:   base.displayMode ?? 'idle',
    outputsEnabled: base.outputsEnabled ?? true,
    // Surface just the audience-facing text bits a remote display needs.
    current: base.livePayload
      ? { text: base.livePayload.text ?? '', label: base.livePayload.sectionLabel ?? '', title: base.livePayload.title ?? '' }
      : null,
    next: base.livePayload
      ? { text: base.livePayload.nextText ?? '', label: base.livePayload.nextSectionLabel ?? '' }
      : null,
    rundown: navState,
  };
}

function broadcastState() {
  if (!sseClients.size) return;
  const frame = `data: ${JSON.stringify(fullState())}\n\n`;
  for (const res of sseClients) {
    try { res.write(frame); } catch {}
  }
}

// Called by the manager's state-changed hook and by the renderer nav push.
export function pushState() { broadcastState(); }

export function setNavState(s) {
  navState = {
    items: Array.isArray(s?.items) ? s.items : [],
    previewItemId: s?.previewItemId ?? null,
    liveItemId: s?.liveItemId ?? null,
    liveSlideIdx: s?.liveSlideIdx ?? 0,
  };
  broadcastState();
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function tokenFromReq(req, url) {
  return req.headers['x-cue-token'] || url.searchParams.get('token') || '';
}

function viewTokenFromReq(req, url) {
  return req.headers['x-cue-view-token'] || url.searchParams.get('vt') || '';
}

function validToken(provided, expected = config.token) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Static output assets (the browser program renderer) ───────────────────────
// The plain-DOM output scripts/CSS + bundled fonts, served from where packaging
// copies them (app.getAppPath()/src/output and /src/fonts). No secrets — these
// are the same files the local output windows load — so they're served ungated;
// only the program STREAM and MEDIA files carry the view token.
const STATIC_MIME = { js: 'text/javascript', css: 'text/css', html: 'text/html; charset=utf-8' };

function serveStaticAsset(baseRelDir, file, allowedExt, res) {
  const name = path.basename(file); // strip any traversal
  const ext = name.split('.').pop().toLowerCase();
  if (!allowedExt.includes(ext)) { res.writeHead(404); res.end('Not found'); return; }
  const abs = path.join(app.getAppPath(), baseRelDir, name);
  fs.readFile(abs, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': STATIC_MIME[ext] || MEDIA_MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

// ── Request handling ─────────────────────────────────────────────────────────

function readBody(req, cb) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1e5) req.destroy(); // hard cap; commands are tiny
  });
  req.on('end', () => cb(body));
  req.on('error', () => cb(''));
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

function dispatch(cmd, res) {
  if (!cmd || !ACTIONS.includes(cmd.action)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unknown action' }));
    return;
  }
  try { commandHandler(cmd); } catch (err) { console.error('[remote] command failed', err.message); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, state: fullState() }));
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  // The control page carries the pairing token in its URL; keep it out of the Referer
  // header so navigations/sub-requests can't leak it to another origin.
  res.setHeader('Referrer-Policy', 'no-referrer');
  // CORS so a browser-based controller on another origin can drive the surface.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cue-Token, X-Cue-View-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // The control web UI is public (it holds no secrets); it prompts for the token
  // and uses it for the protected /api calls below. Served only when the control
  // surface is enabled (the server may be running solely for Remote Output).
  if (path === '/' || path === '/index.html') {
    if (!config.enabled) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(CONTROL_PAGE);
    return;
  }

  // ── Remote output (view-only program mirror) ────────────────────────────────
  // The page shell + its scripts/CSS/fonts are public (no secrets); the live
  // program stream and the media files it pulls are gated by the view token.
  if (path === '/output' || path === '/output/' || path === '/output.html') {
    if (!config.outputEnabled) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(OUTPUT_PAGE);
    return;
  }
  if (path.startsWith('/output/assets/')) {
    serveStaticAsset('src/output', path.slice('/output/assets/'.length), ['js', 'css'], res);
    return;
  }
  if (path.startsWith('/output/fonts/')) {
    serveStaticAsset('src/fonts', path.slice('/output/fonts/'.length), ['css', 'woff2', 'woff', 'ttf', 'otf'], res);
    return;
  }
  if (path === '/output/stream' && req.method === 'GET') {
    if (!config.outputEnabled || !validToken(viewTokenFromReq(req, url), config.viewToken)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // Initial full frame so a late joiner renders the current program immediately.
    res.write(`data: ${JSON.stringify({ serverNow: Date.now(), ...(getProgramFn() || {}) })}\n\n`);
    outputSseClients.add(res);
    const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(keepAlive); outputSseClients.delete(res); });
    return;
  }
  if (path.startsWith('/output/media/') && req.method === 'GET') {
    if (!config.outputEnabled || !validToken(viewTokenFromReq(req, url), config.viewToken)) {
      res.writeHead(401); res.end('unauthorized');
      return;
    }
    const filePath = decodeURIComponent(path.slice('/output/media'.length)); // leading slash kept → absolute path
    serveLocalFile(filePath, req, res);
    return;
  }

  if (!path.startsWith('/api/')) { res.writeHead(404); res.end('Not found'); return; }

  // Control API only when the control surface is enabled.
  if (!config.enabled) { res.writeHead(404); res.end('Not found'); return; }

  if (!validToken(tokenFromReq(req, url))) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  // One-shot state read.
  if (path === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fullState()));
    return;
  }

  // Live state stream (Server-Sent Events). Replaces a WS push with zero deps.
  if (path === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(fullState())}\n\n`);
    sseClients.add(res);
    const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(keepAlive); sseClients.delete(res); });
    return;
  }

  // Command via POST body { action, ... } — used by the control page / Companion.
  if (path === '/api/command' && req.method === 'POST') {
    readBody(req, (body) => dispatch(safeJson(body) || {}, res));
    return;
  }

  // Convenience verbs: GET|POST /api/<action> (Stream Deck/Companion friendly).
  const m = path.match(/^\/api\/([a-z]+)$/);
  if (m && ACTIONS.includes(m[1])) {
    const action = m[1];
    const cmd = { action };
    if (action === 'select') {
      cmd.itemId = Number(url.searchParams.get('itemId'));
      // Optional: jump to a specific slide/verse within the item.
      if (url.searchParams.has('slideIdx')) cmd.slideIdx = Number(url.searchParams.get('slideIdx'));
    }
    dispatch(cmd, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function listUrls() {
  if (!server) return [];
  const urls = [`http://127.0.0.1:${config.port}`];
  if (config.lan) {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${config.port}`);
      }
    }
  }
  return urls;
}

export function getConfig() {
  return {
    enabled: config.enabled,
    port: config.port,
    lan: config.lan,
    token: config.token,
    outputEnabled: config.outputEnabled,
    viewToken: config.viewToken,
    running: !!server,
    urls: listUrls(),
  };
}

// Apply a config and (re)start. Always stops the previous server first so a port
// or LAN change takes effect cleanly. A disabled config just leaves it stopped.
export async function start(opts = {}) {
  await stop();
  config = { ...config, ...opts };
  // Run if EITHER surface is on — control (transport) and output (program mirror)
  // are independent toggles that share one server / port / LAN binding.
  if (!config.enabled && !config.outputEnabled) return getConfig();

  const host = config.lan ? '0.0.0.0' : '127.0.0.1';
  await new Promise((resolve) => {
    server = http.createServer(handleRequest);
    server.on('error', (err) => {
      console.error('[remote] server error:', err.message);
      server = null;
      resolve();
    });
    server.listen(config.port, host, () => {
      console.log(`[remote] listening on ${host}:${config.port}`);
      resolve();
    });
  });
  return getConfig();
}

export async function stop() {
  for (const res of sseClients) { try { res.end(); } catch {} }
  sseClients.clear();
  for (const res of outputSseClients) { try { res.end(); } catch {} }
  outputSseClients.clear();
  if (server) {
    await new Promise((r) => server.close(r));
    server = null;
  }
}
