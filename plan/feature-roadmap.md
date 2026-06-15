# Cue — Feature Roadmap & Implementation Plan

**Status:** proposal — no code written. This is the *next* wave of features, captured after
the original roadmap's items (stage display, scripture module, live media, broadcast L3 /
ticker / countdown, network remote, themes, song import, backup/restore, presentations,
auto-advance, tag CRUD, media cleanup) all shipped. See the master reference's "Implemented"
backlog (§18) for what's already done — this document does **not** repeat any of it.

Every item below is grounded in the **current** architecture (`plan/cue-master-reference.md`,
**schema v21**, the `window.cue` IPC surface, the main/renderer/output three-process split,
the `service_items` polymorphic model, and the shipped scripture-detection / themes / graphics
/ presentations subsystems). Nothing here requires a re-architecture — each proposal extends a
system that already exists.

Each item lists **why it matters**, **where it slots in** (real files), and **effort**.

Effort key: **S** ≈ 1 sitting · **M** ≈ a few sessions · **L** ≈ a phase of its own.

---

## Priority Summary

| # | Feature | Theme | Effort | Priority |
|---|---|---|---|---|
| 1 | Prebuilt theme packs + curated media library | Flagship | **L** | **P0** |
| 2 | Song list full-height fix | Quick win | **S** | **P0** |
| 3 | Surface output **screen names** in channel/output pickers | Quick win | **S** | **P0** |
| 4 | Scripture detection — confidence-threshold **auto-live** tier | Detection | **M** | **P1** |
| 5 | **Song** detection (live song not in the rundown → suggest matches) | Detection | **L** | **P1** |
| 6 | **Presentation** detection ("Point 2…" → that slide) | Detection | **L** | **P1** |
| 7 | Paste a **song-title list** → auto-match & add to rundown | Operator productivity | **M** | **P2** |
| 8 | Split one song section into **variable-size parts** | Operator productivity | **M** | **P2** |
| 9 | Confidence monitor — **scheduled / timed messages** | Operator productivity | **M** | **P2** |
| 10 | **Transition / animation** library (slide change, logo, clear) | Power-user polish | **M** | **P3** |
| 11 | **Macros** — record, deploy, and trigger on actions | Power-user automation | **L** | **P3** |

---

## P0 — Flagship + quick wins

### 1. Prebuilt theme packs + curated media library

**This is the app's primary selling point.** The single biggest reason teams pay for
EasyWorship / ProPresenter is that they open the box to *striking, ready-made looks* and only
have to change the text. Cue has the entire styling and theme **engine** already — what it
lacks is **content**: a curated library of professionally designed themes and licensed
background media. This is a content/design effort riding on shipped plumbing, not new
architecture.

**What exists already (do not rebuild):**
- `themes` table (v15): a saved section `style_json` (§8 shape) + optional `background_id`.
  Apply scopes already work: `applyToSong`, `applyToRundown`, `applyToAllSongs` (`db/themes.js`,
  `window.cue.themes`, `ThemeSettings.jsx`).
- The renderer already knows how to apply every style field across fullscreen, lower-third,
  scripture, and presentation surfaces.
- Bundled-resource seeding precedent: `seedBundledBibles()` and `seedGhsHymnal()` import from
  `resources/` on startup with packaged-vs-dev path resolution (§19). Theme/media seeding mirrors
  this exactly.

**What to build:**
- **Theme content.** Author a library of themes using the design system in `tailwind.config.js`
  and the §8 style shape. Drive it from a `resources/themes/` folder of reference images +
  a build script (mirrors `scripts/build-bibles.mjs`) that emits seed JSON. Seed on first run
  gated by a `themes_seeded` settings flag (so user deletions stick, like `ghs_seeded`).
- **Full-screen *and* lower-third variants per theme.** A worship theme must look right both
  as a fullscreen lyric and as a lower-third bar. The current `themes` row stores one
  `style_json`; extend the model so a theme carries the surface-specific pieces it needs
  (e.g. fullscreen text style + `ltBar` lower-third style). This is the one schema change here.
- **Theme *categories*.** Themes must be describable for **songs, scriptures, graphics, and
  presentations** — each surface has different default backgrounds and reference/title slots.
  Add a `scope`/`category` discriminator so the picker filters relevant themes per content type.
