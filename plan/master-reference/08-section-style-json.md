## 8. Section Style JSON

`song_sections.style_json` is a nullable TEXT column. `null` means "use output channel defaults." When populated it is a serialised JSON object:

```json
{
  "align":         "center",   // "left" | "center" | "right"
  "bold":          false,
  "italic":        false,
  "underline":     false,
  "uppercase":     false,
  "fontFamily":    null,       // CSS family string matching fonts.css, or null for default
  "fontSize":      null,       // number (px) or null
  "color":         null,       // hex string or null
  "lineSpacing":   null,       // CSS line-height multiplier or null
  "letterSpacing": null,       // em value or null
  "verticalAlign": null,       // "top" | "center" | "bottom" or null (fullscreen only)
  "textShadow":    null,       // { enabled, x, y, blur, color } or null
  "textStroke":    null,       // { enabled, width, color } or null
  "textBox":       null,       // { x, y, w, h } percent of 1920×1080 canvas (fullscreen only)
  "ltBar":         null,       // { color, opacity, solid, css? } — lower-third bar; null = transparent
  "bgCss":         null,       // CSS background string (gradient/solid) — theme background with no media asset (§9)
  "bgScrim":       null,       // 0..1 black overlay opacity between background and text (legibility); null/0 = off
  "bgRef":         null,       // media-library manifest item id — a media theme's background, resolved lazily on apply (§9)
  "bgThumb":       null,       // hotlinked poster URL — PREVIEW-ONLY (theme cards/SlidePreview), never written to a section
  "bgSpeed":       null,       // background <video>.playbackRate (0.1–2, default 1×); NOT the transport clock (§9)
  "treatment":     null,       // coordinated legibility/grade stack (§9): { scrim, scrimStrength, vignette, grain, tint:{color,amount,blend}, glass:{enabled,blur,radius,pad,tint,opacity}, kenBurns }
  "accent":        null,       // { enabled, color } — the theme's accent rule (section labels, LT accent bar)
  "lt":            null,       // lower-third role OVERRIDES (§13) — any of {fontFamily,color,uppercase,align,bold,italic,letterSpacing,lineSpacing,textShadow,textStroke,fontSize} overrides the fullscreen value; plus form/anchor/anim/maxLines. Absent field = inherit fullscreen
  "collection":    null,       // tag marking a flagship Collection theme (leads the gallery via themeKind)
  "maxLines":      undefined,  // number>0 — theme's per-section auto-pagination cap (§16); absent/0 = unlimited
  "runs":          []          // [{start, end, bold, italic, underline, color, fontFamily, fontSize}]
}
```

`null` on any property means "use template defaults." `textBox` and `verticalAlign` apply only to fullscreen channels. `ltBar` applies only to lower-third channels (`null` = transparent background, no bar); a built-in theme may set `ltBar.css` (a gradient/solid string) which wins over the computed rgba fade. `SongEditor.jsx` calls `serializeStyle()` to convert to JSON; saves `null` when all values are default (`styleIsDefault` also counts `bgCss`/`bgScrim`).

**Theme-pack additions** (`bgCss`, `bgScrim`, `bgRef`, and the v34 `treatment`/`bgSpeed`/`accent`/`lt`/`collection`) ride inside `style_json` rather than new DB columns. Under the v34 cascade a theme's style is resolved **live** (`mergeSlideStyle`, §9) rather than baked. `bgThumb` exists only in preview props. Scripture themes additionally carry a top-level `refStyle` object (the reference-line style), applied to `scripture_ref_style_json` on theme load — it is not a section style key.

**Lower-third role overrides.** `style.lt` holds per-field overrides for the lower-third surface (§13). `resolveLtStyle(style)` applies `LT_OVERRIDE_KEYS` from `style.lt` onto the fullscreen style — exported from `SongEditor.jsx` (used by `PreviewLivePanel`) and **mirrored verbatim** in `output/lowerthird.js` (which can't import from the renderer). `style.lt.form` (`band`/`box`/`pill`/`none`), `.anchor` (`bottom`/`top`/`center`) and `.anim` (`fade`/`slide-up`/`slide-left`/`slide-down`) are lower-third-only and applied in the output template.

`renderWithRuns(text, runs)` is exported from `SongEditor.jsx` and used in `PreviewLivePanel.jsx` to render text with run-level styling in the monitor frame. Output templates have an equivalent inline copy. Runs support `underline`.

**Max-lines auto-pagination (schema v33).** `style_json.maxLines` (this file), `songs.max_lines` (per-song, DB column), and the `song_max_lines` global setting form a most-specific-wins cascade — see §16 for the full pagination mechanics and the cascade order.

**Variable-size section splitting.** A single section can render as multiple display slides while staying **one logical section** in `song_sections`. The split point is an inline `⁂` (U+2042) marker in `content` — symbol-only, so it is invisible to `songs_fts` (unicode61 tokenizer) and the lyric matchers (`db/songs.js` `_norm`, paste-list, future song detection), and needs **no schema change**. `utils/sectionLabels.js` owns the logic: `splitSectionContent(content)` → parts, `expandSongSections(sections)` → the flat slide list `getSlides()` returns for songs (one slide per part; labels are computed at the section level so all parts share "Verse 1", with `_partIndex`/`_partCount` for the operator's "1/2" chip). The editor stores the canonical glyph but renders it as a styled non-editable divider; the EW importer turns a verse's blank-line-separated slides into `⁂` markers (§4 `songs-import.js`).

---
