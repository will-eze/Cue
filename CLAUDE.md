# Cue Graphics Engine — CLAUDE.md

Unified single-process Electron app. Replaces EasyWorship/ProPresenter (worship lyric presentation) and UNO (broadcast overlay graphics). Both use cases run simultaneously — no separate modes.

**Full technical reference**: `plan/cue-master-reference.md` — read that for deep dives. This file is guard rails only: rules an agent must know before writing a single line.

---

## Hard Rules — Never Break

### Security
- `nodeIntegration: false` always. All Node/SQLite access goes through IPC via `window.cue` (contextBridge preload). Never bypass.
- Network control server (`src/main/remote/`): bind `127.0.0.1` by default (LAN is an explicit opt-in), every `/api/*` request is token-gated, and it only calls manager/IPC functions — never expose Node or the DB over it.

### Media URLs
- **Never use `file://` for media.** Always `cue-media://localhost/path`. Three-slash form (`cue-media:///…`) silently fails — Chromium strips the first segment as hostname.
- **Serve `cue-media://` ranges by streaming** (`fs.createReadStream` → `Readable.toWeb`), never by reading the file/chunk into a `Buffer`. A `<video>` opens with `bytes=0-` (the whole remaining file): buffering it freezes main + spikes memory on multi-GB clips, and a fixed-size chunk cap starves the player of the multi-MB `moov` index so an hour-long video only loops its first few seconds.
- Renderer: use `src/renderer/utils/mediaUrl.js`. Output templates: inline `pathToUrl()` helper.
- `media_assets.path` is stored **absolute**. Any feature that relocates `userData` (backup/restore, data-folder move, sync) must rewrite each path to the local media dir, or assets silently fail to resolve on the new machine.
- Adding a new place that references a media asset (FK column, `settings` key, or an id embedded in a JSON column like `presentation_*.elements_json`)? Also add it to `media.findUnused()` — anything it misses gets reported as unused and is deleted by the Media cleanup tool.
- **Grid/list thumbnails use `thumbUrl()` / `<MediaThumb>` (`cue-thumb://`), never full-res `mediaUrl()`** — `cue-thumb` serves a small OS-generated JPEG cached in `userData/thumbnails`. It's a regenerable derived cache: NOT a media reference (skip `findUnused`), excluded from backups, cleared on asset delete/wipe. Keep `mediaUrl()` only for live output, full-size previews, and playing video.

### Output & NDI
- **Never `capturePage()` on NDI windows** — 4s+ latency. NDI uses the `paint` event + `setInterval(invalidate, frameMs)`.
- **Do not reintroduce a per-frame operator capture loop.** The live monitor renders from the payload, not screen capture.
- **Do not recreate a channel window for a lower-third content-mode switch** — send `content:mode` IPC to the existing window; recreating drops the NDI sender.
- **Countdown/clock graphics tick in the output template, not the operator.** Main resolves an absolute anchor (`endsAt`/`startAt`) once; `graphics-overlay.js` recomputes the digits from `Date.now()`. Never stream per-second time updates over the overlay bus.
- Display matching: always `display_bounds` JSON, never `display_index`.
- **A song with an all-default style saves `style_json = null`** (centre align is the default). Output/monitor `applyStyle` must treat null as `{}` and default `text-align` to **centre** — never early-return on null, or default-styled lower-third lyrics render left. Applies to `lowerthird.js`, `graphics-overlay.js`, `PreviewLivePanel`.

### YouTube (ephemeral video)
- A YouTube cue is single-use: `service_items.item_type = 'youtube'` with the URL in `content` (**never** a `media_assets` row). The downloaded file lives in `userData/yt-cache`, wiped on quit AND startup; the cues themselves are purged on startup (`purgeYoutubeItems`). Never insert a YouTube download into `media_assets`, backups, or `media.findUnused()` — and never persist it across sessions.
- `yt-dlp` output MUST pass `-movflags +faststart` (moov atom at front) or a long clip black-screens on go-live while the player fetches the tail index.
- `yt-dlp` + `ffmpeg` are **NOT bundled** — `src/main/youtube/bin.js` auto-downloads them into `userData/bin` on first use (resolution order: `userData/bin` → system PATH → a dev-only `resources/bin/<platform>-<arch>` copy that ships in no build) and refreshes `yt-dlp` when an extraction fails. Do NOT re-add them to `extraResource`/the installer (bloat + stale yt-dlp).

### Shortcuts
- **Do not use `globalShortcut`** — captures at OS level, breaks typing. Shortcuts are `keydown` on `document`, suppressed when an `INPUT`/`TEXTAREA`/`contenteditable` has focus.

### Dependencies
- **Keep `pdfjs-dist` on v4** (PowerPoint import rasteriser). v5/v6 call native `Promise.try`, which Electron 30's Chromium (~124) lacks — the worker throws and the import hangs forever. Load the worker via Vite `?worker` + `GlobalWorkerOptions.workerPort`, never a `?url` `workerSrc` (silent main-thread fake worker = unusably slow). pdfjs stays renderer-only (needs a DOM canvas); the PPTX→PDF step is `soffice` in main.

---

## UI Design Guard Rails