- **Curated media library.** Ship/curate a set of high-quality motion + still backgrounds
  (Unsplash / Pexels / Mixkit etc.). **Licensing is a hard requirement:** only assets whose
  licence permits use **with no on-screen attribution** (showing a photographer credit over a
  live lyric during a broadcast is unacceptable). Record provenance/licence per asset in a
  manifest for our own audit, but never render it. Decide bundle-vs-download: large motion
  files should download on demand into `userData/media` (like the Whisper model and yt-dlp
  binaries) rather than bloat the installer; stills can bundle.

**Files touched:** new `resources/themes/` + `resources/media-library/` (or a download manifest),
a `scripts/build-themes.mjs`, `db/schema.js` (theme model extension migration + a
`themes_seeded` flag), `db/themes.js`, `ThemeSettings.jsx`, the theme picker entry points in
`SongEditor` / `ScriptureEditor` / `GraphicsEditor` / `PresentationEditor`, a curated-media
browser surface in the Media library (`LibraryPanel.jsx`).

**Effort: L** — but it is the differentiator. The engineering is modest; the *design + curation
+ licensing* is the real work and should be scoped as its own track.

---

### 2. Song list full-height fix

The song list in the Songs tab doesn't fill the tab's height — it looks like a hardcoded
height rather than a flex/`min-h-0` fill, so there's dead space below the list.

**Approach:** in `LibraryPanel.jsx`, replace the fixed height on the song-list container with a
flex column that fills its parent (`flex-1 min-h-0` on the scroll region; ensure each ancestor
up to the panel root is a `flex` column with `min-h-0` so the child can actually grow). No data
or IPC change.

**Files touched:** `src/renderer/panels/LibraryPanel.jsx`.

**Effort: S.**

---

### 3. Surface output screen names in channel/output pickers

Today screen channels are matched to physical displays by `display_bounds` JSON
(`output/manager.js`, `channel_monitors`), and the picker shows geometry, not a name. Operators
identify monitors by *name* ("the projector", "BenQ on HDMI-2"), so picking the right screen is
guesswork. Electron's `screen.getAllDisplays()` exposes a human `label` (and we already have the
bounds) — surface it.

**Approach:** add an IPC that returns the live display list with `{id, label, bounds, primary}`
(main has `screen` already in `output/manager.js`). In `OutputChannels.jsx` (and any
channel/monitor assignment UI), show the OS screen **name** alongside resolution, still keyed on
`display_bounds` for matching (per CLAUDE.md: *always `display_bounds`, never `display_index`*).
Where the OS gives no label, fall back to "Display N · WxH".

**Files touched:** `src/main/output/manager.js` (or a small `displays` IPC), `preload.js`,
`OutputChannels.jsx`, plus the channel/output target chips in the operator UI.

**Effort: S.**

---

## P1 — Scripture-detection expansion (the differentiator)

These three build directly on the shipped scripture-detection pipeline (§17,
`src/main/scripture-detect/`: VAD-segmented Whisper ASR → reference parser + MiniLM content
match → `scripture:detected` → renderer resolves & stages). That pipeline is the moat;
generalising it to songs and presentations, and tightening its automation, is high leverage.

### 4. Scripture detection — confidence-threshold auto-live tier

Today the action tiers are: reference ≥ `referenceAutoConfidence` (0.8) → `reference.autoAction`
(default *preview*); 0.6–0.8 → *suggest*; content → *suggest* (§17). The request: add a **fourth
tier** so a *very* high-confidence detection (e.g. ≥ 0.97) goes **live immediately**, while
mid-high confidence still lands in *preview*. This does **not** replace the existing
suggest/preview/live options — it adds an upper band.

**Approach:** extend the `scriptureDetect` settings shape with a second, higher threshold
(`reference.autoLiveConfidence`) and a band-routing rule: `≥ autoLive → go live`,
`≥ autoPreview → preview`, `≥ suggestFloor → suggest`, else drop. The renderer already owns
staging (`OperatorView` resolves `scripture:detected` and reuses `handleScriptureLive` /
preview staging), so the new band just selects the live path instead of preview. Expose the new
threshold + an "auto-go-live above" toggle in `ScriptureDetectionSettings.jsx`. Guard rail: gate
auto-live behind an explicit opt-in (sending wrong text to air is worse than to preview), and
keep the lexical-anchor guard from `content-match.js` in force.

**Files touched:** `src/main/scripture-detect/manager.js` (band routing), the `scriptureDetect`
settings schema, `ScriptureDetectionSettings.jsx`, `OperatorView` `scripture:detected` handler.

