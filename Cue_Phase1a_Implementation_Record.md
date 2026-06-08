# Cue Graphics Engine
## Phase 1a — Implementation Record & Technical Addendum
### v1.5 — Post-build documentation. Supplements the original Phase 1a Technical Specification v2.0. Updated 2026-06-08: corrected M8 status; documented NDI gap; revised preview/live operator workflow (§4.5); added style_json storage design (§4.6); bundled font library (§4.7); song editor styling controls + Paste Song regex parser (§4.8).

---

## 1. Purpose of this document

The original specification (`Cue_Phase1a_TechnicalSpec.docx`, v2.0) defined the intended architecture and scope. This document records what was actually built during Phase 1a development: where the implementation matches the spec, where deliberate decisions were made to deviate, what was added beyond scope, and what is confirmed working. It is the authoritative record for starting Phase 1b.

---

## 2. Phase 1a milestone status

| Milestone | Spec deliverable | Status | Notes |
|-----------|-----------------|--------|-------|
| M1 — Shell | Electron + React + Vite + Forge scaffold | ✅ Complete | Electron 30.0.9, React 18.3, Vite 5.3 |
| M2 — Database | All tables, migrations, FTS5, `songs:search` via IPC | ✅ Complete | All tables implemented, FTS5 with triggers working |
| M3 — Song editor | CRUD + sections + tags + library panel | ✅ Complete | react-window virtualised list included from M3 as specified |
| M4 — Single output | BrowserWindow output, fullscreen template, Go/Clear/Logo | ✅ Complete | Both `fullscreen` and `lowerthird` templates built |
| M5 — Multi-screen | Channel manager, bounds matching, unresolved detection | ✅ Complete | Settings auto-open on unresolved channels working |
| M6 — Service rundown | CRUD, drag-to-reorder, preview/live, slide nav, shortcuts | ✅ Complete | **Keyboard shortcuts deviate from spec — see §4.1** |
| M7 — Media + backgrounds | Import, folder tree, tags, background resolution | ✅ Complete | Background resolution order (item > song > global > black) verified |
| M8 — NDI output | grandiose integration, configurable FPS/res, absence detection | ⚠️ Partial | NDI BrowserWindow + absence detection done. grandiose publish **not implemented** — see §4.4 |
| M9 — Settings screen | Full settings UI, disk usage, data path, layout toggle | ✅ Complete | All IPC channels wired |

**Phase 1a is fully implemented.**

---

## 3. Exact dependency versions (pinned)

| Package | Version | Notes |
|---------|---------|-------|
| `electron` | **30.0.9** | Pinned. Do not bump without rebuilding native addons. |
| `better-sqlite3` | 11.1.2 | Sync SQLite. Rebuild with `npm run rebuild` on Electron bump. |
| `react` / `react-dom` | 18.3.1 | — |
| `vite` | 5.3.1 | — |
| `@electron-forge/cli` | 7.4.0 | Packaging toolchain |
| `@dnd-kit/core` | 6.1.0 | Drag-to-reorder in rundown and song editor |
| `@dnd-kit/sortable` | 8.0.0 | — |
| `react-window` | 1.8.10 | Virtualised song list in library |
| `tailwindcss` | 3.4.4 | Operator UI styling |
| `grandiose` | **not installed** | NDI output — arm64 native on Apple Silicon. NOT in `package.json`. Must be added (`npm install grandiose`) and rebuilt (`npm run rebuild`) when NDI publish is implemented in Phase 1b. |

---

## 4. Deliberate deviations from specification

### 4.1 Keyboard shortcuts — renderer-side, not `globalShortcut`

**Spec said:** Keyboard shortcuts (Space, Up, Down, Escape, G, L) should be registered as `globalShortcuts` in the main process so they work regardless of UI focus.

**What was built:** Shortcuts are registered as a `keydown` listener on `document` in the renderer (`OperatorView.jsx`), not as Electron `globalShortcut`.

**Why:** `globalShortcut` in Electron intercepts keypresses at the OS level — before they reach any window. This made it impossible to type the letters G, L, or a space in any input field (search bar, song editor, notes fields) while the app was running. They also hijacked those keys in other applications system-wide. This was a fundamental usability failure.

