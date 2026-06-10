# Cue — Feature Roadmap & Implementation Plan

**Status:** proposal — no code written. This document captures the next wave of features
that add real value to Cue for its two intended jobs: **worship lyric presentation**
(EasyWorship / ProPresenter replacement) and **broadcast overlay graphics** (UNO
replacement), running simultaneously in one process.

Recommendations are grounded in the current architecture (`plan/cue-master-reference.md`,
schema v5, the `window.cue` IPC surface, and the existing file layout). Each item lists
*why it matters*, *where it slots in*, and *rough effort*. Nothing here requires a
re-architecture — every proposal extends the existing main/renderer/output split,
the `service_items` polymorphic model, and the channel/template system.

Effort key: **S** ≈ 1 sitting · **M** ≈ a few sessions · **L** ≈ a phase of its own.

---

## Priority Summary

| # | Feature | Use case | Effort | Priority |
|---|---|---|---|---|
| 1 | Stage / Confidence Display | Worship + Broadcast | M | **P0** |
| 2 | Scripture (Bible) module | Worship | L | **P0** |
| 3 | Live media playback (video/audio) | Both | L | **P0** |
| 4 | Broadcast graphics: name/title L3 + ticker | Broadcast | M | **P1** |
| 5 | Network control API (Stream Deck / Companion / phone) | Both | M | **P1** |
| 6 | Theme / template library | Both | M | **P1** |
| 7 | Song import (OpenLyrics / ProPresenter / plain text) | Worship | M | **P1** |
| 8 | Backup & restore bundle | Both | S | **P2** |
| 9 | CCLI usage reporting | Worship | S | **P2** |
| 10 | Countdown / clock graphics | Both | S | **P2** |
| 11 | Tag management UI + unused-media cleanup | Both | S | **P2** |
| 12 | Auto-advance / timed loops | Both | S | **P3** |

---

## P0 — Highest leverage

### 1. Stage / Confidence Display

Already flagged **High** in the backlog (§17). For live worship this is not optional —
the worship leader and speaker need to see *current slide + next slide + a clock* without
seeing the operator UI. It is the single biggest credibility gap versus ProPresenter.

**Approach** — it is a new *template type*, not a new subsystem. The plumbing already
exists: output channels already drive `BrowserWindow`s matched by `display_bounds`, and
`slide:update` already carries the live payload.

- Add `'stage'` to the `output_channels.template` allowed values.
- New output template: `src/output/stage.html` / `.css` / `.js`. Layout: large **current**
  text, smaller **next** text, a wall clock, and an optional countdown/elapsed timer.
- Extend the output payload with `nextText` and `nextSectionLabel` (the manager already
  knows the live item + slide index; it can resolve the following slide). Stage display
  consumes these; existing fullscreen/lower-third templates ignore them.
- **Presenter notes**: add `service_items.notes` (already exists) rendering on stage only,
  plus a per-slide notes affordance later. Speaker notes are the natural follow-on.

**Files touched:** `output/manager.js` (resolve next slide, dispatch), new `output/stage.*`,
`OutputChannels.jsx` (template dropdown gains "Stage Display"). No schema change required
beyond the template enum.

**Effort: M.**

---

### 2. Scripture (Bible) module

Worship presentation without Bible passages is half a product. Both EasyWorship and
ProPresenter lead with this. It fits Cue's `service_items` model cleanly as a new
`item_type`.

**Approach**

- New tables: `bible_versions(id, name, abbrev, language)` and
  `bible_verses(id, version_id, book, chapter, verse, text)` with an index on
  `(version_id, book, chapter, verse)` and an FTS5 mirror for full-text verse search
  (reuse the `songs_fts` trigger pattern).
- Import path: ship/import **OpenBible / Zefania / OSIS XML** (public-domain translations
  like KJV/WEB to start). A `bible:import(filePath)` IPC parses into the tables. This keeps
  the repo free of bundled copyrighted text.
- New entity in the Library panel: a **Scripture** tab beside Songs/Media. Reference input
  (`John 3:16-18`), version selector, live verse search via FTS5.
- A scripture selection becomes a `service_item` with `item_type='scripture'` and
  `ref_id` pointing at a stored passage (or `content` holding the resolved reference +
  verse range). `resolveItem()` in `services.js` learns to expand a passage into slides
  (one or N verses per slide, configurable).
- Reuses the **fullscreen** output template verbatim — scripture is just text + reference
  label + background. Background resolution order already supports a global slide default.

**Files touched:** `db/schema.js` (migration v6), new `db/bible.js`, new `ipc/bible.ipc.js`,
`preload.js` (`window.cue.bible.*`), `LibraryPanel.jsx` (Scripture tab), `services.js`
(`resolveItem` scripture branch).

