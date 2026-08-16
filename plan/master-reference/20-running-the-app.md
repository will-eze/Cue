## 20. Running the App

```bash
npm start          # dev mode — Vite dev server + Electron, DevTools auto-open
npm run package    # package the .app/.exe bundle (no installer) — fast packaging check
npm run make       # build distributable (.dmg macOS, .exe Windows)
npm run rebuild    # recompile better-sqlite3 after Electron version bump
```

### Packaging — what Vite does not bundle

The Forge Vite plugin sets `packagerConfig.ignore` to drop everything except the `/.vite` build output, so anything not bundled by Vite is **absent from a packaged build even though it works in `npm start`** (where the full project tree, including `node_modules`, is on disk). Two classes of files are restored by the `packageAfterPrune` hook in `forge.config.js`:

1. **Native externals + their dependency closure.** `better-sqlite3`, `grandi` (+ the platform `@grandi/<os>-<arch>` binary), `tar`, `onnxruntime-node`, and `@huggingface/transformers` (the scripture-detection ASR/embedding runtime) are kept `external` in `vite.main.config.js` (native `.node` addons can't be bundled; `tar` does dynamic requires; the HF package is dynamic-imported ESM). The hook walks each module's production dependency tree (`collectClosure`) and copies the full closure into the packaged `node_modules`. It runs *after* Forge's prune so the copies survive into the asar. `grandi`'s binary lives in an `optionalDependency`, so only the one installed for the current build OS resolves — the closure naturally copies the correct per-platform binary.
   - **Step 1b — onnxruntime platform prune.** `onnxruntime-node` ships prebuilt binaries for *every* target (`bin/napi-v6/{darwin,linux,win32}/{x64,arm64}`, ~210 MB), but its loader only ever `require`s `bin/napi-v6/${process.platform}/${process.arch}/…`. The hook deletes every dir except the build's own platform/arch (from Forge's `afterPrune` `platform`/`arch` args), reclaiming ~150–175 MB from the package and the compressed installer (a Windows x64 build was otherwise shipping the macOS/Linux/ARM ONNX runtimes). **Keep this prune** — without it the installer re-bloats and the extra binaries never run.
2. **Plain-DOM output assets.** `src/output/*` (the projection / lower-third / stage HTML + their js/css) and `src/fonts/*` are not bundled by Vite, but `output/manager.js` loads them from `app.getAppPath()/src/output` at runtime. The hook copies both directories to the same relative path inside the asar. Without this every output window is a blank `ERR_FILE_NOT_FOUND`. (The hook also copies `embed-worker.js`, a `worker_thread` loaded by path, for the same reason.)

Native code must run from the real filesystem, not inside the asar: `grandi.node` links its sibling `libndi.dylib`/`.dll` via an `@loader_path` rpath, and `better-sqlite3` resolves its `.node` relative to its own location. `packagerConfig.asar.unpack: '**/node_modules/**'` keeps the whole copied tree in `app.asar.unpacked` with its internal layout intact.

**Implication:** adding a new runtime npm dependency that Vite externalizes, or a new output-window/font file, means updating the `packageAfterPrune` hook — otherwise the breakage appears only in packaged builds, never in dev. Verify a build with `npm run package` then launch `out/<name>/…app`.

### Distribution

Bundled resources (`resources/bible`, `resources/ghs`) are placed in `Contents/Resources/` via `extraResource` and read through `process.resourcesPath` when `app.isPackaged`.

**Windows installer is an NSIS wizard** (`installer/cue.nsi`), built by the `postMake` hook (not Squirrel — dropped for a real install-location picker, component checkboxes, and optional module prefetch). Per-user (`RequestExecutionLevel user`, `InstallDir $LOCALAPPDATA\Programs\Cue`, `InstallDirRegKey` so updates reuse the prior dir), so the in-app updater re-runs it with **no UAC prompt**. The maker-zip win32 output is a harmless by-product; the release glob matches `*.exe`. The in-app updater (§7) launches this Setup **silently** on Windows update (`spawn(setup, ['/S'])`), which skips all pages — `cue.nsi` waits ~2.5 s for the exiting `cue.exe` to release its lock before overwriting, and a hidden `-Relaunch` section restarts Cue since the Finish-page "Launch" checkbox never shows in silent mode.

For internal distribution and code-signing guidance (free self-signing, quarantine/Mark-of-the-Web, the Apple Silicon ad-hoc requirement, clearing the download tag), see `plan/deployment-handoff.md`. On macOS unsigned builds: `xattr -dr com.apple.quarantine /Applications/Cue.app`, or right-click → Open.

---
