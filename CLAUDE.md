# Cue Graphics Engine — CLAUDE.md

Unified single-process Electron app. Replaces EasyWorship/ProPresenter (worship lyric presentation) and UNO (broadcast overlay graphics). Both use cases run simultaneously — no separate modes.

**Full technical reference**: `plan/cue-master-reference.md` — read that for deep dives. This file is guard rails only: rules an agent must know before writing a single line.

---

## Hard Rules — Never Break

### Security
- `nodeIntegration: false` always. All Node/SQLite access goes through IPC via `window.cue` (contextBridge preload). Never bypass.

### Media URLs
- **Never use `file://` for media.** Always `cue-media://localhost/path`. Three-slash form (`cue-media:///…`) silently fails — Chromium strips the first segment as hostname.
- Renderer: use `src/renderer/utils/mediaUrl.js`. Output templates: inline `pathToUrl()` helper.

### Output & NDI
- **Never `capturePage()` on NDI windows** — 4s+ latency. NDI uses the `paint` event + `setInterval(invalidate, frameMs)`.
- **Do not reintroduce a per-frame operator capture loop.** The live monitor renders from the payload, not screen capture.
- **Do not recreate a channel window for a lower-third content-mode switch** — send `content:mode` IPC to the existing window; recreating drops the NDI sender.
- Display matching: always `display_bounds` JSON, never `display_index`.

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

---

## Dev Commands

- `npm start` — dev server
- `npm run make` — distributable
- After any Electron version bump: `npm run rebuild` (recompiles `better-sqlite3` and `grandi`)
- DB: `~/Library/Application Support/Cue/cue.db` (macOS) · `%APPDATA%\Cue\cue.db` (Windows) · schema v14