**Effort: M.**

---

### 5. Song detection — live song not in the rundown → suggest matches

During live production a choir may sing a song that isn't in the rundown. If Cue can *hear* it
and surface likely matches from the song library, the operator finds it in seconds instead of
manually searching. This is the scripture **content-match** pattern (§17) re-pointed at songs.

**Approach:** reuse the existing capture + ASR (no new audio path). Add a song matcher beside
`content-match.js`:
- Prefilter candidates with the existing **`songs_fts`** FTS5 table on the transcribed
  utterance.
- Re-rank with the same **MiniLM embedding** worker (`embed-worker.js`) — build/maintain a verse
  (section) embedding index over `song_sections.content`, cosine-ranked, with a lexical-anchor
  guard (reuse the `content-match.js` guard to kill hallucinated matches).
- Emit a new detection event (e.g. `song:detected`) carrying the top song candidates;
  `OperatorView` shows them as **suggestions** (never auto-live — songs are long and ambiguous),
  one click adds the match to the rundown / stages it to preview.

**Considerations:** the section-embedding index is new persistent state — build lazily and
incrementally (a `songEmbeddingsBuilt`/dirty marker, like the verse-index build already exposed
in `ScriptureDetectionSettings.jsx`), and rebuild on song edit. Detection runs only while
armed; respect the existing single-Whisper-in-main constraint.

**Files touched:** new `src/main/scripture-detect/song-match.js` (+ a section-embedding index
builder), `manager.js` (route utterances to both verse and song matchers), `preload.js` event,
`OperatorView` + a suggestion surface (extend the existing detection suggestion UI), settings
toggle in `ScriptureDetectionSettings.jsx`.

**Effort: L.**

---

### 6. Presentation detection — "Point 2…" → that slide live

When a minister says "Point two…", Cue sends slide/point 2 of the live presentation to air.
This is detection scoped to the **active presentation deck**, combining lexical cues (ordinals:
"point/number/section two", "next point") with semantic matching against each slide's text.

**Approach:** when a `presentation` item is live, index the current deck's slide text — pull the
`text` runs out of each slide's `elements_json` (`db/presentations.js` already resolves decks;
§21 element model). On a committed utterance:
- **Lexical:** parse ordinals/cues ("point N", "number N", "next/previous point") via the
  existing `numbers.js` helper from the reference parser → jump to that slide index.
- **Semantic:** embed the utterance (reuse `embed-worker.js`) against slide-text embeddings →
  cosine match to the most-likely slide for paraphrased cues ("let's talk about forgiveness").
- Emit a detection scoped to presentation navigation; reuse the existing `SELECT slide` transport
  in `OperatorView` (presentations already inherit GO/NEXT/PREV/SELECT generically per §21), so
  no new transport wiring — detection just drives `SELECT`.

**Tiering:** apply the same confidence bands as #4 — explicit ordinal match is high-confidence
(could auto-go-live behind opt-in); fuzzy semantic match is *suggest* only.

**Files touched:** new `src/main/scripture-detect/presentation-match.js`, `manager.js` (activate
only when a presentation is live — needs the live-item type, surfaced from `OperatorView`),
event in `preload.js`, `OperatorView` handler driving `SELECT`, settings toggle.

**Effort: L.**

> **Sequencing note for #4–#6:** factor the matchers behind a common "active-context matcher"
> shape so scripture / song / presentation matching share the embed worker, the FTS prefilter,
> the lexical-anchor guard, and the confidence-band router (#4). Build #4 first (it generalises
> the band logic everyone else reuses), then #5, then #6.

---

## P2 — Operator productivity

### 7. Paste a song-title list → auto-match & add to rundown

Operators are routinely handed a list of song titles (sometimes with lyrics, often not) from the
choir, then hand-search each one in the library and add it to the rundown. Let them **paste the
whole list**: Cue matches each title against the library, adds the matches to the rundown, and
flags anything it couldn't find — the same UX as the existing online-Bible import modal.

**Approach:** a "Paste Song List" modal (model it on `OnlineBibleModal` / `SongImportModal`).
- **Parse** the pasted block into candidate titles. The input is often *dirty* — titles mixed
  with lyrics. Detect title lines vs lyric lines (the Paste-Song parser in `SongEditor` /
  `songs-import.js` already does header/lyric detection — reuse it) and extract titles.
