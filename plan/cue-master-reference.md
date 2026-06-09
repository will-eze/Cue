# Cue Graphics Engine — Master Reference
*Authoritative technical reference. Updated after every significant session. Read this first.*

---

## 1. What Cue Is

Cue is a single Electron desktop application that replaces two separate tools:
- **EasyWorship / ProPresenter** — worship lyric presentation (songs, slides, lower-thirds for church services)
- **UNO** — broadcast overlay graphics (fullscreen and lower-third graphics for live video production)

Both use cases run simultaneously — there are no modes or separate applications. The operator runs one window and controls both. Output goes to physical screens and/or NDI streams.

**Target hardware:** macOS (primary), Windows. Minimum display: 1920×1080.

---

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
| `tailwindcss` | 3.4.4 | Operator UI styling. |
| `grandiose` | **NOT INSTALLED** | NDI output — add when implementing NDI publish. Run `npm run rebuild` after. |

---

## 3. Process Architecture

Three types of Chromium/Node processes run simultaneously:

```
Main process (Node.js)
  ├── SQLite (better-sqlite3, synchronous)
  ├── File system (media import/serve)
  ├── IPC bridge (ipcMain.handle)
  ├── Output window lifecycle
  └── NDI stub (grandiose wrapper, currently no-op)

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

## 4. File Structure

Every file that matters, with a one-line description:

```
src/
├── main/
│   ├── index.js              App entry. Window creation. cue-media:// protocol handler.
│   │                         Dialog IPC. Startup sequence.
│   ├── preload.js            contextBridge → window.cue. The complete renderer API surface.
│   ├── output-preload.js     Minimal contextBridge for output windows → window.cueOutput only.
│   ├── fonts.js              BUNDLED_FONTS array + DEFAULT_FONT. Imported by preload.js.
│   │
│   ├── db/
│   │   ├── schema.js         SQLite init, migration runner (v1→v2), getDb() singleton.
│   │   ├── songs.js          Song + section + tag CRUD, FTS5 search.
│   │   ├── services.js       Service / rundown CRUD. resolveItem() joins media paths.
│   │   ├── media.js          Media import (copy to userData/media/), list, delete, folders.
│   │   └── settings.js       Key-value settings store. Global logo/background helpers.
│   │
│   ├── ipc/
│   │   ├── songs.ipc.js      Registers songs:*, tags:* handlers.
│   │   ├── services.ipc.js   Registers services:* handlers.
│   │   ├── media.ipc.js      Registers media:* handlers.
│   │   ├── output.ipc.js     Registers output:* handlers. Calls outputManager and getDb directly.
│   │   └── settings.ipc.js   Registers settings:* handlers.
│   │
│   └── output/
│       ├── manager.js        Output window registry. go/clear/logo dispatch. Live capture loop.
│       └── ndi.js            Stub. Tries require('grandiose'), sets flag. No publish logic.
│
├── renderer/
│   ├── main.jsx              React entry point. Mounts <App />.
│   ├── index.css             Design system CSS: tally classes, monitor glow, scrollbar, fonts.
│   ├── App.jsx               Root. Titlebar + transport bar + view switcher (Operator/Settings).
│   │
│   ├── views/
│   │   ├── OperatorView.jsx  Three-panel layout. All transport state. Keyboard shortcuts.
│   │   │                     Background resolution. buildPayload(). Services list refreshes on bgRefreshTick.
│   │   ├── SettingsView.jsx  Settings layout. Renders OutputChannels + LogoSettings + BackgroundSettings.
│   │   │                     BackgroundSettings embeds DangerZone above the footer.
│   │   └── MultiviewView.jsx Multi-output monitor wall. Subscribes to output:multiview-captures.
│   │
│   ├── panels/
│   │   ├── RundownPanel.jsx       Service selector. DnD-sortable item list. Context menu.
│   │   │                          MediaPickerModal for background override.
│   │   │                          Right-click song items → Preview / Edit / Set Background Override.
│   │   ├── PreviewLivePanel.jsx   Two MonitorFrames + two SlideLists. Background image rendering.
│   │   └── LibraryPanel.jsx       Songs tab (react-window virtualised list) + Media tab (grid).
│   │                              Song search + tag filter. Media import.
│   │                              Single-click (220ms) → SongPreviewModal. Double-click → add to rundown.
│   │                              Accepts refreshTick prop — reloads song list when tick changes.
│   │
│   ├── components/
│   │   ├── SongEditor.jsx         Full song CRUD modal. Per-section styling toolbar.
│   │   │                          Paste Song parser (parseSong). renderWithRuns (exported).
│   │   ├── SongPreviewModal.jsx   Read-only song preview. Add to Rundown / Edit.
│   │   ├── MediaPickerModal.jsx   Media grid picker. Used by RundownPanel for bg override.
│   │   ├── SlideList.jsx          Scrollable slide/section list. Preview and live variants.
│   │   └── ContextMenu.jsx        Generic right-click menu positioned by x/y coords.
│   │
│   ├── settings/
│   │   ├── OutputChannels.jsx    Channel cards. Create/edit/delete. Monitor assignment per channel.
│   │   ├── LogoSettings.jsx      Global logo picker.
│   │   ├── BackgroundSettings.jsx Global song/slide background pickers. Bulk apply actions. Disk usage.
│   │   │                          Embeds DangerZone above the system info footer.
│   │   └── DangerZone.jsx        Destructive actions: clear rundown items, delete rundown, clear library.
│   │                              Two-step confirm on every action. Success toast feedback.
│   │
│   └── utils/
│       └── mediaUrl.js           mediaUrl(absPath) → cue-media://localhost/encoded/path
│
├── output/                   Plain HTML — no build step, no React, served directly.
│   ├── fullscreen.html       Background + text + copyright layout (covers full display).
│   ├── fullscreen.css        Fullscreen output styles.
│   ├── fullscreen.js         Handles slide:update. setBackground(). applyStyle(). logo mode.
│   ├── lowerthird.html       Lower-third band layout.
│   ├── lowerthird.css        Lower-third styles.
│   └── lowerthird.js         Handles slide:update. Text + logo only (no background).
│
└── fonts/
    ├── fonts.css             All @font-face declarations. font-display: block.
    ├── Inter-Regular.woff2
    ├── Inter-Bold.woff2
    ├── Montserrat-Regular.woff2
    ├── Montserrat-Bold.woff2
    ├── Lato-Regular.woff2
    ├── Lato-Bold.woff2
    ├── Oswald-Regular.woff2
    ├── Oswald-Bold.woff2
    ├── PlayfairDisplay-Regular.woff2
    ├── PlayfairDisplay-Bold.woff2
    ├── EBGaramond-Regular.woff2
    └── EBGaramond-Bold.woff2
