# Theme Packs — Phase 1a (built) · Feature #1 (P0 flagship)

**Status:** implemented, not yet committed. App boots at **v22.0.0**, migration v22 applied,
20 built-in themes seed on first run and render (verified via DB + a contact-sheet screenshot).

This is Phase 1a only: the theme-engine foundation + a starter pack of **song** themes with
license-free CSS-gradient backgrounds. Phases 1b (curated photo/video media) and 1c
(scripture/graphic/presentation theming) are deferred — see "Follow-ups".

## What shipped

### Theme model (one schema change)
- **Migration v22** (`db/schema.js`): `themes` gains `builtin` (0/1), `category` (default
  `'song'`), `sort_order`. Gated re-seed uses a `themes_seeded` settings flag.
- A theme's **background is either** a media asset (`background_id`) **or** an original CSS
  gradient/solid carried inside `style_json` as **`bgCss`** (fullscreen) / **`ltBar.css`**
  (lower-third bar). No extra column — it rides the existing `applyTo*` merge into
  `song_sections.style_json`. Zero licensing/attribution exposure.
- `db/themes.js`: `list()` orders `builtin DESC, sort_order, name`. `applyToSong/Rundown/
  AllSongs` now clear a song's media background when the theme uses `bgCss` (so the gradient
  isn't masked — media wins over `bgCss` in `resolveBackground`). Text-only themes still never
  touch backgrounds. New `seedBundledThemes()` mirrors `seedBundledBibles()`/`seedGhsHymnal()`.
- `seedBundledThemes()` wired in `src/main/index.js`; `./resources/themes` added to
  `extraResource` in `forge.config.js`.

### Rendering (`bgCss` + `ltBar.css` across every surface)
- `output/fullscreen.js` — `setBackground(path, bgCss)`: media path wins, else CSS background.
  Reset `bg.style.background` in `setForegroundMedia` too.
- `output/lowerthird.js`, `PreviewLivePanel.jsx`, `SongEditor.jsx` — each local `buildBarBg`
  honors `ltBar.css`.
- `SongEditor.SlidePreview` + `PreviewLivePanel.MonitorFrame` — fullscreen `bgCss` fallback
  when no media path. `styleIsDefault()` now counts `bgCss` as non-default (so it isn't
  dropped on save). `handleLoadTheme` clears the media bg when loading a gradient theme.
- `graphics-overlay.js` intentionally untouched — song themes don't flow through the
  broadcast-graphics bus.

### Pickers / protection
- `SongEditor` "Load Theme…" and `RundownPanel` apply-theme context menu filter to
  `category === 'song'`. RundownPanel applies with `setBg:true` (gradient themes now apply).
- `ThemeSettings` cards: built-ins show a **Built-in** badge and a **Duplicate** action
  (read-only; duplicating creates an editable user copy). "Apply background" checkbox now
  shows for `bgCss` themes too.
- **Backups**: built-ins live in `cue.db` → copied wholesale; CSS gradients have no media
  files to path-rewrite. **Factory reset** deletes `cue.db` → built-ins re-seed on next boot.
  No special-casing needed.

### Fonts — bundled 19 free/OFL families (`scripts/build-fonts.mjs`)
Added to `src/fonts/` (basic-latin woff2), `src/fonts/fonts.css`, and `BUNDLED_FONTS`
(`src/main/fonts.js`): Archivo, Barlow Condensed, Bebas Neue, Jost, Overpass, Poppins, Roboto,
Cinzel, Cormorant Garamond (+italic), DM Serif Display (+italic), Lora, Marcellus, Rakkas,
Atma, Dancing Script, DynaPuff, Playpen Sans, + EB Garamond italic. ~1.5 MB total.
`src/fonts` is copied wholesale by the `packageAfterPrune` hook — no hook change needed.
Commercial faces (Futura PT, Termina) excluded. **VCR OSD Mono + BonvenoCF NOT added** —
not on Google Fonts, pending a non-Google source + freeware-license check.

