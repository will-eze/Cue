# Cue Theme System Redesign

**Goal:** make Cue's themes *look* and *work* like high-quality commercial software (ProPresenter / EasyWorship), and — above all — make styling **intuitive**. A user should never have to guess where a background or a style is coming from, or why applying a theme changed something they didn't expect.

Status: **shipping (v34.x).** Supersedes the ad-hoc theme model documented in `plan/theme-pack-phase1a.md` and the memory `project_theme_packs`.

### Implementation status (2026-09-05)
Built and live:
- **One live cascade for every surface.** `settings.default_theme_id` (App) → `services.theme_id` (Service) → `service_items.theme_override_id` (Item), resolved live in `OperatorView` (`effectiveTheme`) + mirrored in `output/manager.js`. Migration **v34** added the two columns. **Songs, scripture, AND slides/presentations all resolve their background and text look from the theme** — there is no separate per-surface global default any more (the old `global_bg_*` settings survive only as a silent fallback for installs with no theme set).
- **The operator monitors inherit the theme** (`PreviewLivePanel` `themeStyle`) so preview == output for themed content that carries no baked style.
- **Inheritance is visible.** Rundown header shows a `Look: X · from {service|app default}` chip (`ServiceLookChip`); song + scripture items get a per-item override + reset in the context menu, and a palette badge when overridden.
- **The Background settings section is retired.** Its per-surface "global default" pickers + bulk-apply are gone; the Video-Background-Loop control moved to **Motion**. The curated background library is folded into the Theme Library as **"New from a background"** (`BackgroundBrowseModal`), which auto-derives an editable theme (deterministic font pairing + always-on scrim + L3 bar, §0b.2) and opens the editor.
- **Themes are generic.** `category` is a filter, not a data shape — song & scripture looks are interchangeable everywhere (picker, cascade, cards). Presentation (layout-token) themes stay separate.
- **Theme cards** lead with the two non-destructive verbs — **Set as default look** (App) and **Use for this service** (Service); the old "bake into songs" apply path is tucked under **Advanced**. Independent lower-third styling (`style.lt`), accent toggle, and background-motion speed all ship in the editor.

Update (2026-09-05, v34.2): **one theme, any content + escape the bake.**
- **No more song/scripture/presentation split.** The Theme Library is one flat set of "looks" — category tabs gone, the editor authors a single look, and every picker (rundown item/service chip, Song/Scripture editors, presentation deck) offers all of them. Two pure converters in `utils/presentationThemes.js` (`presTokensToStyle` / `styleToPresTokens`, exposed as `normalizeLookStyle` / `normalizeToPresTokens`) let ANY stored theme render on ANY surface, so a legacy presentation-token theme works as a lyric look and a text look re-skins a deck. `category` is now a vestigial DB field (defaults 'song'), gating nothing but the separate Graphics presets.
- **Baked song styles are now overridable.** The old model wrote a theme into `song_sections.style_json`, which then won forever. New `utils/themeStyle.js mergeSlideStyle` is the shared rule (buildPayload + monitors): a baked *base* style still wins, but a section with only inline `runs`/`textBox` (or null) inherits the live theme with its runs kept on top. `db/themes.js resetSongToTheme` / `resetAllSongsToTheme` strip the baked base look + own background + lock + slot overrides so a song rejoins the cascade — surfaced as a rundown song context-menu item ("Reset to theme") and a Theme Library "Reset all songs to theme" button.

Update (2026-09-05, v34.3): **the LOOK layer — treatment, Collections, multi-surface preview.**
- **Designed treatment layer (§5.1–5.2) shipped.** A coordinated overlay stack — directional scrim (bottom/top/radial/flat), vignette, film grain, colour grade/tint (mix-blend), a frosted **glass panel** behind text, and **Ken Burns** drift/zoom on stills — lives on `style.treatment`. Rendered once by the pure builders in `components/TreatmentOverlays.jsx` (previews) and **mirrored verbatim** in `output/fullscreen.js` (`#scrim` is now the treatment container; note it lost its `z-index` on purpose so the grade blends with `#background`). Wired into all three surfaces: output, `PreviewLivePanel` monitors, and the shared `SlidePreview` (SongEditor + ScriptureEditor). Back-compat: a legacy flat `bgScrim` degrades to a flat scrim, pixel-identical. "Auto-contrast" is served by the always-on directional scrim (no per-image sampling — the §0b.2 determinism decision), not a separate analysis pass.
- **20 flagship Collections shipped** (`resources/themes/collection-*.json`), all tagged `style.collection` so `themeKind` (kind −1) leads them in the gallery; the cards preview the real treated look via `SlidePreview`.
  - **8 photo/video-backed** (lead, sort −120…−113): Mountain Majesty · Cathedral Light · Candlelit *(video)* · Still Waters *(video)* · Open Heavens *(video)* · Winter's Hush · Gather · Autumn Praise *(video)*. Each references a `bgRef` from `media-manifest.json` (download-on-demand + cached, resolved by `resolveThemeBackground`) with a coordinated treatment: photos get **Ken Burns** + grade + scrim; videos get a calm `bgSpeed` + grade + scrim (no KB — KB is `<img>`-only). Gallery cards show the manifest poster `thumb` + treatment.
  - **12 gradient (offline, deterministic, zero media)** (sort −112…−101): Basilica · Modern Worship · Cinema · Broadcast · Vintage Press · Minimal Light · Minimal Dark · Starlit · Sunrise · Frosted Aurora · Emberglow · Reverence — premium multi-stop CSS-gradient + treatment + a bundled font. These guarantee the library is never empty and works with no internet (§ determinism decision).