```

**Config files (root):**
- `vite.main.config.js` — builds `src/main/index.js` → `.vite/build/index.js`
- `vite.preload.config.js` — builds preloads
- `vite.renderer.config.js` — builds renderer React app
- `tailwind.config.js` — custom design tokens (see §10)
- `forge.config.js` — Electron Forge packaging config
- `index.html` — Vite renderer entry HTML

---

## 5. Database

**Engine:** `better-sqlite3` (synchronous — no Promises, no async).
**Location:**
- macOS: `~/Library/Application Support/Cue/cue.db`
- Windows: `%APPDATA%\Cue\cue.db`

**Media files** are copied to `userData/media/<uuid>.<ext>` on import. Original paths are not retained.

### Migration system

`schema.js` creates `db_version` table (single integer row) on first run and applies pending migrations in order inside a transaction. **Never delete `db_version`** — it is required to exist before any user-facing build. Current version: **4**.

| Version | Change |
|---|---|
| v1 | Initial schema — all core tables |
| v2 | Added `style_json` to `song_sections`, expanded type CHECK to include `refrain` |
| v3 | Rebuilt `songs_fts` as plain contentless FTS5 (removed `contentless_delete=1` incompatible with Electron 30's SQLite 3.49) |
| v4 | Added `channel_monitors` table — separates channels (content streams) from physical screen assignments |

### All tables

#### `songs`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
title TEXT NOT NULL
author TEXT
copyright TEXT
default_background_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
created_at DATETIME DEFAULT (datetime('now'))
updated_at DATETIME DEFAULT (datetime('now'))
```

#### `song_sections` (v2 — has style_json)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE
type TEXT NOT NULL CHECK(type IN ('verse','chorus','refrain','bridge','pre-chorus','tag','intro','outro'))
order_index INTEGER NOT NULL
content TEXT NOT NULL          -- Plain text. \n for line breaks.
style_json TEXT                -- Nullable JSON. See §8.
```

#### `songs_fts` (FTS5 virtual table)
Mirrors `title`, `author`, `content` from `song_sections`. Indexed by `song_sections.id` (rowid). Three triggers on `song_sections` keep it in sync: `songs_fts_insert`, `songs_fts_update`, `songs_fts_delete`.

#### `tags`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT UNIQUE NOT NULL
colour TEXT    -- hex string e.g. '#ff0000'
```

#### `taggables` (polymorphic pivot)
```sql
tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
entity_type TEXT NOT NULL      -- 'song' (media tagging not yet wired in UI)
entity_id INTEGER NOT NULL
UNIQUE(tag_id, entity_type, entity_id)
```

