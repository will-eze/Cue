# Cue Graphics Engine — CLAUDE.md

Unified single-process Electron application. Replaces EasyWorship/ProPresenter (worship lyric presentation) and UNO (broadcast overlay graphics). Both use cases run simultaneously — no separate modes, no separate applications.

Full technical specification: `Cue_Phase1a_TechnicalSpec.docx`

---

## Technology stack

| Package | Role |
|---|---|
| Electron 30+ | Desktop shell — **pin the version**, native addons must be rebuilt on every major bump |
| React 18 | Operator UI |
| Vite + `@electron-forge/plugin-vite` | Build tooling |
| Electron Forge | Packaging — macOS `.dmg`, Windows `.exe` |
| better-sqlite3 | Synchronous SQLite — fastest Node driver, avoids async complexity |
| grandiose | NDI output — arm64 native on Apple Silicon, no Rosetta needed |
| Tailwind CSS | Operator UI styling — dark-mode-first |
| react-window | Virtualised list rendering for song library — **included from M3, never retrofit** |

After any Electron version bump: run `npm run rebuild` (`electron-rebuild`) to recompile `better-sqlite3` and `grandiose`.

---

## Process architecture

| Process | Responsibilities |
|---|---|
| Main (Node.js) | SQLite, file system, NDI, window creation, IPC bridge |
| Renderer (Chromium/React) | Operator UI — communicates with main via `contextBridge` preload only |
| Output windows | Lightweight renderers — one per physical display or NDI channel. Plain DOM, no React. Receive `slide:update` IPC, update DOM. |

**Security rule: `nodeIntegration: false` always.** All Node/SQLite access goes through the main process via IPC, exposed through `window.cue` (contextBridge preload). Never bypass this.

---

## Project structure

```
src/
├── main/                    Node.js main process
│   ├── index.js             App entry, window lifecycle
│   ├── preload.js           contextBridge — exposes window.cue
│   ├── db/
│   │   ├── schema.js        Schema DDL + migration runner
│   │   ├── songs.js         Song + section CRUD, FTS5 search
│   │   ├── services.js      Service / rundown CRUD
│   │   ├── media.js         Media asset + folder CRUD
│   │   └── settings.js      Key-value settings persistence
│   ├── ipc/
│   │   ├── songs.ipc.js
│   │   ├── services.ipc.js
│   │   ├── media.ipc.js
│   │   ├── output.ipc.js
│   │   └── settings.ipc.js
│   └── output/
│       ├── manager.js       Channel registry + BrowserWindow lifecycle
│       └── ndi.js           grandiose publish, frame capture loop
├── renderer/                React operator UI
│   ├── App.jsx              Root layout, top nav
│   ├── views/
│   │   ├── OperatorView.jsx Top-half + bottom-half layout
│   │   └── SettingsView.jsx Replaces operator view (not a modal)
│   ├── panels/
│   │   ├── RundownPanel.jsx         Top-left
│   │   ├── PreviewLivePanel.jsx     Top-right
│   │   └── LibraryPanel.jsx         Bottom, full-width
│   ├── components/
│   │   ├── SongEditor.jsx           Modal — create/edit
│   │   ├── SongPreviewModal.jsx     Modal — preview before add
│   │   ├── ContextMenu.jsx          Right-click menu
│   │   └── SlideList.jsx            Vertical slide nav in preview panel
│   └── settings/
│       ├── OutputChannels.jsx
│       ├── LogoSettings.jsx
│       └── BackgroundSettings.jsx
└── output/                  Plain HTML output templates (no React)
    ├── fullscreen.html / .css
    └── lowerthird.html / .css
```

---

## Database

**Engine**: `better-sqlite3` (synchronous).
**Location**:
- macOS: `~/Library/Application Support/Cue/cue.db`
- Windows: `%APPDATA%\Cue\cue.db`

**Media files** are always copied into `userData/media/<uuid>.<ext>` on import. Original source paths are not retained.

### Tables

| Table | Purpose |
|---|---|
| `songs` | Title, author, copyright, default_background_id |
| `song_sections` | Ordered lyric sections per song. `content` is plain text with `\n` line breaks. `style_json` (nullable) holds section-level styling metadata — see below. |
| `songs_fts` | FTS5 virtual table — mirrors title, author, section content via triggers |
| `tags` | Tag labels with hex colour |
| `taggables` | Polymorphic pivot — tags applied to songs or media_assets |
| `services` | Service/rundown headers |
| `service_items` | Ordered items within a service (song/media/slide) |
| `media_assets` | Imported media — image, video, audio |
| `media_folders` | Self-referencing folder tree |
| `output_channels` | Screen and NDI output channel config |
| `settings` | Key-value store for app-wide settings |
| `db_version` | Single-integer migration cursor — must exist before first deployment |