- **Preview safe-area guide is hover-only.** `SlidePreview`'s content-window guide (the inset dashed frame) now renders only while the preview is editable AND hovered — so theme cards, monitors and read-only previews stay clean (a finished-looking slide, not editor chrome).

Update (2026-09-05, v34.4): **50 Collections + workflow.**
- **50 flagship Collections** now ship (`resources/themes/collection-01..50`): a large art-directed set spanning gradient (offline/deterministic) and photo/video (`bgRef`, download-on-demand) looks across worship/broadcast/seasonal/minimal/reverent moods, all on bundled fonts. They're the curated library.
- **Legacy built-ins are HIDDEN, not deleted** (cross-machine-safe: nothing dangles, no migration, fully reversible). `themeSort.js isCuratedTheme` / `filterBrowseThemes` gate browsing to Collections + the user's own themes; a "Show legacy" toggle reveals the pre-Collections packs (they still resolve, so any default/override pointing at one keeps working). Applied in the Theme Library gallery, `ThemePickerModal` (presentation decks bypass — they need their layout themes), and the new Library Themes tab. The current selection is always kept visible via `keepIds`.
- **Per-content-kind app defaults.** Songs and scripture can each have their own app-default theme (`settings.default_theme_id_song` / `_scripture`), overriding the general `default_theme_id` for that kind only; service + item overrides still win. Resolved in `OperatorView.appDefaultId(kind)` + mirrored in `output/manager.js`. UI: the card's "Set as default" gained **Songs / Scripture** chips.
- **Themes in the operator Library** — a new **Themes tab** (`panels/LibraryThemesTab.jsx`) reuses `SlidePreview` for one-tap *Use for this rundown* / *Set as default* (all/song/scripture) without opening Settings; changes bump a `themeTick` in OperatorView so the live cascade re-reads.
- **Edit-a-copy.** A built-in's "Edit a copy" duplicates it into an editable user theme AND opens the editor in one click (was Duplicate-then-hunt).
- **Terminology.** User-facing copy is now **Theme** (not "Look") and **Rundown** (not "Service") across the theme UI + rundown management (the chip reads `Theme: X · from this rundown`). DB identifiers (`services`, `theme_id`) unchanged.

