## 19. App Startup Sequence

1. `protocol.registerSchemesAsPrivileged` — must be synchronous before app ready
2. `app.whenReady()`:
   a. `protocol.handle('cue-media', ...)` — register media file server
   b. `initDb()` — open SQLite, run pending migrations
   c. `seedBundledBibles()` — import any missing bundled translation (KJV + WEB) from `resources/bible/*.json` (matched by abbrev). Packaged path `process.resourcesPath/bible`; dev path `app.getAppPath()/resources/bible`.
   d. `seedGhsHymnal()` — first run only (gated by `ghs_seeded`): import the bundled GHS hymnal from `resources/ghs/ghs-hymnal.json`; then always `tagGhsSongs()` to backfill the GHS tag. Same packaged/dev path resolution as bibles.
   e. Register all IPC handlers (songs, services, media, output, settings, bible, graphics, themes, remote, fonts)
   f. `createMainWindow()` — show operator UI
   g. `remoteServer.configure(...)` + `outputManager.setRemoteStateListener(...)` + `await applyRemoteConfig()` — start the network control server if `remote_enabled`
   h. `outputManager.init()` — load active channels, create BrowserWindows
   i. On `did-finish-load`: send `output:unresolved-channels` and/or `output:ndi-unavailable` if needed. The renderer does not auto-navigate to Settings — the operator opens it manually.

---
