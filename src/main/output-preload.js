import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cueOutput', {
  onSlideUpdate:   (cb) => ipcRenderer.on('slide:update',   (_e, p) => cb(p)),
  onStageTimer:    (cb) => ipcRenderer.on('stage:timer',    (_e, p) => cb(p)),
  onStageMessage:  (cb) => ipcRenderer.on('stage:message',  (_e, p) => cb(p)),
  onStageSchedule: (cb) => ipcRenderer.on('stage:schedule', (_e, p) => cb(p)),
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
  // Runtime change of the in-room program-audio output device. The descriptor is
  // {deviceId,label,groupId} or null (= system default); the template re-routes
  // the active media element via setSinkId.
  onAudioOutputDevice: (cb) => {
    const wrapper = (_e, d) => cb(d);
    ipcRenderer.on('audio:output-device', wrapper);
    return () => ipcRenderer.removeListener('audio:output-device', wrapper);
  },
  // Program-audio tap (NDI audio / streaming). Main toggles it on/off; only the
  // audible window actually runs it. sendAudioPcm ships batched planar Float32 PCM.
  onAudioTap: (cb) => {
    const wrapper = (_e, on) => cb(on);
    ipcRenderer.on('audio:tap', wrapper);
    return () => ipcRenderer.removeListener('audio:tap', wrapper);
  },
  sendAudioPcm: (buffer, meta) => ipcRenderer.send('output:audio-pcm', buffer, meta),
  // Worklet source text (read in main, asar-aware) for blob-URL loading.
  getWorkletSource: () => ipcRenderer.invoke('audio:worklet-source'),
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
