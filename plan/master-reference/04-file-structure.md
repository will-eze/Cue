## 4. File Structure

Every file that matters, with a one-line description:

```
src/
├── main/
│   ├── index.js              App entry. Window creation. cue-media:// protocol handler.
│   │                         Dialog IPC. Startup sequence: initDb → seedBundledBibles → seedGhsHymnal.
│   │                         Wires the remote server: remoteServer.configure (getState + forward commands to the
│   │                         renderer as remote:command + getProgram=getProgramSnapshot), outputManager.
│   │                         setRemoteStateListener (control STATE push) + setRemoteProgramListener (Remote Output
│   │                         program deltas → remoteServer.pushProgram), applyRemoteConfig().
│   │                         cue-thumb:// video posters fall back to ffmpeg (ffmpegVideoThumb) when the OS thumbnail
│   │                         service comes up empty — covers exotic codecs and the sandboxed packaged app (§6).
│   ├── preload.js            contextBridge → window.cue. The complete renderer API surface.
│   ├── output-preload.js     Minimal contextBridge for output windows → window.cueOutput only. Also injects
│   │                         user-installed @font-face rules (fonts:css) into every output window on load.
│   ├── fonts.js              BUNDLED_FONTS array + DEFAULT_FONT. Imported by preload.js.
│   ├── fonts-catalog.js      FONT_CATALOG (52 downloadable OFL/Apache families: id/category/weights/license/pairing)
│   │                         + fontsourceUrl(id, weight). Feeds db/fonts.js downloads + the picker previews (§15).
│   │
│   ├── db/
│   │   ├── schema.js         SQLite init, migration runner (v1→v33), getDb() singleton, closeDb() (releases
│   │   │                     the cue.db handle, checkpointing WAL — used by backup/restore before file swap).
│   │   ├── backup.js         .cuebackup export/import. exportBackup(dest): wal_checkpoint(TRUNCATE) then
│   │   │                     gzip-tar cue.db + media/. importBackup(src): extract to temp, validate staged DB
│   │   │                     (settings+songs tables) before touching live files, swap cue.db + media/, then
│   │   │                     rewrite absolute media_assets.path to the local media dir (portable across machines).
│   │   │                     autoSnapshot(): synchronous DB-only copy to userData/backups/cue-<stamp>.db on every
│   │   │                     quit (will-quit, before closeAll), keeps newest 5, try/caught so it never blocks quit.
│   │   ├── scenes.js         Scenes CRUD (one-press output state recall). normalizeScene(row|liveObj) is the applyScene boundary; hotkeys unique.
│   │   ├── output-presets.js Output-preset CRUD (v30 — save/recall the output RIG; separate from scenes). Pure CRUD, no apply() — recall is renderer-orchestrated (§05, §07).
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
│   │   │                     applyStyleToSong(songId, styleJson): merges style into every section (preserving inline runs).
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
│   ├── songs/
│   │   ├── song-scrape.js    Online Song Finder — search Genius + AZLyrics for lyrics, or fetch any
│   │   │                     pasted lyrics URL (hymnary / worship sites / generic). ALL network runs in
│   │   │                     main (Node `fetch`) to avoid CSP/CORS issues. searchSongs(query) → candidates
│   │   │                     from the Genius public search API; fetchLyrics(candidate) → raw HTML scrape +
│   │   │                     extraction → parseLyricsToSections (reuses songs-import.js) → preview-ready
│   │   │                     sections. Errors surfaced as {ok:false,error} envelopes, never IPC rejections.
│   │   └── song-scrape.test.mjs  Node assertion tests for the scraper parsing paths.
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
│   │   ├── sermon-import.js  Sermon → Slides — PURE offline half. Text extraction (txt/md/docx — hand-rolled
│   │   │                     minimal ZIP+inflate for .docx, no new dep) + structure heuristic
│   │   │                     `buildSermonStructure` (two paths: hierarchical for DCLM-style outlines with
│   │   │                     `(i)`/`(ii)` sub-point markers; flat for generic sermons). `findScriptureRefs`.
│   │   │                     No DB/Electron — unit-tested in sermon-import.test.mjs (plain Node). See §22.
│   │   ├── sermon-import.test.mjs  Node assertion tests for the sermon parser.
│   │   ├── sermon-build.js   Sermon → Slides — DB-aware half. Takes the structure plan from sermon-import.js,
│   │   │                     lays out canvas elements on 1920×1080 (per role: title / point-divider / heading
│   │   │                     + bullets / scripture), applies the theme style + background, and
│   │   │                     `presentations.create`s the deck. Called by the `sermon:generate` IPC handler.
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
│   │   ├── songs.ipc.js      Registers songs:*, tags:* handlers (incl. importParse/importGhs/importCommit,
│   │   │                     songScrape:search/fetch, songs:applyStyleToSong).
│   │   ├── services.ipc.js   Registers services:* handlers.
│   │   ├── media.ipc.js      Registers media:* handlers.
│   │   ├── output.ipc.js     Registers output:* handlers (incl. graphic/ticker/overlay + channel show_program/
│   │   │                     show_graphics; content-mode-only channel updates route to setChannelContentMode).
│   │   │                     v27: stage layout CRUD (output:stage:layout:get/set, output:stage:preset:list/save/delete).
│   │   ├── graphics.ipc.js   Registers graphics:* CRUD handlers + graphics:presets (registerGraphicsIpc).
│   │   ├── scenes.ipc.js     Registers scenes:* CRUD + scenes:apply→outputManager.applyScene (registerScenesIpc).
│   │   ├── output-presets.ipc.js  Registers outputPresets:* CRUD (registerOutputPresetsIpc). No apply — renderer replays snapshots.
│   │   ├── live-input.ipc.js Registers liveInput:* (sources/available/getEnabled/setEnabled/previewStart/previewStop) → ndi-input + manager (registerLiveInputIpc). §14.
│   │   ├── themes.ipc.js     Registers themes:* CRUD + apply handlers (registerThemesIpc); apply* await
│   │   │                     resolveThemeBackground first when setBg (media-theme bgRef download).
│   │   ├── background-library.ipc.js  Registers backgrounds:* (list/tagCounts/download/applyAsDefault).
│   │   ├── presentations.ipc.js  Registers presentations:* + presentationTemplates:* CRUD, the PowerPoint pipeline
│   │   │                     (detectLibreOffice/setLibreOfficePath/convertPptx, and createFromImages: persist each
│   │   │                     rasterised PNG via media.importBuffer → build an image-element presentation),
│   │   │                     sermon:generate (→ sermon-import.js + sermon-build.js), and app:openExternal.
│   │   ├── settings.ipc.js   Registers settings:* handlers (incl. exportBackup/importBackup + factoryReset:
│   │   │                     close DB, delete cue.db + media/ + fonts/, relaunch as a fresh install).
│   │   ├── fonts.ipc.js      Registers fonts:* handlers (listUser/css/import [native multi-file picker]/delete).
│   │   ├── bible.ipc.js      Registers bible:* handlers (versions/books/chapters/verses/adjacent/resolve/search/importFile/delete/online:*).
│   │   ├── youtube.ipc.js    Registers youtube:* handlers (prefetch/status/cancel/detect) + clipboard:readText. Wires
│   │   │                     the downloader's status listener → broadcasts youtube:status to every window.
│   │   ├── packages.ipc.js   Registers packages:* handlers (list/install/remove/reveal/locate) → packages/registry.js.
│   │   │                     install() streams packages:progress to the CALLING window only (e.sender.send).
│   │   └── remote.ipc.js       Registers remote:* handlers (getConfig/setConfig/regenerateToken/regenerateViewToken/
│   │                           navState). Owns the settings keys (remote_enabled/port/lan/token +
│   │                           remote_output_enabled/remote_view_token) + applyRemoteConfig() (boot + on-change start;
│   │                           mints the control token when enabled and the view token when outputEnabled).
│   │
│   ├── remote/
│   │   ├── server.js           Network control API + Remote Output mirror. Dependency-free Node http server (no ws —
│   │   │                       SSE for live pushes). Binds 127.0.0.1 (LAN opt-in = 0.0.0.0). TWO independent surfaces
│   │   │                       sharing one server/port/LAN binding, each its own toggle + token: CONTROL (enabled,
│   │   │                       token-gated /api/*, GET / control page) and OUTPUT (outputEnabled, view-token-gated
│   │   │                       program mirror). Runs if EITHER is on. configure() injects getState + onCommand +
│   │   │                       getProgram (decoupled from manager/window). Control: ACTIONS = go/clear/logo/next/prev/
│   │   │                       live/select; GET /api/<action> or POST /api/command; STATE via GET /api/state + GET
│   │   │                       /api/stream (SSE); setNavState() holds the renderer-pushed rundown. Output: GET /output
│   │   │                       (page), /output/assets/* + /output/fonts/* (ungated static templates/fonts), GET
│   │   │                       /output/stream (SSE program deltas {slide|transport|overlay}, each stamped serverNow),
│   │   │                       GET /output/media/* (serveLocalFile). pushProgram(delta) fans deltas to outputSseClients.
│   │   │                       Both 128-bit tokens (crypto.randomBytes(16)) compared with timingSafeEqual; Referrer-
│   │   │                       Policy: no-referrer on every response so ?token=/?vt= can't leak via Referer.
│   │   ├── control-page.js     CONTROL_PAGE: self-contained dark HTML control surface served at GET / (phone remote).
│   │   │                       Token from ?token= → localStorage. SSE-driven (single source of truth, no stale renders).
│   │   │                       Accordion rundown — expand a song to its numbered slides, tap a verse to jump live.
│   │   ├── output-page.js      OUTPUT_PAGE: self-contained view-only browser mirror of the live PROGRAM, served at
│   │   │                       GET /output (gated by the SEPARATE view token). Re-renders the same screen-kind buses
│   │   │                       using the same plain-DOM templates (fullscreen/media-player/transitions/graphics-overlay
│   │   │                       served from /output/assets) behind a shim that swaps Electron IPC for an SSE feed
│   │   │                       (/output/stream) and points media at the http /output/media endpoint. Handles browser
│   │   │                       realities: clock-offset (EWMA on each frame's serverNow, rebases host-epoch transport/
│   │   │                       countdown timestamps so the unmodified templates' Date.now() math holds) and an
│   │   │                       autoplay-with-audio "Tap to view" gate. Hosts the program in a fixed 1920×1080 #cue-frame
│   │   │                       CSS-zoomed uniform-fit + centred (letterbox) so any-aspect device matches the auditorium
│   │   │                       screen pixel-for-pixel; neutralises fullscreen.js's scaleSlideCanvas with
│   │   │                       #slide-elements{transform:none!important} and re-homes #cue-gfx into the frame.
│   │   └── media-serve.js       serveLocalFile(path,req,res) + MEDIA_MIME + isUnderUserData(): the http twin of the
│   │                           cue-media:// handler. Streams userData-contained files (Range-aware, never buffered) to a
│   │                           browser viewer. KEEPS the isUnderUserData() containment guard (arbitrary-file-read).
│   │
│   ├── youtube/
│   │   ├── bin.js             yt-dlp + ffmpeg resolver + auto-downloader (NOT bundled). Resolves override setting →
│   │   │                     userData/bin → PATH → common install dirs (GUI-stripped-PATH fallback) → dev-only
│   │   │                     resources/bin; ensureBinaries() downloads BOTH into userData/bin on first use (streamed,
│   │   │                     progress); refreshYtDlp() re-fetches latest on extractor failure. Also exports the
│   │   │                     package-manager surface: binInfo/installBinary(one at a time)/removeBinary/setBinaryPath.
│   │   └── downloader.js      Ephemeral YouTube resolver. parseVideoId; prefetch(url) (resolve metadata → download
│   │                         with faststart + concurrent-fragments → ready); withClientCascade (default → web_embedded
│   │                         → cookies anti-bot tiers, refresh-on-bot-wall); in-memory entries Map keyed by video id;
│   │                         getStatus/getReadyPath/cancel; wipeCache() (quit + startup). Emits youtube:status.
│   │
│   ├── packages/
│   │   └── registry.js       Optional-dependency registry backing Settings → Packages (§6). list() derives live
│   │                         status for yt-dlp/ffmpeg (youtube/bin.js), LibreOffice (import/pptx-import.js, detect-only),
│   │                         whisper-cpu (scripture-detect/whisper-bin.js), embed (scripture-detect/embed-bin.js) into
│   │                         one descriptor shape. install/remove/reveal/locate dispatch to each package's own module;
│   │                         GPU ASR models are NOT here (renderer/Cache-API-owned, added client-side by the modal).
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
│       │                     v32: contentFontScaleFrac/setChannelContentScale — per-channel fullscreen font-size multiplier,
│                     pushed live via content:scale (?cfs= at window creation, no window recreate). §13.
│                     v27 Stage layout: getStageLayout/setStageLayout (reads/writes output_channels.stage_layout_json;
│       │                     NULL → DEFAULT_STAGE_LAYOUT mirrored verbatim from stage.js). getStagePresets/saveStagePreset/
│       │                     deleteStagePreset (stage_presets setting). sendStageState() broadcasts stage:layout to every
│       │                     open window for the channel on setLayout + on window open.
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
│       ├── ndi.js            Active NDI implementation. createRequire loads @grandi/<platform>-<arch>
│       │                     at runtime. createSender / sendFrame (inflight guard) / sendAudio (FLTp planar) / destroySender.
│       └── ndi-input.js      NDI RECEIVE (v31 — live video sources). One grandi.find() finder + per-source receive()+framesync()
│                             video/audio pumps, in-flight crash guard (never destroy while a pull awaits), ~2fps JPEG previews,
│                             feed-health buzz gate. Fans full frames to fullscreen+stream windows only. §14.
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
│   │                         Timer duration is a free-text MM:SS field (parseDuration) + quick-duration chips, not
│   │                         spin dials; Start always commits the typed value first. Counts past zero into overrun
│   │                         (negative display, no auto-stop) — see §13 presenter timer overrun.
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
│   │   ├── StreamView.jsx    Stream Studio tab: external feed inputs (video/audio device pickers, audio mode), live
│   │   │                     composite monitor (output:stream-preview), layout preset bar + quick-layout templates,
│   │   │                     lyrics-over-feed, stereo level meters, dropped-frame health badge, RTMP config + Go Live.
│   │   ├── StreamLayoutEditor.jsx  WYSIWYG modal editor for the free-form stream layout: drag/resize the camera +
│   │   │                         program boxes on a 16:9 canvas, per-layer visibility/fit, z-order, lyric band, quick
│   │   │                         templates; Save/Save-as-New/Delete presets. Exports DEFAULT_LAYOUT, TEMPLATES, programFit.
│   │   │                         Mounts stream.open()/unmounts stream.close() (ref-counts the compositor for preview).
│   │   └── StageView.jsx         Stage Layout Editor — full-screen WYSIWYG editor for the customisable confidence-monitor
│   │                             layout. Drag/resize/add/delete elements on a 1920×1080 canvas (same % box model as
│   │                             StreamLayoutEditor); per-element inspector for type-specific props (label, color, font,
│   │                             showBar, showRef, etc.); quick-apply named presets; Save / Save-as-Preset / Revert to Default.
│   │                             Reads stage:layout (subscribes per-channel); writes via output.stage.setLayout / preset CRUD.
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
│   │   │                          StageMonitor — a layout-driven React mirror of stage.js. StageMonitor subscribes to
│   │   │                          `stage:layout` per channelId and renders a `StageElement` per-type component for each
│   │   │                          element in the layout (same % positioning), with live content bound in from props.
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
│   │   ├── LibraryPanel.jsx       Songs tab (react-window virtualised list) + Media tab (grid) + Scripture tab + Themes tab.
│   │   │                          Song search + tag filter (left-panel folders = tags). Clicking a tag SWITCHES to it
│   │   │                          (single-select; clicking the lone active tag clears); Shift-click adds/removes for
│   │   │                          multi-select (AND semantics). Media import.
│   │   ├── LibraryThemesTab.jsx   Operator Library → Themes tab (v34). SlidePreview gallery for one-tap "Use for this
│   │   │                          rundown" / "Set as default" (all/song/scripture/slide) without opening Settings;
│   │   │                          bumps OperatorView.themeTick so the live cascade re-reads.
│   │   │                          Import dropdown (Songs tab): "Import from File…" (dialog → songs.importParse →
│   │   │                          SongImportModal), "Import GHS Hymnal" (songs.importGhs → same modal), and
│   │   │                          "Find Song Online…" (opens SongScrapeModal — web lyric search + preview + save).
│   │   │                          Presentations tab: "Sermon to Slides" toolbar button opens SermonImportModal.
│   │   │                          GHS folder = the "GHS" tag; when it's the sole active filter the list orders by
│   │   │                          hymn number and a numeric "GHS number…" quick-search replaces the text search
│   │   │                          (Enter previews the exact number). Single-click (220ms) → SongPreviewModal (a
│   │   │                          LOCAL component distinct from components/SongPreviewModal.jsx, which RundownPanel
│   │   │                          uses instead). Its title+lyrics live in one `select-text` node (`contentRef`); the
│   │   │                          Add/Edit/Close buttons are an absolutely-positioned sibling outside that node, and
│   │   │                          ⌘A/Ctrl+A is intercepted to select only `contentRef`'s contents — otherwise a
│   │   │                          document-wide select-all would visually highlight the rundown and other chrome
│   │   │                          behind the modal backdrop.
│   │   │                          Double-click → add to rundown. Accepts refreshTick + focusSearchRef props.
│   │   │                          focusSearchRef focuses whichever search input is mounted (GHS number field in the
│   │   │                          GHS folder, else the song search) on S keypress. Graphics tab → <GraphicsPanel />.
│   │   ├── GraphicsPanel.jsx      Broadcast Graphics tab. Live destination override (Default/All/In-Room/Online),
│   │   │                          lower-third channel mode switcher (per-channel 3-way, runtime), Quick Ticker,
│   │   │                          grid of live-thumbnail cards (Take/Clear per kind), Clear All. Follows
│   │   │                          output:overlay-changed for Live badges. Hosts GraphicsEditor.
│   │   ├── ScenesAndOutputsPanel.jsx  Combined tab shell hosting ScenesPanel (live LOOK recall) + OutputPresetsPanel
│   │   │                          (output RIG recall) as two sub-sections. Mounted by LibraryPanel.
│   │   ├── OutputPresetsPanel.jsx Output Presets UI (v30). Card grid (Take/rename/delete/reorder) + capture modal
│   │   │                          (tick which layers to snapshot) + apply confirm. Recall replays the snapshot through the
│   │   │                          existing settings IPC (no db apply); outputPresetDiff flags out-of-sync presets. §05.
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
│   │   ├── ThemePickerModal.jsx   Reusable click-to-apply theme gallery. Full-screen grid of live SlidePreview tiles
│   │   │                          (filterBrowseThemes hides legacy; presentation decks bypass — they need layout themes).
│   │   │                          onPick(theme) — caller decides apply. Used by SongEditor + ScriptureEditor.
│   │   ├── TreatmentOverlays.jsx   Pure builders for the theme TREATMENT layer (§9): treatmentLayers/scrimBackground/
│   │   │                          glassBoxStyle/hasTreatment + the React <TreatmentOverlays>. MIRRORED VERBATIM in
│   │   │                          output/fullscreen.js. Used by SlidePreview + PreviewLivePanel monitors.
│   │   ├── ThemeCascadeBar.jsx     The inline "Theme: X · from {rundown|app default}" chip — shows where the effective
│   │   │                          theme is inherited from + change/reset actions (the visible-inheritance glue, §9).
│   │   ├── LazyVisible.jsx         IntersectionObserver wrapper — defers rendering an off-screen theme card's live
│   │   │                          preview until scrolled into view (gallery perf with 50+ animated previews).
│   │   ├── OnlineBibleModal.jsx   getbible.net catalog browser. Multi-select download with licence warning.
│   │   ├── PresentationEditor.jsx Full-screen presentation editor (createPortal). Slide sidebar (DnD reorder, built-in
│   │   │                          LAYOUTS: Blank/Title/Title+Subtitle/Title+Body/Section). Element canvas — a fixed
│   │   │                          1920×1080 stage scaled by transform (WYSIWYG with the live output); elements drag/
│   │   │                          resize (handles + outline counter-scaled by 1/scale); text elements support in-place
│   │   │                          editing via double-click → `contenteditable` (EditableElement component). Add
│   │   │                          Text/Image/Shape; per-element inspector (text reuses SongEditor's FormattingToolbar in
│   │   │                          `simple` mode + v-align + textarea; shape fill/stroke/radius; geometry + arrange).
│   │   │                          Header: draggable titlebar strip (titlebar-drag, clears the macOS traffic lights)
│   │   │                          with nodrag Cancel/Save; title input below.
│   │   ├── PptxImportModal.jsx    PowerPoint import flow (createPortal). Gates on a LibreOffice check (checking → missing
│   │   │                          nudge with Download/Check-again/Locate-manually | ready) so it never spawns a missing
│   │   │                          binary. Picks .pptx/.ppt/.pdf (split filters + All Files for the macOS UTI greying);
│   │   │                          convertPptx → rasterizePdf (per-slide progress) → createFromImages. PDF imports skip
│   │   │                          LibreOffice (pixel-perfect; offered even in the missing state).
│   │   ├── SongScrapeModal.jsx    Online Song Finder modal. Query input → `songs.scrapeSearch` → candidate list
│   │   │                          (title + artist + provider). Pick a result → `songs.scrapeFetch` → editable preview
│   │   │                          (SongEditor inside the modal) → Save adds the song to the library.
│   │   ├── SheetMusicImportModal.jsx  Sheet-music → song import (renderer OCR). Loads a page image → Florence-2
│   │   │                          (ocr/sheet-ocr-worker.web.js, WebGPU/wasm, opt-in model download) → ocr/sheetParse.js
│   │   │                          structures lines into title/verses/chorus → editable preview → save. §16.
│   │   ├── SermonImportModal.jsx  Sermon → Slides import modal. File picker (txt/md/docx) or paste text; PDF extracted
│   │   │                          via pdfText.js in the renderer. Theme + Bible version pickers. `presentations.sermonGenerate`
│   │   │                          → opens the PresentationEditor for the new deck on success. See §22.
│   │   ├── StageLayoutEditor.jsx  WYSIWYG stage-display layout editor (used in StageView.jsx). Drag/resize elements on
│   │   │                          a 1920×1080 canvas (% box model); type-specific inspector (label, color, fit, showBar,
│   │   │                          showRef…); named presets. DEFAULT_STAGE_ELEMENTS mirrors manager.js DEFAULT_STAGE_LAYOUT.
│   │   ├── AddYouTubeModal.jsx    Paste-a-URL modal (Media tab). Speculative prefetch on paste; Confirm adds the cue
│   │   │                          (if the URL was edited, abandons the speculative download); shows live youtube:status.
│   │   │                          `initialUrl` pre-fills + auto-resolves (clipboard chip); "Use my browser's YouTube
│   │   │                          login" control sets youtube_cookies_browser for the download cascade's cookies tier.
│   │   ├── MediaPickerModal.jsx   Media grid picker. Used by RundownPanel for bg override.
│   │   ├── MediaThumb.jsx         Cached thumbnail tile (cue-thumb:// + retry-with-backoff before the error fallback,
│   │   │                          §6). Used by every media grid/list.
│   │   ├── SlideList.jsx          Scrollable slide/section list. Preview and live variants.
│   │   │                          Slide content capped at max-h-24 to prevent runaway tall cards.
│   │   │                          Section labels via utils/sectionLabels (numbered: Verse 1 / Verse 2, abbrev forms).
│   │   │                          Presentation slides label by slide.label/"Slide N"; content preview = first text element.
│   │   ├── ContextMenu.jsx        Generic right-click menu positioned by x/y coords.
│   │   │                          Escape key closes menu. Overflow guard accounts for separator height.
│   │   ├── AnchoredMenu.jsx       Generic anchored dropdown, portaled to <body> (so no `overflow:hidden` ancestor
│   │                              clips it). Positions from the anchor's `getBoundingClientRect()`: opens below by
│   │                              default, flips above when short on room, clamps horizontally into the viewport;
│   │                              `align="left"|"right"` pins the matching edge. Re-places on scroll/resize/own-size
│   │                              change (ResizeObserver); closes on outside click or Escape (capture-phase, so it
│   │                              doesn't also close a host modal). Replaces ad-hoc `absolute` + outside-click-effect
│   │                              dropdowns in SongListImportModal, StageLayoutEditor, TopBarTabs, LibraryPanel's
│   │                              Import menu, and ScripturePanel's book picker.
│   │   ├── ResponsiveToolbar.jsx  Priority-plus toolbar that never renders controls off-screen: measures item
│   │                              widths in a hidden row, drops button labels to icon-only, then collapses trailing
│   │                              non-pinned items into a "⋯" AnchoredMenu. Descriptor-driven (`items` array); used by
│   │                              PresentationEditor's element toolbar and LibraryPanel's tab bar. See design-system §10.
│   │   ├── UpdateAvailableModal.jsx  Launch-time "Update available" prompt (mounted from App.jsx on the
│   │   │                          `update:available` event fired by main's auto-check §7/§19). Install Now
│   │   │                          / Later / Skip This Version (persists update_skipped_version, §5).
│   │   └── PackageManagerModal.jsx   Settings → Packages manager UI (§6). Card per optional dependency
│   │                              (window.cue.packages.list) — status/size/features/losesOnRemove, Install
│   │                              (packages:progress bar) / Remove (two-step confirm) / Reveal / Locate…
│   │                              (native file picker for a manually-installed binary/LibreOffice).
│   │
│   ├── settings/
│   │   ├── OutputChannels.jsx    Channel cards. Create/edit/delete. Monitor assignment per channel.
│   │   │                          NDI cards have an audio mute toggle (ndi_audio_muted) — volume_off/volume_up.
│   │   │                          Lower-third cards have a 3-way content mode (ChannelModeSwitch): Lyrics + Graphics /
│   │   │                          Lyrics Only / Graphics Only (show_program × show_graphics, via channelMode util).
│   │   │                          Also the global "Program audio output" device picker (program_audio_device; labels
│   │   │                          unlocked lazily on first interaction, never eagerly — see §13).
│   │   ├── LogoSettings.jsx      Global logo picker.
│   │   │                          (BackgroundSettings.jsx REMOVED in v34 — the standalone global-background pickers are
│   │   │                          retired; background lives in the theme + explicit overrides, §9. Video-loop control
│   │   │                          moved to Motion.)
│   │   ├── ThemeSettings.jsx     Theme Library + Theme Studio (v34). One flat gallery of "themes" (no category tabs) —
│   │   │                          cards lead with "Set as default" (all/song/scripture/slide chips) + "Use for this
│   │   │                          rundown"; the legacy bake is under Advanced. Curated 50 Collections + user themes shown
│   │   │                          (legacy built-ins hidden behind "Show legacy", themeSort.filterBrowseThemes). Two-pane
│   │   │                          Studio: token controls (background/surface/accent/motion/treatment/typography, L3 tab)
│   │   │                          + live multi-surface SlidePreview. New-from-a-background, Edit-a-copy, import/export.
│   │   ├── BackgroundLibrary.jsx  Settings → Background Library. Tag-filter grid of hotlinked remote thumbs
│   │   │                          (window.cue.backgrounds.*); "New from a background" auto-derives an editable theme.
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
│   │   ├── SongUsageSettings.jsx CCLI usage report (v31). Date-range picker → songs.usageReport table (title/author/
│   │                              copyright/count/last-used) + client-side CSV export (blob) + confirm-gated Clear Log.
│   │   ├── RemoteSettings.jsx    Network control card (enable toggle, port, Allow-LAN, pairing token copy/regenerate,
│   │   │                          phone URL, HTTP API reference) PLUS a Remote Output card (separate enable toggle,
│   │   │                          view-only /output link copy + Regenerate Link). Renders a QR (qrcode → data-URL,
│   │   │                          shown when LAN is on) for both the control pairing URL and the view URL. Drives
│   │   │                          remote:setConfig / regenerateToken / regenerateViewToken.
│   │   ├── DataSettings.jsx      Backup/restore card. Export button (settings.exportBackup) + confirm-gated
│   │   │                          Restore (settings.importBackup, "Overwrite all?" → "Choose file"; app relaunches
│   │   │                          on success). Shows current media disk usage. Toast feedback.
│   │   └── PackagesSettings.jsx  Settings → Packages entry point. Summary card (installed/total, disk usage) that
│   │                              opens PackageManagerModal.
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
│       ├── outputPresetDiff.js   Diffs a saved output preset's snapshot against the live rig (per included layer) so
│       │                         OutputPresetsPanel can flag "out of sync" / offer update-from-current. §05.
│       ├── snapping.js           Drag-snap helper for the WYSIWYG editors (Stage/Song/Presentation/Graphics): edge +
│       │                         centre alignment guides against siblings and the canvas, with a pixel threshold.
│       ├── useFocusTrap.js       useFocusTrap(ref, active) — traps Tab focus inside a modal + restores focus on close.
│       │                         Used by the import/scrape/YouTube/usage modals.
│       ├── themeSort.js          themeKind(theme) + sortThemes(list): Collection → media → gradient → custom ordering.
│       │                         v34: isCuratedTheme / filterBrowseThemes gate the gallery to Collections + user themes
│       │                         (legacy built-ins hidden behind "Show legacy"; current selection kept via keepIds).
│       ├── themeStyle.js         mergeSlideStyle(sectionStyle, themeStyle) — the shared live-theme merge rule (§9): a baked
│       │                         BASE style wins, but an inline-only/null section inherits the theme with its runs on top.
│       │                         Used by OperatorView buildPayload + the monitors.
│       ├── ensureThemeBg.js      Download a theme's photo/video bgRef on every assignment (spinner toast only on a real
│       │                         fetch) so go-live never shows black; wraps themes.resolveBackground.
│       ├── contrast.js           WCAG contrast helpers for the theme editor (text-on-background legibility readouts).
│       ├── themeSearch.js        Theme gallery search/filter (name + mood/collection tags).
│       ├── themeFavorites.js     Font/theme favourites (pin-to-top), persisted in localStorage.
│       ├── pdfText.js            extractPdfText(bytes) → plain text string (pdfjs, DOM-side). Reconstructs lines from
│       │                         text-item `hasEOL`/y-position info so sub-point structure survives PDF extraction.
│       │                         Used by SermonImportModal to extract text before passing it to `sermon:generate`.
│       ├── pdfRaster.js          rasterizePdf(bytes, targetWidth=2560, onProgress) → [PNG Uint8Array] per page (pdfjs,
│       │                         fresh ?worker per call → workerPort; lossless PNG for crisp text). Used by PptxImportModal.
│       └── sectionLabels.js      Numbered section labels — single source of truth. sectionOrdinals(slides) (n or null,
│                                 numbered only when a type repeats); sectionLabels(slides,{abbrev}); sectionLabelAt.
│                                 Used by SlideList, SongEditor, OperatorView buildPayload (stage label), the remote.
│                                 Also owns variable-size section splitting: SLIDE_BREAK ('⁂'), splitSectionContent(content)
│                                 → parts, expandSongSections(sections, arrangement, opts) → flat slide list (one slide per part,
│                                 labels computed at the SECTION level so parts share "Verse 1"; carries _label/_labelAbbr/
│                                 _partIndex/_partCount/_key). applyArrangement reorders by 0-based positions (v31, §16) —
│                                 labels stay on the natural list so a repeated chorus keeps its name. getSlides()'s song branch returns this.
│                                 v33: splitByMaxLines(content,maxLines) + maxLinesOf(section) — auto-pagination cascade
│                                 (opts.songMaxLines/globalMaxLines), applied per-⁂-part after splitSectionContent (§8, §16).
│
│   ├── ocr/                       Sheet-music OCR (renderer, opt-in Florence-2).
│   │   ├── sheet-ocr-worker.web.js  Web Worker (Vite ?worker) — transformers.js Florence-2 <OCR_WITH_REGION> on WebGPU/wasm.
│   │   │                         Local ORT wasm via ?url (no CDN); weights cache in the Cache API; single-flight generate().
│   │   ├── sheetOcrStore.js       Spawns/owns the worker; sheetModelPresent() opt-in gate; progress + result plumbing.
│   │   ├── sheetParse.js          Pure line→structure parser (title/author/numbered verses/chorus; drops chords/tempo).
│   │   └── sheetParse.test.mjs    Node test for sheetParse (wired into `npm test`).
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
│   │                         feed base (getUserMedia, resolved by label), free-form box layout (programFit), lower-third lyric
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
│   │                         onSlideUpdate decode-gates incoming logo/background IMAGES (Image.decode() offscreen,
│   │                         latest-wins via _renderSeq) before committing, so a swap never shows a decode-latency
│   │                         black flash. CONTENT_FONT_SCALE (?cfs=, live via content:scale) multiplies fontSize (§13).
│   ├── lowerthird.html       #lowerthird > #text + #copyright (lyric band) + graphics-overlay.js. Always transparent.
│   ├── lowerthird.css        #lowerthird: bottom-anchored, background: transparent (controlled by JS via ltBar).
│   ├── lowerthird.js         The LYRIC BAND only (program slide). applyStyle(el, s) incl. ltBar gradient to #lowerthird.
│   │                         buildBarBg(ltBar): null → transparent; {color,opacity,solid} → CSS gradient or solid.
│   │                         ?program=0 / content:mode toggle the lyric band live (caches lastPayload to restore).
│   │                         onSlideUpdate routes the band through CueTransitions (whole #lowerthird, no fgSel); the
│   │                         content:mode path snaps (no transition). The graphics overlay is separate (graphics-overlay.js).
│   ├── stage.html            Confidence monitor shell. Just `#stage-root` — the DOM is built entirely by stage.js
│   │                         from the per-channel layout spec (v27). No fixed top-bar/content/bottom-bar structure.
│   ├── stage.css             Stage monitor styles — `.stage-el` absolute positioning, per-type classes (el-current /
│   │                         el-next / el-clock / el-timer / el-elapsed / el-video / el-message / el-static),
│   │                         progress track/bar, countdown colour states, message alert.
│   └── stage.js              v27: WYSIWYG layout-driven. Receives `stage:layout` → `buildLayout(elements)` tears down
│                             the existing node registry and rebuilds #stage-root into one absolutely-positioned div per
│                             element; re-applies all live state to the new nodes. BUILDERS map (per-type DOM constructor)
│                             + nodes registry (byId / byType). Receives slide:update + stage:timer + stage:message +
│                             stage:schedule. Video preview via CueMediaPlayer (always baseMuted). VIDEO countdown
│                             derives remaining from transport + clip duration — loops with the clip, freezes on pause.
│                             Presenter timer counts past zero into overrun (negative fmtTime, .timer-overrun steady
│                             red, no auto-stop — §13); Presenter countdown + message: resolveMessage() picks immediate (precedence) else the active
│                             scheduled one, re-ticked every 1s against Date.now() anchors (mirrors resolveActive in
│                             src/shared/stage-schedule.js — plain <script>, can't import). DEFAULT_ELEMENTS (the classic
│                             3-bar layout) is mirrored verbatim as DEFAULT_STAGE_LAYOUT in manager.js — they MUST stay
│                             identical; the window shows DEFAULT_ELEMENTS before stage:layout arrives.
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
- `forge.config.js` — Electron Forge packaging config. `extraResource` for bundled bibles/hymnal; a `packageAfterPrune` hook copies native externals (+ closure) and the plain-DOM `src/output`/`src/fonts` into the package and prunes `onnxruntime-node` to the build's platform/arch (see §20); a `postMake` hook builds the Windows NSIS installer (`installer/cue.nsi`); `asar.unpack` keeps native modules on the real filesystem.
- `index.html` — Vite renderer entry HTML