**Effort: L** — but it is the feature that most defines the product as a real worship tool.

---

### 3. Live media playback — video & audio

Today media is effectively still backgrounds. Real services use **motion backgrounds,
bumper videos, and countdown loops**, and broadcast uses video stings. The output
templates render `#background` as an image; they need to render `<video>` when the asset
is a video, with transport (play/pause/loop/seek) driven from the operator.

**Approach**

- `media_assets.type` already distinguishes types — extend import to accept `.mp4/.webm/.mov`
  and `.mp3/.wav` (Electron/Chromium plays these natively; prefer `.webm`/`.mp4 H.264`).
- Output templates: when `backgroundPath` resolves to a video asset, mount a looping muted
  `<video>` instead of an `<img>`. Add `loop`/`muted`/`objectFit: cover` by default.
- A **foreground media slide** type (`item_type='media'`) for full-frame video playback
  (bumpers/countdowns) with real transport. Add output IPC `output:media:play/pause/seek`
  and a small transport strip in `PreviewLivePanel` when the live item is a video.
- **Sync caution:** for NDI, frames are pulled via the `paint` event at channel fps — video
  playback in an offscreen window already composites through that path, so this mostly works,
  but document the fps/codec constraints in the master reference.

**Files touched:** `media.js` / `media.ipc.js` (accept video/audio MIME), `output/fullscreen.js`
+ `lowerthird.js` (video branch in `#background`), `output/manager.js` + `output.ipc.js`
(media transport), `PreviewLivePanel.jsx` (transport strip).

**Effort: L.**

---

## P1 — Strong value, scoped

### 4. Broadcast graphics: structured name/title lower-thirds + ticker

The UNO side currently only has song-style lower-thirds (bar + lyric text). Broadcast
overlay needs **structured identifiers** — a person's name + role/title — and a **ticker**
(scrolling crawl) for announcements/scripture references during a stream.

**Approach**

- New `item_type='graphic'` with a `content` payload of `{kind:'lower_third', name, title}`
  or `{kind:'ticker', text, speed}`. No new template engine — extend `lowerthird.html`
  to render a two-line name/title block when the payload kind is `lower_third`, and a
  CSS-animated crawl when `ticker`.
- A lightweight **Graphics** tab in the Library (or a dedicated panel) to author and store
  reusable name/title cards — these are the broadcast equivalent of songs.
- Wire the dormant `output_channels.linked_channel_id` (§17): a lower-third graphic channel
  can be told which fullscreen channel it overlays, so the operator targets "the L3 over
  PGM" rather than a raw channel id.

**Files touched:** `lowerthird.js`/`.css` (kinds), new `db` storage for graphic cards
(could reuse `songs`-like table `graphics`), `LibraryPanel.jsx`, `services.js` resolve.

**Effort: M.**

---

### 5. Network control API — Stream Deck / Companion / phone

`shortcut:next` / `shortcut:prev` are already reserved "for hardware remote" but nothing
listens. A small local HTTP + WebSocket server in the **main** process turns any
Stream Deck (via Bitfocus Companion), MIDI bridge, or a phone on the LAN into a transport
surface — a standard expectation for live operators and a strong differentiator.

**Approach**

- New `src/main/remote/server.js`: an `http`/`ws` server bound to `127.0.0.1` (and opt-in
  LAN) on a configurable port. Endpoints map 1:1 to existing manager actions: `GO`, `CLEAR`,
  `LOGO`, `NEXT`, `PREV`, `SELECT item`, plus a read-only `STATE` push over WS (reuse the
  payload already sent to `output:state-changed`).
- Settings panel: enable/disable, port, "allow LAN" toggle, generated pairing token.
- Ship a Companion module spec (just JSON over HTTP) documented in the reference. No new
  renderer surface required for v1 beyond the settings toggle.

**Security:** localhost-only default, token header required, never expose Node — the server
calls the same internal manager functions IPC already calls.

**Files touched:** new `src/main/remote/`, `main/index.js` (lifecycle), `settings.js` keys
(`remote_enabled`, `remote_port`, `remote_lan`, `remote_token`), a small settings card.

**Effort: M.**

---

### 6. Theme / template library

Styling lives in per-section `style_json` today, which means a consistent look must be
hand-applied to every song. A named **theme** (font, color, shadow, textBox, ltBar, bg)
that can be applied to a song, a whole service, or set as global is the missing
"design once, reuse everywhere" layer.

**Approach**

- New `themes(id, name, scope, style_json, background_id)` table. A theme is just a saved
  `style_json` + default background — the renderer already knows how to apply every field.
