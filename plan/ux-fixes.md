# Cue — UX Fixes Tracker

**Status legend**
- `[ ]` Solution agreed, not started
- `[?]` Direction not yet decided
- `[~]` In progress
- `[x]` Done

---

## Critical — Broken or Dead Features

- ~~**Item notes: no edit UI**~~
  _Removed — the notes feature was dropped entirely (see Decisions Log Q8). A notes editor was briefly built, then removed along with the rest of the notes concept: the `setItemNotes` IPC/preload/DB function, the context-menu entry, the "NOTE" badge, and the editor modal are all gone. The nullable `service_items.notes` column is left in place (no migration)._

- [x] **PDF export silently skips scripture, presentation, and YouTube items**
  `src/main/export/rundown-pdf.js` handles only `song`, `media`, and `slide` types.
  _Solution:_ Add render paths for `scripture` (print reference + text of each verse), `presentation` (print title + slide labels), and `youtube` (print title + URL). Blank pages or "[No text]" placeholders are acceptable for media/video cues.

- [x] **Video duration never stored, and not shown on stage monitor**
  `media_assets.duration_ms` column exists but nothing writes to it. The stage monitor has a `videoCountdown` element type that is never fed real duration data.
  _Solution:_ On media import in `src/main/db/media.js`, probe duration with ffmpeg header-read (fast, no decode). Store in `duration_ms`.

- [x] **Presentation slide: label edit UI** (notes dropped)
  A per-slide **label** field was added to the `PresentationEditor` inspector (shown when no element is selected). It feeds the rundown PDF export's slide list and the New-Slide/template previews. Slide *notes* were dropped along with the rest of the notes feature (Decisions Log Q8) — `presentation_slides.notes` is no longer read or written; the column is left in place (no migration).

- [x] **`window.alert()` in RundownPanel**
  `RundownPanel.jsx:446,454` — PDF export errors use native `window.alert()`.
  _Solution:_ Replace both with `toast.error(...)`.

---

## Critical — Silent Failures

- [x] **IPC handlers: no try/catch on any CRUD handler**
  `services.ipc.js`, `media.ipc.js`, `graphics.ipc.js`, `scenes.ipc.js`, `songs.ipc.js` are all bare calls. A SQLite error (disk full, FK violation) propagates as an unhandled rejection with zero user feedback.
  _Solution:_ Wrap every `ipcMain.handle` body in `try { … } catch (err) { throw new Error(err.message) }` as a minimum floor. For handlers that return a value, return `{ ok: false, error: err.message }` instead of throwing, and check on the renderer side.

- [x] **`settings:exportBackup` and `settings:importBackup` not wrapped**
  A corrupt archive or disk-full during restore throws a raw rejection with no `{ ok, error }` envelope.
  _Solution:_ Wrap both handlers in try/catch; return `{ ok: false, error: err.message }` on failure. The renderer already pattern-matches on `.ok` for these calls so the fix is just in the IPC layer.

- [x] **`setStageLayout` and `setLowerthirdFontScale` silently swallow DB errors**
  `manager.js` wraps both in `try {} catch {}` — in-memory state updates but the change never persists.
  _Solution:_ Remove the silent catch. Let the error propagate to the IPC handler (which will then be covered by the try/catch fix above), surfacing it as a toast.

- [x] **NDI sender creation failure is invisible**
  If `createSender()` fails in `ndi.js`, only a `console.error` fires. The channel appears operational in the UI but is never transmitting.
  _Solution:_ `createSender` returns null on success or error string on failure. Manager emits `output:ndi-sender-error` to renderer. `OutputChannels.jsx` subscribes and shows persistent inline error banner on the affected NDI channel card. It also emits `output:ndi-sender-ok` on a later successful (re)create, which clears the stale banner for that channel.

- [x] **RTMP reconnect loops forever on bad credentials**
  `stream/rtmp.js` reconnects indefinitely on any ffmpeg exit. A bad RTMP key spins forever.
  _Solution:_ Capped retries at 5 with exponential backoff (3s→6s→12s→24s→30s). After cap, set `state='error'`. StreamView shows "Reconnect" button when `state === 'error'` alongside a Stop button. The retry counter resets to 0 once a reconnect actually produces frames (goes live), so the cap counts *consecutive* failures rather than lifetime blips over a long stream.