#### `media_folders`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
parent_id INTEGER REFERENCES media_folders(id) ON DELETE CASCADE
```

#### `media_assets`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
filename TEXT NOT NULL         -- original filename for display
path TEXT NOT NULL UNIQUE      -- absolute path inside userData/media/
type TEXT NOT NULL CHECK(type IN ('image','video','audio'))
folder_id INTEGER REFERENCES media_folders(id) ON DELETE SET NULL
duration_ms INTEGER            -- not populated by import, reserved
created_at DATETIME DEFAULT (datetime('now'))
```

#### `services`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
title TEXT NOT NULL
date DATE
notes TEXT
```

#### `service_items`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE
item_type TEXT NOT NULL CHECK(item_type IN ('song','media','slide'))
ref_id INTEGER               -- song id, media_asset id, or null for custom slides
order_index INTEGER NOT NULL
notes TEXT
content TEXT                 -- for item_type='slide': JSON {text, ...} or plain text
background_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
```

#### `output_channels`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
type TEXT NOT NULL CHECK(type IN ('screen','ndi'))
display_index INTEGER          -- legacy, not used for matching
display_bounds TEXT            -- legacy; physical screens now live in channel_monitors
linked_channel_id INTEGER REFERENCES output_channels(id) ON DELETE SET NULL
template TEXT NOT NULL DEFAULT 'fullscreen' CHECK(template IN ('fullscreen','lowerthird'))
ndi_fps INTEGER DEFAULT 30
ndi_width INTEGER DEFAULT 1920
ndi_height INTEGER DEFAULT 1080
logo_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
active INTEGER NOT NULL DEFAULT 1
```

#### `channel_monitors` (v4)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
channel_id INTEGER NOT NULL REFERENCES output_channels(id) ON DELETE CASCADE
display_bounds TEXT NOT NULL   -- JSON {"x":0,"y":0,"width":1920,"height":1080}
label TEXT
active INTEGER NOT NULL DEFAULT 1
```

One row per physical screen assigned to a channel. Multiple monitors can share a channel — all receive the same `slide:update` and display identical content simultaneously. Screen channels no longer store `display_bounds` on the channel row itself; `channel_monitors` is the source of truth. NDI channels have no `channel_monitors` rows.

#### `settings`
```sql
key TEXT PRIMARY KEY
value TEXT NOT NULL            -- JSON-encoded. e.g. 42, "string", null
```

Known keys:
| Key | Type | Description |
|---|---|---|
| `global_logo_id` | number\|null | Media asset ID for global logo |
| `global_bg_song_id` | number\|null | Global default background for songs |
| `global_bg_slide_id` | number\|null | Global default background for slides |
| `operator_preview_layout` | 'stacked'\|'sidebyside' | Unused in current UI — reserved |

#### `db_version`
```sql
version INTEGER NOT NULL       -- current: 2
```

---

## 6. Media Handling — Critical Details

### The `cue-media://` protocol

All media file URLs in the renderer and output windows use a custom `cue-media://` protocol. This is necessary because:
- The renderer is served from `http://localhost` (Vite dev server) — `file://` requests are blocked by CORS
- In production the renderer is a local file but `file://` still has cross-origin issues with userData paths

**Protocol registration** (`main/index.js`):
```js
protocol.registerSchemesAsPrivileged([
  { scheme: 'cue-media', privileges: { secure: true, standard: true,
    supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
]);
// Must be called BEFORE app.whenReady()
```

**Protocol handler** (`main/index.js`, inside `app.whenReady()`):
- Receives `cue-media://localhost/absolute/path/to/file`
- Extracts `pathname` via `new URL(request.url).pathname`
- Decodes it: `decodeURIComponent(pathname)` → absolute filesystem path
- Supports HTTP range requests (for video seeking)
- Returns `Response` with correct MIME type

### CRITICAL URL GOTCHA

`cue-media:///Users/...` (three slashes, no hostname) **does not work**.

Chromium's standard-scheme URL parser treats `cue-media:///Users/...` as having `users` as the hostname (lowercased first path segment), stripping it from `pathname`. The protocol handler then tries to read `/weze/Library/...` which doesn't exist.

**Always use `cue-media://localhost` as the base.** The `localhost` hostname is discarded; only `pathname` is used.

### `mediaUrl.js`
```js
export function mediaUrl(absPath) {
  if (!absPath) return null;
  const encoded = absPath.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return 'cue-media://localhost' + encoded;
}
```

Use this function everywhere in renderer code. Output templates (`fullscreen.js`, `lowerthird.js`) have an equivalent inline `pathToUrl()` function.

### Media import flow

1. Operator picks files via `dialog.showOpenDialog` (or file input in MediaPickerModal)
2. `media:import` IPC → `media.importFiles(filePaths)` in `db/media.js`
3. Each file: copy to `userData/media/<uuid>.<ext>`, insert into `media_assets` with absolute `destPath`
4. Returns array of `{ id, filename, path, type }` records
5. `path` is the stored absolute path that `mediaUrl()` encodes