### Background resolution order (highest priority first)

1. `service_items.background_override_id` — operator set for this specific rundown slot
2. `songs.default_background_id` — per-song default (skipped for custom slides)
3. `settings.global_bg_song_id` / `global_bg_slide_id` — global type default
4. Black (no background)

### `style_json` — section styling format

`song_sections.style_json` is a nullable TEXT column containing a JSON object. `null` means "use output channel / global template defaults." When populated:

```json
{
  "align":       "center",   // "left" | "center" | "right"
  "bold":        false,
  "italic":      false,
  "fontFamily":  null,       // CSS font-family string, e.g. "Helvetica Neue" or null for default
  "fontSize":    null,       // points (number) or null for default
  "color":       null,       // hex string or null for default
  "lineSpacing": null,       // multiplier (number) or null for default
  "runs":        []          // future: [{from, to, bold, italic, color, fontFamily}] for per-word styling
}
```

**Content stays plain text.** `style_json` is purely presentation metadata. `fontFamily` must match a CSS family name declared in `src/fonts/fonts.css` — see Bundled fonts below. FTS5 indexes `content` only — styling does not pollute search. The song editor writes to `style_json` via the per-section styling toolbar; it never modifies `content`.

**Line breaks:** `content` uses `\n` characters. Rendered with `white-space: pre-wrap` in output templates and `whitespace-pre-wrap` in React preview monitors.

---

## Bundled fonts

Font files live in `src/fonts/` and ship inside the app ASAR. No system font installation required.

| CSS family name | Category | Files |
|---|---|---|
| `Inter` | sans-serif | Inter-Regular.woff2, Inter-Bold.woff2 |
| `Montserrat` | sans-serif | Montserrat-Regular.woff2, Montserrat-Bold.woff2 |
| `Lato` | sans-serif | Lato-Regular.woff2, Lato-Bold.woff2 |
| `Oswald` | sans-serif (condensed) | Oswald-Regular.woff2, Oswald-Bold.woff2 |
| `Playfair Display` | serif | PlayfairDisplay-Regular.woff2, PlayfairDisplay-Bold.woff2 |
| `EB Garamond` | serif | EBGaramond-Regular.woff2, EBGaramond-Bold.woff2 |

`src/fonts/fonts.css` declares all `@font-face` rules. It is linked by:
- `src/output/fullscreen.html` and `lowerthird.html` — via `<link href="../fonts/fonts.css">`
- `src/renderer/index.css` — via `@import '../fonts/fonts.css'` (Vite bundles the files)

The canonical font list for the UI is exported from `src/main/fonts.js` (`BUNDLED_FONTS`, `DEFAULT_FONT`) and exposed as `window.cue.fonts.list` / `window.cue.fonts.default` via the contextBridge preload (synchronous — no IPC roundtrip).

To add a font: download the `.woff2` file(s) into `src/fonts/`, add `@font-face` rules to `fonts.css`, and add an entry to `BUNDLED_FONTS` in `fonts.js`.

---

## Song Editor — `SongEditor.jsx`

The modal song editor (`src/renderer/components/SongEditor.jsx`) has two capabilities beyond basic CRUD:

### Per-section styling toolbar

Each section row in the editor displays an inline toolbar:

| Control | `style_json` field | Notes |
|---|---|---|
| Font family dropdown | `fontFamily` | Options from `window.cue.fonts.list`. "Default font" sets `null`. |
| Font size dropdown | `fontSize` (number, px) | Values: 32 40 48 56 64 72 80 96 112 128 |
| Colour swatch | `color` (hex string) | Native OS colour picker. Defaults to `#ffffff` display when unset. |
| Bold | `bold` (boolean) | — |
| Italic | `italic` (boolean) | — |
| Align left / centre / right | `align` ('left'\|'center'\|'right') | Default centre. |
| Reset button | Clears all style fields | Only shown when any non-default style is applied |

Style state is held as a parsed JS object per section in React local state. On save, it is serialised to `style_json` (or `null` if no non-default values are set) and written to the database.

### Paste Song — section parser

The "↙ Paste Song" link in the sections area opens a full-height textarea. The operator pastes a complete song; clicking "Import Sections" runs `parseSong(rawText)` (pure regex, no external API) and replaces the current sections with the result.

**Detection rules (priority order):**
1. `[Verse 1]`, `[CHORUS]`, `[Pre-Chorus]` — bracketed label with optional trailing colon
2. `Verse 1:`, `Chorus:`, `BRIDGE:` — known keyword + optional number + colon, alone on line
3. `Verse 1`, `CHORUS`, `bridge` — bare known keyword with optional number, alone on line

Known keywords: `verse`, `chorus`, `bridge`, `pre-chorus` / `pre chorus` / `prechorus`, `tag`, `intro`, `outro`, `refrain` (maps to `chorus`).

