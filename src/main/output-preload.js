import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cueOutput', {
  onSlideUpdate:   (cb) => ipcRenderer.on('slide:update',   (_e, p) => cb(p)),
  onStageTimer:    (cb) => ipcRenderer.on('stage:timer',    (_e, p) => cb(p)),
  onStageMessage:  (cb) => ipcRenderer.on('stage:message',  (_e, p) => cb(p)),
  onGraphicUpdate: (cb) => ipcRenderer.on('graphic:update', (_e, p) => cb(p)),
  // Runtime content-mode toggle (lyrics band / graphics overlay) — avoids
  // recreating the window (and dropping the NDI sender) on a mode switch.
  onContentMode: (cb) => ipcRenderer.on('content:mode', (_e, p) => cb(p)),
  // Main-process foreground-media transport. Every player derives its playhead
  // from this shared, machine-clock-based state.
  onMediaTransport: (cb) => {
    const wrapper = (_e, t) => cb(t);
    ipcRenderer.on('media:transport', wrapper);
    return () => ipcRenderer.removeListener('media:transport', wrapper);
  },
});

// Inject any user-installed @font-face rules so custom families render on the
// output (NDI/screen) exactly as configured in the operator's editors. Font
// files are served through the cue-media:// protocol.
function injectUserFonts() {
  ipcRenderer.invoke('fonts:css').then((css) => {
    if (!css) return;
    const el = document.createElement('style');
    el.id = 'cue-user-fonts';
    el.textContent = css;
    document.head.appendChild(el);
  }).catch(() => {});
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectUserFonts);
} else {
  injectUserFonts();
}
