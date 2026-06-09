# Cue Graphics Engine — CLAUDE.md

Unified single-process Electron application. Replaces EasyWorship/ProPresenter (worship lyric presentation) and UNO (broadcast overlay graphics). Both use cases run simultaneously — no separate modes, no separate applications.

**Full technical reference**: `plan/cue-master-reference.md` — read that for deep dives on any system. This file is the fast daily-use rules sheet.

---

## UI Design Rules

**NEVER use AI purple / indigo (#6366F1, #4F6EF7, #818CF8, #A5B4FC, or any violet/purple accent) in UI component design.** This is the generic "AI app" colour that makes software look like every other LLM product.

---

## Design Philosophy

Mission-control broadcast engineering: dark, precise, information-dense. Not a consumer app. Not an AI assistant. A tool for professionals operating live broadcast environments.

### Colour system — actual values from `tailwind.config.js`

| Token | Hex | Semantic use |
|---|---|---|
| `background` | `#111317` | Page background |
| `surface-container-lowest` | `#0c0e12` | Input fields |
| `surface-container-low` | `#1a1c20` | Panel backgrounds, modal shells |
| `surface-container` | `#1e2024` | Cards, section rows |
| `surface-container-high` | `#282a2e` | Panel headers, footers, toolbars |
| `surface-container-highest` | `#333539` | Hover states, active tabs |
| `surface-variant` | `#333539` | Hover background (same as highest) |
| `outline-variant` | `#424754` | Dividers, inactive borders |
| `outline` | `#8c909f` | Secondary borders |
| `on-surface` | `#e2e2e8` | Primary text |
| `on-surface-variant` | `#c2c6d6` | Secondary text |
| `primary` | `#adc6ff` | Preview / staged / selected. Blue. |
| `primary-container` | `#4d8eff` | Primary button bg |
| `on-primary` | `#002e6a` | Text on primary bg |
| `secondary` | `#ffb3ad` | Live / on-air / danger. Red-coral. |
| `secondary-container` | `#a40217` | LIVE badge bg |
| `on-secondary` | `#68000a` | Text on secondary bg |
| `tertiary` | `#4ae176` | GO / success / active output. Green. |
| `tertiary-container` | `#00a74b` | Save/confirm button bg |
| `on-tertiary` | `#003915` | Text on tertiary bg |
| `error` | `#ffb4ab` | Destructive actions |
| `error-container` | `#93000a` | Error bg |

Use container levels (`surface-container-*`) for tonal elevation — **no box shadows on flat surfaces**. Depth is expressed through surface lightness, not drop shadows.

### Semantic colour coding

- **Blue (primary)** = Preview state, staged items, selected/cued. Tally bars, monitor borders.
- **Red (secondary)** = Live / on-air state. LIVE badges, live tally bar, CLEAR button border.
- **Green (tertiary)** = GO action, success, active output indicator.
- **Error** = Destructive actions (delete, remove).

### Typography

| Use | Font | Token | Treatment |
|---|---|---|---|
| Headlines / titles | Inter | `text-headline-md` (20px/600) | — |
| Body copy | Inter | `text-body-md` (14px/400) | — |
| Labels / chips / badges / buttons | JetBrains Mono | `text-label-sm` (12px/500) | `uppercase tracking-[0.05em]` |

**JetBrains Mono** is NOT bundled. Always declare as `"JetBrains Mono", ui-monospace, monospace` — system monospace is the fallback. Never use Oswald in the operator UI (Oswald is for output fullscreen templates only).

### Spacing tokens
`xs=4px` `sm=8px` `md=16px` `lg=24px` `xl=32px` `gutter=12px`

### Component rules

- **Border radius**: `rounded-lg` (0.25rem) for cards/panels. `rounded-xl` (0.5rem) for modals and primary action buttons. `rounded-full` for badges and icon buttons.
- **Borders**: `border border-outline-variant/30` on containers. `/20`–`/40` opacity suffixes preferred.
- **Tally bars**: Left-edge `border-l-4` coloured strip on rundown items. Blue = preview, red = live, transparent = idle.
- **Buttons**: Ghost for secondary/cancel. Filled `bg-primary text-on-primary` for primary. `bg-tertiary-container` for Save. `bg-surface-container-high border border-error/50` for CLEAR. `bg-surface-container-high border border-primary/50` for LOGO.
- **Modals**: `fixed inset-0 bg-background/80 backdrop-blur-sm`. Container: `bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5`.
- **Inputs**: `bg-surface-container-lowest border border-outline-variant/50 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary/30`.
- **Scrollbars**: 6px wide. Class: `custom-scrollbar`. Defined in `index.css`.
- **Icons**: Material Symbols (`material-symbols-outlined` class). Filled variants: `fontVariationSettings: "'FILL' 1"`.

### What NOT to do

- No warm amber/brown tones.
- No `bg-slate-*` or `border-slate-*` Tailwind classes.
- No `text-indigo-*` or `bg-indigo-*` classes.
- No Oswald in the operator UI.
- No box shadows on flat dark surfaces.
- No rounded corners above `rounded-xl` in panels.

---

## Technology Stack

| Package | Version | Notes |
|---|---|---|
| Electron | **30.0.9** | Pinned. Bump requires `npm run rebuild`. |
| React / react-dom | 18.3.1 | — |
| Vite + @electron-forge/plugin-vite | 5.3.1 / 7.4.0 | `npm start` = dev. `npm run make` = distributable. |
| better-sqlite3 | 11.1.2 | Synchronous SQLite. Rebuild on Electron bump. |
| grandiose | **NOT INSTALLED** | NDI output. Add when implementing NDI publish, then `npm run rebuild`. |
| Tailwind CSS | 3.4.4 | Operator UI styling. |
| react-window | 1.8.10 | Virtualised song list. |
| @dnd-kit/core + sortable | 6.1.0 / 8.0.0 | Drag-to-reorder in rundown and song editor. |

After any Electron version bump: `npm run rebuild` recompiles `better-sqlite3` (and `grandiose` when installed).

---

## Process Architecture

| Process | Responsibilities |
|---|---|
| Main (Node.js) | SQLite, file system, `cue-media://` protocol, IPC bridge, output window lifecycle |
| Renderer (React) | Operator UI — `window.cue.*` only, never direct Node access |
| Output windows | Plain DOM, no React. One per screen/NDI channel. Receive `slide:update` IPC. |

**Security rule: `nodeIntegration: false` always.** All Node/SQLite access goes through IPC, exposed through `window.cue` (contextBridge preload). Never bypass this.

---

## Media Files — Critical Protocol Rules

All media file URLs use `cue-media://` — a custom Electron protocol that serves files from the `userData/media/` directory. **Do not use `file://` for media anywhere in the renderer or output templates.**

### The `localhost` hostname requirement — DO NOT SKIP THIS

`cue-media:///Users/...` (three slashes, no hostname) **silently breaks**. Chromium's standard-scheme URL parser treats `cue-media:///Users/...` as having `users` as the hostname (lowercased, stripped from path), so the file read fails with ENOENT.

**Always use `cue-media://localhost` as the base:**

```js
// src/renderer/utils/mediaUrl.js — use this everywhere in renderer code
export function mediaUrl(absPath) {
  if (!absPath) return null;
  const encoded = absPath.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return 'cue-media://localhost' + encoded;
}

// Output templates (fullscreen.js / lowerthird.js) — identical inline helper
function pathToUrl(p) {
  if (!p) return null;
  return 'cue-media://localhost' + p.split('/').map(encodeURIComponent).join('/');
}
```

The protocol handler in `main/index.js` extracts the path from `new URL(request.url).pathname`, which correctly returns `/Users/...` when the hostname is `localhost`.

---

## Project Structure

```
src/
├── main/
│   ├── index.js              App entry. Window creation. cue-media:// protocol handler.
│   ├── preload.js            contextBridge → window.cue. Full renderer API.
│   ├── output-preload.js     Minimal preload for output windows → window.cueOutput only.
│   ├── fonts.js              BUNDLED_FONTS array + DEFAULT_FONT = 'Inter'.
│   ├── db/
│   │   ├── schema.js         SQLite init + migration runner (v1→v4). getDb() singleton.
│   │   ├── songs.js          Song + section + tag CRUD. FTS5 search. deleteAll().
│   │   ├── services.js       Service / rundown CRUD. resolveItem() joins media paths. clearItems(). setItemBackground() writes through to songs.
│   │   ├── media.js          Import (copy to userData/media/), list, getById, delete, folders.
│   │   └── settings.js       Key-value store. Global logo/background helpers.
│   ├── ipc/
│   │   ├── songs.ipc.js      songs:* and tags:* handlers.
│   │   ├── services.ipc.js   services:* handlers.
│   │   ├── media.ipc.js      media:* handlers.
│   │   ├── output.ipc.js     output:* handlers.
│   │   └── settings.ipc.js   settings:* handlers.
│   └── output/
│       ├── manager.js        Window registry. go/clear/logo dispatch. Live capture loop.
│       └── ndi.js            Stub only — tries require('grandiose'), no publish logic.
├── renderer/
│   ├── main.jsx              React entry — mounts <App />.
│   ├── index.css             Design system CSS: tally, monitor glow, scrollbar, animations.
│   ├── App.jsx               Root. Titlebar + transport bar + Operator/Settings view switch.
│   ├── views/
│   │   ├── OperatorView.jsx  Three-panel layout. Transport state. Configurable keyboard shortcuts (shortcutsRef).
│   │   │                     Background resolution. focusSearchRef wired to LibraryPanel search (S key).
│   │   │                     Resize state persisted to localStorage. Services list refreshes on bgRefreshTick.
│   │   ├── SettingsView.jsx  Settings page layout. Hosts OutputChannels + Logo + Background + ShortcutSettings.
│   │   └── MultiviewView.jsx Multi-output monitor wall. Subscribes to output:multiview-captures.
│   ├── panels/
│   │   ├── RundownPanel.jsx       Inline service rename + delete UI (no native confirm dialogs).
│   │   │                          DnD-sortable item list. Context menu with Preview/Edit/Set Background Override.
│   │   │                          Background picker writes through to song's default_background_id.
│   │   │                          Props: onRenameService, onDeleteService.
│   │   ├── PreviewLivePanel.jsx   Two MonitorFrames + two SlideLists. Background rendering.
│   │   └── LibraryPanel.jsx       Virtualised song list + media grid. Search + tag filter.
│   │                              Single-click → preview modal (220ms). Double-click → add to rundown.
│   │                              Accepts refreshTick + focusSearchRef props.
│   ├── components/
│   │   ├── SongEditor.jsx         Full song CRUD modal. Per-section styling toolbar. Paste Song parser.
│   │   │                          Exports renderWithRuns() used by PreviewLivePanel. Escape key closes.
│   │   ├── SongPreviewModal.jsx   Read-only song preview. Add to Rundown / Edit actions.
│   │   ├── MediaPickerModal.jsx   Media grid picker. Used for background override in RundownPanel.
│   │   ├── SlideList.jsx          Scrollable section list. preview and live variants. Content capped max-h-24.
│   │   └── ContextMenu.jsx        Generic right-click menu positioned by x/y coords. Escape key closes.
│   ├── settings/
│   │   ├── OutputChannels.jsx     Channel cards. Create/edit/delete. Monitor assignment per channel.
│   │   ├── LogoSettings.jsx       Global logo picker.
│   │   ├── BackgroundSettings.jsx Global song/slide background pickers. Bulk apply. Disk usage. Data path.
│   │   │                          Embeds DangerZone above the system footer.
│   │   ├── DangerZone.jsx         Destructive actions: clear rundown, delete rundown, clear library.
│   │   │                          Two-step confirm. Uses existing removeItem IPC in a loop (no new IPC needed).
│   │   └── ShortcutSettings.jsx   Configurable transport shortcuts. Modifier selector + key inputs for
│   │                              GO / Clear / Logo / Live Toggle. Saves to settings DB via settings:set.
│   └── utils/
│       └── mediaUrl.js            mediaUrl(absPath) — see Media section above.
├── output/                   Plain HTML. No build step. Loaded directly by BrowserWindow.
│   ├── fullscreen.html / .css / .js
│   └── lowerthird.html / .css / .js
└── fonts/
    └── fonts.css + *.woff2   6 families (Inter, Montserrat, Lato, Oswald, Playfair Display, EB Garamond)
```

---

## Database

**Engine**: `better-sqlite3` (synchronous — no Promises).
**Location**: macOS `~/Library/Application Support/Cue/cue.db`, Windows `%APPDATA%\Cue\cue.db`
**Current schema version**: 4

**Media files** are copied to `userData/media/<uuid>.<ext>` on import. Original paths not retained.

### Key tables (abbreviated)

| Table | Key columns |
|---|---|
| `songs` | `id, title, author, copyright, default_background_id` |
| `song_sections` | `id, song_id, type, order_index, content, style_json` |
| `songs_fts` | FTS5 virtual — mirrors title/author/content via triggers |
| `tags` | `id, name, colour` |
| `taggables` | `tag_id, entity_type, entity_id` (polymorphic pivot) |
| `services` | `id, title, date, notes` |
| `service_items` | `id, service_id, item_type, ref_id, order_index, notes, content, background_override_id` |
| `media_assets` | `id, filename, path, type, folder_id` |
| `media_folders` | `id, name, parent_id` |
| `output_channels` | `id, name, type, template, ndi_fps, ndi_width, ndi_height, active` |
| `channel_monitors` | `id, channel_id, display_bounds, label, active` — physical screen per channel (v4) |
| `settings` | `key, value` (JSON-encoded values) |
| `db_version` | `version` (integer, currently 4) |

### Settings keys in use

| Key | Type | Description |
|---|---|---|
| `global_logo_id` | number\|null | Global logo media asset ID |
| `global_bg_song_id` | number\|null | Global default background for songs |
| `global_bg_slide_id` | number\|null | Global default background for slides |
| `operator_preview_layout` | string | Reserved — not yet wired in UI |
| `keyboard_modifier` | 'meta'\|'ctrl'\|'alt' | Modifier for transport shortcuts (default: 'meta' macOS / 'ctrl' Windows) |
| `keyboard_go` | string | Key char for GO (default: 'g') |
| `keyboard_clear` | string | Key char for Clear (default: 'c') |
| `keyboard_logo` | string | Key char for Logo (default: 'l') |
| `keyboard_live` | string | Key char for Live Toggle (default: 'o') |

**localStorage** (UI-only, not in DB):
| Key | Description |
|---|---|
| `layout_h_pct` | Horizontal split % (default 25) |
| `layout_v_pct` | Vertical split % (default 62) |

### `style_json` — section styling format

```json
{
  "align": "center",      "bold": false,      "italic": false,
  "fontFamily": null,     "fontSize": null,   "color": null,
  "lineSpacing": null,    "runs": []
}
```
`null` means "use template defaults." `fontFamily` must match a family in `fonts.css`. FTS5 indexes `content` only.

### Background resolution order

1. `service_items.background_override_id` — per-slot override
2. `songs.default_background_id` — per-song default
3. `settings.global_bg_song_id` / `global_bg_slide_id` — global type default
4. `null` → black screen

---

## IPC API (`window.cue`)

### Songs
- `songs:search(query)` → `[{id, title, author}]` — FTS5 prefix search; empty query returns all
- `songs:listAll()` → `[{id, title, author, copyright, default_background_id, tags:[...]}]`
- `songs:get(id)` → full song with `sections` and `tags`
- `songs:create(data)` / `songs:update(id, data)` / `songs:delete(id)` → `{hasReferences, count}`
- `songs:addTag(songId, tagId)` / `songs:removeTag(songId, tagId)`
- `songs:setBackground(songId, mediaId|null)`
- `songs:deleteAll()` — deletes all songs, sections, taggables, and song service_items. Irreversible.

### Tags
- `tags:list()` / `tags:create({name, colour})` / `tags:update(id, data)` / `tags:delete(id)`

### Services
- `services:list()` → `[{id, title, date, notes}]`
- `services:get(id)` → service with fully resolved `items` (joins song, sections, media paths)
- `services:create(data)` / `services:update(id, data)` / `services:delete(id)`
- `services:reorderItems(serviceId, orderedIds)` — single transaction
- `services:addItem(serviceId, item)` / `services:removeItem(itemId)`
- `services:setItemBackground(itemId, mediaId|null)` — also writes to `songs.default_background_id`
- `services:setItemNotes(itemId, notes)`
- `services:duplicateItem(itemId)` → new `id`
- `services:clearItems(serviceId)` — removes all items, keeps the service row
- `services:applyBackgroundToRundown(serviceId, mediaId)` — sets override + writes to each song's default

### Output
- `output:go(payload)` / `output:clear()` / `output:logo()`
- `output:setLive(enabled)` — opens or closes all output BrowserWindows
- `output:getState()` → `{isLive, livePayload, activeWindows, outputsEnabled, displayMode}`
- `output:channels:list()` / `:create(data)` / `:update(id, data)` / `:delete(id)`
- `output:monitors:list(channelId?)` / `:create(channelId, data)` / `:delete(monitorId)` — physical screen assignments
- `output:multiview:start()` / `:stop()` — starts/stops multiview capture loop
- `output:screens:list()` → `[{id, bounds, scaleFactor, label}]`

### Media
- `media:import(filePaths)` → `[{id, filename, path, type}]`
- `media:get(id)` → single asset or null
- `media:list(folderId?)` → assets; `null`/`undefined` = root only
- `media:delete(id)`
- `media:getDiskUsage()` → bytes / `media:getMediaDir()` → absolute path
- `media:folders:create(name, parentId?)` / `:rename(id, name)` / `:delete(id)` / `:tree()`

### Settings
- `settings:get(key)` / `settings:set(key, value)`
- `settings:setGlobalLogo(mediaId|null)` / `settings:setGlobalBackground(type, mediaId|null)`
- `settings:applyBackgroundToAll(type, mediaId)` — bulk update, UI must confirm
- `settings:getDiskUsage()` / `settings:getDataPath()` / `settings:openDataFolder()`

### Dialog
- `dialog:openFile(options)` → `{canceled, filePaths}`

### Fonts (synchronous, no IPC)
- `window.cue.fonts.list` — `[{family, label, category}]`
- `window.cue.fonts.default` — `'Inter'`

### Renderer events (`window.cue.on(channel, cb)`)
- `output:unresolved-channels` — unresolved channel objects on startup
- `output:state-changed` — after go/clear/logo/setLive; payload: `{activeWindows, outputsEnabled, displayMode}`
- `output:live-capture` — data URL of captured output frame (every 200ms while live)
- `output:multiview-captures` — `[{channelId, dataUrl}]` array at ~5fps (only while multiview running)
- `output:ndi-unavailable` — grandiose not installed
- `shortcut:next` / `shortcut:prev` — reserved for hardware remote

---

## Output Payload Structure

```js
{
  type: 'content' | 'clear' | 'logo',
  text: string | null,
  sectionLabel: string | null,
  copyright: string | null,
  backgroundPath: string | null,   // absolute filesystem path — output template encodes to cue-media://
  logoPath: string | null,
  styleJson: object | null,        // parsed style_json from song_sections
}
```

Output windows receive this via `webContents.send('slide:update', payload)`.

---

## Output Channels

**Channels vs Monitors**: a channel is a content stream (one template, one set of settings). A monitor is a physical screen assignment (`channel_monitors` row). One channel can drive multiple monitors simultaneously.

**Screen channels**: each `channel_monitors` row opens a `BrowserWindow` with `fullscreen: true, frame: false, alwaysOnTop: true`. Display matched by `display_bounds` JSON, never `display_index`. If bounds don't match a connected display → flagged unresolved → Settings auto-opens.

**NDI channels**: hidden `show: false` BrowserWindow. Loads same templates. No frames are published — `ndi.js` is a stub (`grandiose` not installed). The hidden window exists and receives `slide:update` correctly, but nothing is sent to the NDI network.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Space / ↓ | Next slide. Auto-GOes when preview item === live item. At last slide → next rundown item. |
| ↑ | Previous slide. Auto-GOes when preview item === live item. At first slide → prev rundown item at its last slide. |
| G | GO — send preview item at current slide to live |
| Escape | Clear all outputs |
| L | Logo all outputs |
| S | Focus song search bar in Library panel |
| Modifier+G | GO (configurable — default Cmd/Ctrl+G) |
| Modifier+C | Clear (configurable — default Cmd/Ctrl+C) |
| Modifier+L | Logo (configurable — default Cmd/Ctrl+L) |
| Modifier+O | Live Toggle (configurable — default Cmd/Ctrl+O) |

Registered as a `keydown` listener on `document` in `OperatorView.jsx` — **not** `globalShortcut`. Suppressed when an `INPUT`, `TEXTAREA`, or `contenteditable` has focus. Modifier shortcuts take priority over bare-key shortcuts — if modifier is held, bare-key handling is skipped.

`shortcutsRef.current` holds key bindings loaded from settings DB. Reloads on `bgRefreshTick` change. Default modifier: `'meta'` (Cmd) on macOS, `'ctrl'` on Windows, read from `window.cue.platform`.

Do not use `globalShortcut` — it captures at OS level and breaks typing in any input field.

---

## Operator UI Layout

Target minimum resolution: **1920×1080**.

```
┌─── Titlebar (38px, draggable) ─────────────────────────────────┐
│ Cue │ [Operator] [Multiview] [Settings]     Live●  12:00  GO  Clear  Logo  Live │
├────────────────────────────────────────────────────────────────┤
│  ┌──── Rundown ─────┐ │ ┌──── Preview/Live ──────────────────┐ │
│  │ service select   │ │ │ PREVIEW mon.  │  LIVE mon.         │ │
│  │ [DnD items]      │ │ ├───────────────┼────────────────────┤ │
│  └──────────────────┘ │ │ Preview slides│  Live slides       │ │
│                       │ └────────────────────────────────────┘ │
├─── vertical resize ────────────────────────────────────────────┤
│  ┌──── Library (full width) ──────────────────────────────────┐ │
│  │  [Songs tab]  [Media tab]                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

Panel resize: horizontal (Rundown / Preview+Live, default 25%/75%), vertical (top / Library, default 62%/38%). Resize state persisted to `localStorage` (`layout_h_pct`, `layout_v_pct`).

---

## Operator Workflow — Preview/Live

Preview and live are independent buses. A different song can be in preview while another is live.

| Action | Result |
|---|---|
| Single-click rundown item | Loads to preview, `previewSlideIdx=0`. No live change. |
| Double-click rundown item | Loads to preview + sends slide 0 to live. |
| Single-click Preview Slides | Updates `previewSlideIdx`. No live change. |
| Double-click Preview Slides | Sends that slide to live. |
| Single-click Live Slides | Sends that slide to live immediately. |
| GO / G key | Sends `previewItem[previewSlideIdx]` to live. |
| Space / ↓ / ↑ | `previewSlideIdx` only. No live change. |
| Escape | Clear. Sets `liveItemId=null`. |
| Double-click song in library | Adds to rundown — no preview/live change. |

---

## Bundled Fonts

`src/fonts/` ships inside the ASAR. No system install required.

| Family | Category |
|---|---|
| Inter (default) | sans-serif |
| Montserrat | sans-serif |
| Lato | sans-serif |
| Oswald | sans-serif condensed — output templates only |
| Playfair Display | serif |
| EB Garamond | serif |

Loaded by output templates via `<link href="../fonts/fonts.css">` and by the renderer via `@import` in `index.css`. Font list exposed as `window.cue.fonts.list` (synchronous). To add: `.woff2` → `src/fonts/`, `@font-face` → `fonts.css`, entry → `fonts.js`.

---

## Compatibility Notes

- **macOS Gatekeeper** (unsigned): `xattr -cr /Applications/Cue.app` or right-click → Open.
- **Windows SmartScreen** (unsigned): More info → Run anyway.
- **Display matching**: Always use `display_bounds` JSON, never `display_index`. Mismatched = unresolved channel = Settings redirect.
- **Polymorphic FK gap**: SQLite can't enforce `service_items.ref_id` across tables. App layer checks for dangling song references before delete.
- **NDI**: `grandiose` is not installed. NDI channels have working BrowserWindows but publish no frames. The "NDI SDK missing" warning fires correctly on startup.