### Rendering media

```jsx
// In renderer:
<img src={mediaUrl(asset.path)} />
<video src={mediaUrl(asset.path)} autoPlay loop muted />

// In output templates (fullscreen.js / lowerthird.js):
function pathToUrl(p) {
  if (!p) return null;
  return 'cue-media://localhost' + p.split('/').map(encodeURIComponent).join('/');
}
```

---

## 7. IPC API — `window.cue`

All renderer↔main communication is via `ipcRenderer.invoke` / `ipcMain.handle`, exposed as `window.cue.*` through the contextBridge preload.

### `window.cue.songs`

| Method | Returns | Notes |
|---|---|---|
| `search(query)` | `[{id, title, author}]` | FTS5 prefix search. Empty/null query returns all. |
| `listAll()` | `[{id, title, author, copyright, default_background_id, tags:[...]}]` | Full list with tags. |
| `get(id)` | `{id, title, author, copyright, default_background_id, background_path, sections:[...], tags:[...]}` | Full song with sections ordered by order_index. |
| `create(data)` | `id` | data: `{title, author, copyright, sections:[{type,content,style_json}], tagIds:[]}` |
| `update(id, data)` | void | Same shape as create. Sections rebuild replaces all existing. |
| `delete(id)` | `{hasReferences: bool, count: number}` | Refuses if referenced by service_items. |
| `addTag(songId, tagId)` | void | — |
| `removeTag(songId, tagId)` | void | — |
| `setBackground(songId, mediaId\|null)` | void | Sets songs.default_background_id. |
| `deleteAll()` | void | Deletes all songs, their sections, taggables, and all song-type service_items. Irreversible. |

### `window.cue.tags`

| Method | Returns |
|---|---|
| `list()` | `[{id, name, colour}]` |
| `create({name, colour})` | `id` |
| `update(id, {name, colour})` | void |
| `delete(id)` | void |

