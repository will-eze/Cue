import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cueOutput', {
  onSlideUpdate: (callback) => {
    ipcRenderer.on('slide:update', (_event, payload) => callback(payload));
  },
});
