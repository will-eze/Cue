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
| `grandi` | installed | NDI output. ESM-only; loaded at runtime via `createRequire` to bypass Vite's CJS bundler. Platform binaries: `@grandi/darwin-arm64`, `@grandi/darwin-x64`, `@grandi/win32-x64`, etc. Listed in `forge.config.js` `rebuildConfig.extraModules` and `vite.main.config.js` `external`. |

---

## 3. Process Architecture

Three types of Chromium/Node processes run simultaneously:

```
Main process (Node.js)
  ├── SQLite (better-sqlite3, synchronous)
  ├── File system (media import/serve)
  ├── IPC bridge (ipcMain.handle)
  ├── Output window lifecycle
  └── NDI (grandi wrapper — active, publishes BGRA frames)

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
│   │                         Dialog IPC. Startup sequence: initDb → seedBundledBibles → seedGhsHymnal.
│   │                         Wires the remote control server: remoteServer.configure (getState + forward commands to
│   │                         the renderer as remote:command), outputManager.setRemoteStateListener, applyRemoteConfig().
│   ├── preload.js            contextBridge → window.cue. The complete renderer API surface.
│   ├── output-preload.js     Minimal contextBridge for output windows → window.cueOutput only.
│   ├── fonts.js              BUNDLED_FONTS array + DEFAULT_FONT. Imported by preload.js.
│   │
│   ├── db/
│   │   ├── schema.js         SQLite init, migration runner (v1→v15), getDb() singleton.
│   │   ├── graphics.js       Broadcast-graphics CRUD (list/get/create/update/del/reorder). style_json + target.
│   │   ├── themes.js         Theme library CRUD (list/get/create/update/del). applyToSong/applyToRundown/
│   │   │                     applyToAllSongs merge the theme style_json into song_sections (preserving inline
│   │   │                     text runs) and, when the theme has a background + setBg, write songs.default_background_id
│   │   │                     and NULL out per-slot service_items.background_override_id so the theme bg wins.
│   │   ├── songs.js          Song + section + tag CRUD, FTS5 search. importSongs (bulk insert, tag-aware:
│   │   │                     song.tags[] get-or-created + assigned). existingTitleSet (duplicate flagging).
│   │   │                     GHS hymnal: readBundledGhsRows, seedGhsHymnal (once, ghs_seeded flag),
│   │   │                     tagGhsSongs (idempotent backfill of the GHS tag onto "GHS N …" songs).
│   │   ├── services.js       Service / rundown CRUD. resolveItem() joins media paths.
│   │   ├── media.js          Media import (copy to userData/media/), list, delete, folders.
│   │   ├── settings.js       Key-value settings store. Global logo/background helpers (song/scripture/slide).
│   │   ├── bible.js          Version + verse queries (books/chapters/verses/adjacent/search/resolve). importVersion,
│   │   │                     deleteVersion, seedBundledBibles, getbible online catalog (listOnlineVersions/downloadOnlineVersion).
│   │   ├── bible-import.js   Parsers: book-array / flat / nested-object JSON + Zefania XML. deriveAbbrev (word initials).
│   │   └── bible-books.js    Canonical 66-book order + abbreviation lookup (lookupBook).
│   │
│   ├── import/
│   │   └── songs-import.js   Song-file parsers (pure, preview-before-commit). parseSongFiles(filePaths)
│   │                         auto-detects per file: OpenLyrics XML (regex), ChordPro ({directives} +
│   │                         [chord] stripping), plain text (filename → title), EasyWorship (SQLite
│   │                         Songs.db + SongWords.db join, RTF→text via rtfToText, one file → many rows).
│   │                         parseGhsItems(items) → "GHS N - Name" rows tagged GHS. Shared parseSections
│   │                         (header / blank-block splitter, mirrors SongEditor's Paste Song parser).
│   │
│   ├── ipc/
│   │   ├── songs.ipc.js      Registers songs:*, tags:* handlers (incl. importParse/importGhs/importCommit).
│   │   ├── services.ipc.js   Registers services:* handlers.
│   │   ├── media.ipc.js      Registers media:* handlers.
│   │   ├── output.ipc.js     Registers output:* handlers (incl. graphic/ticker/overlay + channel show_program/
│   │   │                     show_graphics; content-mode-only channel updates route to setChannelContentMode).
│   │   ├── graphics.ipc.js   Registers graphics:* CRUD handlers (registerGraphicsIpc).
│   │   ├── themes.ipc.js     Registers themes:* CRUD + apply handlers (registerThemesIpc).
│   │   ├── settings.ipc.js   Registers settings:* handlers.
│   │   ├── bible.ipc.js      Registers bible:* handlers (versions/books/chapters/verses/adjacent/resolve/search/importFile/delete/online:*).
│   │   └── remote.ipc.js       Registers remote:* handlers (getConfig/setConfig/regenerateToken/navState). Owns the
│   │                           settings keys (remote_enabled/port/lan/token) + applyRemoteConfig() (boot + on-change start).
│   │
│   ├── remote/
│   │   ├── server.js           Network control API. Dependency-free Node http server (no ws — SSE for the live STATE
│   │   │                       push). Binds 127.0.0.1 (LAN opt-in = 0.0.0.0). Token-gated /api/*. configure() injects
│   │   │                       getState + onCommand (decoupled from manager/window). ACTIONS = go/clear/logo/next/prev/
│   │   │                       live/select; GET /api/<action> or POST /api/command. STATE via GET /api/state + GET
│   │   │                       /api/stream (SSE). setNavState() holds the renderer-pushed rundown (items + slides).
│   │   └── control-page.js     CONTROL_PAGE: self-contained dark HTML control surface served at GET / (phone remote).
│   │                           Token from ?token= → localStorage. SSE-driven (single source of truth, no stale renders).
│   │                           Accordion rundown — expand a song to its numbered slides, tap a verse to jump live.
│   │
│   └── output/
│       ├── manager.js        Output window registry. go/clear/logo dispatch. No operator capture loop —
│       │                     the operator live monitor renders from payload, not capturePage.
│       │                     Owns the foreground-media `transport` { active, startAt, pausedAt, loop, muted }
│       │                     (machine-clock based). go() stamps it; mediaControl/mediaSeek/mediaSetMuted mutate it;
│       │                     broadcastTransport() pushes `media:transport` to every window + `output:media-transport`
│       │                     to the renderer. isPrimaryAudioMonitor() picks the single program-audio window (?mute=).
│       │                     Stage timer/message state (stageTimerCmd, setStageMessage) → stage:timer / stage:message.
│       │                     NDI: ndiCaptureLoops Map, ndiLastFrames Map (1fps JPEG cache for multiview).
│       │                     startNdiCapture/stopNdiCapture. multiviewRefCount: refcounted start/stop —
│       │                     multiview capture is driven only by MultiviewView (start on mount, stop on unmount).
│       │                     Broadcast-graphics overlay bus: overlay {nameTitle,ticker,custom} + graphicShow/Hide,
│       │                     tickerShow/Hide, customShow/Hide; broadcastGraphic() → per-window target-filtered
│       │                     graphic:update to all non-stage windows (getGraphicsWindowInfos). setChannelContentMode()
│       │                     toggles a channel's lyric band / overlay at runtime via content:mode (no window recreate).
│       │                     setRemoteStateListener(cb): notifyMainWindow('output:state-changed') also fires cb so the
│       │                     network remote pushes STATE. setOutputsEnabled emits state early (before slow window work).
│       └── ndi.js            Active NDI implementation. createRequire loads @grandi/<platform>-<arch>
│                             at runtime. createSender / sendFrame (inflight guard) / destroySender.
│
├── renderer/
│   ├── main.jsx              React entry point. Mounts <App />.
│   ├── index.css             Design system CSS: tally classes, monitor glow, scrollbar, fonts.
│   ├── App.jsx               Root. Titlebar + transport bar + view switcher (Operator/Settings).
│   │                         StagePanel popover (Stage button): presenter countdown timer + stage message,
│   │                         driven via window.cue.output.stage.timer / .message.
│   │
│   ├── views/
│   │   ├── OperatorView.jsx  Three-panel layout. All transport state. Keyboard shortcuts (configurable via shortcutsRef).
│   │   │                     Background resolution. buildPayload(). Services list refreshes on bgRefreshTick.
│   │   │                     Accepts outputsEnabled + onToggleLive props from App. focusSearchRef wired to LibraryPanel.
│   │   │                     Resize state persisted to localStorage (keys: layout_h_pct, layout_v_pct).
│   │   │                     Loads output channels list. Does NOT capture output or subscribe to multiview —
│   │   │                     the live monitor renders the slide from payload (no per-frame capture loop).
│   │   │                     liveChannelIdx tracks which channel the live monitor displays.
│   │   ├── SettingsView.jsx  Settings layout. Left column is section navigation (Channels/Logo/Background/Themes/
│   │   │                     Bible/Shortcuts/Remote/Danger) + Back-to-Operator: click scrolls to the section; an
│   │   │                     IntersectionObserver highlights the section in view. Section order: OutputChannels →
│   │   │                     LogoSettings → BackgroundSettings → ThemeSettings → BibleSettings → ShortcutSettings → RemoteSettings →
│   │   │                     DangerZone → SettingsFooter (always last two, rendered at layout level — not inside any sub-component).
│   │   └── MultiviewView.jsx Multi-output monitor wall. Subscribes to output:multiview-captures.
│   │                         NDI channels show NdiTile (checkerboard + frame). Screen channels show ScreenMonitorTile.
│   │                         NDI channels never show "No screens assigned" — they don't use channel_monitors.
│   │
│   ├── panels/
│   │   ├── RundownPanel.jsx       Service selector with inline rename/delete UI (no native confirm dialogs).
│   │   │                          DnD-sortable item list. Context menu.
│   │   │                          MediaPickerModal for background override.
│   │   │                          Right-click song items → Preview / Edit / Set Background Override / Apply Theme: <name>
│   │   │                          (one entry per saved theme → themes.applyToSong, setBg = theme has a background).
│   │   │                          Media items show a LOOP badge when media_loop; context menu Enable/Disable Loop
│   │   │                          → window.cue.services.setItemLoop.
│   │   │                          Props: onRenameService, onDeleteService.
│   │   ├── PreviewLivePanel.jsx   Two MonitorFrames (Preview + Live) + two SlideLists.
│   │   │                          MonitorFrame renders a 1920×1080 virtual canvas scaled via ResizeObserver +
│   │   │                          CSS transform — pixel-accurate match of the output template at any container size.
│   │   │                          Supports fullscreen (textBox positioning), lowerthird (bottom-anchored bar), and
│   │   │                          stage layouts. When the selected channel template is 'stage', the live monitor renders
│   │   │                          StageMonitor — the confidence-monitor layout (top status bar with live clock + idle
│   │   │                          timer/video slots, big current text, COMING NEXT row, message bar) at native 1920×1080.
│   │   │                          Video backgrounds use SyncedVideo — locked to the shared `transport` via the same
│   │   │                          wall-clock + playbackRate algorithm as the output players (muted; no screen-capture).
│   │   │                          Foreground-media transport bar: timeline scrubber (media.seek), current/total time,
│   │   │                          program-audio mute button (media.setMuted), play/pause + restart (media.control).
│   │   │                          Subscribes to output:media-transport; useMediaDuration() probes clip length.
│   │   │                          Channel selector strip (2+ channels): click to switch live monitor to any channel.
│   │   │                          Renders the broadcast-graphics overlay (GraphicsOverlayLayer) on top of any non-stage
│   │   │                          live monitor, filtered by the selected channel's kind + content mode (show_program/
│   │   │                          show_graphics → hideProgram/hideGraphics). Subscribes to output:overlay-changed.
│   │   │                          Props: allChannels, liveChannelIdx, onSetLiveChannelIdx.
│   │   ├── LibraryPanel.jsx       Songs tab (react-window virtualised list) + Media tab (grid) + Scripture tab.
│   │   │                          Song search + tag filter (left-panel folders = tags). Media import.
│   │   │                          Import dropdown (Songs tab): "Import from File…" (dialog → songs.importParse →
│   │   │                          SongImportModal) and "Import GHS Hymnal" (songs.importGhs → same modal).
│   │   │                          GHS folder = the "GHS" tag; when it's the sole active filter the list orders by
│   │   │                          hymn number and a numeric "GHS number…" quick-search replaces the text search
│   │   │                          (Enter previews the exact number). Single-click (220ms) → SongPreviewModal.
│   │   │                          Double-click → add to rundown. Accepts refreshTick + focusSearchRef props.
│   │   │                          focusSearchRef focuses whichever search input is mounted (GHS number field in the
│   │   │                          GHS folder, else the song search) on S keypress. Graphics tab → <GraphicsPanel />.
│   │   ├── GraphicsPanel.jsx      Broadcast Graphics tab. Live destination override (Default/All/In-Room/Online),
│   │   │                          lower-third channel mode switcher (per-channel 3-way, runtime), Quick Ticker,
│   │   │                          grid of live-thumbnail cards (Take/Clear per kind), Clear All. Follows
│   │   │                          output:overlay-changed for Live badges. Hosts GraphicsEditor.
│   │   └── ScripturePanel.jsx     Live verse browser (Scripture tab). Translation rail (select/delete/import/appearance),
│   │                              predictive Book→Chapter→Verse reference bar (autofocus), whole-chapter verse list,
│   │                              ↑/↓ live nav, right-click menu, OnlineBibleModal + ScriptureEditor hosts.
│   │
│   ├── components/
│   │   ├── SongEditor.jsx         Full-screen song CRUD modal (createPortal). Sections sidebar with DnD reorder.
│   │   │                          Two-tab preview: Fullscreen (1920×1080 scaled SlidePreview) + Lower Third (LowerThirdPreview).
│   │   │                          FormattingToolbar: Row 1 (font/size/color/B/I/U/AA/H-align/V-align/Reset).
│   │   │                          Row 2 (line/track spacing, shadow on+controls, stroke on+controls,
│   │   │                                 Box presets+x/y/w/h — fullscreen only;
│   │   │                                 Bar on+color+opacity+solid toggle — lower-third only).
│   │   │                          SlidePreview: ResizeObserver scales 1920×1080 canvas. LowerThirdPreview: checkerboard.
│   │   │                          DEFAULT_STYLE includes ltBar (lower-third gradient bar control).
│   │   │                          TEXTBOX_PRESETS: Full / Top / Middle / Bottom / L3.
│   │   │                          Header "Load Theme…" dropdown (shown when ≥1 theme): applies the theme's style_json
│   │   │                          to the section style state and always swaps in the theme's background.
│   │   │                          Exports FormattingToolbar, SlidePreview, LowerThirdPreview, DEFAULT_STYLE (reused by ThemeSettings).
│   │   │                          Paste Song parser (parseSong). renderWithRuns (exported). Escape key closes.
│   │   ├── SongPreviewModal.jsx   Read-only song preview. Add to Rundown / Edit.
│   │   ├── SongImportModal.jsx    Import preview/confirm (createPortal). One row per parsed song: checkbox,
│   │   │                          uncontrolled editable title (titlesRef — no re-render for large batches),
│   │   │                          format badge, section count; failed/duplicate rows flagged. Selection in a Set;
│   │   │                          duplicates start unselected. Commit → songs.importCommit (forwards tags).
│   │   ├── ScriptureEditor.jsx    Global scripture appearance modal. Verse/Reference target toggle, drag/resize,
│   │   │                          object align, background. Reuses SongEditor exports. Saves scripture_*_json + bg.
│   │   ├── GraphicsEditor.jsx     Broadcast-graphic editor modal. Kind tabs (lower_third/ticker/custom). Reuses
│   │   │                          SongEditor's FormattingToolbar; lower-third Name/Title target toggle + draggable/
│   │   │                          resizable BugPreview + bar control; ticker styling + top/bottom; custom HTML +
│   │   │                          placeholders + sandboxed preview. Default-destination selector. Exports
│   │   │                          fillPlaceholders, flatTextCss, buildBarBg (shared with GraphicsPanel + monitor).
│   │   ├── OnlineBibleModal.jsx   getbible.net catalog browser. Multi-select download with licence warning.
│   │   ├── MediaPickerModal.jsx   Media grid picker. Used by RundownPanel for bg override.
│   │   ├── SlideList.jsx          Scrollable slide/section list. Preview and live variants.
│   │   │                          Slide content capped at max-h-24 to prevent runaway tall cards.
│   │   │                          Section labels via utils/sectionLabels (numbered: Verse 1 / Verse 2, abbrev forms).
│   │   └── ContextMenu.jsx        Generic right-click menu positioned by x/y coords.
│   │                              Escape key closes menu. Overflow guard accounts for separator height.
│   │
│   ├── settings/
│   │   ├── OutputChannels.jsx    Channel cards. Create/edit/delete. Monitor assignment per channel.
│   │   │                          NDI cards have an audio mute toggle (ndi_audio_muted) — volume_off/volume_up.
│   │   │                          Lower-third cards have a 3-way content mode (ChannelModeSwitch): Lyrics + Graphics /
│   │   │                          Lyrics Only / Graphics Only (show_program × show_graphics, via channelMode util).
│   │   ├── LogoSettings.jsx      Global logo picker.
│   │   ├── BackgroundSettings.jsx Global song/scripture/slide background pickers. Bulk apply actions.
│   │   ├── ThemeSettings.jsx     Theme library. Grid of theme cards (SlidePreview thumbnail; Edit/Delete; per-card
│   │   │                          "Apply background" toggle + Apply-to-rundown selector + Apply-to-all-songs).
│   │   │                          ThemeEditorModal reuses SongEditor's FormattingToolbar + SlidePreview/LowerThirdPreview
│   │   │                          over a fixed sample text; width-bound preview (modal is content-sized). Background picker.
│   │   ├── BibleSettings.jsx     Installed translations list (delete) + Import (file/online) menu.
│   │   │                          Accepts only activeServiceId prop. No DangerZone or footer inside.
│   │   ├── DangerZone.jsx        Destructive actions: clear rundown items, delete rundown, clear library.
│   │   │                          Two-step confirm on every action. Success toast feedback.
│   │   ├── ShortcutSettings.jsx  Configurable keyboard shortcuts UI. Modifier selector (Cmd/Ctrl/Alt)
│   │                              + key inputs for GO, Clear, Logo, Live Toggle. Saves to settings DB.
│   │                              Shortcuts reload in OperatorView on next bgRefreshTick.
│   │   └── RemoteSettings.jsx    Network control card. Enable toggle, port, Allow-LAN toggle, pairing token
│   │                              (copy/regenerate), phone URL, and the HTTP API reference. Drives remote:setConfig.
│   │
│   └── utils/
│       ├── mediaUrl.js           mediaUrl(absPath) → cue-media://localhost/encoded/path
│       ├── channelMode.js        Lower-third content-mode helpers: CHANNEL_MODES, channelMode(ch),
│       │                         modeToFlags(mode) ({show_program, show_graphics}). Shared by Settings + Graphics panel.
│       └── sectionLabels.js      Numbered section labels — single source of truth. sectionOrdinals(slides) (n or null,
│                                 numbered only when a type repeats); sectionLabels(slides,{abbrev}); sectionLabelAt.
│                                 Used by SlideList, SongEditor, OperatorView buildPayload (stage label), the remote.
│
├── output/                   Plain HTML — no build step, no React, served directly.
│   ├── media-player.js       Shared classic script (loaded before fullscreen.js/stage.js). window.CueMediaPlayer.
│   │                         attach(el, {loop, baseMuted, transport}) locks one <video>/<audio> to the shared
│   │                         transport: wall-clock-derived position, playbackRate convergence (±6%, preservesPitch),
│   │                         native loop, el.muted = baseMuted || transport.muted. Subscribes to onMediaTransport.
│   ├── graphics-overlay.js   Shared broadcast-graphics overlay (included by fullscreen.html + lowerthird.html, NOT
│   │                         stage). Injects its own #cue-gfx DOM + styles. Renders the name/title bug (positioned by
│   │                         style.name.textBox, styled per name/title), ticker crawl (top/bottom, speed), and custom
│   │                         HTML (isolated shadow root, .cue-in/.cue-out). Honours onGraphicUpdate; ?graphics=0 and
│   │                         content:mode toggle the whole overlay live (caches last overlay to restore on re-enable).
│   ├── fullscreen.html       #background + #content (#text-wrap > #text, #logo-wrap, #copyright). + graphics-overlay.js.
│   ├── fullscreen.css        Fullscreen output styles. #text-wrap is absolutely positioned by JS.
│   │                         #logo-wrap is a separate sibling (never overwrites #text).
│   ├── fullscreen.js         applyStyle(s): positions #text-wrap via textBox %, applies all style props to #text.
│   │                         showLogo/hideLogo use #logo-wrap. Supports: verticalAlign, letterSpacing,
│   │                         uppercase, textShadow (buildShadow), textStroke, textBox, underline in runs.
│   │                         Detects ?alpha=1 (IS_NDI) → transparent background; ?mute=1 (MUTE_AUDIO) → base mute.
│   │                         Foreground media via CueMediaPlayer.attach (single element, native loop). No clock-master
│   │                         time reporting, no dual-element loop swap.
│   ├── lowerthird.html       #lowerthird > #text + #copyright (lyric band) + graphics-overlay.js. Always transparent.
│   ├── lowerthird.css        #lowerthird: bottom-anchored, background: transparent (controlled by JS via ltBar).
│   ├── lowerthird.js         The LYRIC BAND only (program slide). applyStyle(el, s) incl. ltBar gradient to #lowerthird.
│   │                         buildBarBg(ltBar): null → transparent; {color,opacity,solid} → CSS gradient or solid.
│   │                         ?program=0 / content:mode toggle the lyric band live (caches lastPayload to restore).
│   │                         The graphics overlay is separate (graphics-overlay.js).
│   ├── stage.html            Confidence monitor. #top-bar (local time / REMAINING timer / VIDEO countdown),
│   │                         #content (#media-wrap + #current-text, #next-text), #bottom-bar (#message-text).
│   ├── stage.css             Stage monitor styles — info bars, progress track, countdown colour states, message alert.
│   └── stage.js              Receives slide:update + stage:timer + stage:message. Video preview via CueMediaPlayer
│                             (always baseMuted). VIDEO countdown derives remaining from transport + clip duration —
│                             loops with the clip (never ∞), freezes on pause. Presenter countdown timer + message bar.
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
- `forge.config.js` — Electron Forge packaging config (`extraResource: ['./resources/bible', './resources/ghs']`)
- `index.html` — Vite renderer entry HTML

**Project-root data/tooling (outside `src/`):**
- `resources/bible/{kjv,web}.json` — bundled public-domain translations (seeded on first run; shipped via `extraResource`)
- `resources/ghs/ghs-hymnal.json` — bundled GHS hymnal seed `{ items:[{ number, name, lyrics }] }` (260 hymns; shipped via `extraResource`, seeded on first run by seedGhsHymnal)
- `scripts/build-bibles.mjs` — regenerates the bible seed JSON from getbible.net v2 (`node scripts/build-bibles.mjs`)
- `scripts/build-ghs.mjs` — regenerates the GHS seed from a number→name CSV (cp1252) + lyric text files (`node scripts/build-ghs.mjs <csv> <lyricsDir>`)

---

## 5. Database

**Engine:** `better-sqlite3` (synchronous — no Promises, no async).
**Location:**
- macOS: `~/Library/Application Support/Cue/cue.db`
- Windows: `%APPDATA%\Cue\cue.db`

**Media files** are copied to `userData/media/<uuid>.<ext>` on import. Original paths are not retained.

### Migration system

`schema.js` creates `db_version` table (single integer row) on first run and applies pending migrations in order inside a transaction. **Never delete `db_version`** — it is required to exist before any user-facing build. Current version: **15**. Migrations run with foreign keys disabled, so table-rebuild migrations (v6, v7, v11) do not cascade-delete referencing rows.

| Version | Change |
|---|---|
| v1 | Initial schema — all core tables |
| v2 | Added `style_json` to `song_sections`, expanded type CHECK to include `refrain` |
| v3 | Rebuilt `songs_fts` as plain contentless FTS5 (removed `contentless_delete=1` incompatible with Electron 30's SQLite 3.49) |
| v4 | Added `channel_monitors` table — separates channels (content streams) from physical screen assignments |
| v5 | Added 5 query-plan indices: `song_sections(song_id)`, `service_items(service_id)`, `taggables(entity_type, entity_id)`, `channel_monitors(channel_id)`, `media_assets(folder_id)` |
| v6 | Rebuilt `output_channels` to add `'stage'` to the `template` CHECK (stage / confidence display) |
| v7 | Scripture module: added `bible_versions`, `bible_verses` (+ `bible_verses_fts`); rebuilt `service_items` to add `'scripture'` to the `item_type` CHECK |
| v8 | Added `service_items.media_loop` (INTEGER, default 0) — per-item looping flag for video/audio |
| v9 | Added `output_channels.ndi_audio_muted` (INTEGER, default 1) — per-NDI-channel audio mute |
| v10 | Created `graphics` table (broadcast graphics: `lower_third`, `ticker`) |
| v11 | Rebuilt `graphics` to add the `custom` kind + `html` column (table-rebuild — CHECK can't be altered in place) |
| v12 | Added `graphics.style_json` (TEXT) + `graphics.target` (TEXT, default `'all'`) — per-graphic appearance + saved destination |
| v13 | Added `output_channels.show_program` (INTEGER, default 1) — lower-third channel shows the song lyric band |
| v14 | Added `output_channels.show_graphics` (INTEGER, default 1) — lower-third channel shows the broadcast-graphics overlay |
| v15 | Created `themes` table (theme / template library: named `style_json` + optional `background_id`) |

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
item_type TEXT NOT NULL CHECK(item_type IN ('song','media','slide','scripture'))  -- 'scripture' added v7
ref_id INTEGER               -- song id, media_asset id, or null for custom slides
order_index INTEGER NOT NULL
notes TEXT
content TEXT                 -- for item_type='slide': JSON {text, ...} or plain text
background_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
media_loop INTEGER NOT NULL DEFAULT 0   -- v8: loop this media item's video/audio
```