Leading list numbers (`1.` `2)` `(1)` `[1]`) are stripped from content lines.

**No-header fallback:** If no headers are detected, the parser splits by blank lines and marks everything `verse` for the operator to relabel.

**Constraint:** No LLM or API fallback. Regex only. This is an explicit product decision — offline-safe, zero latency, no network dependency.

---

### Migration rule

`schema.js` reads `db_version` on startup and runs pending migrations in sequence. This must be in place before the first user-facing build — retrofitting it requires users to delete their database.

---

## IPC API (`window.cue`)

All renderer↔main communication is via `ipcRenderer.invoke` / `ipcMain.handle`, exposed as `window.cue.*`.

### Songs
- `songs:search(query)` — FTS5, returns `[{id, title, author}]`
- `songs:get(id)` — full song with sections ordered by `order_index`
- `songs:create(data)` — inserts song + sections, returns new id
- `songs:update(id, data)` — updates song/sections, rebuilds FTS entries
- `songs:delete(id)` — checks `service_items` references first, warns if found
- `songs:addTag(songId, tagId)` / `songs:removeTag(songId, tagId)`
- `songs:setBackground(songId, mediaId|null)`

### Services
- `services:list` — all services, date DESC
- `services:get(id)` — service with all items resolved
- `services:create(data)` / `services:update(id, data)`
- `services:reorderItems(serviceId, orderedIds)` — single transaction
- `services:addItem(serviceId, item)` / `services:removeItem(itemId)`
- `services:setItemBackground(itemId, mediaId|null)`
- `services:setItemNotes(itemId, notes)`

### Output
- `output:go(payload)` / `output:clear` / `output:logo`
- `output:getState` — returns `{ isLive, livePayload, activeChannels }`
- `output:channels:list` / `:update(id,data)` / `:create(data)` / `:delete(id)`
- `output:screens:list` — `screen.getAllDisplays()` with thumbnails

### Media
- `media:import(filePaths)` — copies to userData, returns records
- `media:list(folderId?)` / `media:delete(id)`
- `media:folders:create(name, parentId?)` / `media:folders:tree`

### Settings
- `settings:get(key)` / `settings:set(key, value)`
- `settings:setGlobalLogo(mediaId|null)`
- `settings:setGlobalBackground(type, mediaId|null)` — type: `'song'` or `'slide'`
- `settings:applyBackgroundToAll(type, mediaId)` — bulk update, UI must confirm first
- `settings:getDiskUsage` — total bytes in `userData/media/`

---

## Output payload structure

```js
{
  type: 'content' | 'clear' | 'logo',
  text: string | null,
  sectionLabel: string | null,    // e.g. 'Chorus'
  copyright: string | null,
  backgroundPath: string | null,  // absolute path to media file
  logoPath: string | null,        // set when type === 'logo'
}
```

Output windows receive this via `webContents.send('slide:update', payload)`.

### Clear vs Logo behaviour

- **Go**: text + background rendered per template layout
- **Clear**: text set to empty string, background cleared, template structure preserved — lower-third shows empty transparent band (no visual artefact on video feed)
- **Logo**: logo asset rendered within the channel's own template region — lower-third channel shows logo in lower-third band only

---

## Output channels

### Screen channels
```js
new BrowserWindow({
  x: display.bounds.x, y: display.bounds.y,
  width: display.bounds.width, height: display.bounds.height,
  fullscreen: true, frame: false, alwaysOnTop: true,
  backgroundColor: '#000000',
  webPreferences: { preload: '...', contextIsolation: true }
})
```

### NDI channels (hidden off-screen window)
```js
new BrowserWindow({
  width: channel.ndi_width,   // default 1920
  height: channel.ndi_height, // default 1080
  show: false, frame: false,
  webPreferences: { preload: '...', contextIsolation: true }
})
```

NDI capture: `webContents.capturePage()` at configured FPS, published via `grandiose`. Capture loop runs in main process. Default 1080p30. Alpha channel preserved for OBS keyed sources.

**NDI SDK requirement**: The NDI Tools runtime must be installed separately on every host machine. Detect its absence on startup and show a Settings warning — do not crash silently.

### Display matching on startup

Match screen channels to physical displays using **bounds** (`x, y, width, height`), not `display_index`. If a channel's stored bounds do not match any connected display, flag it as unresolved and open Settings automatically. Never open an output window at incorrect/off-screen coordinates.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space / Down arrow | Next slide in **preview** (does not affect live output) |
| Up arrow | Previous slide in **preview** (does not affect live output) |
| G | Go — send current preview item/slide to live |
| Escape | Clear all outputs |
| L | Logo all outputs |

