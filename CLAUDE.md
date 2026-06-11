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
| grandi | installed | NDI output. ESM-only — loaded via `createRequire` at runtime (never static import). Platform binaries: `@grandi/<os>-<arch>`. Listed in `forge.config.js` `extraModules` and `vite.main.config.js` `external`. |
| Tailwind CSS | 3.4.4 | Operator UI styling. |
| react-window | 1.8.10 | Virtualised song list. |
| @dnd-kit/core + sortable | 6.1.0 / 8.0.0 | Drag-to-reorder in rundown and song editor. |

After any Electron version bump: `npm run rebuild` recompiles `better-sqlite3` and `grandi`.

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
  const normalized = absPath.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  const encoded = pathPart.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return 'cue-media://localhost' + encoded;
}

// Output templates (fullscreen.js / lowerthird.js) — identical inline helper
function pathToUrl(p) {
  if (!p) return null;
  const normalized = p.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  return 'cue-media://localhost' + pathPart.split('/').map(encodeURIComponent).join('/');
}
```

The protocol handler in `main/index.js` extracts the path from `new URL(request.url).pathname`. On Windows the pathname is `/C:/...` — the handler strips the leading `/` before the drive letter. On macOS it is `/Users/...` unchanged.

---

## Project Structure

```
src/
├── main/
│   ├── index.js              App entry. Window creation. cue-media:// protocol handler.
│   │                         Startup: initDb → seedBundledBibles → seedGhsHymnal.
│   ├── preload.js            contextBridge → window.cue. Full renderer API.
│   ├── output-preload.js     Minimal preload for output windows → window.cueOutput only.
│   ├── fonts.js              BUNDLED_FONTS array + DEFAULT_FONT = 'Inter'.
│   ├── import/
│   │   └── songs-import.js   Song-file parsers (pure). parseSongFiles: OpenLyrics XML / ChordPro / text /
│   │                         EasyWorship (SQLite Songs.db+SongWords.db, RTF→text). parseGhsItems (GHS hymnal).
│   ├── db/
│   │   ├── schema.js         SQLite init + migration runner (v1→v9). getDb() singleton.
│   │   ├── songs.js          Song + section + tag CRUD. FTS5 search. deleteAll(). importSongs (tag-aware bulk
│   │   │                     insert) + existingTitleSet. seedGhsHymnal / tagGhsSongs / readBundledGhsRows.
│   │   ├── services.js       Service / rundown CRUD. resolveItem() joins media paths. clearItems(). setItemBackground() writes through to songs.
│   │   ├── media.js          Import (copy to userData/media/), list, getById, delete, folders.
│   │   └── settings.js       Key-value store. Global logo/background helpers.
│   ├── ipc/
│   │   ├── songs.ipc.js      songs:* and tags:* handlers (incl. importParse / importGhs / importCommit).
│   │   ├── services.ipc.js   services:* handlers.
│   │   ├── media.ipc.js      media:* handlers.
│   │   ├── output.ipc.js     output:* handlers.
│   │   └── settings.ipc.js   settings:* handlers.
│   └── output/
│       ├── manager.js        Window registry. go/clear/logo dispatch. NO operator capture loop —
│       │                     live monitor renders from payload. Owns the media `transport`
│       │                     { active, startAt, pausedAt, loop, muted }; mediaControl/mediaSeek/mediaSetMuted
│       │                     + broadcastTransport (media:transport / output:media-transport).
│       │                     isPrimaryAudioMonitor → single program-audio window via ?mute=. Stage
│       │                     timer/message state (stageTimerCmd, setStageMessage).
│       │                     NDI: ndiCaptureLoops Map, startNdiCapture / stopNdiCapture.
│       │                     ndiLastFrames Map: caches JPEG thumbnails at ~1fps when multiview is active.
│       │                     multiviewRefCount: refcounted start/stop — interval starts only at 0→1, stops at 0.
│       └── ndi.js            Active NDI implementation. createRequire loads @grandi/<platform>-<arch>.
│                             createSender / sendFrame (inflight guard) / destroySender / isAvailable.
├── renderer/
│   ├── main.jsx              React entry — mounts <App />.
│   ├── index.css             Design system CSS: tally, monitor glow, scrollbar, animations.
│   ├── App.jsx               Root. Titlebar + transport bar + Operator/Settings view switch.
│   │                         StagePanel popover (Stage button): presenter countdown timer + stage message.
│   ├── views/
│   │   ├── OperatorView.jsx  Three-panel layout. Transport state. Configurable keyboard shortcuts (shortcutsRef).
│   │   │                     Space drives LIVE forward (handleNextLiveSlide); ↑/↓ drive preview (auto-GO when
│   │   │                     preview===live). Background resolution. focusSearchRef wired to LibraryPanel (S key).
│   │   │                     Resize state persisted to localStorage. Services list refreshes on bgRefreshTick.
│   │   │                     Loads channel list; tracks liveChannelIdx for the channel selector. Does NOT
│   │   │                     capture output or start multiview — live monitor renders from payload.
│   │   ├── SettingsView.jsx  Settings page layout. Left column = section nav (Channels/Logo/Background/Bible/
│   │   │                     Shortcuts/Danger) with scroll-to + IntersectionObserver active highlight. Section order:
│   │   │                     OutputChannels → Logo → Background → Bible → Shortcuts → DangerZone → SettingsFooter.
│   │   │                     DangerZone and SettingsFooter always last — rendered at layout level, not in sub-components.
│   │   └── MultiviewView.jsx Multi-output monitor wall. Subscribes to output:multiview-captures. Routes NDI
│   │                         channels to NdiTile (checkerboard bg, green ring) vs ScreenMonitorTile. Refcounted.
│   ├── panels/
│   │   ├── RundownPanel.jsx       Inline service rename + delete UI (no native confirm dialogs).
│   │   │                          DnD-sortable item list. Context menu with Preview/Edit/Set Background Override.
│   │   │                          Background picker writes through to song's default_background_id.
│   │   │                          Media items: LOOP badge + Enable/Disable Loop (services.setItemLoop).
│   │   │                          Props: onRenameService, onDeleteService.
│   │   ├── PreviewLivePanel.jsx   Two MonitorFrames (1920×1080 canvas, CSS-scaled via ResizeObserver) + two
│   │   │                          SlideLists. Renders slides from payload (no screen-capture). Foreground media
│   │   │                          uses SyncedVideo locked to the shared transport (output:media-transport).
│   │   │                          Transport bar: timeline scrubber (media.seek), time readout, program-audio
│   │   │                          mute (media.setMuted), play/pause + restart (media.control). Template-aware:
│   │   │                          fullscreen / lower-third / stage. StageMonitor renders the confidence-monitor
│   │   │                          layout in the live monitor when the selected channel template is 'stage'.
│   │   │                          Channel selector strip when 2+ channels active.
│   │   └── LibraryPanel.jsx       Virtualised song list + media grid. Search + tag filter (folders = tags).
│   │                              Import dropdown: "Import from File…" (songs.importParse) / "Import GHS Hymnal"
│   │                              (songs.importGhs) → SongImportModal. GHS folder = "GHS" tag: orders by hymn
│   │                              number + numeric quick-search. Single-click → preview modal (220ms). Double-click
│   │                              → add to rundown. Accepts refreshTick + focusSearchRef props.
│   ├── components/
│   │   ├── SongEditor.jsx         Full song CRUD modal. 2-row FormattingToolbar (row 2: text box Fill +
│   │   │                          object-align + X/Y/W/H for fullscreen, bar controls for lower-third). SlidePreview (fullscreen) and
│   │   │                          LowerThirdPreview rendered at 1920×1080, CSS-scaled. Background picker in
│   │   │                          SlidePreview. ltBar style prop (null=transparent). Paste Song parser.
│   │   │                          Exports renderWithRuns() used by PreviewLivePanel. Escape key closes.
│   │   ├── SongPreviewModal.jsx   Read-only song preview. Add to Rundown / Edit actions.
│   │   ├── SongImportModal.jsx    Import preview/confirm. Editable title (uncontrolled), format badge, section
│   │   │                          count; duplicates flagged + unselected. Commit → songs.importCommit (with tags).
│   │   ├── MediaPickerModal.jsx   Media grid picker. Used for background override in RundownPanel.
│   │   ├── SlideList.jsx          Scrollable section list. preview and live variants. Content capped max-h-24.
│   │   └── ContextMenu.jsx        Generic right-click menu positioned by x/y coords. Escape key closes.
│   ├── settings/
│   │   ├── OutputChannels.jsx     Channel cards. Create/edit/delete. Monitor assignment per channel.
│   │   │                          NDI cards: audio mute toggle (ndi_audio_muted).
│   │   ├── LogoSettings.jsx       Global logo picker.
│   │   ├── BackgroundSettings.jsx Global song/slide background pickers. Bulk apply. Accepts only activeServiceId prop.
│   │   ├── DangerZone.jsx         Destructive actions: clear rundown, delete rundown, clear library.
│   │   │                          Two-step confirm. Uses existing removeItem IPC in a loop (no new IPC needed).
│   │   └── ShortcutSettings.jsx   Configurable transport shortcuts. Modifier selector + key inputs for
│   │                              GO / Clear / Logo / Live Toggle. Saves to settings DB via settings:set.
│   └── utils/
│       └── mediaUrl.js            mediaUrl(absPath) — see Media section above.
├── output/                   Plain HTML. No build step. Loaded directly by BrowserWindow.
│   ├── media-player.js       Shared classic script (loaded before fullscreen.js/stage.js).
│   │                         window.CueMediaPlayer.attach(el, {loop, baseMuted, transport}) — locks one
│   │                         <video>/<audio> to the transport: wall-clock position, playbackRate sync,
│   │                         native loop, el.muted = baseMuted || transport.muted.
│   ├── fullscreen.html       #background + #content (#text-wrap > #text, #logo-wrap sibling, #copyright).
│   │   / .css / .js          applyStyle positions #text-wrap via textBox %; supports all style_json props.
│   │                         showLogo/hideLogo use #logo-wrap (separate from text, never overwrites it).
│   │                         Foreground media via CueMediaPlayer. ?alpha=1 NDI transparency; ?mute=1 base mute.
│   ├── lowerthird.html       #lowerthird (background: transparent by default, JS sets from ltBar).
│   │   / .css / .js          buildBarBg(ltBar): null→transparent; {color,opacity,solid}→gradient or solid.
│   │                         Clear/logo events reset bar to transparent.
│   └── stage.html            Confidence monitor. #top-bar (clock / REMAINING timer / VIDEO countdown),
│       / .css / .js          #content (#media-wrap muted video + text), #bottom-bar (message). Video via
│                             CueMediaPlayer (always muted). VIDEO countdown loops with the clip (never ∞),
│                             freezes on pause. Receives slide:update + stage:timer + stage:message.
└── fonts/
    └── fonts.css + *.woff2   6 families (Inter, Montserrat, Lato, Oswald, Playfair Display, EB Garamond)