**How the renderer approach works:**
- A single `keydown` listener is attached to `document` on mount in `OperatorView`
- It checks `document.activeElement` — if it is an `INPUT`, `TEXTAREA`, or `contenteditable`, the shortcut is suppressed
- A `useRef` holds the current handler functions so the listener never becomes stale (avoids the `previewSlideIdx = 0` bug that affected the original IPC-based approach)
- Shortcuts only fire when the Cue window has focus — keys work normally in other applications

**Implications for Phase 1b:** Any Phase 1b keyboard shortcuts should follow this same pattern. The `globalShortcut` module should not be used unless there is a specific reason to capture keys when the app does not have focus (e.g. a physical presentation remote that sends keystrokes to the OS).

```js
// src/renderer/views/OperatorView.jsx — shortcut pattern
const shortcutRef = useRef({});
shortcutRef.current = { handleNextSlide, handlePrevSlide, handleGo, handleClear, handleLogo };

useEffect(() => {
  function onKeyDown(e) {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    const h = shortcutRef.current;
    if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); h.handleNextSlide(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); h.handlePrevSlide(); }
    else if (e.key === 'Escape') h.handleClear();
    else if (e.key === 'g' || e.key === 'G') h.handleGo();
    else if (e.key === 'l' || e.key === 'L') h.handleLogo();
  }
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}, []);
```

### 4.2 Resizable panel layout

**Spec said:** Top half split into two equal columns; bottom half fixed at ~40% height.

**What was built:** All three panel boundaries are user-resizable via drag handles:
- **Horizontal** (Rundown width vs Preview/Live width) — default 42% / 58%
- **Vertical** (top panels height vs Library height) — default 58% / 42%
- **Internal** (monitor area vs slide list within Preview/Live) — default 270px, drag to resize

Resize state is held in `OperatorView.jsx` as percentage values. The drag handles are 3px-wide elements with `cursor: col-resize` / `cursor: row-resize`. Minimum/maximum clamping prevents panels from collapsing entirely.

Resize state is **not yet persisted** to settings — this is a Phase 1b item (add `settings:set('operator_panel_splits', …)` on drag end).

### 4.3 `output-preload.js` — separate preload for output windows

Not mentioned in the original spec. Output BrowserWindows (fullscreen and lower-third) use a separate preload script (`src/main/output-preload.js`) that exposes only the `slide:update` IPC channel to output windows. This keeps the output window API surface minimal and enforces separation.

### 4.4 M8 NDI — infrastructure only, grandiose publish not implemented

**Spec said:** Full grandiose NDI integration — `capturePage()` loop, NDI publish at configurable FPS/resolution, `linked_channel_id` working, OBS verified.

**What was built:**
- NDI channel type creates a hidden off-screen BrowserWindow (configurable `ndi_width`/`ndi_height`, default 1920×1080). The window loads the same output templates as screen channels.
- `src/main/output/ndi.js` is an 18-line module that attempts `require('grandiose')` inside a try/catch. If grandiose is absent, `isAvailable()` returns `false`. This is the sole NDI code.
- On startup, `index.js` calls `ndiAvailable()` and emits `output:ndi-unavailable` to the renderer if it returns `false`. `App.jsx` shows an amber warning badge in the nav bar.
- `grandiose` is **not in `package.json`** and not installed in `node_modules`.
- There is no frame capture loop, no grandiose `send()` call, and `linked_channel_id` has no consuming logic (the field exists in the schema and can be set via IPC update, but nothing reads it).

**What works:** NDI channel config persists, the hidden BrowserWindow opens and receives `slide:update` payloads, and the absence warning fires correctly.

**What does not work:** No frames are ever published to the NDI network. NDI output is non-functional.

**Note on live-capture in `manager.js`:** `startLiveCapture()` captures the first output window at 200ms intervals and sends frames to the operator UI via `output:live-capture`. This is the **operator UI preview thumbnail** — it is not NDI and has nothing to do with grandiose. It runs whenever `output:go` is called and stops on `output:clear`.

**Phase 1b requirement:** Add `grandiose` to `package.json`, rebuild, implement the capture loop in `ndi.js` (`capturePage()` → `grandiose.send()`), and wire `linked_channel_id` logic.

### 4.5 Preview/Live operator workflow — revised mechanics

