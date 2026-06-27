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
