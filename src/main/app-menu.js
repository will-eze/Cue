// Application menu + operator-window zoom.
//
// Zoom is handled HERE (before-input-event on the operator window), not by
// Electron's default View-menu roles. The default `zoomIn` role is bound to
// "CommandOrControl+Plus", which on Windows only matches Ctrl+Shift+= on a US/UK
// layout and never matches on layouts where "+" is its own key — so Ctrl− worked
// and Ctrl+ didn't, leaving the UI stuck zoomed out. We match by physical key
// code (Equal / NumpadAdd / Minus / NumpadSubtract / Digit0 / Numpad0) plus the
// produced character, and swallow the event so no menu role fires a second step.
//
// Zoom applies to the OPERATOR window only — output windows must stay 1:1 with
// the auditorium raster. The level is persisted (`ui_zoom_factor`) so an operator
// on a small laptop who zooms out keeps that size across launches.

import { app, Menu, ipcMain, shell } from 'electron';
import * as settings from './db/settings.js';

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const isMac = process.platform === 'darwin';

let mainWin = null;

function currentFactor() {
  if (!mainWin || mainWin.isDestroyed()) return 1;
  return mainWin.webContents.getZoomFactor() || 1;
}

function applyFactor(f) {
  if (!mainWin || mainWin.isDestroyed()) return;
  const clamped = Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.max(ZOOM_STEPS[0], f));
  mainWin.webContents.setZoomFactor(clamped);
  try { settings.set('ui_zoom_factor', clamped); } catch { /* DB not ready — not fatal */ }
}

export function zoomStep(dir) {
  const cur = currentFactor();
  // Next preset strictly above/below the current factor (tolerant of float drift).
  const next = dir > 0
    ? ZOOM_STEPS.find((s) => s > cur + 0.001)
    : [...ZOOM_STEPS].reverse().find((s) => s < cur - 0.001);
  if (next != null) applyFactor(next);
}

export function zoomReset() { applyFactor(1); }

// Map a before-input-event to a zoom action, or null.
function zoomActionFor(input) {
  if (input.type !== 'keyDown' || input.alt) return null;
  const mod = isMac ? input.meta : input.control;
  if (!mod) return null;
  const { code, key } = input;
  if (code === 'Equal' || code === 'NumpadAdd' || key === '+' || key === '=') return 'in';
  if (code === 'Minus' || code === 'NumpadSubtract' || key === '-' || key === '_') return 'out';
  if ((code === 'Digit0' || code === 'Numpad0' || key === '0') && !input.shift) return 'reset';
  return null;
}

function send(cmd) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('menu:command', cmd);
}

function buildTemplate() {
  const nav = (view, label, accelerator) => ({ label, accelerator, click: () => send({ type: 'navigate', view }) });
  // Zoom items show the familiar shortcut but don't register it — before-input-event
  // owns the keys (registering would double-step on platforms where both fire).
  const zoomItems = [
    { label: 'Actual Size', accelerator: 'CommandOrControl+0', registerAccelerator: false, click: zoomReset },
    { label: 'Zoom In',     accelerator: 'CommandOrControl+=', registerAccelerator: false, click: () => zoomStep(1) },
    { label: 'Zoom Out',    accelerator: 'CommandOrControl+-', registerAccelerator: false, click: () => zoomStep(-1) },
  ];
  return [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        // ⌘, is handled by the renderer (App.jsx) — shown here, not registered.
        { label: 'Settings…', accelerator: 'CommandOrControl+,', registerAccelerator: false, click: () => send({ type: 'navigate', view: 'settings' }) },
        { label: 'Check for Updates…', click: () => send({ type: 'navigate', view: 'settings' }) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Command Palette…', accelerator: 'CommandOrControl+K', registerAccelerator: false, click: () => send({ type: 'palette' }) },
        ...(isMac ? [] : [
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'Ctrl+,', registerAccelerator: false, click: () => send({ type: 'navigate', view: 'settings' }) },
        ]),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    // Edit roles keep native clipboard/undo working in every text field (a custom
    // menu without them breaks ⌘C/⌘V on macOS). The renderer still sees the keydown
    // first, so the app's own undo stacks and ⌘A behaviour are unaffected.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        nav('operator', 'Operator'),
        nav('multiview', 'Multiview'),
        nav('stream', 'Stream'),
        nav('stage', 'Stage'),
        { type: 'separator' },
        ...zoomItems,
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
      ],
    },
    {
      label: 'Window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { label: 'Maximize', click: () => { if (!mainWin) return; mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize(); } }],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: '?', registerAccelerator: false, click: () => send({ type: 'shortcuts' }) },
        { label: 'Release Notes', click: () => shell.openExternal('https://github.com/will-eze/Cue/releases') },
      ],
    },
  ];
}

export function installAppMenu(win) {
  mainWin = win;
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));

  win.webContents.on('before-input-event', (event, input) => {
    const action = zoomActionFor(input);
    if (!action) return;
    event.preventDefault();
    if (action === 'in') zoomStep(1);
    else if (action === 'out') zoomStep(-1);
    else zoomReset();
  });

  // Apply the persisted zoom (or 100%) once the page is up — setZoomFactor before
  // load is reset by navigation. Always set it, even at 1: Chromium can carry its
  // own per-origin level over from an earlier session, which is how a zoom got
  // "stuck" with no key that undid it.
  win.webContents.on('did-finish-load', () => {
    let saved = 1;
    try { saved = Number(settings.get('ui_zoom_factor')) || 1; } catch {}
    if (saved < ZOOM_STEPS[0] || saved > ZOOM_STEPS[ZOOM_STEPS.length - 1]) saved = 1;
    win.webContents.setZoomFactor(saved);
  });

  // Windows/Linux: the native menu bar is hidden by the custom titlebar, so the
  // renderer's menu button pops the same menu up under itself.
  ipcMain.removeHandler('app-menu:popup');
  ipcMain.handle('app-menu:popup', (_e, pos) => {
    const menu = Menu.getApplicationMenu();
    if (!menu || !mainWin || mainWin.isDestroyed()) return;
    menu.popup({ window: mainWin, x: Math.round(pos?.x ?? 0), y: Math.round(pos?.y ?? 0) });
  });
}