**Spec said (M6):** Single-click rundown item = preview; double-click = live. The slide list below the monitors navigated the live output.

**What was revised (post-Phase 1a):** The preview and live slots are now fully decoupled. This change was made because the original mechanics caused unintended live output when operators were pre-checking song content. The revised design matches a professional broadcast workflow where a separate cue/preview bus exists alongside the program (live) bus.

#### Revised interaction model

| Action | Result |
|---|---|
| Single-click rundown item | Loads into preview, resets `previewSlideIdx` to 0. **No live change.** |
| Double-click rundown item | Loads into preview and sends slide 0 to live immediately (fast-trigger shortcut). |
| Single-click in **Preview Slides** list | Updates `previewSlideIdx` only. Preview monitor updates. **No live change.** |
| Double-click in **Preview Slides** list | Sends that slide to live (`handleGoAtPreviewSlide`). |
| Single-click in **Live Slides** list | Sends that slide to live immediately (`handleSelectLiveSlide`). |
| GO button / G key | Sends current preview item at `previewSlideIdx` to live. |
| Space / Down / Up arrow keys | Advance/retreat `previewSlideIdx` only. **No live change.** |
| Double-click song in library | Adds song to current rundown directly (bypasses preview modal). |

#### Dual slide lists

The bottom area of `PreviewLivePanel` now shows two side-by-side scrollable columns:
- **Preview Slides** (left) — clicking navigates preview cursor; double-clicking commits to live. Header hint: "dbl-click → live".
- **Live Slides** (right) — clicking directly advances the live output. Red dot and live-text-glow on header when a song is live.

Each list shows the **full multi-line lyric content** of every section (`whitespace-pre-line`), not just the first line. This lets operators read full verses before cueing.

#### `SlideList.jsx` changes

- `onDoubleClick` prop added (optional); used by preview list to commit to live.
- `slide.content` displayed in full with `whitespace-pre-line leading-relaxed` instead of `firstLine + truncate`.
- Font size changed to `text-[11px]` for readability at full lyric height.

#### State held in `OperatorView`

```
previewItemId    — which rundown item is in preview
previewSlideIdx  — which slide of that item is focused (preview monitor only)
liveItemId       — which rundown item is on output
liveSlideIdx     — which slide of the live item is on screen
```

`previewItemId` and `liveItemId` can be different songs simultaneously.

### 4.6 Section content storage — plain text + `style_json`

**Background:** All `song_sections.content` values are plain text with `\n` for line breaks. No rich text format is used. This is correct for FTS5 search and for the `<textarea>` in the song editor.

**Format choice rationale:**

| Option | Rejected reason |
|--------|----------------|
| HTML | Mixes content and presentation; degrades FTS5 search (indexes tags); requires sanitisation before rendering; XSS risk in output windows. |
| Markdown | `\n` semantics are ambiguous (soft vs hard wrap); custom rendering needed for font size, colour, alignment; harder to parse back to editable form. |
| Quill Delta / Slate / TipTap JSON | Embeds content inside JSON structure, requiring JSON parsing before FTS indexing; forces adoption of a specific editor library for the styling editor. |
| **Plain text + `style_json`** | ✅ Content and presentation are separate. FTS5 indexes `content` directly. Rendering uses `white-space: pre-wrap` everywhere. `style_json` is nullable and unused until the styling editor is built. |

**DB change (migration v2):**

```sql
ALTER TABLE song_sections ADD COLUMN style_json TEXT;
```

`style_json` is `NULL` for all existing rows. When the Phase 1b styling editor is built, it populates this column. The column is preserved through `songs:create` and `songs:update` IPC (passed through as `s.style_json ?? null`). `SongEditor.jsx` preserves any existing `style_json` on save.

**`style_json` schema (draft for Phase 1b):**

```json
{
  "align":       "center",
  "bold":        false,
  "italic":      false,
  "fontFamily":  null,
  "fontSize":    null,
  "color":       null,
  "lineSpacing": null,
  "runs":        []
}
```

`fontFamily` is a CSS font-family string (e.g. `"Helvetica Neue"`, `"Arial"`) or `null` for the output channel's default. `runs` is reserved for future per-character/word styling: `[{ from, to, bold, italic, color, fontFamily }]`.

