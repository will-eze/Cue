// IPC for scripture detection. Mirrors remote.ipc.js: thin handlers that delegate
// to the manager. The hot audio stream comes in as a fire-and-forget
// ipcRenderer.send (not invoke) — it's a high-rate path and needs no reply.

import { ipcMain } from 'electron';
import * as manager from '../scripture-detect/manager.js';

export function registerScriptureDetectIpc() {
  ipcMain.handle('scriptureDetect:getConfig', () => manager.getConfig());
  ipcMain.handle('scriptureDetect:setConfig', (_e, patch) => manager.setConfig(patch));
  ipcMain.handle('scriptureDetect:start', (_e, engine) => manager.start(engine));
  ipcMain.handle('scriptureDetect:stop', () => manager.stop());
  ipcMain.handle('scriptureDetect:ensureAsrModel', () => manager.ensureAsrModel());
  ipcMain.handle('scriptureDetect:buildVectors', (_e, versionId) => manager.buildVectors(versionId));
  ipcMain.handle('scriptureDetect:getGpuModelUsage', () => manager.getGpuModelUsage());

  // Utterance text from the renderer's WebGPU worker (VAD + ASR ran there). Fire-and-forget
  // like pushAudio; detection (parser/content-match) runs in main on the ingested text.
  ipcMain.on('scriptureDetect:ingestTranscript', (_e, payload) => manager.ingestTranscript(payload));

  // High-rate PCM frames from the renderer's AudioWorklet. Int16 PCM arrives as a
  // transferable ArrayBuffer; wrap it back into an Int16Array for the ASR buffer.
  ipcMain.on('scriptureDetect:pushAudio', (_e, buf) => {
    if (buf) manager.pushAudio(new Int16Array(buf));
  });
}