### `window.cue.services`

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[{id, title, date, notes}]` | Date DESC order. |
| `get(id)` | `{...service, items:[resolvedItems]}` | Items fully resolved (see resolveItem below). |
| `create({title, date, notes})` | `id` | — |
| `update(id, data)` | void | — |
| `delete(id)` | void | Cascades to service_items. |
| `reorderItems(serviceId, orderedIds)` | void | Updates order_index for each id. |
| `addItem(serviceId, item)` | `id` | item: `{item_type, ref_id, notes, content, background_override_id}` |
| `removeItem(itemId)` | void | — |
| `setItemBackground(itemId, mediaId\|null)` | void | Sets background_override_id. |
| `setItemNotes(itemId, notes)` | void | — |
| `duplicateItem(itemId)` | `id` | Appends copy at end of rundown. |
| `clearItems(serviceId)` | void | Removes all items from a rundown; keeps the service row. Used by Danger Zone. |
| `applyBackgroundToRundown(serviceId, mediaId)` | `count` | Sets background_override_id on every song slot AND updates each song's default_background_id. |

**`resolveItem()` shape** — what `services:get` returns per item:
```js
{
  // All service_items columns (id, service_id, item_type, ref_id, order_index, notes, content, background_override_id)
  song: { id, title, author, copyright, default_background_id,
          default_background: { id, path, filename, type } | null },
  sections: [{ id, song_id, type, order_index, content, style_json }],
  asset: { ...media_asset },            // if item_type === 'media'
  background_override: { ...media_asset } | null,
}
```

### `window.cue.output`

| Method | Returns | Notes |
|---|---|---|
| `go(payload)` | void | Dispatches to all active output windows. |
| `clear()` | void | Clears all outputs, stops live capture. |
| `logo()` | void | Shows logo on all outputs. |
| `setLive(enabled)` | void | Opens or closes all output BrowserWindows. Toggle in transport bar. |
| `getState()` | `{isLive, livePayload, activeChannels:[ids], activeWindows, outputsEnabled, displayMode}` | — |
| `channels.list()` | `[output_channel rows]` | — |
| `channels.create(data)` | `channel` | NDI channels open a BrowserWindow immediately; screen channels wait for monitor assignment. |
| `channels.update(id, data)` | `channel` | Syncs window. |
| `channels.delete(id)` | void | Closes window(s) and cascades to channel_monitors. |
| `monitors.list(channelId?)` | `[channel_monitor rows]` | Pass channelId to filter. |
| `monitors.create(channelId, {display_bounds, label})` | `monitor` | Assigns a physical screen to a channel and opens its BrowserWindow. |
| `monitors.delete(monitorId)` | void | Closes window and removes row. |
| `multiview.start()` | void | Begins capturing all output windows; emits `output:multiview-captures` at ~5fps. |
| `multiview.stop()` | void | Stops multiview capture. |
| `screens.list()` | `[{id, bounds, scaleFactor, label}]` | All connected displays. |

**Output payload structure:**
```js
{
  type: 'content' | 'clear' | 'logo',
  text: string | null,
  sectionLabel: string | null,
  copyright: string | null,
  backgroundPath: string | null,    // absolute filesystem path (not a URL)
  logoPath: string | null,          // absolute filesystem path
  styleJson: object | null,         // parsed style_json
}
```

### `window.cue.media`

| Method | Returns | Notes |
|---|---|---|
| `import(filePaths)` | `[{id, filename, path, type}]` | Copies files to userData/media/. |
| `get(id)` | `media_asset \| null` | Single asset by ID. |
| `list(folderId?)` | `[media_asset]` | `null`/`undefined` → root (folder_id IS NULL). Pass folder id for subfolder. |
| `delete(id)` | void | Removes DB row and deletes file. |
| `getDiskUsage()` | `number` | Total bytes in userData/media/. |
| `getMediaDir()` | `string` | Absolute path to userData/media/. |
| `folders.create(name, parentId?)` | `id` | — |
| `folders.rename(id, name)` | void | — |
| `folders.delete(id)` | void | Moves folder contents to root. |
| `folders.tree()` | `[{id, name, parent_id, children:[...]}]` | Recursive tree. |

### `window.cue.settings`

| Method | Notes |
|---|---|
| `get(key)` | Returns JSON-parsed value or null. |
| `set(key, value)` | JSON-encodes value, upserts. |
| `setGlobalLogo(mediaId\|null)` | Sets `global_logo_id`. |
| `setGlobalBackground(type, mediaId\|null)` | type: `'song'` or `'slide'`. |
| `applyBackgroundToAll(type, mediaId)` | Bulk-updates all songs.default_background_id (song type only). |
| `getDiskUsage()` | Delegates to media.getDiskUsage(). |
| `getDataPath()` | Returns app.getPath('userData'). |
| `openDataFolder()` | Opens userData in Finder/Explorer. |

### `window.cue.dialog`
- `openFile(options)` → `{canceled, filePaths}` — wraps `dialog.showOpenDialog`.

### `window.cue.fonts`
- `fonts.list` — synchronous: `[{family, label, category}]` from `BUNDLED_FONTS`
- `fonts.default` — synchronous: `'Inter'`

### `window.cue.on(channel, callback)` / `window.cue.off(channel, callback)`
Subscribe to main→renderer events. Allowed channels:
- `output:unresolved-channels` — array of unresolved channel objects on startup
- `output:state-changed` — fired after go/clear/logo/setLive; payload: `{activeWindows, outputsEnabled, displayMode}`
- `output:live-capture` — data URL of captured output frame (every 200ms while live)
- `output:multiview-captures` — array of `{channelId, dataUrl}` objects (~5fps, only while multiview is running)
- `output:ndi-unavailable` — fired if grandiose is not installed
- `shortcut:next` / `shortcut:prev` — reserved for future hardware remote

---

## 8. Section Style JSON

`song_sections.style_json` is a nullable TEXT column. `null` means "use output channel defaults." When populated it is a serialised JSON object:

```json
{
  "align":       "center",   // "left" | "center" | "right"
  "bold":        false,
  "italic":      false,
  "fontFamily":  null,       // CSS family string matching fonts.css, or null for default
  "fontSize":    null,       // number (px) or null
  "color":       null,       // hex string or null
  "lineSpacing": null,       // CSS line-height multiplier or null
  "runs":        []          // reserved: [{start, end, bold, italic, color, fontFamily, fontSize}]
}
```

`SongEditor.jsx` holds style as a parsed JS object per section. `serializeStyle()` converts to JSON only if at least one non-default value is set; otherwise saves `null`.

`renderWithRuns(text, runs)` is exported from `SongEditor.jsx` and used in `PreviewLivePanel.jsx` to render text with run-level styling in the monitor frame. Output templates have an equivalent inline copy.

---

## 9. Background Resolution Order

When building the output payload, `resolveBackground(item)` in `OperatorView.jsx` follows this priority:

```
1. item.background_override.path        — per-rundown-slot override (set via context menu)
2. item.song.default_background.path    — per-song default (set via songs:setBackground or song editor)
3. globalBgSong.path / globalBgSlide.path — global type default (from settings)
4. null → black screen
```

`globalBgSong` / `globalBgSlide` are loaded in `OperatorView` on mount using `window.cue.media.get(id)` (fetches by ID, works regardless of folder). The resolved `backgroundPath` is an absolute filesystem path passed in the output payload. Output windows convert it to `cue-media://` via their inline `pathToUrl()`.

