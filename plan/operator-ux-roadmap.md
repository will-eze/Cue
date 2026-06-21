# Cue — Operator UX Roadmap (Wave 2)

**Status:** proposal — no code written yet. This is a *new* batch of operator-experience
requests, captured 2026-06-21. It is **separate** from `plan/feature-roadmap.md` (the prior
wave: theme packs, scripture-detection bands, scenes, etc.) and does not repeat any of it.

Every item is grounded in the **current** architecture (`plan/cue-master-reference.md`,
schema v23, the `window.cue` IPC surface, the main/renderer/output three-process split). Each
proposal extends a system that already exists — none needs a re-architecture.

Each item lists its **core value** (the thing we must not lose), the **fleshed-out behaviour**,
**where it slots in** (real files), **guard rails**, and **effort**.

Effort key: **S** ≈ 1 sitting · **M** ≈ a few sessions · **L** ≈ a phase of its own.

---

## Priority Summary

| # | Feature | Theme | Effort | Priority |
|---|---|---|---|---|
| 1 | Verse/slide **jump shortcuts** (Q W E R …, armable like GO/Clear) | Live navigation | **M** | **P0** |
| 2 | **Undo/redo** in every editor | Editor safety | **M** | **P0** |
| 3 | **Double-click media → set background** of the previewed song (+ undo) | Operator speed | **M** | **P0** |
| 4 | **Download spinner/toast** when a theme (and its media) is fetching | Feedback | **S** | **P0** |
| 5 | **Customisable top bar** (add Settings/Themes/Detection tabs via a + button) | Personalisation | **M** | **P1** |
| 6 | **Multi-select rundown** (Ctrl/Shift-click + drag-select → bulk delete / bg) | Operator speed | **M** | **P1** |
| 7 | **Fix YouTube** (yt-dlp now needs session cookies) | Reliability | **L** | **P3 — deferred** |

---

## P0 — High-leverage operator wins

### 1. Verse / slide jump shortcuts (Q W E R …)

**Core value (must not lose):** during live playback the operator can jump *directly* to a
specific verse/slide with a single letter key, instead of stepping with arrows — and which key
maps to which slide is **configurable**, in the same spirit as the existing "Arm bare GO/Clear"
setting (`ShortcutSettings.jsx`).

**Fleshed-out behaviour:**
- While an item is live/previewed, letter keys `Q W E R T Y …` (a defined home-row-adjacent set)
  jump the **preview** (or live, see below) to slide 1, 2, 3, … of the *current* item. The keys
  are positional — `Q` = first slide, `W` = second — so the operator never re-learns a mapping
  per song; it's the same muscle memory every service.
- A small, always-visible legend on each slide chip in `SlideList` / `PreviewLivePanel` shows the
  letter for that slide (like the number-key hint on Scenes), so the mapping is discoverable.
- **Arming.** Mirror the `shortcut_arm_bare` pattern: a Settings toggle "Arm verse-jump keys"
  (default off, since bare letters can fire mid-task). When disarmed the keys do nothing; when
  armed they jump. This reuses the exact `sc.armBare`-style gate already read in the
  `OperatorView` keydown handler.
- **Preview vs live semantics** must match the existing rule (arrows drive *preview*, Space drives
  *live*): a jump key stages the target slide to **preview**; a second press (or GO) airs it.
  Keep it consistent with `handlePrevSlide`/`handleNextSlide` so it auto-GOes only when preview ==
  live, exactly like the arrow path.

**Where it slots in:**
- `OperatorView.jsx` keydown handler (the `onKeyDown` at line ~356) — add a positional letter →
  `handleRemoteSelect(currentItemId, idx)` branch, after the number-key Scene branch and gated on
  the new arm flag + the input guard already in place.
- `ShortcutSettings.jsx` — new toggle + (optionally) let the user pick the key *set* / starting
  row; persist via `window.cue.settings`.
- `SlideList.jsx` / `PreviewLivePanel.jsx` — render the per-slide letter hint.
- The fixed-shortcuts reference list in `ShortcutSettings.jsx` and `ShortcutsOverlay.jsx`.

**Guard rails:**
- These are `keydown` on `document`, suppressed when an INPUT/TEXTAREA/contenteditable has focus
  (CLAUDE.md — never `globalShortcut`). The existing guard at OperatorView:373 already covers this.
- Don't collide with the existing bare keys (`G`, `L`, `S`, `Esc`) or the 1–9 Scene recall — pick
  a letter set that excludes them (e.g. start at `Q`, skip `S`/`L`/`G`).
- The network remote already supports `SELECT itemId, slideIdx` — these keys just drive the same
  handler, so remote + keyboard stay in sync (the remote-is-a-virtual-operator invariant).

**Effort: M.**

---

### 2. Undo / redo in every editor

