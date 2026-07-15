import { ipcMain } from 'electron';
import * as ndiInput from '../output/ndi-input.js';
import * as outputManager from '../output/manager.js';
import { isAvailable } from '../output/ndi.js';

// Live video inputs (NDI receive). Discovery + operator preview; the program
// routing itself is driven by the output manager from the live payload. The
// whole feature sits behind a persisted master enable (the mid-service kill
// switch) — when off, discovery/preview refuse and the manager never pulls.
export function registerLiveInputIpc() {
  // Warm NDI discovery in the background at startup (unless the kill switch is
  // off) so the first Live-tab open finds an already-populated source list.
  if (outputManager.getLiveInputsEnabled()) ndiInput.warmUp();

  // waitMs lets the FIRST call block briefly so the initial picker isn't empty;
  // the renderer polls afterwards with waitMs=0 (instant snapshot).
  ipcMain.handle('liveInput:sources', async (_e, waitMs) => {
    if (!outputManager.getLiveInputsEnabled()) return { available: isAvailable(), enabled: false, sources: [] };
    const r = await ndiInput.listSources(Number(waitMs) || 0);
    return { ...r, enabled: true };
  });
  ipcMain.handle('liveInput:available', () => isAvailable());
  ipcMain.handle('liveInput:getEnabled', () => outputManager.getLiveInputsEnabled());
  ipcMain.handle('liveInput:setEnabled', (_e, v) => outputManager.setLiveInputsEnabled(!!v));
  ipcMain.handle('liveInput:previewStart', (_e, sourceName) => {
    if (!outputManager.getLiveInputsEnabled()) return { ok: false, enabled: false };
    return ndiInput.previewStart(String(sourceName || ''));
  });
  ipcMain.handle('liveInput:previewStop', (_e, sourceName) => ndiInput.previewStop(String(sourceName || '')));
}
