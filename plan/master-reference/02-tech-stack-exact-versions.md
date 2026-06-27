## 2. Tech Stack — Exact Versions

| Package | Version | Notes |
|---|---|---|
| `electron` | **30.0.9** | Pinned. Bump requires `npm run rebuild` to recompile native addons. |
| `better-sqlite3` | 11.1.2 | Synchronous SQLite. Must rebuild on Electron bump. |
| `react` / `react-dom` | 18.3.1 | — |
| `vite` | 5.3.1 | — |
| `@electron-forge/cli` | 7.4.0 | Packaging. `npm start` = dev. `npm run make` = distributable. |
| `@dnd-kit/core` | 6.1.0 | Drag-to-reorder in rundown panel and song editor. |
| `@dnd-kit/sortable` | 8.0.0 | — |
| `react-window` | 1.8.10 | Virtualised song list. |
| `@dnd-kit/utilities` | 3.2.2 | `CSS.Transform` helper for the sortable slide/section lists. |
| `pdfjs-dist` | **4.10.38** | PowerPoint import: rasterises the LibreOffice-converted PDF to per-slide images in the **renderer** (needs a DOM canvas). **Pinned to v4** — v5/v6 call `Promise.try` natively (Chromium 134+), which Electron 30's Chromium ~124 lacks, so the worker throws `Promise.try is not a function` and hangs forever. v4 ships a polyfill guard. Worker loaded via Vite `?worker` + `GlobalWorkerOptions.workerPort` (a `?url` workerSrc silently falls back to a slow main-thread "fake worker"). Bundled into the renderer (not externalized) → no `forge.config.js` change. |
| `qrcode` | 1.5.4 | Renders the Remote Output / control pairing QR codes locally to a data-URL in `RemoteSettings.jsx`. Vite-bundled into the renderer — no native/packaging/CSP impact. |
| `tailwindcss` | 3.4.4 | Operator UI styling. |
| `tar` | 6.2.1 | node-tar. Reads/writes the gzipped-tar `.cuebackup` bundle (backup/restore). Externalized in `vite.main.config.js`. |
| `grandi` | installed | NDI output. ESM-only; loaded at runtime via `createRequire` to bypass Vite's CJS bundler. Platform binaries: `@grandi/darwin-arm64`, `@grandi/darwin-x64`, `@grandi/win32-x64`, etc. Listed in `forge.config.js` `rebuildConfig.extraModules` and `vite.main.config.js` `external`. |

---
