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
- Renderer: use `src/renderer/utils/mediaUrl.js`. Output templates: inline `pathToUrl()` helper.
- `media_assets.path` is stored **absolute**. Any feature that relocates `userData` (backup/restore, data-folder move, sync) must rewrite each path to the local media dir, or assets silently fail to resolve on the new machine.
- Adding a new place that references a media asset (FK column or `settings` key)? Also add it to `media.findUnused()` — anything it misses gets reported as unused and is deleted by the Media cleanup tool.

### Output & NDI
- **Never `capturePage()` on NDI windows** — 4s+ latency. NDI uses the `paint` event + `setInterval(invalidate, frameMs)`.
- **Do not reintroduce a per-frame operator capture loop.** The live monitor renders from the payload, not screen capture.
- **Do not recreate a channel window for a lower-third content-mode switch** — send `content:mode` IPC to the existing window; recreating drops the NDI sender.
- **Countdown/clock graphics tick in the output template, not the operator.** Main resolves an absolute anchor (`endsAt`/`startAt`) once; `graphics-overlay.js` recomputes the digits from `Date.now()`. Never stream per-second time updates over the overlay bus.
- Display matching: always `display_bounds` JSON, never `display_index`.
- **A song with an all-default style saves `style_json = null`** (centre align is the default). Output/monitor `applyStyle` must treat null as `{}` and default `text-align` to **centre** — never early-return on null, or default-styled lower-third lyrics render left. Applies to `lowerthird.js`, `graphics-overlay.js`, `PreviewLivePanel`.

### Shortcuts
- **Do not use `globalShortcut`** — captures at OS level, breaks typing. Shortcuts are `keydown` on `document`, suppressed when an `INPUT`/`TEXTAREA`/`contenteditable` has focus.

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
- Media transport is a single main-process clock `{active, startAt, pausedAt, loop, muted}`. Do NOT add per-window `currentTime` reporting. Do NOT use dual-element loop swap — use native `loop` attribute.
- Program audio comes from ONE screen window only (`isPrimaryAudioMonitor`). Stage and operator preview are always silent.
- Broadcast-graphics overlay is an independent bus — never coupled to the program slide bus.
- `window.cue.on()` returns an unsubscribe fn. Always call it in `useEffect` cleanup.
- The network remote is a virtual operator: nav commands (GO/NEXT/PREV/SELECT) are forwarded to the renderer as `remote:command` and run the SAME handlers as the keyboard. Do NOT resolve slide payloads in the main process — rundown/preview/live state lives in `OperatorView`.

---

## Dev Commands

- `npm start` — dev server
- `npm run make` — distributable
- After any Electron version bump: `npm run rebuild` (recompiles `better-sqlite3` and `grandi`)
- DB: `~/Library/Application Support/Cue/cue.db` (macOS) · `%APPDATA%\Cue\cue.db` (Windows) · schema v19
- Version (Settings footer): `vMAJOR.MINOR.PATCH (Build N)`, all injected at build time from `vite.renderer.config.js`. **MAJOR is auto-derived** from the highest `vN` migration in `schema.js` (do not hardcode it) and **Build N** from the git commit count. Only `VERSION_MINOR`/`VERSION_PATCH` are manual: bump MINOR for features with no migration, PATCH for fixes/docs/chores, and **reset both to 0 in the same commit as a new migration** (MAJOR moves on its own).
