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
