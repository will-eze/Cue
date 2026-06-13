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
| `@dnd-kit/utilities` | 3.2.2 | `CSS.Transform` helper for the sortable slide/section lists. |
| `pdfjs-dist` | **4.10.38** | PowerPoint import: rasterises the LibreOffice-converted PDF to per-slide images in the **renderer** (needs a DOM canvas). **Pinned to v4** — v5/v6 call `Promise.try` natively (Chromium 134+), which Electron 30's Chromium ~124 lacks, so the worker throws `Promise.try is not a function` and hangs forever. v4 ships a polyfill guard. Worker loaded via Vite `?worker` + `GlobalWorkerOptions.workerPort` (a `?url` workerSrc silently falls back to a slow main-thread "fake worker"). Bundled into the renderer (not externalized) → no `forge.config.js` change. |
| `tailwindcss` | 3.4.4 | Operator UI styling. |
| `tar` | 6.2.1 | node-tar. Reads/writes the gzipped-tar `.cuebackup` bundle (backup/restore). Externalized in `vite.main.config.js`. |
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
│   ├── output-preload.js     Minimal contextBridge for output windows → window.cueOutput only. Also injects
│   │                         user-installed @font-face rules (fonts:css) into every output window on load.
│   ├── fonts.js              BUNDLED_FONTS array + DEFAULT_FONT. Imported by preload.js.
│   │
│   ├── db/
│   │   ├── schema.js         SQLite init, migration runner (v1→v15), getDb() singleton, closeDb() (releases
│   │   │                     the cue.db handle, checkpointing WAL — used by backup/restore before file swap).
│   │   ├── backup.js         .cuebackup export/import. exportBackup(dest): wal_checkpoint(TRUNCATE) then
│   │   │                     gzip-tar cue.db + media/. importBackup(src): extract to temp, validate staged DB
│   │   │                     (settings+songs tables) before touching live files, swap cue.db + media/, then
│   │   │                     rewrite absolute media_assets.path to the local media dir (portable across machines).
│   │   ├── graphics.js       Broadcast-graphics CRUD (list/get/create/update/del/reorder). style_json + target.
│   │   ├── presentations.js  Presentations CRUD (native multi-element slides) + presentation_templates. get()
│   │   │                     resolves each slide's image-element mediaIds → paths. collectImageMediaIds(elements_json)
│   │   │                     is exported for services.js + media.findUnused (image refs live inside elements_json).
│   │   ├── themes.js         Theme library CRUD (list/get/create/update/del). applyToSong/applyToRundown/
│   │   │                     applyToAllSongs merge the theme style_json into song_sections (preserving inline
│   │   │                     text runs) and, when the theme has a background + setBg, write songs.default_background_id
│   │   │                     and NULL out per-slot service_items.background_override_id so the theme bg wins.
│   │   ├── songs.js          Song + section + tag CRUD, FTS5 search. importSongs (bulk insert, tag-aware:
│   │   │                     song.tags[] get-or-created + assigned). existingTitleSet (duplicate flagging).
│   │   │                     GHS hymnal: readBundledGhsRows, seedGhsHymnal (once, ghs_seeded flag),
│   │   │                     tagGhsSongs (idempotent backfill of the GHS tag onto "GHS N …" songs).
│   │   ├── services.js       Service / rundown CRUD. resolveItem() joins media paths.
│   │   ├── media.js          Media import (copy to userData/media/), list, delete, folders. deleteAllMedia()
│   │   │                     wipes every asset + folder + file and resets the global media settings keys (Danger Zone).
│   │   ├── settings.js       Key-value settings store. Global logo/background helpers (song/scripture/slide).
│   │   ├── fonts.js          User-installed fonts: copy file → userData/fonts/<uuid>.<ext>, metadata in the
│   │   │                     `user_fonts` settings key. importFont/deleteFont/listUserFonts; buildUserFontCss()
│   │   │                     emits @font-face rules (served via cue-media://) for the operator + output windows.
│   │   ├── bible.js          Version + verse queries (books/chapters/verses/adjacent/search/resolve). importVersion,
│   │   │                     deleteVersion, seedBundledBibles, getbible online catalog (listOnlineVersions/downloadOnlineVersion).
│   │   ├── bible-import.js   Parsers: book-array / flat / nested-object JSON + Zefania XML. deriveAbbrev (word initials).
│   │   └── bible-books.js    Canonical 66-book order + abbreviation lookup (lookupBook).
│   │
│   ├── import/
│   │   ├── songs-import.js   Song-file parsers (pure, preview-before-commit). parseSongFiles(filePaths)
│   │   │                     auto-detects per file: OpenLyrics XML (regex), ChordPro ({directives} +
│   │   │                     [chord] stripping), plain text (filename → title), EasyWorship (SQLite
│   │   │                     Songs.db + SongWords.db join, RTF→text via rtfToText, one file → many rows).
│   │   │                     parseGhsItems(items) → "GHS N - Name" rows tagged GHS. Shared parseSections
│   │   │                     (header / blank-block splitter, mirrors SongEditor's Paste Song parser).
│   │   └── pptx-import.js    PowerPoint import (main side). findLibreOffice/detectLibreOffice (known per-OS soffice
│   │                         paths + `libreoffice_path` setting + PATH; reports version for the UI check button).
│   │                         convertPptxToPdf(filePath): a .pdf passes straight through (no LibreOffice → pixel-perfect);
│   │                         a .ppt/.pptx runs `soffice --headless --convert-to pdf` in an isolated -env:UserInstallation
│   │                         profile (avoids the "instance already open" lock) and returns the PDF bytes.
│   │
│   ├── ipc/
│   │   ├── songs.ipc.js      Registers songs:*, tags:* handlers (incl. importParse/importGhs/importCommit).
│   │   ├── services.ipc.js   Registers services:* handlers.
│   │   ├── media.ipc.js      Registers media:* handlers.
│   │   ├── output.ipc.js     Registers output:* handlers (incl. graphic/ticker/overlay + channel show_program/
│   │   │                     show_graphics; content-mode-only channel updates route to setChannelContentMode).
│   │   ├── graphics.ipc.js   Registers graphics:* CRUD handlers (registerGraphicsIpc).
│   │   ├── themes.ipc.js     Registers themes:* CRUD + apply handlers (registerThemesIpc).
│   │   ├── presentations.ipc.js  Registers presentations:* + presentationTemplates:* CRUD, the PowerPoint pipeline
│   │   │                     (detectLibreOffice/setLibreOfficePath/convertPptx, and createFromImages: persist each
│   │   │                     rasterised PNG via media.importBuffer → build an image-element presentation), and app:openExternal.
│   │   ├── settings.ipc.js   Registers settings:* handlers (incl. exportBackup/importBackup + factoryReset:
│   │   │                     close DB, delete cue.db + media/ + fonts/, relaunch as a fresh install).
│   │   ├── fonts.ipc.js      Registers fonts:* handlers (listUser/css/import [native multi-file picker]/delete).
│   │   ├── bible.ipc.js      Registers bible:* handlers (versions/books/chapters/verses/adjacent/resolve/search/importFile/delete/online:*).
│   │   ├── youtube.ipc.js    Registers youtube:* handlers (prefetch/status/cancel/detect). Wires the downloader's
│   │   │                     status listener → broadcasts youtube:status to every window.
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
│   ├── youtube/
│   │   ├── bin.js             yt-dlp + ffmpeg resolver + auto-downloader (NOT bundled). Resolves userData/bin →
│   │   │                     PATH → dev-only resources/bin; ensureBinaries() downloads missing ones into userData/bin
│   │   │                     on first use (streamed, progress); refreshYtDlp() re-fetches latest on extractor failure.
│   │   └── downloader.js      Ephemeral YouTube resolver. parseVideoId; prefetch(url) (resolve metadata → download
│   │                         with faststart + concurrent-fragments → ready); in-memory entries Map keyed by video id;
│   │                         getStatus/getReadyPath/cancel; wipeCache() (quit + startup). Emits youtube:status.
│   │
│   └── output/
│       ├── manager.js        Output window registry. go/clear/logo dispatch. No operator capture loop —
│       │                     the operator live monitor renders from payload, not capturePage.
│       │                     Owns the foreground-media `transport` { active, startAt, pausedAt, loop, muted, rate }
│       │                     (machine-clock based). go() stamps it; mediaControl/mediaSeek/mediaSetMuted/mediaSetRate
│       │                     mutate it (setRate rebases startAt so position is continuous);
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
│   │   │                     Bible/Tags/Media/Shortcuts/Remote/Data/Danger) + Back-to-Operator: click scrolls to the section; an
│   │   │                     IntersectionObserver highlights the section in view. Section order: OutputChannels →
│   │   │                     LogoSettings → BackgroundSettings → ThemeSettings → BibleSettings → TagSettings → MediaCleanup →
│   │   │                     ShortcutSettings → RemoteSettings → DataSettings → DangerZone → SettingsFooter (always last two,
│   │   │                     rendered at layout level — not inside any sub-component).
│   │   └── MultiviewView.jsx Multi-output monitor wall — one uniform responsive grid of equal tiles (every
│   │                         screen monitor, every NDI channel, and a placeholder tile per screen channel with no
│   │                         monitors). Each tile carries a ChannelChip header (name + NDI/template/active badges).
│   │                         Subscribes to output:multiview-captures. NDI channels show NdiTile (checkerboard + frame).
│   │
│   ├── panels/
│   │   ├── RundownPanel.jsx       Service selector with inline rename/delete UI (no native confirm dialogs).
│   │   │                          DnD-sortable item list. Context menu.
│   │   │                          Song items show their tags as coloured chips on the sublabel line (next to "Song", max 3).
│   │   │                          Editing a song fires onSongEdited (in addition to onRefresh) so the library reloads.
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
│   │   │                          Song search + tag filter (left-panel folders = tags). Clicking a tag SWITCHES to it
│   │   │                          (single-select; clicking the lone active tag clears); Shift-click adds/removes for
│   │   │                          multi-select (AND semantics). Media import.
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
│   │   │                          Tags row is always shown: toggles existing tags + a "+ New" inline input that creates a tag
│   │   │                          (tags.create, auto palette colour) and auto-selects it — no need to visit Settings.
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
│   │   ├── PresentationEditor.jsx Full-screen presentation editor (createPortal). Slide sidebar (DnD reorder, built-in
│   │   │                          LAYOUTS: Blank/Title/Title+Subtitle/Title+Body/Section). Element canvas — a fixed
│   │   │                          1920×1080 stage scaled by transform (WYSIWYG with the live output); elements drag/
│   │   │                          resize (handles + outline counter-scaled by 1/scale). Add Text/Image/Shape; per-element
│   │   │                          inspector (text reuses SongEditor's FormattingToolbar in `simple` mode + a v-align +
│   │   │                          textarea; shape fill/stroke/radius; geometry + arrange). Header: draggable titlebar strip
│   │   │                          (titlebar-drag, clears the macOS traffic lights) with nodrag Cancel/Save; title input below.
│   │   ├── PptxImportModal.jsx    PowerPoint import flow (createPortal). Gates on a LibreOffice check (checking → missing
│   │   │                          nudge with Download/Check-again/Locate-manually | ready) so it never spawns a missing
│   │   │                          binary. Picks .pptx/.ppt/.pdf (split filters + All Files for the macOS UTI greying);
│   │   │                          convertPptx → rasterizePdf (per-slide progress) → createFromImages. PDF imports skip
│   │   │                          LibreOffice (pixel-perfect; offered even in the missing state).
│   │   ├── AddYouTubeModal.jsx    Paste-a-URL modal (Media tab). Speculative prefetch on paste; Confirm adds the cue
│   │   │                          (if the URL was edited, abandons the speculative download); shows live youtube:status.
│   │   ├── MediaPickerModal.jsx   Media grid picker. Used by RundownPanel for bg override.
│   │   ├── MediaThumb.jsx         Cached thumbnail tile (cue-thumb:// + error fallback). Used by every media grid/list.
│   │   ├── SlideList.jsx          Scrollable slide/section list. Preview and live variants.
│   │   │                          Slide content capped at max-h-24 to prevent runaway tall cards.
│   │   │                          Section labels via utils/sectionLabels (numbered: Verse 1 / Verse 2, abbrev forms).
│   │   │                          Presentation slides label by slide.label/"Slide N"; content preview = first text element.
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
│   │   ├── TagSettings.jsx       Tag CRUD: create (name + preset colour palette), inline rename, recolour, delete
│   │   │                          (two-step confirm — removes the tag from every song). Shows per-tag song_count.
│   │   ├── MediaCleanup.jsx      Unused-media report. "Scan" (media.findUnused) → thumbnail grid (all pre-selected),
│   │   │                          per-item checkboxes, select/deselect-all, "N selected · X reclaimable" tally,
│   │   │                          two-step destructive Delete Selected (media.deleteMany). Re-scans after deleting.
│   │   ├── DangerZone.jsx        Destructive actions: clear rundown items, delete rundown, clear library,
│   │   │                          clear media library (media.deleteAll), and a separate emphasised "Reset app
│   │   │                          to defaults" card (settings.factoryReset → wipe + relaunch). Two-step confirm
│   │   │                          on every action. Success toast feedback.
│   │   ├── FontSettings.jsx      Settings → Fonts. Install custom fonts (fonts.import, native picker; .woff2/
│   │   │                          .woff/.ttf/.otf), per-font live preview + remove (fonts.delete), and a read-only
│   │   │                          list of the built-in families. Refreshes the @font-face injection after changes.
│   │   ├── ShortcutSettings.jsx  Configurable keyboard shortcuts UI. Modifier selector (Cmd/Ctrl/Alt)
│   │                              + key inputs for GO, Clear, Logo, Live Toggle. Saves to settings DB.
│   │                              Shortcuts reload in OperatorView on next bgRefreshTick.
│   │   ├── RemoteSettings.jsx    Network control card. Enable toggle, port, Allow-LAN toggle, pairing token
│   │   │                          (copy/regenerate), phone URL, and the HTTP API reference. Drives remote:setConfig.
│   │   └── DataSettings.jsx      Backup/restore card. Export button (settings.exportBackup) + confirm-gated
│   │                              Restore (settings.importBackup, "Overwrite all?" → "Choose file"; app relaunches
│   │                              on success). Shows current media disk usage. Toast feedback.
│   │
│   └── utils/
│       ├── mediaUrl.js           mediaUrl(absPath) → cue-media://localhost/encoded/path
│       ├── fonts.js              useFonts() hook → merged [bundled…, user…] font list for the editors (user fonts
│       │                         load async, grouped as category 'custom'). injectUserFontFaces() injects the user
│       │                         @font-face <style> into the operator document (called on app start + after import).
│       ├── channelMode.js        Lower-third content-mode helpers: CHANNEL_MODES, channelMode(ch),
│       │                         modeToFlags(mode) ({show_program, show_graphics}). Shared by Settings + Graphics panel.
│       ├── pdfRaster.js          rasterizePdf(bytes, targetWidth=2560, onProgress) → [PNG Uint8Array] per page (pdfjs,
│       │                         fresh ?worker per call → workerPort; lossless PNG for crisp text). Used by PptxImportModal.
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
│   ├── fullscreen.html       #background + #content (#text-wrap > #text, #slide-elements, #logo-wrap, #copyright). + graphics-overlay.js.
│   ├── fullscreen.css        Fullscreen output styles. #text-wrap is absolutely positioned by JS. #slide-elements is a
│   │                         fixed 1920×1080 presentation-element layer scaled to the viewport. #logo-wrap is a separate sibling.
│   ├── fullscreen.js         applyStyle(s): positions #text-wrap via textBox %, applies all style props to #text.
│   │                         showLogo/hideLogo use #logo-wrap. Supports: verticalAlign, letterSpacing,
│   │                         uppercase, textShadow (buildShadow), textStroke, textBox, underline in runs.
│   │                         Detects ?alpha=1 (IS_NDI) → transparent background; ?mute=1 (MUTE_AUDIO) → base mute.
│   │                         Foreground media via CueMediaPlayer.attach (single element, native loop). No clock-master
│   │                         time reporting, no dual-element loop swap. renderElements(payload.elements): a presentation
│   │                         slide — absolutely-positioned text/image/shape elements (% of the scaled 1920×1080 #slide-elements).
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
- `forge.config.js` — Electron Forge packaging config. `extraResource` for bundled bibles/hymnal; a `packageAfterPrune` hook copies native externals (+ closure) and the plain-DOM `src/output`/`src/fonts` into the package (see §20); `asar.unpack` keeps native modules on the real filesystem.
- `index.html` — Vite renderer entry HTML

**Project-root data/tooling (outside `src/`):**
- `resources/bible/{kjv,web}.json` — bundled public-domain translations (seeded on first run; shipped via `extraResource`)
- `resources/ghs/ghs-hymnal.json` — bundled GHS hymnal seed `{ items:[{ number, name, lyrics }] }` (260 hymns; shipped via `extraResource`, seeded on first run by seedGhsHymnal)
- `resources/bin/<platform>-<arch>/` — **dev-only** local `yt-dlp` + `ffmpeg` (gitignored, never shipped). A dev checkout can drop binaries here so `npm start` uses them instead of triggering the first-use auto-download; packaged builds always auto-download into `userData/bin` (see §6 *Native YouTube player*)
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

`schema.js` creates `db_version` table (single integer row) on first run and applies pending migrations in order inside a transaction. **Never delete `db_version`** — it is required to exist before any user-facing build. Current version: **21**. Migrations run with foreign keys disabled, so table-rebuild migrations (v6, v7, v11, v16, v20, v21) do not cascade-delete referencing rows.

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
| v16 | Rebuilt `graphics` to add the `countdown` kind (table-rebuild — CHECK can't be altered in place) — self-ticking countdown/count-up/clock |
| v17 | Added `service_items.advance_seconds` (INTEGER) — per-item auto-advance interval |
| v18 | Added `service_items.advance_loop` (TEXT) — `'rundown'` (default) vs `'item'` at the item's last slide |
| v19 | Added `service_items.advance_wrap` (INTEGER, default 1) — rundown mode: wrap to first item at the end vs stop |
| v20 | Presentations: created `presentations`, `presentation_slides`, `presentation_templates`; rebuilt `service_items` to add `'presentation'` to the `item_type` CHECK (v7-pattern table rebuild) |
| v21 | Native YouTube player: rebuilt `service_items` to add `'youtube'` to the `item_type` CHECK (v7-pattern table rebuild). A YouTube cue stores its URL in `content`, `ref_id` NULL — the downloaded file is ephemeral (never `media_assets`); see §6 *Native YouTube player* |

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
item_type TEXT NOT NULL CHECK(item_type IN ('song','media','slide','scripture','presentation','youtube'))  -- 'scripture' v7, 'presentation' v20, 'youtube' v21
ref_id INTEGER               -- song id, media_asset id, or null for custom slides / youtube
order_index INTEGER NOT NULL
notes TEXT
content TEXT                 -- for item_type='slide': JSON {text, ...} or plain text; for 'youtube': the URL (file is ephemeral, see §6)
background_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
media_loop INTEGER NOT NULL DEFAULT 0   -- v8: loop this media item's video/audio
advance_seconds INTEGER                 -- v17: auto-advance interval; NULL = manual
advance_loop TEXT                        -- v18: 'rundown' (default) | 'item' — what to do at the item's last slide
advance_wrap INTEGER NOT NULL DEFAULT 1  -- v19: rundown mode — wrap to first item at the end (1) vs stop (0)
```

**Auto-advance / timed loops** (v17–v19): when an item is live and `advance_seconds` is set, `OperatorView` schedules a single timer per live slide that fires `handleAutoAdvance`. `advance_loop='item'` rotates the item's own slides forever (bouncing back to slide 0; single-slide items just re-fire to restart media/countdown timers). `advance_loop='rundown'` (default) steps into the next rundown item, and at the very end either wraps to the first item (`advance_wrap=1`) or stops on the last slide (`advance_wrap=0`). Scheduling lives entirely in the renderer — the main process never resolves the next slide.

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

#### `graphics` (v10–v12, v16 — broadcast graphics)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
kind TEXT NOT NULL CHECK(kind IN ('lower_third','ticker','custom','countdown'))
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

`style_json` shape — **lower_third**: `{ name: <style incl. textBox + ltBar>, title: <style> }` (the `name` style's `textBox` is the draggable/resizable position box, `ltBar` is the bar background). **ticker**: a flat style + `{ bar:{color,opacity}|null, position:'bottom'|'top' }`. **custom**: `null` (raw HTML). **countdown** (v16): `{ mode:'countdown'|'countup'|'clock', source:'duration'|'target', durationSec, targetClock:'HH:MM', format:'24h'|'12h', showSeconds, endMessage, time:<style incl. textBox + ltBar>, message:<style> }` — the `text` column holds the optional label ("Service starts in").

#### `themes` (v15 — theme / template library)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
style_json TEXT                -- a section style snapshot (same shape as §8; no runs)
background_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
created_at DATETIME, updated_at DATETIME
```

A theme is a saved section `style_json` (§8 shape) plus an optional default background. Applying a theme merges its `style_json` into every target `song_sections.style_json` (per-section inline `runs` are preserved) and, when it has a background and the background is being applied, writes `songs.default_background_id` and NULLs the relevant `service_items.background_override_id` so the theme background wins over any per-slot override. Apply scope: `applyToSong` (all slots referencing one song), `applyToRundown` (all song slots in a rundown), `applyToAllSongs` (every song slot). The output path is unchanged — themes only write the same columns the editors already write.

#### `presentations` / `presentation_slides` / `presentation_templates` (v20)
```sql
-- presentations:  id, title, created_at, updated_at
-- presentation_slides:  id, presentation_id→presentations(ON DELETE CASCADE), order_index,
--                       label, background_id→media_assets(ON DELETE SET NULL), elements_json, notes
-- presentation_templates:  id, name, background_id→media_assets(ON DELETE SET NULL), elements_json, created_at, updated_at
```

A presentation is an ordered list of slides; each slide's `elements_json` is an array of positioned elements on the 1920×1080 canvas (see §21 for the element shape). Templates are reusable saved slide layouts. **Image elements store a `mediaId`, never a path** — paths are resolved on read (`db/presentations.js`), so `elements_json` carries nothing machine-specific (backup/restore-safe). Because those ids live inside `elements_json` (not an FK column), `media.findUnused()` parses every slide/template `elements_json` to collect them, plus `presentation_slides.background_id` and `presentation_templates.background_id`. A presentation deck drops into the rundown as an `item_type='presentation'` service item and inherits every existing control.

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
| `user_fonts` | array | User-installed fonts: `[{id, family, label, filename, path, ext}]`. Files live in `userData/fonts/`; served via cue-media://. Included in backups (paths rewritten on restore), wiped by factory reset |
| `libreoffice_path` | string\|null | User-set absolute path to the `soffice` binary (Locate manually…), tried first by `findLibreOffice()` for PowerPoint import |

**localStorage keys** (UI state only — not in DB):
| Key | Description |
|---|---|
| `layout_h_pct` | Horizontal split: Rundown panel width as % (default 25) |
| `layout_v_pct` | Vertical split: top panels height as % (default 62) |

#### `db_version`
```sql
version INTEGER NOT NULL       -- current: 20
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
- Supports HTTP range requests (for video seeking), serving a `206` with `Content-Range`
- **Bodies are streamed, never buffered.** Both the ranged (`206`) and full responses are `fs.createReadStream(...)` piped through `Readable.toWeb(stream)`. A `<video>` opens playback with an open-ended `bytes=0-`; reading that into a single `Buffer` froze the main process and spiked memory on multi-GB clips (a one-hour YouTube download), and a fixed-size chunk cap starved the player of the multi-MB `moov` index so the clip only looped its first few seconds. A lazy stream serves any range with bounded memory and lets Chromium read/seek/cancel freely — it cancels the open-ended request and re-asks for specific windows, so the whole file is never read.
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

### Native YouTube player (ephemeral video)

A pasted YouTube URL is resolved by **yt-dlp** into a local video file, which then flows through the *identical* path as any media asset — the single machine-clock transport, `cue-media://`, NDI paint capture, and every operator control — giving a clean, full-screen, frame-synced feed with full controls. An iframe could not (branding/end-screens, independent per-window players drift, no NDI capture path).

**Single-use / ephemeral.** A YouTube cue is a `service_items` row with `item_type='youtube'` and the URL in `content` (`ref_id` is NULL — it is **never** a `media_assets` row). The downloaded file lives in `userData/yt-cache/<videoId>.mp4`, tracked only in-memory by `src/main/youtube/downloader.js`. Nothing survives a session: the cache is wiped on quit and on startup (crash recovery, `youtube.wipeCache()`), the cues are purged on startup (`services.purgeYoutubeItems()`), and per-clip files are removed on cue removal (`youtube.cancel`). Because it is not a `media_assets` row, it is automatically excluded from backups and `media.findUnused()`.

**Binaries — auto-downloaded, not bundled.** `yt-dlp` + `ffmpeg` are *not* shipped in the installer (bundling ~85 MB per platform bloats the download and, worse, `yt-dlp` goes stale — YouTube breaks extractors every few weeks and a baked-in copy can't be updated). `src/main/youtube/bin.js` resolves each binary in order: `userData/bin` (auto-downloaded, kept fresh) → system PATH (power users) → a dev-only `resources/bin/<platform>-<arch>` copy that exists only in a checkout, never in a packaged build. If none has it, `ensureBinaries()` downloads the current platform's pair into `userData/bin` on first use (single-flight, ~85 MB once; `fetch` → streamed write → chmod → atomic rename, with 0–1 progress). `refreshYtDlp()` re-downloads the latest `yt-dlp` (throttled 10 min) when a download fails with an extractor-style error (`looksLikeExtractorFailure`), then retries once. Sources: `yt-dlp` from its GitHub `latest` release (`yt-dlp_macos` universal / `yt-dlp.exe`); `ffmpeg` pinned to the `eugeneware/ffmpeg-static` b6.0 release per arch.

**Download command** (`downloader.js`): format `bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/...` (prefer h264 ≤1080p for hardware decode, avoid 4K-AV1 software-decode stutter in the offscreen NDI window), `--merge-output-format mp4 --remux-video mp4`, `--concurrent-fragments 5` (parallel DASH fragments — faster, no quality loss), and `--postprocessor-args "ffmpeg:-movflags +faststart"` (moov atom at front; without it a long clip black-screens on go-live while the player fetches the tail index).

**Pre-fetch / status flow.** Latency is hidden by pre-fetching: the download starts the moment a valid URL is pasted (speculatively, before Confirm — `AddYouTubeModal.jsx`). If the URL is edited before Confirm, the speculative download is abandoned and the submitted URL fetched. Status is `setup (first-use binary download) → resolving → downloading (percent) → processing → ready | error`, pushed live to all windows over the `youtube:status` event and surfaced as a rundown badge (`RundownPanel`) and in the modal (with a Retry on error). `services.resolveItems` attaches the current status as `item.youtube`; `OperatorView` patches it live from the event and re-prefetches any `idle` cue on load. GO is soft-blocked until `ready` (`buildPayload` returns null otherwise), then resolves the ready path into a normal full-screen media payload (`{ media: { path, type:'video', loop } }`).

### Thumbnails — the `cue-thumb://` protocol

Media grids/lists never load the full-resolution original (an 8 MB photo decoded into a 100px tile is what made the Media tab slow). They use a second privileged protocol, registered alongside `cue-media` before `app.whenReady()`:

```js
{ scheme: 'cue-thumb', privileges: { secure: true, standard: true,
  supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }
```

The handler (`main/index.js`):
- Resolves the absolute source path (same Windows drive-letter stripping as `cue-media`).
- Cache path = `userData/thumbnails/<sha1(srcPath)>.jpg` (`media.thumbCachePath`). Serves the cached JPEG if present.
- Otherwise generates one with `nativeImage.createThumbnailFromPath(src, { width: 480, height: 480 })` — the OS thumbnail service (QuickLook on macOS, the shell thumbnail handler on Windows), so it posters **videos as well as images**, is async, and needs no extra dependency — then `.toJPEG(72)`, writes the cache fire-and-forget, and serves it.
- Fallback: if generation fails and the source is an image extension, serve the original bytes (so the tile still renders); for a non-image (e.g. a video codec the OS can't thumbnail) return 404 so the renderer shows its placeholder instead of feeding video bytes to an `<img>`.

The thumbnail cache is **pure derived data**: keyed by source path, regenerated on demand. It is therefore *not* a media reference (excluded from `media.findUnused`), *not* in backups, and is cleared alongside the assets it mirrors — `media.del()` removes the asset's thumb, `media.deleteAllMedia()` empties `userData/thumbnails`.

**Renderer usage:** `thumbUrl(absPath)` in `mediaUrl.js` builds the URL; the `<MediaThumb path={…} />` component (`components/MediaThumb.jsx`) renders it as an `<img>` with an error-fallback icon and is used by every grid/list tile (LibraryPanel media grid, MediaPickerModal, MediaCleanup, RundownPanel item thumb). Keep `mediaUrl()` for live output, full-size previews, and playing video.

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
| `list()` | `[{id, name, colour, song_count}]` — `song_count` is the number of songs carrying the tag (subquery over `taggables`). |
| `create({name, colour})` | `id` |
| `update(id, {name, colour})` | void |
| `delete(id)` | void — cascades to `taggables` (removes the tag from every song). |

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
| `setItemAdvance(itemId, seconds, loop, wrap)` | void | Auto-advance config. `seconds>0` sets the interval (falsy clears it → manual, and NULLs `advance_loop`); `loop` = `'item'`\|`'rundown'`; `wrap` (bool, rundown mode) wraps to the first item at the end vs stops. |
| `duplicateItem(itemId)` | `id` | Appends copy at end of rundown (carries advance config). |
| `clearItems(serviceId)` | void | Removes all items from a rundown; keeps the service row. Used by Danger Zone. |
| `applyBackgroundToRundown(serviceId, mediaId)` | `count` | Sets background_override_id on every song slot AND updates each song's default_background_id. |

**`resolveItem()` shape** — what `services:get` returns per item:
```js
{
  // All service_items columns (id, service_id, item_type, ref_id, order_index, notes, content, background_override_id)
  song: { id, title, author, copyright, default_background_id,
          tags: [{ id, name, colour }],   // rendered as chips on the rundown sublabel line
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
| `getState()` | `{isLive, livePayload, activeChannels:[ids], activeWindows, outputsEnabled, displayMode, transport, overlay}` | `transport` = media snapshot; `overlay` = `{nameTitle, ticker, custom, countdown}`. |
| `media.control(action)` | void | `action` ∈ `'play' \| 'pause' \| 'restart'` — mutates the transport, broadcast to all surfaces. |
| `media.seek(pos)` | void | Scrub foreground media to `pos` seconds (preserves paused state). |
| `media.setMuted(muted)` | void | Toggle program (audience) audio. Stage + operator preview stay silent regardless. |
| `media.setRate(rate)` | void | Operator playback speed (e.g. 0.25–2). Rebases `startAt` so position is continuous; becomes the baseline the ±6% convergence nudge multiplies around. |
| `graphic.show({name,title,style,target})` | void | Show the name/title lower-third bug. `target` ∈ `'all'\|'screen'\|'ndi'`. |
| `graphic.hide()` | void | Hide the name/title bug. |
| `graphic.showCustom({html,target})` | void | Show a custom-HTML graphic (placeholders already substituted). |
| `graphic.hideCustom()` | void | Hide the custom graphic. |
| `ticker.show({text,speed,style,target})` | void | Show the scrolling ticker. |
| `ticker.hide()` | void | Hide the ticker. |
| `countdown.show({id,mode,source,durationSec,targetClock,format,showSeconds,label,endMessage,style,target})` | void | Show a self-ticking countdown/count-up/clock. Main resolves the anchor (`endsAt` for `mode:'countdown'`, `startAt` for `'countup'`); the output template owns the per-second tick. `style` = `{time, message}`. |
| `countdown.hide()` | void | Hide the countdown/clock. |
| `overlay.get()` | `{nameTitle, ticker, custom, countdown}` | Current overlay snapshot. |
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
  elements: [ ...presentationElements ] | undefined,  // presentation slide — multi-element canvas (see §21)
}
```

A presentation-slide payload carries `elements` (and a per-slide `backgroundPath`); `text`/`styleJson` are null. `fullscreen.js` `renderElements()` renders it on the scaled 1920×1080 `#slide-elements` layer; `lowerthird.js` blanks its band for `payload.elements` (a full-canvas item has no lower-third in v1). The operator monitor renders the same array via `PreviewLivePanel`'s `PresentationCanvas`. `manager.go()` is payload-opaque — it stamps the transport and forwards the payload unchanged, so the element array needed no transport changes.

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
HTML, countdown/clock) separate from the program slide bus. Held in `manager.js` as `overlay = {
nameTitle, ticker, custom, countdown }`; each slot carries a `target` (`'all'|'screen'|'ndi'`).
`broadcastGraphic()` sends a per-window FILTERED `graphic:update` to **every non-stage output window**
(fullscreen + lower-third, matched by URL in `getGraphicsWindowInfos`) — a window only receives the
slots whose target matches its kind (numeric map key = screen/in-room, `ndi-*` = online) — and notifies
the renderer via `output:overlay-changed`. Rendered by the shared `src/output/graphics-overlay.js`
(injects its own DOM + styles, honours `?graphics=0` and `content:mode`). A program `go`/`clear`/`logo`
never touches the overlay, and a graphic never touches the program. Default destination for new graphics
is **Online (NDI)**.

**Countdown / clock graphic** (v16) — a `countdown` slot is a self-ticking timer the **output template
owns**: `countdownShow` resolves the anchor in the main process (duration → `endsAt = now + durationSec`;
target-time → next occurrence of `HH:MM`; count-up → `startAt = now`; clock → no anchor) and the bus
carries only that absolute timestamp + config. `graphics-overlay.js` runs a single `setInterval(…, 250ms)`
that recomputes the digits from the anchor and `Date.now()`, so a window opened mid-countdown lands on the
right value, the operator never streams per-second updates, and the countdown self-stops its interval at
zero (showing `endMessage`). The clock editor (GraphicsEditor `countdown` kind) authors mode, duration/
target/format, label + end message, the draggable time box (`time.textBox`/`ltBar`) and label styling.

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
| `deleteMany(ids)` | `number` | Bulk-delete (rows + files); returns count removed. Used by the unused-media cleanup. |
| `deleteAll()` | `number` | Wipes the whole media library (rows + folders + files) and resets the global media settings keys. Returns assets removed. Danger Zone "Clear media library". |
| `findUnused()` | `[media_asset & {size_bytes}]` | Media referenced by nothing — not a song `default_background_id`, `service_items.background_override_id`, `output_channels.logo_override_id`, `themes.background_id`, nor a media-bearing `settings` key (`global_logo_id`, `global_bg_*_id`). Settings store ids as JSON-encoded ints, collected separately from the FK columns. Each row is stat'd for `size_bytes`. |
| `getDiskUsage()` | `number` | Total bytes in userData/media/. |
| `getMediaDir()` | `string` | Absolute path to userData/media/. |
| `folders.create(name, parentId?)` | `id` | — |
| `folders.rename(id, name)` | void | — |
| `folders.delete(id)` | void | Moves folder contents to root. |
| `folders.tree()` | `[{id, name, parent_id, children:[...]}]` | Recursive tree. |

### `window.cue.youtube`

| Method | Returns | Notes |
|---|---|---|
| `prefetch(url)` | `status snapshot` | Start (or reuse) an ephemeral download. Idempotent per video id, so the speculative paste-time call and the Confirm-time call never double-download. Resolves on completion but callers usually fire-and-forget and watch the `youtube:status` stream. |
| `status(url)` | `status snapshot \| null` | `{ id, url, status, percent, title, durationMs, path, error }`; `status` ∈ `resolving \| downloading \| processing \| ready \| error`. |
| `cancel(url)` | void | Abandon the download (kill the child) and delete its bytes. Fired on an edited paste and on cue removal. |
| `detect()` | `{ ytDlp, ffmpeg }` | Health check — absolute path of each bundled binary, or null if missing. |

The downloaded file is **ephemeral** — never a `media_assets` row (see §6 *Native YouTube player*).

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
| `exportBackup()` | No args — shows a native save dialog (`Cue <date>.cuebackup`), then writes a gzipped tar of `cue.db` + `media/`. Returns `{ok, path, size}` or `{ok:false, canceled}`. |
| `importBackup()` | No args — shows an open dialog, validates the archive, swaps `cue.db` + `media/` + `fonts/` on disk (media + user-font paths rewritten to this install), then relaunches the app (~400ms after the IPC reply). Returns `{ok}`, `{ok:false, canceled}`, or `{ok:false, error}` (validation/extract failure leaves the install untouched). |
| `factoryReset()` | No args — closes the DB, deletes `cue.db` (+wal/shm), `media/` and `fonts/`, then relaunches as a fresh install (DB + bibles + GHS re-seed on boot). Returns `{ok:true}`. Danger Zone "Reset app to defaults". |

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

### `window.cue.presentations`

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[{...presentation, slide_count}]` | Ordered by `updated_at` DESC. |
| `get(id)` | `{...presentation, slides:[{id,label,background_id,background_path,notes,elements}]}` | Image-element `mediaId`s resolved to `path`/`mediaType`. |
| `create(data)` | `id` | `data = {title, slides:[{label, background_id, elements}]}`; defaults to one blank slide. |
| `update(id, data)` | void | Slides rebuild (replaces all — mirrors `songs.update`). |
| `delete(id)` | void | Also removes any `presentation` service items referencing it. |
| `reorderSlides(id, orderedIds)` | void | — |
| `templates.{list,get,create,delete}` | — | Reusable slide layouts (`presentation_templates`). |
| `detectLibreOffice()` | `{found, path?, version?}` | UI "check before import" — never spawns a missing binary. |
| `setLibreOfficePath(p)` | `{found, ...}` | Persists `libreoffice_path` and re-detects (Locate manually…). |
| `convertPptx(filePath)` | `{ok, pdf:Uint8Array, name}` \| `{ok:false, error}` | `.pdf` passes through (no LibreOffice); `.ppt/.pptx` → soffice → PDF bytes. `error:'not_found'` = LibreOffice missing. |
| `createFromImages(title, buffers)` | `{id, slideCount}` | Persists each rasterised PNG (`media.importBuffer`) → a presentation whose slides each hold one full-bleed image element. |

`window.cue.openExternal(url)` opens an https URL in the default browser (LibreOffice download link).

### `window.cue.dialog`
- `openFile(options)` → `{canceled, filePaths}` — wraps `dialog.showOpenDialog`.

### `window.cue.fonts`
- `fonts.list` — synchronous: `[{family, label, category, bundled?}]` from `BUNDLED_FONTS` (6 shipped faces + ~22 cross-platform system fonts as fallback stacks)
- `fonts.default` — synchronous: `'Inter'`
- `fonts.listUser()` — async: user-installed fonts `[{id, family, label, filename, path, ext}]`
- `fonts.css()` — async: `@font-face` CSS for all user fonts (cue-media:// URLs); injected into the operator UI + every output window
- `fonts.import()` — async: native multi-file picker → copies + registers each; returns `{ok, added, errors, list}` or `{ok:false, canceled}`
- `fonts.delete(id)` — async: removes a user font (row + file)

Editors load the merged list via the `useFonts()` hook (`renderer/utils/fonts.js`); the picker groups by category, with user fonts under "My Fonts".

### `window.cue.on(channel, callback)` → unsubscribe function
Subscribe to main→renderer events. Returns an unsubscribe function — call it to remove the listener (e.g. in `useEffect` cleanup). Allowed channels:
- `output:unresolved-channels` — array of unresolved channel objects on startup
- `output:state-changed` — fired after go/clear/logo/setLive AND after any channel topology/flag change (`syncChannel` / `setChannelContentMode`); payload: `{activeWindows, outputsEnabled, displayMode, livePayload, transport, overlay}`. OperatorView reloads its channel list on this so the live monitor tracks content-mode changes.
- `output:overlay-changed` — fired after any broadcast-graphics change; payload is the full `overlay` object `{nameTitle, ticker, custom}`. The Graphics panel + live monitor follow it.
- `output:media-transport` — fired whenever the media transport changes (go / play / pause / restart / seek / setMuted / setRate); payload: `{ active, startAt, pausedAt, loop, muted, rate }`. The operator UI follows this to drive `SyncedVideo` and the transport bar. (There is NO `output:media-time` event — the old clock-master time-reporting chain was removed.)
- `youtube:status` — fired as an ephemeral YouTube download progresses; payload: `{ id, url, status, percent, title, durationMs, path, error, setupName }` (`setupName` = which binary is downloading during the `setup` state). The Media-tab modal, the rundown status badge, and `OperatorView` (which patches the matching cue by URL) all follow it. See §6 *Native YouTube player*.
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

### Auto-advance / timed loops
A rundown item can carry a per-slide auto-advance interval (`service_items.advance_seconds`, set from the RundownPanel context menu → Auto-Advance modal). When that item is live, a `useEffect` keyed on `(liveItemId, liveSlideIdx, liveScripture, serviceData)` arms one `setTimeout`; on fire it calls `handleAutoAdvance` via `shortcutRef.current`. The effect re-runs on every live slide/item change, so each advance restarts the countdown; scripture-live (synthetic, not in the rundown) and items without an interval are skipped. `handleAutoAdvance` reads the live item's `advance_loop`/`advance_wrap`: `'item'` bounces back to slide 0 of the same item (forever); `'rundown'` steps forward like Space and, at the end of the rundown, wraps to the first item or stops based on `advance_wrap` (stopping = no state change = no new timer). The whole feature is renderer-side — it reuses the same handlers as the keyboard/remote, never resolving slides in main.

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

**Default alignment is CENTRE.** A song whose style is all-default saves `style_json = null` (because `align:'center'` is itself the default — see `styleIsDefault`), so the output receives `styleJson: null`. `applyStyle` therefore treats a missing style as `{}` and defaults `text-align` to `center` (and `#text` is `width:100%`, `lowerthird.css` also defaults centre) — it must **not** early-return on null, or centred lyrics render left (fullscreen never hit this because `fullscreen.css #text` already defaults centre). The same `style?.align || 'center'` default lives in the operator monitor (`PreviewLivePanel.MonitorFrame`) and the broadcast name/title bug (`graphics-overlay.js`, width:100%). Explicit left/right makes the style non-default → saved → applied normally.

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

Three tiers, all surfaced in one picker (grouped by category):

**1. Bundled** — 6 families in `src/fonts/` (12 `.woff2`), pixel-identical on every machine: Inter (default UI), Montserrat, Lato, Oswald (output templates only), Playfair Display, EB Garamond. `fonts.css` has the `@font-face` rules (`font-display: block`), loaded by output templates (`<link href="../fonts/fonts.css">`) and the renderer (`@import` in `index.css`).

**2. System** — ~22 common cross-platform families (Arial, Helvetica, Georgia, Times New Roman, Verdana, Calibri, Segoe UI, Palatino, Garamond, Impact, Courier New, …) listed in `BUNDLED_FONTS` with `family` as a **fallback stack** (e.g. `'"Helvetica Neue", Helvetica, Arial, sans-serif'`) and `bundled: false`. They resolve from the OS — no files shipped.

`src/main/fonts.js` exports `BUNDLED_FONTS` (`[{family, label, category, bundled?}]`, category ∈ sans-serif/serif/display/monospace) and `DEFAULT_FONT = 'Inter'`. Exposed synchronously as `window.cue.fonts.list` / `.default`.

**3. User-installed** — operators add their own `.woff2/.woff/.ttf/.otf` via **Settings → Fonts** (`FontSettings.jsx`). Files copy into `userData/fonts/<uuid>.<ext>`, metadata into the `user_fonts` settings key; `db/fonts.js` derives the family name from the filename. They are **served through the `cue-media://` protocol** (font MIME types added to `MEDIA_MIME`) and registered as `@font-face` rules (`buildUserFontCss()`) injected into **both** the operator document (`injectUserFontFaces()` in `renderer/utils/fonts.js`, on app start + after import) **and every output window** (`output-preload.js` on load) — so a custom family looks identical in the editor preview and on screen/NDI. Included in backups (paths rewritten on restore); wiped by factory reset. Appear under "My Fonts" (category `custom`) in the picker.

The editors consume the merged bundled+user list via the `useFonts()` hook.

**To add a built-in font:** drop `.woff2` into `src/fonts/`, add `@font-face` to `fonts.css`, add an entry to `BUNDLED_FONTS`.

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

**PowerPoint-style positioning (editor previews)** — a fixed `CONTENT_BOX = {x:5,y:5,w:90,h:90}` "content window" (safe-area guide) is drawn over the background. `style.textBox{x,y,w,h}` is the text box: **drag** the body to move, **8 resize handles** (`TB_HANDLES`, counter-scaled to constant visual size; `resizeBox()` keeps the opposite edge fixed) to resize, anywhere on screen. *Text align* aligns text within the box; *object align* snaps the box within the content window. The reference is draggable too (`onRefPosChange`; converts bottom-anchor → `pos{x,y}` via bounding-rect measurement, no jump). `SlidePreview` props: `onTextBoxChange`, `onRefPosChange`. Output already honours `textBox.h` + `verticalAlign`, so positioning is editor-only — no template changes. The `GraphicsEditor` box previews (`BugPreview`, `CountdownPreview`) draw the same content-window guide (`ScaledFrame contentGuide`) and their object-align snaps to the same `CONTENT_BOX`; boxes still drag anywhere on the frame.

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
| ~~Tag CRUD UI~~ | ~~Medium~~ | Implemented — `TagSettings.jsx` (Settings → Tags) for create/rename/recolour/delete; plus inline tag creation in `SongEditor`. |
| ~~Song background picker in Song Editor~~ | ~~Medium~~ | Implemented. Media picker in `SlidePreview` calls `songs:setBackground`. |
| ~~Song import~~ | ~~Medium~~ | Implemented — OpenLyrics / ChordPro / text / EasyWorship + bundled GHS hymnal. See §16. |
| ~~Network control API~~ | ~~Medium~~ | Implemented — localhost/LAN HTTP + SSE server, token-gated. Phone control page + Companion HTTP verbs. See §7 `window.cue.remote`, `src/main/remote/`. |
| Disk space warning | Low | Warn when < 2GB free on import. Not implemented. |
| ~~Media unused-asset cleanup~~ | ~~Low~~ | Implemented — `MediaCleanup.jsx` (Settings → Media) scans via `media.findUnused` (songs/service_items/channels/themes/settings) and bulk-deletes. |
| ~~Auto-advance / timed loops~~ | ~~Medium~~ | Implemented — `service_items.advance_seconds/advance_loop/advance_wrap`, renderer-side scheduler in `OperatorView.handleAutoAdvance`. See §12. |
| ~~Presentations (native slides) + PowerPoint import~~ | ~~High~~ | Implemented — multi-element slide editor + LibreOffice/pdfjs PPTX→image import. See §21. |
| Presentation user-saved templates | Low | `presentation_templates` table + IPC exist; only built-in layouts wired into the editor so far. |
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
   e. Register all IPC handlers (songs, services, media, output, settings, bible, graphics, themes, remote, fonts)
   f. `createMainWindow()` — show operator UI
   g. `remoteServer.configure(...)` + `outputManager.setRemoteStateListener(...)` + `await applyRemoteConfig()` — start the network control server if `remote_enabled`
   h. `outputManager.init()` — load active channels, create BrowserWindows
   i. On `did-finish-load`: send `output:unresolved-channels` and/or `output:ndi-unavailable` if needed. The renderer does not auto-navigate to Settings — the operator opens it manually.

---

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

## 21. Presentations & PowerPoint Import

A **Presentations** content type — a PowerPoint-style multi-element slide editor (`PresentationEditor.jsx`) whose decks live in the Library (LibraryPanel "Presentations" tab) and drop into the rundown as `item_type='presentation'` service items, inheriting **every** existing control (GO/NEXT/PREV/SELECT, keyboard, auto-advance, network remote, operator monitors, screen + NDI output). No new transport or remote wiring was needed — `getSlides`/`buildPayload`/`slidesForRemote` in `OperatorView` gained a `'presentation'` branch and everything else flows generically.

### Element model (`elements_json`)
Each slide is an array of elements positioned in **percent of the 1920×1080 canvas** (same convention as `textBox`):
```js
{ id, type:'text'|'image'|'shape',
  x, y, w, h, rotation, z, opacity,
  // text:  text, style   (style = §8 song-section style shape, incl. runs)
  // image: mediaId, fit:'cover'|'contain'   // store the ID, not a path (portable); resolved to path on read
  // shape: shape:'rect'|'ellipse'|'line', fill, stroke:{color,width}, radius }
```
The same array is rendered by three parallel renderers (the established React-vs-plain-DOM duplication pattern): `fullscreen.js` `renderElements` (live output, scaled `#slide-elements`), `PreviewLivePanel` `PresentationCanvas` (operator monitor), and `PresentationEditor`'s own canvas (drag/resize editing). All three render into a fixed 1920×1080 box scaled by a CSS transform, so px font sizes are WYSIWYG across editor → monitor → output. Per-slide background resolution: slot `background_override` → slide `background_id` → `global_bg_slide_id` → black.

### PowerPoint import pipeline
PPTX fidelity is **render-to-image**: `PptxImportModal` gates on a LibreOffice check (never spawns a missing binary), then `pptx-import.convertPptxToPdf` runs `soffice --headless --convert-to pdf` (isolated `-env:UserInstallation` profile) → `pdfRaster.rasterizePdf` (pdfjs, renderer) rasterises each PDF page to a 2560px PNG → `createFromImages` persists each via `media.importBuffer` and builds a presentation whose slides each hold one full-bleed image element. The result is an ordinary native presentation, so all controls work. Key constraints:
- **A `.pdf` is imported directly** (no LibreOffice, no font substitution → pixel-perfect). Exporting a deck to PDF from PowerPoint/Keynote is the recommended high-fidelity path; PDF import is offered even when LibreOffice is absent.
- **Layout/overflow drift on `.pptx` is LibreOffice font substitution** (the deck uses fonts not installed on the conversion machine). pdfjs renders the vector PDF faithfully — fidelity is decided upstream. Fix by installing the deck's fonts or embedding fonts in the .pptx.
- **pdfjs is pinned to v4** (see §2): v5/v6 use native `Promise.try` which Electron 30's Chromium lacks. The worker must load via Vite `?worker` + `workerPort`, not a `?url` workerSrc (else a slow main-thread "fake worker").