- [x] **Silent microphone permission failure in Scripture Detection Settings**
  `ScriptureDetectionSettings.jsx:37` catches `enumerateDevices` rejection silently. The audio input picker is empty with no explanation.
  _Solution:_ Already present — `deviceError` state shown as inline error text below the device picker.

- [x] **yt-dlp / ffmpeg offline first-use failure**
  If the user is offline when yt-dlp/ffmpeg first auto-download, the error is a raw Node `fetch` rejection.
  _Solution:_ Already handled — `downloader.js` shows "Could not download YouTube support (yt-dlp + ffmpeg). Check your connection and retry." and `manager.js` surfaces `ready.error` to the stream status on failure.

---

## High — Per-Service Workflow Friction

- [x] **Library click model: inconsistent and delayed**
  Songs: click=preview popup, dbl=add. Media: click=add, dbl=set-bg. Presentations: click=editor, dbl=add. All have a 220ms debounce delay.
  _Solution:_ Unified model across all tabs — single-click = inline preview strip below the list (no popup modal), double-click = add to rundown. 220ms debounce removed. **Media tab background assignment:** Drag a media asset from the Media grid and drop it onto a rundown **song or scripture** item to set it as that item's background override. A drop target highlight appears on eligible rundown rows during a drag. Also keep the context menu entry "Set Background for [item]" on the media tile (greyed when no eligible item — song or scripture — is in preview) as a secondary path.

- [x] **Scripture panel: Enter sends verse live immediately**
  Pressing Enter on a selected verse bypasses the preview monitor and sends it straight to output.
  _Solution:_ Keep Enter = live. Added a **Preview** button (P shortcut) alongside the **Go Live** button in the ScripturePanel reference bar, plus a "Preview" entry in the verse context menu. Preview stages a verse into the preview monitor without going live; `stageScripturePreview` is wired OperatorView → LibraryPanel → ScripturePanel via the `onPreview` prop.

- [x] **Bulk delete: no undo**
  Individual `removeItem` gets a 6-second undo toast. `handleBulkDelete` does not.
  _Solution:_ Already present — `handleBulkDelete` in `OperatorView.jsx` snapshots items and shows undo toast with `services.addItems`.

- [x] **Presentation delete: no confirmation**
  Context menu "Delete" in `LibraryPanel.jsx:794` fires immediately with no guard.
  _Solution:_ Added `confirm: true` to the context menu item; ContextMenu now supports inline two-step confirmation (Delete? / Yes / No) without closing.

- [x] **Remote API: no graphics bus control**
  The HTTP remote has no endpoints for lower-thirds, tickers, countdowns, or custom graphics. Stream Deck/Companion operators cannot drive the graphics bus.
  _Solution:_ Added REST endpoints in `server.js`: `/api/graphic/show`, `/api/graphic/hide`, `/api/ticker/show`, `/api/ticker/hide`, `/api/countdown/show`, `/api/countdown/hide`, `/api/graphics/clear-all`. `configure()` accepts a `graphics` object; `main/index.js` passes outputManager's graphic functions.

- [x] **Bulk delete (all 10 `confirm()`/`alert()` calls)**
  Replace every native blocking dialog in the renderer with in-app alternatives.

  | File | Call | Replacement | Status |
  |---|---|---|---|
  | `OutputChannels.jsx:114` | `confirm()` delete channel | Two-step inline confirm | Done |
  | `BackgroundSettings.jsx:123` | `confirm()` apply bg to rundown | Two-step inline confirm | Done |
  | `BackgroundSettings.jsx:132` | `confirm()` apply bg to library | Two-step inline confirm | Done |
  | `ThemeSettings.jsx:449` | `confirm()` apply theme to library | Two-step inline confirm | Done |
  | `ScenesPanel.jsx:59` | `confirm()` delete scene | Two-step inline confirm | Done |
  | `GraphicsPanel.jsx:89` | `confirm()` delete graphic | Two-step inline confirm | Done |
  | `LibraryPanel.jsx:350` | `confirm()` delete song | Toast with undo | Done |
  | `LibraryPanel.jsx:412` | `confirm()` delete media | Toast (no undo — file is permanently deleted) | Done |
  | `RundownPanel.jsx:446` | `alert()` PDF unavailable | `toast.error()` | Done |
  | `RundownPanel.jsx:454` | `alert()` PDF export error | `toast.error()` | Done |