Registered as a `keydown` listener on `document` in `OperatorView.jsx` (renderer-side, **not** `globalShortcut`). The listener suppresses shortcuts when focus is inside an `INPUT`, `TEXTAREA`, or `contenteditable` element. Arrow keys and Space navigate the preview cursor only — use G or double-click to commit to live. See implementation record §4.1 for why `globalShortcut` was avoided.

---

## Operator UI layout

Target minimum resolution: **1920×1080**.

```
┌─────────────────────┬─────────────────────┐
│   Rundown Panel     │  Preview/Live Panel  │
│   (top-left)        │  (top-right)         │
├─────────────────────┴─────────────────────┤
│          Library Panel (full-width)        │
│          Songs tab | Media tab             │
└───────────────────────────────────────────┘
```

- **Rundown**: one row per service item. Single click = load into preview. Double click = load into preview AND go live immediately (first slide).
- **Preview/Live**: stacked by default (toggleable to side-by-side), preference persisted to `settings.operator_preview_layout`. Contains two independent slide lists — see Operator workflow below.
- **Library**: global search bar spans both tabs, debounced 150ms. FTS5 for songs, filename/tag for media. Double-click a song = add directly to rundown.
- **Settings**: replaces operator view, accessed from top nav bar (not a modal).

---

## Operator workflow — Preview/Live mechanics

The preview and live slots are fully independent. A different song can be cued in preview while another song is live.

### State
| Variable | Meaning |
|---|---|
| `previewItemId` | Which rundown item is loaded in preview |
| `previewSlideIdx` | Which slide of that item is focused in preview |
| `liveItemId` | Which rundown item is currently live on output |
| `liveSlideIdx` | Which slide of the live item is currently on screen |

### Interactions
| Action | Result |
|---|---|
| Single-click rundown item | Loads item into preview, resets `previewSlideIdx` to 0. No live change. |
| Double-click rundown item | Loads item into preview and immediately sends slide 0 to live. |
| Single-click in **Preview Slides** list | Updates `previewSlideIdx` only. Preview monitor updates. No live change. |
| Double-click in **Preview Slides** list | Sends that slide to live (`handleGoAtPreviewSlide`). |
| Single-click in **Live Slides** list | Sends that slide to live immediately (`handleSelectLiveSlide`). |
| GO button / G key | Sends current `previewItem` at `previewSlideIdx` to live. |
| Space / Down / Up arrow | Advance/retreat `previewSlideIdx` only. No live change. |
| Escape | Clears all output, sets `liveItemId` to null. |
| Double-click song in library | Adds song to current rundown (no preview modal). |

### Preview/Live panel layout
The bottom half of the panel shows two side-by-side scrollable slide lists. The left column ("Preview Slides") navigates the preview cursor. The right column ("Live Slides") directly controls the live output. Each list shows full multi-line lyric content per section, scrollable. A hint label "dbl-click → live" appears on the preview list header.

---

## Build milestones

| # | Deliverable |
|---|---|
| M1 | Electron + React + Vite + Forge scaffold. contextBridge + one test IPC channel. Builds on macOS and Windows. |
| M2 | All Phase 1a tables. Migration versioning. FTS5 + triggers. `songs:search` working via IPC. |
| M3 | Song CRUD + sections + tags. Library panel. FTS5 search. Song Editor and Song Preview modals. react-window in song list. |
| M4 | Single BrowserWindow output. Fullscreen template. Go/Clear/Logo end-to-end. |
| M5 | Output channel manager. Multiple simultaneous outputs. Bounds-based display matching. Unresolved channel detection + Settings redirect. |
| M6 | Service CRUD. Rundown panel with drag-to-reorder. Single-click preview, double-click live. Slide list navigation. Global keyboard shortcuts. |
| M7 | Media import + folder tree + tag filter. Background resolution order. Drag asset to set override. Global Apply to All. |
| M8 | grandiose NDI. Configurable FPS/resolution. `linked_channel_id` working. OBS verified. NDI absence detection. |
| M9 | Full Settings screen wired. Preview/Live layout toggle persisted. Disk usage + data path display. All IPC channels connected. |

---

## Compatibility notes

- **macOS Gatekeeper** (unsigned builds): `xattr -cr /Applications/Cue.app`, or right-click → Open on first launch.
- **Windows SmartScreen** (unsigned builds): More info → Run anyway. One-time per machine.
- **High-DPI / display scaling**: Use explicit size params in `webContents.capturePage()` for NDI — logical and physical pixel sizes differ on Retina / Windows scaled displays.
- **Polymorphic FK gap**: SQLite cannot enforce `service_items.ref_id` across multiple tables. App layer must check for dangling references before deleting a song and warn the operator.
- **Disk usage**: All media copied on import. Display total usage in Settings. Warn when free disk space falls below 2 GB (configurable threshold).