```

---

## Database

**Engine**: `better-sqlite3` (synchronous — no Promises).
**Location**: macOS `~/Library/Application Support/Cue/cue.db`, Windows `%APPDATA%\Cue\cue.db`
**Current schema version**: 9

**Media files** are copied to `userData/media/<uuid>.<ext>` on import. Original paths not retained.

Recent migrations: v6 `'stage'` template, v7 scripture (`bible_versions`/`bible_verses` + `'scripture'` item_type), v8 `service_items.media_loop`, v9 `output_channels.ndi_audio_muted`. Migrations run with FK off (table-rebuild migrations don't cascade-delete).

### Key tables (abbreviated)

| Table | Key columns |
|---|---|
| `songs` | `id, title, author, copyright, default_background_id` |
| `song_sections` | `id, song_id, type, order_index, content, style_json` |
| `songs_fts` | FTS5 virtual — mirrors title/author/content via triggers |
| `tags` | `id, name, colour` |
| `taggables` | `tag_id, entity_type, entity_id` (polymorphic pivot) |
| `services` | `id, title, date, notes` |
| `service_items` | `id, service_id, item_type('song'/'media'/'slide'/'scripture'), ref_id, order_index, notes, content, background_override_id, media_loop` |
| `media_assets` | `id, filename, path, type, folder_id` |
| `media_folders` | `id, name, parent_id` |
| `bible_versions` / `bible_verses` | scripture module (v7); `bible_verses_fts` FTS5 |
| `output_channels` | `id, name, type, template('fullscreen'/'lowerthird'/'stage'), ndi_fps, ndi_width, ndi_height, ndi_audio_muted, active` |
| `channel_monitors` | `id, channel_id, display_bounds, label, active` — physical screen per channel (v4) |
| `settings` | `key, value` (JSON-encoded values) |
| `db_version` | `version` (integer, currently 9) |

### Settings keys in use

| Key | Type | Description |
|---|---|---|
| `global_logo_id` | number\|null | Global logo media asset ID |
| `global_bg_song_id` | number\|null | Global default background for songs |
| `global_bg_scripture_id` | number\|null | Global default background for scripture |
| `global_bg_slide_id` | number\|null | Global default background for slides |
| `scripture_style_json` | object\|null | Global style_json applied to every scripture verse (edited in ScriptureEditor); `null` = template defaults |
| `scripture_ref_style_json` | object\|null | Global style_json for the scripture reference line ("John 1:1 (KJV)"); `null` = default right-aligned attribution. Optional `pos:{x,y}` (percent) free-positions it (drag or X/Y in the editor); absent = bottom band |
| `operator_preview_layout` | string | Reserved — not yet wired in UI |
| `keyboard_modifier` | 'meta'\|'ctrl'\|'alt' | Modifier for transport shortcuts (default: 'meta' macOS / 'ctrl' Windows) |
| `keyboard_go` | string | Key char for GO (default: 'g') |
| `keyboard_clear` | string | Key char for Clear (default: 'c') |
| `keyboard_logo` | string | Key char for Logo (default: 'l') |
| `keyboard_live` | string | Key char for Live Toggle (default: 'o') |
| `ghs_seeded` | boolean | Set true after the bundled GHS hymnal seeds on first run; gates re-seeding so deletions stick |

**localStorage** (UI-only, not in DB):
| Key | Description |
|---|---|
| `layout_h_pct` | Horizontal split % (default 25) |
| `layout_v_pct` | Vertical split % (default 62) |

### `style_json` — section styling format

```json
{
  "align": "center",      "bold": false,        "italic": false,
  "underline": false,     "uppercase": false,   "fontFamily": null,
  "fontSize": null,       "color": null,        "lineSpacing": null,
  "letterSpacing": null,  "verticalAlign": null, "textShadow": null,
  "textStroke": null,     "textBox": null,      "ltBar": null,
  "runs": []
}
```
`null` means "use template defaults." `fontFamily` must match a family in `fonts.css`. `textBox`/`verticalAlign` apply to fullscreen only. `ltBar` applies to lower-third only (`null` = transparent bar). FTS5 indexes `content` only.

**Positioning model (editor previews, `SlidePreview`)**: a fixed `CONTENT_BOX = {x:5,y:5,w:90,h:90}` "content window" (safe-area guide) sits over the background. `style.textBox{x,y,w,h}` is the actual text box — **draggable + resizable** (8 PowerPoint-style handles, counter-scaled to stay constant visual size; `resizeBox()` keeps the opposite edge fixed) and can be moved anywhere on screen. **Two alignments**: *text align* = text within the box (`align` horizontal + `verticalAlign` top/middle/bottom); *object align* = snaps the box within the content window (`objAlign('h'|'v', …)`, keeps box size). Output already honours `textBox.h` + `verticalAlign`, so these are editor-only — no template changes. The reference is draggable too (converts bottom-anchor → `pos{x,y}` via bounding-rect measurement so there's no jump).

### Background resolution order

Songs:
1. `service_items.background_override_id` — per-slot override
2. `songs.default_background_id` — per-song default
3. `settings.global_bg_song_id` / `global_bg_slide_id` — global type default
4. `null` → black screen

Scripture (no per-entity record, so the global default stands in for the per-song layer):
1. `service_items.background_override_id` — per-slot override (rundown items only)
2. `settings.global_bg_scripture_id` — global scripture default
3. `null` → black screen

Scripture style + background resolution is applied in the **renderer** (`OperatorView`): `loadScriptureDefaults()` reads `scripture_style_json` + `global_bg_scripture_id` (refreshed on `bgRefreshTick` and after the ScriptureEditor saves via `onScriptureStyleSaved`). `getSlides()` injects the style into scripture slides; `resolveBackground()` falls back to the scripture default. Both the rundown path (`buildPayload`) and the live-from-tab path (`handleScriptureLive`) flow through these.

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
- `songs:importParse(filePaths)` → preview rows `[{ok, file, format, title, author, copyright, sections, tags?, error?}]` (no DB write). Auto-detects OpenLyrics XML / ChordPro / text / EasyWorship SQLite (one .db → many rows).
- `songs:importGhs()` → preview rows for the bundled GHS hymnal (`format:'GHS'`, `tags:['GHS']`, `existing` flag)
- `songs:importCommit(parsedSongs)` → `{count, ids}` — bulk insert; each row's `tags[]` (names) get-or-created and assigned

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
- `services:setItemLoop(itemId, loop)` — toggles `service_items.media_loop`
- `services:duplicateItem(itemId)` → new `id`
- `services:clearItems(serviceId)` — removes all items, keeps the service row
- `services:applyBackgroundToRundown(serviceId, mediaId)` — sets override + writes to each song's default

### Output
- `output:go(payload)` / `output:clear()` / `output:logo()`
- `output:setLive(enabled)` — opens or closes all output BrowserWindows
- `output:getState()` → `{isLive, livePayload, activeWindows, outputsEnabled, displayMode, transport}`
- `output:media:control(action)` — `'play'|'pause'|'restart'` (mutates transport, broadcast to all surfaces)
- `output:media:seek(pos)` — scrub foreground media to `pos` seconds (preserves paused state)
- `output:media:set-muted(muted)` — program (audience) audio mute; stage + operator preview stay silent
- `output:stage:message(text)` / `output:stage:timer(action, seconds?)` — confidence-monitor message + presenter countdown (`'set'|'start'|'pause'|'reset'`)
- `output:channels:list()` / `:create(data)` / `:update(id, data)` / `:delete(id)` — `data.ndi_audio_muted` (default 1)
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
- `settings:setGlobalLogo(mediaId|null)` / `settings:setGlobalBackground(type, mediaId|null)` — `type`: `'song'|'scripture'|'slide'`
- `settings:applyBackgroundToAll(type, mediaId)` — bulk update, UI must confirm
- `settings:getDiskUsage()` / `settings:getDataPath()` / `settings:openDataFolder()`

### Scripture (Bible) — `window.cue.bible.*`
- `bible:versions:list()` → `[{id, name, abbrev, language, verse_count}]`
- `bible:books(versionId)` → `[{book_num, book_name}]` (canonical order)
- `bible:chapters(versionId, bookNum)` → `[chapterNum, …]`
- `bible:verses(versionId, bookNum, chapter)` → `{bookNum, bookName, chapter, verses:[{chapter, verse, text}]}`
- `bible:adjacent(versionId, bookNum, chapter, verse, dir)` → next/prev verse in canonical order (`dir` 1|-1), rolls across chapter/book boundaries; `null` at the ends. Powers ↑/↓ live navigation.
- `bible:resolve(versionId, ref, versesPerSlide?)` → self-contained passage payload (used for Add-to-Rundown scripture items)
- `bible:search(versionId, query)` → FTS5 verse search
- `bible:importFile(filePath, meta)` / `bible:delete(id)` — import / remove a translation. `bible-import.js` accepts 4 shapes: thiagobodruk book-array JSON, flat verse-list JSON (`[{book,chapter,verse,text}]` / `{verses:[…]}`), nested object JSON (`{Book:{chapter:{verse:"text"}}}` — the `meaningless`/BibleGateway shape, "Info" key ignored), and Zefania XML.
- `bible:online:list()` → `{ok, versions:[{abbrev, name, language, license, restricted, installed}]}` — getbible.net v2 catalog (117 versions), main-process `fetch`
- `bible:online:download(abbrev)` → `{ok, id, name, count}` | `{ok, already:true}` | `{ok:false, error}` — fetch + normalize + import one version

**Importing translations**: the Import button (Scriptures tab rail + Settings → Bible Translations) opens a two-option menu — **Import from File** (the existing JSON / Zefania XML picker) or **Import from Online** (`OnlineBibleModal`). The online modal lists the getbible.net v2 catalog with per-version licence + install state, multi-select, and downloads + imports the chosen versions into the DB (persists like any import). A licence warning is shown but no version is blocked — responsibility rests with the operator (copyrighted versions require a licence). Network + parsing happen in the main process (`listOnlineVersions` / `downloadOnlineVersion` in `db/bible.js`, `fetch` + `AbortSignal.timeout`).

**Bundled translations**: KJV + WEB (both public domain) ship as normalized seed JSON in `resources/bible/` (built by `scripts/build-bibles.mjs` from getbible.net v2). `seedBundledBibles()` imports any missing bundled version on startup (matched by abbrev). `forge.config.js` `extraResource` copies `resources/bible` into the packaged app; resolved at `process.resourcesPath/bible` (packaged) or `app.getAppPath()/resources/bible` (dev). ESV is NOT bundled — copyrighted, not freely redistributable.

### Song Import (`src/main/import/songs-import.js` + `SongImportModal.jsx`)

Two-phase: `songs:importParse` parses (no write) → `SongImportModal` preview/confirm → `songs:importCommit` bulk-inserts. Songs-tab **Import** dropdown = "Import from File…" / "Import GHS Hymnal". Auto-detected formats: **OpenLyrics XML** (regex, no XML dep), **ChordPro** ({directives} + `[chord]` stripping), **plain text** (filename → title, run through `parseSections`), **EasyWorship** (picked `Songs.db`/`SongWords.db`; SQLite read via `better-sqlite3`; lyrics are RTF in `SongWords.word.words`, joined on `song.rowid`, converted by `rtfToText`; plain `SELECT` + JS sort — its `UTF8_U_CI` collation isn't registered; one `.db` → many rows). `importSongs` is tag-aware (`song.tags[]` names get-or-created + assigned); `existingTitleSet()` flags duplicates.

**GHS hymnal (bundled)**: `resources/ghs/ghs-hymnal.json` (260 hymns; built by `scripts/build-ghs.mjs` from a cp1252 number→name CSV + lyric files; shipped via `extraResource: ['./resources/ghs']`). `seedGhsHymnal()` imports once on startup (gated by `ghs_seeded`) and always runs `tagGhsSongs()` — idempotent backfill of the `GHS` tag onto every `GHS N …` song. In `LibraryPanel` the `GHS` tag is the GHS folder: selecting it sorts by hymn number and swaps the text search for a numeric quick-search (type a number → that hymn first; S key focuses it; Enter previews the exact match).

**Scriptures tab (live verse browser)** — `ScripturePanel.jsx`, an EasyWorship-style live source independent of the rundown. Predictive reference bar (Book autocompletes → Tab → Chapter → Tab → Verse; Enter sends live). The verse list shows the whole loaded chapter; single-click selects (preview only, no live), double-click / Enter sends live, and with the list focused ↑/↓ move the selection AND send it live. Going live calls `OperatorView.handleScriptureLive` → `output.go` + a synthetic `liveScripture` item (clears any live rundown item; rundown GO clears `liveScripture`). The panel drops its LIVE marker via `output:state-changed` when the output is cleared or replaced. Verse rows have a **right-click context menu** (Send Live / Add Verse to Rundown / Add Chapter to Rundown) in addition to the reference-bar Add button. The **Appearance** button opens `ScriptureEditor` (`components/ScriptureEditor.jsx`) — the styling counterpart to `SongEditor`, reusing its exported `FormattingToolbar` / `SlidePreview` / `LowerThirdPreview` / `copyrightCss` / `DEFAULT_STYLE` / `styleIsDefault`. A **Verse Text / Reference** target toggle switches what the toolbar edits: the verse style (`scripture_style_json`) or the reference-line style (`scripture_ref_style_json`, edited with `simple` toolbar mode — no text-box/v-align/bar, but adds a Pos Bottom/Free + X/Y control). **Positioning**: the verse text box and the reference are **draggable** in the editor preview (`SlidePreview` `onTextBoxChange`/`onRefPosChange`; pointer delta ÷ scale → percent), with numeric inputs as the precise alternative — verse via `textBox{x,y,w,h}`, reference via `pos{x,y}` (free) or bottom-anchored when `pos` is absent. Plus the default scripture background (`global_bg_scripture_id`). All three apply to every verse — no per-section editing since the text is fixed. The reference style threads through as the payload `copyrightStyle` (applied by `applyCopyrightStyle` in fullscreen/lowerthird templates and `copyrightCss` in the operator monitors via `slide._refStyle`). The **confidence monitor** (`stage.html` `#current-ref`) shows the reference (`Book c:v (VERSION)`) above the verse in its own legible styling — not the custom output style.