**NEVER use AI purple / indigo** (#6366F1, #4F6EF7, #818CF8, #A5B4FC or any violet/purple). No `text-indigo-*`, `bg-indigo-*`, or `bg-slate-*`. No warm amber/brown. No box shadows on flat dark surfaces. No `rounded` above `rounded-xl` in panels.

Design language: dark, precise, mission-control broadcast engineering. Colour tokens are in `tailwind.config.js`.

Semantic colours:
- **Blue (`primary`)** = preview / staged / selected
- **Red (`secondary`)** = live / on-air
- **Green (`tertiary`)** = GO / success / active output
- **Error** = destructive actions

Typography: Inter for body/headlines. Labels/chips/badges/buttons: `"JetBrains Mono", ui-monospace, monospace` (NOT bundled — always include fallback). **Oswald is output templates only**, never the operator UI.

---

## Architecture Invariants

- Three processes: Main (Node/SQLite/IPC), Renderer (React + `window.cue.*` only), Output windows (plain DOM, no React).
- Output windows receive slides via `webContents.send('slide:update', payload)`.
- Media transport is a single main-process clock `{active, startAt, pausedAt, loop, muted, rate}`; position = `((pausedAt ?? now) - startAt)/1000 * rate`. Every player (`media-player.js`, preview `SyncedVideo`, `transportPosition`) multiplies by `rate`; `mediaSetRate` rebases `startAt` so position stays continuous across a speed change. Do NOT add per-window `currentTime` reporting. Do NOT use dual-element loop swap — use native `loop` attribute.
- Program audio comes from ONE screen window only (`isPrimaryAudioMonitor`). Stage and operator preview are always silent.
- Broadcast-graphics overlay is an independent bus — never coupled to the program slide bus.
- `window.cue.on()` returns an unsubscribe fn. Always call it in `useEffect` cleanup.
- The network remote is a virtual operator: nav commands (GO/NEXT/PREV/SELECT) are forwarded to the renderer as `remote:command` and run the SAME handlers as the keyboard. Do NOT resolve slide payloads in the main process — rundown/preview/live state lives in `OperatorView`.

---

## Dev Commands

- `npm start` — dev server
- `npm run make` — distributable · `npm run package` — bundle only (fast packaging check)
- After any Electron version bump: `npm run rebuild` (recompiles `better-sqlite3` and `grandi`)
- **Packaging copies what Vite doesn't bundle.** The Forge Vite plugin packages only `.vite/`; the `packageAfterPrune` hook in `forge.config.js` copies the native externals' full dependency closure (`better-sqlite3`, `grandi`/`@grandi`, `tar`) into the packaged `node_modules` and copies the plain-DOM `src/output` + `src/fonts` into the asar (`asar.unpack: '**/node_modules/**'` keeps native `.node` + sibling libs like grandi's `libndi.*` on the real filesystem). These exist in `npm start` but are absent from a build, so omissions break **only in packaged apps**. Add a runtime dep Vite externalizes, or a new output-window/font file? Update that hook and verify with `npm run package`. Distribution/signing notes: `plan/deployment-handoff.md`.
- DB: `~/Library/Application Support/Cue/cue.db` (macOS) · `%APPDATA%\Cue\cue.db` (Windows) · schema v21
- Version (Settings footer): `vMAJOR.MINOR.PATCH (Build N)`, all injected at build time from `vite.renderer.config.js`. **MAJOR is auto-derived** from the highest `vN` migration in `schema.js` (do not hardcode it) and **Build N** from the git commit count. Only `VERSION_MINOR`/`VERSION_PATCH` are manual: bump MINOR for features with no migration, PATCH for fixes/docs/chores, and **reset both to 0 in the same commit as a new migration** (MAJOR moves on its own).
- **One version number, everywhere — never let it drift.** The same `MAJOR.MINOR.PATCH` is the Settings footer, the `package.json` `"version"` (drives installer filenames + `.app`/`.exe` metadata), and the **release tag** (`v<that version>`, e.g. `v19.2.3`). When you bump `VERSION_MINOR`/`VERSION_PATCH`, set `package.json` `"version"` to the identical computed `MAJOR.MINOR.PATCH` **in the same commit**. A `prePackage` guard in `forge.config.js` fails the build if they diverge — it is the enforcement, do not weaken or bypass it. `package.json` is a manual mirror because it can't hold the schema-derived MAJOR or git Build N statically.
- **Cutting a release** (always the full version, never a placeholder scheme): bump the version (both places), commit to `main`, then `git tag -a v<version> -m "Cue v<version>" && git push origin v<version>` — the `v*` push triggers `.github/workflows/build-installers.yml`, which builds the dmg/exe and publishes a prerelease GitHub Release named for the tag. Pull clean (no quarantine/MOTW) with `gh release download v<version> -R will-eze/Cue -D installers`. Keep one release per version: delete superseded releases+tags with `gh release delete <tag> --cleanup-tag`. **Always launch the packaged app once per OS before distributing** — ABI/packaging breaks are invisible in `npm start` and a dev `npm run package` (the project root's `better-sqlite3` is already Electron-ABI on a dev box but Node-ABI on a clean CI checkout; the `prePackage` rebuild hook fixes it). Full distribution/signing notes: `plan/deployment-handoff.md`.
