## 9. Theme Cascade & Background Resolution Order

### 9.0 The theme cascade (v34 — "assign, never bake")

A **theme** is *assigned* at a level and resolved **live** — it is no longer baked into `song_sections.style_json`. `OperatorView.effectiveTheme(item)` is the source of truth, mirrored best-effort by `output/manager.js`:

```
effectiveTheme = item.theme_override_id           (service_items.theme_override_id)
              ?? service.theme_id                 (services.theme_id)
              ?? per-kind app default             (settings.default_theme_id_{song|scripture|slide})
              ?? app default                      (settings.default_theme_id)
              ?? built-in fallback
```

`appDefaultId(kind)` picks the per-kind default (`default_theme_id_song`/`_scripture`/`_slide`) and falls back to the general `default_theme_id`. The two columns (`services.theme_id`, `service_items.theme_override_id`, migration **v34**) are nullable = "inherit the level above", `ON DELETE SET NULL`. `themeTick` bumps in `OperatorView` when any default/assignment changes so the live cascade re-reads and the live item is re-sent. Themes are **generic**: `category` is a filter, not a data shape — any theme applies to any content kind; two pure converters in `utils/presentationThemes.js` (`normalizeLookStyle` / `normalizeToPresTokens`) let a layout-token theme render as a lyric look and vice-versa.

**Baked styles are now overridable**, not permanent: `utils/themeStyle.js mergeSlideStyle(sectionStyle, themeStyle)` (shared by `buildPayload` + the monitors) lets a baked *base* style still win, but a section carrying only inline `runs`/`textBox` (or null) inherits the live theme with its runs kept on top. `db/themes.js resetSongToTheme` / `resetAllSongsToTheme` strip the baked base look + own bg + lock + slot overrides so a song rejoins the cascade (rundown song context-menu "Reset to theme" + a Theme Library button).

### 9.1 Background resolution

When building the output payload, `resolveBackground(item)` in `OperatorView.jsx` follows a single flat cascade — **lock → override → song → effective-theme bg → legacy live global → black**:

```
1. song.background_locked → item.song.default_background.path  — LOCKED song's pinned bg
                                                                  (ignores everything below)
2. item.background_override.path        — per-rundown-slot override (set via context menu)
3. item.song.default_background.path    — per-song default (songs:setBackground / song editor)
4. effectiveTheme.bgPath                 — the resolved theme's media background (§9.0)
   (a gradient theme returns null so its bgCss shows; theme style rides in the payload styleJson)
5. songGlobalBgPath / scriptureBgPath / slideBgPath  — LEGACY live global default (fallback only)
6. null → black screen
```

The theme (layer 4) and legacy global (layer 5) are read **live**: changing a theme/default applies immediately to every unlocked item still inheriting it — no per-entity snapshot. The old per-surface "global default background" UI is retired; `global_bg_*` settings survive only as the layer-5 fallback for installs with no theme set. `songGlobalBgPath`/`scriptureBgPath`/`slideBgPath` are loaded by `OperatorView.loadScriptureDefaults()` via `window.cue.media.get(id)`, refreshed on `bgRefreshTick`/`themeTick`. The resolved `backgroundPath` is an absolute filesystem path; output windows convert it to `cue-media://` via their inline `pathToUrl()`.

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

**Treatment layer (v34):** `style_json.treatment` drives a coordinated legibility/grade stack rendered *between* background and text — directional scrim (`bottom`/`top`/`radial`/`flat`) + `scrimStrength`, `vignette`, film `grain`, colour `tint` (mix-blend), a frosted `glass` panel behind the text box, and `kenBurns` drift/zoom on stills. `#scrim` in `output/fullscreen.js` is now the treatment container (its `applyTreatment()` fills it with the overlay stack; note `#scrim` deliberately has **no z-index** so the tint's `mix-blend-mode` blends with `#background`). The pure builders live in `components/TreatmentOverlays.jsx` (`treatmentLayers`/`scrimBackground`/`glassBoxStyle`) and are **mirrored verbatim** in `fullscreen.js`; wired into `PreviewLivePanel` monitors and the shared `SlidePreview` too. Back-compat: a legacy flat `bgScrim` degrades to a flat scrim, pixel-identical. `style_json.bgSpeed` (0.1–2, default 1×) sets the background `<video>.playbackRate` (a local element property, **not** the transport clock). Lower-third output has its own independent form/animation (§9 below, §13).

---