- [x] **GO button: no tooltip when disabled**
  The GO button grays out with no explanation when no preview item is selected.
  _Solution:_ Already present: `title="Select a rundown item to preview first"` when `!canGo`.

- [x] **Verse-jump: too hard to enable**
  Enabling Q/W/E jump keys requires a Settings round-trip.
  _Solution:_ Already present — "Jump ON/OFF" toggle button in `PreviewLivePanel` slide list header, visible when live item has >1 slide.

- [x] **Scene hotkey: picker is a `<select>` not key capture**
  The operator picks 1–9 from a dropdown instead of pressing the key they want.
  _Solution:_ Key-capture button shows current key; on click shows "Press 1–9…" and captures the next keydown in `ScenesPanel`. The capture handler calls `stopPropagation()` so the assigned digit doesn't also reach the operator's document keydown handler and recall that scene live (the focus guard there only excludes INPUT/TEXTAREA, not buttons).

- [x] **Scene cards: hotkey not displayed**
  Assigned number keys are invisible on scene cards.
  _Solution:_ Already present — blue badge showing hotkey digit in top-right of each scene card.

- [x] **Scene "Test" applies live without warning**
  The Test button in the scene editor fires to live output with no warning.
  _Solution:_ Already present — "Updates live output" label next to Test button in `ScenesPanel`.

- [x] **Scene "Capture" overwrites without preview**
  "Capture current output" replaces the scene's stored state with no diff shown.
  _Solution:_ Already present — capture button shows "Replaces this scene with a snapshot of the current live overlay, program layer, and audio state."

- [x] **Graphic edit/delete buttons: invisible until hover**
  Edit/delete icons on graphic cards are `opacity-0` at rest.
  _Solution:_ Already at `opacity-30 group-hover:opacity-100` in `GraphicsPanel`.

- [x] **"Clear All Graphics" has no confirmation**
  `clearAll()` fires immediately with no guard.
  _Solution:_ Already present — two-step inline confirm via `confirmClearAll` state.

- [x] **Graphics destination override: resets on tab change**
  The In-Room / Online / Stream destination chip toggles in `GraphicsPanel.jsx` are local React state.
  _Solution:_ Already persisted to `localStorage` under `cue.graphics.destOverride`.

- [x] **Scripture detection: no visible indicator outside the Scripture tab**
  When ASR is armed there's nothing in the header showing the mic is active.
  _Solution:_ Already present in `App.jsx` toolbar — mic icon with pulsing green dot when `headerState.micActive`.