**Rendering fix (same PR):** `MonitorFrame` in `PreviewLivePanel.jsx` now uses `whitespace-pre-wrap` on the slide text `<p>` element. Output templates (`fullscreen.css`, `lowerthird.css`) already had `white-space: pre-wrap`. `SlideList.jsx` uses `whitespace-pre-line`. Line breaks are now consistent everywhere.

### 4.7 Bundled font library

12 `.woff2` font files (~260KB total) ship inside `src/fonts/`. No system font installation needed on any host machine.

| Family | Category | Weights bundled |
|--------|----------|-----------------|
| Inter | sans-serif | 400, 700 |
| Montserrat | sans-serif | 400, 700 |
| Lato | sans-serif | 400, 700 |
| Oswald | sans-serif condensed | 400, 700 |
| Playfair Display | serif | 400, 700 |
| EB Garamond | serif | 400, 700 |

**Architecture:**
- `src/fonts/fonts.css` — all `@font-face` declarations. `font-display: block` prevents FOUT in output windows.
- `src/output/fullscreen.html` / `lowerthird.html` — `<link href="../fonts/fonts.css">` (plain HTML, not Vite-processed; relative path works in ASAR).
- `src/renderer/index.css` — `@import '../fonts/fonts.css'` (Vite bundles fonts alongside renderer assets).
- `src/main/fonts.js` — exports `BUNDLED_FONTS` array and `DEFAULT_FONT = 'Inter'`.
- `preload.js` — imports and exposes `window.cue.fonts.list` / `window.cue.fonts.default` as synchronous values (no IPC round-trip).

**Payload change:** `buildPayload` in `OperatorView` now includes `styleJson: JSON.parse(slide.style_json)` (or `null`). Output templates destructure `styleJson` from the payload and call `applyStyle(textEl, styleJson)` which sets `fontFamily`, `textAlign`, `fontWeight`, `fontStyle`, `fontSize`, `color`, `lineHeight` inline. `MonitorFrame` in `PreviewLivePanel` applies the same properties as inline React `style` so the operator preview matches the output.

**To add a font in future:** drop `.woff2` file into `src/fonts/`, add `@font-face` to `fonts.css`, add entry to `BUNDLED_FONTS` in `fonts.js`.

### 4.8 Song editor — per-section styling controls and Paste Song parser

Two capabilities added to `SongEditor.jsx` as part of the style_json implementation (§4.6):

#### Per-section styling toolbar

Every section row in the editor now has an inline toolbar between the type selector and the textarea:

| Control | Saves to `style_json` | Notes |
|---------|----------------------|-------|
| Font family dropdown | `fontFamily` | Populated from `window.cue.fonts.list` (§4.7). First option is "Default font" (null). |
| Font size dropdown | `fontSize` (number, px) | Options: 32 40 48 56 64 72 80 96 112 128 |
| Colour swatch | `color` (hex string) | Native OS colour picker behind a styled div. Defaults to `#ffffff` when unset. |
| Bold toggle | `bold` (boolean) | Highlights blue when active |
| Italic toggle | `italic` (boolean) | Highlights blue when active |
| Align left / centre / right | `align` ('left' \| 'center' \| 'right') | Default is centre. Highlights blue for active alignment. |
| Reset button | Clears all style props | Shown only when at least one non-default style is applied |

Styling is applied as a **live preview** in the textarea itself (font family only — size/weight/italic are not mirrored in the editor textarea to avoid jarring layout shifts). The operator sees the real rendering in the `MonitorFrame` preview monitors.

Style state is held as a parsed object `section.style = {}` in the editor's local React state — not as a JSON string. On save, `serializeStyle(style)` serialises to JSON only if at least one non-null, non-false value is present; otherwise `style_json` is saved as `null`.

#### Paste Song — regex-based section parser

A "↙ Paste Song" link in the section area header opens a full-height textarea. The operator pastes a complete song (copied from Genius, AZLyrics, CCLI SongSelect, or a plain text document). Clicking "Import Sections" runs `parseSong(rawText)` and replaces the current sections.

**`parseSong` detection rules (in priority order):**

1. `[Verse 1]`, `[CHORUS]`, `[Pre-Chorus]` — bracketed labels, optional trailing colon
2. `Verse 1:`, `Chorus:`, `BRIDGE:` — keyword + optional number + colon, nothing else on the line
3. `Verse 1`, `CHORUS`, `bridge` — standalone known keyword, with optional trailing number, nothing else