#### `bible_versions` / `bible_verses` (v7 — scripture module)
```sql
-- bible_versions: id, name, abbrev, language, created_at
-- bible_verses:   id, version_id→bible_versions(ON DELETE CASCADE),
--                 book_num, book_name, chapter, verse, text
-- bible_verses_fts: contentless FTS5 over (book_name, text)
```

#### `output_channels`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
type TEXT NOT NULL CHECK(type IN ('screen','ndi'))
display_index INTEGER          -- legacy, not used for matching
display_bounds TEXT            -- legacy; physical screens now live in channel_monitors
linked_channel_id INTEGER REFERENCES output_channels(id) ON DELETE SET NULL
template TEXT NOT NULL DEFAULT 'fullscreen' CHECK(template IN ('fullscreen','lowerthird','stage'))  -- 'stage' added v6
ndi_fps INTEGER DEFAULT 30
ndi_width INTEGER DEFAULT 1920
ndi_height INTEGER DEFAULT 1080
logo_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
ndi_audio_muted INTEGER NOT NULL DEFAULT 1   -- v9: per-NDI-channel audio mute (1 = muted)
show_program INTEGER NOT NULL DEFAULT 1      -- v13: lower-third shows the song lyric band
show_graphics INTEGER NOT NULL DEFAULT 1     -- v14: lower-third shows the broadcast-graphics overlay
active INTEGER NOT NULL DEFAULT 1
```

**Lower-third content modes** (`show_program` × `show_graphics`): both=1/1 (Lyrics + Graphics), 1/0 (Lyrics Only), 0/1 (Graphics Only). Flipping these two flags is a **runtime** change — `setChannelContentMode` messages the existing window via `content:mode` rather than recreating it, so the NDI sender is never dropped. Structural changes (template/type/monitors/active) still rebuild the window via `syncChannel`. The flags reach the window as `?program=` / `?graphics=` query params on first load and as `content:mode` events thereafter.

#### `graphics` (v10–v12 — broadcast graphics)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
kind TEXT NOT NULL CHECK(kind IN ('lower_third','ticker','custom'))
label TEXT
name TEXT                      -- lower_third / custom substitution
title TEXT                     -- lower_third / custom substitution
text TEXT                      -- ticker text / custom {{text}}
html TEXT                      -- custom kind: HTML + inline <style> with {{placeholders}}
speed INTEGER NOT NULL DEFAULT 100   -- ticker crawl speed (px/s)
style_json TEXT                -- v12: per-graphic appearance (see below)
target TEXT NOT NULL DEFAULT 'all'   -- v12: saved default destination ('all'|'screen'|'ndi')
order_index INTEGER NOT NULL DEFAULT 0
created_at DATETIME, updated_at DATETIME
```