### The pack — 20 song themes (`scripts/build-themes.mjs` → `resources/themes/*.json`)
Headline (Bebas Neue), Nightfall (Oswald), Banner (Barlow Condensed), Aurora (Poppins),
Tide (Montserrat), Meadow (Jost), Clean Slate (Archivo), Open Air (Overpass, light),
Signal (Roboto), Sanctuary (Playfair), Noel (DM Serif), Cathedral (Cinzel), Crimson
(Marcellus), Daybreak (Cormorant italic), Linen (EB Garamond, light), Manuscript (Lora),
Vesper (Cormorant), Ember (Playfair), Sundown (Montserrat), Grace (Dancing Script, light).
All original CSS gradients/solids. Edit/regenerate via `node scripts/build-themes.mjs`.

## Reference provenance
`plan/themes-references/` (Church Motion Graphics, Igniter Media, Visual Revival) +
`theme-fonts.txt`. Typography/treatment/mood were replicated; **no reference photos embedded**.
Photo-dependent looks (forest road, Christmas bokeh, crown-of-thorns) flagged for Phase 1b.

## Follow-ups (not done)
- **Phase 1b**: curated photo/video media library — **in progress, see "Phase 1b" section below**.
- **Phase 1c**: scripture / graphic / presentation theme categories (the `category` column is
  already there; pickers already filter on it).
- VCR OSD Mono + BonvenoCF fonts (license + source). A retro/mono theme depends on them.
- A UI control in `ThemeSettings`/`FormattingToolbar` to author `bgCss` gradients for *user*
  themes (built-ins are authored as JSON today).
- Optional: group the new display/script fonts in the picker; verify a packaged build
  (`npm run package`) launches and the new fonts/themes ship.

---

## Phase 1b — curated media library (in progress, 2026-06-14)

**Model:** 310-item curated, tagged library. The shippable artifact is
`resources/media-manifest.json` (tracked: each item has `tags`, `width/height`, `mbps`, and an
origin `url`). **Distribution = Option A** — the app downloads each item from its source CDN `url`
on demand; we never rehost (licenses forbid redistributing the clips as stock, and self-hosting a
distributed app counts as redistribution). The local working pool was deleted (was only for
curation/QA). Build tools: `scripts/fetch-phase1b-media.py` (fetch+curate), `scripts/organize-media.py`
(flatten + tag), `scripts/resolve-urls.py` (id/slug → origin url).

**303/310 URLs resolved & live-checked. 7 still unresolved** — all Coverr, blocked because Coverr
hard rate-limited this IP after heavy use on 2026-06-14. They are NOT broken; they just need a retry
once the cooldown clears. Recover them in a later session with (no API key needed, won't touch the
303 already done):

```
python3 scripts/resolve-urls.py --only-missing --workers 1
```

The 7 pending items (recoverable from their slugs, which live in the manifest's `file` field):
- `library/coverr-the-ocean-arfjntmqk8.mp4`
- `library/coverr-timelapse-of-clouds-dsal4pxnyw.mp4`
- `library/coverr-timelapse-of-the-clouds-oj4mcuuvzl.mp4`
- `library/coverr-trip-through-norway-3jqbqnkeu5.mp4`
- `library/coverr-waves-crashing-together-i1yzbtucpt.mp4`
- `library/coverr-waves-in-the-ocean-hncd51zzmz.mp4`
- `library/coverr-young-maple-trees-with-yellow-leaves-surround-a-road-gzrz3vf.mp4`

After resolving, confirm 310/310 have a `url`. **Next Phase 1b step:** wire the manifest into a
Backgrounds picker (filter by `tags`) → download `url` to `userData/` → register as a `media_assets`
row (absolute path; `cue-media://` output, `cue-thumb://` grid). Unsplash ToS nicety still TODO
(trigger their download endpoint).