Custom slides use `global_bg_slide_id`; songs use `global_bg_song_id`.

### Background write-through (cross-rundown persistence)

Setting a background on a rundown slot via "Set Background Override" **also writes to the song's own `default_background_id`**. This means the background follows the song into any new rundown it is later added to. Two code paths both do this:

- `services.setItemBackground(itemId, mediaId)` — DB function; writes `service_items.background_override_id` AND `songs.default_background_id` when the item is a song.
- `services.applyBackgroundToRundown(serviceId, mediaId)` — DB function; sets override on all song slots AND updates each distinct song's `default_background_id`.

The renderer's `RundownPanel` also calls `window.cue.songs.setBackground` after the picker resolves, as a belt-and-suspenders measure.

---

## 10. Design System

### Design philosophy
Mission-control broadcast engineering: dark, precise, information-dense. Not a consumer app. Material Design 3 semantic roles.

### Colour tokens (Tailwind custom colours in `tailwind.config.js`)

| Token | Hex | Semantic use |
|---|---|---|
| `background` | `#111317` | Page background |
| `surface-container-lowest` | `#0c0e12` | Input fields |
| `surface-container-low` | `#1a1c20` | Panel backgrounds, modal shells |
| `surface-container` | `#1e2024` | Cards, section rows |
| `surface-container-high` | `#282a2e` | Panel headers, footers, toolbars |
| `surface-container-highest` | `#333539` | Hover states, active tabs |
| `surface-variant` | `#333539` | Same as highest — hover bg |
| `outline-variant` | `#424754` | Dividers, inactive borders |
| `outline` | `#8c909f` | Secondary borders |
| `on-surface` | `#e2e2e8` | Primary text |
| `on-surface-variant` | `#c2c6d6` | Secondary text |
| `primary` | `#adc6ff` | Preview / staged / selected (blue) |
| `primary-container` | `#4d8eff` | Primary button bg |
| `on-primary` | `#002e6a` | Text on primary |
| `secondary` | `#ffb3ad` | Live / on-air / danger (red-coral) |
| `secondary-container` | `#a40217` | LIVE badge bg |
| `on-secondary` | `#68000a` | Text on secondary |
| `tertiary` | `#4ae176` | GO / success / active output (green) |
| `tertiary-container` | `#00a74b` | Save button bg |
| `on-tertiary` | `#003915` | Text on tertiary |
| `error` | `#ffb4ab` | Destructive actions |
| `error-container` | `#93000a` | Error bg |

**Never use:** `bg-slate-*`, `border-slate-*`, `text-indigo-*`, `bg-indigo-*`, or any purple/violet accent.

### Typography tokens

| Token | Font | Size | Weight | Treatment |
|---|---|---|---|---|
| `text-headline-md` | Inter | 20px / 28px | 600 | — |
| `text-display-lg` | Inter | 32px / 40px | 700 | tracking -0.02em |
| `text-body-md` | Inter | 14px / 20px | 400 | — |
| `text-label-sm` | JetBrains Mono | 12px / 16px | 500 | uppercase tracking-[0.05em] |
| `font-label-sm` | JetBrains Mono | — | — | Pairs with `text-label-sm` |

JetBrains Mono is NOT bundled in `src/fonts/`. It falls back to `ui-monospace`. Used for all labels, chips, badges, buttons.

Oswald is reserved for output window templates only. Do not use in operator UI.

### Spacing tokens
`xs=4px` `sm=8px` `md=16px` `lg=24px` `xl=32px` `gutter=12px`

### CSS utility classes (`src/renderer/index.css`)

| Class | Effect |
|---|---|
| `.monitor-preview` | Blue border + blue glow on monitor frame |
| `.monitor-live` | Red-coral border + red glow |
| `.monitor-idle` | Dark neutral border |
| `.tally-live` | 4px red left border + red bg tint on rundown rows |
| `.tally-preview` | 4px blue left border + blue bg tint |
| `.tally-idle` | Transparent left border |
| `.dot-pulse` | Pulsing opacity animation (ON AIR dot) |
| `.live-pulse` | Pulsing box-shadow animation |
| `.drag-handle` | `cursor: grab` |
| `.titlebar-drag` | `-webkit-app-region: drag` |
| `.titlebar-nodrag` | `-webkit-app-region: no-drag` |
| `.section-chip` | JetBrains Mono label chip style |
| Custom scrollbar | 6px, `surface-container-low` track, `surface-container-highest` thumb |