### Dialog
- `dialog:openFile(options)` → `{canceled, filePaths}`

### Fonts (synchronous, no IPC)
- `window.cue.fonts.list` — `[{family, label, category}]`
- `window.cue.fonts.default` — `'Inter'`

### Renderer events (`window.cue.on(channel, cb)` → unsubscribe function)
`on()` returns an unsubscribe function. Always store it and call it in `useEffect` cleanup to prevent listener leaks.
- `output:unresolved-channels` — unresolved channel objects on startup (App.jsx does NOT auto-navigate to Settings)
- `output:state-changed` — after go/clear/logo/setLive; payload: `{activeWindows, outputsEnabled, displayMode, livePayload, transport}`.
- `output:media-transport` — after any transport change (go/play/pause/restart/seek/setMuted); payload `{active, startAt, pausedAt, loop, muted}`. The operator UI follows this for SyncedVideo + the transport bar. NOTE: there is **no** `output:media-time` event — the old clock-master time-reporting chain was removed.
- `output:multiview-captures` — `[{channelId, dataUrl, isNdi}]` array at ~5fps (only while MultiviewView is mounted). `isNdi: true` → sourced from ndiLastFrames JPEG cache (~1fps); `isNdi: false` → capturePage (~5fps). NOTE: there is no `output:live-capture` event — the operator live monitor renders from payload, never from a capture loop.
- `output:ndi-unavailable` — grandiose not installed
- `shortcut:next` / `shortcut:prev` — reserved for hardware remote