**Project-root data/tooling (outside `src/`):**
- `resources/bible/{kjv,web}.json` — bundled public-domain translations (seeded on first run; shipped via `extraResource`)
- `resources/ghs/ghs-hymnal.json` — bundled GHS hymnal seed `{ items:[{ number, name, lyrics }] }` (260 hymns; shipped via `extraResource`, seeded on first run by seedGhsHymnal)
- `resources/themes/*.json` — bundled built-in theme packs (one theme per file: `{ name, category, sort_order, style }`; song / media / scripture / **presentation** categories). Presentation theme `style` is a layout-agnostic **token bag** `{ kind:'pres-theme', … }` (§21), not a §8 text style. Currently 30 song/presentation themes (presentation-01 … presentation-30). Shipped via `extraResource`, seeded by `seedBundledThemes` (§5 themes)
- `resources/graphics/` — built-in broadcast-graphic design presets, read at request time by `graphics.presets()` (NOT seeded): `*.html` (custom designs, `<!-- name: … -->` header) + `*.json` (structured lower_third/ticker/countdown). Shipped via `extraResource`
- `resources/media-manifest.json` — Background Library manifest (tags + dims + hotlinked `thumb` + origin `url` per item). Shipped via `extraResource`; the media files themselves are download-on-demand (Option A, never bundled/rehosted — §7 backgrounds)
- `scripts/build-fonts.mjs` — regenerates bundled fonts: woff2 → `src/fonts/` + `@font-face` in `fonts.css` + entries in `BUNDLED_FONTS`
- `scripts/build-themes.mjs` / `build-media-themes.mjs` / `build-scripture-themes.mjs` / `build-presentation-themes.mjs` — author the `resources/themes/*.json` packs (song gradient, media-backed, scripture, presentation token themes)
- `scripts/*.py` (organize-media / fetch-phase1b-media / resolve-urls / add-thumbnails) — build/refresh `media-manifest.json` (curation tooling)
- `resources/bin/<platform>-<arch>/` — **dev-only** local `yt-dlp` + `ffmpeg` (gitignored, never shipped). A dev checkout can drop binaries here so `npm start` uses them instead of triggering the first-use auto-download; packaged builds always auto-download into `userData/bin` (see §6 *Native YouTube player*)
- `scripts/build-bibles.mjs` — regenerates the bible seed JSON from getbible.net v2 (`node scripts/build-bibles.mjs`)
- `scripts/build-ghs.mjs` — regenerates the GHS seed from a number→name CSV (cp1252) + lyric text files (`node scripts/build-ghs.mjs <csv> <lyricsDir>`)

---
