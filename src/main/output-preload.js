import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cueOutput', {
  onSlideUpdate: (callback) => {
    ipcRenderer.on('slide:update', (_event, payload) => callback(payload));
  },
  onMediaControl: (callback) => {
    ipcRenderer.on('media:control', (_event, action) => callback(action));
  },
});