---

## Output Payload Structure

```js
{
  type: 'content' | 'clear' | 'logo',
  text: string | null,
  sectionLabel: string | null,
  copyright: string | null,        // scripture reference is "Book c:v (VERSION)"; songs use their copyright line
  copyrightAlign: 'right' | undefined, // 'right' for scripture (bottom-right); songs/default centred
  copyrightStyle: object | undefined,  // scripture reference style_json (font/size/colour/align + optional pos:{x,y}); applied to #copyright
  backgroundPath: string | null,   // absolute filesystem path — output template encodes to cue-media://
  logoPath: string | null,
  styleJson: object | null,        // parsed style_json from song_sections
  media: { path, type:'video'|'audio'|'image', loop } | undefined,  // foreground media item
  transport: { active, startAt, pausedAt, loop, muted } | undefined, // transport snapshot for media
}
```

Output windows receive this via `webContents.send('slide:update', payload)`.

### Media transport (foreground video/audio sync)

Foreground media (bumpers/clips) is kept in sync across **all** surfaces (screen outputs, NDI, operator live monitor, confidence monitor) by a single main-process `transport = { active, startAt, pausedAt, loop, muted }` (machine-clock based). `position(now) = ((pausedAt ?? now) - startAt)/1000` (mod duration when loop). Every player (`media-player.js`, stage video, `SyncedVideo`) derives its playhead from the shared clock and converges via `playbackRate` nudging (hard-seek only on >0.5s drift / scrub / pause). **Do NOT** reintroduce per-window `currentTime` reporting / a clock-master, and **do NOT** use a dual-element loop swap — use the native `loop` attribute (clean gapless audio). **Program audio comes from one window only** (`isPrimaryAudioMonitor` → `?mute=` query param); stage is always muted; `media.setMuted` layers a live program mute as `el.muted = baseMuted || transport.muted`.