### Component rules
- **Borders:** `border border-outline-variant/30` on containers. `/20`–`/40` opacity suffixes preferred.
- **Border radius:** `rounded-lg` (0.25rem) for cards/panels. `rounded-xl` (0.5rem) for modals.
- **No box shadows on flat surfaces.** Depth is expressed via surface lightness levels.
- **Tally bars:** `border-l-4` coloured left edge on rundown items.
- **Modals:** `fixed inset-0 bg-background/80 backdrop-blur-sm`. Container: `bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5`.
- **Inputs:** `bg-surface-container-lowest border border-outline-variant/50 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary/30`.

---

## 11. Operator UI Layout

```
┌─── Titlebar (38px, draggable) ───────────────────────────────────┐
│ Cue │ [Operator] [Settings]                     GO  Clear  Logo  │  ← transport bar (40px)
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─── Rundown ──────┐  │  ┌─── Preview/Live ──────────────────┐ │
│  │  Service select   │  │  │ PREVIEW mon.  │  LIVE mon.        │ │
│  │  [DnD item list]  │  │  ├───────────────┼───────────────────┤ │
│  │                   │  │  │ Preview slides│  Live slides      │ │
│  └───────────────────┘  │  └───────────────────────────────────┘ │
│                                                                   │
├─── horizontal resize ─────────────────────────────────────────────┤  ← 3px drag
│  ┌─── Library (full width) ──────────────────────────────────────┐ │
│  │  [Songs tab] [Media tab]                                      │ │
│  └───────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

Panel boundaries are user-resizable:
- **Horizontal** (Rundown width / Preview+Live width): default 25% / 75%, clamped 22–72%.
- **Vertical** (top panels / Library): default 62% / 38%, clamped 35–80%.
- Resize state is **not persisted** (a known gap).

---

## 12. Operator Workflow — Preview / Live Mechanics

Preview and live are fully independent buses. A different song can be in preview while another is live.

### State variables (in `OperatorView.jsx`)
```
previewItemId    — service_items.id currently loaded in preview
previewSlideIdx  — which section index is highlighted in preview
liveItemId       — service_items.id currently on output
liveSlideIdx     — which section index is currently on output
```

### Interaction table

| Action | Result |
|---|---|
| Single-click rundown item | Sets `previewItemId`, resets `previewSlideIdx=0`. No live change. |
| Double-click rundown item | Sets `previewItemId`, sends slide 0 to live. |
| Single-click in Preview Slides list | Updates `previewSlideIdx`. Preview monitor only. |
| Double-click in Preview Slides list | Sends that slide to live. |
| Single-click in Live Slides list | Sends that slide to live immediately. |
| GO button / G key | Sends `previewItem[previewSlideIdx]` to live. |
| Space / ↓ arrow | `previewSlideIdx++`. No live change. |
| ↑ arrow | `previewSlideIdx--`. No live change. |
| Escape | `output:clear`. Sets `liveItemId=null`. |
| L key | `output:logo`. |
| Double-click song in Library | Adds to rundown. No preview/live change. |

### Keyboard shortcuts
Registered as a `keydown` listener on `document` inside `OperatorView`. **Not** `globalShortcut`. The listener checks `document.activeElement` — suppressed when an `INPUT`, `TEXTAREA`, or `contenteditable` has focus. A `useRef` holds the current handler to avoid stale closures.

**Do not use `globalShortcut`** — it captures at OS level and prevents typing G, L, Space in any input field system-wide.

---

## 13. Output Windows

### Window creation (`output/manager.js`)

**Screen channel:**
```js
BrowserWindow({ x, y, width, height, fullscreen: true, frame: false, alwaysOnTop: true,
  backgroundColor: '#000000', webPreferences: { preload: output-preload.js } })
win.loadFile(src/output/fullscreen.html)
```

**NDI channel:**
```js
BrowserWindow({ width: ndi_width, height: ndi_height, show: false, frame: false, transparent: true,
  webPreferences: { preload: output-preload.js } })
win.loadFile(src/output/fullscreen.html)
```

Display matching uses **bounds** (`x, y, width, height`), never `display_index`. If stored bounds don't match any connected display, the channel is flagged as unresolved. On startup, unresolved channels are sent via `output:unresolved-channels` IPC, which causes `App.jsx` to navigate to Settings.

### Template path
```js
path.join(app.getAppPath(), 'src', 'output', `${channel.template}.html`)
```
Works in both dev (ASAR not used) and production (path is inside ASAR).

### go / clear / logo dispatch
`manager.go(payload)` iterates all active windows and sends `webContents.send('slide:update', payload)`. The `payload.backgroundPath` is an absolute filesystem path — the output template converts it to `cue-media://` using its inline `pathToUrl()`.

### Live capture
`startLiveCapture()` runs a `setInterval` at 200ms, captures the first output window via `webContents.capturePage()`, converts to data URL, and sends `output:live-capture` to the main window. This is the **operator UI live thumbnail** — unrelated to NDI.