Known keywords: `verse`, `chorus`, `bridge`, `pre-chorus`/`pre chorus`/`prechorus`, `tag`, `intro`, `outro`, `refrain`. Each maps to the corresponding `SECTION_TYPES` value (`refrain` → `chorus`).

**Line cleaning:** Leading list numbers (`1.`, `2)`, `(1)`, `[1]`, `1:`) are stripped from content lines so they don't appear on screen.

**No-header fallback:** If no section headers are detected in the pasted text, the parser splits by blank lines and defaults every block to type `verse`. The operator can then relabel each section individually.

**Explicit design constraint:** No LLM or AI API fallback. The regex handles all common real-world copy-paste formats. This was a deliberate product decision — no network call, no dependency, no latency, offline-safe.

After import, the sections editor is shown pre-populated with the parsed sections for review and correction before saving.

---

## 5. IPC API — additions beyond specification

The following channels were added during implementation and are not in the original spec. They are exposed through `window.cue` in the renderer via `preload.js`.

### 5.1 Songs — additions

| Channel | Description |
|---------|-------------|
| `songs:listAll` | Returns all songs ordered by title (no search query). Used for the full library list on initial load and after CRUD operations. FTS5 search is used only when a query string is present. |

### 5.2 Services — additions

| Channel | Description |
|---------|-------------|
| `services:delete (id)` | Deletes a service and all its items (CASCADE). Not in spec but required for rundown management. |
| `services:duplicateItem (itemId)` | Duplicates a service item in-place. Used from the rundown context menu. |

### 5.3 Media — additions

| Channel | Description |
|---------|-------------|
| `media:getDiskUsage` | Returns total bytes used by `userData/media/`. Exposed separately from `settings:getDiskUsage` so media and settings concerns remain decoupled. |
| `media:getMediaDir` | Returns the absolute path to `userData/media/`. Used in Settings for the data path display. |
| `media:folders:rename (id, name)` | Renames a media folder. |
| `media:folders:delete (id)` | Deletes a folder (and moves its contents to root). |

### 5.4 Settings — additions

| Channel | Description |
|---------|-------------|
| `settings:getDataPath` | Returns the absolute `userData` path. Displayed in Settings. |
| `settings:openDataFolder` | Opens `userData` in Finder (macOS) or Explorer (Windows) via `shell.openPath`. |

### 5.5 Tags — full CRUD (not in spec)

The original spec described tags as existing but did not define IPC channels for managing them. The following were implemented:

| Channel | Description |
|---------|-------------|
| `tags:list` | Returns all tags with `id`, `name`, `colour`. |
| `tags:create (data)` | Creates a tag with name and hex colour. |
| `tags:update (id, data)` | Updates tag name or colour. |
| `tags:delete (id)` | Deletes tag and removes all `taggables` entries. |

### 5.6 Output — additions

| Channel | Description |
|---------|-------------|
| `output:getState` | Returns `{ isLive: bool, livePayload: object|null, activeChannels: number[] }`. Replaces the spec's `output:preview:get` — returns live state only, not a separate preview payload. Called by `PreviewLivePanel` on mount to restore state after navigation. |

### 5.7 Dialog

| Channel | Description |
|---------|-------------|
| `dialog:openFile (options)` | Exposes `dialog.showOpenDialog`. Used by media import and background pickers. Implemented in `index.js` (not a dedicated IPC file) as it is a one-liner bridge. |

---

## 6. Settings keys — additions

The original spec defined four keys. Additional keys used in the implementation:

| Key | Type | Description |
|-----|------|-------------|
| `global_logo_id` | `number \| null` | (as specified) |
| `global_bg_song_id` | `number \| null` | (as specified) |
| `global_bg_slide_id` | `number \| null` | (as specified) |
| `operator_preview_layout` | `'stacked' \| 'sidebyside'` | (as specified) |

---

## 7. Operator UI — design system

The UI uses a broadcast-grade OLED dark design system. This is documented here so it is maintained consistently in Phase 1b components.

### 7.1 Color palette (Tailwind overrides in `tailwind.config.js`)