---

## Output Channels

**Channels vs Monitors**: a channel is a content stream (one template, one set of settings). A monitor is a physical screen assignment (`channel_monitors` row). One channel can drive multiple monitors simultaneously.

**Screen channels**: each `channel_monitors` row opens a `BrowserWindow` with `fullscreen: true, frame: false, alwaysOnTop: true`. Display matched by `display_bounds` JSON, never `display_index`. If bounds don't match a connected display → flagged unresolved → `output:unresolved-channels` IPC fired; operator navigates to Settings manually.

**NDI channels**: hidden `show: false`, `offscreen: true` BrowserWindow. Loaded with `?alpha=1` so the template overrides its CSS background to transparent, and `?mute=<ndi_audio_muted>` for per-channel audio. `ndi.js` uses `grandi` to publish BGRA frames at the configured fps. Frame capture uses the `paint` event driven by `setInterval(invalidate, frameMs)` — do NOT use `capturePage()` on NDI windows (4s+ latency due to async GPU readback and offscreen compositor throttling). An `inflight` per-sender flag drops frames when the NDI SDK is busy to prevent memory exhaustion. `startNdiCapture` **always runs** after `did-finish-load` — `startPainting()` must be called regardless of SDK availability so `ndiLastFrames` populates for multiview. Only `ndi.sendFrame()` is gated on `ndi.isAvailable()`.

**Audio routing**: program (audience) audio is emitted by **one window only** — the primary screen output (`isPrimaryAudioMonitor`, `?mute=0`); all other screen outputs and the stage monitor load with `?mute=1`. NDI audio is independent (per-channel `ndi_audio_muted`). The live program mute (`output:media:set-muted`) layers on top: `el.muted = baseMuted || transport.muted`. Confidence monitor and operator preview are always silent.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Space | Advance LIVE forward. Next live slide → rolls into next rundown item at the boundary (also loads it into preview). If nothing live, GOes the current preview. |
| ↓ | Next preview slide. Auto-GOes when preview item === live item. At last slide → next rundown item. |
| ↑ | Previous preview slide. Auto-GOes when preview item === live item. At first slide → prev rundown item at its last slide. |
| G | GO — send preview item at current slide to live |
| Escape | Clear all outputs |
| L | Logo all outputs |
| S | Focus song search bar (the GHS number field when the GHS folder is active) |
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
| ↓ / ↑ | `previewSlideIdx` only (auto-GOes when preview item === live item). |
| Space | Advances LIVE forward (rolls into next rundown item at the boundary). |
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