- Apply actions: "apply theme to this song", "apply to rundown", "set as global default".
  These write `style_json`/`default_background_id` exactly as today's pickers do — so the
  output path is unchanged.
- Theme management UI in Settings (mirrors `BackgroundSettings.jsx` patterns).

**Files touched:** migration v6/v7, `db/themes.js`, `ipc`, a Settings panel, an "Apply theme"
entry in the Song Editor + rundown context menu.

**Effort: M.**

---

### 7. Song import — OpenLyrics / ProPresenter / plain text

Migration friction is the #1 reason teams *don't* switch presentation software. The Paste
Song parser already exists in `SongEditor.jsx`; promote it to a real importer.

**Approach**

- `songs:import(filePaths, format)` in main. Parsers:
  - **OpenLyrics XML** (the de-facto open standard — OpenLP/others export it).
  - **Plain text / ChordPro** (reuse the existing header-detection parser, batched).
  - **ProPresenter `.pro`** (protobuf/JSON — stretch goal; document as best-effort).
- Map parsed sections → `song_sections` with `type`/`order_index`/`content`. Tags optional.
- Library "Import Songs…" button → file dialog → preview/confirm count.

**Files touched:** new `src/main/import/` parsers, `songs.ipc.js`, `LibraryPanel.jsx` button.

**Effort: M.**

---

## P2 — High ROI, low cost

### 8. Backup & restore bundle

Single-file SQLite + a media folder is *easy* to back up — there is just no UI for it, and
a live ministry/broadcast cannot afford to lose a database. Add export/import of a single
`.cuebackup` (zip of `cue.db` + `userData/media/`).

- `settings:exportBackup(destPath)` / `settings:importBackup(srcPath)` in main (Node `zlib`/
  archiver). Confirm-and-replace on import. Surface in the existing Danger Zone / a new
  "Data" settings card. **Effort: S.**

### 9. CCLI usage reporting

Churches must report song usage to CCLI. Cue already stores `copyright` and authors per song,
and services are dated. Log every GO of a song item to a `usage_log(song_id, service_id, shown_at)`
table, then export a date-range CSV from Settings. Pure additive value for the worship use case.
**Effort: S** (the only new write is one insert in the manager's `go` path).

### 10. Countdown / clock graphics

"Service starts in 5:00" pre-roll and on-air clocks are constant live-production needs and
reuse the fullscreen template. Add a `graphic` kind `countdown`/`clock` rendered by a tiny
timer in the output template (target time passed in payload). Pairs naturally with #4.
**Effort: S.**

### 11. Tag management UI + unused-media cleanup

Both are explicit backlog gaps (§17). Tags can be assigned but not created/renamed/deleted in
the UI; and there is no way to find media not referenced by any song/service. A small Settings
panel for tag CRUD (`tags:*` IPC already exists) and a "find unused media" report (one query
over `songs.default_background_id` + `service_items.background_override_id` + `settings`).
**Effort: S.**

---

## P3 — Nice to have

### 12. Auto-advance / timed loops

Pre-service announcement loops and timed slide rotation. Add `service_items.advance_seconds`;
when live and set, the manager schedules the next slide/item. Useful for unattended pre-roll.
**Effort: S.**

---

## Suggested sequencing

1. **Phase A (worship credibility):** Stage Display (#1) → Scripture (#2). These two close
   the largest gap versus ProPresenter/EasyWorship.
2. **Phase B (live media & broadcast):** Live media playback (#3) → broadcast L3/ticker (#4)
   → countdown/clock (#10). Rounds out the UNO replacement story.
3. **Phase C (operator power):** Network control API (#5) → themes (#6).
4. **Phase D (data hygiene & onboarding):** Song import (#7) → backup/restore (#8) →
   CCLI (#9) → tag UI + media cleanup (#11) → auto-advance (#12).

Every phase ships independently and leaves the app shippable. None breaks the
`nodeIntegration: false` security rule, the `cue-media://localhost` protocol contract, or the
channel/monitor model — they extend them.

---

## Design & rule reminders for whoever implements these

- New UI must obey `CLAUDE.md`: no AI purple/indigo, no `bg-slate-*`, no box shadows on flat
  surfaces, JetBrains Mono for labels/badges, Inter for body. New output templates may use
  Oswald (output-only).
- New media in output templates must use the `cue-media://localhost` helper — never `file://`.
- New tables go through the migration runner in `db/schema.js` (bump `db_version`); new IPC
  is exposed via `preload.js` contextBridge only.
- Keep output templates plain DOM (no React) and driven by `slide:update` payload extensions —
  add fields, don't fork the dispatch.