The Tailwind `slate` palette is overridden with broadcast charcoal values (blue-grey undertone, no warm tint). The `indigo` palette is overridden to professional steel blue (not the default SaaS purple-indigo).

| Token | Value | Usage |
|-------|-------|-------|
| `slate-950` | `#030408` | App background |
| `slate-900` | `#080A12` | Panel background |
| `slate-800` | `#10121C` | Panel chrome, headers |
| `slate-700` | `#1A1D28` | Inputs, controls |
| `slate-600` | `#272B3A` | Hover states |
| `slate-500` | `#3E4354` | Dim text, disabled |
| `slate-400` | `#5E657A` | Secondary text |
| `slate-300` | `#8890A4` | Tertiary text |
| `slate-200` | `#B4BAC9` | — |
| `slate-100` | `#D8DCE8` | Primary text |
| `indigo-600` | `#1550A8` | Active tabs, accent buttons, focus rings |
| `indigo-500` | `#1E5DBE` | Hover state of accent elements |

### 7.2 Signal / tally colors

These are semantic — used exclusively for output state indication. Do not repurpose them for decorative use.

| State | Color | Token |
|-------|-------|-------|
| LIVE / On-air | `#EF4444` | `live` (custom token) |
| PREVIEW / Standby | `#F59E0B` | `preview` (custom token) |
| GO / Execute | `#22C55E` (CSS only) | — |
| Accent / Interactive | `#1550A8` | `indigo-600` |

### 7.3 CSS utility classes (`src/renderer/index.css`)

| Class | Applied to | Effect |
|-------|-----------|--------|
| `.panel-header` | Panel chrome header bars | `linear-gradient` bg + dual 1px border (bevel feel), `height: 30px` |
| `.panel-label` | Text labels inside panel headers | 10px, `font-weight: 700`, `letter-spacing: 0.18em`, uppercase |
| `.tally-live` | Rundown item rows | Red left border + 7% red background tint |
| `.tally-preview` | Rundown item rows | Amber left border + 7% amber background tint |
| `.tally-idle` | Rundown item rows | Transparent left border |
| `.monitor-live` | Monitor `<div>` wrapper | Red border + `box-shadow` glow |
| `.monitor-preview` | Monitor `<div>` wrapper | Amber border + subtle glow |
| `.monitor-idle` | Monitor `<div>` wrapper | Dark neutral border |
| `.live-text-glow` | LIVE label text | Red `text-shadow` glow |
| `.slide-active` | Active slide in `SlideList` | Green gradient wash + green left border |
| `.btn-go` | GO button | Gradient bg, green border/text |
| `.btn-clear` | CLEAR button | Neutral gradient bg |
| `.btn-logo` | LOGO button | Amber gradient bg |
| `.resize-h` | Horizontal drag handles | `cursor: col-resize` |
| `.resize-v` | Vertical drag handles | `cursor: row-resize` |
| `.titlebar-drag` | Nav bar | `-webkit-app-region: drag` |
| `.titlebar-nodrag` | Interactive elements inside nav | `-webkit-app-region: no-drag` |

### 7.4 Titlebar / macOS traffic lights

`titleBarStyle: 'hiddenInset'` is used on macOS. The nav bar doubles as the draggable titlebar. Traffic lights appear at approximately x=8, y=8. The nav has `padding-left: 76px` on macOS (detected via `navigator.platform`) to clear the traffic lights, placing the CUE wordmark immediately to their right.

On Windows, `titleBarStyle: 'default'` is used — the nav still carries `-webkit-app-region: drag` for dragging the window, but the 76px left offset is not applied.

### 7.5 ON AIR badge alignment

The "ON AIR" badge is positioned `absolute` inside the monitor frame element — **not** in the label row above it. This ensures both monitor label rows are always identical height (the label row is a fixed `h-5` flex container), preventing misalignment between the Preview and Live monitors when one has an active indicator and the other does not.

---

## 8. File structure — as built

Matches the specification with the following additions:

```
src/
├── main/
│   ├── index.js                 ← App entry, window lifecycle, dialog IPC
│   ├── preload.js               ← contextBridge (window.cue) — full API surface
│   ├── output-preload.js        ← Minimal preload for output BrowserWindows
│   ├── db/
│   │   ├── schema.js
│   │   ├── songs.js
│   │   ├── services.js
│   │   ├── media.js
│   │   └── settings.js
│   ├── ipc/
│   │   ├── songs.ipc.js
│   │   ├── services.ipc.js
│   │   ├── media.ipc.js
│   │   ├── output.ipc.js
│   │   └── settings.ipc.js
│   └── output/
│       ├── manager.js
│       └── ndi.js
├── renderer/
│   ├── App.jsx
│   ├── main.jsx
│   ├── index.css                ← Design system CSS utilities
│   ├── views/
│   │   ├── OperatorView.jsx     ← Resizable 3-panel layout + keyboard shortcuts
│   │   └── SettingsView.jsx
│   ├── panels/
│   │   ├── RundownPanel.jsx
│   │   ├── PreviewLivePanel.jsx ← Resizable monitor/slidelist split
│   │   └── LibraryPanel.jsx
│   ├── components/
│   │   ├── SongEditor.jsx
│   │   ├── SongPreviewModal.jsx
│   │   ├── ContextMenu.jsx
│   │   └── SlideList.jsx
│   └── settings/
│       ├── OutputChannels.jsx
│       ├── LogoSettings.jsx
│       └── BackgroundSettings.jsx
└── output/
    ├── fullscreen.html
    ├── fullscreen.css
    ├── fullscreen.js
    ├── lowerthird.html
    ├── lowerthird.css
    └── lowerthird.js
```

---

## 9. Known gaps and Phase 1b backlog items

These were identified during Phase 1a but are either out of scope for Phase 1a or minor gaps left for Phase 1b:

| Item | Priority | Notes |
|------|----------|-------|
| **grandiose NDI publish** | **High** | `ndi.js` is a stub. grandiose not installed. No frames published. See §4.4. Phase 1b must add `grandiose` to `package.json`, rebuild, and implement the capture → publish loop. |
| **`linked_channel_id` logic** | **Medium** | Field in schema, settable via IPC, but nothing reads it. Intended to link a lower-third channel to a fullscreen channel so they move in sync. Implement in Phase 1b alongside NDI. |
| **Stage display / confidence monitor** | High | Specified as Phase 1b in original spec. Full scope TBD. |
| Persist panel split sizes | Low | `operator_panel_splits` setting key — save H/V/monitor percentages on drag end |
| Media unused-asset cleanup tool | Low | Spec §8.4 suggested this for Phase 1b |
| Drag asset from library onto rundown item | Medium | Spec §5.4, M7. UI drag handler not implemented; background override settable via context menu |
| Tag CRUD UI | Medium | Tags can be assigned but the UI to create/rename/delete tags is not wired in Settings |
| Song background picker in Song Editor | Medium | The editor has the field in DB but no in-modal picker UI for the background — falls back to global |
| Disk space free-space warning | Low | Spec §8.4 — warn when < 2GB free. Detection not implemented |
| `output:preview:get` IPC | Low | Spec §7.3 — superseded by `output:getState` (see §5.6), which returns live state. Preview payload is held in renderer state only (not persisted to main). |
| NDI FPS/resolution live-change | Low | Settings UI exists but requires channel close/reopen to take effect |

---

## 10. Phase 1b scope — confirmed items from original spec

The following were explicitly deferred to Phase 1b in the original specification, plus items identified during Phase 1a:

1. **grandiose NDI publish** — Not implemented in Phase 1a (see §4.4 and §9). Requires: `npm install grandiose`, `npm run rebuild`, implementing the `capturePage()` → `grandiose.send()` loop in `ndi.js`, and wiring `linked_channel_id` sync logic. OBS verification required after implementation.

2. **Stage display / confidence monitor** — A separate output channel type that shows operator-facing content (next slide, song notes, clock) on a stage-facing screen. Full specification required before development.

3. **Media unused-asset cleanup** — A tool in Settings to identify assets that are not referenced by any song or service item, and delete them to reclaim disk space.

Items from §9 above may also be scoped into Phase 1b depending on priority. A Phase 1b technical specification should be written before development begins.

---

*Cue Graphics Engine — Phase 1a Implementation Record v1.5*
*M1–M7, M9 complete. M8 partial. Preview/Live workflow revised (§4.5). style_json + bundled font library added (§4.6–§4.7). Song editor styling controls + Paste Song parser added (§4.8). Ready for Phase 1b specification.*