- [x] **Stage panel: no keyboard shortcut**
  The Stage controls popover can only be opened by clicking the toolbar button.
  _Solution:_ Already present — backtick (`` ` ``) shortcut toggles `stageOpen`.

- [x] **Disabled settings controls have no tooltip**
  Transition duration/easing (when type=none), background blend sliders (when loop≠blend), and detection confidence bands (when disabled) go `pointer-events-none` with no explanation.
  _Solution:_ Already present — `title` on disabled containers in `TransitionSettings.jsx` and `BackgroundSettings.jsx`.

---

## Medium — Meaningful Friction

- [x] **Media tab: no search box**
  No way to find a media asset by name without knowing its folder.
  _Solution:_ Already present in `LibraryPanel` — search input above media grid, filters by filename.

- [x] **Media grid: no hover metadata**
  Thumbnails show filename only. No resolution, duration, file size.
  _Solution:_ Added `formatDuration`/`formatBytes` helpers and a hover overlay strip on media tiles in `LibraryPanel.jsx` showing duration and file size. `size_bytes` now stored on import (v29 migration); `duration_ms` already stored for video/audio.

- [x] **Auto-advance: no live countdown**
  The `advance_seconds` badge is static while an item is live counting down.
  _Solution:_ `OperatorView` tracks `autoAdvanceStartAt` and passes it to `RundownPanel`. The live item row runs a 500ms interval to recompute remaining seconds and shows a green-tinted countdown badge.

- [x] **No slide progress indicator**
  No "Verse 2 of 5" shown anywhere while a song is live.
  _Solution:_ `OperatorView` passes `liveSlideIdx` and `liveSlideCount` to `RundownPanel`, which shows a `N/M` badge on the live item row.

- ~~**Service-level notes: no UI**~~
  _Removed — notes dropped entirely (Decisions Log Q8). No service-notes editor exists; the earlier "sticky note icon in the service header" claim was inaccurate — that UI was never actually built. `services.create/update` still carry the nullable `notes` column but only ever write null now._

- [x] **DangerZone: delete service has no undo**
  "Clear items" (within a service) has an undo toast. "Delete service" does not.
  _Solution:_ Already present — `DangerZone.jsx` snapshots service + items and shows 8s undo toast.

- [x] **Song deletion: `confirm()` + second `alert()` for in-use case**
  Two blocking native dialogs for one action.
  _Solution:_ Already present — `handleDeleteSong` uses `toast.error` for in-use case and undo toast for successful delete.

- [x] **Media deletion: `confirm()`**
  _Solution:_ Already uses `toast.show` with info kind after deletion (no confirm dialog).

- [x] **"Set as Global Scripture Background" missing from media context menu**
  Song and Slide global backgrounds are in the media grid context menu; Scripture is not.
  _Solution:_ Already present — "Set as Global Scripture Background" at line 141 of `LibraryPanel.jsx`.

- [x] **Song duplicate: no feedback, no scroll to copy**
  `handleDuplicateSong` creates the copy silently.
  _Solution:_ Already present — `toast.success('Duplicate of "${song.title}" created')` after create.

- [x] **Drag handle: invisible until hover**
  The 6-dot handle in rundown rows is `opacity-0` at rest.
  _Solution:_ Already at `opacity-20 group-hover:opacity-100` in `RundownPanel`.

- [x] **Song tag filter: no item counts**
  Tags in the left rail show name + colour dot but no count.
  _Solution:_ Already present — tag counts returned from DB and rendered in `LibraryPanel`.

- [x] **"Import Translation" button: no dropdown affordance**
  The Bible Settings import button opens a submenu but has no chevron or split styling.
  _Solution:_ Already present — `expand_more` icon on the Import Translation button in `BibleSettings.jsx`.

- [x] **Stage message presets**
  Operators retype the same messages every service.
  _Solution:_ Presets stored as JSON array in `settings` key `stage_message_presets`. Shown as clickable chips above the stage message textarea in `App.jsx` Stage popover. Clicking a chip fires immediately; × removes it. "+ Preset" button saves current text.

- [x] **"Move to service" and "Copy to service" context menu options**
  Items can't be moved between services without remove + re-add.
  _Solution:_ Already present — both submenus exist in `RundownPanel` context menu, call `services.addItems` (Move also calls `removeItem`).

- ~~**Service duration estimate**~~
  _Removed — not a useful feature._

- [x] **Command palette: empty state shows nothing**
  No results are shown when the query is empty.
  _Solution:_ Already present — shows keyboard shortcuts cheatsheet when query is empty in `CommandPalette.jsx`.

- [x] **`presentation_templates`: IPC wired, no UI**
  `presentationTemplates:list/get/create/delete` handlers exist. No "Save as Template" or "Apply Template" in `PresentationEditor.jsx`.
  _Solution:_ Added `SaveTemplateModal` (name input → `presentationTemplates.create`) triggered by a "Save as Template" toolbar button. Added "My Templates" section at the top of the `NewSlideModal` left rail — selecting a template shows a full preview on the right with a "Use Template" button that calls `onAddTemplate(id)`, which clones the template's elements into a new slide.

- [x] **No Linux distribution**
  `forge.config.js` has no Linux maker.
  _Solution:_ Added `@electron-forge/maker-deb` and `@electron-forge/maker-rpm` to `forge.config.js` makers array; added both as devDependencies in `package.json`. Run `npm install` then `npm run make` to produce `.deb`/`.rpm`.

---

## Low — Polish and Discoverability

- [x] **No tooltip on GO button when canGo but output windows = 0**
  Users can GO with no output windows open and nothing appears to happen.
  _Solution:_ Already present — `App.jsx` shows "Click to open output windows" tooltip and makes "No outputs" chip clickable to call `setLive(true)`.

- [x] **"No outputs" state in toolbar: no action affordance**
  The toolbar shows "No outputs" but clicking the monitor icon does nothing.
  _Solution:_ Already present — "No outputs" chip is clickable and calls `window.cue.output.setLive(true)` with tooltip.

- [x] **Rundown item: no keyboard shortcut for context menu**
  Right-click only; no Menu key or keyboard equivalent.
  _Solution:_ Added document-level `keydown` listener in `RundownPanel` that intercepts `e.key === 'ContextMenu'` and opens the context menu for `previewItemId` at the item row's bounding rect.

- [x] **Scene "Capture current output" description is vague**
  _Solution:_ Already present — descriptive copy shown under capture button.

- [x] **Transition settings: blend controls grayed with no tooltip**
  Already covered above in the disabled-controls fix.

- [x] **No "Reset layout" button for panel sizes**
  Panel widths/heights persist in `localStorage` but can't be reset without clearing storage.
  _Solution:_ Added "Reset panel layout" button in the `ShortcutsOverlay` footer — clears `layout_h_pct` and `layout_v_pct` from localStorage, then reloads.

- [ ] **`themes.category` latent values (scripture / graphic / presentation)**
  Only `song` themes have a creation path.
  _Solution:_ Phase 1b: add `scripture` category themes (apply style to all scripture output, separate from song themes). Phase 1c: `presentation` slide themes. Track as separate feature work.

- [x] **`media_assets.size_bytes` — add on import**
  Currently not stored. Needed for the metadata hover tooltip fix.
  _Solution:_ Added `size_bytes INTEGER` column via v29 migration in `schema.js`; `importFiles` now reads `fs.statSync(dest).size` and stores it.

- [x] **`bible:adjacent` not exposed as navigation button**
  Prev/Next verse IPC exists but ScripturePanel has no prev/next buttons.
  _Solution:_ Already present in `ScripturePanel` — `←` / `→` buttons call `window.cue.bible.adjacent(...)`.

---

---

## Round 2 — Full-app operator review (2026-07-02)

A second review pass over the operator surfaces found and fixed:

- [x] **Esc (and Space/G/arrows/digits) fired transport actions under open modals** — pressing Esc to close the Song Editor also blanked the live program when focus wasn't in a text field.
  _Solution:_ Central modal guard (`src/renderer/utils/modalGuard.js` — module counter + `useModalGuard()` hook). Every modal-like component (13 components + `AutoAdvanceModal`, incl. `ContextMenu` which covers all right-click menus) registers itself; OperatorView's document keydown returns immediately while any modal is open. `MediaPickerModal` also gained the Escape-to-close it was missing.

- [x] **Toolbar GO button stayed disabled when a scripture verse was staged in preview** (via detection auto-preview or the Scripture panel's Preview button) — keyboard G worked, the button didn't.
  _Solution:_ `canGo` now ORs `!!previewScripture` (OperatorView header-state effect).

- [x] **Bare operator keys fired from other tabs** — Space/Esc/G in Settings/Stream/Multiview/Stage invisibly changed the live program; S focused a hidden search box.
  _Solution:_ App passes `viewActive`; OperatorView suppresses all bare keys (and ⌘K/⌘./⌘,/?/⌘A) when the Operator view isn't visible. The configurable ⌘ transport shortcuts and 1–9 Scene recall stay global by design.

- [x] **GO with zero output windows was silent from the keyboard** (button tooltip only).
  _Solution:_ `warnIfNoOutputs()` in `handleGo` — toast with a "Turn on outputs" action when outputs are off, or a check-Settings notice when enabled but windowless. Debounced to one toast per 8s.

- [x] **No auto-scroll during a service** — the active slide (preview + live columns) and the live/preview rundown rows could sit off-screen as Space/auto-advance/remote moved the service along.
  _Solution:_ `scrollIntoView({ block: 'nearest' })` effects in `SlideList` (keyed on `activeIdx`) and `RundownPanel` (keyed on `liveItemId` / `previewItemId`).

- [x] **Stage popover state was fake after reopen** — timer/message state was local React state that unmounted with the popover, so a running stage timer showed as idle 10:00 on reopen.
  _Solution:_ Main now exposes `getStageTimer()`/`getStageMessage()` (IPC `output:stage:timer:get`/`message:get`) and notifies the operator window on change (`stage:timer`/`stage:message`, change-driven only — no per-second IPC). `StagePanel` seeds from main on mount and stays subscribed; the countdown still ticks locally.

- [x] **Library song search was a keyboard dead end** — S focused search, but picking a result needed the mouse.
  _Solution:_ ↓/↑ move a highlighted row (react-window `scrollToItem`), Enter adds the highlighted (or first) result to the rundown and re-selects the query text for the next search, Esc clears then blurs (with `stopPropagation` so it never reaches the app-level Clear).

- [x] **Service delete from the rundown header had no undo** (the Settings DangerZone version did).
  _Solution:_ `handleDeleteService` snapshots the service + items and shows an 8s undo toast that re-creates and re-selects the service — mirrors DangerZone.

---

## Decisions Log

All design decisions have been settled. Solutions are recorded inline against each issue above.

| # | Question | Decision |
|---|---|---|
| Q1 | Library click model | Click = inline preview strip, double-click = add to rundown. Media "set as song background": drag media asset onto a rundown item to set its background (drop target highlight on rows). Also available via media tile context menu (greyed if no song in preview). |
| Q2 | Scripture Enter | Keep Enter = live. Add a Preview button (P shortcut) to stage without going live. |
| Q3 | Remote graphics API | New REST endpoints: `/api/graphic/show`, `/api/graphic/hide`, `/api/ticker/show`, `/api/ticker/hide`, `/api/countdown/show`, `/api/countdown/hide`, `/api/graphics/clear-all`. |
| Q4 | Stage messages | Saved named presets, persistent in DB. Click to fire. Free-text input remains for ad-hoc. |
| Q5 | Move vs Copy | Both: "Move to service ›" and "Copy to service ›" as separate submenus in context menu. |
| Q6 | Service duration | Removed — not a useful feature. |
| Q7 | Palette empty state | Keyboard shortcuts cheatsheet. |
| Q8 | Notes feature | **Removed entirely.** All notes surfaces dropped app-wide — rundown item notes (badge, modal, context menu, `setItemNotes` IPC/DB), presentation slide notes, and service-level notes. Nullable `notes` DB columns are left in place (no migration); `services.create/update` write null. Delete/undo snapshots no longer carry a `notes` field. |

---

## Post-review corrections (2026-07-02)

A review pass after the initial implementation caught and fixed:
- **Scene hotkey capture also fired the scene live** — added `stopPropagation()` in the capture handler.
- **RTMP retry budget was lifetime, not consecutive** — `retryCount` now resets to 0 once a reconnect produces frames.
- **ScripturePanel had lost its Preview/Go Live buttons** — only the `P` shortcut existed and the Go Live button had been removed; both buttons (+ a context-menu Preview entry) restored.
- **NDI error banner never cleared** — added `output:ndi-sender-ok` to clear it on a later success.
- **Song delete undo was lossy** — now restores section styling, tags, own background, and lock.
- **"Set Background" media entry didn't cover scripture** — `previewSongLabel` now resolves scripture references.
- Removed a dead `showFolderLabel` prop.

---

_Last updated: 2026-07-02_
