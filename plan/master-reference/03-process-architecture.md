## 3. Process Architecture

Three types of Chromium/Node processes run simultaneously:

```
Main process (Node.js)
  ├── SQLite (better-sqlite3, synchronous)
  ├── File system (media import/serve)
  ├── IPC bridge (ipcMain.handle)
  ├── Output window lifecycle
  └── NDI (grandi wrapper — active, publishes BGRA frames)

Renderer process (Chromium + React)
  └── Operator UI — communicates with main only via window.cue (contextBridge)
      Never has direct Node.js access. nodeIntegration: false always.

Output windows (Chromium, 1+ instances)
  ├── Loaded from src/output/fullscreen.html or lowerthird.html
  ├── Plain HTML/JS (no React, no Vite)
  ├── Minimal preload: window.cueOutput.onSlideUpdate(callback)
  └── Receive slide:update IPC from main process manager.js
```

**Security rule:** `nodeIntegration: false` on every window. All Node/SQLite access is main-process only, exposed through contextBridge.

---
