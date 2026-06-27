## 20. Running the App

```bash
npm start          # dev mode — Vite dev server + Electron, DevTools auto-open
npm run package    # package the .app/.exe bundle (no installer) — fast packaging check
npm run make       # build distributable (.dmg macOS, .exe Windows)
npm run rebuild    # recompile better-sqlite3 after Electron version bump
```

### Packaging — what Vite does not bundle

The Forge Vite plugin sets `packagerConfig.ignore` to drop everything except the `/.vite` build output, so anything not bundled by Vite is **absent from a packaged build even though it works in `npm start`** (where the full project tree, including `node_modules`, is on disk). Two classes of files are restored by the `packageAfterPrune` hook in `forge.config.js`:

1. **Native externals + their dependency closure.** `better-sqlite3`, `grandi` (+ the platform `@grandi/<os>-<arch>` binary), and `tar` are kept `external` in `vite.main.config.js` (native `.node` addons can't be bundled; `tar` does dynamic requires). The hook walks each module's production dependency tree (`collectClosure`) and copies the full closure into the packaged `node_modules`. It runs *after* Forge's prune so the copies survive into the asar. `grandi`'s binary lives in an `optionalDependency`, so only the one installed for the current build OS resolves — the closure naturally copies the correct per-platform binary.
2. **Plain-DOM output assets.** `src/output/*` (the projection / lower-third / stage HTML + their js/css) and `src/fonts/*` are not bundled by Vite, but `output/manager.js` loads them from `app.getAppPath()/src/output` at runtime. The hook copies both directories to the same relative path inside the asar. Without this every output window is a blank `ERR_FILE_NOT_FOUND`.

Native code must run from the real filesystem, not inside the asar: `grandi.node` links its sibling `libndi.dylib`/`.dll` via an `@loader_path` rpath, and `better-sqlite3` resolves its `.node` relative to its own location. `packagerConfig.asar.unpack: '**/node_modules/**'` keeps the whole copied tree in `app.asar.unpacked` with its internal layout intact.

**Implication:** adding a new runtime npm dependency that Vite externalizes, or a new output-window/font file, means updating the `packageAfterPrune` hook — otherwise the breakage appears only in packaged builds, never in dev. Verify a build with `npm run package` then launch `out/<name>/…app`.

### Distribution

Bundled resources (`resources/bible`, `resources/ghs`) are placed in `Contents/Resources/` via `extraResource` and read through `process.resourcesPath` when `app.isPackaged`.

For internal distribution and code-signing guidance (free self-signing, quarantine/Mark-of-the-Web, the Apple Silicon ad-hoc requirement, clearing the download tag), see `plan/deployment-handoff.md`. On macOS unsigned builds: `xattr -dr com.apple.quarantine /Applications/Cue.app`, or right-click → Open.

---