---

## 14. NDI Status

**Current state:** Infrastructure only. Non-functional for actual NDI publish.

What exists:
- `ndi.js` — tries `require('grandiose')`, sets `ndiAvailable` flag. That's it.
- NDI channels create a hidden BrowserWindow and receive `slide:update` payloads correctly.
- On startup, if grandiose is absent, `App.jsx` shows an amber "NDI SDK missing" warning badge.

What does NOT exist:
- `grandiose` in `package.json`
- `capturePage()` → `grandiose.send()` loop
- `linked_channel_id` consuming logic

To implement: add `grandiose` to `package.json`, `npm run rebuild`, implement capture loop in `ndi.js`.

---

## 15. Fonts

6 font families bundled in `src/fonts/` (12 `.woff2` files). No system font installation required.

| Family | Category |
|---|---|
| Inter | sans-serif (default UI font) |
| Montserrat | sans-serif |
| Lato | sans-serif |
| Oswald | sans-serif condensed (output templates only) |
| Playfair Display | serif |
| EB Garamond | serif |

`fonts.css` has all `@font-face` rules with `font-display: block`. Loaded by:
- Output templates: `<link href="../fonts/fonts.css">` (relative path, works in ASAR)
- Renderer: `@import '../fonts/fonts.css'` in `index.css` (Vite bundles the .woff2 files)

`src/main/fonts.js` exports `BUNDLED_FONTS` (array) and `DEFAULT_FONT = 'Inter'`. Exposed as `window.cue.fonts.list` / `window.cue.fonts.default` (synchronous, no IPC).

**To add a font:** drop `.woff2` into `src/fonts/`, add `@font-face` to `fonts.css`, add entry to `BUNDLED_FONTS` in `fonts.js`.

---

## 16. Song Editor Details

`SongEditor.jsx` is a full-screen modal (via `createPortal`). Key internals:

**Per-section styling toolbar** — each section row shows inline controls:
Font family, font size (32–128px), colour swatch (native `<input type="color">`), bold, italic, align L/C/R, reset button. State held as parsed JS objects. Serialised to `style_json` on save.

**Paste Song parser (`parseSong`)** — pure regex, no API. Detection priority:
1. `[Verse 1]` bracketed labels
2. `Chorus:` keyword + colon alone on line
3. `CHORUS` bare keyword alone on line
No-header fallback: split by blank lines, all → `verse`. The user then relabels.

**Section ordering** — drag-to-reorder via `@dnd-kit`. Each section has a local `_key` for stable React identity.

**`renderWithRuns(text, runs)`** is exported from `SongEditor.jsx` and imported by `PreviewLivePanel.jsx` to render inline HTML with run-level styling in the monitor frame.

---

## 17. Known Gaps and Backlog

| Item | Priority | Notes |
|---|---|---|
| **NDI publish (grandiose)** | High | `ndi.js` is a stub. See §14. |
| `linked_channel_id` logic | Medium | Field exists, settable, never read. Sync lower-third to fullscreen channel. |
| Stage display / confidence monitor | High | Phase 2 item. Not yet specced. |
| Persist panel resize state | Low | `operator_panel_splits` key — save H/V% on drag end. |
| Tag CRUD UI | Medium | Tags can be assigned, but create/rename/delete UI is not in Settings. |
| Song background picker in Song Editor | Medium | `songs:setBackground` IPC exists. Can be set via RundownPanel context menu (writes through to song). |
| Disk space warning | Low | Warn when < 2GB free on import. Not implemented. |
| Media unused-asset cleanup | Low | Identify media not referenced by any song or service_item. |
| Drag asset from Library onto rundown item | Medium | Background override currently only via context menu. |
| `operator_preview_layout` setting | Low | Side-by-side monitor layout toggle. Setting key exists, no UI toggle. |

---

## 18. App Startup Sequence

1. `protocol.registerSchemesAsPrivileged` — must be synchronous before app ready
2. `app.whenReady()`:
   a. `protocol.handle('cue-media', ...)` — register media file server
   b. `initDb()` — open SQLite, run pending migrations
   c. Register all IPC handlers (songs, services, media, output, settings)
   d. `createMainWindow()` — show operator UI
   e. `outputManager.init()` — load active channels, create BrowserWindows
   f. On `did-finish-load`: send `output:unresolved-channels` and/or `output:ndi-unavailable` if needed

---

## 19. Running the App

```bash
npm start          # dev mode — Vite dev server + Electron, DevTools auto-open
npm run make       # build distributable (.dmg macOS, .exe Windows)
npm run rebuild    # recompile better-sqlite3 after Electron version bump
```

On macOS unsigned builds: `xattr -cr /Applications/Cue.app` to remove quarantine, or right-click → Open.
