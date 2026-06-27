## 21. Presentations & PowerPoint Import

A **Presentations** content type — a PowerPoint-style multi-element slide editor (`PresentationEditor.jsx`) whose decks live in the Library (LibraryPanel "Presentations" tab) and drop into the rundown as `item_type='presentation'` service items, inheriting **every** existing control (GO/NEXT/PREV/SELECT, keyboard, auto-advance, network remote, operator monitors, screen + NDI output). No new transport or remote wiring was needed — `getSlides`/`buildPayload`/`slidesForRemote` in `OperatorView` gained a `'presentation'` branch and everything else flows generically.

### Element model (`elements_json`)
Each slide is an array of elements positioned in **percent of the 1920×1080 canvas** (same convention as `textBox`):
```js
{ id, type:'text'|'image'|'shape',
  x, y, w, h, rotation, z, opacity,
  // text:  text, style   (style = §8 song-section style shape, incl. runs)
  // image: mediaId, fit:'cover'|'contain'   // store the ID, not a path (portable); resolved to path on read
  // shape: shape:'rect'|'ellipse'|'line', fill, stroke:{color,width}, radius }
```
The same array is rendered by **four** parallel renderers (the established React-vs-plain-DOM duplication pattern): `fullscreen.js` `renderElements` (live output, scaled `#slide-elements`), `PreviewLivePanel` `PresentationCanvas` (operator monitor), `PresentationEditor`'s own canvas (drag/resize editing), and `components/SlideElements.jsx` `StaticSlide` (read-only previews — the theme galleries + the `ThemeSettings` presentation card). All render into a fixed 1920×1080 box scaled by a CSS transform, so px font sizes are WYSIWYG across editor → monitor → output. Per-slide background resolution: slot `background_override` → slide `background_id` → `global_bg_slide_id` → black.

### Presentation themes (token model)
A presentation theme is a **layout-agnostic visual style** — tokens only (`style_json = { kind:'pres-theme', …tokens }`: `bg` CSS gradient/solid, `scrim?`, `display`/`body`/`quoteFont` font families, `title`/`sub`/`bodyColor`/`accent`/`accentText`/`kicker` colours, `titleUpper`/`sectionUpper`/`serif` flags). A **layout** is a theme-agnostic structural recipe (which text roles appear and where). `utils/presentationThemes.js` is pure data (no React) shared by the editor and `ThemeSettings`:
- `buildThemeSlide(tokens, layoutId)` composes a slide's elements for a theme × layout — bakes `bg` as a full-bleed gradient/solid shape (slides store only a media-FK background, so the theme background rides as an element), optional scrim, then each role's text styled from tokens. Every composed element is tagged with its `role`.
- `PRES_LAYOUTS` — the structural recipes (title, title-sub, section, statement, quote, scripture, two-column, blank, …). `PLAIN_THEME` = "No theme" (no baked background — the slide's own/global background shows through).
- `reskinSlide(tokens, elements)` re-skins existing slides by role tag (swap background, recolour accents, restyle role text) while preserving content/positions — drives `ApplyThemeModal` (this-slide / whole-deck).
- `detectThemeId(elements, themes)` best-effort identifies which theme a slide was built from (matches baked `bg` fill + accent + font against token sets); the `PresentationEditor` new-slide modal uses it to default the picker to the deck's current theme so added slides stay on-theme (the rail still lets you switch).

`ThemeSettings` authors/edits these: the editor's category switcher (Songs / Scripture / Presentations) swaps between the song text-style editor and a **presentation token editor** (`PresThemeEditor`: background solid/gradient/raw-CSS, fonts, role colours, case/serif flags, live `StaticSlide` preview). Song and scripture themes share the §8 text-style shape and differ only by `category`; presentation themes save the token bag. User presentation themes are editable/duplicable (built-ins duplicable); they appear in the editor's new-slide and apply-theme pickers like the built-ins.

### PowerPoint import pipeline
PPTX fidelity is **render-to-image**: `PptxImportModal` gates on a LibreOffice check (never spawns a missing binary), then `pptx-import.convertPptxToPdf` runs `soffice --headless --convert-to pdf` (isolated `-env:UserInstallation` profile) → `pdfRaster.rasterizePdf` (pdfjs, renderer) rasterises each PDF page to a 2560px PNG → `createFromImages` persists each via `media.importBuffer` and builds a presentation whose slides each hold one full-bleed image element. The result is an ordinary native presentation, so all controls work. Key constraints:
- **A `.pdf` is imported directly** (no LibreOffice, no font substitution → pixel-perfect). Exporting a deck to PDF from PowerPoint/Keynote is the recommended high-fidelity path; PDF import is offered even when LibreOffice is absent.
- **Layout/overflow drift on `.pptx` is LibreOffice font substitution** (the deck uses fonts not installed on the conversion machine). pdfjs renders the vector PDF faithfully — fidelity is decided upstream. Fix by installing the deck's fonts or embedding fonts in the .pptx.
- **pdfjs is pinned to v4** (see §2): v5/v6 use native `Promise.try` which Electron 30's Chromium lacks. The worker must load via Vite `?worker` + `workerPort`, not a `?url` workerSrc (else a slow main-thread "fake worker").
