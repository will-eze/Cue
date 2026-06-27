# Feature plans — Online Song Finder & Sermon → Slides

Two operator-facing "bring content in fast" tools. Both follow the existing
import pattern: **pure parse in main → preview/confirm in renderer → commit
through the normal DB layer**, so the new content inherits every rundown control.

Decisions confirmed with the user:
- Song finder: **search by title/artist**, sources = Genius + AZLyrics + any
  pasted lyrics URL (covers worship/hymn + general web), **editable preview then
  save**.
- Sermon: input = **PDF + .docx + .txt/.md**, structure via a **local heuristic
  parser** (offline), slides = **title + points + scripture**, scripture slides
  carry the **full verse text from Cue's Bible**, theme = **global default,
  changeable in the import dialog**.

---

## Feature 1 — Online Song Finder (`web scraper`)

### Flow
Songs tab → Import ▾ → **Find Song Online…** → `SongScrapeModal`:
1. Search box (title, optional artist) → `songs.scrapeSearch(query)`.
2. Candidate list (provider · title · artist · thumb). Top result auto-selected.
3. Selecting a candidate → `songs.scrapeFetch(candidate)` → cleaned lyrics parsed
   into Cue sections.
4. Editable preview (title / author / section text). **Save** → `songs.create`.
5. "Paste a lyrics URL" escape hatch → `scrapeFetch({provider:'url', url})` so any
   hymn/worship/general page can be cleaned + parsed.

### Main — `src/main/songs/song-scrape.js`
- `searchSongs(query)` → aggregates candidates.
  - **Genius**: `GET https://genius.com/api/search/multi?q=` (public JSON, no key)
    → song hits `{title, artist, url, thumb}`. Primary; also good for CCM/worship.
- `fetchLyrics(candidate)` → `{title, author, sections, copyright, source, raw}`.
  - **Genius**: scrape `<div data-lyrics-container>` → text (keeps `[Verse]`/
    `[Chorus]` headers, which `parseSections` maps to section types).
  - **AZLyrics**: build `azlyrics.com/lyrics/<artist>/<title>.html`, extract the
    unlabelled lyric div after the "Usage of azlyrics.com content" comment.
  - **url**: dispatch to the matching extractor, else a generic `<br>/<p>`→newline
    + tag-strip + longest-lyric-block heuristic.
- Cleaning: decode entities, strip Genius chrome ("Contributors", "You might also
  like", "Embed", trailing counts), collapse blank runs.
- Parsing reuses `parseLyricsToSections()` (new export wrapping the existing
  `parseSections` in `songs-import.js`) so scraped songs split exactly like file
  import / Paste Song.
- All network is **main-process `fetch` with a desktop UA** — no renderer CSP/CORS
  involvement, no new remote origin in the renderer.

### IPC / preload
`songScrape:search`, `songScrape:fetch` → `window.cue.songs.scrapeSearch/scrapeFetch`.

---

## Feature 2 — Sermon → Slides

### Flow
Presentations tab → **Sermon to Slides** → `SermonImportModal`:
1. Pick PDF / .docx / .txt / .md, optional title, theme picker (default = the
   global slide background / a clean built-in), Bible version.
2. Generate → native presentation, opens in `PresentationEditor`.

### Text extraction
- **txt/md/docx** in main (`sermon-import.js`): fs read; docx unzipped via Node
  `zlib.inflateRawSync` (parse the zip central directory → `word/document.xml` →
  `<w:p>`→newline, strip tags). No new dependency.
- **pdf** in renderer (`pdfText.js`, pdfjs `getTextContent`, mirrors `pdfRaster`),
  text passed to `sermon:generate`.

### Structure heuristic — `buildSermonStructure(text)`
- Title = user-supplied or first strong line.
- Headings: markdown `#`, numbered/roman points, short ALL-CAPS lines, trailing-`:`.
- Scripture refs detected with a regex built from `BOOKS` (+ `lookupBook` validate).
- Body grouped under headings → bullet points, chunked ~N lines/slide.
- Emits `[{role:'title'|'point'|'scripture', title, bullets, reference}]`.

### Generate — `generateSermonPresentation({text, title, themeId, versionId})`
- Resolve each scripture ref → verse text via `bible.resolvePassage`.
- Build `elements_json` per slide (title/heading text + bullet text + scripture
  text/reference) on the 1920×1080 canvas.
- Apply theme: merge theme `style_json` into each text element's `style` (override
  fontSize per role; drop `uppercase` on body/scripture). Background:
  `bgCss` → full-bleed `shape` element (fill = gradient, z below text);
  media `background_id` → set slide `background_id`; else global slide bg / black.
- `presentations.create(...)` → returns `{id, slideCount}`.

### IPC / preload
`sermon:generate` → `window.cue.presentations.sermonGenerate(payload)`.

---

## Testing
- Node unit harness over the pure functions: lyric clean + section split, docx
  unzip, sermon structure, scripture-ref detection.
- `npm run package` (or build) to confirm no bundle/syntax regressions.
- Live scrape smoke-test (Genius) where network allows.