**Core value:** every editor (`SongEditor`, `ScriptureEditor`, `GraphicsEditor`,
`PresentationEditor`) gets a visible Undo and Redo control (and the standard ⌘Z / ⌘⇧Z keys) so
an operator can reverse an edit without fear — currently a mis-edit is permanent once saved.

**Fleshed-out behaviour:**
- A per-editor **in-memory edit history** (a stack of editor-state snapshots) with Undo/Redo
  buttons in the editor toolbar, plus ⌘Z / ⌘⇧Z (Ctrl on Windows) **scoped to the focused editor**
  — these are editor-local, not the global operator shortcuts.
- Granularity: snapshot on meaningful commits (text blur, field change, slide add/remove/reorder,
  style change), not per keystroke, so one Undo reverses one logical action. Coalesce rapid typing.
- Redo stack clears on a new edit after an undo (standard behaviour).
- Scope decision (call out for the implementer): **session-local history is enough for v1** — the
  stack lives while the editor modal is open and resets on close. Cross-session/persistent undo is
  explicitly out of scope.

**Where it slots in:**
- A shared hook, e.g. `src/renderer/utils/useEditHistory.js` (`{state, set, undo, redo, canUndo,
  canRedo}`), so all four editors share one implementation instead of four bespoke stacks.
- `SongEditor.jsx`, `ScriptureEditor.jsx`, `GraphicsEditor.jsx`, `PresentationEditor.jsx` — adopt
  the hook for their working copy + add toolbar buttons.
- Editors already hold a working copy in React state before the explicit Save → IPC; undo/redo
  operates on that working copy and never touches the DB until Save (no IPC/schema change).

**Guard rails:**
- The editor key handler must `stopPropagation`/return before the global operator keydown sees
  ⌘Z, and must respect the CLAUDE.md clipboard-accelerator rule (don't swallow ⌘C/⌘X/⌘A in text
  fields). Since editors mount inside the operator, verify ⌘Z while a text field is focused
  doesn't reach the global handler.
- Keep snapshots shallow/cheap — these editors hold large slide arrays; structural-share or cap
  the stack depth (e.g. 50) to avoid memory blowups on big presentations.

**Effort: M** (the shared hook is the bulk; wiring four editors is mechanical).

---

### 3. Double-click media → set the previewed song's background (with undo)

**Core value:** swap a song's background *fast*. From the Media tab, **double-clicking** an image
applies it as the background of the **currently previewed/selected song** (the most-recently-clicked
rundown item). **Single-click** keeps the old "add to rundown" behaviour. An **undo** reverses the
last background swap.

> **Behaviour change — CONFIRMED (2026-06-21):** single-click = add to rundown, double-click = set
> background of the previewed song. This **inverts** today's media grid, where
> `onDoubleClick={() => onAddToRundown(asset.id)}` (LibraryPanel.jsx:120) adds on *double*-click and
> single-click does nothing. The user confirmed the inversion is intended.

