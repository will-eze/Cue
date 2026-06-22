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
│   │   │                     autoSnapshot(): synchronous DB-only copy to userData/backups/cue-<stamp>.db on every
│   │   │                     quit (will-quit, before closeAll), keeps newest 5, try/caught so it never blocks quit.
│   │   ├── scenes.js         Scenes CRUD (one-press output state recall). normalizeScene(row|liveObj) is the applyScene boundary; hotkeys unique.
│   │   ├── graphics.js       Broadcast-graphics CRUD (list/get/create/update/del/reorder). style_json + target.
│   │   │                     presets() reads built-in designs from resources/graphics/ (*.html custom + *.json
│   │   │                     structured), not DB rows (§7).
│   │   ├── presentations.js  Presentations CRUD (native multi-element slides) + presentation_templates. get()
│   │   │                     resolves each slide's image-element mediaIds → paths. collectImageMediaIds(elements_json)
│   │   │                     is exported for services.js + media.findUnused (image refs live inside elements_json).
│   │   ├── themes.js         Theme library CRUD (list/get/create/update/del). applyToSong/applyToRundown/
│   │   │                     applyToAllSongs merge the theme style_json into song_sections (preserving inline
│   │   │                     text runs) and, when the theme has a background + setBg, write songs.default_background_id
│   │   │                     and NULL out per-slot service_items.background_override_id so the theme bg wins.
│   │   │                     seedBundledThemes() (resources/themes/*.json, by-name via seeded_theme_keys, upserts);
│   │   │                     resolveThemeBackground(id) lazily downloads a media theme's style_json.bgRef (§9).
│   │   ├── background-library.js  Phase 1b Background Library: reads bundled resources/media-manifest.json
│   │   │                     (tags + thumb + origin url). list/tagCounts/download/applyAsDefault — a pick streams
│   │   │                     the origin url into userData/media as a normal media_assets row (Option A, never rehost);
│   │   │                     bg_library_downloads settings map keeps picks idempotent + out of findUnused.
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
│   │   │                     Songs.db + SongWords.db join, RTF→rich via rtfToRich, one file → many rows).
│   │   │                     EW: a section's internal blank lines (a verse's multiple slides under one header)
│   │   │                     become ⁂ slide-break markers (§8 parts); deriveStyleJson skips ⁂ during its
│   │   │                     subsequence alignment against the RTF source so runs stay aligned past the break.
│   │   │                     parseGhsItems(items) → "GHS N - Name" rows tagged GHS. Shared parseSections
│   │   │                     (header / blank-block splitter, mirrors SongEditor's Paste Song parser).
│   │   └── pptx-import.js    PowerPoint import (main side). findLibreOffice/detectLibreOffice (known per-OS soffice
│   │                         paths + `libreoffice_path` setting + PATH; reports version for the UI check button).
│   │                         convertPptxToPdf(filePath): a .pdf passes straight through (no LibreOffice → pixel-perfect);
│   │                         a .ppt/.pptx runs `soffice --headless --convert-to pdf` in an isolated -env:UserInstallation
│   │                         profile (avoids the "instance already open" lock) and returns the PDF bytes.
│   │
│   ├── export/
│   │   └── rundown-pdf.js    Rundown → printable lyrics PDF. exportRundownPdf(serviceId): resolve via services.getById,
│   │                         build a print-styled HTML doc (songs → numbered section labels + lyrics, scripture →
│   │                         superscript verses, slides → text; media/presentation/youtube → one labelled placeholder
│   │                         line so order is intact), native Save dialog, render via a hidden BrowserWindow's
│   │                         webContents.printToPDF (Chromium — NO LibreOffice), write to the chosen path. Strips the
│   │                         ⁂ slide-break marker (literal, not a renderer-util import). Returns {canceled}|{path}.
│   │
│   ├── ipc/
│   │   ├── songs.ipc.js      Registers songs:*, tags:* handlers (incl. importParse/importGhs/importCommit).
│   │   ├── services.ipc.js   Registers services:* handlers.
│   │   ├── media.ipc.js      Registers media:* handlers.
│   │   ├── output.ipc.js     Registers output:* handlers (incl. graphic/ticker/overlay + channel show_program/
│   │   │                     show_graphics; content-mode-only channel updates route to setChannelContentMode).
│   │   ├── graphics.ipc.js   Registers graphics:* CRUD handlers + graphics:presets (registerGraphicsIpc).
│   │   ├── scenes.ipc.js     Registers scenes:* CRUD + scenes:apply→outputManager.applyScene (registerScenesIpc).
│   │   ├── themes.ipc.js     Registers themes:* CRUD + apply handlers (registerThemesIpc); apply* await
│   │   │                     resolveThemeBackground first when setBg (media-theme bgRef download).
│   │   ├── background-library.ipc.js  Registers backgrounds:* (list/tagCounts/download/applyAsDefault).
│   │   ├── presentations.ipc.js  Registers presentations:* + presentationTemplates:* CRUD, the PowerPoint pipeline
│   │   │                     (detectLibreOffice/setLibreOfficePath/convertPptx, and createFromImages: persist each
│   │   │                     rasterised PNG via media.importBuffer → build an image-element presentation), and app:openExternal.
│   │   ├── settings.ipc.js   Registers settings:* handlers (incl. exportBackup/importBackup + factoryReset:
│   │   │                     close DB, delete cue.db + media/ + fonts/, relaunch as a fresh install).
│   │   ├── fonts.ipc.js      Registers fonts:* handlers (listUser/css/import [native multi-file picker]/delete).
│   │   ├── bible.ipc.js      Registers bible:* handlers (versions/books/chapters/verses/adjacent/resolve/search/importFile/delete/online:*).
│   │   ├── youtube.ipc.js    Registers youtube:* handlers (prefetch/status/cancel/detect) + clipboard:readText. Wires
│   │   │                     the downloader's status listener → broadcasts youtube:status to every window.
│   │   └── remote.ipc.js       Registers remote:* handlers (getConfig/setConfig/regenerateToken/navState). Owns the
│   │                           settings keys (remote_enabled/port/lan/token) + applyRemoteConfig() (boot + on-change start).
│   │
│   ├── remote/
│   │   ├── server.js           Network control API. Dependency-free Node http server (no ws — SSE for the live STATE
│   │   │                       push). Binds 127.0.0.1 (LAN opt-in = 0.0.0.0). Token-gated /api/*. configure() injects
│   │   │                       getState + onCommand (decoupled from manager/window). ACTIONS = go/clear/logo/next/prev/
│   │   │                       live/select; GET /api/<action> or POST /api/command. STATE via GET /api/state + GET
│   │   │                       /api/stream (SSE). setNavState() holds the renderer-pushed rundown (items + slides).
│   │   │                       128-bit token (crypto.randomBytes(16)) compared with timingSafeEqual; Referrer-Policy:
│   │   │                       no-referrer on every response so the ?token= can't leak via Referer.
│   │   └── control-page.js     CONTROL_PAGE: self-contained dark HTML control surface served at GET / (phone remote).
│   │                           Token from ?token= → localStorage. SSE-driven (single source of truth, no stale renders).
│   │                           Accordion rundown — expand a song to its numbered slides, tap a verse to jump live.
│   │
│   ├── youtube/
│   │   ├── bin.js             yt-dlp + ffmpeg resolver + auto-downloader (NOT bundled). Resolves userData/bin →
│   │   │                     PATH → dev-only resources/bin; ensureBinaries() downloads missing ones into userData/bin
│   │   │                     on first use (streamed, progress); refreshYtDlp() re-fetches latest on extractor failure.
│   │   └── downloader.js      Ephemeral YouTube resolver. parseVideoId; prefetch(url) (resolve metadata → download
│   │                         with faststart + concurrent-fragments → ready); withClientCascade (default → web_embedded
│   │                         → cookies anti-bot tiers, refresh-on-bot-wall); in-memory entries Map keyed by video id;
│   │                         getStatus/getReadyPath/cancel; wipeCache() (quit + startup). Emits youtube:status.
│   │
│   ├── update/
│   │   └── updater.js        In-app updater (Option A). Anonymous GitHub Releases API (public repo). checkForUpdate()
│   │                         takes /releases[0] (prerelease-aware), picks asset by extension; downloadUpdate() streams
│   │                         to temp w/ update:progress, strips macOS quarantine xattr, opens installer, quits.
│   │
│   ├── stream/
│   │   └── rtmp.js           RTMP streaming via the bundled ffmpeg (no OAuth — stream key). spawn ffmpeg (video=rawvideo
│   │                         bgra on pipe:0, audio=f32le on pipe:3); HW encoder probe (videotoolbox/nvenc/qsv) → libx264;
│   │                         wallclock A/V; writeVideo (drops + counts under backpressure) / writeAudio (never dropped);
│   │                         start/stop/getStatus (incl. droppedFrames/sentFrames); auto-reconnect. Driven by Stream Studio.
│   │
│   └── output/
│       ├── manager.js        Output window registry. go/clear/logo dispatch. No operator capture loop —
│       │                     the operator live monitor renders from payload, not capturePage.
│       │                     Owns the foreground-media `transport` { active, startAt, pausedAt, loop, muted, rate }
│       │                     (machine-clock based). go() stamps it; mediaControl/mediaSeek/mediaSetMuted/mediaSetLoop/mediaSetRate
│       │                     mutate it (setRate rebases startAt so position is continuous);
│       │                     broadcastTransport() pushes `media:transport` to every window + `output:media-transport`
│       │                     to the renderer. isPrimaryAudioMonitor() picks the single program-audio window (?mute=).
│       │                     Stage timer/message state (stageTimerCmd, setStageMessage) → stage:timer / stage:message.
│       │                     Scheduled stage messages: stageState.scheduled (in-memory, no DB) → scheduleStageMessage /
│       │                     unscheduleStageMessage / getStageSchedule; broadcastStageSchedule → stage:schedule to stage
│       │                     windows + operator; a single setTimeout (nextPruneDelay) prunes expired entries. Anchor
│       │                     resolution + pruning come from src/shared/stage-schedule.js.
│       │                     NDI: ndiCaptureLoops Map, ndiLastFrames Map (1fps JPEG cache for multiview).
│       │                     startNdiCapture/stopNdiCapture. multiviewRefCount: refcounted start/stop —
│       │                     multiview capture is driven only by MultiviewView (start on mount, stop on unmount).
│       │                     Broadcast-graphics overlay bus: overlay {nameTitle,ticker,custom} + graphicShow/Hide,
│       │                     tickerShow/Hide, customShow/Hide; broadcastGraphic() → per-window target-filtered
│       │                     graphic:update to all non-stage windows (getGraphicsWindowInfos). Auto-dismiss: dismissTimers
│       │                     map = main-owned one-shot setTimeout per slot+kind (armDismiss/clearDismiss), §13. setChannelContentMode()
│       │                     toggles a channel's lyric band / overlay at runtime via content:mode (no window recreate).
│       │                     setRemoteStateListener(cb): notifyMainWindow('output:state-changed') also fires cb so the
│       │                     network remote pushes STATE. setOutputsEnabled emits state early (before slow window work).
│       │                     Audio: getProgramAudioDevice/setProgramAudioDevice (in-room device, audio:output-device);
│       │                     in-room tap → ingestAudioPcm (planar FLTp to NDI senders ONLY); stream tap → ingestStreamAudioPcm
│       │                     (interleaved f32le to RTMP); updateAudioTapState (audio:tap on/off). Stream Studio: prepare/open/
│       │                     close/start/stopStream, get/setStreamStudio, steady-CFR encode pump + preview/levels/health, a
│       │                     dedicated offscreen compositor window (backgroundThrottling:false) kept outside the windows map.
│       └── ndi.js            Active NDI implementation. createRequire loads @grandi/<platform>-<arch>
│                             at runtime. createSender / sendFrame (inflight guard) / sendAudio (FLTp planar) / destroySender.
│
├── shared/
│   ├── stage-schedule.js     Pure scheduled-stage-message logic (no electron/DOM) shared by main + renderer:
│   │                         resolveAnchors (spec→{showAt,clearAt}), collides/overlapIds (true-conflict detection),
│   │                         resolveActive (which message owns the bar), pruneExpired, nextPruneDelay. stage.js
│   │                         mirrors resolveActive inline (classic <script>). Tested by stage-schedule.test.mjs.
│   └── stage-schedule.test.mjs  Node assertion test (in `npm test`) — anchor/collision/active/prune edge cases.
│
├── renderer/
│   ├── main.jsx              React entry point. Mounts <App />.
│   ├── index.css             Design system CSS: tally classes, monitor glow, scrollbar, fonts.
│   ├── App.jsx               Root. Titlebar + transport bar + view switcher (Operator/Settings).
│   │                         StagePanel popover (Stage button): presenter countdown timer + immediate stage message +
│   │                         scheduled messages (queue with live "in M:SS"/ON badges, collision flags, auto-clear),
│   │                         driven via window.cue.output.stage.timer / .message / .schedule|getSchedule|unschedule.
│   │                         Preview/collision use src/shared/stage-schedule.js so they match main's resolution.
│   │
│   ├── views/
│   │   ├── OperatorView.jsx  Three-panel layout. All transport state. Keyboard shortcuts (configurable via shortcutsRef).
│   │   │                     Background resolution. buildPayload(). Services list refreshes on bgRefreshTick.
│   │   │                     Accepts outputsEnabled + onToggleLive props from App. focusSearchRef wired to LibraryPanel.
│   │   │                     Resize state persisted to localStorage (keys: layout_h_pct, layout_v_pct).
│   │   │                     Loads output channels list. Does NOT capture output or subscribe to multiview —
│   │   │                     the live monitor renders the slide from payload (no per-frame capture loop).
│   │   │                     liveChannelIdx tracks which channel the live monitor displays.
│   │   ├── SettingsView.jsx  Settings layout. Left column is section navigation (Channels/Logo/Background/Themes/Motion/
│   │   │                     Bible/Tags/Media/Shortcuts/Remote/Data/Danger) + Back-to-Operator: click scrolls to the section; an
│   │   │                     IntersectionObserver highlights the section in view. Section order: OutputChannels →
│   │   │                     LogoSettings → BackgroundSettings → ThemeSettings → TransitionSettings → BibleSettings → TagSettings → MediaCleanup →
│   │   │                     ShortcutSettings → RemoteSettings → DataSettings → DangerZone → SettingsFooter (always last two,
│   │   │                     rendered at layout level — not inside any sub-component).
│   │   └── MultiviewView.jsx Multi-output monitor wall — one uniform responsive grid of equal tiles (every
│   │                         screen monitor, every NDI channel, and a placeholder tile per screen channel with no
│   │                         monitors). Each tile carries a ChannelChip header (name + NDI/template/active badges).
│   │                         Subscribes to output:multiview-captures. NDI channels show NdiTile (checkerboard + frame).
│   │   └── StreamView.jsx    Stream Studio tab: external feed inputs (video/audio device pickers, audio mode), live
│   │                         composite monitor (output:stream-preview), layout/cut switcher (Feed/Program/PiP +
│   │                         lyrics-over-feed), stereo level meters, dropped-frame health badge, RTMP config + Go Live.
│   │                         Mounts stream.open()/unmounts stream.close() (ref-counts the compositor for preview).
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
│   │   ├── ScenesPanel.jsx        Scenes tab. Card grid (Take + hotkey chip) + capture-driven editor (Capture current
│   │   │                          output → snapshot overlay/program/audio; program & audio segmented overrides; Test).
│   │   │                          Dispatches a `cue:scenes-changed` window event so OperatorView reloads number-key binds.
│   │   └── ScripturePanel.jsx     Live verse browser (Scripture tab). Translation rail (select/delete/import/appearance),
│   │                              predictive Book→Chapter→Verse reference bar (autofocus), whole-chapter verse list,
│   │                              ↑/↓ live nav, right-click menu, OnlineBibleModal + ScriptureEditor hosts.
│   │
│   ├── components/
│   │   ├── Toast.jsx              ToastProvider + useToast() — the one transient-notification system (success/error/info + action button for Undo). Mounted at root in main.jsx.
│   │   ├── ErrorBoundary.jsx      Per-view error boundary (App.jsx wraps each view) with a recoverable "Reload UI" fallback; outputs keep running.
│   │   ├── CommandPalette.jsx     ⌘K cross-category launcher (songs/scripture/scenes/presentations/media → add-to-rundown or apply-scene).
│   │   ├── ShortcutsOverlay.jsx   ? cheatsheet modal; reads the live shortcut settings. Also opened by Settings → Shortcuts "View All".
│   │   ├── TopBarTabs.jsx         Customisable top-nav extras: pinnable Settings-subsection deep-link tabs (dnd reorder, ×-unpin, + picker, Reset). Persisted in the `topbar_tabs` setting.
│   │   ├── UndoRedoButtons.jsx    Shared editor-toolbar Undo/Redo pair, driven by a useEditHistory instance.
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
│   │   │                          Section splitting: a Split button / ⌘-Ctrl+Enter inserts a slide break at the caret
│   │   │                          (a contenteditable=false styled divider that round-trips to the ⁂ marker via
│   │   │                          renderEditorHtml + extractContentAndRuns' data-break guard); an Auto button splits the
│   │   │                          section at every blank-line stanza. The preview shows a click-to-jump thumbnail
│   │   │                          filmstrip of the section's parts (splitForPreview rebases runs per part). The sections
│   │   │                          sidebar flicks through sections on mouse-wheel (native non-passive listener).
│   │   ├── SongPreviewModal.jsx   Read-only song preview. Add to Rundown / Edit.
│   │   ├── SongImportModal.jsx    Import preview/confirm (createPortal). One row per parsed song: checkbox,
│   │   │                          uncontrolled editable title (titlesRef — no re-render for large batches),
│   │   │                          format badge, section count; failed/duplicate rows flagged. Selection in a Set;
│   │   │                          duplicates start unselected. Commit → songs.importCommit (forwards tags).
│   │   ├── ScriptureEditor.jsx    Global scripture appearance modal. Verse/Reference target toggle, drag/resize,
│   │   │                          object align, background. Reuses SongEditor exports. Saves scripture_*_json + bg.
│   │   ├── GraphicsEditor.jsx     Broadcast-graphic editor modal. Kind tabs (lower_third/ticker/countdown/custom). Reuses
│   │   │                          SongEditor's FormattingToolbar; lower-third Name/Title target toggle + draggable/
│   │   │                          resizable BugPreview + bar control; ticker styling (crawls in preview) + top/bottom;
│   │   │                          custom HTML + placeholders + sandboxed preview. "Apply a design" opens the design
│   │   │                          gallery (GraphicsPresetModal — per-kind filter tabs, live tiles) restyling the draft.
│   │   │                          Default-destination selector. Exports fillPlaceholders, flatTextCss, buildBarBg,
│   │   │                          GraphicsPresetModal, presetToGraphic (shared with GraphicsPanel + monitor).
│   │   ├── ThemePickerModal.jsx   Reusable click-to-apply theme gallery (category prop). Full-screen grid of live
│   │   │                          SlidePreview tiles (sortThemes order, bgThumb for media themes). onPick(theme) —
│   │   │                          caller decides apply. Used by SongEditor (theme picker) + ScriptureEditor (Load Theme).
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
│   │   │                          `initialUrl` pre-fills + auto-resolves (clipboard chip); "Use my browser's YouTube
│   │   │                          login" control sets youtube_cookies_browser for the download cascade's cookies tier.
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
│   │   │                          Also the global "Program audio output" device picker (program_audio_device; labels
│   │   │                          unlocked lazily on first interaction, never eagerly — see §13).
│   │   ├── StreamSettings.jsx    Pointer card — streaming moved to the Stream tab (StreamView.jsx). Nav id 'stream'.
│   │   ├── LogoSettings.jsx      Global logo picker.
│   │   ├── BackgroundSettings.jsx Global song/scripture/slide background pickers. Bulk apply actions.
│   │   ├── ThemeSettings.jsx     Theme library. Category tabs (Songs/Scripture/… auto-derived from present themes);
│   │   │                          grid of theme cards (SlidePreview thumbnail, bgThumb for media themes; Edit/Delete;
│   │   │                          song cards get "Apply background" toggle + Apply-to-rundown + Apply-to-all-songs,
│   │   │                          non-song cards show an "open the … editor" hint). Built-ins read-only. ThemeEditorModal
│   │   │                          reuses SongEditor's FormattingToolbar + SlidePreview/LowerThirdPreview. Background picker.
│   │   ├── BackgroundLibrary.jsx  Settings → Background Library (Phase 1b). Tag-filter grid of hotlinked remote thumbs
│   │   │                          (window.cue.backgrounds.*); hover actions set the global default bg per surface.
│   │   ├── TransitionSettings.jsx Settings → Motion. Per trigger (slide/logo/clear): style picker (§13 library) +
│   │   │                          duration slider + easing + click-to-play NOW→NEXT preview. Persists `output_transitions`.
│   │   ├── LowerthirdSettings.jsx Settings → Lower Third. Global L3 font scale (1–150%, slider + presets) as a % of the
│   │   │                          fullscreen size; persists `lowerthird_font_scale` via output.lowerthird.setFontScale (live).
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
│       ├── useEditHistory.js     Shared editor undo/redo: useEditHistory(initial) → {state,set,reset,undo,redo,canUndo,canRedo} (bounded past/present/future, coalesced by tag) + useUndoRedoKeys (⌘Z/⌘⇧Z capture-phase). Reducer stays pure (StrictMode).
│       ├── mediaUrl.js           mediaUrl(absPath) → cue-media://localhost/encoded/path
│       ├── youtube.js            looksLikeYouTube(s) — shared client-side YouTube-URL gate (modal + clipboard chip)
│       ├── fonts.js              useFonts() hook → merged [bundled…, user…] font list for the editors (user fonts
│       │                         load async, grouped as category 'custom'). injectUserFontFaces() injects the user
│       │                         @font-face <style> into the operator document (called on app start + after import).
│       ├── channelMode.js        Lower-third content-mode helpers: CHANNEL_MODES, channelMode(ch),
│       │                         modeToFlags(mode) ({show_program, show_graphics}). Shared by Settings + Graphics panel.
│       ├── themeSort.js          themeKind(theme) + sortThemes(list): media → gradient → custom ordering for the pickers.
│       ├── pdfRaster.js          rasterizePdf(bytes, targetWidth=2560, onProgress) → [PNG Uint8Array] per page (pdfjs,
│       │                         fresh ?worker per call → workerPort; lossless PNG for crisp text). Used by PptxImportModal.
│       └── sectionLabels.js      Numbered section labels — single source of truth. sectionOrdinals(slides) (n or null,
│                                 numbered only when a type repeats); sectionLabels(slides,{abbrev}); sectionLabelAt.
│                                 Used by SlideList, SongEditor, OperatorView buildPayload (stage label), the remote.
│                                 Also owns variable-size section splitting: SLIDE_BREAK ('⁂'), splitSectionContent(content)
│                                 → parts, expandSongSections(sections) → flat slide list (one slide per part, labels
│                                 computed at the SECTION level so parts share "Verse 1"; carries _label/_labelAbbr/
│                                 _partIndex/_partCount/_key). getSlides()'s song branch returns this.
│
├── output/                   Plain HTML — no build step, no React, served directly.
│   ├── media-player.js       Shared classic script (loaded before fullscreen.js/stage.js). window.CueMediaPlayer.
│   │                         attach(el, {loop, baseMuted, transport}) locks one <video>/<audio> to the shared
│   │                         transport: wall-clock-derived position, playbackRate convergence (±6%, preservesPitch),
│   │                         native loop, el.muted = baseMuted || transport.muted. Subscribes to onMediaTransport.
│   │                         Applies the in-room audio output device (setSinkId, audible window only) + offers each
│   │                         element to CueAudioTap (§13 In-room device / Program-audio tap).
│   ├── audio-tap.js          In-room program-audio tap (NDI only). captureStream → 48k AudioContext → cue-pcm-tap worklet →
│   │                         output:audio-pcm. Worklet loaded from a blob: URL (asar-proof). Gated by audio:tap. (Stream
│   │                         audio is a separate tap in stream-feed.js → output:stream-audio-pcm.)
│   ├── pcm-tap-worklet.js    AudioWorkletProcessor: batches planar Float32 PCM frames, posts them to the main thread.
│   ├── graphics-overlay.js   Shared broadcast-graphics overlay (included by fullscreen.html + lowerthird.html, NOT
│   │                         stage). Injects its own #cue-gfx DOM + styles. Renders the name/title bug (positioned by
│   │                         style.name.textBox, styled per name/title), ticker crawl (top/bottom, speed), and custom
│   │                         HTML (isolated shadow root, .cue-in/.cue-out). Honours onGraphicUpdate; ?graphics=0 and
│   │                         content:mode toggle the whole overlay live (caches last overlay to restore on re-enable).
│   ├── stream-feed.js        Stream compositor (loaded by fullscreen.html, no-op unless ?stream=1). External camera
│   │                         feed base (getUserMedia, resolved by label), Feed/Program/PiP layout, lower-third lyric
│   │                         band, CSS-zoom 1920×1080 design space (resolution independence), and the stream audio
│   │                         tap (external input + optional Cue media → cue-pcm-tap → output:stream-audio-pcm) + meters.
│   ├── transitions.js        Shared program-output transition engine (loaded before fullscreen.js/lowerthird.js).
│   │                         window.CueTransitions.run(stage, {type,durationMs,easing}, render, {fgSel}): clones the
│   │                         live stage as a ghost overlay, calls render() to mutate the live stage to the new content,
│   │                         then animates. fade/zoom keep the new BACKGROUND solid and fade/scale only the foreground
│   │                         (fgSel) IN while the ghost fades out (no mid-transition black dip); slides move the whole
│   │                         frame. Latest-wins (settles any in-flight transition first), honours reduced-motion, GPU
│   │                         will-change. CALLER passes {type:'none'} when a video is on either side (§13). NOT in stage.
│   ├── fullscreen.html       #stage (#background + #scrim + #content[#text-wrap > #text, #slide-elements, #logo-wrap,
│   │                         #copyright]) + graphics-overlay.js. #stage wraps the program layer as the transition clone unit.
│   ├── fullscreen.css        Fullscreen output styles. #text-wrap is absolutely positioned by JS. #slide-elements is a
│   │                         fixed 1920×1080 presentation-element layer scaled to the viewport. #logo-wrap is a separate sibling.
│   ├── fullscreen.js         applyStyle(s): positions #text-wrap via textBox %, applies all style props to #text.
│   │                         showLogo/hideLogo use #logo-wrap. Supports: verticalAlign, letterSpacing,
│   │                         uppercase, textShadow (buildShadow), textStroke, textBox, underline in runs.
│   │                         Detects ?alpha=1 (IS_NDI) → transparent background; ?mute=1 (MUTE_AUDIO) → base mute.
│   │                         Foreground media via CueMediaPlayer.attach (single element, native loop). No clock-master
│   │                         time reporting, no dual-element loop swap. renderElements(payload.elements): a presentation
│   │                         slide — absolutely-positioned text/image/shape elements (% of the scaled 1920×1080 #slide-elements).
│   │                         Render body factored into renderSlide(payload); onSlideUpdate routes it through CueTransitions
│   │                         (fgSel '#content'), forcing {type:'none'} when the stage holds a <video> or payloadHasVideo(payload).
│   ├── lowerthird.html       #lowerthird > #text + #copyright (lyric band) + graphics-overlay.js. Always transparent.
│   ├── lowerthird.css        #lowerthird: bottom-anchored, background: transparent (controlled by JS via ltBar).
│   ├── lowerthird.js         The LYRIC BAND only (program slide). applyStyle(el, s) incl. ltBar gradient to #lowerthird.
│   │                         buildBarBg(ltBar): null → transparent; {color,opacity,solid} → CSS gradient or solid.
│   │                         ?program=0 / content:mode toggle the lyric band live (caches lastPayload to restore).
│   │                         onSlideUpdate routes the band through CueTransitions (whole #lowerthird, no fgSel); the
│   │                         content:mode path snaps (no transition). The graphics overlay is separate (graphics-overlay.js).
│   ├── stage.html            Confidence monitor. #top-bar (local time / REMAINING timer / VIDEO countdown),
│   │                         #content (#media-wrap + #current-text, #next-text), #bottom-bar (#message-text).
│   ├── stage.css             Stage monitor styles — info bars, progress track, countdown colour states, message alert.
│   └── stage.js              Receives slide:update + stage:timer + stage:message + stage:schedule. Video preview via
│                             CueMediaPlayer (always baseMuted). VIDEO countdown derives remaining from transport + clip
│                             duration — loops with the clip (never ∞), freezes on pause. Presenter countdown timer +
│                             message bar: resolveMessage() picks immediate message (precedence) else the active
│                             scheduled one, re-ticked every 1s against Date.now() anchors (mirrors resolveActive in
│                             src/shared/stage-schedule.js — plain <script>, can't import; keep in sync).
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
- `resources/themes/*.json` — bundled built-in theme packs (one theme per file: `{ name, category, sort_order, style }`; song / media / scripture / **presentation** categories). Presentation theme `style` is a layout-agnostic **token bag** `{ kind:'pres-theme', … }` (§21), not a §8 text style. Shipped via `extraResource`, seeded by `seedBundledThemes` (§5 themes)
- `resources/graphics/` — built-in broadcast-graphic design presets, read at request time by `graphics.presets()` (NOT seeded): `*.html` (custom designs, `<!-- name: … -->` header) + `*.json` (structured lower_third/ticker/countdown). Shipped via `extraResource`
- `resources/media-manifest.json` — Background Library manifest (tags + dims + hotlinked `thumb` + origin `url` per item). Shipped via `extraResource`; the media files themselves are download-on-demand (Option A, never bundled/rehosted — §7 backgrounds)
- `scripts/build-fonts.mjs` — regenerates bundled fonts: woff2 → `src/fonts/` + `@font-face` in `fonts.css` + entries in `BUNDLED_FONTS`
- `scripts/build-themes.mjs` / `build-media-themes.mjs` / `build-scripture-themes.mjs` / `build-presentation-themes.mjs` — author the `resources/themes/*.json` packs (song gradient, media-backed, scripture, presentation token themes)
- `scripts/*.py` (organize-media / fetch-phase1b-media / resolve-urls / add-thumbnails) — build/refresh `media-manifest.json` (curation tooling)
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

`schema.js` creates `db_version` table (single integer row) on first run and applies pending migrations in order inside a transaction. **Never delete `db_version`** — it is required to exist before any user-facing build. Current version: **25**. Migrations run with foreign keys disabled, so table-rebuild migrations (v6, v7, v11, v16, v20, v21, v23) do not cascade-delete referencing rows.

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
| v22 | Theme packs: added `themes.builtin` (INTEGER, default 0 — seeded built-ins, protected from edit/delete, re-seedable), `themes.category` (TEXT, default `'song'` — `'song'`/`'scripture'`/`'graphic'`/`'presentation'`, pickers filter on it), `themes.sort_order` (INTEGER, default 0 — display order within a category). A built-in's CSS gradient/solid background rides inside `style_json.bgCss` (§8/§9), not a new column |
| v23 | Repaired `songs_fts`: rebuilt as `contentless_delete=1` and replaced the three triggers so the delete idiom is `DELETE FROM songs_fts WHERE rowid=?`. The old triggers issued the FTS5 `'delete'` command with empty-string values, orphaning tokens until a `MATCH`-in-a-JOIN threw "database disk image is malformed" and song search returned nothing |
| v24 | Scenes (one-press multi-output state recall): created `scenes` table. A scene is a declarative snapshot of the service-independent output layers — broadcast-graphics overlay + program action + program audio — applied atomically by `outputManager.applyScene` (§13). No media-asset FKs (overlay snapshots hold resolved style objects, not media ids), so no `media.findUnused()` entry and backup-safe with no path rewriting |
| v25 | Per-song background lock: added `songs.background_locked` (INTEGER NOT NULL DEFAULT 0). Top of the background resolution cascade (§9) — a locked song's `default_background_id` is pinned above the per-slot override and the live global default, and the bulk apply actions skip it. A protect+pin flag, not a media reference, so no `media.findUnused()` entry |
| v26 | Apostrophe-insensitive song search: `songs_fts` triggers and a one-time reindex now **strip** apostrophes (straight `'`, curly `' '`, modifier `ʼ`, by `char()` codepoint) from `title`/`author`/`content` as they enter the index. The default unicode61 tokenizer otherwise splits an apostrophe, indexing `God's` as `god`+`s` so a query for `Gods` never matched. The query side strips the same set (`db/songs.js` `search()` + `_norm`), so both collapse `God's` → `gods`. No schema columns change — triggers + index content only |

### All tables

#### `songs`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
title TEXT NOT NULL
author TEXT
copyright TEXT
default_background_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
background_locked INTEGER NOT NULL DEFAULT 0   -- v25: pin this song's bg at the top of the resolution cascade
created_at DATETIME DEFAULT (datetime('now'))
updated_at DATETIME DEFAULT (datetime('now'))
```

#### `song_sections` (v2 — has style_json)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE
type TEXT NOT NULL CHECK(type IN ('verse','chorus','refrain','bridge','pre-chorus','tag','intro','outro'))
order_index INTEGER NOT NULL
content TEXT NOT NULL          -- Plain text. \n for line breaks. An inline ⁂ (U+2042) marker splits the
                              --   section into variable-size display parts (see §8). Symbol-only, so it is
                              --   invisible to songs_fts (unicode61) and the lyric matchers.
style_json TEXT                -- Nullable JSON. See §8.
```

#### `songs_fts` (FTS5 virtual table)
Mirrors `title`, `author`, `content` from `song_sections`. Indexed by `song_sections.id` (rowid). Three triggers on `song_sections` keep it in sync: `songs_fts_insert`, `songs_fts_update`, `songs_fts_delete`. Since v26 every write path **strips apostrophes** before indexing — the triggers, the v26 reindex, and the manual re-sync in `songs.update()` (title/author-only edits) — so the index is apostrophe-insensitive (`God's` → `gods`). Any new code that writes into `songs_fts` must strip the same set or it reintroduces split tokens.

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

`style_json` shape — **lower_third**: `{ name: <style incl. textBox + ltBar>, title: <style> }` (the `name` style's `textBox` is the draggable/resizable position box, `ltBar` is the bar background). **ticker**: a flat style + `{ bar:{color,opacity}|null, position:'bottom'|'top' }`. **custom**: `null` (raw HTML), or `{ autoDismissSec }` when auto-dismiss is set. lower_third and ticker also carry an optional top-level `autoDismissSec` (>0 = self-hide N seconds after airing; §13). **countdown** (v16): `{ mode:'countdown'|'countup'|'clock', source:'duration'|'target', durationSec, targetClock:'HH:MM', format:'24h'|'12h', showSeconds, endMessage, time:<style incl. textBox + ltBar>, message:<style> }` — the `text` column holds the optional label ("Service starts in").

#### `scenes` (v24 — one-press multi-output state recall)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
hotkey TEXT                    -- '1'..'9' for number-key recall in OperatorView (unique: binding frees it elsewhere), or NULL
program TEXT NOT NULL DEFAULT 'none'  -- program-layer action: 'none'|'content'|'clear'|'logo'
audio_muted INTEGER            -- program audio: NULL = don't touch, 0 = unmute, 1 = mute
overlay_json TEXT              -- broadcast-graphics overlay snapshot {nameTitle,ticker,custom,countdown}, each {screen,ndi}; NULL = overlay not managed
order_index INTEGER NOT NULL DEFAULT 0
created_at DATETIME, updated_at DATETIME
```

A scene is a declarative snapshot of the **service-independent** output layers (never a rundown-slide reference, so scenes survive weekly service changes). The authoring flow is **capture, not hand-build**: the operator sets the live output up, then `ScenesPanel`'s editor reads `output.getState()` (`overlay`, `displayMode`, `transport.muted`) and freezes it. Recall is atomic via `outputManager.applyScene` (§13) — number key 1–9 in `OperatorView`, or the panel's Take. `overlay_json` slots hold self-contained re-fire data (the same objects the `*Show` functions accept), so recall needs no saved-graphic lookup and survives graphic deletion; an all-empty snapshot is a "hide all graphics" scene. `db/scenes.js` `normalizeScene(row|liveObj)` → `{ overlay, program, audioMuted }` is the apply boundary (parses `overlay_json`).

#### `themes` (v15 — theme / template library; v22 — theme packs)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
style_json TEXT                -- a section style snapshot (same shape as §8; no runs; may carry bgCss/bgScrim/bgRef)
background_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
builtin INTEGER NOT NULL DEFAULT 0       -- v22: 1 = seeded built-in (read-only in UI, re-seedable)
category TEXT NOT NULL DEFAULT 'song'    -- v22: 'song'|'scripture'|'graphic'|'presentation'
sort_order INTEGER NOT NULL DEFAULT 0    -- v22: display order within a category
created_at DATETIME, updated_at DATETIME
```

A theme is a saved section `style_json` (§8 shape) plus an optional default background. Applying a theme merges its `style_json` into every target `song_sections.style_json` (per-section inline `runs` are preserved) and, when it has a background and the background is being applied, writes `songs.default_background_id` and NULLs the relevant `service_items.background_override_id` so the theme background wins over any per-slot override. Apply scope: `applyToSong` (all slots referencing one song), `applyToRundown` (all song slots in a rundown), `applyToAllSongs` (every song slot). The output path is unchanged — themes only write the same columns the editors already write.

**Bundled built-in themes (v22 packs):** `seedBundledThemes()` (called at startup, after the bible/GHS seeders) imports `resources/themes/*.json` — each file is `{ name, category, sort_order, style:{…§8 style, incl. bgCss/bgRef…} }`, authored by `scripts/build-*.mjs`. Seeding is tracked **by theme NAME** in the `seeded_theme_keys` settings array (migrating the legacy `themes_seeded` flag), so a later release can add new built-ins on upgrade without resurrecting ones the user deleted. It also **UPSERTs**: when a bundled theme's `style_json` differs from the DB copy it updates it (built-ins are read-only, so the bundle is source of truth), and if a media theme's `bgRef` changed it resets `background_id=NULL` so the new background re-resolves on next apply. Built-in backgrounds: gradient/solid via `style_json.bgCss`, or a media-library `style_json.bgRef` resolved lazily (§9). Categories drive the pickers (`ThemePickerModal`, `ThemeSettings` tabs); `applyTo*` is song-only — non-song categories are loaded by their own editors. **Custom themes** are authored in `ThemeSettings` for any of song / scripture / presentation: `+ New Theme` seeds the editor with the active category tab, and an in-editor switcher retargets it (song↔scripture share the §8 text-style editor; presentation swaps in the token editor — §21). `themes.create`/`themes.update` both accept `category` (update leaves it untouched when omitted, for legacy callers).

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
| `lowerthird_font_scale` | number | Global lower-third font scale, percent (1–150, default 100). Lower-third font size = `(authored size or 72) × pct/100`; rides every content payload as `ltFontScale` (a fraction). Set via Settings → Lower Third / `output.lowerthird.setFontScale`. Fullscreen unaffected |
| `operator_preview_layout` | 'stacked'\|'sidebyside' | Unused in current UI — reserved |
| `youtube_cookies_browser` | string\|null | Opt-in: browser to read YouTube cookies from for the download cascade's cookies tier (`chrome`/`edge`/`firefox`/`brave`/`safari`); `null`/absent = off. Set from the Add-YouTube modal's "Use my browser's YouTube login" control |
| `keyboard_modifier` | 'meta'\|'ctrl'\|'alt' | Modifier key for transport shortcuts (default: 'meta' on macOS, 'ctrl' on Windows) |
| `keyboard_go` | string | Key char for GO shortcut (default: 'g') |
| `keyboard_clear` | string | Key char for Clear shortcut (default: 'c') |
| `keyboard_logo` | string | Key char for Logo shortcut (default: 'l') |
| `keyboard_live` | string | Key char for Live Toggle shortcut (default: 'o') |
| `shortcut_arm_bare` | boolean | Whether the bare `G`/`Esc` keys are armed (single-press fires). Default true; disarmed → those bare keys are ignored (modifier shortcuts unaffected) |
| `shortcut_arm_jump` | boolean | Whether the positional verse/slide-jump keys (`Q W E …` → air slide N of the live item) are armed. Default false |
| `topbar_tabs` | array | Operator-pinned extra top-bar tabs (ordered `settings:<section>` deep-link ids), capped at 6. Drives the customisable nav in `App.jsx`/`TopBarTabs.jsx` |
| `ghs_seeded` | boolean | Set true after the bundled GHS hymnal is imported on first run; gates re-seeding so deletions stick |
| `seeded_theme_keys` | array | Names of built-in themes already seeded (`seedBundledThemes`); lets new built-ins add on upgrade without resurrecting user-deleted ones. Supersedes the legacy boolean `themes_seeded` |
| `themes_seeded` | boolean | Legacy all-or-nothing seed flag; migrated into `seeded_theme_keys` on first v22+ run |
| `bg_library_downloads` | object | Map `{ manifestItemId: media_assets.id }` of backgrounds downloaded on demand from the bundled `media-manifest.json` (Background Library). Treated as referenced by `media.findUnused()` so a download isn't reaped before use |
| `remote_enabled` | boolean | Network control server on/off (default false) |
| `remote_port` | number | Server TCP port (default 7373) |
| `remote_lan` | boolean | Bind all interfaces (LAN) vs 127.0.0.1 only (default false) |
| `remote_token` | string | Pairing token; minted on first enable, regenerable |
| `user_fonts` | array | User-installed fonts: `[{id, family, label, filename, path, ext}]`. Files live in `userData/fonts/`; served via cue-media://. Included in backups (paths rewritten on restore), wiped by factory reset |
| `libreoffice_path` | string\|null | User-set absolute path to the `soffice` binary (Locate manually…), tried first by `findLibreOffice()` for PowerPoint import |
| `program_audio_device` | object\|null | In-room program-audio output device `{deviceId,label,groupId}`; `null` = system default. The audible (primary) output window routes its media element there via `setSinkId`, matching deviceId→label→groupId (device IDs are salted per-origin). Machine-specific (rides backups but degrades to default if the device is absent) |
| `stream_config` | object | RTMP stream settings `{server,key,width,height,fps,videoBitrate,audioBitrate}`. `server`+`key` form the ingest URL; `key` is sensitive (lives in the synced DB) |
| `stream_studio` | object | Stream Studio inputs + layout `{videoDeviceId,videoLabel,audioDeviceId,audioLabel,audioMode:'external'\|'mixed',layout:{mode,lyricsOverFeed,pip}}`. Device labels persist because deviceIds re-salt per session/origin. Machine-specific |

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
- **Path containment:** before any fs access, the decoded path is checked by `isUnderUserData(p)` (`path.resolve(p)` must sit under `app.getPath('userData')`); anything outside (a crafted `cue-media://localhost/etc/passwd` or a `../` traversal) returns `403`. Every file these protocols legitimately serve — media, thumbnails + their source, user fonts, yt-cache, bin — lives under userData, so the guard is non-breaking. Applies to both `cue-media://` and `cue-thumb://`.
- Supports HTTP range requests (for video seeking), serving a `206` with `Content-Range`
- **Bodies are streamed, never buffered.** Both the ranged (`206`) and full responses are `fs.createReadStream(...)` piped through `Readable.toWeb(stream)`. A `<video>` opens playback with an open-ended `bytes=0-`; reading that into a single `Buffer` froze the main process and spiked memory on multi-GB clips (a one-hour YouTube download), and a fixed-size chunk cap starved the player of the multi-MB `moov` index so the clip only looped its first few seconds. A lazy stream serves any range with bounded memory and lets Chromium read/seek/cancel freely — it cancels the open-ended request and re-asks for specific windows, so the whole file is never read.
- Returns `Response` with correct MIME type and `Cache-Control: public, max-age=31536000, immutable` — Chromium serves from disk cache after first load so repeated media displays do not re-read from disk
- Responses also carry `Access-Control-Allow-Origin: *` so the output window's program-audio tap (`captureStream` → Web Audio, §13) can read the cross-origin (`file://` → `cue-media://`) media without tainting; the foreground media element sets `crossOrigin='anonymous'`

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

### Content-Security-Policy (packaged only)

`main/index.js` sets a CSP via `session.defaultSession.webRequest.onHeadersReceived`, gated to `app.isPackaged` — dev is skipped so Vite HMR (inline/eval + `ws:`) keeps working. The policy allows the app's real remote dependencies — **Google Fonts** (`fonts.googleapis.com`/`fonts.gstatic.com`, for Material Symbols) and **HuggingFace** (`connect-src`, for the WebGPU ASR model fetch; ORT-web WASM is served locally so only `'wasm-unsafe-eval'` + `blob:` workers are needed) — while blocking inline/remote scripts, `<object>`, and locking `base-uri`/`frame-src`. For `script-src 'self'` to hold, `vite.renderer.config.js` sets `build.modulePreload.polyfill = false` (Electron's Chromium supports modulepreload natively), removing the only inline `<script>` from the built HTML. Adding a renderer feature that fetches a new remote origin requires widening the matching CSP directive.

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

**Download command** (`downloader.js`): format `bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/...` (prefer h264 ≤1080p for hardware decode, avoid 4K-AV1 software-decode stutter in the offscreen NDI window), `--merge-output-format mp4 --remux-video mp4`, `--concurrent-fragments 5` (parallel DASH fragments — faster, no quality loss; also the throttle-defeating access pattern), and `--postprocessor-args "ffmpeg:-movflags +faststart"` (moov atom at front; without it a long clip black-screens on go-live while the player fetches the tail index).

**Anti-bot client cascade.** YouTube increasingly walls downloads with "Sign in to confirm you're not a bot" / "Please sign in". Every yt-dlp invocation (`resolveMetadata`, `download`) runs through `withClientCascade()`, which tries ordered client *tiers* and escalates on failure: (1) **default** (no extra args); (2) **`web_embedded`** (`--extractor-args youtube:player_client=web_embedded` — the embeddable IFrame player, no login/PO-token, but embeddable videos only); (3) **`cookies`** (`--cookies-from-browser <browser>`) — present *only* when the operator has opted in via the `youtube_cookies_browser` setting. Escalation rule (`looksLikeBotWall` / `isFatalError`): a **fatal** error (removed/deleted/region-locked) surfaces immediately; a **stale-binary OR bot-wall** error refreshes yt-dlp once and retries the same tier (a bot-wall is most often just an out-of-date yt-dlp, since `refreshYtDlp` drops the latest build into `userData/bin` which `resolveBinary` prefers over a stale PATH copy); anything else escalates to the next tier. Metadata settles on a working tier and the download stage resumes from it (`tierIdx`). On exhaustion, `friendlyError()` turns a bot-wall (`botWallSeen` across all tiers) into "turn on browser login" guidance when no browser is configured. Cookies are read by yt-dlp directly from the browser store and never persisted/logged by Cue.

**Pre-fetch / status flow.** Latency is hidden by pre-fetching: the download starts the moment a valid URL is pasted (speculatively, before Confirm — `AddYouTubeModal.jsx`). If the URL is edited before Confirm, the speculative download is abandoned and the submitted URL fetched. Status is `setup (first-use binary download / yt-dlp refresh) → resolving → downloading (percent) → processing → ready | error`, pushed live to all windows over the `youtube:status` event and surfaced as a rundown badge (`RundownPanel`) and in the modal (with a Retry on error). `services.resolveItems` attaches the current status as `item.youtube`; `OperatorView` patches it live from the event and re-prefetches any `idle` cue on load. GO is soft-blocked until `ready` (`buildPayload` returns null otherwise), then resolves the ready path into a normal full-screen media payload (`{ media: { path, type:'video', loop } }`).

**Clipboard detection.** On entering the Media tab, `LibraryPanel` reads the OS clipboard once via `window.cue.youtube.readClipboard()` (Electron main-process `clipboard.readText()` over the `clipboard:readText` IPC — silent, no permission prompt, never polled). If it holds a YouTube link (`utils/youtube.js → looksLikeYouTube`), a one-click chip offers to add it; clicking opens `AddYouTubeModal` with `initialUrl` pre-filled and already resolving. The link is offered once per distinct clipboard value (a `clipboardSeenRef` marks add/dismiss) so re-entering the tab does not re-nag. Editing/pasting a different URL in the modal cancels the in-flight resolve and switches to the new one (`startSpeculative`).

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
| `search(query)` | `[{id, title, author, tags}]` | FTS5 prefix search (apostrophe-insensitive, v26). Strict AND-prefix hits first, then a lyric-tolerant **OR-recall fallback** (`_rankByOverlap`) appends phrase/coverage-ranked songs strictly below them — so a misremembered or extra word in a typed/pasted lyric line still surfaces the song. Empty/null query returns all. See §16. |
| `listAll()` | `[{id, title, author, copyright, default_background_id, tags:[...]}]` | Full list with tags. |
| `get(id)` | `{id, title, author, copyright, default_background_id, background_path, sections:[...], tags:[...]}` | Full song with sections ordered by order_index. |
| `create(data)` | `id` | data: `{title, author, copyright, sections:[{type,content,style_json}], tagIds:[]}` |
| `update(id, data)` | void | Same shape as create. Sections rebuild replaces all existing. |
| `delete(id)` | `{hasReferences: bool, count: number}` | Refuses if referenced by service_items. |
| `addTag(songId, tagId)` | void | — |
| `removeTag(songId, tagId)` | void | — |
| `setBackground(songId, mediaId\|null)` | void | Sets songs.default_background_id. |
| `setLock(songId, locked)` | void | Sets songs.background_locked (0/1). Pins the song's bg at the top of the resolution cascade (§9); bulk apply + per-slot override writes skip a locked song. |
| `deleteAll()` | void | Deletes all songs, their sections, taggables, and all song-type service_items. Irreversible. |
| `importParse(filePaths)` | `[{ok, file, format, title, author, copyright, sections, tags?, error?}]` | Parses song files (no DB write). Auto-detects OpenLyrics XML / ChordPro / text / EasyWorship SQLite (one .db → many rows). Per-file failures returned as `{ok:false, error}`. |
| `importGhs()` | same row shape, all `format:'GHS'`, `tags:['GHS']`, with `existing:bool` | Parses the bundled GHS hymnal; flags rows already in the DB. |
| `importCommit(parsedSongs)` | `{count, ids}` | Bulk-creates songs in one transaction. Each `song.tags[]` (names) is get-or-created and assigned. |
| `matchTitles(rawText)` | `[{input, match:{id,title,author}\|null, alternates:[{id,title,author}], confidence}]` | Paste-Song-List matcher. Parses a dirty pasted set list into entries and matches each (lyric-first) against the library. `confidence` ∈ `exact`\|`high`\|`low`\|`none`. See §16. |

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
| `applyBackgroundToRundown(serviceId, mediaId)` | `count` | Sets background_override_id on every unlocked song slot AND updates each unlocked song's default_background_id. Locked songs skipped. |
| `exportPdf(serviceId)` | `{canceled}` \| `{canceled:false, path}` | Exports the rundown's lyrics as a printable PDF. Opens a native Save dialog, then renders the resolved rundown to PDF. No file is written unless the user picks a path. See §4 `export/rundown-pdf.js`. |

**`resolveItem()` shape** — what `services:get` returns per item:
```js
{
  // All service_items columns (id, service_id, item_type, ref_id, order_index, notes, content, background_override_id)
  song: { id, title, author, copyright, default_background_id, background_locked,
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
| `media.setLoop(loop)` | void | Toggle native looping of the live clip live, without restarting it. Sets `transport.loop` + broadcasts; output players make `<video>.loop` follow `transport.loop` (`media-player.js`). The operator's transport-bar loop button persists `media_loop` (`services.setItemLoop`) alongside this so it sticks for the rundown badge + next GO. |
| `media.setRate(rate)` | void | Operator playback speed (e.g. 0.25–2). Rebases `startAt` so position is continuous; becomes the baseline the ±6% convergence nudge multiplies around. |
| `graphic.show({name,title,style,target,autoDismissSec})` | void | Show the name/title lower-third bug. `target` ∈ `'all'\|'screen'\|'ndi'`. `autoDismissSec>0` self-hides after that many seconds (main-owned one-shot timer per slot+kind; §13). |
| `graphic.hide()` | void | Hide the name/title bug. |
| `graphic.showCustom({html,target,autoDismissSec})` | void | Show a custom-HTML graphic (placeholders already substituted). `autoDismissSec>0` self-hides. |
| `graphic.hideCustom()` | void | Hide the custom graphic. |
| `ticker.show({text,speed,style,target,autoDismissSec})` | void | Show the scrolling ticker. `autoDismissSec>0` self-hides. |
| `ticker.hide()` | void | Hide the ticker. |
| `countdown.show({id,mode,source,durationSec,targetClock,format,showSeconds,label,endMessage,style,target})` | void | Show a self-ticking countdown/count-up/clock. Main resolves the anchor (`endsAt` for `mode:'countdown'`, `startAt` for `'countup'`); the output template owns the per-second tick. `style` = `{time, message}`. |
| `countdown.hide()` | void | Hide the countdown/clock. |
| `overlay.get()` | `{nameTitle, ticker, custom, countdown}` | Current overlay snapshot. |
| `stage.message(text)` | void | Set/clear the confidence-monitor presenter **immediate** message (`''` clears). Takes precedence over scheduled messages on the bar. |
| `stage.timer(action, seconds?)` | void | Presenter countdown: `action` ∈ `'set'(seconds) \| 'start' \| 'pause' \| 'reset'`. |
| `stage.getSchedule()` | `[{id, text, showAt, clearAt}]` | Current pending scheduled messages (absolute epoch-ms anchors; `clearAt:null` = no auto-clear). |
| `stage.schedule({text, afterSeconds?, atHour?, atMinute?, clearAfter?})` | `[scheduled]` | Queue a timed message. `afterSeconds` = countdown from now; `atHour`/`atMinute` = next occurrence of that wall-clock time; `clearAfter` (seconds, falsy=never) = auto-clear. Main resolves the absolute `showAt`/`clearAt` once via `resolveAnchors` and returns the updated list. |
| `stage.unschedule(id)` | `[scheduled]` | Remove a pending scheduled message; returns the updated list. |
| `lowerthird.setFontScale(pct)` | `number` | Set the **global lower-third font scale** (percent, clamped 1–150). Persists the `lowerthird_font_scale` setting and re-broadcasts the live slide so on-air lower-thirds restyle instantly. Returns the clamped value. Only the lower-third output is affected; fullscreen ignores it. |
| `channels.list()` | `[output_channel rows]` | — |
| `channels.create(data)` | `channel` | NDI channels open a BrowserWindow immediately; screen channels wait for monitor assignment. `data.ndi_audio_muted` / `data.show_program` / `data.show_graphics` (all default 1). |
| `channels.update(id, data)` | `channel` | A change to **only** `show_program`/`show_graphics` is applied at runtime (`setChannelContentMode` → `content:mode`, no window recreate); any other field rebuilds via `syncChannel`. Emits `output:state-changed`. |
| `channels.delete(id)` | void | Closes window(s) and cascades to channel_monitors. |
| `monitors.list(channelId?)` | `[channel_monitor rows]` | Pass channelId to filter. |
| `monitors.create(channelId, {display_bounds, label})` | `monitor` | Assigns a physical screen to a channel and opens its BrowserWindow. |
| `monitors.delete(monitorId)` | void | Closes window and removes row. |
| `multiview.start()` | void | Begins capturing all output windows; emits `output:multiview-captures` at ~1fps (1s). NDI tiles use the cached paint frame; screen tiles use `capturePage()` (a full GPU readback that contends with live playback, so kept to 1fps with an in-flight guard against pile-up). Refcounted — interval starts only when count goes 0→1. |
| `multiview.stop()` | void | Decrements refcount; stops capture only when count reaches 0. Safe for multiple subscribers. |
| `screens.list()` | `[{id, bounds, scaleFactor, label}]` | All connected displays. |
| `audioDevice.get()` | object\|null | The configured in-room program-audio output device (`program_audio_device`), or null = system default. |
| `audioDevice.set(device)` | object\|null | Persist `{deviceId,label,groupId}` (or null) AND broadcast `audio:output-device` to live output windows so the in-room device changes without re-GO. |
| `stream.getConfig()` | object | RTMP `stream_config` (defaults merged). |
| `stream.setConfig(cfg)` | object | Merge + persist `stream_config`; returns merged. Recreates the idle preview window if resolution/fps changed. |
| `stream.start()` | `{ok,error?}` | Go Live: ensure ffmpeg, ensure the compositor window, spawn the encoder on the next frame, enable the stream audio tap. |
| `stream.stop()` | `{ok}` | Stop the encoder; keep the compositor window if the Stream tab is still previewing. |
| `stream.status()` | `{active, previewing, state, encoder, droppedFrames, sentFrames, backpressure}` | `state` ∈ `idle\|starting\|live\|reconnecting\|error`. |
| `stream.getStudio()` / `stream.setStudio(cfg)` | object | Read/merge+persist `stream_studio` (`videoDeviceId/Label`, `audioDeviceId/Label`, `audioMode`, `layout{mode,lyricsOverFeed,pip}`); set pushes live to the compositor. |
| `stream.open()` / `stream.close()` | studio / void | Ref-count the Stream tab: open starts the compositor for preview; close tears it down when not live. |

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
  ltFontScale: number | undefined,  // global lower-third font scale as a FRACTION (e.g. 0.7); fullscreen.js ignores it, lowerthird.js multiplies its font size by it. Default 1 when absent.
}
```

A presentation-slide payload carries `elements` (and a per-slide `backgroundPath`); `text`/`styleJson` are null. `fullscreen.js` `renderElements()` renders it on the scaled 1920×1080 `#slide-elements` layer; `lowerthird.js` blanks its band for `payload.elements` (a full-canvas item has no lower-third in v1). The operator monitor renders the same array via `PreviewLivePanel`'s `PresentationCanvas`. `manager.go()` is payload-opaque — it stamps the transport and forwards the payload unchanged, so the element array needed no transport changes.

**Media transport model** — foreground media (bumpers/clips) is synced across every surface (screen
outputs, NDI, operator live monitor, confidence monitor) by a single main-process `transport`:
```js
transport = { active, startAt, pausedAt, loop, muted }
// position(now) = ((pausedAt ?? now) - startAt) / 1000   (mod duration when loop)
```
`go()` stamps it; `mediaControl/mediaSeek/mediaSetMuted/mediaSetLoop/mediaSetRate` mutate it; `broadcastTransport()` pushes
`media:transport` to every output window and `output:media-transport` to the renderer. Each player
(`media-player.js`, stage video, `SyncedVideo`) derives its playhead from the shared machine clock —
no clock-master election, no per-window time reporting — and converges via `playbackRate` nudging
(hard-seek only on >0.5 s drift / scrub / pause). Looping uses the native `loop` attribute (single
element) for clean gapless audio. **Program audio comes from one window only** (`isPrimaryAudioMonitor`
→ `?mute=` query param); stage is always muted; `media.setMuted` layers a live program mute as
`el.muted = baseMuted || transport.muted`.

**Broadcast-graphics overlay bus** — an independent layer (name/title bug, scrolling ticker, custom
HTML, countdown/clock) separate from the program slide bus. Held in `manager.js` as `overlay = {
nameTitle, ticker, custom, countdown }`, where **each slot holds one occupant PER DESTINATION KIND**:
`slot = { screen, ndi }` (each `null` or a slot-value object). This lets a *different* graphic of the
same type run In-Room vs Online simultaneously (e.g. two different tickers). `setSlot(name, value, target)`
writes the kind(s) named by `target` — `'all'` fills both, `'screen'`/`'ndi'` fills just one and leaves
the other running; `*Hide(target)` clears the same way (no target = clear both). The slot-value object is
unchanged in shape (`{ id, …, target }`) and carries the originating graphic's **`id`** so the operator UI
matches "what's live" by identity, not by content (two graphics sharing a text body no longer both light
up); ad-hoc fires like the quick ticker carry no id. `broadcastGraphic()` sends a per-window `graphic:update`
to **every non-stage output window** (fullscreen + lower-third, matched by URL in `getGraphicsWindowInfos`)
carrying `overlayForKind(kind)` = that window's-kind occupant of each slot (numeric map key = screen/in-room,
`ndi-*` = online), and notifies the renderer via `output:overlay-changed` (the full `{screen,ndi}` shape;
`GraphicsPanel.liveDests(g)` / `PreviewLivePanel` pick per kind). Rendered by the shared
`src/output/graphics-overlay.js` (injects its own DOM + styles, honours `?graphics=0` and `content:mode`).
A program `go`/`clear`/`logo` never touches the overlay, and a graphic never touches the program. Default
destination for new graphics is **Online (NDI)**.

**Auto-dismiss** — a name/title, ticker, or custom graphic can carry `autoDismissSec` (authored in
`style_json`, fired through the existing `*Show` data). `>0` arms a **main-owned one-shot `setTimeout` per
`(slot, kind)`** (`dismissTimers` map in `manager.js`) that nulls that slot+kind and `broadcastGraphic()`s
when it fires — NOT a per-second stream over the bus (same discipline as the countdown anchor). The timer
identity-checks `overlay[name][kind] === expected` before hiding, so a graphic that has since replaced this
one (each `*Show`/`*Hide` re-arms or clears the slot's timer) is never yanked out from under the new
occupant. The fired slot value carries an absolute `dismissAt` for operator-side display only
(`GraphicsPanel` cards show a locally-ticked "auto · Ns" badge). On Scene recall `reviveSlotValue` re-stamps
a fresh `dismissAt` and `applyScene` re-arms the timer full-length (a stored absolute `dismissAt` would be
stale). Countdowns are excluded — they own their own end behaviour. `autoDismissSec` lives only in
`style_json` (no schema column), so it round-trips through scene snapshots and graphic CRUD untouched.

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
| `presets()` | `[{ id, name, kind, graphic }]` | Built-in design presets read at request time from `resources/graphics/` (NOT DB rows): `*.html` → `kind:'custom'` (`graphic:{ html }`, `<!-- name: … -->` header, comment stripped); `*.json` → structured `lower_third`/`ticker`/`countdown` (`graphic` = partial graphic record incl. `style_json`). The gallery offers these; picking one creates an ordinary graphic. |

The graphic-fire methods (`window.cue.output.graphic.show/hide`, `ticker.show/hide`, `graphic.showCustom/hideCustom`, `countdown.show/hide`) take an `id` in their `show` payload (so liveness matches by identity) and an optional `target` on `hide` (clears one destination kind; omitted = both). See the overlay-bus note in `window.cue.output`.

### `window.cue.scenes` (v24 — multi-output state recall)

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[scenes rows]` | Ordered by `order_index, id`. Rows carry `overlay_json` as a string. |
| `get(id)` | `scene row` | — |
| `create(data)` | `id` | `data` = `{ name, hotkey, program, audio_muted, overlay }` (`overlay` object or null). Binding a `hotkey` frees it on any other scene. |
| `update(id, data)` | void | Same shape as create. |
| `delete(id)` | void | — |
| `reorder(orderedIds)` | void | Single transaction. |
| `apply(scene)` | void | Accepts a DB row OR a live-preview object; `normalizeScene` → `outputManager.applyScene` drives the live bus atomically (§13). Used by number-key recall, the panel's Take, and the editor's Test. |

### `window.cue.themes`

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[theme rows]` | Each row joins `background_path`/`background_filename`/`background_type`. Ordered by `builtin DESC, sort_order, name` (built-ins first within a category). Filter by `category` in the picker. |
| `get(id)` | `theme row` | — |
| `create(data)` | `id` | `data` = `{ name, style_json, background_id, category }` (category defaults `'song'`; preserved on duplicate). |
| `update(id, data)` | void | `{ name, style_json, background_id }`. |
| `delete(id)` | void | — |
| `applyToSong(themeId, songId, setBg)` | `sectionCount` | Merges style into the song's sections. With `setBg`: the handler first `await`s `resolveThemeBackground` (downloads a media theme's `bgRef`, no-op otherwise, §9), then writes the song default bg / clears per-slot overrides; a `bgCss` theme clears the media bg to NULL so the gradient shows. |
| `applyToRundown(themeId, serviceId, setBg)` | `songCount` | As above for every distinct song in the rundown. |
| `applyToAllSongs(themeId, setBg)` | `songCount` | As above for every song in the library. |

### `window.cue.backgrounds` (Background Library — Phase 1b)

Browsable pool of curated 16:9 worship backgrounds shipped only as a manifest (`resources/media-manifest.json`: tags + dims + hotlinked `thumb` + origin `url`). **Distribution Option A — never rehost:** the grid hotlinks each `thumb`; a pick downloads the origin `url` into the *same* local media library as any import (a normal `media_assets` row, `cue-media://`/`cue-thumb://`). `db/background-library.js`.

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[{ id, kind, source, width, height, tags, thumb, available, mediaId }]` | `mediaId` non-null = already downloaded; `available` false = origin `url` unresolved. No `url` leaves main. |
| `tagCounts()` | `{ tag: count }` | For the tag filter chips. |
| `download(id)` | `media_assets row` | Idempotent (settings `bg_library_downloads` map); streams the origin `url` into `userData/media`. |
| `applyAsDefault(id, surface, toAll)` | void | Downloads then sets the global default bg for `surface` (`'song'`/`'scripture'`/`'slide'`); `toAll` also applies across existing items. |

### `window.cue.media`

| Method | Returns | Notes |
|---|---|---|
| `import(filePaths)` | `[{id, filename, path, type}]` | Copies files to userData/media/. |
| `get(id)` | `media_asset \| null` | Single asset by ID. |
| `list(folderId?)` | `[media_asset]` | `null`/`undefined` → root (folder_id IS NULL). Pass folder id for subfolder. |
| `listAll()` | `[media_asset]` | Flat list of every asset across all folders. Used by the command palette's media search (`list` only returns one folder). |
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
| `readClipboard()` | `string` | OS clipboard text (Electron main `clipboard.readText`). Used by `LibraryPanel` to detect a copied YouTube link on Media-tab entry. Silent, on-demand only. |

The downloaded file is **ephemeral** — never a `media_assets` row (see §6 *Native YouTube player*).

### `window.cue.settings`

| Method | Notes |
|---|---|
| `get(key)` | Returns JSON-parsed value or null. |
| `set(key, value)` | JSON-encodes value, upserts. |
| `setGlobalLogo(mediaId\|null)` | Sets `global_logo_id`. |
| `setGlobalBackground(type, mediaId\|null)` | type: `'song'`, `'scripture'`, or `'slide'`. |
| `applyBackgroundToAll(type, mediaId)` | Song type only: sets default_background_id AND clears the per-slot override on every **unlocked** song (locked songs skipped). |
| `getDiskUsage()` | Delegates to media.getDiskUsage(). |
| `getDataPath()` | Returns app.getPath('userData'). |
| `openDataFolder()` | Opens userData in Finder/Explorer. |
| `exportBackup()` | No args — shows a native save dialog (`Cue <date>.cuebackup`), then writes a gzipped tar of `cue.db` + `media/`. Returns `{ok, path, size}` or `{ok:false, canceled}`. |
| `importBackup()` | No args — shows an open dialog, validates the archive, swaps `cue.db` + `media/` + `fonts/` on disk (media + user-font paths rewritten to this install), then relaunches the app (~400ms after the IPC reply). Returns `{ok}`, `{ok:false, canceled}`, or `{ok:false, error}` (validation/extract failure leaves the install untouched). |
| `factoryReset()` | No args — closes the DB, deletes `cue.db` (+wal/shm), `media/` and `fonts/`, then relaunches as a fresh install (DB + bibles + GHS re-seed on boot). Returns `{ok:true}`. Danger Zone "Reset app to defaults". |
| `checkForUpdate()` | Queries the GitHub Releases API for `will-eze/Cue` (public repo, anonymous HTTPS — no token/`gh`). Returns `{ok, current, latest, isNewer, asset:{name,url,size}, notes}` when a newer version exists, `{ok, current, latest, upToDate:true}` when current, or `{ok:false, current, error}`. |
| `downloadUpdate(asset)` | Streams the asset to `temp/`, emits `update:progress`, strips the macOS quarantine xattr, opens the installer, then quits (~1.2s later). Returns `{ok, path}` or `{ok:false, error}`. |

### In-app updater (`src/main/update/updater.js`)

Manual "Check for Updates" button in the SettingsView footer (`UpdateChecker`). Pulls Cue's own updates across an owned fleet with **no auth, token, `gh` CLI, or Apple Developer ID** — the repo is public, so the GitHub Releases API and asset downloads are anonymous HTTPS, like a browser.

- **Takes `/releases[0]`, never `/releases/latest`** — CI publishes *prereleases*, and `/latest` skips them, so `/latest` would always report "up to date". Index 0 is the newest release including prereleases.
- **Asset chosen by file extension** (`.dmg` on darwin, `…Setup.exe` on win32), never a name template — real asset names are `Cue.dmg` and `Cue-<ver>.Setup.exe` (no arch/version pattern on the dmg). No `RELEASES`/`.nupkg` are uploaded.
- Version compare is `semver` against `app.getVersion()`. Tag `v26.1.0` → `26.1.0`.
- Download follows GitHub's redirect to the asset host (Node's `https.get` does **not** auto-follow), streams to disk (never buffers), reports `{received,total}`.
- **Strips `com.apple.quarantine`** after download: a quarantine xattr on the ad-hoc-signed app is a Gatekeeper hard-block. (Programmatic Node downloads usually aren't quarantined — unlike browser downloads — so this is belt-and-braces, verified working on macOS.)
- This is "Option A" (manual one-click). True silent auto-update ("Option B", Electron `autoUpdater`) is blocked on macOS by ad-hoc signing (needs a $99 Apple Developer ID + notarization); Windows could do it but the squirrel `RELEASES`/`.nupkg` artifacts aren't published. See `deployment-handoff.md` for signing.

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
- `output:overlay-changed` — fired after any broadcast-graphics change; payload is the full `overlay` object — each slot a `{screen, ndi, stream}` shape. The Graphics panel + live monitor follow it.
- `output:media-transport` — fired whenever the media transport changes (go / play / pause / restart / seek / setMuted / setLoop / setRate); payload: `{ active, startAt, pausedAt, loop, muted, rate }`. The operator UI follows this to drive `SyncedVideo` and the transport bar; output players make `<video>.loop` follow `transport.loop` so a live loop toggle applies without re-GO. (There is NO `output:media-time` event — the old clock-master time-reporting chain was removed.)
- `youtube:status` — fired as an ephemeral YouTube download progresses; payload: `{ id, url, status, percent, title, durationMs, path, error, setupName }` (`setupName` = which binary is downloading during the `setup` state). The Media-tab modal, the rundown status badge, and `OperatorView` (which patches the matching cue by URL) all follow it. See §6 *Native YouTube player*.
- `output:multiview-captures` — array of `{channelId, dataUrl, isNdi}` objects (~1fps, only while multiview is running). `isNdi: true` for NDI channels (sourced from `ndiLastFrames` JPEG cache at ~1fps); `isNdi: false` for screen channels (capturePage, also ~1fps with an in-flight guard so a slow readback can't pile up and stutter live playback).
- `stream:status` — RTMP stream state changes + ~1Hz health; payload `{active, state, detail?, encoder?, droppedFrames?, sentFrames?, backpressure?}` where `state` ∈ `idle\|starting\|live\|reconnecting\|error`. The Stream tab derives a Stable/Unstable dropped-fps badge from successive frame counts.
- `output:stream-preview` — ~10fps downscaled JPEG data-URL of the stream composite, for the Stream-tab monitor (preview only, not stream quality).
- `output:stream-levels` — `{l, r}` stereo peak levels (0..1) from the stream audio mix, for the Stream-tab meters.
- `output:ndi-unavailable` — fired if grandiose is not installed
- `shortcut:next` / `shortcut:prev` — reserved for future hardware remote
- `remote:command` — a network-control command `{action, itemId?, slideIdx?}` (action: go/clear/logo/next/prev/live/select). OperatorView dispatches it to the same handlers the keyboard uses, so the remote stays in sync with the UI.
- `stage:schedule` — `{scheduled: [{id, text, showAt, clearAt}]}`, fired after any scheduled-stage-message add/remove/prune. The `StagePanel` pending list follows it; the stage output windows also receive it directly. Anchors are absolute epoch-ms (`clearAt:null` = open-ended).
- `update:progress` — `{received, total}` during an in-app update download. The SettingsView `UpdateChecker` shows it as a percentage. See §7 *In-app updater*.

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
  "ltBar":         null,       // { color, opacity, solid, css? } — lower-third bar; null = transparent
  "bgCss":         null,       // CSS background string (gradient/solid) — theme background with no media asset (§9)
  "bgScrim":       null,       // 0..1 black overlay opacity between background and text (legibility); null/0 = off
  "bgRef":         null,       // media-library manifest item id — a media theme's background, resolved lazily on apply (§9)
  "bgThumb":       null,       // hotlinked poster URL — PREVIEW-ONLY (theme cards/SlidePreview), never written to a section
  "runs":          []          // [{start, end, bold, italic, underline, color, fontFamily, fontSize}]
}
```

`null` on any property means "use template defaults." `textBox` and `verticalAlign` apply only to fullscreen channels. `ltBar` applies only to lower-third channels (`null` = transparent background, no bar); a built-in theme may set `ltBar.css` (a gradient/solid string) which wins over the computed rgba fade. `SongEditor.jsx` calls `serializeStyle()` to convert to JSON; saves `null` when all values are default (`styleIsDefault` also counts `bgCss`/`bgScrim`).

**Theme-pack additions** (`bgCss`, `bgScrim`, `bgRef`) ride inside `style_json` rather than new DB columns, so they flow through the existing `applyTo*` merge into `song_sections.style_json`. `bgThumb` exists only in preview props. Scripture themes additionally carry a top-level `refStyle` object (the reference-line style), applied to `scripture_ref_style_json` on theme load — it is not a section style key.

`renderWithRuns(text, runs)` is exported from `SongEditor.jsx` and used in `PreviewLivePanel.jsx` to render text with run-level styling in the monitor frame. Output templates have an equivalent inline copy. Runs support `underline`.

**Variable-size section splitting.** A single section can render as multiple display slides while staying **one logical section** in `song_sections`. The split point is an inline `⁂` (U+2042) marker in `content` — symbol-only, so it is invisible to `songs_fts` (unicode61 tokenizer) and the lyric matchers (`db/songs.js` `_norm`, paste-list, future song detection), and needs **no schema change**. `utils/sectionLabels.js` owns the logic: `splitSectionContent(content)` → parts, `expandSongSections(sections)` → the flat slide list `getSlides()` returns for songs (one slide per part; labels are computed at the section level so all parts share "Verse 1", with `_partIndex`/`_partCount` for the operator's "1/2" chip). The editor stores the canonical glyph but renders it as a styled non-editable divider; the EW importer turns a verse's blank-line-separated slides into `⁂` markers (§4 `songs-import.js`).

---

## 9. Background Resolution Order

When building the output payload, `resolveBackground(item)` in `OperatorView.jsx` follows a single flat cascade — **lock → override → song → live global → black**:

```
1. song.background_locked → item.song.default_background.path  — LOCKED song's pinned bg
                                                                  (ignores override AND global below)
2. item.background_override.path        — per-rundown-slot override (set via context menu)
3. item.song.default_background.path    — per-song default (songs:setBackground / song editor)
4. songGlobalBgPath / scriptureBgPath / slideBgPath  — LIVE global type default (from settings)
5. null → black screen
```

The global default is read **live** for songs, scripture and slides alike: changing it applies immediately to every unlocked item still on the default — no per-entity snapshot. `songGlobalBgPath`/`scriptureBgPath`/`slideBgPath` are loaded by `OperatorView.loadScriptureDefaults()` via `window.cue.media.get(id)`, refreshed on `bgRefreshTick`, after `ScriptureEditor` saves (`onScriptureStyleSaved`), and after a Media-tab "Set as Global … Background" (`onBackgroundDefaultChanged` → wired from `LibraryPanel.handleSetBackground`). The resolved `backgroundPath` is an absolute filesystem path passed in the output payload; output windows convert it to `cue-media://` via their inline `pathToUrl()`.

A **locked song** (`songs.background_locked = 1`) pins its own `default_background_id` at the top of the cascade — the per-slot override and the live global are both ignored, and the two bulk apply actions skip it. The lock is toggled per song in `SongEditor` (`window.cue.songs.setLock`), beside a source badge (`Locked` / `Song` / `Global` / `None`) that shows where the shown background comes from. `output/manager.js resolveBackground()` mirrors the same cascade (it is an exported helper; the renderer copy is the live source of truth).

The **rundown row thumbnail** (`RundownPanel` `SortableItem`) resolves through the exact same cascade: `OperatorView` passes `resolveItemBg={resolveBackground}` down so the row preview matches what GO will send (including the live global fallback), not just the song's own stored background.

Custom slides use `global_bg_slide_id`; songs use `global_bg_song_id`.

**Scripture** has no per-entity record, so the global default stands in for the per-song layer:
```
1. item.background_override.path   — per-rundown-slot override (rundown items only)
2. scriptureBgPath                 — global scripture default (settings.global_bg_scripture_id)
3. null → black screen
```
`OperatorView.loadScriptureDefaults()` reads `scripture_style_json` (verse), `scripture_ref_style_json` (reference) and `global_bg_scripture_id` (resolved to a path), refreshed on `bgRefreshTick` and after `ScriptureEditor` saves (`onScriptureStyleSaved`). `getSlides()` injects the verse style + `_refStyle` into scripture slides for the monitors; `resolveBackground()` falls back to `scriptureBgPath`. Both the rundown path (`buildPayload`) and the live-from-tab path (`handleScriptureLive`) carry `copyrightStyle` + `copyrightAlign:'right'`.

### Background write-through (cross-rundown persistence)

Setting a background on a rundown slot via "Set Background Override" **also writes to the song's own `default_background_id`**. This means the background follows the song into any new rundown it is later added to. Code paths:

- `services.setItemBackground(itemId, mediaId)` — DB function; writes `service_items.background_override_id` AND `songs.default_background_id` when the item is a song. **Skips a locked song entirely** (writes nothing) so the lock holds end-to-end.
- `services.applyBackgroundToRundown(serviceId, mediaId)` — DB function; for every **unlocked** song in the rundown sets the per-slot override AND the song's `default_background_id`; locked songs are skipped. Returns the affected-song count.
- `settings.applyBackgroundToAll('song', mediaId)` — "Write to all songs in library": for every **unlocked** song sets `default_background_id` AND **clears its `service_items.background_override_id`** (so even slot-overridden songs flip — the override sits below the song level in the cascade and must be cleared to show). Locked songs are skipped.

The renderer's `RundownPanel` also calls `window.cue.songs.setBackground` after the picker resolves, as a belt-and-suspenders measure.

**Applying a theme is the inverse write-through**: when a theme with a background is applied (`themes.applyTo*` with `setBg`), it writes `songs.default_background_id` *and* NULLs the per-slot `service_items.background_override_id` on the affected song slots — so the theme background wins over an override that was previously written into a slot (resolution order puts override above the song default). A text-only theme (no `background_id`) never touches backgrounds or overrides. A **gradient theme** (`bgCss`, no media) clears `default_background_id` to NULL so the CSS gradient actually shows (a media path would otherwise win — see below).

### Theme backgrounds: media vs CSS vs lazy media-library ref

A built-in theme carries its background in one of three ways, resolved at output time after the normal path lookup:
1. **`background_id`** (a `media_assets` row) — behaves like any media background.
2. **`style_json.bgCss`** (a license-free CSS gradient/solid) — used only when no media path resolves. `output/fullscreen.js setBackground(path, bgCss)` sets `bg.style.background = bgCss` when `path` is null; lower-third uses `ltBar.css` similarly. `SlidePreview`/`MonitorFrame` mirror this. **Media path always wins over `bgCss`.**
3. **`style_json.bgRef`** (a media-library manifest item id, for the Phase 1b media themes) — the media isn't local until used. `themes.resolveThemeBackground(themeId)` is awaited by the three `applyTo*` IPC handlers when `setBg`: it downloads the `bgRef` item via the background library, caches the resulting asset id onto the theme's `background_id`, after which it is an ordinary case-1 media theme. No-op for gradient/text/local-media themes.

**Scrim:** `style_json.bgScrim` (0..1) is a full-bleed black layer rendered *between* background and text — `#scrim` in `output/fullscreen.js` (opacity clamped, cleared when no slide), plus `SlidePreview` and `MonitorFrame`. Lower-third/graphics-overlay output have no scrim (the LT bar handles legibility; the graphics bus is independent).

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
| `text-label-sm` | Inter | 12px / 16px | 500 | uppercase tracking-[0.05em] |
| `font-label-sm` | Inter | — | — | Pairs with `text-label-sm` |

Typography is **Inter everywhere** — body, headlines, and all labels/chips/badges/buttons/timecodes. The `mono`, `label-sm`, and `timecode-lg` Tailwind font-family tokens all resolve to Inter (the token names are retained for the many existing `font-mono` usages, but they are NOT a monospace face); apply the `tabular-nums` utility where digits must align. Inter is bundled in `src/fonts/` (`fonts.css`, loaded in the operator and every output window), so it always resolves. No monospace face is used for UI chrome. Operator UI, `index.css` (`.section-chip`, `.kbd-hint`), the stage template (`stage.css`), and the `PreviewLivePanel` monitor labels all use Inter.

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
| `@keyframes cue-ticker-crawl` | `translateX(0)`→`translateX(-100%)` horizontal crawl; ticker previews (gallery tiles, editor, live monitor, card thumbs) animate with it, duration = `scrollWidth/speed`, mirroring the output crawl |
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
- **Toasts:** the one transient-notification system is `components/Toast.jsx` — a `ToastProvider` mounted once at the root (`main.jsx`) exposing `useToast()` with `success`/`error`/`info`/`show`. `show({ message, kind, duration, action: { label, onClick } })` supports an action button (used for Undo). Settings pages and the operator use it; do **not** reintroduce per-page inline toast `<div>`s. The rundown remove/clear undo and the operator's add-confirmations route through it.
- **Error boundaries:** `components/ErrorBoundary.jsx` wraps each top-level view in `App.jsx` separately, so a render throw in one view shows a recoverable fallback ("Reload UI") instead of blanking the operator — output windows are separate processes and keep running. `main.jsx` also installs `window.onerror`/`unhandledrejection` loggers.

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
│  │  [Songs][Media][Scripture][Presentations][Graphics][Scenes]   │ │  ← ⌘. / ⌘, cycle tabs
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
selectedIds      — Set of service_items.id for bulk operations (multi-select),
                   independent of preview/live; selectionAnchorRef seeds Shift-range
```

### Interaction table

| Action | Result |
|---|---|
| Single-click rundown item | Sets `previewItemId`, resets `previewSlideIdx=0`, **clears the multi-select set** and reseeds the range anchor. No live change. |
| Ctrl/Cmd-click rundown item | Toggles it in `selectedIds` (multi-select); moves the range anchor. Does not change preview/live. |
| Shift-click rundown item | Selects the contiguous range from the anchor to the clicked item. |
| Drag on the rundown list (not the drag handle) | Marquee-select: hit-tests each row's rect, replacing `selectedIds`. dnd-kit reorder is unaffected (its listeners live only on the `.drag-handle`). |
| ⌘A / Ctrl+A | Selects **all** rundown items. Keyed on the OS clipboard modifier; defers to native select-all only when text is selected (clipboard rule). |
| Esc (with a selection) | Clears `selectedIds` first; only with nothing selected does Esc fall through to Clear-output (armed/flash gate). |
| Click outside the rundown panel | Clears `selectedIds` (disabled while the bulk-background picker — a portal'd modal operating on the selection — is open). |
| Double-click rundown item | Sets `previewItemId`, sends slide 0 to live. |
| Single-click in Preview Slides list | Updates `previewSlideIdx`. Preview monitor only. |
| Double-click in Preview Slides list | Sends that slide to live. |
| Single-click in Live Slides list | Sends that slide to live immediately. |
| GO button / bare G key | Sends `previewItem[previewSlideIdx]` to live. The bare `G` fires only when the keys are **armed** (see below); disarmed it's ignored. |
| Space | Advances **live** forward (`handleNextLiveSlide`): next live slide, rolling into the next rundown item at the boundary (also loads it into preview). If nothing is live, GOes the current preview. |
| ↓ arrow | `previewSlideIdx++`. Auto-GOes to live if `previewItemId === liveItemId`. At last slide → loads next rundown item. |
| ↑ arrow | `previewSlideIdx--`. Auto-GOes to live if `previewItemId === liveItemId`. At first slide → loads previous rundown item at its last slide. |
| Escape (bare) | `output:clear`, sets `liveItemId=null`. Fires only when armed; disarmed it's ignored (and flashes a "disarmed" notice). |
| L key | `output:logo`. |
| S key | Focuses the song search input in LibraryPanel (the GHS number field when the GHS folder is active). |
| Modifier+G/C/L/O | GO / Clear / Logo / Live Toggle (modifier and keys are configurable in Settings). Always instant, regardless of arm state. |
| Number key 1–9 | Recalls the scene bound to that hotkey (`window.cue.scenes.apply` → `applyScene`, §13). No modifier; only fires when a scene holds that `hotkey`. |
| ⌘K / Ctrl+K | Toggles the command palette (`CommandPalette.jsx`) — works from anywhere, even mid-typing. |
| ⌘. / ⌘, (Ctrl on non-mac) | Next / previous Library tab (`LibraryPanel` cycles via an imperative `cycleTabRef`). |
| Q W E R T Y U I O P A D F H J K (armed) | Positional verse/slide jump — airs slide N of the **live** item (`handleJumpLiveSlide`). Armed via `shortcut_arm_jump` (default off); the set skips S/G/L and the 1–9 scene keys. The live `SlideList` shows each slide's letter. |
| ? | Toggles the keyboard-shortcut overlay (`ShortcutsOverlay.jsx`). |
| Double-click song in Library | Adds to rundown. No preview/live change. |
| Single-click media (Media tab) | Adds to rundown (after a short timer that a double-click cancels). |
| Double-click media (Media tab) | Sets the **previewed** song/scripture item's background — a per-slot override via `services.setItemBackground`, with an Undo toast. Locked songs / non-song-scripture items are skipped with a notice. |

### Keyboard shortcuts
Registered as a `keydown` listener on `document` inside `OperatorView`. **Not** `globalShortcut`. The listener checks `document.activeElement` — suppressed when an `INPUT`, `TEXTAREA`, or `contenteditable` has focus.

Two ref patterns used to avoid stale closures:
- `shortcutRef.current` — assigned on every render (not in `useEffect`) so the handler always captures the latest state
- `shortcutsRef.current` — holds configurable key bindings loaded from settings DB (incl. `armBare`); reloads on `bgRefreshTick` changes
- `scenesRef.current` — the scene list for number-key recall; reloaded on `bgRefreshTick` and on the `cue:scenes-changed` window event the Scenes panel dispatches after a mutation
- `overlayOpenRef.current` — set on every render to `helpOpen || paletteOpen`; while an overlay is open the handler returns early so operator shortcuts don't fire underneath it (the overlay owns Esc/arrows).

**OS-modifier globals first.** `⌘K`/`Ctrl+K` (command palette) and `⌘.`/`⌘,` (Library tab nav) are handled at the very top of the keydown using the OS modifier (`isMac ? metaKey : ctrlKey`), *before* the input guard and the configurable-modifier branch — so they work regardless of the chosen shortcut modifier and even while typing. `⌘K` is checked before the overlay guard (so it can toggle the palette closed); the tab-nav keys after it.

**Modifier priority:** modifier+key shortcuts are checked first; if the modifier is held, bare-key shortcuts are skipped. Default modifier is `Meta` (Cmd) on macOS and `Ctrl` on Windows, matching the operator's `window.cue.platform`.

**Arm bare GO / Clear (`shortcut_arm_bare`, default true).** When armed, the bare `G` (GO) and `Esc` (Clear) fire on a single press. When disarmed, those two bare keys are ignored — a stray keystroke can't reach air — and the operator shows a brief "disarmed" pill; the operator still uses the configurable `⌘`-shortcuts or the on-screen buttons. The modifier shortcuts are never gated. Toggle lives in Settings → Shortcuts. (Earlier double-press arming was replaced by this on/off arm switch.)

**Command palette & cheatsheet.** `CommandPalette.jsx` (⌘K) is a cross-category launcher: one query searches Songs (`songs.search`), Scripture (`bible.resolve` on a typed ref like "John 3:16"), Scenes, Presentations and Media; Enter runs the result's primary action (add to rundown, or apply a scene) reusing the operator's existing `handleAdd*` handlers, then closes. `ShortcutsOverlay.jsx` (`?`, also opened by Settings → Shortcuts "View All") renders the live keymap from the configured shortcut settings.

**Clipboard-accelerator passthrough.** The default shortcut modifier is the same key as the OS clipboard modifier (⌘ on macOS, Ctrl elsewhere), so the default Clear binding (`c`) collides with copy. Inside the modifier branch, before dispatching any operator shortcut, the handler checks the real clipboard modifier (`isMac ? metaKey : ctrlKey`): if it is held and the key is **copy/cut with a live text selection** (`window.getSelection()` non-empty), it returns without `preventDefault`, letting Chromium perform the native clipboard op. So ⌘C/Ctrl+C copies when text is selected and still triggers Clear when nothing is selected. This is independent of the configured shortcut modifier (Alt-bound shortcuts never collided).

**⌘A / Ctrl+A → select-all rundown items.** Handled near the top of the keydown (after the input guard, keyed on the OS clipboard modifier so it is independent of the configured shortcut modifier) — it `preventDefault`s and selects every rundown item via `handleSelectAll`, **unless** there is an active text selection, in which case it returns to let native select-all win. The input guard already excludes text fields, so ⌘A in an input is native.

**Verse/slide jump keys (`shortcut_arm_jump`, default off).** When armed, the positional set `Q W E R T Y U I O P A D F H J K` airs slide 1, 2, 3 … of the **live** item (`handleJumpLiveSlide`) — direct on-air navigation, not stepping. The set is fixed and positional (same muscle memory every service) and deliberately skips the bare operator keys (S/G/L) and the 1–9 scene keys; out-of-range presses are no-ops. The live-column `SlideList` renders each slide's assigned letter when armed. Toggle in Settings → Shortcuts.

**Do not use `globalShortcut`** — it captures at OS level and prevents typing G, L, Space in any input field system-wide.

### Auto-advance / timed loops
A rundown item can carry a per-slide auto-advance interval (`service_items.advance_seconds`, set from the RundownPanel context menu → Auto-Advance modal). When that item is live, a `useEffect` keyed on `(liveItemId, liveSlideIdx, liveScripture, serviceData)` arms one `setTimeout`; on fire it calls `handleAutoAdvance` via `shortcutRef.current`. The effect re-runs on every live slide/item change, so each advance restarts the countdown; scripture-live (synthetic, not in the rundown) and items without an interval are skipped. `handleAutoAdvance` reads the live item's `advance_loop`/`advance_wrap`: `'item'` bounces back to slide 0 of the same item (forever); `'rundown'` steps forward like Space and, at the end of the rundown, wraps to the first item or stops based on `advance_wrap` (stopping = no state change = no new timer). The whole feature is renderer-side — it reuses the same handlers as the keyboard/remote, never resolving slides in main.

### Section labels (numbered verses)
`utils/sectionLabels.js` is the single source of truth. A section type is numbered only when it repeats within the song — three verses → "Verse 1 / Verse 2 / Verse 3", a lone chorus stays "Chorus" (numbering is derived from the ordered list, never stored). `buildPayload`/`nextSlideInfo` use `labelForSlide()` so the stage/confidence display gets the numbered `sectionLabel`; `SlideList` (abbrev forms) and the song editor's ordinal badge use it too. Scripture/media slides pass through unchanged (each "type" is unique → no number). For songs, `getSlides()` first runs `expandSongSections()` (§8) so a split section becomes several navigable slides (GO/NEXT/PREV/SELECT operate per-slide, so parts are free); each carries a per-part `_label`/`_labelAbbr` that `labelForSlide`/`slidesForRemote`/`SlideList` prefer over the recomputed ordinal — all parts of a split verse keep the same label.

### Network remote integration
`OperatorView` listens for `remote:command` and routes go/clear/logo/next/prev/live/select to the same handlers as the keyboard (the remote is a "virtual operator", so UI state stays in sync — it is always mounted, CSS-hidden when off-view). `handlePrevLiveSlide` mirrors the space-driven `handleNextLiveSlide` backwards; `handleRemoteSelect(itemId, slideIdx?)` jumps live to an item (or a specific slide). A `useEffect` pushes the rundown (`slidesForRemote` per item) + selection to the server via `window.cue.remote.pushNavState` whenever it changes.

### Rundown multi-select & bulk operations
`OperatorView` owns `selectedIds` (a Set) and the bulk handlers; `RundownPanel` renders the interactions and bar. Selection is built by Ctrl/Cmd-click (toggle), Shift-click (range from `selectionAnchorRef`), marquee drag (viewport-coord rectangle hit-testing each row's `data-item-id` rect), and ⌘A (all). A marquee sets `suppressClickRef` so the trailing click doesn't reset the selection; it starts on any list mousedown **except** the `.drag-handle` (dnd-kit's only drag source), so reorder and marquee never conflict. Selected rows get a blue inset ring (distinct from preview's left-tally and live's red). A **bulk-action bar** appears at 2+ selected: *Background* (reuses `MediaPickerModal` → `handleBulkSetBackground`, applying `services.setItemBackground` per item, **skipping locked songs and non-song/scripture**, reporting the skipped count) and *Delete* (inline two-step confirm → `handleBulkDelete`). Selection clears on Esc, on a click outside the panel root (disabled while the bulk picker is open), or after a bulk delete. There is deliberately **no bare-key bulk delete** (live-show safety) — deletion is only via the bar's confirm.

### Editor undo/redo (`utils/useEditHistory.js`)
All four editors (`SongEditor`, `ScriptureEditor`, `GraphicsEditor`, `PresentationEditor`) share `useEditHistory(initial)` → `{ state, set, reset, undo, redo, canUndo, canRedo }`: a bounded (50-deep) past/present/future stack holding the editor's working document, committed to the DB only on Save (session-local, no IPC). `set(updater, coalesceTag)` merges a rapid run of same-tag edits (typing, slider drags) into one undo step; `reset()` seeds the initial DB load without recording a step. **The reducer must stay pure — coalesce bookkeeping happens in the `set`/`undo`/`redo` function bodies, never inside the `setHist` updater, because React StrictMode double-invokes the updater in dev and a ref mutation there clobbers the first snapshot** (the bug that made coalesced lyric typing record no undo step). `useUndoRedoKeys(undo, redo)` binds ⌘Z / ⌘⇧Z at the document capture phase (`stopPropagation`, Z only — never ⌘C/⌘X/⌘A) so it beats both the operator keydown and native text undo. `UndoRedoButtons.jsx` is the shared toolbar pair. SongEditor's contentEditable is uncontrolled: lyric input flushes into `sections` through history (coalesced per section), and undo/redo bump a `domSyncTick` that re-renders the active section's DOM from the restored state.

### Customisable top bar (`App.jsx` + `TopBarTabs.jsx`)
The top nav is data-driven: fixed Operator/Multiview/Stream/Settings tabs plus operator-pinned **extra** tabs (deep-links to Settings subsections, `settings:<id>`), persisted in the `topbar_tabs` settings key (capped at 6). `TopBarTabs` renders the extras (dnd-kit horizontal reorder, 5px activation so a click still navigates; ×-to-unpin) and a `+` picker of unpinned `SECTIONS` (exported from `SettingsView`) with a Reset-to-default. `navigateTo(tabId)` routes base views and `settings:<section>` deep-links (preserving the leave-Settings `bgRefreshTick` bump); `SettingsView` accepts `initialSection` + a `sectionNonce` and smooth-scrolls to that section (the nonce re-fires the scroll on re-click).

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

`go`/`clear`/`logo` each resolve a transition spec via `transitionFor(kind)` (reads the `output_transitions` setting, falls back to defaults, clamps duration 0–2000ms) and stash it in a module-scoped `pendingTransition`; `sendCurrentState()` reads it into every `slide:update` payload's `transition` field, then clears it — so it rides **exactly one** dispatch. Late-attach syncs (`sendStateToWindow`), `applyScene`, and output refreshes leave it null → `{type:'none'}` → no animation (Scenes stay atomic by design).

### Slide transitions (output-side)
The program-output templates animate slide changes via `transitions.js` (`window.CueTransitions`). Library (`type`): `none` (cut), `fade`, `slide-left|right|up|down`, `zoom-in|out`; each carries `durationMs` + `easing`. The engine clones the live `#stage` as a ghost overlay, renders the new content underneath, then animates: **fade/zoom keep the new background solid and fade/scale only the foreground in** (the fullscreen caller passes `fgSel:'#content'`) while the ghost fades out — so a same-background advance shows no black dip and the incoming text genuinely fades in (not a cut-in); **slides** move the whole frame. Latest-wins (settles any in-flight transition before starting), respects `prefers-reduced-motion`, uses `will-change` for GPU compositing. **Option 2 — video swaps always hard-cut**: the template forces `{type:'none'}` when the outgoing stage holds a `<video>` or the incoming payload carries one (a video background, a video item, a video presentation element, or a video logo), because two live decoders + the single-element transport clock don't mix (§6). The lower-third routes its whole band through the engine (no `fgSel`); the operator live monitor renders from payload and ignores `transition` (snaps). Configured in Settings → Motion per trigger (slide / logo / clear).

### Fullscreen template structure
`fullscreen.html` wraps the whole program layer in `#stage` (the transition clone unit; the `#cue-gfx` broadcast overlay stays outside it, never transitioned). Inside: `#background` for the full-bleed media, `#scrim` (a full-bleed black layer between background z0 and content z1), `#text-wrap` (absolutely positioned by JS via `textBox` percentage values) as the text container, `#logo-wrap` as a separate sibling for the logo overlay (never overwrites `#text`), and `#copyright`. The `applyStyle(s)` function sets `#scrim` opacity from `style.bgScrim` (clamped 0..1, cleared when no slide — §9), positions `#text-wrap` via CSS `left/top/width/height` percent strings, applies all style properties (verticalAlign, letterSpacing, uppercase, textShadow, textStroke, underline in runs) to the inner `#text` element. `setBackground(path, bgCss)` shows media when `path` resolves, else paints `bg.style.background = bgCss` (theme gradient/solid). `showLogo`/`hideLogo` toggle a `.logo-active` class on `#logo-wrap`.

### Lower-third template structure
`lowerthird.html` uses `#lowerthird` (bottom-anchored, full-width) containing `#text` and `#copyright` — the **lyric band** (program slide) only, handled by `lowerthird.js`. Background is always `transparent` by default — JS sets it from `ltBar` via `buildBarBg()`. The `applyStyle(el, s)` function applies all style properties including the bar background. Clear and logo events explicitly reset `ltDiv.style.background = 'transparent'`. The broadcast-graphics overlay is a separate, shared layer (`graphics-overlay.js`).

**Default alignment is CENTRE.** A song whose style is all-default saves `style_json = null` (because `align:'center'` is itself the default — see `styleIsDefault`), so the output receives `styleJson: null`. `applyStyle` therefore treats a missing style as `{}` and defaults `text-align` to `center` (and `#text` is `width:100%`, `lowerthird.css` also defaults centre) — it must **not** early-return on null, or centred lyrics render left (fullscreen never hit this because `fullscreen.css #text` already defaults centre). The same `style?.align || 'center'` default lives in the operator monitor (`PreviewLivePanel.MonitorFrame`) and the broadcast name/title bug (`graphics-overlay.js`, width:100%). Explicit left/right makes the style non-default → saved → applied normally.

**Lower-third font scale (global).** A single `lowerthird_font_scale` setting (percent, 1–150, default 100) lets the operator run a smaller relative font on the lower-third than on the screen. Main attaches it to every content payload as `ltFontScale` (a fraction); `lowerthird.js applyStyle(el, s, scale)` and `renderWithRuns(text, runs, scale)` multiply the font size by it, computing the base as `(Number(s.fontSize) || 72) * scale` — the **72px base mirrors the fullscreen default**, so at 100% the lower-third matches the screen and the operator dials it down. Fullscreen ignores `ltFontScale`. The operator preview mirrors this exactly: `PreviewLivePanel.MonitorFrame` takes an `ltFontScale` prop (only applied when `isLT`) using the same `(fontSize||72)*scale` formula, and passes the scale into the shared `renderWithRuns(text, runs, scale)` (in `SongEditor.jsx`, default `scale=1` so the editor/fullscreen are unaffected). `OperatorView` loads the scale in `loadScriptureDefaults` (so the preview refreshes on return from Settings, like every other global default); the real NDI/screen output updates **live** because `setLowerthirdFontScale` re-broadcasts the current slide. Authored in Settings → **Lower Third** (`LowerthirdSettings.jsx`).

### Broadcast-graphics overlay + lower-third content modes
The broadcast-graphics overlay (name/title bug, ticker, custom HTML, countdown) renders on **every non-stage output window** (fullscreen + lower-third + the stream compositor) via the shared `src/output/graphics-overlay.js`. It injects its own `#cue-gfx` DOM (high z-index, `pointer-events:none`) and listens for `graphic:update`. Each slot holds one occupant per destination **kind — `{screen, ndi, stream}`** (`OVERLAY_KINDS`): In-Room screens, the Online NDI feed, and the broadcast Stream composite, independently. Each window receives `overlayForKind(kind)` (`getGraphicsWindowInfos` classifies by windows-map key: numeric = screen, `ndi-*` = online; the stream window is tagged `stream`). A fire's `target` is `'all'`, a single kind, or **an array of kinds** (`kindsForTarget`) — so a graphic can hit any combination (e.g. Stream + NDI but not in-room). The Graphics panel exposes Default + toggleable In-Room/Online/Stream chips; the output templates take a single occupant per slot, unchanged in shape.

**Custom HTML designs:** a `custom` graphic renders into `#lt-custom` (a shadow root: `position:absolute; inset:0; transparent`) — arbitrary author HTML/CSS, alpha-key safe, with `.cue-in`/`.cue-out` on the `.cue-root` wrapper for enter/exit. The Graphics editor's design gallery (`GraphicsPresetModal`) offers built-in designs (§7 `graphics.presets`) as live tiles; picking one from the panel creates a graphic and opens the editor, while the editor's "Apply a design" restyles the current draft (locked to its kind). **Tickers crawl** in every preview surface too (gallery tiles, editor, live monitor, card thumbs) via the shared `@keyframes cue-ticker-crawl`, duration = `scrollWidth/speed`, mirroring the output crawl.

A lower-third channel has three **content modes** from `show_program` × `show_graphics`: Lyrics + Graphics, Lyrics Only, Graphics Only. The flags reach the window as `?program=` / `?graphics=` on first load (`lowerthird.js` gates the lyric band; `graphics-overlay.js` gates the overlay). Toggling them is a **runtime** operation: `setChannelContentMode(channelId)` sends `content:mode` to the existing window — both scripts hold a mutable flag + a cached last value, so they toggle in place and restore current content without recreating the window (the NDI sender is never dropped). The Graphics panel's per-channel switcher and Settings → Output Channels both drive this.

### Scenes — `applyScene` (v24)
`outputManager.applyScene({ overlay, program, audioMuted })` recalls a multi-output state (§5 `scenes`, §7 `window.cue.scenes`) atomically in one synchronous pass — **one** `broadcastGraphic()`, **one** `sendCurrentState()`, **one** `broadcastTransport()` — so every output window converges within a frame. It runs against the live bus state in main (not by replaying renderer GO/CLEAR/LOGO), which is what makes the recall atomic. Three managed layers: (1) **overlay** — each managed slot (key present in the snapshot) is set per `{screen,ndi}` kind; a slot's `countdown` value is re-resolved to a **fresh anchor** by `reviveSlotValue` (count-up → `startAt=now`; duration → `endsAt=now+durationSec`; target-clock → next `HH:MM`), since a stored absolute anchor would be stale on recall — this is why `countdownShow` retains its authoring spec (`source`/`targetClock`/`durationSec`) on the slot alongside the resolved anchor. (2) **program** — `applyProgramAction` drives `displayMode` with deterministic setters (not the `clear`/`logo` toggles, so re-applying is idempotent); `'none'` leaves it, `'content'`/`'clear'` are no-ops from idle, `'logo'` works from any mode. (3) **audio** — sets `transport.muted` only when a clip is loaded. A null `overlay` leaves graphics untouched; an all-empty overlay hides everything.

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

### In-room program audio output device
The audible program audio can be routed to a chosen physical output device. One global descriptor (`program_audio_device`) — the architecture guarantees a single primary audio monitor, so there is no per-channel device. `createMonitorWindow` passes it as the `audioDevice` query param; runtime changes ride the `audio:output-device` broadcast. In the output window, `media-player.js` applies it per media element with `el.setSinkId`, resolving the stored descriptor to a live device by **deviceId → label → groupId** (device IDs are salted per-origin, so the value chosen in the operator renderer may not match in the output window's `file://` origin). Only the audible window (`baseMuted === false`) routes; muted role-windows are left on the default. `OutputChannels.jsx` enumerates `audiooutput` devices; device labels are unlocked **lazily** (a one-shot `getUserMedia` on first picker interaction, never eagerly — opening a mic stream reconfigures the OS audio engine and briefly cuts all audio).

### Program-audio tap (NDI audio) and the separate stream tap
In-room program audio and stream audio are **separate** taps (the stream is its own program — see Stream Studio below):
- **In-room tap → NDI only.** `audio-tap.js` (loaded in `fullscreen.html`) taps the audible window's foreground media via `el.captureStream()` — deliberately NOT `createMediaElementSource`, so in-room playback/`setSinkId` is untouched. The element sets `crossOrigin='anonymous'` and the `cue-media://` handler returns `Access-Control-Allow-Origin: *`, so the tap is CORS-clean. The `AudioContext` is pinned to 48 kHz; a `cue-pcm-tap` AudioWorklet (`pcm-tap-worklet.js`) batches planar Float32 PCM and posts it via `output:audio-pcm`. Main toggles it with the `audio:tap` event (`updateAudioTapState`), needed only while an NDI-audio channel is live. `ingestAudioPcm` fans planar FLTp to each audio-enabled NDI sender. **It no longer feeds the RTMP encoder.**
- **Stream tap → RTMP only.** Built inside the offscreen stream window by `stream-feed.js`: the external audio-interface input (`getUserMedia({audio:{deviceId}})`) plus, in "mixed" mode, Cue's own foreground media (`captureStream` on `#cue-media-el`, offered via `window.CueStreamFeed.onMediaElement`), summed in a `GainNode` mix bus → the same `cue-pcm-tap` worklet → posted via `output:stream-audio-pcm` → `ingestStreamAudioPcm` writes interleaved f32le to ffmpeg `pipe:3`. Main enables it with the `stream:audio-tap` event at Go Live. A stereo `AnalyserNode` per channel sends peak levels via `output:stream-levels` for the Stream-tab meters.

**Worklet loading is asar-proof** (both taps): the worklet source is read in main (`audio:worklet-source`, Node `fs` is asar-aware) and loaded from a `blob:` URL — `AudioWorklet.addModule` cannot reliably fetch a module from inside `app.asar`.

### Stream Studio — external feed + composited program → RTMP (`src/main/stream/rtmp.js`, `src/output/stream-feed.js`, `src/renderer/views/StreamView.jsx`)
The stream is its **own program**, distinct from the in-room/NDI program: an external video feed (the operator's video mixer, via a capture device) is the base layer, with Cue's program, the lower-third lyric band, and stream-targeted broadcast graphics composited on top. The in-room screens and NDI feed are unaffected.

**Compositor (offscreen stream window).** A dedicated offscreen `BrowserWindow` (kept OUTSIDE the `windows` map; `backgroundThrottling:false` so the hidden window's `<video>`/timers are never throttled) loads `fullscreen.html` with `?stream=1`. `stream-feed.js` (a no-op unless `stream=1`, loaded in `fullscreen.html` after `graphics-overlay.js`) adds:
- A `#cue-feed` `<video>` base layer fed by `getUserMedia({video:{deviceId}})`. Capture devices are resolved **by label** (deviceIds are salted per-origin between the operator renderer and the `file://` stream window, so an exact-id match fails — `stream-feed.js` unlocks labels once and matches by label, falling back to id).
- A **layout/cut model** (`stream:layout` IPC): `feed` (camera full; Cue background suppressed; lyrics shown as a lower-third band only when `lyricsOverFeed` on), `program` (fullscreen Cue program covers the feed), `pip` (both visible — one full-frame, the other an inset box, `which:'feed'|'program'`).
- A **lower-third lyric band** (`#cue-stream-lt`, ported from `lowerthird.js`) for lyrics over the feed — the fullscreen `#content` layout is reserved for Program/PiP.
- **Resolution independence via CSS `zoom`.** Cue-content layers (`#stage`, the lyric band, `#cue-gfx`) are 1920×1080 design boxes scaled with `zoom` (NOT `transform: scale`, which caches the layer at 1080 and GPU-upscales → blurry 4K). `zoom` re-rasterizes natively, so content keeps its 1080p-monitor size and stays crisp at any encode resolution; the camera feed is left native. `#slide-elements`'s own scale is neutralised to avoid double-scaling.

**Encode pipeline.** A **steady-CFR pump** drives ffmpeg: the `paint` event caches the latest BGRA frame; a timer at the target fps writes that frame to `rtmp.writeVideo` (`pipe:0`) every interval, **duplicating the last frame when no new paint arrived** — feeding ffmpeg straight from `paint` starves YouTube on near-static scenes ("not receiving enough video") because the offscreen compositor coalesces repaints. ffmpeg starts on the FIRST frame so `-video_size` matches the real surface. `rtmp.js` spawns the bundled ffmpeg (`youtube/bin.js`), probes for a hardware H.264 encoder (videotoolbox/nvenc/qsv, `libx264` fallback), uses wallclock timestamps, drops video frames under stdin backpressure (never audio), auto-reconnects, and tracks `droppedFrames`/`sentFrames` — emitted ~1Hz so the Stream tab shows a Stable/Unstable health badge (dropped frames = bandwidth/encoder can't keep up). CSP does not apply (egress is in main).

**Lifecycle.** The compositor window runs for **preview** while the Stream tab is open (ref-counted via `openStreamStudio`/`closeStreamStudio`); **ffmpeg only spawns at Go Live** (`startStream`). A ~10fps downscaled JPEG preview (`output:stream-preview`) feeds the Stream-tab monitor — it is a low-res monitor and does NOT represent stream quality. Resolution/fps changes recreate the window when idle. On macOS, `openStreamStudio` requests camera/mic via `systemPreferences.askForMediaAccess` (the offscreen window can't surface the TCC prompt itself); `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` are in `forge.config.js` `extendInfo`. Config persists in the `stream_studio` setting (device ids+labels, `audioMode`, layout) and `stream_config` (RTMP server/key/resolution/fps/bitrate).

---

## 14. NDI

**Current state:** Fully implemented. NDI channels publish BGRA frames with alpha transparency over the local network. OBS (and any NDI receiver) picks up the source and composites it natively without chroma keying.

### Package: `grandi`
`grandiose` (the original npm package) could not be compiled on macOS (uses `itoa`, a Windows-only function). `grandi` is an actively maintained fork with prebuilt N-API binaries per platform. Loaded via `createRequire(import.meta.url)` to bypass Vite's CJS bundler (a static ESM import would be converted to `require('grandi')`, which fails because grandi is ESM-only).

### Constants (hardcoded in `ndi.js`)
`grandi`'s TypeScript enums are not exported by the native binary — only by the ESM wrapper, which we cannot import in a CJS bundle:
- `FOURCC_BGRA = 1095911234` — 32-bit BGRA pixel format with alpha
- `FOURCC_FLTP = 1884572742` — Float32 **planar** audio (one channel block after another)
- `FORMAT_TYPE_PROGRESSIVE = 1` — progressive scan

### NDI audio
`ndi.sendAudio(channelId, planar, sampleRate, noChannels, noSamples)` sends a `sender.audio()` frame (`fourCC: FLTp`, `channelStrideBytes = noSamples*4`). `planar` is a Buffer of per-channel Float32 blocks. Audio is small and never dropped (gaps are audible) — unlike video it does not gate on the `inflight` flag. The offscreen NDI window is **always locally muted** (`mute:'1'`); its audio is the program-audio tap (§13 *Program-audio tap*) forwarded by `ingestAudioPcm`, gated per channel by `ndi_audio_muted` via `updateAudioTapState`. NDI audio therefore requires a screen (audible) output to exist as the tap source.

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

**1. Bundled** — 23 families in `src/fonts/` (`.woff2`), pixel-identical on every machine. The original 6 (Inter — default UI, Montserrat, Lato, Oswald — output templates only, Playfair Display, EB Garamond) plus the **theme-pack additions** (free/OFL): Archivo, Barlow Condensed, Bebas Neue, Jost, Overpass, Poppins, Roboto, Cinzel, Cormorant Garamond, DM Serif Display, Lora, Marcellus, Rakkas, Atma, Dancing Script, DynaPuff, Playpen Sans. Built by `scripts/build-fonts.mjs` (woff2 → `src/fonts/` + `@font-face` rules in `fonts.css` + entries in `BUNDLED_FONTS`). `fonts.css` (`font-display: block`) is loaded by output templates (`<link href="../fonts/fonts.css">`) and the renderer (`@import` in `index.css`); `src/fonts` is copied into the asar by the `packageAfterPrune` hook. (JetBrains Mono is **not** bundled — the operator-UI mono label font falls back to `ui-monospace`.)

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
- **EasyWorship** — picked `Songs.db` (or `SongWords.db`, sibling auto-resolved); both are SQLite read via `better-sqlite3`. Lyrics live in `SongWords.word.words` as **RTF**, joined by `word.song_id = song.rowid`. `rtfToRich(rtf)` → `{ text, styles }`: `text` is the plain text (cp1252 `\'xx`, `\u`, ignorable `{\*…}` groups, font table skipped), `styles` is a parallel per-code-unit array of `{bold,italic,underline,color}`. It tracks `\b`/`\i`/`\ul`/`\cf` scoped to RTF `{…}` groups and parses `\colortbl` to resolve `\cf` to hex; `\fs`/`\f` (size/family) are intentionally dropped — EW absolute metrics fight Cue's template sizing. **Inline emphasis is preserved as Cue runs**: after `parseSections`, `deriveStyleJson(content, text, styles)` greedily re-aligns each cleaned section back onto the styled source (sound because the whole pipeline only *deletes* characters, so content is always a subsequence), promotes attributes uniform across the section to section-level style, and emits the rest as `runs` — returning a `style_json` string or `null` (all-default ⇒ null). EW *theme* styling (font/size/background/position) lives outside the RTF and is not imported, so songs that only inherited a theme import default-styled. Auto-resolved colours black/white and `\cf0` (auto) yield no run. Plain `SELECT` only + JS sort — the song table's custom `UTF8_U_CI` collation isn't registered. One `.db` → many rows. EW import runs `parseSections(text, {stripAnnotations:true})`: voice-part / performance directive lines that are not lyrics ("All", "All - Unison", "Men:", "(Women)", "Instrumental", "x2" — `NONLYRIC_TOKENS` / `isNonLyricLine`) are dropped, and a section header trailed by a directive ("Verse 1 - All", "Chorus (Men)") keeps only the section word. `stripAnnotations` is EW-only — plain-text/paste callers leave it off so existing behaviour is unchanged.

`importSongs` (db/songs.js) is tag-aware: each row's `tags[]` (names) is get-or-created (`_IMPORT_TAG_COLOUR` gives GHS a distinct blue) and assigned, and it persists each section's `style_json` (so EasyWorship runs survive — other parsers leave it `undefined` → null). `existingTitleSet()` flags duplicates (default-unselected in the modal).

### GHS hymnal (bundled)
`resources/ghs/ghs-hymnal.json` ships 260 Gospel Hymns & Songs (`scripts/build-ghs.mjs` builds it from a cp1252 number→name CSV + per-number lyric files). On startup `seedGhsHymnal()` imports them once (gated by the `ghs_seeded` setting so deletions stick) and always runs `tagGhsSongs()` — an idempotent backfill that tags every `GHS N …` song with the `GHS` tag. In `LibraryPanel`, the `GHS` tag is the GHS folder; selecting it sorts the list by hymn number and swaps the text search for a numeric quick-search (type a number → that hymn first; Enter previews the exact match).

### Paste Song List (`songs.matchTitles` + `SongListImportModal.jsx`)
Operators are handed a set list that is almost never clean titles — each entry is usually the **first line of lyrics** (the song's library title may share few words with it), interleaved with list numbers, repeat markers ("x2"), and set-segment labels ("Worship", "Praise"). `matchTitles` (`db/songs.js`) is therefore **lyric-first**, not title-first:
- **Parse (`_parsePastedList`)** — segments by blank-line BLOCKS first (the reliable signal); a block with ≥2 numbered lines is split further; a list with no blank lines falls back to numbered-marker splitting. Per entry it strips leading list numbers, repeat directives (`_stripRepeat`), section headers, and leading non-alphanumeric noise (NBSP/word-joiners). Standalone set-segment labels (`_SEGMENT_HEADERS`, exact-membership so real lyrics survive) are dropped. Each entry is `{label, query}` — `label` is the display line, `query` the full snippet.
- **Match** — exact title equality is the only `exact` tier. Otherwise the snippet's distinctive tokens (stopwords removed, `_ftsQuery`) are OR-ed across **all** `songs_fts` columns (title **and** content) and ranked by `bm25(songs_fts, 8.0, 1.0, 4.0)` (title ≫ content ≫ author). FTS is per-section, so rows collapse to best-per-song; the top 8 are coverage-scored against full lyrics by `_rankByOverlap` (shared with `search()`'s fallback): longest verbatim **phrase** run (`_longestPhrase`, the strongest signal), lyric **coverage**, and **title overlap**. Confidence: phrase≥4 / cov≥0.7 / titleCov≥0.85 → `high`; phrase≥2 / cov≥0.35 / titleCov≥0.5 → `low`; else `none`. A near-tie (margin <0.08) demotes `high`→`low` unless a long phrase proves it.
- **Library search fallback (`search()`)** — the same lyric-matching core powers the plain Songs-tab search. The strict AND-prefix query runs first and always ranks on top; then, whenever the query has ≥1 distinctive token, `_rankByOverlap` OR-recalls and **appends** any new phrase/coverage-plausible songs (`phrase≥2 || cov≥0.34`) strictly **below** the strict hits, de-duped. So a typed/pasted lyric line with one wrong or extra word still finds its song, while an exact query is unaffected (the fallback adds nothing it didn't already have).
- **Modal (`SongListImportModal.jsx`)** — three steps (input → results → adding). Each result row: a select checkbox (pre-ticked only for `exact`/`high`), the pasted snippet, the matched song, a confidence badge, and a per-row search-to-replace dropdown (debounced `songs.search`, available on every row). A right-hand **preview pane** shows the focused song's full lyrics (`songs.get`, cached per id); clicking any match or alternate previews it. The replace dropdown also offers **Create new song…** → opens `SongEditor` prefilled (`prefillTitle`/`prefillSections`) with the snippet; on save `SongEditor.onSave(savedId)` returns the new id, which is applied back as the row's override (badge → "Chosen"). The editor is rendered as a **sibling** of the modal backdrop (not a child) so its clicks don't bubble through React's tree to the backdrop's `onCancel`; the modal's Escape-to-close is suppressed while the editor is layered over it. Confirm batch-appends the selected songs to the current rundown.

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
Styling counterpart to `SongEditor`, reusing its exported toolbar/preview/helpers. **Verse Text / Reference** target toggle switches what the toolbar edits: verse style (`scripture_style_json`) or reference-line style (`scripture_ref_style_json`, `simple` toolbar mode). Plus default background (`global_bg_scripture_id`). All apply to every verse — text is fixed. Reference renders as `Book c:v (VERSION)`, default right-aligned with symmetric 60px inset, stylable, and free-positionable (`pos{x,y}`, drag or X/Y). A **Load Theme…** button opens `ThemePickerModal category="scripture"`; picking a scripture theme sets the verse style, applies the theme's top-level `refStyle` to the reference line, and resolves its `bgRef`/`bgCss` into `global_bg_scripture_id` (with a download spinner). Scripture themes are seeded built-ins (category `'scripture'`, sort_order 40+), authored by `scripts/build-scripture-themes.mjs`.

### Reference rendering across surfaces
The reference flows in the payload as `copyright` (text), `copyrightAlign` (`'right'` for scripture), and `copyrightStyle` (the ref style incl. optional `pos`). Applied by `applyCopyrightStyle` in `fullscreen.js`/`lowerthird.js` (lower-third ignores `pos` — the bar owns layout) and `copyrightCss` in the operator monitors (via `slide._refStyle`). The **confidence monitor** (`stage.html` `#current-ref`) shows the reference above the verse in its own legible styling (auto-fit reserves space for it).

### Scripture detection (listen → verse) — `src/main/scripture-detect/`
A detection front-end feeding the existing scripture display; fully local, no API, no schema. Two modes: **reference detection** (a spoken citation — "John chapter three verse sixteen" — resolves and, at high confidence, auto-stages to Preview) and **content matching** (a quoted/paraphrased verse is identified as a suggestion).

**Pipeline.** Capture lives in the renderer (`audio/useScriptureCapture.js` + `audio/captureWorklet.js`): `getUserMedia` → an `AudioContext` forced to **16 kHz** (Chromium's anti-aliased resampler does 48k→16k; the worklet then runs at ratio≈1) → Int16 PCM frames → `scriptureDetect.pushAudio` IPC. Main (`manager.js`) feeds frames to `asr.js`, which is a **VAD-segmented** transcriber: an energy VAD (adaptive noise floor + hysteresis) buffers a speech segment, and on a trailing pause (`endSilenceMs`, default 500 ms on Balanced) transcribes that one complete utterance. (The window is kept ≥ ~360 ms even on Instant: too short a pause splits a slowly-spoken citation across two clips so the parser only sees a fragment.) (This replaced a rolling-window + LocalAgreement scheme that discarded correct transient hypotheses and hallucinated over silence.) The utterance text drives `onCommitted` → `reference-parser.js` (`numbers.js`, fuzzy/phonetic, single-chapter + digit-range aware) and `content-match.js`. A candidate is sent as `scripture:detected`; `OperatorView` resolves it via `bible.resolve` and reuses `handleScriptureLive` / preview staging (state stays in the renderer, mirroring the network remote).

**Latency: progressive (interim) detection.** Most of the old 5–7 s latency was *waiting for the talker to pause* — a read verse is 5–10 s of continuous speech, so `onCommitted` fired nothing until the full stop. The fix emits transcript *during* speech without reintroducing the banned rolling window:
- **VAD-gated interim decode** (`asr.js` `runInterim`/`kickInterim`): while the VAD says speech is active, decode the accumulated **speech-only** buffer at a coarse cadence (`interimCadenceMs`) and immediately on a soft intra-phrase pause (`softPauseMs`), **latest-wins** (a newer interim drops the queued one). It only ever decodes the speech-active buffer — never silence — so the hallucination/lossy-commit failure can't recur. The end-of-utterance commit is unchanged and authoritative.
- **Two-tier model** (`whisper-bin.js`): interims run on a fast resident **tiny.en** pipe alongside the commit (small/base.en). `whisper-bin` holds a `Map` of resident pipes and **serializes `transcribe()` per model** (onnxruntime CPU sessions aren't re-entrant). Two guards stop the interim model from starving the authoritative commit: (1) **per-session thread caps** baked at load — `commitThreads()` (cores − 2) for the commit, `interimThreads()` (≤ 2) for tiny.en, with `interOpNumThreads: 1` — so two concurrent ORT sessions can't oversubscribe the cores (the default uncapped pools, ~core-count each across encoder+decoder sessions, were the main speed regression); (2) **the commit preempts interims for ALL models** (`asr.js runInterim`): any interim defers while a commit is decoding or queued (not just the same-model case), and is re-kicked from the commit's `drain()` once the queue clears. So interims only ever use spare CPU.
- **`scripture:detected` carries `interim` + `candidateId`** (`<mode>:<ref>`, stable across an interim and its confirming commit). **Interim references suggest by default, and auto-Preview only when the parse is complete + stable + confident** — i.e. it has an explicit verse (`vStart`), clears the preview band (`referenceAutoConfidence`), AND the same ref repeats on the next interim (so a one-frame mis-hear or a half-heard `book chapter` partial only suggests, never flashes onto the preview monitor). Interims **never auto-air**; the authoritative commit drives Live. The commit with the same `candidateId` **confirms in place** (no re-stage/flicker, gated by `previewCandidateRef` in `OperatorView`) or corrects. Interim-vs-final cooldowns are tracked separately (`interimRef`/`lastRef`) so the final passes as a confirmation, not a suppressed duplicate.
- **Lexical-first content match** (`lexical-index.js`): an in-memory idf-weighted inverted verse index (regenerable, never persisted — same policy as the embedding blob) localizes a **verbatim** quote in microseconds with no worker round-trip, so it runs on every interim. `content-match.match` tries it first and falls back to MiniLM only for genuine **paraphrase**; content detection no longer requires the embedding index to be built.
- **Responsiveness presets** (`scriptureDetect.responsiveness`: Instant / **Balanced** (default) / Accurate) in `manager.js` `PRESETS` bundle `endSilenceMs` (360 / 500 / 600) + the interim knobs + lexical thresholds; Accurate disables interims (original single-model behaviour). `init()` re-bundles the active preset over saved config on launch so latency tuning shipped in an update reaches existing users (these knobs are preset-derived with no manual UI; user-chosen fields — model, actions, reference thresholds, device — are left intact). Per-utterance timing traces (`onset→detect`) log under `[scripture-detect]` when `CUE_SCRIPTURE_DEBUG` is on.

**ASR engine** (`whisper-bin.js`): `@huggingface/transformers` (onnxruntime-node), Whisper resident in main. Decisions baked in (each measured in the Electron runtime):
- **INT8-quantized weights** (`dtype:'q8'`) — ~1.85× faster than fp32, no transcript change, ¼ the download. The ready-marker is dtype-tagged (`.ready-<model>-q8`).
- **CPU memory arena disabled** (`session_options.enableCpuMemArena:false`) — mandatory in Electron (see CLAUDE.md guard rail).
- **Adaptive `chunk_length_s`** = clamp(⌈dur⌉+2, 8, 30) — Whisper pads to the chunk window and the ONNX encoder mel axis is dynamic, so padding short utterances to ~their length (not 30 s) is ~20% faster, single-chunk.
- **Book-name `prompt_ids`** — primes the decoder with the 66 book names (proper-noun bias); +~23 ms, no harm to normal speech.
- The resident pipeline lazy-loads on first `transcribe` and `manager.start()` so it survives app restarts (the disk marker means "downloaded", not "loaded in memory").

Models auto-download to `userData/whisper-model` on first arm (nothing ships in the installer). `autoModel()` picks small.en on capable hardware, else base.en. CPU is at the speed/accuracy Pareto frontier; an optional opt-in WebGPU backend is also available.

**Action tiers** (`scripture:detected.action`): an opt-in upper band fires first — reference ≥ `referenceAutoLiveConfidence` (0.97) **and** `reference.autoLive` on → `live` (straight to air); then reference ≥ `referenceAutoConfidence` (0.8) → `reference.autoAction` (default `preview`); ≥ `referenceConfidence` (0.6) → `suggest`; below that → ignored; content → `suggest` by default. The auto-live band sits ABOVE `autoAction`, so it promotes a near-certain citation past a `preview`/`suggest` default; it is commit-only (interims never auto-air; a complete+stable+confident interim may auto-Preview, but Live waits for the commit) and off by default. Config under the `scriptureDetect` settings key. Settings → Scripture Detection (`ScriptureDetectionSettings.jsx`): for **reference** detection the three thresholds are surfaced as a single **confidence-band bar** (`ConfidenceBar`) — draggable dividers split 0–100% into Ignore / Suggest / Auto-Preview / Auto-Live bands (the live band only when the Auto-Go-Live opt-in is on); the bar pins `reference.autoAction` to `preview` (the live band is the only auto-air path) and the panel migrates any legacy `autoAction` to `preview` on load. **Content** matching keeps the simple Suggest/Auto-Preview/Auto-Live picker (it has its own cosine/lexical gates, not these bands). Pipeline tracing logs under `[scripture-detect]` (silence with `CUE_SCRIPTURE_DEBUG=0`).

---

## 18. Known Gaps and Backlog

| Item | Priority | Notes |
|---|---|---|
| ~~NDI publish~~ | ~~High~~ | Implemented. See §14. |
| `linked_channel_id` logic | Medium | Field exists, settable, never read. Sync lower-third to fullscreen channel. |
| ~~Stage display / confidence monitor~~ | ~~High~~ | Implemented — `stage` template, StagePanel (timer + immediate + scheduled messages), VIDEO countdown. |
| ~~Scheduled / timed stage messages~~ | ~~Medium~~ | Implemented — queue a message to appear after a countdown or at a wall-clock time, with optional auto-clear; collisions surfaced (later-start wins). In-memory state, anchors resolved once in main, template ticks locally. `src/shared/stage-schedule.js`. |
| ~~Tag CRUD UI~~ | ~~Medium~~ | Implemented — `TagSettings.jsx` (Settings → Tags) for create/rename/recolour/delete; plus inline tag creation in `SongEditor`. |
| ~~Song background picker in Song Editor~~ | ~~Medium~~ | Implemented. Media picker in `SlidePreview` calls `songs:setBackground`. |
| ~~Song import~~ | ~~Medium~~ | Implemented — OpenLyrics / ChordPro / text / EasyWorship + bundled GHS hymnal. See §16. |
| ~~Network control API~~ | ~~Medium~~ | Implemented — localhost/LAN HTTP + SSE server, token-gated. Phone control page + Companion HTTP verbs. See §7 `window.cue.remote`, `src/main/remote/`. |
| Disk space warning | Low | Warn when < 2GB free on import. Not implemented. |
| ~~Media unused-asset cleanup~~ | ~~Low~~ | Implemented — `MediaCleanup.jsx` (Settings → Media) scans via `media.findUnused` (songs/service_items/channels/themes/settings) and bulk-deletes. |
| ~~Auto-advance / timed loops~~ | ~~Medium~~ | Implemented — `service_items.advance_seconds/advance_loop/advance_wrap`, renderer-side scheduler in `OperatorView.handleAutoAdvance`. See §12. |
| ~~Presentations (native slides) + PowerPoint import~~ | ~~High~~ | Implemented — multi-element slide editor + LibreOffice/pdfjs PPTX→image import. See §21. |
| ~~Scenes — multi-output state recall~~ | ~~Low~~ | Implemented (reframed from the roadmap's "macros" proposal — recorded timed playback + event triggers deliberately dropped). `scenes` table (v24), `ScenesPanel` capture-driven editor, number-key 1–9 recall, atomic `applyScene`. See §5/§7/§13. |
| ~~Transition / animation library~~ | ~~Low~~ | Implemented — `transitions.js` engine + Settings → Motion (`output_transitions`). Per-trigger (slide/logo/clear) fade/slide/zoom, foreground-only fade-in over a solid background, video swaps always hard-cut. See §13. |
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
The same array is rendered by **four** parallel renderers (the established React-vs-plain-DOM duplication pattern): `fullscreen.js` `renderElements` (live output, scaled `#slide-elements`), `PreviewLivePanel` `PresentationCanvas` (operator monitor), `PresentationEditor`'s own canvas (drag/resize editing), and `components/SlideElements.jsx` `StaticSlide` (read-only previews — the theme galleries + the `ThemeSettings` presentation card). All render into a fixed 1920×1080 box scaled by a CSS transform, so px font sizes are WYSIWYG across editor → monitor → output. Per-slide background resolution: slot `background_override` → slide `background_id` → `global_bg_slide_id` → black.

### Presentation themes (token model)
A presentation theme is a **layout-agnostic visual style** — tokens only (`style_json = { kind:'pres-theme', …tokens }`: `bg` CSS gradient/solid, `scrim?`, `display`/`body`/`quoteFont` font families, `title`/`sub`/`bodyColor`/`accent`/`accentText`/`kicker` colours, `titleUpper`/`sectionUpper`/`serif` flags). A **layout** is a theme-agnostic structural recipe (which text roles appear and where). `utils/presentationThemes.js` is pure data (no React) shared by the editor and `ThemeSettings`:
- `buildThemeSlide(tokens, layoutId)` composes a slide's elements for a theme × layout — bakes `bg` as a full-bleed gradient/solid shape (slides store only a media-FK background, so the theme background rides as an element), optional scrim, then each role's text styled from tokens. Every composed element is tagged with its `role`.
- `PRES_LAYOUTS` — the structural recipes (title, title-sub, section, statement, quote, scripture, two-column, blank, …). `PLAIN_THEME` = "No theme" (no baked background — the slide's own/global background shows through).
- `reskinSlide(tokens, elements)` re-skins existing slides by role tag (swap background, recolour accents, restyle role text) while preserving content/positions — drives `ApplyThemeModal` (this-slide / whole-deck).
- `detectThemeId(elements, themes)` best-effort identifies which theme a slide was built from (matches baked `bg` fill + accent + font against token sets); the `PresentationEditor` new-slide modal uses it to default the picker to the deck's current theme so added slides stay on-theme (the rail still lets you switch).

`ThemeSettings` authors/edits these: the editor's category switcher (Songs / Scripture / Presentations) swaps between the song text-style editor and a **presentation token editor** (`PresThemeEditor`: background solid/gradient/raw-CSS, fonts, role colours, case/serif flags, live `StaticSlide` preview). Song and scripture themes share the §8 text-style shape and differ only by `category`; presentation themes save the token bag. User presentation themes are editable/duplicable (built-ins duplicable); they appear in the editor's new-slide and apply-theme pickers like the built-ins.

### PowerPoint import pipeline
PPTX fidelity is **render-to-image**: `PptxImportModal` gates on a LibreOffice check (never spawns a missing binary), then `pptx-import.convertPptxToPdf` runs `soffice --headless --convert-to pdf` (isolated `-env:UserInstallation` profile) → `pdfRaster.rasterizePdf` (pdfjs, renderer) rasterises each PDF page to a 2560px PNG → `createFromImages` persists each via `media.importBuffer` and builds a presentation whose slides each hold one full-bleed image element. The result is an ordinary native presentation, so all controls work. Key constraints:
- **A `.pdf` is imported directly** (no LibreOffice, no font substitution → pixel-perfect). Exporting a deck to PDF from PowerPoint/Keynote is the recommended high-fidelity path; PDF import is offered even when LibreOffice is absent.
- **Layout/overflow drift on `.pptx` is LibreOffice font substitution** (the deck uses fonts not installed on the conversion machine). pdfjs renders the vector PDF faithfully — fidelity is decided upstream. Fix by installing the deck's fonts or embedding fonts in the .pptx.
- **pdfjs is pinned to v4** (see §2): v5/v6 use native `Promise.try` which Electron 30's Chromium lacks. The worker must load via Vite `?worker` + `workerPort`, not a `?url` workerSrc (else a slow main-thread "fake worker").
