# Cue — UX / UI Audit & Upgrade Plan (Oct 2026)

How this audit was done: the real renderer was run headless (Chromium) against the
real main-process IPC handlers and a real SQLite DB seeded with the 260 GHS hymns,
so every finding below is from the actual app, not a mock. Parser findings were
reproduced with real pastes against that DB.

Status legend: `[x]` shipped on `claude/blissful-mccarthy-5znzee` · `[ ]` proposed · `[?]` needs your call

---

## 1. Parsing — shipped

### 1a. Lyrics → sections (Song Editor paste, file import, scraper, GHS)

- [x] **One parser.** `parseSong` (SongEditor) and `parseSections` (songs-import) had
  drifted apart. Both now call `src/shared/lyrics-parse.js` (112 unit tests).
- [x] **Singer names never reach lyrics.** All of these are headers now, with the name
  dropped: `Verse 1 — Mary`, `Mary - Verse 1`, `Mary & John: Chorus`, `(Mary) Verse 2`,
  `Verse 1 Mary`, `VERSE 1 [ADA]`, `Verse 2 (sung by Mary and the choir)`.
  Names learned from headers are also stripped as cues elsewhere (`Mary: You are here`,
  a lone `Mary` line) and are never mistaken for the song's author.
- [x] **Decorated / abbreviated / misspelt headers:** `*Verse 1*` (WhatsApp bold),
  `**CHORUS**`, `--- Chorus ---`, `V1`, `Vs. 3`, `C1`, `Second Verse`, `Verse II`,
  `Middle 8`, `Channel`, `Post-Chorus`, `Chrous:`, `[Vrese 2]`.
- [x] **Repeats become play order, not duplicate text:** `Repeat Chorus`, `Back to the
  chorus`, `Chorus again`, a bare `Chorus` header with no lyrics, or a chorus written out
  twice → one Chorus section plus an arrangement (V1 C V2 C B C). Persisted through file
  import, GHS seeding, the scraper and paste.
- [x] **Junk lines dropped:** `All`, `Men:`, `Leader:`, `(x2)`, chord-only lines,
  inline `[G]` chords, `Key: G`, `Capo 2`, `120 bpm`, SongSelect/CCLI footers (the ©
  line and CCLI number are captured into Copyright, the writers line into Author).
- [x] **Title line detection on paste** (`WAY MAKER – Sinach` above the first header).
- Regression check: all 260 GHS hymns re-parsed — 259 identical played output, 1
  *improved* (GHS 29's typo `Chrous:` now becomes a chorus instead of being glued to
  verse 1).

### 1b. Set list → library songs (Paste Song List)

Reproduced the "13 songs, only 3 found" report: a list grouped under
`PRAISE / WORSHIP / Offertory:` headings gave **3 rows for 12 songs** — the old matcher
treated every blank-line block as one song (and matched the heading itself as a song).
Same root cause turned a pasted song's `Chorus — All` / `Verse 2 — John` blocks into
separate "songs".

- [x] **Segmentation rebuilt** (`src/shared/setlist-match.js`, 52 unit tests): splits at
  line grain, then uses the library to decide — same song or a lyric continuation merges;
  a line with its own confident match splits; unknown title-shaped lines stay separate.
  Same 12-song paste → **12/12 correct**.
- [x] **Smarter title reading:** leader names (`- Mary`, `led by Kofi`), keys (`(Key: E)`,
  `[Bb]`, `key of G`), `x2`, emoji, bullets, `#6`, `Song 4:`, `by Artist`, quoted titles,
  `Opening hymn: …` prefixes, medleys (`Just obey / Blessed assurance` → 2 rows).
- [x] **New match tiers:** normalised exact title (`Blessed assurance` → `GHS 18 - Blessed
  Assurance`), hymn numbers (`GHS 47`, `Hymn 12`), any section's first line, fuzzy titles
  for typos (`Great is thy faithfulnes`). Ties between two songs are demoted to "check".
- [x] **Modal:** live "N songs detected" pane while pasting; per-row reason
  (title / hymn number / first line / lyrics / similar title); "Repeat of #N" duplicates
  start unticked; "Split into N songs"; select-all; **Create from lyrics** opens the editor
  pre-split into sections with title + play order.

### 1c. Parsing — next steps

- [x] **Learn from corrections (strongest next win).** When the operator overrides a match
  ("Imela" → *Imela (Thank You)*), store `alias → song_id`; next week it's an exact hit.
  Shipped as `song_aliases` (schema v35); corrections and ticked check-this guesses are remembered and matched first; the Song Editor lists them as "Also called" with a forget button.
- [ ] Show *which* lines were folded into a row (expandable), not just "6 lines".
- [x] **Data bug in the bundled hymnal:** GHS 7 "Turn Your Eyes Upon Jesus" contains the
  lyrics of GHS 9 "Great Is Thy Faithfulness" (byte-identical). Fixed in the JSON + `patchGhs7Lyrics` backfill (only rewrites an install still holding the wrong text).

---

## 2. Editors

- [x] **Song editor: edit in place.** Was: pick a section in a 10px list on the left,
  edit it in a 288px pane on the far right, with the big canvas in between. Now the left
  half is a lyrics document (every section, 15px), click any line to type there, Alt+↑/↓
  between sections, Split / By-stanza on the active card, play order collapsed to one
  line (`V1 · C · V2 · C · B`). Formatting + preview on the right.
