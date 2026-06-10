import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cueOutput', {
  onSlideUpdate:   (cb) => ipcRenderer.on('slide:update',   (_e, p) => cb(p)),
  onStageTimer:    (cb) => ipcRenderer.on('stage:timer',    (_e, p) => cb(p)),
  onStageMessage:  (cb) => ipcRenderer.on('stage:message',  (_e, p) => cb(p)),
  // Main-process foreground-media transport. Every player derives its playhead
  // from this shared, machine-clock-based state.
  onMediaTransport: (cb) => {
    const wrapper = (_e, t) => cb(t);
    ipcRenderer.on('media:transport', wrapper);
    return () => ipcRenderer.removeListener('media:transport', wrapper);
  },
});