**Fleshed-out behaviour:**
- The "target" song is whatever is currently in **preview** in `OperatorView`
  (`previewItemId`) — exactly the model the user described ("if a song is live and the operator
  clicks a song to preview it, double-clicking media sets the background for the *previewed* song").
  If nothing is previewed, fall back to a clear toast ("Select a song first") rather than silently
  doing nothing.
- Double-click → `setItemBackground(previewItemId, assetId)` (the existing per-item override path),
  then a confirmation toast naming the song + an **Undo** action in the toast that restores the
  prior `background_override`.
- Respect the locked-song rule: per CLAUDE.md a locked song (`songs.background_locked`) pins its
  own bg above overrides — `setItemBackground` already skips locked songs, so surface a toast
  ("Song background is locked") instead of a no-op.

**Where it slots in:**
- `LibraryPanel.jsx` `MediaGrid` — split single vs double click (single → `onAddToRundown`, double
  → a new `onSetPreviewBackground(assetId)` prop). Note: distinguish single from double with the
  usual click-timer or `onDoubleClick` + delayed single, since the two now do different things.
- `OperatorView.jsx` — own `previewItemId`, expose the setter to LibraryPanel, fire the toast with
  an Undo action, and keep a one-deep "last background swap" memento for undo.
- Reuse the existing per-item override + `resolveBackground` cascade (lock → override → song
  default → global → black) so the row thumbnail and output update together.

**Guard rails:**
- The bg cascade and locked-song handling are load-bearing (CLAUDE.md "Background resolution is ONE
  flat cascade") — go through `setItemBackground`, don't write a new path.
- `cue-thumb://` for the grid thumbnail; `cue-media://localhost/…` only for full-res — unchanged.

**Effort: M.**

---

### 4. Download spinner / toast when a theme (and its media) is fetching

**Core value:** when a theme is applied — *especially* via right-click → "Apply Theme" on a
rundown song (`RundownPanel.jsx:606`) — there's currently **no indication** anything is happening
while the theme's background media downloads. Add a spinner/toast so the operator knows it's
working (and when it's done / failed).

**Fleshed-out behaviour:**
- On "Apply Theme" (and the theme picker entry points), show a **toast with a spinner** —
  "Downloading <theme> background…" — that resolves to "✓ Applied" or an error toast on failure.
- If `applyToSong` resolves instantly (theme media already cached locally), don't flash a spinner
  for a no-op — only show it when an actual fetch is in flight (debounce ~150ms before showing).
- Inline affordance on the rundown row / context-menu item: a small spinner on the affected song
  while its theme media resolves, so it's obvious *which* song is updating in a multi-select apply.

**Where it slots in:**
- `RundownPanel.jsx` context-menu "Apply Theme" handler (line ~606–612) — await
  `window.cue.themes.applyToSong` with toast lifecycle around it.
- `ThemePickerModal.jsx` and the other theme entry points (`SongEditor`, `ScriptureEditor`,
  `GraphicsEditor`, `PresentationEditor`).
- Reuse the existing `Toast.jsx` system (shipped with the command palette in v26.3.0). May need a
  toast variant that carries a spinner and can be updated in place (pending → done/error).
- If theme application doesn't currently surface download progress from main, add a lightweight
  progress/`done` signal from `db/themes.js` / the theme IPC (mirrors `detectDownloadPct` already
  threaded into LibraryPanel for the ASR model download).

**Guard rails:**
- Packaged-CSP reminder: if theme backgrounds are fetched from a remote origin, that origin must be
  in the packaged CSP (`main/index.js`) or the download works in `npm start` but is silently
  blocked in a build (CLAUDE.md).

**Effort: S.**

---

## P1 — Personalisation & bulk operations

### 5. Customisable top bar

**Core value:** let the operator add their own shortcuts to the top navigation. Today the top bar
is a fixed three-tab nav — Operator / Multiview / Settings (`App.jsx:81–88`). Add a **+ button**
(top-right) that lets the user pin extra destinations as tabs: not just the existing views but
**direct jumps** into Settings sub-sections (Themes, Detection, Backgrounds, Shortcuts, …) so the
bar can read e.g. "Operator · Multiview · Settings · Themes · Detection".

**Fleshed-out behaviour:**
- A **+ button** opens a small picker of pinnable destinations: the base views + each Settings
  sub-tab (Themes, Detection, Backgrounds, Output Channels, Remote, Fonts, …). Picking one adds a
  tab; tabs are reorderable (drag) and removable.
- A pinned Settings-subsection tab opens **Settings already scrolled/switched to that section** —
  so it needs `SettingsView` to accept an initial-section param (it currently owns its own internal
  section state). Add an optional `initialSection` prop / a setter routed from App.
- Persist the bar layout via `window.cue.settings` (e.g. `topbar_tabs` = ordered list of
  destination ids) so it survives restarts. Provide a "reset to default" affordance.

**Where it slots in:**
- `App.jsx` — the `<nav>` (line 81) becomes data-driven from a persisted tab list; `NavTab`
  (line 258) gains a removable/reorderable variant + the + button.
- `SettingsView.jsx` — accept an `initialSection` so a pinned sub-tab deep-links into it.
- `window.cue.settings` get/set for the persisted layout.

**Guard rails:**
- Design language (CLAUDE.md): no AI purple/indigo, no `bg-slate-*`, no shadows on flat surfaces,
  Inter everywhere, `rounded` ≤ `rounded-xl`. The + button and tab chips must match the existing
  mission-control top-bar styling.
- Don't let the bar overflow — cap pinned tabs or make the bar scroll/condense gracefully.

**Effort: M.**

---

### 6. Multi-select rundown items

**Core value:** select multiple rundown items at once — **Ctrl/Cmd-click** to toggle individual
items, **Shift-click** for a range, and **drag-select** (marquee) — then act on the whole set:
**bulk delete**, and **bulk apply background** (ties into #3).

**Fleshed-out behaviour:**
- Selection model in `OperatorView`/`RundownPanel`: a `Set` of selected item ids distinct from the
  single `previewItemId` (preview/live semantics are unchanged — selection is a separate,
  multi-item concept for *operations*, not for what's on air).
- Interactions: plain click = select one + preview (current behaviour); Ctrl/Cmd-click = toggle in
  set; Shift-click = contiguous range from the anchor; drag on empty row space = marquee select.
- Bulk actions on the selection: **Delete** (one confirm for N items), **Apply background** (set
  the same media bg across all selected, skipping locked songs per #3's rule), and naturally extend
  to bulk theme apply / remove-from-rundown.
- Visual: selected rows get the `primary`/selected treatment (blue = selected, per the semantic
  colour tokens) distinct from the live (red) and preview states.

**Where it slots in:**
- `RundownPanel.jsx` — the sortable list (`SortableItem`, the `onClick`/`onContextMenu` at
  547–549) gains modifier-aware click handling + a marquee overlay; a bulk-action bar appears when
  `selection.size > 1`.
- `OperatorView.jsx` — own the selection set, the bulk-delete and bulk-background handlers (reusing
  `onRemoveItem` / `setItemBackground` per item).
- Interaction note: the list uses dnd-kit (`SortableItem`) for reordering — marquee drag must not
  fight the drag-to-reorder sensor (gate marquee to empty space / a modifier, or use a selection
  rectangle that doesn't start on a draggable row).

**Guard rails:**
- Keyboard: a bulk-delete shortcut must obey the input-focus guard and not collide with the bare
  operator keys. Don't make Delete bare-fire to air-adjacent actions.
- Locked songs skip background application (CLAUDE.md) — surface how many were skipped.

**Effort: M.**

---

## P3 — Deferred

### 7. Fix the YouTube streamer

**Core value:** YouTube cues must actually download and play. `yt-dlp` is now frequently blocked
because YouTube requires session cookies / PO-tokens for many downloads, so the current path
(CLAUDE.md "YouTube (ephemeral video)": `yt-dlp` + `-movflags +faststart`, auto-downloaded into
`userData/bin`) fails.

**The user explicitly asked to defer this to a later stage** — capturing it here so it isn't lost.

**Possible directions (to evaluate when picked up):**
- Keep yt-dlp but supply cookies: a "sign in to YouTube" / import-cookies flow, or
  `--cookies-from-browser`. Friction + fragility, and credential handling has security weight.
- Refresh yt-dlp aggressively (the auto-refresh on extraction failure already exists in
  `youtube/bin.js`) and add PO-token support as upstream stabilises.
- Alternative extraction backend, or an embedded-player approach for *online* output where a true
  file download isn't required (won't help offline/NDI).
- Worst case: clearer failure UX (the YT badge already shows `error`) + guidance, rather than a
  silent hang.

**Guard rails (unchanged, must hold for any fix):**
- A YouTube cue stays **ephemeral**: `service_items.item_type='youtube'`, URL in `content`, file in
  `userData/yt-cache` (wiped on quit + startup, cues purged on startup). Never insert into
  `media_assets`, backups, or `media.findUnused()`.
- Any download MUST keep `-movflags +faststart` (or equivalent moov-at-front) or long clips
  black-screen on go-live.
- Do NOT bundle yt-dlp/ffmpeg into `extraResource`/the installer — keep the `userData/bin`
  auto-download (CLAUDE.md).

**Effort: L** (largely investigation + a moving upstream target).

---

## Suggested sequencing

1. **Quick feedback win first:** theme download spinner (#4) — small, immediately visible, reuses
   the shipped Toast system.
2. **Editor safety:** undo/redo (#2) — one shared hook, high value, low risk.
3. **Operator speed pair:** double-click-media background (#3) then multi-select rundown (#6) —
   #6 reuses #3's per-item background path for its bulk action, so do #3 first.
4. **Live navigation:** verse jump shortcuts (#1) — mirrors the existing arm/keydown machinery.
5. **Personalisation:** customisable top bar (#5).
6. **Deferred:** YouTube fix (#7) when the team chooses to pick up the moving upstream target.

Every item ships independently and leaves the app shippable.

---

## Design & rule reminders (CLAUDE.md — apply to all)

- No AI purple/indigo, no `bg-slate-*`, no box shadows on flat surfaces, `rounded` ≤ `rounded-xl`.
  Inter everywhere (incl. labels/badges/timecodes). Semantic colours: blue = preview/selected,
  red = live, green = GO/success.
- Shortcuts are `keydown` on `document`, never `globalShortcut`; suppress when an
  INPUT/TEXTAREA/contenteditable is focused; never hijack ⌘C/⌘X/⌘A clipboard accelerators.
- Background changes go through the `resolveBackground` cascade + `setItemBackground` (skip locked
  songs); thumbnails use `cue-thumb://`, full-res uses `cue-media://localhost/…`.
- New settings via `window.cue.settings` (contextBridge only; `nodeIntegration:false`). Any new
  remote origin (theme media host) must be added to the packaged CSP in `main/index.js`.
- The network remote stays a virtual operator: new nav (jump-to-slide) drives the SAME handlers as
  the keyboard via `remote:command` / `SELECT`.
- If any item needs a migration or runtime dep Vite externalizes / a new output file, follow the
  versioning + `packageAfterPrune` rules and verify with `npm run package`.
