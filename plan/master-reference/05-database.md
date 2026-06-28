## 5. Database

**Engine:** `better-sqlite3` (synchronous — no Promises, no async).
**Location:**
- macOS: `~/Library/Application Support/Cue/cue.db`
- Windows: `%APPDATA%\Cue\cue.db`

**Media files** are copied to `userData/media/<uuid>.<ext>` on import. Original paths are not retained.

### Migration system

`schema.js` creates `db_version` table (single integer row) on first run and applies pending migrations in order inside a transaction. **Never delete `db_version`** — it is required to exist before any user-facing build. Current version: **28**. Migrations run with foreign keys disabled, so table-rebuild migrations (v6, v7, v11, v16, v20, v21, v23) do not cascade-delete referencing rows.

| Version | Change |
|---|---|
| v1 | Initial schema — all core tables |
| v2 | Added `style_json` to `song_sections`, expanded type CHECK to include `refrain` |
| v3 | Rebuilt `songs_fts` as plain contentless FTS5 (removed `contentless_delete=1` incompatible with Electron 30's SQLite 3.49) |
| v4 | Added `channel_monitors` table — separates channels (content streams) from physical screen assignments |
| v5 | Added 5 query-plan indices: `song_sections(song_id)`, `service_items(service_id)`, `taggables(entity_type, entity_id)`, `channel_monitors(channel_id)`, `media_assets(folder_id)` |
| v6 | Rebuilt `output_channels` to add `'stage'` to the `template` CHECK (stage / confidence display) |
| v7 | Scripture module: added `bible_versions`, `bible_verses` (+ `bible_verses_fts`); rebuilt `service_items` to add `'scripture'` to the `item_type` CHECK |
| v8 | Added `service_items.media_loop` (INTEGER, default 0) — per-item looping flag for video/audio |
| v9 | Added `output_channels.ndi_audio_muted` (INTEGER, default 1) — per-NDI-channel audio mute |
| v10 | Created `graphics` table (broadcast graphics: `lower_third`, `ticker`) |
| v11 | Rebuilt `graphics` to add the `custom` kind + `html` column (table-rebuild — CHECK can't be altered in place) |
| v12 | Added `graphics.style_json` (TEXT) + `graphics.target` (TEXT, default `'all'`) — per-graphic appearance + saved destination |
| v13 | Added `output_channels.show_program` (INTEGER, default 1) — lower-third channel shows the song lyric band |
| v14 | Added `output_channels.show_graphics` (INTEGER, default 1) — lower-third channel shows the broadcast-graphics overlay |
| v15 | Created `themes` table (theme / template library: named `style_json` + optional `background_id`) |
| v16 | Rebuilt `graphics` to add the `countdown` kind (table-rebuild — CHECK can't be altered in place) — self-ticking countdown/count-up/clock |
| v17 | Added `service_items.advance_seconds` (INTEGER) — per-item auto-advance interval |
| v18 | Added `service_items.advance_loop` (TEXT) — `'rundown'` (default) vs `'item'` at the item's last slide |
| v19 | Added `service_items.advance_wrap` (INTEGER, default 1) — rundown mode: wrap to first item at the end vs stop |
| v20 | Presentations: created `presentations`, `presentation_slides`, `presentation_templates`; rebuilt `service_items` to add `'presentation'` to the `item_type` CHECK (v7-pattern table rebuild) |
| v21 | Native YouTube player: rebuilt `service_items` to add `'youtube'` to the `item_type` CHECK (v7-pattern table rebuild). A YouTube cue stores its URL in `content`, `ref_id` NULL — the downloaded file is ephemeral (never `media_assets`); see §6 *Native YouTube player* |
| v22 | Theme packs: added `themes.builtin` (INTEGER, default 0 — seeded built-ins, protected from edit/delete, re-seedable), `themes.category` (TEXT, default `'song'` — `'song'`/`'scripture'`/`'graphic'`/`'presentation'`, pickers filter on it), `themes.sort_order` (INTEGER, default 0 — display order within a category). A built-in's CSS gradient/solid background rides inside `style_json.bgCss` (§8/§9), not a new column |
| v23 | Repaired `songs_fts`: rebuilt as `contentless_delete=1` and replaced the three triggers so the delete idiom is `DELETE FROM songs_fts WHERE rowid=?`. The old triggers issued the FTS5 `'delete'` command with empty-string values, orphaning tokens until a `MATCH`-in-a-JOIN threw "database disk image is malformed" and song search returned nothing |
| v24 | Scenes (one-press multi-output state recall): created `scenes` table. A scene is a declarative snapshot of the service-independent output layers — broadcast-graphics overlay + program action + program audio — applied atomically by `outputManager.applyScene` (§13). No media-asset FKs (overlay snapshots hold resolved style objects, not media ids), so no `media.findUnused()` entry and backup-safe with no path rewriting |
| v25 | Per-song background lock: added `songs.background_locked` (INTEGER NOT NULL DEFAULT 0). Top of the background resolution cascade (§9) — a locked song's `default_background_id` is pinned above the per-slot override and the live global default, and the bulk apply actions skip it. A protect+pin flag, not a media reference, so no `media.findUnused()` entry |
| v26 | Apostrophe-insensitive song search: `songs_fts` triggers and a one-time reindex now **strip** apostrophes (straight `'`, curly `' '`, modifier `ʼ`, by `char()` codepoint) from `title`/`author`/`content` as they enter the index. The default unicode61 tokenizer otherwise splits an apostrophe, indexing `God's` as `god`+`s` so a query for `Gods` never matched. The query side strips the same set (`db/songs.js` `search()` + `_norm`), so both collapse `God's` → `gods`. No schema columns change — triggers + index content only |
| v27 | Customisable WYSIWYG stage display: added `output_channels.stage_layout_json` (TEXT). A stage/confidence channel's layout is now a free-form set of absolutely-positioned elements (currentText / nextText / clock / timer / elapsedTimer / videoCountdown / message / staticText), each in % of 1920×1080. `NULL` → the built-in default layout reproduced in both `manager.js` and `stage.js`. Reusable named layouts live in the `stage_presets` setting (plain ALTER — no table rebuild) |
| v28 | Background media on broadcast graphics: added `graphics.background_media_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL`. An optional full-screen video/image rendered behind the overlay text (e.g. countdown + video loop behind the clock). `NULL` = no background (overlay transparent as before). `ON DELETE SET NULL` means deleting a media asset clears the reference without removing the graphic. `graphics.list()` and `graphics.get()` JOIN to `media_assets` to expose `background_path`/`background_filename`. Also adds countdown `onEnd` action field (in `style_json`): `'hold'`\|`'clear'`\|`'overflow'`\|`'loop'`\|`'media'` (see graphics table below). |

### All tables

#### `songs`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
title TEXT NOT NULL
author TEXT
copyright TEXT
default_background_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
background_locked INTEGER NOT NULL DEFAULT 0   -- v25: pin this song's bg at the top of the resolution cascade
created_at DATETIME DEFAULT (datetime('now'))
updated_at DATETIME DEFAULT (datetime('now'))
```

#### `song_sections` (v2 — has style_json)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE
type TEXT NOT NULL CHECK(type IN ('verse','chorus','refrain','bridge','pre-chorus','tag','intro','outro'))
order_index INTEGER NOT NULL
content TEXT NOT NULL          -- Plain text. \n for line breaks. An inline ⁂ (U+2042) marker splits the
                              --   section into variable-size display parts (see §8). Symbol-only, so it is
                              --   invisible to songs_fts (unicode61) and the lyric matchers.
style_json TEXT                -- Nullable JSON. See §8.
```

#### `songs_fts` (FTS5 virtual table)
Mirrors `title`, `author`, `content` from `song_sections`. Indexed by `song_sections.id` (rowid). Three triggers on `song_sections` keep it in sync: `songs_fts_insert`, `songs_fts_update`, `songs_fts_delete`. Since v26 every write path **strips apostrophes** before indexing — the triggers, the v26 reindex, and the manual re-sync in `songs.update()` (title/author-only edits) — so the index is apostrophe-insensitive (`God's` → `gods`). Any new code that writes into `songs_fts` must strip the same set or it reintroduces split tokens.

#### `tags`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT UNIQUE NOT NULL
colour TEXT    -- hex string e.g. '#ff0000'
```

#### `taggables` (polymorphic pivot)
```sql
tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
entity_type TEXT NOT NULL      -- 'song' (media tagging not yet wired in UI)
entity_id INTEGER NOT NULL
UNIQUE(tag_id, entity_type, entity_id)
```

#### `media_folders`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
parent_id INTEGER REFERENCES media_folders(id) ON DELETE CASCADE
```

#### `media_assets`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
filename TEXT NOT NULL         -- original filename for display
path TEXT NOT NULL UNIQUE      -- absolute path inside userData/media/
type TEXT NOT NULL CHECK(type IN ('image','video','audio'))
folder_id INTEGER REFERENCES media_folders(id) ON DELETE SET NULL
duration_ms INTEGER            -- not populated by import, reserved
created_at DATETIME DEFAULT (datetime('now'))
```

#### `services`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
title TEXT NOT NULL
date DATE
notes TEXT
```

#### `service_items`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE
item_type TEXT NOT NULL CHECK(item_type IN ('song','media','slide','scripture','presentation','youtube'))  -- 'scripture' v7, 'presentation' v20, 'youtube' v21
ref_id INTEGER               -- song id, media_asset id, or null for custom slides / youtube
order_index INTEGER NOT NULL
notes TEXT
content TEXT                 -- for item_type='slide': JSON {text, ...} or plain text; for 'youtube': the URL (file is ephemeral, see §6)
background_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
media_loop INTEGER NOT NULL DEFAULT 0   -- v8: loop this media item's video/audio
advance_seconds INTEGER                 -- v17: auto-advance interval; NULL = manual
advance_loop TEXT                        -- v18: 'rundown' (default) | 'item' — what to do at the item's last slide
advance_wrap INTEGER NOT NULL DEFAULT 1  -- v19: rundown mode — wrap to first item at the end (1) vs stop (0)
```

**Auto-advance / timed loops** (v17–v19): when an item is live and `advance_seconds` is set, `OperatorView` schedules a single timer per live slide that fires `handleAutoAdvance`. `advance_loop='item'` rotates the item's own slides forever (bouncing back to slide 0; single-slide items just re-fire to restart media/countdown timers). `advance_loop='rundown'` (default) steps into the next rundown item, and at the very end either wraps to the first item (`advance_wrap=1`) or stops on the last slide (`advance_wrap=0`). Scheduling lives entirely in the renderer — the main process never resolves the next slide.

#### `bible_versions` / `bible_verses` (v7 — scripture module)
```sql
-- bible_versions: id, name, abbrev, language, created_at
-- bible_verses:   id, version_id→bible_versions(ON DELETE CASCADE),
--                 book_num, book_name, chapter, verse, text
-- bible_verses_fts: contentless FTS5 over (book_name, text)
```

#### `output_channels`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
type TEXT NOT NULL CHECK(type IN ('screen','ndi'))
display_index INTEGER          -- legacy, not used for matching
display_bounds TEXT            -- legacy; physical screens now live in channel_monitors
linked_channel_id INTEGER REFERENCES output_channels(id) ON DELETE SET NULL
template TEXT NOT NULL DEFAULT 'fullscreen' CHECK(template IN ('fullscreen','lowerthird','stage'))  -- 'stage' added v6
ndi_fps INTEGER DEFAULT 30
ndi_width INTEGER DEFAULT 1920
ndi_height INTEGER DEFAULT 1080
logo_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
ndi_audio_muted INTEGER NOT NULL DEFAULT 1   -- v9: per-NDI-channel audio mute (1 = muted)
show_program INTEGER NOT NULL DEFAULT 1      -- v13: lower-third shows the song lyric band
show_graphics INTEGER NOT NULL DEFAULT 1     -- v14: lower-third shows the broadcast-graphics overlay
stage_layout_json TEXT                       -- v27: per-channel WYSIWYG stage element layout (NULL → built-in default)
active INTEGER NOT NULL DEFAULT 1
```

**Lower-third content modes** (`show_program` × `show_graphics`): both=1/1 (Lyrics + Graphics), 1/0 (Lyrics Only), 0/1 (Graphics Only). Flipping these two flags is a **runtime** change — `setChannelContentMode` messages the existing window via `content:mode` rather than recreating it, so the NDI sender is never dropped. Structural changes (template/type/monitors/active) still rebuild the window via `syncChannel`. The flags reach the window as `?program=` / `?graphics=` query params on first load and as `content:mode` events thereafter.

#### `graphics` (v10–v12, v16, v28 — broadcast graphics)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
kind TEXT NOT NULL CHECK(kind IN ('lower_third','ticker','custom','countdown'))
label TEXT
name TEXT                      -- lower_third / custom substitution
title TEXT                     -- lower_third / custom substitution
text TEXT                      -- ticker text / custom {{text}}
html TEXT                      -- custom kind: HTML + inline <style> with {{placeholders}}
speed INTEGER NOT NULL DEFAULT 100   -- ticker crawl speed (px/s)
style_json TEXT                -- v12: per-graphic appearance (see below)
target TEXT NOT NULL DEFAULT 'all'   -- v12: saved default destination ('all'|'screen'|'ndi')
background_media_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL  -- v28: optional full-screen bg media
order_index INTEGER NOT NULL DEFAULT 0
created_at DATETIME, updated_at DATETIME
```

`list()` and `get()` JOIN to `media_assets` and expose `background_path`/`background_filename` alongside the `graphics` columns. `media.findUnused()` includes both `graphics.background_media_id` (FK column) and `style_json.onEndMediaId` (countdown only — scanned from JSON, no FK).

`style_json` shape — **lower_third**: `{ name: <style incl. textBox + ltBar>, title: <style>, bgFit?:'cover'|'contain' }` (the `name` style's `textBox` is the draggable/resizable position box, `ltBar` is the bar background). **ticker**: a flat style + `{ bar:{color,opacity}|null, position:'bottom'|'top', bgFit? }`. **custom**: `null` (raw HTML), or `{ autoDismissSec?, bgFit? }`. lower_third and ticker also carry an optional top-level `autoDismissSec` (>0 = self-hide N seconds after airing; §13). **countdown** (v16+v28): `{ mode:'countdown'|'countup'|'clock', source:'duration'|'target', durationSec, targetClock:'HH:MM', format:'24h'|'12h', showSeconds, endMessage, onEnd:'hold'|'clear'|'overflow'|'loop'|'media', onEndMediaId:<media_assets.id>|null, time:<style incl. textBox + ltBar>, message:<style>, bgFit? }` — the `text` column holds the optional label ("Service starts in"). `onEnd` actions: `hold` = freeze display at 0:00; `clear` = hide the graphic; `overflow` = keep ticking past zero with a `+` prefix; `loop` = restart from the same authoring spec; `media` = transition to a fullscreen clip (`onEndMediaId`). Main arms a `cdEndTimer` per `countdownShow` for `clear`/`loop`/`media` actions (`hold`/`overflow` are template-only and need no main-process side-effect).

#### `scenes` (v24 — one-press multi-output state recall)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
hotkey TEXT                    -- '1'..'9' for number-key recall in OperatorView (unique: binding frees it elsewhere), or NULL
program TEXT NOT NULL DEFAULT 'none'  -- program-layer action: 'none'|'content'|'clear'|'logo'
audio_muted INTEGER            -- program audio: NULL = don't touch, 0 = unmute, 1 = mute
overlay_json TEXT              -- broadcast-graphics overlay snapshot {nameTitle,ticker,custom,countdown}, each {screen,ndi}; NULL = overlay not managed
order_index INTEGER NOT NULL DEFAULT 0
created_at DATETIME, updated_at DATETIME
```

A scene is a declarative snapshot of the **service-independent** output layers (never a rundown-slide reference, so scenes survive weekly service changes). The authoring flow is **capture, not hand-build**: the operator sets the live output up, then `ScenesPanel`'s editor reads `output.getState()` (`overlay`, `displayMode`, `transport.muted`) and freezes it. Recall is atomic via `outputManager.applyScene` (§13) — number key 1–9 in `OperatorView`, or the panel's Take. `overlay_json` slots hold self-contained re-fire data (the same objects the `*Show` functions accept), so recall needs no saved-graphic lookup and survives graphic deletion; an all-empty snapshot is a "hide all graphics" scene. `db/scenes.js` `normalizeScene(row|liveObj)` → `{ overlay, program, audioMuted }` is the apply boundary (parses `overlay_json`).

#### `themes` (v15 — theme / template library; v22 — theme packs)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
name TEXT NOT NULL
style_json TEXT                -- a section style snapshot (same shape as §8; no runs; may carry bgCss/bgScrim/bgRef)
background_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
builtin INTEGER NOT NULL DEFAULT 0       -- v22: 1 = seeded built-in (read-only in UI, re-seedable)
category TEXT NOT NULL DEFAULT 'song'    -- v22: 'song'|'scripture'|'graphic'|'presentation'
sort_order INTEGER NOT NULL DEFAULT 0    -- v22: display order within a category
created_at DATETIME, updated_at DATETIME
```

A theme is a saved section `style_json` (§8 shape) plus an optional default background. Applying a theme merges its `style_json` into every target `song_sections.style_json` (per-section inline `runs` are preserved) and, when it has a background and the background is being applied, writes `songs.default_background_id` and NULLs the relevant `service_items.background_override_id` so the theme background wins over any per-slot override. Apply scope: `applyToSong` (all slots referencing one song), `applyToRundown` (all song slots in a rundown), `applyToAllSongs` (every song slot). The output path is unchanged — themes only write the same columns the editors already write.

**Bundled built-in themes (v22 packs):** `seedBundledThemes()` (called at startup, after the bible/GHS seeders) imports `resources/themes/*.json` — each file is `{ name, category, sort_order, style:{…§8 style, incl. bgCss/bgRef…} }`, authored by `scripts/build-*.mjs`. Seeding is tracked **by theme NAME** in the `seeded_theme_keys` settings array (migrating the legacy `themes_seeded` flag), so a later release can add new built-ins on upgrade without resurrecting ones the user deleted. It also **UPSERTs**: when a bundled theme's `style_json` differs from the DB copy it updates it (built-ins are read-only, so the bundle is source of truth), and if a media theme's `bgRef` changed it resets `background_id=NULL` so the new background re-resolves on next apply. Built-in backgrounds: gradient/solid via `style_json.bgCss`, or a media-library `style_json.bgRef` resolved lazily (§9). Categories drive the pickers (`ThemePickerModal`, `ThemeSettings` tabs); `applyTo*` is song-only — non-song categories are loaded by their own editors. **Custom themes** are authored in `ThemeSettings` for any of song / scripture / presentation: `+ New Theme` seeds the editor with the active category tab, and an in-editor switcher retargets it (song↔scripture share the §8 text-style editor; presentation swaps in the token editor — §21). `themes.create`/`themes.update` both accept `category` (update leaves it untouched when omitted, for legacy callers).

#### `presentations` / `presentation_slides` / `presentation_templates` (v20)
```sql
-- presentations:  id, title, created_at, updated_at
-- presentation_slides:  id, presentation_id→presentations(ON DELETE CASCADE), order_index,
--                       label, background_id→media_assets(ON DELETE SET NULL), elements_json, notes
-- presentation_templates:  id, name, background_id→media_assets(ON DELETE SET NULL), elements_json, created_at, updated_at
```

A presentation is an ordered list of slides; each slide's `elements_json` is an array of positioned elements on the 1920×1080 canvas (see §21 for the element shape). Templates are reusable saved slide layouts. **Image elements store a `mediaId`, never a path** — paths are resolved on read (`db/presentations.js`), so `elements_json` carries nothing machine-specific (backup/restore-safe). Because those ids live inside `elements_json` (not an FK column), `media.findUnused()` parses every slide/template `elements_json` to collect them, plus `presentation_slides.background_id` and `presentation_templates.background_id`. A presentation deck drops into the rundown as an `item_type='presentation'` service item and inherits every existing control.

#### `channel_monitors` (v4)
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT
channel_id INTEGER NOT NULL REFERENCES output_channels(id) ON DELETE CASCADE
display_bounds TEXT NOT NULL   -- JSON {"x":0,"y":0,"width":1920,"height":1080}
label TEXT
active INTEGER NOT NULL DEFAULT 1
```

One row per physical screen assigned to a channel. Multiple monitors can share a channel — all receive the same `slide:update` and display identical content simultaneously. Screen channels no longer store `display_bounds` on the channel row itself; `channel_monitors` is the source of truth. NDI channels have no `channel_monitors` rows.

#### `settings`
```sql
key TEXT PRIMARY KEY
value TEXT NOT NULL            -- JSON-encoded. e.g. 42, "string", null
```

Known keys:
| Key | Type | Description |
|---|---|---|
| `global_logo_id` | number\|null | Media asset ID for global logo |
| `global_bg_song_id` | number\|null | Global default background for songs |
| `global_bg_scripture_id` | number\|null | Global default background for scripture |
| `global_bg_slide_id` | number\|null | Global default background for slides |
| `scripture_style_json` | object\|null | Global style_json applied to every scripture verse; `null` = template defaults |
| `scripture_ref_style_json` | object\|null | Global style_json for the scripture reference line; optional `pos:{x,y}` free-positions it; `null` = default right-aligned bottom |
| `lowerthird_font_scale` | number | Global lower-third font scale, percent (1–150, default 100). Lower-third font size = `(authored size or 72) × pct/100`; rides every content payload as `ltFontScale` (a fraction). Set via Settings → Lower Third / `output.lowerthird.setFontScale`. Fullscreen unaffected |
| `operator_preview_layout` | 'stacked'\|'sidebyside' | Unused in current UI — reserved |
| `youtube_cookies_browser` | string\|null | Opt-in: browser to read YouTube cookies from for the download cascade's cookies tier (`chrome`/`edge`/`firefox`/`brave`/`safari`); `null`/absent = off. Set from the Add-YouTube modal's "Use my browser's YouTube login" control |
| `keyboard_modifier` | 'meta'\|'ctrl'\|'alt' | Modifier key for transport shortcuts (default: 'meta' on macOS, 'ctrl' on Windows) |
| `keyboard_go` | string | Key char for GO shortcut (default: 'g') |
| `keyboard_clear` | string | Key char for Clear shortcut (default: 'c') |
| `keyboard_logo` | string | Key char for Logo shortcut (default: 'l') |
| `keyboard_live` | string | Key char for Live Toggle shortcut (default: 'o') |
| `shortcut_arm_bare` | boolean | Whether the bare `G`/`Esc` keys are armed (single-press fires). Default true; disarmed → those bare keys are ignored (modifier shortcuts unaffected) |
| `shortcut_arm_jump` | boolean | Whether the positional verse/slide-jump keys (`Q W E …` → air slide N of the live item) are armed. Default false |
| `topbar_tabs` | array | Operator-pinned extra top-bar tabs (ordered `settings:<section>` deep-link ids), capped at 6. Drives the customisable nav in `App.jsx`/`TopBarTabs.jsx` |
| `ghs_seeded` | boolean | Set true after the bundled GHS hymnal is imported on first run; gates re-seeding so deletions stick |
| `seeded_theme_keys` | array | Names of built-in themes already seeded (`seedBundledThemes`); lets new built-ins add on upgrade without resurrecting user-deleted ones. Supersedes the legacy boolean `themes_seeded` |
| `themes_seeded` | boolean | Legacy all-or-nothing seed flag; migrated into `seeded_theme_keys` on first v22+ run |
| `bg_library_downloads` | object | Map `{ manifestItemId: media_assets.id }` of backgrounds downloaded on demand from the bundled `media-manifest.json` (Background Library). Treated as referenced by `media.findUnused()` so a download isn't reaped before use |
| `remote_enabled` | boolean | Network control server on/off (default false) |
| `remote_port` | number | Server TCP port (default 7373) |
| `remote_lan` | boolean | Bind all interfaces (LAN) vs 127.0.0.1 only (default false) |
| `remote_token` | string | Pairing token; minted on first enable, regenerable |
| `remote_output_enabled` | boolean | Remote Output (view-only program mirror) surface on/off (default false). Independent of `remote_enabled` — shares the same server/port/LAN binding |
| `remote_view_token` | string | Separate secret gating `/output` (page stream + media). Minted on first output-enable, regenerable independently of the control token so a leaked view link can't drive the service |
| `user_fonts` | array | User-installed fonts: `[{id, family, label, filename, path, ext}]`. Files live in `userData/fonts/`; served via cue-media://. Included in backups (paths rewritten on restore), wiped by factory reset |
| `libreoffice_path` | string\|null | User-set absolute path to the `soffice` binary (Locate manually…), tried first by `findLibreOffice()` for PowerPoint import |
| `program_audio_device` | object\|null | In-room program-audio output device `{deviceId,label,groupId}`; `null` = system default. The audible (primary) output window routes its media element there via `setSinkId`, matching deviceId→label→groupId (device IDs are salted per-origin). Machine-specific (rides backups but degrades to default if the device is absent) |
| `stream_config` | object | RTMP stream settings `{server,key,width,height,fps,videoBitrate,audioBitrate}`. `server`+`key` form the ingest URL; `key` is sensitive (lives in the synced DB) |
| `stream_studio` | object | Stream Studio inputs + live layout `{videoDeviceId,videoLabel,audioDeviceId,audioLabel,audioMode:'external'\|'mixed',layout}` where `layout` is the free-form box model `{feed:{visible,x,y,w,h,fit},program:{visible,x,y,w,h,fit},front,lyricsOverFeed}`. Device labels persist because deviceIds re-salt per session/origin. Machine-specific |
| `stream_presets` | array | Saved stream layout presets `[{id,name,layout}]` (same `layout` shape as `stream_studio.layout`). Applied live from the Stream tab; edited in StreamLayoutEditor |
| `stage_presets` | array | Saved stage display layout presets `[{id,name,elements:[…]}]`. Each `elements` array is the same free-form element spec as `stage_layout_json` (% positions + per-type props). CRUD via `output.stage.getPresets/savePreset/deletePreset`. |
| `bg_loop_mode` | `'blend'`\|`'jump'` | How background videos loop at the loop point. `'blend'` (default) crossfades end→start using two `<video>` elements; `'jump'` uses native `loop` for an immediate cut. Sent as `bgLoopMode` on every `slide:update` payload; `fullscreen.js` reads it on each update and re-mounts the video when the mode changes |
| `bg_loop_blend_secs` | number | Crossfade duration for `blend` mode (0.5–10, default 2.0). Sent as `bgLoopBlendSecs` on every `slide:update` payload; clamped in main before dispatch |

**localStorage keys** (UI state only — not in DB):
| Key | Description |
|---|---|
| `layout_h_pct` | Horizontal split: Rundown panel width as % (default 25) |
| `layout_v_pct` | Vertical split: top panels height as % (default 62) |

#### `db_version`
```sql
version INTEGER NOT NULL       -- current: 28
```

---
