## 22. Sermon → Slides Import

Turns a sermon document (PDF / `.docx` / `.txt` / `.md`) into an ordinary native presentation (§21) — a title slide, a divider per main point, and one content slide per sub-point — so it inherits every existing control. Entry: **`SermonImportModal.jsx`** → `presentations.sermonGenerate` IPC.

Two files, split by purpose:
- **`src/main/import/sermon-import.js`** — the **pure, offline** half: text extraction (txt/md/docx) + the structure heuristic (`buildSermonStructure`, `findScriptureRefs`). No DB, no Electron — unit-tested in plain Node (`sermon-import.test.mjs`, run `node --experimental-detect-module …`).
- **`src/main/import/sermon-build.js`** — the **DB-aware** half: takes the structure plan, lays out each slide's elements on the 1920×1080 canvas, applies the theme, and `presentations.create`s the deck.

**PDF text is extracted in the renderer** (`utils/pdfText.js`, pdfjs needs a DOM; reuses the PPTX reader's `convertPptx` just to get the bytes) and passed to `sermonGenerate` as `text`. txt/md/docx arrive as a `filePath` that main reads via `extractText` (the `.docx` reader is a hand-rolled minimal ZIP+inflate of `word/document.xml` — no new dependency).

### Two parser paths
`buildSermonStructure` picks a path up front:
- **Hierarchical** (`buildHierarchical`) — the faithful three-tier outline builder, used when **≥2 parenthesised sub-point markers** (`(i)`/`(ii)`/`(a)`) appear, **counted by LINE** (not by blank-line paragraph — PDFs don't reliably emit blank lines, so a paragraph count under-detects the shape). This is the path for DCLM / Deeper-Life "Expository & Systematic Bible Study" outlines.
- **Flat** (the rest of `buildSermonStructure`) — the generic heading-delimited heuristic for plain sermons / markdown. Unchanged; still emits `role:'scripture'` slides resolved to verse text. The hierarchical path emits **no** scripture slides.

### Hierarchical structure model (the important part)
The source shape it parses:
```
SERIES BANNER + date
THE ALL-CAPS TITLE
Main Passage (e.g. Jude 1:14-16)
<opening quote> (Ref). Intro commentary…            ← intro
1.   MAIN POINT HEADING (ALL CAPS)                   ← main point
     Jude 1:14-15                                    ← anchor passage (own line)
(i) Sub-heading – Ref; Ref; Ref. exposition…        ← sub-point
(ii) Sub-heading – Ref. exposition with "quotes" (Ref). …
…
Quotes from Pastor … / A Call to a Decision / Note:  ← footer (dropped)
```

**Segmentation is marker-driven, never blank-line-driven** (`segmentMainPoints`). This is the core fix for the original bug where every PDF-wrapped visual row became its own bullet:
- `mainMarker(line)` — a line beginning `1.`/`2)` that is either the number alone (heading wraps onto the next line) **or** followed by an ALL-CAPS-ish heading. Conservative so a numbered prose sentence ("1. We must pray.") isn't mistaken for a point.
- `SUBPOINT_RE` — `(i)`/`(ii)`/`(a)`/`(1)` markers start a sub-point.
- `FOOTER_RE` — `Quotes from`, `A Call to a Decision`, `Connect With`, `Watch the GS`, `Note:`, prayer/further-reading. Parsing **stops** at the first match.
- `isRefOnlyLine(t)` — a line that is essentially just scripture refs → the main point's **anchor passage**.

The walker is a small state machine (`mode: mainhead | preamble | sub`). Each main point collects `{num, headingLines[], anchor, preamble[], subs[]}`; everything between the anchor and the first `(i)` is the point **preamble** (commentary). Within a sub-point, **all its wrapped lines are joined into ONE blob** before sentence-splitting — that is what produces whole sentences instead of line fragments. The head region (before the first main marker) yields the title, main passage, and intro.

### Reference handling
- `BOOK_ALT` (built once) is a longest-first alternation of every book name + abbreviation. `REF_TAIL` is the numeric tail grammar — chapter, verse with optional `a`/`b` letter suffix, ranges, **and comma lists** (`Amos 3:3,7`).
- `consumeRefList(rest)` peels the leading `Ref; Ref; Ref.` list off a sub-point body one item at a time (separator is `;`); the list closes at the first non-ref token (usually glued on by `". "`). These refs feed the slide's **reference line**, not the content box.
- The slide's reference line = `dedupRefs([mainPointAnchor, ...subPointRefs])` joined with `·`.
- **Special case — a sentence that cites the verse quoted after it.** Exposition interleaves verbatim KJV quotes each followed by a bracketed ref: `commentary. "long quote…" (Ref). next commentary.` `QUOTE_THEN_REF_RE` **drops the quote text and keeps the ref**, so the ref attaches to the **preceding** commentary sentence's bullet (`… in his generation. (Jude 1:14-15a)`). A bracketed ref with no preceding bullet (e.g. a quote that opens a sub-point, or the intro's main passage) is dropped — it already lives on the reference line. Inline citations are tidied for PDF wraps (`(Jonah 3:4- 10)` → `(Jonah 3:4-10)`).

### Bullets & overflow packing
- `bodyToBullets(text)` — one bullet **per sentence** (split on `[.!?]` + a following capital/quote/paren), after quote-stripping. Punctuation-only crumbs dropped.
- `chunkBullets(bullets)` packs sentences onto content slides by **estimating rendered line count** (`ceil(len / CONTENT_CHARS_PER_LINE) + gap`) and starting a new slide before the box would spill; continuation slides repeat the heading + reference line and append `(cont.)` to the heading. Budget constants are tuned to the content box (~670px ≈ 15 lines at 34px/1.3): `CONTENT_CHARS_PER_LINE=95`, `CONTENT_LINES_PER_SLIDE=14`, `CONTENT_MAX_BULLETS=11`. Raise the line/char budget if overflow breaks too early; lower it if text clips off the bottom.

### Slide roles → layout (`sermon-build.js`)
`buildSermonStructure` returns `{ title, slides: [{ role, … }] }`. `generateSermonPresentation` maps each to canvas elements, applies the theme text style (`baseTextStyle` inherits font/colour/etc.; font size + alignment are set **per role** so a theme's 116px lyric size doesn't blow out a bullet list), and bakes the background (theme `bgCss` full-bleed shape → else media `background_id`/global default).
- `role:'title'` — large centred title + main-passage subtitle.
- `role:'point'` (divider, no bullets) — the **faithful ALL-CAPS** `N. HEADING` + anchor-ref subtitle.
- `role:'heading'` (content slide) — four optional zones, top to bottom: **subtitle** (`N. Title-Cased parent point`, via `titleCaseFromCaps`) → **heading** (`(i)` marker + sub-heading) → **caption** (the reference line) → **bullets** (left-aligned content box). The intro reuses this role with `title:'Introduction'` and no subtitle; a point preamble uses it with a subtitle but no sub-heading.
- `role:'scripture'` (flat path only) — verse text resolved from the Bible via `bible.resolvePassage`, chunked by length.

### Non-obvious constraints
- **Segment by markers, not blank lines.** pdfjs extraction (`pdfText.js` reconstructs lines from text-item `hasEOL`/y-positions) does not emit reliable blank lines between sub-points, so any blank-line-based segmentation drops back to the flat path and fragments every wrapped row into its own bullet.
- **Keep both halves pure where marked.** `sermon-import.js` must stay DB/Electron-free so the `.test.mjs` suite runs in plain Node.
- A non-breaking space normalisation (` ` → space) runs in `buildHierarchical`; don't strip it.
- The hierarchical path intentionally **drops verbatim Bible quote blocks** (they're the verse text, available via the reference line) and the trailing boiler-plate footer; it keeps only the preacher's commentary.
