# Session Handoff — Backup & Restore Bundle
**Date**: 2026-06-12
**Session focus**: Roadmap item #8 — export/import the whole installation as a single `.cuebackup` file (cue.db + media/)

---

## Context Coming In

Cue's entire user state lives in two places on disk: the single SQLite file
`cue.db` and the `media/` folder under `userData`. That's trivially backed up by
hand, but there was no in-app UI for it — and a live ministry/broadcast can't
afford to lose the database. The task was to add export/import of a single
`.cuebackup` bundle, surfaced in Settings, with a confirm-and-replace restore.

---

## What Was Built

A `.cuebackup` is a **gzipped tar** of `cue.db` + `media/`. Everything else
(bundled bibles, GHS hymnal) re-seeds on launch, so that pair is a complete,
portable snapshot. Used `tar` (node-tar) — already present as a transitive dep,
handles both create and extract, pure JS.

### Main process

**`src/main/db/backup.js` (new)**
- `exportBackup(destPath)` — runs `wal_checkpoint(TRUNCATE)` so the copied
  `cue.db` is complete (recent writes in `cue.db-wal` would otherwise be lost),
  then `tar.create({ gzip, file: destPath, cwd: userData }, ['cue.db', 'media'])`.
  Returns `{ ok, path, size }`.
- `importBackup(srcPath)` — extracts to a temp dir, **validates before touching
  live files** (opens the staged DB read-only and checks `settings`+`songs`
  tables exist; a corrupt/unrelated archive aborts here leaving the install
  untouched). Then the "point of no return": `closeDb()`, delete
  `cue.db`/`-wal`/`-shm`, copy staged DB into place, replace `media/`.
- **Critical detail — media path rewrite:** `media_assets.path` is stored
  **absolute**, so a backup restored on a different machine/account would point
  at the old `userData` dir. After the swap, `importBackup` reopens the DB and
  rewrites every `media_assets.path` to `path.join(localMediaDir, basename)`.
  This is what makes restore portable across machines.

**`src/main/db/schema.js`**
- Added `closeDb()` — checkpoints WAL on close and releases the `cue.db` handle
  so the file can be swapped.

**`src/main/ipc/settings.ipc.js`**
- `settings:exportBackup` — shows native save dialog (`Cue <date>.cuebackup`),
  then `backup.exportBackup`.
- `settings:importBackup` — shows open dialog, then `backup.importBackup`, then
  on success `setTimeout(() => { app.relaunch(); app.exit(0); }, 400)`. The 400ms
  beat lets the IPC reply reach the renderer and its toast paint before the
  window is torn down. Relaunch is the safest reset — every process (renderer,
  output windows, DB connections) re-reads the restored state.

**`src/main/preload.js`**
- Exposed `cue.settings.exportBackup()` / `cue.settings.importBackup()` (no args;
  dialogs live in main).

### Renderer

**`src/renderer/settings/DataSettings.jsx` (new)**
- "Data" card: Export button, and a confirm-gated Restore
  ("Overwrite all?" → "Choose file"). Shows current media disk usage. Toast
  feedback (tertiary=ok, error=fail). Follows existing settings-card styling and
  the semantic colour tokens (blue=primary on export, red=destructive on
  restore).

**`src/renderer/views/SettingsView.jsx`**
- Added the `data` section (icon `database`) to `SECTIONS` and the scroll body,
  between Remote and Danger.

### Build

- `tar` promoted to a **direct** dependency (`package.json`) and **externalized**
  in `vite.main.config.js` alongside `better-sqlite3` (loaded from node_modules
  at runtime, not bundled).

---

## Verification

- Main bundle builds clean: `vite build --config vite.main.config.js --ssr src/main/index.js` (26 modules).
- Standalone test confirmed the gzip tar round-trip preserves DB + media **bytes
  exactly** and lists the right entries (`cue.db media/ media/a.png media/b.mp4` → PASS).
- The full export→restore flow incl. the sqlite path-rewrite could **not** be run
  under plain Node because `better-sqlite3` is compiled against Electron's ABI
  (NODE_MODULE_VERSION 123 vs system 115). That path is trivial SQL but only
  runnable inside the app.

---

## Follow-ups / Open Items

- **Not yet exercised live.** Worth a `/verify` pass: click through an actual
  export, then a restore, confirm media resolves and the relaunch is clean.
- Restore does a hard `app.relaunch()` mid-session. Intentional (it's overwriting
  the live DB) and behind a confirm, but note it closes the app.
- Dev caveat: under `npm start` (electron-forge) `app.relaunch()` may not respawn
  as cleanly as in a packaged build; production relaunch is fine.

---

## Files Touched

- `src/main/db/backup.js` (new)
- `src/main/db/schema.js` (`closeDb`)
- `src/main/ipc/settings.ipc.js` (export/import handlers, dialogs, relaunch)
- `src/main/preload.js` (expose `exportBackup`/`importBackup`)
- `src/renderer/settings/DataSettings.jsx` (new)
- `src/renderer/views/SettingsView.jsx` (Data nav + section)
- `vite.main.config.js` (externalize `tar`)
- `package.json` / `package-lock.json` (`tar` direct dep)
