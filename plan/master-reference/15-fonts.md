## 15. Fonts

Three tiers, all surfaced in one picker (grouped by category):

**1. Bundled** — 23 families in `src/fonts/` (`.woff2`), pixel-identical on every machine. The original 6 (Inter — default UI, Montserrat, Lato, Oswald — output templates only, Playfair Display, EB Garamond) plus the **theme-pack additions** (free/OFL): Archivo, Barlow Condensed, Bebas Neue, Jost, Overpass, Poppins, Roboto, Cinzel, Cormorant Garamond, DM Serif Display, Lora, Marcellus, Rakkas, Atma, Dancing Script, DynaPuff, Playpen Sans. Built by `scripts/build-fonts.mjs` (woff2 → `src/fonts/` + `@font-face` rules in `fonts.css` + entries in `BUNDLED_FONTS`). `fonts.css` (`font-display: block`) is loaded by output templates (`<link href="../fonts/fonts.css">`) and the renderer (`@import` in `index.css`); `src/fonts` is copied into the asar by the `packageAfterPrune` hook. (JetBrains Mono is **not** bundled — the operator-UI mono label font falls back to `ui-monospace`.)

**2. System** — ~22 common cross-platform families (Arial, Helvetica, Georgia, Times New Roman, Verdana, Calibri, Segoe UI, Palatino, Garamond, Impact, Courier New, …) listed in `BUNDLED_FONTS` with `family` as a **fallback stack** (e.g. `'"Helvetica Neue", Helvetica, Arial, sans-serif'`) and `bundled: false`. They resolve from the OS — no files shipped.

`src/main/fonts.js` exports `BUNDLED_FONTS` (`[{family, label, category, bundled?}]`, category ∈ sans-serif/serif/display/monospace) and `DEFAULT_FONT = 'Inter'`. Exposed synchronously as `window.cue.fonts.list` / `.default`.

**3. User-installed** — operators add their own `.woff2/.woff/.ttf/.otf` via **Settings → Fonts** (`FontSettings.jsx`). Files copy into `userData/fonts/<uuid>.<ext>`, metadata into the `user_fonts` settings key; `db/fonts.js` derives the family name from the filename. They are **served through the `cue-media://` protocol** (font MIME types added to `MEDIA_MIME`) and registered as `@font-face` rules (`buildUserFontCss()`) injected into **both** the operator document (`injectUserFontFaces()` in `renderer/utils/fonts.js`, on app start + after import) **and every output window** (`output-preload.js` on load) — so a custom family looks identical in the editor preview and on screen/NDI. Included in backups (paths rewritten on restore); wiped by factory reset. Appear under "My Fonts" (category `custom`) in the picker.

The editors consume the merged bundled+user list via the `useFonts()` hook.

**To add a built-in font:** drop `.woff2` into `src/fonts/`, add `@font-face` to `fonts.css`, add an entry to `BUNDLED_FONTS`.

---