Update (2026-09-05, v34.5): **the long tail — everything remaining, incl. optional.**
- **Fonts: ensure-present-before-go-live** (determinism guard). `db/fonts.js collectServiceFontFamilies` + `ensureServiceFonts(serviceId)` gather every font a rundown references (its themes, item overrides, app defaults, baked song styles) and pre-download any downloadable ones that aren't installed (bundled + user-imported skipped). IPC `fonts:ensureService`, fired fire-and-forget from `OperatorView` when a rundown loads; re-injects font CSS if anything was fetched.
- **Assign-time background download** (the black-bg fix): `utils/ensureThemeBg.js` downloads a theme's photo/video `bgRef` (spinner toast only when a real fetch happens) on EVERY assignment — default (all/song/scripture/slide), rundown, item — plus the reset-all handler. See the memory bugfix note.
- **Per-kind app default extended to slides** (`default_theme_id_slide`) alongside song/scripture; card + Library tab gained a **Slides** chip.
- **Item-override submenu** now hides legacy too (was the one picker still showing them).
- **Theme import/export** — `.cuetheme` files (tiny JSON, keeps `bgRef`). IPC `themes:export`/`themes:import`; an **Import** button in the gallery header + a per-card **export** (share) icon.
- **Lower-third entrance animations** (`style.lt.anim`: fade / up / down / slide) — output-only, applied to `#text` (composes with, never fights, the band transition); reduced-motion respected. Authored via an **Entrance** control in the L3 editor.
- **Theme Studio (§4.3) — built.** The theme editor is now a **full-window two-pane studio**: grouped token controls on the left (name/background · surface switch · accent · background motion · treatment · typography/per-slide, L3 tab for independent lower-third styling), and a **live multi-preview** on the right showing the SAME theme simultaneously as a fullscreen song slide (draggable text box), a scripture verse, a section header, and a lower third — so a fullscreen change and its (possibly different) lower third are judged side by side, in real motion. Reachable from the Theme Library (New / Edit / Edit a copy).
- **Self-hostable font pack (code half):** `downloadLibraryFont` tries a configurable `settings.font_pack_base` first, then falls back to the jsDelivr @fontsource CDN per weight. Ships `resources/fonts-manifest.json` (52 families, license, file pattern). *Publishing the pack + setting `font_pack_base` is a maintainer step.*
- **Font-picker own-face previews (SHIPPED):** `db/fonts.js buildPreviewFontCss` inlines subset preview woff2s from `resources/font-previews/<id>.woff2` (data-URI, since that dir isn't under userData) as `"<Family> Preview"`; the picker renders uninstalled fonts in their own face. **All 52 subsets are generated + bundled** (~5 KB each, 304 KB total) via `scripts/gen-font-previews.mjs` (`npm run gen-font-previews`, needs `pip install fonttools brotli`). Re-run after editing `fonts-catalog.js`.

**Still genuinely deferred** (need external assets/publishing, not code): the *published* self-hosted OFL pack and the *generated* preview subsets (both scaffolded above), a separate full-window Theme Studio view (in-editor multi-preview covers it), and hand-art-directed multi-surface "family" Collections (the 50 individual looks stand in).
- **Treatment editor controls** (`TreatmentControl` in `ThemeSettings`) + a **multi-surface preview** in the editor ("Across surfaces" — the same theme as a scripture verse, a section header, and a lower third at once, the §4.3 essence).
- **Font picker polish:** favourites (pin-to-top, localStorage) + weight-count badges.

Still not built (deliberate follow-ups): the **full-window** Theme Studio view (§4.3 — the in-editor multi-preview now covers the teaching goal); font determinism infra — build-time **subset preview-woff2** so uninstalled fonts render in their own face, **ensure-present-before-go-live** re-download, and the **self-hosted OFL pack** migration (currently jsDelivr `@fontsource`); and hand-art-directed **photo/video** Collection assets (the 12 gradient flagships + 20 download-on-demand photo themes stand in).

---

Not yet built (longer-tail from §5): the full-window Theme Studio (§4.3) and hand-art-directed multi-surface *photo* Collections (§5.6) — see the v34.3 update above for the current state.

---

## 0. The pitch in one paragraph

Today a "theme" is a **paint-bucket**: it bakes a text style into every song section and *also* fights the separate "default background" system, so output depends on invisible apply-history. We replace it with **one concept — a Theme — that is assigned, not baked**, and resolved live through a single inheritance cascade (App → Service → Item → Slide), exactly like Cue already resolves backgrounds. Background stops being a second, competing "default" and becomes *part of the Theme* plus explicit, visible overrides. Every surface shows **what theme is active and where it's inherited from**, with one-click "reset to inherited." The result: two concepts (a Theme, and Overrides) instead of the current seven, self-explaining inheritance, and a curated pack with real art direction.

---

## 0b. Locked decisions (finalized pre-build, 2026-09-04)

These are confirmed and **supersede any earlier prose they refine.**

1. **No standalone "background" concept.** The Background Library *becomes* the **Theme Library**. A background is never a separate default — it lives *inside* a theme, or as a per-item **background override** (the "same look, different picture here" escape hatch). Refines §2, §3.3.

2. **Themes auto-derive from any background.** Picking a library background generates a theme on the fly: an always-on **directional gradient scrim** guarantees legibility (white text stays readable on any image — no fragile per-image light/dark analysis; scrim *strength* is the only thing auto-tuned), plus a font pairing chosen at pick-time from the bundled palette. The user can tweak it, and the result is **saved as a concrete theme definition** (never silently re-generated).

3. **"Apply this look anywhere."** A theme = a portable **visual core** (background, treatment, font pairing, text colour, accent, base text style) **+ optional content roles** (scripture reference line, presentation layout). The core applies to *any* content type; only layout is category-bound and simply isn't carried across. **`category` becomes a filter, not a data shape** — so a scripture look applies to songs and vice-versa. Refines §3.4.

4. **Background Motion — default NORMAL (1×), user-adjustable slower.** Video backgrounds play at normal speed by default. A per-theme (and per-override) **Background speed** control lets the user slow them (≈0.25×–1×) for a calmer, less-distracting loop. Implemented as the background `<video>.playbackRate` (a local element property — **NOT** the shared transport clock, so no §Media-transport invariant is touched). The extra calm treatment (blur/grade) is opt-in, not on by default.

5. **Curated Collections + auto-derived long tail.** Ship ~8–12 hand-art-directed flagship **Collections** (§B6); every other background becomes a good-looking theme via the auto-derive path (2). Two tiers, one system.

### Theme distribution & determinism — do NOT ship zero themes
The "everything dynamic, bundle nothing" idea would hurt consistency: a catalog regenerated by an algorithm at launch drifts across devices and across app versions (different font availability, analysis, or an improved algorithm later → the *same* service renders differently on another machine). The fix is to separate a theme's **definition** from its **assets**:

- **Definitions ship and are deterministic** — tiny JSON (font + treatment + colours + accent + which background id). Identical on every device, every launch, offline. *This is what guarantees a consistent look.*
- **A handful of asset-free themes** (CSS-gradient / solid / typographic) ship so the Theme Library is **never empty on first run and works with no internet**. Cue already has these as the `bgCss` built-ins — keep them.
- **Media assets stay download-on-demand + cached** (licensing forbids rehosting — unchanged). Once cached, identical everywhere; the only cross-device variability is a *caching state* (downloaded yet or not), never the look.
- **Fonts stay bundled** (19 already) so typography is deterministic — a dynamic pairing only ever picks from what's shipped.
- **Dynamic generation is a user action, not the source of the catalog.** Its output is persisted as a concrete definition, so an existing service never changes when the generator improves later.

Net: lean app (tiny definitions + on-demand media), a **consistent, deterministic experience across devices and launches**, and no empty first-run.

### Typography & the font library (download-on-demand)

**Decision (2026-09-04): download-on-demand, self-hosted OFL pack, ~70 fonts, with a picker that previews before download.**

- **Distribution.** OFL/Apache fonts are freely redistributable (unlike the stock media), so *we* host the pack (a GitHub release + `fonts-manifest.json`) — no third-party/Google runtime dependency, no privacy question. Ship a **~25–30 font bundled core** (covers every style, fully offline) + **~40 download-on-demand.**
- **Loader — ArrayBuffer, not URL.** Main reads the woff2 bytes; each window registers `document.fonts.add(new FontFace(name, buffer))`. Works in the operator **and every output window** regardless of the packaged CSP — no `font-src` widening.
- **Live previews without downloading — the picker trick.** Build-time, subset each font to a tiny **preview woff2** (just the glyphs for the font's name + a sample line, ~2–4 KB; ~200 KB for all 70). Bundle those, so the picker renders **each row in its own real typeface, offline, before the full font is downloaded**. The download icon fetches the full family only when chosen.
- **Picker UI** (modeled on the reference the user shared, in Cue's dark language): a searchable, category-filtered list (All / Sans / Serif / Condensed / Display / Slab / Script / Mono); each row shows the **name rendered in its own face** + a **category chip** + a **weight-count badge**, and a right-side affordance: **⤓ download** → progress ring → **Installed** (bundled-core fonts show Installed from the start). Optional **favourites** (pin to top). This picker replaces the plain font dropdown in the theme editor.
- **Determinism guardrails (live-service critical — text can't fall back mid-service):** (1) **pre-fetch on pick** (download then, with a spinner, like `resolveThemeBackground`); (2) **ensure-present before go-live** — track fonts a service references and re-download any missing on a fresh machine; (3) **same-class bundled fallback** until a download completes; (4) **include `userData/fonts/` in backup/restore + data-folder-move** (same rule as media paths).
- **Metadata.** `fonts-manifest.json` records per family: category, weights, **license (OFL/Apache only)**, and a pairing hint (feeds the auto-derive theme pairing, §0b.2).

**Curated ~70 (all OFL/Apache) — worship/ProPresenter aesthetic, commercial favorites mapped to free look-alikes:**
- *ProPresenter template set (ship exact):* **Oswald, Montserrat, Lora** (+ Arial is a system font, not shipped).
- *Neutral/grotesque (Helvetica/Proxima/Gotham →):* Inter, Work Sans, Archivo, Libre Franklin, Manrope, Hanken Grotesk, Figtree, Sora, Public Sans.
- *Geometric (Gotham/Avenir/Century Gothic/Futura →):* **Montserrat**, Poppins, Jost *(Futura)*, Questrial *(Century Gothic)*, Josefin Sans, Nunito Sans *(Avenir)*, Outfit, Lexend.
- *Humanist (Gill Sans/Myriad/Open Sans →):* Open Sans, **Lato**, Mulish, Cabin, Source Sans 3, Rubik, Assistant.
- *Condensed / tall display (Bebas/Dharma/Knockout/Din →):* **Bebas Neue, Oswald**, Anton, Archivo Narrow, Barlow Condensed, Barlow Semi Condensed, Fjalla One, Teko, Saira Condensed, Pathway Gothic One *(Gotham condensed)*, Staatliches.
- *Elegant serif (Garamond/Baskerville →):* **Lora**, Playfair Display, Cormorant Garamond, EB Garamond, Libre Baskerville, Crimson Pro, Spectral, Source Serif 4, Newsreader, DM Serif Display, DM Serif Text.
- *Reverent / cathedral (scripture):* **Cinzel**, Cormorant, Marcellus, Cardo, Alegreya.
- *Slab:* Zilla Slab, Roboto Slab, Arvo, Bitter, Alfa Slab One.
- *Display / character (title cards):* Fraunces, Bricolage Grotesque, Big Shoulders Display, Unbounded, Shrikhand.
- *Script / handwritten (titles only, used sparingly):* Dancing Script, Caveat, Sacramento, Great Vibes, Parisienne, Kalam.
- *Mono (broadcast/timecode):* Space Mono, JetBrains Mono, IBM Plex Mono.
- *Worship-specific, license permitting:* CMG Sans, VMC Worship Bold *(verify redistribution terms before bundling; free-to-use ≠ redistributable).*

---

## 1. Why themes feel confusing today (diagnosis)

Grounded in the current code (`db/themes.js`, `ThemeSettings.jsx`, `ThemePickerModal.jsx`, `OperatorView.resolveBackground`, `output/manager.js`).

### 1a. Two competing "defaults" for the background — the core confusion
Two independent systems both set the background, with different lifetimes:

1. **Global default background** — live, per-surface (song / scripture / slide), set from Media / Background Library ("Set as Global … Background"). Read *live* by `resolveBackground`: `lock → per-slot override → song's own default_background_id → **global default** → black`.
2. **A theme's background** — a theme also carries a background (`background_id` / `bgCss` / `bgRef`). Applying a theme **bakes** it into that song's `default_background_id`, gated by a tiny "Apply background" checkbox.

So whether a song follows your global default depends on **invisible history**: did a theme-with-a-background ever get applied to it, with the checkbox on? Traps users hit:
- Set a nice global video background → apply a theme for its fonts → the theme's background *silently replaces* your video for those songs (but not new ones — library now inconsistent).
- Apply a **gradient** theme → it *silently NULLs* any media background (`bgCss` must win).
- Apply a **text-only** theme → background untouched. So themes sometimes control the background and sometimes don't, with no visible reason.
- Two operators with the *same* global default get *different* output purely from theme-apply order.

### 1b. Applying a theme is a destructive bake, not a live style
`applyToSong / applyToRundown / applyToAllSongs` copy the theme's `style_json` **into every `song_sections.style_json` row** and stamp `default_background_id`. After that there is **no link back to the theme**. Edit the theme later → nothing updates. There is no notion of "this service uses Theme X." A theme is a rubber stamp.

### 1c. Concept sprawl — ~7 overlapping ideas
A user must hold all of: *theme* · *default background (×3 surfaces)* · *per-song style* · *per-slot background override* · *background lock* · *theme categories (4 different data shapes)* · *graphics presets (a separate system entirely)*. Each has its own lifetime and its own apply mechanic.

### 1d. Fragmented apply surfaces
Three disconnected ways to "apply," each behaving differently: Settings → Themes ("apply to rundown / all songs"), the editor "Load Theme…" picker (this item only), and per-category rules — with scripture/presentation themes **not applyable from Settings at all** ("open the … editor and pick this theme").

### 1e. Lower thirds can't be styled independently of fullscreen
The L3 output (`lowerthird.js applyStyle`) consumes the **same `style_json`** as fullscreen — same `fontFamily`, `fontSize`, `color`, `textShadow`, `textStroke`. The *only* L3-specific field is `ltBar` (the bar gradient). So a theme's lower third is welded to its fullscreen text treatment: you **cannot** remove the shadow on the L3 while keeping it on fullscreen, change the L3's font/colour, or give it a different shape. The sole thing that varies between themes' lower thirds is a bar colour — which is exactly why "all L3 look the same."

### 1f. Flat art direction (the LOOK gap)
Built-in themes are essentially *font + colour + drop-shadow + a flat radial gradient*. Legibility is an afterthought (a shadow), not a designed treatment. No layered composition, no motion, no coordinated type pairings, no per-slide-type styling, and the lower-third shares no design language with the fullscreen.

---

## 2. Target mental model — "Themes with inheritance"

Three commitments make the whole thing intuitive:

**One noun — the Theme.** A Theme is *everything* about how output looks: background + legibility treatment + type + colours + per-role styling. We keep the industry-standard word **"Theme"** in the UI (matches the ProPresenter/EasyWorship expectation) but make it mean exactly *one* thing. "Default background", "presentation theme", "graphics preset" stop being separate nouns.

**One verb — "Use here" (assign, never bake).** You never copy a theme. You *set* it at a level. Levels, most-general → most-specific:

| Level | Where set | Stored |
|---|---|---|
| **App default** ("Everywhere") | Settings › Themes | `settings.default_theme_id` |
| **Service** (this rundown) | Rundown header · gallery "Use for this service" | `services.theme_id` |
| **Item** (this song / scripture / slide) | Item's theme chip · editor | `service_items.theme_override_id` (and `songs.theme_id` for library default) |
| **Slide** (one slide) | Slide context menu (power feature) | per-slot, existing override plumbing |

Each level **inherits from the one above** unless explicitly set — the master-slide model users already know from Keynote/PowerPoint/ProPresenter.

**Background belongs to the Theme, plus explicit overrides.** There is no separate "default background." A background appears either because it's part of the resolved Theme, or because someone set an explicit *background override* at a level (the one decoupling users actually want: "same fonts, just change the picture here").

### The unified resolution (one cascade, mirrors `resolveBackground`)
```
effectiveTheme =
     slide theme override
  ?? item theme            (service_items.theme_override_id ?? songs.theme_id)
  ?? service theme         (services.theme_id)
  ?? app-default theme     (settings.default_theme_id)
  ?? built-in fallback

effectiveBackground =
     slide bg override      (service_items per-slot override — existing)
  ?? item bg override / lock (songs.background_locked pins the song's own bg)
  ?? service bg override    (new, optional)
  ?? effectiveTheme.background
  ?? black
```
This preserves every current invariant: nothing is snapshotted (themes/backgrounds resolve **live**, per the existing "songs read the global default live — do NOT snapshot" rule), it stays one flat cascade, and the rundown-row thumbnail resolves through the *same* function so preview matches output.

**Content edits are not the Theme.** Per-character runs (bold/colour ranges) and one-off tweaks live on the *item* and win over the theme's base layer. "Customize this slide/song" = create an override, always reversible via "Reset to theme."

### Concept reduction — the headline
| Today (7) | Becomes |
|---|---|
| Theme (bake) | **Theme (assigned, live)** |
| Default background ×3 surfaces | folded into Theme + **Background override** |
| "Apply background" checkbox | *gone* — theme carries its bg; overrides beat it |
| Per-song baked style | **Item override** (same inheritance UI) |
| Per-slot bg override | **Override** (same vocabulary) |
| Background lock | **Pinned override** (same vocabulary) |
| Theme categories (4 shapes) | one Theme with **role tokens** |
| Graphics presets (separate) | the Theme's overlay/lower-third styling |

**From ~7 concepts to 2: a Theme, and Overrides at a level.** That reduction *is* the intuitiveness win.

---

## 3. How they WORK — architecture

### 3.1 Data model (one migration, e.g. schema v32)
- `settings.default_theme_id` — the App default Theme.
- `services.theme_id` — service-level Theme (nullable → inherit App).
- `service_items.theme_override_id` — item-level Theme (nullable → inherit Service). Keep existing `background_override_id` as the **background** override at item/slot level.
- `songs.theme_id` — the library default Theme for a song (used when a song is added to a rundown; the rundown item can still override). Retire *reliance on* baked `song_sections.style_json` for the base look (see 3.5).
- `themes`: extend `style_json` to the **role-token shape** (3.4). Keep `background_id` / `bgCss` / `bgRef` as the theme's background source. **`media.findUnused()` must count every theme's `background_id`/`bgRef`** (guard rail — already partly true; verify for the new fields).

### 3.2 `resolveTheme()` — mirror the background cascade
Add a `resolveTheme(ctx)` next to `resolveBackground` in **both** `OperatorView` (renderer, source of truth for live/preview) and `output/manager.js` (mirror). It returns `{ theme, source }` where `source ∈ {slide,item,service,app,builtin}` so the UI can show *where it came from*. `applyStyle` in the output templates consumes the resolved theme's role tokens. **Editing a theme re-renders live** — same mechanism as `onBackgroundDefaultChanged` today.

### 3.3 Background unified into the Theme
`resolveBackground` gains the theme's background as the layer *below* explicit overrides (see cascade in §2). The per-surface "global default background" settings are migrated to the App-default Theme's background (or a global override) — after migration there is no independent global-default-background concept in the UI.

### 3.4 One theme shape — role tokens (retire the 4 shapes)
Promote the presentation **role-token** model (`utils/presentationThemes.js`, already the most modern part) to *the* model. A theme defines once:
- **background** (media / gradient / motion) + **treatment** (scrim direction, vignette, grain, glass panel, auto-contrast — §5),
- **type pairing** (display + body + optional quote/serif) with per-role size/tracking/leading,
- **accent** colour,
- **per-role styling**: `songLyric`, `sectionLabel`, `scriptureVerse`, `scriptureRef`, `lowerThird`, presentation `title/subtitle/body`.

A song reads `songLyric` + background; scripture reads `scriptureVerse`/`scriptureRef`; the lower-third reads `lowerThird` — **all from one theme**, so an overlay finally matches the fullscreen. `category` degrades to an *intent tag/filter*, not a data shape. Old-shape themes remain readable via a compatibility adapter.

#### 3.4a A theme carries both fullscreen *and* lower-third styling (independently)
Today the L3 borrows the fullscreen text style (§1e). Make **`lowerThird` a first-class role with its own complete treatment**, so a theme can look one way full-screen and a different way as an overlay:

- **Full text treatment per surface:** `fontFamily`, `fontSize` (absolute or as a fraction of the fullscreen size — the existing L3 `scale`), `color`, `textShadow` (incl. **`enabled:false`**), `textStroke`, `align`, `bold/italic/uppercase`, `letterSpacing`, `lineSpacing`.
- **L3 form (what actually makes overlays look different across themes):** the background treatment — **bar / box / pill / gradient / none**, generalising today's `ltBar` — plus anchor (lower-third vs banner vs centred), width, padding, corner radius, and enter/exit animation.
- **Inherit-by-default, override per field.** `lowerThird` starts as *"same as `songLyric`/fullscreen"* so simple themes stay simple; any single field can be independently set. So the user's example — **remove the box shadow on the lower third only** — is `lowerThird.textShadow.enabled = false` while the fullscreen role keeps its shadow. Same field-level inheritance idea as the App→Service→Item level cascade, one consistent mental model.
- Consumers: `lowerthird.js applyStyle` reads the resolved `lowerThird` role instead of the shared `style_json`; `LowerThirdPreview` and `PreviewLivePanel` mirror it. (Broadcast **name/title straps** — the `graphics-overlay.js` `nameTitle` slot — are a separate overlay system; the theme supplies *their* look via the folded-in graphics styling, §3.4/§5, so a name strap can also match the theme.)

### 3.5 Migration — zero visible change on day one
The upgrade must make existing users' output **pixel-identical** at first launch:
1. Synthesize an **App-default Theme "My Current Style"** from the current global default background(s) + the default text style. Set `settings.default_theme_id` to it. → App-level output unchanged.
2. Existing **baked `song_sections.style_json`** and per-song `default_background_id` become **item-level overrides** that win over the theme. → every existing song looks exactly as before.
3. Over time the user can "Reset to theme" on a song to adopt live theming; nothing forces it. The bake path survives *only* as this migration bridge + the explicit "Customize" escape hatch.
4. Because MAJOR is schema-derived, this migration bumps MAJOR and resets MINOR/PATCH in the same commit (per CLAUDE.md release rules).

---

## 4. How it's INTUITIVE — the UX

Design principles applied (from the `impeccable` skill): make inheritance *visible*, one consistent vocabulary, motion as intent not decoration, real contrast for legibility, and avoid the lazy identical-card-grid.

### 4.1 The inline Theme chip — inheritance made visible (the glue)
This is the single most important intuitiveness feature. In the **rundown/operator** and in **each editor**, a compact chip:

> `◐ Theme: Sanctuary · from Service ▾`

- Click → small popover: **Change theme…** · **Override background…** · **Reset to inherited** (disabled if nothing overridden). The popover always states *the resolved theme and its source*, and shows the background's source separately.
- The `· from Service` / `· from App` / `· Custom` suffix makes "which wins" answerable **at a glance** instead of by trial and error. This is the master-slide/CSS-inheritance model made literal.
- Overrides are always reversible ("Reset to inherited"), so experimentation is safe — the antidote to today's silent, sticky bakes.

### 4.2 Themes gallery — browse + assign
Replace the tiny static Settings cards + the confusing "apply to rundown / all songs" buttons with a gallery of **large, live, animated previews** (motion backgrounds playing, Ken Burns on stills — reveal enhances an already-visible default, honoring reduced-motion). Per card:
- Primary action: **"Use for this service."** Secondary menu: *Set as App default* · *Customize* (opens Studio on a duplicate).
- Clear **"In use"** state on the theme that's currently the App/Service default.
- Not an identical-card grid for its own sake: previews are the content, sized to actually judge a look.

### 4.3 Theme Studio — one place to author a Look
A full-window studio (its own view; reachable from Settings *and* a "Design this theme" button in each editor):
- **Left:** grouped token controls — Background & treatment · Typography · Colour/accent · Per-slide-type. A **surface switch (Fullscreen / Lower third)** scopes the text controls to the role being edited; L3 controls show an **"inherits fullscreen · override"** toggle per field, so dropping the L3 shadow (or changing its font/shape) is one obvious click and the inheritance is visible.
- **Right:** a **live multi-preview** showing the *same* theme as a song slide, a scripture verse, a section header, **and** a lower-third simultaneously, against real content, in real motion — so a fullscreen change and its (possibly different) lower-third are seen side by side — plus a caption showing the resolved **"Assign to: Everywhere / This Service / This Item."** The studio itself teaches the inheritance model.
- Non-destructive; "Save" updates the live theme and everything inheriting it re-renders.

### 4.4 Vocabulary & microcopy
One consistent set of words everywhere: **Theme** (the look) · **Use here / Use for this service** (assign) · **Override** (background or theme at a level) · **Reset to inherited** · **Inherited from App/Service**. Kill the mixed language ("apply", "load theme", "default background", "set as global"). Consistent verbs are half of perceived intuitiveness.

### 4.5 Onboarding, defaults, empty states
- **First run / new install:** a real, attractive theme is already the App default (never black/blank output).
- **New service:** header shows `Theme: [App default: Modern Worship] ▾` — one click to give the whole service a different look.
- **Empty gallery / no custom themes:** a "Start from a collection" prompt, not a dead end.
- **Never a jarring change on upgrade** (see 3.5 migration).

---

## 5. How they LOOK — creative direction

Principle: **a theme is a coordinated composition, not a font on a wash.** Six ingredients, authored per theme:

1. **Legibility as a designed treatment** — extend the output `#scrim` into a real treatment layer: directional gradient scrim (bottom-up pool of contrast), vignette, optional film-grain/texture, a blur-behind-text **glass panel** for busy photos, and **auto-contrast** darkening. This is the biggest single "looks pro" upgrade; body text must clear ≥4.5:1 against the treated background.
2. **Motion & grade** — Ken Burns drift/zoom on stills; subtle looping motion backgrounds (Cue already has the media library + single transport clock); a per-theme colour grade/tint so stock reads as *branded*.
3. **Coordinated typography** — curated display+body **pairings** (contrast axis: serif+sans / geometric+humanist — never two near-identical sans), tuned size/tracking/leading per role, auto-fit so long lines don't overflow.
4. **An accent that threads through** — one accent on the reference line, section labels, rules, ticker, and lower-third bar: the theme's visual signature.
5. **Per-slide-type styling** — title vs verse vs body vs section vs lower-third look intentionally different *within one theme* (native once role tokens exist, §3.4). The **lower third is a designed surface in its own right** (§3.4a): its own font/colour/shadow and a real form — bar / box / pill / gradient / none — so a theme's overlay reads as *that theme*, not a generic strap. This is what ends "every L3 looks the same."
6. **A curated pack with art direction** — ~8–12 named **Collections**, each a family (fullscreen + lower-third + scripture in one voice): e.g. **Sanctuary** (warm cathedral, serif, gold, grain) · **Modern Worship** (clean sans, deep gradient, frosted lyric panel, teal) · **Cinema** (letterboxed, film-grade motion, condensed display) · **Broadcast** (mission-control, strong L3 language) · **Vintage Print** (paper, ink serif, muted) · **Minimal Light/Dark** · **Nightfall / First Light** (existing dark photo moods upgraded with gradient scrim + grade).

---

## 6. Phasing / sequencing

1. **Foundation (WORK):** `resolveTheme` cascade + App/Service/Item assignment fields; unify background into the cascade; migration (§3.5) so output is unchanged. *Model becomes live; nothing visual yet.*
2. **Treatment layer (LOOK):** gradient scrim + vignette + grain + glass panel + auto-contrast in output templates *and* previews. Instantly lifts every existing theme.
3. **Intuitive UX (WORK):** the inline **Theme chip** (§4.1) + Themes gallery (§4.2) + consistent vocabulary. This is where the confusion actually dies.
4. **Theme Studio (WORK/UX):** the single authoring surface with live multi-preview (§4.3).
5. **Motion, grade, curated Collections (LOOK):** author the ~8–12 families; Ken Burns/grade.
6. **Unify role-tokens across song/scripture/graphics (WORK):** collapse the 4 shapes; overlay shares the theme.

Steps 1–3 deliver most of the *intuitiveness* win; 2 + 5 deliver most of the *look* win.

---

## 7. Open decisions

- **Scope of the WORK change:** full live-cascade model (recommended — it's what makes themes feel commercial) vs. a lighter "keep the bake, just unify the surface + art direction." *Recommendation: full model; the migration bridge (§3.5) de-risks it.*
- **User-facing noun:** keep **"Theme"** (recommended, matches ProPresenter) vs. rename to "Look." *Recommendation: keep "Theme," make it mean one thing.*
- **Service-level background override:** include from day one, or rely on item overrides only? *Recommendation: include; it's cheap and matches the cascade.*
- **How aggressively to auto-migrate baked styles to live themes** (offer a one-time "Reset all songs to theme" vs. leave overrides until the user opts in). *Recommendation: leave as overrides; never rewrite user content silently.*

---

## 8. Invariants this redesign must respect

- **Never snapshot** a global/App default into an item — themes and backgrounds resolve **live** (existing background-cascade rule).
- **One flat cascade**, mirrored between `OperatorView` and `output/manager.js`; rundown-row thumbnail uses the same resolver.
- **`media.findUnused()`** must count every theme's `background_id` and `bgRef` (and any new theme-background field) or curated backgrounds get deleted as "unused."
- Media served only via `cue-media://` / `cue-thumb://`; grid previews use `thumbUrl()`.
- Output templates own their rendering (`fullscreen.js`, `lowerthird.js`, `graphics-overlay.js`); the operator renders from payload, never a capture loop.
- Version/migration: a new migration bumps schema-derived MAJOR and resets MINOR/PATCH in the same commit; mirror `package.json`.