- [ ] **Formatting toolbar** still uses 9–10px uppercase menus (Spacing / Effects / List /
  Box). Move to 12–13px sentence case; group into "Text", "Layout", "Effects".
- [ ] **Canvas text-box handles are always on.** Show them only when the box is selected
  (click the canvas) — at rest the preview should look like the output.
- [ ] **Presentation, Scripture and Graphics editors** share the same patterns (15/11/15
  sub-12px sizes respectively). Apply the same document-first layout where it fits
  (Scripture editor especially).

---

## 3. Operator screen

| # | Finding | Proposal |
|---|---|---|
| O1 | Two stacked chrome rows (tabs + status) use ~78px; the most important state — *is anything reaching the audience?* — is the faintest text on screen (`IDLE · NO OUTPUTS`, 11px grey uppercase). | One top bar. Output state becomes a prominent pill: green "2 outputs live", amber "Outputs off — audience sees nothing", grey "No outputs configured →". |
| O2 | The red `• LIVE` button is an outputs on/off toggle that looks like a status badge; next to GO / CLEAR / LOGO it reads as "go live". It also showed red LIVE while zero windows were open. | **[x] Kept as a button** with three unmistakable states: solid red "Outputs on · N", grey outline "Outputs off" (crossed screen), amber "No screens" (enabled but nothing open). |
| O3 | Duplicate empty states: "NOTHING IN PREVIEW" in the monitor and again in the slide strip; "NOTHING LIVE" twice. The live column's lower half is empty space until something airs. | One empty state per column; when nothing is live, show the next item's first slide ("Up next") in the live strip area. |
| O4 | GO at rest is dark-green text on green (low contrast); CLEAR/LOGO are outlined grey-red / grey-blue. | GO: white text on green, larger; CLEAR/LOGO neutral secondary buttons with their colour only on hover/active. |
| O5 | When no background resolves for an item, its rundown thumbnail is a black square with a note icon — 48px of nothing per row. | Collapse to a slim type icon when there's no background. |
| O6 | Every library row shows a "GHS" chip even when you're *in* the GHS folder or the whole library is GHS. | Hide a tag chip when it's the active filter; show at most 2 chips. |
| O7 | `HOTKEYS ON` chip has no explanation. | Tooltip + click opens the shortcuts overlay. |
| O8 | Graphics destination chips `DEFAULT / IN-ROOM / ONLINE / STREAM` — "Default" is unexplained. | Rename "Each graphic's own" (or "Auto") with a tooltip. |
| O9 | Library list sorted lexically (GHS 1, 10, 100, 101…) outside the GHS folder. | **[x] fixed** — natural sort everywhere. |

---

## 4. UI polish — why it reads "vibe-coded"

Measured across `src/renderer`:

- **637** forced-`uppercase` labels and **473** custom letter-spacings — almost every label,
  chip, empty state and button is SMALL SPACED CAPS. Caps lose word shapes, so they read
  slower and all look equally (un)important.
- **~480 hard-coded 8–11px font sizes** that bypass the type scale (worst:
  ThemeSettings 77, RundownPanel 35, App 27, SongEditor 22, OutputChannels 21).
- **50** places with text at 20–40% opacity — below comfortable contrast on the dark
  surfaces, on purpose-critical text (empty states, counts, hints).
- The type scale itself (`label-sm` 12 / `body-md` 14 / `headline-md` 20) is fine — the
  components just don't use it, and `label-sm` bakes in `0.05em` tracking that makes
  sentence-case text look spaced out.

Proposed system (one PR, then screen by screen):

**Status: first global pass shipped** — all 8–10px sizes → 11px (operator screen 11px → 12px), forced uppercase + letter-spacing removed from ~560 class strings (PREVIEW / LIVE / GO / ON AIR are literal caps and stay), `label-sm` tracking removed, faint text raised to /60. Next: replace hand-rolled buttons with two shared styles.

1. **Floor of 12px** for any text; 11px only for tabular badges.
2. **Sentence case by default.** Uppercase only for 3 things: on-air status
   (PREVIEW / LIVE), the transport buttons (GO / CLEAR), and table column headers.
3. **Contrast floor**: no `on-surface-variant` below /60 for text that carries meaning.
4. **Three text roles** instead of ad-hoc classes: `title` (14/600), `body` (14/400),
   `meta` (12/400, no tracking). Drop the tracking from `label-sm`.
5. **Two button styles** (primary filled, secondary outline, both 32–36px tall, 14px
   sentence-case labels) replacing the ~6 hand-rolled variants.
6. Fewer boxes: drop nested bordered containers where a spacing gap does the job.

The new Song Editor and Paste Song List screens are the reference for this style —
please click through those first and tell me what you like / don't before I roll it
across the operator screen and settings.

---

## 5. Decisions (answered)

1. Song aliases — yes (shipped). 2. Outputs — keep a button, clearer state (shipped).
3. Type system — go ahead (first pass shipped). 4. GHS 7 — lyrics supplied (shipped).

## 5b. Original questions

1. **Song aliases (§1c)** — OK to add the `song_aliases` table (schema v35, MAJOR bump)?
2. **Operator top bar (O1/O2)** — happy with merging the two rows and renaming LIVE to an
   explicit Outputs toggle? This is muscle memory for your operators.
3. **Type system (§4)** — after looking at the new Song Editor, go ahead with the global
   pass (sentence case + 12px floor), or adjust the direction first?
4. **GHS 7 data** — do you have the correct lyrics for "Turn Your Eyes Upon Jesus"?