- **Match** each title against the library via `songs_fts` + fuzzy ranking. Where lyrics were
  pasted alongside a title, use them as a **verification signal** (match lyric lines against
  `song_sections.content` to disambiguate same-titled songs and confirm the right hit).
- **Report**: per row show matched (with confidence) / ambiguous (pick one) / not found. Confirm
  → batch-append matched songs to the current rundown.

**Files touched:** new `SongListImportModal.jsx`, a `songs:matchTitles` IPC (`songs.ipc.js`)
reusing FTS + the import parser in `src/main/import/`, an entry point in `RundownPanel.jsx` /
`LibraryPanel.jsx`.

**Effort: M.**

---

### 8. Split one song section into variable-size parts

A single verse is often too long to show at once — especially in lower-thirds, but also
fullscreen. Let the operator split one song section (e.g. "Verse 1") into multiple
**variable-size display parts**, while the section stays *one logical unit* in storage and the
library. Behind the scenes "Verse 1" simply renders as N slides.

**Approach:** keep `song_sections` as the unit (no row-per-part). Add an optional split
descriptor to the section — either explicit break markers in `content`, or a `splits` array in
`style_json`/a sibling column — that the slide builder expands into multiple slides sharing the
section's label ("Verse 1", "Verse 1 cont."). The §12 section-label / numbered-verse logic and
`getSlides`/`buildPayload` in `OperatorView` learn to expand a section into its parts; transport
(GO/NEXT/PREV/SELECT) already operates per-slide, so parts become navigable for free. Editor
affordance in `SlidePreview`/`SongEditor`: insert/drag a split point within a section; preview
shows the resulting parts.

**Considerations:** auto-fit already shrinks oversized text — splitting is the *operator-chosen*
alternative to shrinking. Themes/styles apply per section and must carry through to every part.
A schema touch only if splits need their own column; otherwise it rides in `style_json`.

**Files touched:** `SongEditor.jsx` / `SlideList.jsx` (split UI), the slide-expansion path in
`OperatorView` (`getSlides`/`buildPayload`), section-label logic, possibly a `db/schema.js`
migration if splits get a dedicated column.

**Effort: M.**

---

### 9. Confidence monitor — scheduled / timed messages

The stage/confidence display already shows operator messages and a timer (StagePanel, `stage`
template — §13, §18). Extend it so messages can be **scheduled**: appear at a specific wall-clock
time ("11:05 — wrap up"), or after a countdown ("in 10:00"), and auto-clear.

**Approach:** the stage template already ticks its own clock from `Date.now()` against an
absolute anchor (CLAUDE.md guard rail: *countdown/clock graphics tick in the output template, not
the operator*; main resolves the anchor once). Follow that pattern — the operator schedules
`{message, showAt | afterSeconds, clearAfter}`; main resolves an absolute `showAt`/`clearAt`
once and sends it; the stage template shows/hides the message by comparing `Date.now()` to those
anchors. **Never** stream per-second updates over the bus. Authoring UI in `StagePanel`: a small
list of pending scheduled messages with time/timer + clear.

**Files touched:** `StagePanel.jsx` (scheduling UI + pending list), the stage payload/IPC in
`output/manager.js`, `src/output/stage.{html,js,css}` (render against absolute anchors).

**Effort: M.**

---

## P3 — Power-user polish & automation

### 10. Transition / animation library

Cuts are currently hard. A defined library of transitions/animations (fade, slide, zoom,
cross-dissolve) selectable per **slide change, logo, and clear** brings Cue level with
ProPresenter polish.

**Approach:** transitions live in the **output templates** (plain DOM, driven by `slide:update`),
not the operator — animate the swap between outgoing and incoming content via CSS transitions /
Web Animations keyed by a `transition` field added to the payload. Define a small named library
(e.g. `{type, durationMs, easing}`); the operator/template picks from it. Honour reduced-motion
and keep durations short enough not to fight live cueing. Per CLAUDE.md, extend the existing
payload + template dispatch (`fullscreen.js`, `lowerthird.js`, `graphics-overlay.js`) — don't
fork it. NDI caution: transitions composite through the `paint`-event capture at channel fps, so
validate that animation looks right over NDI (no per-frame operator capture loop).

**Where it's configured:** a transitions section in theme/output settings; selectable defaults
for slide-change / logo / clear, with per-item override later.

**Files touched:** the output payload + `output/manager.js` go/clear/logo dispatch, the output
templates (`src/output/*.js`), a settings surface (likely `ThemeSettings` / `OutputChannels`).