`style_json` shape — **lower_third**: `{ name: <style incl. textBox + ltBar>, title: <style> }` (the `name` style's `textBox` is the draggable/resizable position box, `ltBar` is the bar background). **ticker**: a flat style + `{ bar:{color,opacity}|null, position:'bottom'|'top' }`. **custom**: `null` (raw HTML).

#### `themes` (v15 — theme / template library)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
style_json TEXT                -- a section style snapshot (same shape as §8; no runs)
background_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
created_at DATETIME, updated_at DATETIME
```

A theme is a saved section `style_json` (§8 shape) plus an optional default background. Applying a theme merges its `style_json` into every target `song_sections.style_json` (per-section inline `runs` are preserved) and, when it has a background and the background is being applied, writes `songs.default_background_id` and NULLs the relevant `service_items.background_override_id` so the theme background wins over any per-slot override. Apply scope: `applyToSong` (all slots referencing one song), `applyToRundown` (all song slots in a rundown), `applyToAllSongs` (every song slot). The output path is unchanged — themes only write the same columns the editors already write.

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
| `global_bg_scripture_id` | number\|null | Global default background for scripture |
| `global_bg_slide_id` | number\|null | Global default background for slides |
| `scripture_style_json` | object\|null | Global style_json applied to every scripture verse; `null` = template defaults |
| `scripture_ref_style_json` | object\|null | Global style_json for the scripture reference line; optional `pos:{x,y}` free-positions it; `null` = default right-aligned bottom |
| `operator_preview_layout` | 'stacked'\|'sidebyside' | Unused in current UI — reserved |
| `keyboard_modifier` | 'meta'\|'ctrl'\|'alt' | Modifier key for transport shortcuts (default: 'meta' on macOS, 'ctrl' on Windows) |
| `keyboard_go` | string | Key char for GO shortcut (default: 'g') |
| `keyboard_clear` | string | Key char for Clear shortcut (default: 'c') |
| `keyboard_logo` | string | Key char for Logo shortcut (default: 'l') |
| `keyboard_live` | string | Key char for Live Toggle shortcut (default: 'o') |
| `ghs_seeded` | boolean | Set true after the bundled GHS hymnal is imported on first run; gates re-seeding so deletions stick |
| `remote_enabled` | boolean | Network control server on/off (default false) |
| `remote_port` | number | Server TCP port (default 7373) |
| `remote_lan` | boolean | Bind all interfaces (LAN) vs 127.0.0.1 only (default false) |
| `remote_token` | string | Pairing token; minted on first enable, regenerable |

**localStorage keys** (UI state only — not in DB):
| Key | Description |
|---|---|
| `layout_h_pct` | Horizontal split: Rundown panel width as % (default 25) |
| `layout_v_pct` | Vertical split: top panels height as % (default 62) |

#### `db_version`
```sql
version INTEGER NOT NULL       -- current: 14
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
- Returns `Response` with correct MIME type and `Cache-Control: public, max-age=31536000, immutable` — Chromium serves from disk cache after first load so repeated media displays do not re-read from disk

### CRITICAL URL GOTCHA

`cue-media:///Users/...` (three slashes, no hostname) **does not work**.

Chromium's standard-scheme URL parser treats `cue-media:///Users/...` as having `users` as the hostname (lowercased first path segment), stripping it from `pathname`. The protocol handler then tries to read `/weze/Library/...` which doesn't exist.

**Always use `cue-media://localhost` as the base.** The `localhost` hostname is discarded; only `pathname` is used.

### `mediaUrl.js`
```js
export function mediaUrl(absPath) {
  if (!absPath) return null;
  // Normalize Windows backslashes → forward slashes; ensure leading /
  const normalized = absPath.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  const encoded = pathPart.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return 'cue-media://localhost' + encoded;
}
```

Use this function everywhere in renderer code. Output templates (`fullscreen.js`, `lowerthird.js`) have an equivalent inline `pathToUrl()` with the same Windows normalization.

### Windows protocol handler
On Windows, `new URL('cue-media://localhost/C:/Users/...').pathname` returns `/C:/Users/...` — the leading `/` before the drive letter must be stripped before calling `fs.statSync`. `main/index.js` handles this:
```js
if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
```

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
  const normalized = p.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  return 'cue-media://localhost' + pathPart.split('/').map(encodeURIComponent).join('/');
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
| `importParse(filePaths)` | `[{ok, file, format, title, author, copyright, sections, tags?, error?}]` | Parses song files (no DB write). Auto-detects OpenLyrics XML / ChordPro / text / EasyWorship SQLite (one .db → many rows). Per-file failures returned as `{ok:false, error}`. |
| `importGhs()` | same row shape, all `format:'GHS'`, `tags:['GHS']`, with `existing:bool` | Parses the bundled GHS hymnal; flags rows already in the DB. |
| `importCommit(parsedSongs)` | `{count, ids}` | Bulk-creates songs in one transaction. Each `song.tags[]` (names) is get-or-created and assigned. |

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
| `setItemLoop(itemId, loop)` | void | Sets service_items.media_loop (0/1) — looping for a media item. |
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
| `getState()` | `{isLive, livePayload, activeChannels:[ids], activeWindows, outputsEnabled, displayMode, transport, overlay}` | `transport` = media snapshot; `overlay` = `{nameTitle, ticker, custom}`. |
| `media.control(action)` | void | `action` ∈ `'play' \| 'pause' \| 'restart'` — mutates the transport, broadcast to all surfaces. |
| `media.seek(pos)` | void | Scrub foreground media to `pos` seconds (preserves paused state). |
| `media.setMuted(muted)` | void | Toggle program (audience) audio. Stage + operator preview stay silent regardless. |
| `graphic.show({name,title,style,target})` | void | Show the name/title lower-third bug. `target` ∈ `'all'\|'screen'\|'ndi'`. |
| `graphic.hide()` | void | Hide the name/title bug. |
| `graphic.showCustom({html,target})` | void | Show a custom-HTML graphic (placeholders already substituted). |
| `graphic.hideCustom()` | void | Hide the custom graphic. |
| `ticker.show({text,speed,style,target})` | void | Show the scrolling ticker. |
| `ticker.hide()` | void | Hide the ticker. |
| `overlay.get()` | `{nameTitle, ticker, custom}` | Current overlay snapshot. |
| `stage.message(text)` | void | Set/clear the confidence-monitor presenter message (`''` clears). |
| `stage.timer(action, seconds?)` | void | Presenter countdown: `action` ∈ `'set'(seconds) \| 'start' \| 'pause' \| 'reset'`. |
| `channels.list()` | `[output_channel rows]` | — |
| `channels.create(data)` | `channel` | NDI channels open a BrowserWindow immediately; screen channels wait for monitor assignment. `data.ndi_audio_muted` / `data.show_program` / `data.show_graphics` (all default 1). |
| `channels.update(id, data)` | `channel` | A change to **only** `show_program`/`show_graphics` is applied at runtime (`setChannelContentMode` → `content:mode`, no window recreate); any other field rebuilds via `syncChannel`. Emits `output:state-changed`. |
| `channels.delete(id)` | void | Closes window(s) and cascades to channel_monitors. |
| `monitors.list(channelId?)` | `[channel_monitor rows]` | Pass channelId to filter. |
| `monitors.create(channelId, {display_bounds, label})` | `monitor` | Assigns a physical screen to a channel and opens its BrowserWindow. |
| `monitors.delete(monitorId)` | void | Closes window and removes row. |
| `multiview.start()` | void | Begins capturing all output windows; emits `output:multiview-captures` at ~5fps. Refcounted — interval starts only when count goes 0→1. |
| `multiview.stop()` | void | Decrements refcount; stops capture only when count reaches 0. Safe for multiple subscribers. |
| `screens.list()` | `[{id, bounds, scaleFactor, label}]` | All connected displays. |

**Output payload structure:**
```js
{
  type: 'content' | 'clear' | 'logo',
  text: string | null,
  sectionLabel: string | null,
  copyright: string | null,            // scripture reference "Book c:v (VERSION)"; songs use their copyright line
  copyrightAlign: 'right' | undefined, // 'right' for scripture (bottom-right); songs/default centred
  copyrightStyle: object | undefined,  // scripture reference style_json (font/size/colour/align + optional pos:{x,y})
  backgroundPath: string | null,    // absolute filesystem path (not a URL)
  logoPath: string | null,          // absolute filesystem path
  styleJson: object | null,         // parsed style_json
  media: { path, type: 'video'|'audio'|'image', loop: bool } | undefined,  // foreground media item
  transport: { active, startAt, pausedAt, loop, muted } | undefined,       // snapshot for media items
}
```

**Media transport model** — foreground media (bumpers/clips) is synced across every surface (screen
outputs, NDI, operator live monitor, confidence monitor) by a single main-process `transport`:
```js
transport = { active, startAt, pausedAt, loop, muted }
// position(now) = ((pausedAt ?? now) - startAt) / 1000   (mod duration when loop)
```
`go()` stamps it; `mediaControl/mediaSeek/mediaSetMuted` mutate it; `broadcastTransport()` pushes
`media:transport` to every output window and `output:media-transport` to the renderer. Each player
(`media-player.js`, stage video, `SyncedVideo`) derives its playhead from the shared machine clock —
no clock-master election, no per-window time reporting — and converges via `playbackRate` nudging
(hard-seek only on >0.5 s drift / scrub / pause). Looping uses the native `loop` attribute (single
element) for clean gapless audio. **Program audio comes from one window only** (`isPrimaryAudioMonitor`
→ `?mute=` query param); stage is always muted; `media.setMuted` layers a live program mute as
`el.muted = baseMuted || transport.muted`.

**Broadcast-graphics overlay bus** — an independent layer (name/title bug, scrolling ticker, custom
HTML) separate from the program slide bus. Held in `manager.js` as `overlay = { nameTitle, ticker,
custom }`; each slot carries a `target` (`'all'|'screen'|'ndi'`). `broadcastGraphic()` sends a
per-window FILTERED `graphic:update` to **every non-stage output window** (fullscreen + lower-third,
matched by URL in `getGraphicsWindowInfos`) — a window only receives the slots whose target matches
its kind (numeric map key = screen/in-room, `ndi-*` = online) — and notifies the renderer via
`output:overlay-changed`. Rendered by the shared `src/output/graphics-overlay.js` (injects its own DOM
+ styles, honours `?graphics=0` and `content:mode`). A program `go`/`clear`/`logo` never touches the
overlay, and a graphic never touches the program. Default destination for new graphics is **Online (NDI)**.

### `window.cue.graphics`

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[graphics rows]` | Ordered by `order_index, id`. |
| `get(id)` | `graphics row` | — |
| `create(data)` | `id` | `data.style_json` (object or string), `data.target` (default `'ndi'`). |
| `update(id, data)` | void | — |
| `delete(id)` | void | — |
| `reorder(orderedIds)` | void | Single transaction. |

### `window.cue.themes`

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[theme rows]` | Each row joins `background_path`/`background_filename`/`background_type`. Ordered by name. |
| `get(id)` | `theme row` | — |
| `create(data)` | `id` | `data` = `{ name, style_json, background_id }`. |
| `update(id, data)` | void | Same shape as create. |
| `delete(id)` | void | — |
| `applyToSong(themeId, songId, setBg)` | `sectionCount` | Merges style into the song's sections. When `setBg` and the theme has a background, writes the song default bg and clears per-slot overrides on all slots referencing the song. |
| `applyToRundown(themeId, serviceId, setBg)` | `songCount` | Applies to every distinct song in the rundown; with `setBg`, clears that rundown's song-slot overrides. |
| `applyToAllSongs(themeId, setBg)` | `songCount` | Applies to every song in the library; with `setBg`, clears all song-slot overrides. |

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
| `setGlobalBackground(type, mediaId\|null)` | type: `'song'`, `'scripture'`, or `'slide'`. |
| `applyBackgroundToAll(type, mediaId)` | Bulk-updates all songs.default_background_id (song type only). |
| `getDiskUsage()` | Delegates to media.getDiskUsage(). |
| `getDataPath()` | Returns app.getPath('userData'). |
| `openDataFolder()` | Opens userData in Finder/Explorer. |

### `window.cue.bible`

| Method | Returns | Notes |
|---|---|---|
| `versions()` | `[{id, name, abbrev, language, verse_count}]` | Installed translations. |
| `books(versionId)` | `[{book_num, book_name}]` | Canonical order. |
| `chapters(versionId, bookNum)` | `[chapterNum, …]` | Ascending. |
| `verses(versionId, bookNum, chapter)` | `{bookNum, bookName, chapter, verses:[{chapter, verse, text}]}` | Whole chapter — drives the live verse list. |
| `adjacent(versionId, bookNum, chapter, verse, dir)` | next/prev verse `{book_num, book_name, chapter, verse, text}` or null | `dir` 1\|-1; rolls across chapter/book boundaries. Powers ↑/↓ live nav. |
| `resolve(versionId, ref, versesPerSlide?)` | passage payload | Free-text reference → self-contained passage (Add-to-Rundown scripture items). |
| `search(versionId, query)` | `[{book_name, book_num, chapter, verse, text}]` | FTS5 verse search. |
| `importFile(filePath, meta)` | `{ok, id, name, count}` \| `{ok:false, error}` | Imports JSON / Zefania XML. |
| `delete(id)` | void | Removes a translation (FTS purge + cascade). |
| `online:list` (`onlineList()`) | `{ok, versions:[{abbrev, name, language, license, restricted, installed}]}` | getbible.net v2 catalog (117 versions); installed matched by name. |
| `online:download` (`onlineDownload(abbrev)`) | `{ok, id, name, count}` \| `{ok, already:true}` \| `{ok:false, error}` | Fetch (main-process) + normalize + import one version. |

### `window.cue.remote`

Network control API (Stream Deck / Companion / phone). The renderer only configures the server and feeds it the rundown; transport itself flows back as a `remote:command` event the operator view handles like keyboard input.

| Method | Returns | Notes |
|---|---|---|
| `getConfig()` | `{enabled, port, lan, token, running, urls}` | Current server config + bound URLs. |
| `setConfig({enabled?, port?, lan?})` | config | Persists settings keys then (re)starts/stops the server. |
| `regenerateToken()` | config | Mints a new pairing token (old links stop working) and restarts. |
| `pushNavState({items, previewItemId, liveItemId, liveSlideIdx})` | void | Renderer pushes the rundown (each item carries `slides:[{index,label,preview}]`) so remote clients can list + jump to a slide. No-op when the server is stopped. |

HTTP surface (token via `X-Cue-Token` header or `?token=`): `GET /` (control page), `GET /api/state`, `GET /api/stream` (SSE), `GET /api/{go,clear,logo,next,prev,live}`, `GET /api/select?itemId=N&slideIdx=M`, `POST /api/command {action, …}`.

### `window.cue.dialog`
- `openFile(options)` → `{canceled, filePaths}` — wraps `dialog.showOpenDialog`.

### `window.cue.fonts`
- `fonts.list` — synchronous: `[{family, label, category}]` from `BUNDLED_FONTS`
- `fonts.default` — synchronous: `'Inter'`

### `window.cue.on(channel, callback)` → unsubscribe function
Subscribe to main→renderer events. Returns an unsubscribe function — call it to remove the listener (e.g. in `useEffect` cleanup). Allowed channels:
- `output:unresolved-channels` — array of unresolved channel objects on startup
- `output:state-changed` — fired after go/clear/logo/setLive AND after any channel topology/flag change (`syncChannel` / `setChannelContentMode`); payload: `{activeWindows, outputsEnabled, displayMode, livePayload, transport, overlay}`. OperatorView reloads its channel list on this so the live monitor tracks content-mode changes.
- `output:overlay-changed` — fired after any broadcast-graphics change; payload is the full `overlay` object `{nameTitle, ticker, custom}`. The Graphics panel + live monitor follow it.
- `output:media-transport` — fired whenever the media transport changes (go / play / pause / restart / seek / setMuted); payload: `{ active, startAt, pausedAt, loop, muted }`. The operator UI follows this to drive `SyncedVideo` and the transport bar. (There is NO `output:media-time` event — the old clock-master time-reporting chain was removed.)
- `output:multiview-captures` — array of `{channelId, dataUrl, isNdi}` objects (~5fps, only while multiview is running). `isNdi: true` for NDI channels (sourced from `ndiLastFrames` JPEG cache at ~1fps); `isNdi: false` for screen channels (capturePage at ~5fps).
- `output:ndi-unavailable` — fired if grandiose is not installed
- `shortcut:next` / `shortcut:prev` — reserved for future hardware remote
- `remote:command` — a network-control command `{action, itemId?, slideIdx?}` (action: go/clear/logo/next/prev/live/select). OperatorView dispatches it to the same handlers the keyboard uses, so the remote stays in sync with the UI.

---

## 8. Section Style JSON

`song_sections.style_json` is a nullable TEXT column. `null` means "use output channel defaults." When populated it is a serialised JSON object:

```json
{
  "align":         "center",   // "left" | "center" | "right"
  "bold":          false,
  "italic":        false,
  "underline":     false,
  "uppercase":     false,
  "fontFamily":    null,       // CSS family string matching fonts.css, or null for default
  "fontSize":      null,       // number (px) or null
  "color":         null,       // hex string or null
  "lineSpacing":   null,       // CSS line-height multiplier or null
  "letterSpacing": null,       // em value or null
  "verticalAlign": null,       // "top" | "center" | "bottom" or null (fullscreen only)
  "textShadow":    null,       // { enabled, x, y, blur, color } or null
  "textStroke":    null,       // { enabled, width, color } or null
  "textBox":       null,       // { x, y, w, h } percent of 1920×1080 canvas (fullscreen only)
  "ltBar":         null,       // { color, opacity, solid } — lower-third bar; null = transparent
  "runs":          []          // [{start, end, bold, italic, underline, color, fontFamily, fontSize}]
}
```

`null` on any property means "use template defaults." `textBox` and `verticalAlign` apply only to fullscreen channels. `ltBar` applies only to lower-third channels (`null` = transparent background, no bar). `SongEditor.jsx` calls `serializeStyle()` to convert to JSON; saves `null` when all values are default.

`renderWithRuns(text, runs)` is exported from `SongEditor.jsx` and used in `PreviewLivePanel.jsx` to render text with run-level styling in the monitor frame. Output templates have an equivalent inline copy. Runs support `underline`.

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

**Scripture** has no per-entity record, so the global default stands in for the per-song layer:
```
1. item.background_override.path   — per-rundown-slot override (rundown items only)
2. scriptureBgPath                 — global scripture default (settings.global_bg_scripture_id)
3. null → black screen
```
`OperatorView.loadScriptureDefaults()` reads `scripture_style_json` (verse), `scripture_ref_style_json` (reference) and `global_bg_scripture_id` (resolved to a path), refreshed on `bgRefreshTick` and after `ScriptureEditor` saves (`onScriptureStyleSaved`). `getSlides()` injects the verse style + `_refStyle` into scripture slides for the monitors; `resolveBackground()` falls back to `scriptureBgPath`. Both the rundown path (`buildPayload`) and the live-from-tab path (`handleScriptureLive`) carry `copyrightStyle` + `copyrightAlign:'right'`.

### Background write-through (cross-rundown persistence)

Setting a background on a rundown slot via "Set Background Override" **also writes to the song's own `default_background_id`**. This means the background follows the song into any new rundown it is later added to. Two code paths both do this:

- `services.setItemBackground(itemId, mediaId)` — DB function; writes `service_items.background_override_id` AND `songs.default_background_id` when the item is a song.
- `services.applyBackgroundToRundown(serviceId, mediaId)` — DB function; sets override on all song slots AND updates each distinct song's `default_background_id`.

The renderer's `RundownPanel` also calls `window.cue.songs.setBackground` after the picker resolves, as a belt-and-suspenders measure.

**Applying a theme is the inverse write-through**: when a theme with a background is applied (`themes.applyTo*` with `setBg`), it writes `songs.default_background_id` *and* NULLs the per-slot `service_items.background_override_id` on the affected song slots — so the theme background wins over an override that was previously written into a slot (resolution order puts override above the song default). A text-only theme (no `background_id`) never touches backgrounds or overrides.

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
- Resize state is **persisted to `localStorage`** (`layout_h_pct`, `layout_v_pct`) — survives reloads.

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
| Space | Advances **live** forward (`handleNextLiveSlide`): next live slide, rolling into the next rundown item at the boundary (also loads it into preview). If nothing is live, GOes the current preview. |
| ↓ arrow | `previewSlideIdx++`. Auto-GOes to live if `previewItemId === liveItemId`. At last slide → loads next rundown item. |
| ↑ arrow | `previewSlideIdx--`. Auto-GOes to live if `previewItemId === liveItemId`. At first slide → loads previous rundown item at its last slide. |
| Escape | `output:clear`. Sets `liveItemId=null`. |
| L key | `output:logo`. |
| S key | Focuses the song search input in LibraryPanel (the GHS number field when the GHS folder is active). |
| Modifier+G/C/L/O | GO / Clear / Logo / Live Toggle (modifier and keys are configurable in Settings). |
| Double-click song in Library | Adds to rundown. No preview/live change. |

### Keyboard shortcuts
Registered as a `keydown` listener on `document` inside `OperatorView`. **Not** `globalShortcut`. The listener checks `document.activeElement` — suppressed when an `INPUT`, `TEXTAREA`, or `contenteditable` has focus.

Two ref patterns used to avoid stale closures:
- `shortcutRef.current` — assigned on every render (not in `useEffect`) so the handler always captures the latest state
- `shortcutsRef.current` — holds configurable key bindings loaded from settings DB; reloads on `bgRefreshTick` changes

**Modifier priority:** modifier+key shortcuts are checked first; if the modifier is held, bare-key shortcuts are skipped. Default modifier is `Meta` (Cmd) on macOS and `Ctrl` on Windows, matching the operator's `window.cue.platform`.

**Do not use `globalShortcut`** — it captures at OS level and prevents typing G, L, Space in any input field system-wide.

### Section labels (numbered verses)
`utils/sectionLabels.js` is the single source of truth. A section type is numbered only when it repeats within the song — three verses → "Verse 1 / Verse 2 / Verse 3", a lone chorus stays "Chorus" (numbering is derived from the ordered list, never stored). `buildPayload`/`nextSlideInfo` use `labelForSlide()` so the stage/confidence display gets the numbered `sectionLabel`; `SlideList` (abbrev forms) and the song editor's ordinal badge use it too. Scripture/media slides pass through unchanged (each "type" is unique → no number).

### Network remote integration
`OperatorView` listens for `remote:command` and routes go/clear/logo/next/prev/live/select to the same handlers as the keyboard (the remote is a "virtual operator", so UI state stays in sync — it is always mounted, CSS-hidden when off-view). `handlePrevLiveSlide` mirrors the space-driven `handleNextLiveSlide` backwards; `handleRemoteSelect(itemId, slideIdx?)` jumps live to an item (or a specific slide). A `useEffect` pushes the rundown (`slidesForRemote` per item) + selection to the server via `window.cue.remote.pushNavState` whenever it changes.

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
BrowserWindow({ width: ndi_width, height: ndi_height, show: false, frame: false,
  backgroundColor: '#00000000',
  webPreferences: { offscreen: true, preload: output-preload.js } })
win.loadFile(src/output/fullscreen.html, { query: { alpha: '1', mute, program, graphics } })
// Template overrides CSS background to transparent when alpha=1.
```
Both window types also carry `?program=` / `?graphics=` (lower-third content mode — see below) and `?mute=` (base audio mute) query params.
NDI sender is created immediately (before `did-finish-load`) so the source appears on the network instantly. After load, `startNdiCapture` **always runs** regardless of whether the NDI SDK is available — `startPainting()` and the `invalidate` interval must run so that `ndiLastFrames` populates for multiview thumbnails even when grandi is not installed. The `paint` event handler guards `ndi.sendFrame()` with `ndi.isAvailable()` so frame publishing is skipped when the SDK is absent. An `inflight` flag per sender drops frames if the NDI SDK hasn't finished the previous `sender.video()` call, preventing unbounded buffer queue growth.

Display matching uses **bounds** (`x, y, width, height`), never `display_index`. If stored bounds don't match any connected display, the channel is flagged as unresolved. On startup, unresolved channels are sent via `output:unresolved-channels` IPC. `App.jsx` does **not** auto-redirect to Settings — the operator navigates there manually.

### Template path
```js
path.join(app.getAppPath(), 'src', 'output', `${channel.template}.html`)
```
Works in both dev (ASAR not used) and production (path is inside ASAR).

### go / clear / logo dispatch
`manager.go(payload)` iterates all active windows and sends `webContents.send('slide:update', payload)`. The `payload.backgroundPath` is an absolute filesystem path — the output template converts it to `cue-media://` using its inline `pathToUrl()`.

### Fullscreen template structure
`fullscreen.html` uses `#background` for the full-bleed media, `#text-wrap` (absolutely positioned by JS via `textBox` percentage values) as the text container, `#logo-wrap` as a separate sibling for the logo overlay (never overwrites `#text`), and `#copyright`. The `applyStyle(s)` function positions `#text-wrap` via CSS `left/top/width/height` percent strings, applies all style properties (verticalAlign, letterSpacing, uppercase, textShadow, textStroke, underline in runs) to the inner `#text` element. `showLogo`/`hideLogo` toggle a `.logo-active` class on `#logo-wrap`.

### Lower-third template structure
`lowerthird.html` uses `#lowerthird` (bottom-anchored, full-width) containing `#text` and `#copyright` — the **lyric band** (program slide) only, handled by `lowerthird.js`. Background is always `transparent` by default — JS sets it from `ltBar` via `buildBarBg()`. The `applyStyle(el, s)` function applies all style properties including the bar background. Clear and logo events explicitly reset `ltDiv.style.background = 'transparent'`. The broadcast-graphics overlay is a separate, shared layer (`graphics-overlay.js`).

### Broadcast-graphics overlay + lower-third content modes
The broadcast-graphics overlay (name/title bug, ticker, custom HTML) renders on **every non-stage output window** (fullscreen + lower-third) via the shared `src/output/graphics-overlay.js`, so an In-Room graphic overlays the auditorium program and an Online graphic overlays the NDI feed. It injects its own `#cue-gfx` DOM (high z-index, `pointer-events:none`) and listens for `graphic:update`. `manager.broadcastGraphic()` sends each window only the overlay slots whose `target` matches its kind (`getGraphicsWindowInfos` classifies by windows-map key: numeric = screen/in-room, `ndi-*` = online).

A lower-third channel has three **content modes** from `show_program` × `show_graphics`: Lyrics + Graphics, Lyrics Only, Graphics Only. The flags reach the window as `?program=` / `?graphics=` on first load (`lowerthird.js` gates the lyric band; `graphics-overlay.js` gates the overlay). Toggling them is a **runtime** operation: `setChannelContentMode(channelId)` sends `content:mode` to the existing window — both scripts hold a mutable flag + a cached last value, so they toggle in place and restore current content without recreating the window (the NDI sender is never dropped). The Graphics panel's per-channel switcher and Settings → Output Channels both drive this.

### Confidence / stage template structure
`stage.html` (template `'stage'`, a channel whose monitors run `stage.js`) is the presenter monitor:
`#top-bar` shows local clock, the presenter countdown timer (REMAINING, driven by `stage:timer`), and
a VIDEO countdown; `#content` shows the current slide / muted video preview (`#media-wrap`) plus the
coming-next text; `#bottom-bar` shows the presenter message (`stage:message`). The stage video is
always muted and locked to the shared `transport` via `CueMediaPlayer`. The VIDEO countdown derives
remaining time from `transport` + the clip's own duration — it loops with the clip (never shows ∞) and
freezes while paused. The operator live monitor renders a faithful preview of this layout (`StageMonitor`
in `PreviewLivePanel.jsx`) when the selected channel's template is `'stage'` — same proportions and styling
at native 1920×1080, with a live clock and idle timer/video placeholders.

### Operator live monitor — render from payload, not capture
The operator live/preview monitors **do not screen-capture the output window**. `PreviewLivePanel.jsx` `MonitorFrame` renders the slide directly from the same payload sent to outputs — a 1920×1080 virtual canvas scaled with a CSS transform — so it stays pixel-accurate without a capture loop. There is **no `startLiveCapture` and no `output:live-capture` event**; reintroducing a per-frame `capturePage()` loop for the operator UI is the v5→v7 perf regression and must not return. The live monitor updates reactively when `liveItem`/`liveSlideIdx`/`displayMode` change. Foreground-media video is synced via `SyncedVideo` (muted), which follows the shared `transport` using the same wall-clock-derived position + `playbackRate` convergence as the output players (`output:media-transport` → `PreviewLivePanel` local state). This is the **same transport engine used by every audience surface** — there is no separate clock-master time-reporting path anymore.

### NDI frame cache for multiview
`ndiLastFrames` is a `Map<channelId, Buffer>` in `manager.js`. When `multiviewRefCount > 0`, the NDI `paint` event handler additionally downscales and JPEG-encodes each frame into `ndiLastFrames` at ~1fps (timestamp-gated). `runMultiviewCapture()` reads from `ndiLastFrames` to build NDI entries in the `output:multiview-captures` payload without hitting the GPU path.

### Multiview refcounting
`multiviewRefCount` tracks active subscribers. Multiview capture is driven **only by `MultiviewView`** (start on mount, stop on unmount) — the operator workflow never starts it. `startMultiviewCapture()` increments the count and starts the capture interval only when it goes 0→1; `stopMultiviewCapture()` decrements and clears the interval only at 0. The refcount keeps the design safe if multiple subscribers ever coexist, but at idle no capture interval runs.

---

## 14. NDI

**Current state:** Fully implemented. NDI channels publish BGRA frames with alpha transparency over the local network. OBS (and any NDI receiver) picks up the source and composites it natively without chroma keying.

### Package: `grandi`
`grandiose` (the original npm package) could not be compiled on macOS (uses `itoa`, a Windows-only function). `grandi` is an actively maintained fork with prebuilt N-API binaries per platform. Loaded via `createRequire(import.meta.url)` to bypass Vite's CJS bundler (a static ESM import would be converted to `require('grandi')`, which fails because grandi is ESM-only).

### Constants (hardcoded in `ndi.js`)
`grandi`'s TypeScript enums are not exported by the native binary — only by the ESM wrapper, which we cannot import in a CJS bundle:
- `FOURCC_BGRA = 1095911234` — 32-bit BGRA pixel format with alpha
- `FORMAT_TYPE_PROGRESSIVE = 1` — progressive scan

### Frame capture strategy
Offscreen rendering (`offscreen: true` BrowserWindow) + `paint` event + `setInterval(invalidate, frameMs)`:
- `invalidate()` forces Chromium's offscreen compositor to render a new frame at the target rate (without it, the compositor throttles repaints for hidden windows)
- `paint` event delivers the CPU BGRA bitmap directly — no async GPU→CPU readback overhead
- A timestamp gate in `onPaint` prevents burst over-firing if invalidate and content changes coincide
- An `inflight` boolean per sender drops frames when the NDI SDK hasn't completed the previous `sender.video()` call — prevents 8MB buffer queue buildup and crashes

### OBS workflow
1. Settings → Output Channels → create NDI type channel
2. Source appears as `"Cue - <name>"` on the local NDI network
3. OBS → Sources → NDI Source → select the source
4. Alpha is preserved — text composites over camera without chroma keying

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

**Two-row formatting toolbar (`FormattingToolbar`)** — row 1 (always visible): font family, font size, colour swatch, bold, italic, underline, *text* align L/C/R/justify, *text* vertical align T/C/B (within the box), letter spacing, uppercase, reset. Row 2 (template-dependent):
- Fullscreen channels: text box **Fill** (box = content window) + **object-align** buttons (`align_horizontal_*` / `align_vertical_*`, snap the box within the content window via `objAlign('h'|'v', …)`) + manual X/Y/W/H inputs
- Lower-third channels: bar toggle (On/Off), colour swatch, opacity slider, solid/gradient toggle
- `simple` prop (scripture reference target) hides v-align/text-box/bar and adds a Pos Bottom/Free + X/Y control for the reference `pos`

`previewTemplate` prop determines which row 2 is shown. `FormattingToolbar`, `SlidePreview`, `LowerThirdPreview`, `copyrightCss`, `copyrightFontCss`, `renderWithRuns`, `DEFAULT_STYLE`, `styleIsDefault` are **exported** from `SongEditor.jsx` and reused by `ScriptureEditor.jsx` and `PreviewLivePanel.jsx`.

**Run-level styling** — selected text gets bold/italic/underline/colour/font overrides stored as `runs: [{start,end,...}]` in `style_json`. `renderWithRuns(text, runs)` converts to `<span style="...">` HTML.

**Live preview pane** — always-visible `SlidePreview` (fullscreen) or `LowerThirdPreview` (lower-third), rendered at 1920×1080 then CSS-scaled (height-bound 16:9 box so it never overflows the footer). Background picker wired to `songs:setBackground`.

**PowerPoint-style positioning (editor previews)** — a fixed `CONTENT_BOX = {x:5,y:5,w:90,h:90}` "content window" (safe-area guide) is drawn over the background. `style.textBox{x,y,w,h}` is the text box: **drag** the body to move, **8 resize handles** (`TB_HANDLES`, counter-scaled to constant visual size; `resizeBox()` keeps the opposite edge fixed) to resize, anywhere on screen. *Text align* aligns text within the box; *object align* snaps the box within the content window. The reference is draggable too (`onRefPosChange`; converts bottom-anchor → `pos{x,y}` via bounding-rect measurement, no jump). `SlidePreview` props: `onTextBoxChange`, `onRefPosChange`. Output already honours `textBox.h` + `verticalAlign`, so positioning is editor-only — no template changes.

**`ltBar`** — `null` by default (transparent lower-third bar). When set: `{ color, opacity, solid }`. `buildBarBg(ltBar)` computes a `linear-gradient` (default) or `rgba()` solid. Same function duplicated in `SongEditor.jsx`, `PreviewLivePanel.jsx`, and `lowerthird.js`.

**Paste Song parser (`parseSong`)** — pure regex, no API. Detection priority:
1. `[Verse 1]` bracketed labels
2. `Chorus:` keyword + colon alone on line
3. `CHORUS` bare keyword alone on line
No-header fallback: split by blank lines, all → `verse`. The user then relabels.

**Section ordering** — drag-to-reorder via `@dnd-kit`. Each section has a local `_key` for stable React identity. Each section row shows an ordinal badge (`sectionOrdinals(sections)` from `utils/sectionLabels`) next to the type dropdown — "Verse 1 / Verse 2" — recomputed live as sections are added, removed, or reordered; a lone type shows no number.

### Song import (`src/main/import/songs-import.js` + `SongImportModal.jsx`)
File import is a two-phase preview/commit flow: `songs.importParse(filePaths)` parses (no DB write) → `SongImportModal` lets the operator deselect rows and edit titles → `songs.importCommit(rows)` bulk-inserts. The Songs-tab **Import** dropdown offers "Import from File…" and "Import GHS Hymnal".

`parseSongFiles` auto-detects per file (never throws — a bad file is a `{ok:false, error}` row):
- **OpenLyrics XML** — regex parse (no XML dep, matching `bible-import.js`); title/authors/copyright + CCLI from `<properties>`; verse `name` codes (`v`/`c`/`b`/`p`/`e`…) → section types; `<br/>`→newline, chords/comments stripped.
- **ChordPro** — `{title|artist|copyright|ccli}` directives extracted; `{soc}`/`{sov}` markers → section headers; inline `[C]`/`[G7]`/`[D/F#]` chord tokens stripped (real `[Chorus]` headers survive).
- **Plain text** — filename → title; body run through `parseSections` (the shared header/blank-block splitter, same rules as the editor's Paste Song parser).
- **EasyWorship** — picked `Songs.db` (or `SongWords.db`, sibling auto-resolved); both are SQLite read via `better-sqlite3`. Lyrics live in `SongWords.word.words` as **RTF**, joined by `word.song_id = song.rowid`; `rtfToText()` converts (cp1252 `\'xx`, `\u`, ignorable `{\*…}` groups, font/colour tables skipped). Plain `SELECT` only + JS sort — the song table's custom `UTF8_U_CI` collation isn't registered. One `.db` → many rows.

`importSongs` (db/songs.js) is tag-aware: each row's `tags[]` (names) is get-or-created (`_IMPORT_TAG_COLOUR` gives GHS a distinct blue) and assigned. `existingTitleSet()` flags duplicates (default-unselected in the modal).

### GHS hymnal (bundled)
`resources/ghs/ghs-hymnal.json` ships 260 Gospel Hymns & Songs (`scripts/build-ghs.mjs` builds it from a cp1252 number→name CSV + per-number lyric files). On startup `seedGhsHymnal()` imports them once (gated by the `ghs_seeded` setting so deletions stick) and always runs `tagGhsSongs()` — an idempotent backfill that tags every `GHS N …` song with the `GHS` tag. In `LibraryPanel`, the `GHS` tag is the GHS folder; selecting it sorts the list by hymn number and swaps the text search for a numeric quick-search (type a number → that hymn first; Enter previews the exact match).

---

## 17. Scripture Module

### Data + storage
`bible_versions` / `bible_verses` (+ `bible_verses_fts`) from migration v7. Verse text is stored normalized; book numbering/names follow the canonical 66-book Protestant order in `db/bible-books.js` so free-text references resolve across translations. DB layer in `db/bible.js`: `listVersions`, `listBooks`, `listChapters`, `listVerses`, `adjacentVerse` (canonical-order next/prev across chapter/book boundaries), `resolvePassage`, `search`, `importVersion`, `deleteVersion`.

### Bundled translations
**KJV + WEB** (both public domain) ship as normalized seed JSON in `resources/bible/` (built by `scripts/build-bibles.mjs` from getbible.net v2). `seedBundledBibles()` imports any missing bundled version on startup. `forge.config.js` `extraResource: ['./resources/bible']` packages them. ESV/NIV/NKJV etc. are NOT bundled (copyrighted).

### Importing
The Import button (Scriptures rail + Settings → Bible Translations) opens a menu: **Import from File** or **Import from Online** (`OnlineBibleModal`).
- **File** (`db/bible-import.js`): accepts 4 shapes — thiagobodruk book-array JSON, flat verse-list JSON, nested object JSON (`{Book:{chapter:{verse:"text"}}}`, the `meaningless`/BibleGateway shape; "Info" key ignored), and Zefania XML. Abbreviation is derived by `deriveAbbrev(name)` — initials of each word ("King James Version" → "KJV"); single word uppercased whole; parentheticals stripped.
- **Online**: getbible.net v2 catalog with per-version licence; multi-select download. Network + parse in main process (`fetch` + `AbortSignal.timeout`). Download keys off the catalog `abbrev` (the real getbible slug); the stored abbreviation is re-derived from the name. Install/dedupe matched by name. A licence warning + "what's available" note are shown; no version is blocked (operator responsibility).

### Scriptures tab (`ScripturePanel.jsx`)
EasyWorship-style live verse browser, a live source independent of the rundown. Left rail: translation picker (hover-delete per version with inline ✓/✕ confirm) + Import + Appearance. Predictive reference bar auto-focused on open: Book autocompletes → Tab → Chapter → Tab → Verse; Enter sends the selected verse live. Verse list shows the whole loaded chapter; single-click selects (preview only), double-click / Enter / right-click→Send Live sends live; with the list focused ↑/↓ move the selection AND send it live (rolling across chapter/book via `adjacent`). Right-click menu also adds verse/chapter to the rundown. Going live → `OperatorView.handleScriptureLive` → `output.go` + synthetic `liveScripture` item (clears any live rundown item; rundown GO clears `liveScripture`). LIVE marker self-clears via `output:state-changed`.

### Scripture appearance (`ScriptureEditor.jsx`)
Styling counterpart to `SongEditor`, reusing its exported toolbar/preview/helpers. **Verse Text / Reference** target toggle switches what the toolbar edits: verse style (`scripture_style_json`) or reference-line style (`scripture_ref_style_json`, `simple` toolbar mode). Plus default background (`global_bg_scripture_id`). All apply to every verse — text is fixed. Reference renders as `Book c:v (VERSION)`, default right-aligned with symmetric 60px inset, stylable, and free-positionable (`pos{x,y}`, drag or X/Y).

### Reference rendering across surfaces
The reference flows in the payload as `copyright` (text), `copyrightAlign` (`'right'` for scripture), and `copyrightStyle` (the ref style incl. optional `pos`). Applied by `applyCopyrightStyle` in `fullscreen.js`/`lowerthird.js` (lower-third ignores `pos` — the bar owns layout) and `copyrightCss` in the operator monitors (via `slide._refStyle`). The **confidence monitor** (`stage.html` `#current-ref`) shows the reference above the verse in its own legible styling (auto-fit reserves space for it).

---

## 18. Known Gaps and Backlog

| Item | Priority | Notes |
|---|---|---|
| ~~NDI publish~~ | ~~High~~ | Implemented. See §14. |
| `linked_channel_id` logic | Medium | Field exists, settable, never read. Sync lower-third to fullscreen channel. |
| ~~Stage display / confidence monitor~~ | ~~High~~ | Implemented — `stage` template, StagePanel (timer + message), VIDEO countdown. |
| Tag CRUD UI | Medium | Tags can be assigned, but create/rename/delete UI is not in Settings. |
| ~~Song background picker in Song Editor~~ | ~~Medium~~ | Implemented. Media picker in `SlidePreview` calls `songs:setBackground`. |
| ~~Song import~~ | ~~Medium~~ | Implemented — OpenLyrics / ChordPro / text / EasyWorship + bundled GHS hymnal. See §16. |
| ~~Network control API~~ | ~~Medium~~ | Implemented — localhost/LAN HTTP + SSE server, token-gated. Phone control page + Companion HTTP verbs. See §7 `window.cue.remote`, `src/main/remote/`. |
| Disk space warning | Low | Warn when < 2GB free on import. Not implemented. |
| Media unused-asset cleanup | Low | Identify media not referenced by any song or service_item. |
| Drag asset from Library onto rundown item | Medium | Background override currently only via context menu. |
| `operator_preview_layout` setting | Low | Side-by-side monitor layout toggle. Setting key exists, no UI toggle. |

---

## 19. App Startup Sequence

1. `protocol.registerSchemesAsPrivileged` — must be synchronous before app ready
2. `app.whenReady()`:
   a. `protocol.handle('cue-media', ...)` — register media file server
   b. `initDb()` — open SQLite, run pending migrations
   c. `seedBundledBibles()` — import any missing bundled translation (KJV + WEB) from `resources/bible/*.json` (matched by abbrev). Packaged path `process.resourcesPath/bible`; dev path `app.getAppPath()/resources/bible`.
   d. `seedGhsHymnal()` — first run only (gated by `ghs_seeded`): import the bundled GHS hymnal from `resources/ghs/ghs-hymnal.json`; then always `tagGhsSongs()` to backfill the GHS tag. Same packaged/dev path resolution as bibles.
   e. Register all IPC handlers (songs, services, media, output, settings, bible, graphics, themes, remote)
   f. `createMainWindow()` — show operator UI
   g. `remoteServer.configure(...)` + `outputManager.setRemoteStateListener(...)` + `await applyRemoteConfig()` — start the network control server if `remote_enabled`
   h. `outputManager.init()` — load active channels, create BrowserWindows
   i. On `did-finish-load`: send `output:unresolved-channels` and/or `output:ndi-unavailable` if needed. The renderer does not auto-navigate to Settings — the operator opens it manually.

---

## 20. Running the App

```bash
npm start          # dev mode — Vite dev server + Electron, DevTools auto-open
npm run make       # build distributable (.dmg macOS, .exe Windows)
npm run rebuild    # recompile better-sqlite3 after Electron version bump
```

On macOS unsigned builds: `xattr -cr /Applications/Cue.app` to remove quarantine, or right-click → Open.