**Effort: M** (more if per-content-type overrides and a rich library are in scope → L).

---

### 11. Macros — record, deploy, and trigger on actions

Let operators **record** a sequence of actions into a named macro, **deploy** it on demand, and
**auto-trigger** macros after events — *on slide change, on clear, on logo*, etc. This is the
most ambitious item: a new automation subsystem layered over the existing transport.

**Approach:** a macro is an ordered list of the *same* operator actions the keyboard and network
remote already invoke (GO / NEXT / PREV / SELECT / CLEAR / LOGO / stage message / graphic
out…). Because the network remote already proves "a virtual operator forwards nav commands that
run the SAME handlers as the keyboard" (CLAUDE.md architecture invariant), a macro is just a
scripted virtual operator. Two halves:
- **Record/playback:** capture actions into a `macros` table (steps + optional delays); play
  back by dispatching through the existing `OperatorView` handlers (the remote's `remote:command`
  path is the model). Keep payload resolution in the renderer, never in main.
- **Triggers:** subscribe macros to lifecycle events (slide change, clear, logo). The operator
  already emits these; expose them as trigger hooks. Guard against loops (a macro that triggers
  on slide-change and itself changes slides) and make triggers explicitly opt-in.

**Considerations:** this is genuinely new surface area — schema (`macros`, `macro_steps`,
`macro_triggers`), an editor, and a playback engine. Scope v1 to **manual record + manual
deploy**; add **action triggers** as a fast-follow once the playback engine is proven.

**Files touched:** `db/schema.js` (macro tables migration), new `db/macros.js` + IPC + preload,
a Macros panel/editor, and a playback dispatcher in `OperatorView` reusing the
keyboard/remote handlers; trigger hooks wired into the transport lifecycle.

**Effort: L.**

---

## Suggested sequencing

1. **Quick wins first** (a single sitting, immediate UX payoff): song-list height (#2) +
   output screen names (#3).
2. **Flagship track (parallel, design-led):** prebuilt theme packs + curated media library (#1).
   The engineering is small; start the design/curation/licensing work early since it's the long
   pole and the main selling point.
3. **Detection expansion (#4 → #5 → #6):** ship the confidence-band/auto-live refactor (#4)
   first because #5 and #6 reuse its band router and the shared matcher shape; then song
   detection (#5), then presentation detection (#6).
4. **Operator productivity:** paste-song-list (#7) + section splitting (#8) + scheduled stage
   messages (#9) — independent, ship in any order.
5. **Polish & automation:** transition library (#10), then macros (#11) as the closing phase.

Every item ships independently and leaves the app shippable.

---

## Design & rule reminders for whoever implements these

- Obey `CLAUDE.md`: no AI purple/indigo, no `bg-slate-*`, no box shadows on flat surfaces,
  JetBrains Mono (with fallback) for labels/badges, Inter for body. Output templates may use
  Oswald (output-only).
- Media in output templates uses `cue-media://localhost/…` (never `file://`, never three-slash);
  renderer uses `src/renderer/utils/mediaUrl.js`. Grid/list thumbnails use `thumbUrl()` /
  `<MediaThumb>`. New media references must be added to `media.findUnused()`.
- New tables go through the migration runner in `db/schema.js` (bump the version; reset
  `VERSION_MINOR`/`VERSION_PATCH` to 0 and mirror `package.json` `"version"` in the same commit —
  MAJOR auto-derives from the highest `vN` migration). New IPC is exposed via `preload.js`
  contextBridge only; `nodeIntegration: false` always.
- Output templates stay plain DOM (no React), driven by `slide:update` payload **extensions** —
  add fields, don't fork the dispatch. Countdown/clock/scheduled graphics tick in the template
  from an absolute anchor resolved once in main — never stream per-second updates.
- Scripture/song/presentation detection: keep the **VAD-segmented utterance** model (never a
  rolling window), keep onnxruntime's CPU memory arena disabled in main, and keep the single
  resident Whisper pipeline. Reuse `embed-worker.js`, the FTS prefilter, and the lexical-anchor
  guard rather than duplicating them.
- The network remote stays a *virtual operator*: nav/macro commands run the SAME renderer
  handlers as the keyboard; never resolve slide payloads in main.
- After adding any runtime dep Vite externalizes, or a new output-window/font/resource file,
  update the `packageAfterPrune` hook in `forge.config.js` and verify with `npm run package` —
  omissions break only in packaged builds.
