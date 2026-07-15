## 7. IPC API — `window.cue`

All renderer↔main communication is via `ipcRenderer.invoke` / `ipcMain.handle`, exposed as `window.cue.*` through the contextBridge preload.

### `window.cue.songs`

| Method | Returns | Notes |
|---|---|---|
| `search(query)` | `[{id, title, author, tags}]` | FTS5 prefix search (apostrophe-insensitive, v26). Strict AND-prefix hits first, then a lyric-tolerant **OR-recall fallback** (`_rankByOverlap`) appends phrase/coverage-ranked songs strictly below them — so a misremembered or extra word in a typed/pasted lyric line still surfaces the song. Empty/null query returns all. See §16. |
| `listAll()` | `[{id, title, author, copyright, default_background_id, tags:[...]}]` | Full list with tags. |
| `get(id)` | `{id, title, author, copyright, default_background_id, background_path, sections:[...], tags:[...]}` | Full song with sections ordered by order_index. |
| `create(data)` | `id` | data: `{title, author, copyright, sections:[{type,content,style_json}], tagIds:[], arrangement?}`. `arrangement` = 0-based section positions (§16). |
| `update(id, data)` | void | Same shape as create. Sections rebuild replaces all existing; `arrangement` re-serialized against the new section count. |
| `delete(id)` | `{hasReferences: bool, count: number}` | Refuses if referenced by service_items. |
| `addTag(songId, tagId)` | void | — |
| `removeTag(songId, tagId)` | void | — |
| `setBackground(songId, mediaId\|null)` | void | Sets songs.default_background_id. |
| `setLock(songId, locked)` | void | Sets songs.background_locked (0/1). Pins the song's bg at the top of the resolution cascade (§9); bulk apply + per-slot override writes skip a locked song. |
| `deleteAll()` | void | Deletes all songs, their sections, taggables, and all song-type service_items. Irreversible. |
| `importParse(filePaths)` | `[{ok, file, format, title, author, copyright, sections, tags?, error?}]` | Parses song files (no DB write). Auto-detects OpenLyrics XML / ChordPro / text / EasyWorship SQLite (one .db → many rows). Per-file failures returned as `{ok:false, error}`. |
| `importGhs()` | same row shape, all `format:'GHS'`, `tags:['GHS']`, with `existing:bool` | Parses the bundled GHS hymnal; flags rows already in the DB. |
| `importCommit(parsedSongs)` | `{count, ids}` | Bulk-creates songs in one transaction. Each `song.tags[]` (names) is get-or-created and assigned. |
| `matchTitles(rawText)` | `[{input, match:{id,title,author}\|null, alternates:[{id,title,author}], confidence}]` | Paste-Song-List matcher. Parses a dirty pasted set list into entries and matches each (lyric-first) against the library. `confidence` ∈ `exact`\|`high`\|`low`\|`none`. See §16. |
| `scrapeSearch(query)` | `{ok, results:[{title,artist,url,provider}]}\|{ok:false,error}` | Online Song Finder — search Genius by title/artist; runs in main (no CSP/CORS issue). |
| `scrapeFetch(candidate)` | `{ok,title,artist,sections:[…]}\|{ok:false,error}` | Fetch + clean lyrics for one search result (Genius / AZLyrics / arbitrary `url`); returns parsed sections ready for an editable preview before saving. |
| `applyStyleToSong(songId, styleJson)` | void | Merges `styleJson` into every section of a song (preserving inline runs). |
| `logUsage(songId)` | void | CCLI usage log. Fired by `OperatorView` on live-song change; dedupes per song within ~12h and snapshots title/author/copyright (v31, §05 `song_usage`). |
| `usageReport(fromIso, toIso)` | `{rows:[{title, author, copyright, times_used, first_used, last_used}], total}` | Grouped play counts over a date range (inclusive) for the CCLI report (`SongUsageSettings.jsx`). |
| `usageClear()` | void | Wipes the whole `song_usage` log (confirm-gated in the UI). |

### `window.cue.tags`

| Method | Returns |
|---|---|
| `list()` | `[{id, name, colour, song_count}]` — `song_count` is the number of songs carrying the tag (subquery over `taggables`). |
| `create({name, colour})` | `id` |
| `update(id, {name, colour})` | void |
| `delete(id)` | void — cascades to `taggables` (removes the tag from every song). |

### `window.cue.services`

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[{id, title, date, notes}]` | Date DESC order. |
| `get(id)` | `{...service, items:[resolvedItems]}` | Items fully resolved (see resolveItem below). |
| `create({title, date, notes})` | `id` | — |
| `update(id, data)` | void | — |
| `delete(id)` | void | Cascades to service_items. |
| `reorderItems(serviceId, orderedIds)` | void | Updates order_index for each id. |
| `addItem(serviceId, item)` | `id` | item: `{item_type, ref_id, content, background_override_id}` |
| `addItems(serviceId, items)` | `[id]` | Bulk-add; same item shape. Used by undo flows (bulk delete, rundown delete). |
| `removeItem(itemId)` | void | — |
| `setItemBackground(itemId, mediaId\|null)` | void | Sets background_override_id. |
| `setItemLoop(itemId, loop)` | void | Sets service_items.media_loop (0/1) — looping for a media item. |
| `setItemAdvance(itemId, seconds, loop, wrap)` | void | Auto-advance config. `seconds>0` sets the interval (falsy clears it → manual, and NULLs `advance_loop`); `loop` = `'item'`\|`'rundown'`; `wrap` (bool, rundown mode) wraps to the first item at the end vs stops. |
| `duplicateItem(itemId)` | `id` | Appends copy at end of rundown (carries advance config). |
| `clearItems(serviceId)` | void | Removes all items from a rundown; keeps the service row. Used by Danger Zone. |
| `applyBackgroundToRundown(serviceId, mediaId)` | `count` | Sets background_override_id on every unlocked song slot AND updates each unlocked song's default_background_id. Locked songs skipped. |
| `exportPdf(serviceId)` | `{canceled}` \| `{canceled:false, path}` | Exports the rundown's lyrics as a printable PDF. Opens a native Save dialog, then renders the resolved rundown to PDF. No file is written unless the user picks a path. See §4 `export/rundown-pdf.js`. |

**`resolveItem()` shape** — what `services:get` returns per item:
```js
{
  // All service_items columns (id, service_id, item_type, ref_id, order_index, notes, content, background_override_id)
  song: { id, title, author, copyright, default_background_id, background_locked,
          tags: [{ id, name, colour }],   // rendered as chips on the rundown sublabel line
          default_background: { id, path, filename, type } | null },
  sections: [{ id, song_id, type, order_index, content, style_json }],
  asset: { ...media_asset },            // if item_type === 'media'
  background_override: { ...media_asset } | null,
}
```

### `window.cue.output`

| Method | Returns | Notes |
|---|---|---|
| `go(payload)` | void | Dispatches to all active output windows. |
| `clear()` | void | Clears all outputs, stops live capture. |
| `logo()` | void | Shows logo on all outputs. |
| `setLive(enabled)` | void | Opens or closes all output BrowserWindows. Toggle in transport bar. |
| `getState()` | `{isLive, livePayload, activeChannels:[ids], activeWindows, outputsEnabled, displayMode, transport, overlay}` | `transport` = media snapshot; `overlay` = `{nameTitle, ticker, custom, countdown}`. |
| `media.control(action)` | void | `action` ∈ `'play' \| 'pause' \| 'restart'` — mutates the transport, broadcast to all surfaces. |
| `media.seek(pos)` | void | Scrub foreground media to `pos` seconds (preserves paused state). |
| `media.setMuted(muted)` | void | Toggle program (audience) audio. Stage + operator preview stay silent regardless. |
| `media.setLoop(loop)` | void | Toggle native looping of the live clip live, without restarting it. Sets `transport.loop` + broadcasts; output players make `<video>.loop` follow `transport.loop` (`media-player.js`). The operator's transport-bar loop button persists `media_loop` (`services.setItemLoop`) alongside this so it sticks for the rundown badge + next GO. |
| `media.setRate(rate)` | void | Operator playback speed (e.g. 0.25–2). Rebases `startAt` so position is continuous; becomes the baseline the ±6% convergence nudge multiplies around. |
| `graphic.show({name,title,style,target,autoDismissSec,bgPath?,bgFit?})` | void | Show the name/title lower-third bug. `target` ∈ `'all'\|'screen'\|'ndi'`. `autoDismissSec>0` self-hides after that many seconds (main-owned one-shot timer per slot+kind; §13). `bgPath` = absolute media path for a full-screen background video/image behind the bug; `bgFit` = `'cover'`\|`'contain'` (default `'cover'`). |
| `graphic.hide()` | void | Hide the name/title bug. |
| `graphic.showCustom({html,target,autoDismissSec,bgPath?,bgFit?})` | void | Show a custom-HTML graphic (placeholders already substituted). `autoDismissSec>0` self-hides. `bgPath`/`bgFit` same as above. |
| `graphic.hideCustom()` | void | Hide the custom graphic. |
| `ticker.show({text,speed,style,target,autoDismissSec,bgPath?,bgFit?})` | void | Show the scrolling ticker. `autoDismissSec>0` self-hides. `bgPath`/`bgFit` same as above. |
| `ticker.hide()` | void | Hide the ticker. |
| `countdown.show({id,mode,source,durationSec,targetClock,format,showSeconds,label,endMessage,onEnd,onEndMediaId,style,target,bgPath?,bgFit?})` | void | Show a self-ticking countdown/count-up/clock. Main resolves the anchor (`endsAt` for `mode:'countdown'`, `startAt` for `'countup'`); the output template owns the per-second tick. `style` = `{time, message}`. `onEnd` = `'hold'`\|`'clear'`\|`'overflow'`\|`'loop'`\|`'media'` (see §5 graphics table). Main arms `cdEndTimer` for `clear`/`loop`/`media`; resolves `onEndMediaId` → `onEndMediaPath` from DB before broadcasting. `bgPath`/`bgFit` same as above. |
| `countdown.hide()` | void | Hide the countdown/clock. Clears any pending `cdEndTimer`. |
| `overlay.get()` | `{nameTitle, ticker, custom, countdown}` | Current overlay snapshot. |
| `stage.message(text)` | void | Set/clear the confidence-monitor presenter **immediate** message (`''` clears). Takes precedence over scheduled messages on the bar. |
| `stage.getMessage()` | `{text}` | Read the current stage message (e.g. on Settings→Stage open, to prepopulate the field). |
| `stage.timer(action, seconds?)` | void | Presenter countdown: `action` ∈ `'set'(seconds) \| 'start' \| 'pause' \| 'reset'`. |
| `stage.getTimer()` | `{state, remaining, target}` | Read the current timer state (e.g. on Settings→Stage open). |
| `stage.getLayout(channelId)` | `{elements:[…]}` | Per-channel WYSIWYG stage element layout. `NULL` column → returns the built-in `DEFAULT_STAGE_LAYOUT`. |
| `stage.setLayout(channelId, layout)` | void | Persist `{elements:[…]}` to `output_channels.stage_layout_json` and broadcast `stage:layout` to every open window for that channel. |
| `stage.getPresets()` | `[{id,name,elements:[…]}]` | Saved named stage layouts from the `stage_presets` setting. |
| `stage.savePreset(preset)` | `{presets,id}` | Upsert a preset by `id` (omit to create). Returns the updated list + the assigned `id`. |
| `stage.deletePreset(id)` | `[{id,name,…}]` | Remove a saved preset; returns the updated list. |
| `stage.getSchedule()` | `[{id, text, showAt, clearAt}]` | Current pending scheduled messages (absolute epoch-ms anchors; `clearAt:null` = no auto-clear). |
| `stage.schedule({text, afterSeconds?, atHour?, atMinute?, clearAfter?})` | `[scheduled]` | Queue a timed message. `afterSeconds` = countdown from now; `atHour`/`atMinute` = next occurrence of that wall-clock time; `clearAfter` (seconds, falsy=never) = auto-clear. Main resolves the absolute `showAt`/`clearAt` once via `resolveAnchors` and returns the updated list. |
| `stage.unschedule(id)` | `[scheduled]` | Remove a pending scheduled message; returns the updated list. |
| `lowerthird.setFontScale(pct)` | `number` | Set the **global lower-third font scale** (percent, clamped 1–150). Persists the `lowerthird_font_scale` setting and re-broadcasts the live slide so on-air lower-thirds restyle instantly. Returns the clamped value. Only the lower-third output is affected; fullscreen ignores it. |
| `channels.list()` | `[output_channel rows]` | — |
| `channels.create(data)` | `channel` | NDI channels open a BrowserWindow immediately; screen channels wait for monitor assignment. `data.ndi_audio_muted` / `data.show_program` / `data.show_graphics` (all default 1). |
| `channels.update(id, data)` | `channel` | A change to **only** `show_program`/`show_graphics` is applied at runtime (`setChannelContentMode` → `content:mode`, no window recreate); any other field rebuilds via `syncChannel`. Emits `output:state-changed`. |
| `channels.delete(id)` | void | Closes window(s) and cascades to channel_monitors. |
| `monitors.list(channelId?)` | `[channel_monitor rows]` | Pass channelId to filter. |
| `monitors.create(channelId, {display_bounds, label})` | `monitor` | Assigns a physical screen to a channel and opens its BrowserWindow. |
| `monitors.delete(monitorId)` | void | Closes window and removes row. |
| `multiview.start()` | void | Begins capturing all output windows; emits `output:multiview-captures` at ~1fps (1s). NDI tiles use the cached paint frame; screen tiles use `capturePage()` (a full GPU readback that contends with live playback, so kept to 1fps with an in-flight guard against pile-up). Refcounted — interval starts only when count goes 0→1. |
| `multiview.stop()` | void | Decrements refcount; stops capture only when count reaches 0. Safe for multiple subscribers. |
| `screens.list()` | `[{id, bounds, scaleFactor, label}]` | All connected displays. |
| `audioDevice.get()` | object\|null | The configured in-room program-audio output device (`program_audio_device`), or null = system default. |
| `audioDevice.set(device)` | object\|null | Persist `{deviceId,label,groupId}` (or null) AND broadcast `audio:output-device` to live output windows so the in-room device changes without re-GO. |
| `stream.getConfig()` | object | RTMP `stream_config` (defaults merged). |
| `stream.setConfig(cfg)` | object | Merge + persist `stream_config`; returns merged. Recreates the idle preview window if resolution/fps changed. |
| `stream.start()` | `{ok,error?}` | Go Live: ensure ffmpeg, ensure the compositor window, spawn the encoder on the next frame, enable the stream audio tap. |
| `stream.stop()` | `{ok}` | Stop the encoder; keep the compositor window if the Stream tab is still previewing. |
| `stream.status()` | `{active, previewing, state, encoder, droppedFrames, sentFrames, backpressure}` | `state` ∈ `idle\|starting\|live\|reconnecting\|error`. |
| `stream.getStudio()` / `stream.setStudio(cfg)` | object | Read/merge+persist `stream_studio` (`videoDeviceId/Label`, `audioDeviceId/Label`, `audioMode`, free-form `layout`); a `layout` patch REPLACES the whole layout (full box model) and pushes live to the compositor. |
| `stream.getPresets()` / `stream.savePreset(p)` / `stream.deletePreset(id)` | array / `{presets,id}` / array | CRUD for saved layout presets (`stream_presets`). `savePreset` upserts by `id` (omit to create). |
| `stream.open()` / `stream.close()` | studio / void | Ref-count the Stream tab: open starts the compositor for preview; close tears it down when not live. |

**Output payload structure:**
```js
{
  type: 'content' | 'clear' | 'logo',
  text: string | null,
  sectionLabel: string | null,
  copyright: string | null,            // scripture reference "Book c:v (VERSION)"; songs use their copyright line
  copyrightAlign: 'right' | undefined, // 'right' for scripture (bottom-right); songs/default centred
  copyrightStyle: object | undefined,  // scripture reference style_json (font/size/colour/align + optional pos:{x,y})
  backgroundPath: string | null,    // absolute filesystem path (not a URL)
  logoPath: string | null,          // absolute filesystem path
  styleJson: object | null,         // parsed style_json
  media: { path, type: 'video'|'audio'|'image', loop: bool } | undefined,  // foreground media item
  transport: { active, startAt, pausedAt, loop, muted } | undefined,       // snapshot for media items
  elements: [ ...presentationElements ] | undefined,  // presentation slide — multi-element canvas (see §21)
  ltFontScale: number | undefined,  // global lower-third font scale as a FRACTION (e.g. 0.7); fullscreen.js ignores it, lowerthird.js multiplies its font size by it. Default 1 when absent.
  bgLoopMode: 'blend' | 'jump' | undefined,  // background video loop strategy (§5 bg_loop_mode setting); fullscreen.js re-mounts video when mode changes.
  bgLoopBlendSecs: number | undefined,        // crossfade duration for blend mode (0.5–10, default 2.0); clamped in main before dispatch.
}
```

A presentation-slide payload carries `elements` (and a per-slide `backgroundPath`); `text`/`styleJson` are null. `fullscreen.js` `renderElements()` renders it on the scaled 1920×1080 `#slide-elements` layer; `lowerthird.js` blanks its band for `payload.elements` (a full-canvas item has no lower-third in v1). The operator monitor renders the same array via `PreviewLivePanel`'s `PresentationCanvas`. `manager.go()` is payload-opaque — it stamps the transport and forwards the payload unchanged, so the element array needed no transport changes.

**Media transport model** — foreground media (bumpers/clips) is synced across every surface (screen
outputs, NDI, operator live monitor, confidence monitor) by a single main-process `transport`:
```js
transport = { active, startAt, pausedAt, loop, muted }
// position(now) = ((pausedAt ?? now) - startAt) / 1000   (mod duration when loop)
```
`go()` stamps it; `mediaControl/mediaSeek/mediaSetMuted/mediaSetLoop/mediaSetRate` mutate it; `broadcastTransport()` pushes
`media:transport` to every output window and `output:media-transport` to the renderer. Each player
(`media-player.js`, stage video, `SyncedVideo`) derives its playhead from the shared machine clock —
no clock-master election, no per-window time reporting — and converges via `playbackRate` nudging
(hard-seek only on >0.5 s drift / scrub / pause). Looping uses the native `loop` attribute (single
element) for clean gapless audio. **Program audio comes from one window only** (`isPrimaryAudioMonitor`
→ `?mute=` query param); stage is always muted; `media.setMuted` layers a live program mute as
`el.muted = baseMuted || transport.muted`.

**Broadcast-graphics overlay bus** — an independent layer (name/title bug, scrolling ticker, custom
HTML, countdown/clock) separate from the program slide bus. Held in `manager.js` as `overlay = {
nameTitle, ticker, custom, countdown }`, where **each slot holds one occupant PER DESTINATION KIND**:
`slot = { screen, ndi }` (each `null` or a slot-value object). This lets a *different* graphic of the
same type run In-Room vs Online simultaneously (e.g. two different tickers). `setSlot(name, value, target)`
writes the kind(s) named by `target` — `'all'` fills both, `'screen'`/`'ndi'` fills just one and leaves
the other running; `*Hide(target)` clears the same way (no target = clear both). The slot-value object is
unchanged in shape (`{ id, …, target }`) and carries the originating graphic's **`id`** so the operator UI
matches "what's live" by identity, not by content (two graphics sharing a text body no longer both light
up); ad-hoc fires like the quick ticker carry no id. `broadcastGraphic()` sends a per-window `graphic:update`
to **every non-stage output window** (fullscreen + lower-third, matched by URL in `getGraphicsWindowInfos`)
carrying `overlayForKind(kind)` = that window's-kind occupant of each slot (numeric map key = screen/in-room,
`ndi-*` = online), and notifies the renderer via `output:overlay-changed` (the full `{screen,ndi}` shape;
`GraphicsPanel.liveDests(g)` / `PreviewLivePanel` pick per kind). Rendered by the shared
`src/output/graphics-overlay.js` (injects its own DOM + styles, honours `?graphics=0` and `content:mode`).
A program `go`/`clear`/`logo` never touches the overlay, and a graphic never touches the program. Default
destination for new graphics is **Online (NDI)**.

**Auto-dismiss** — a name/title, ticker, or custom graphic can carry `autoDismissSec` (authored in
`style_json`, fired through the existing `*Show` data). `>0` arms a **main-owned one-shot `setTimeout` per
`(slot, kind)`** (`dismissTimers` map in `manager.js`) that nulls that slot+kind and `broadcastGraphic()`s
when it fires — NOT a per-second stream over the bus (same discipline as the countdown anchor). The timer
identity-checks `overlay[name][kind] === expected` before hiding, so a graphic that has since replaced this
one (each `*Show`/`*Hide` re-arms or clears the slot's timer) is never yanked out from under the new
occupant. The fired slot value carries an absolute `dismissAt` for operator-side display only
(`GraphicsPanel` cards show a locally-ticked "auto · Ns" badge). On Scene recall `reviveSlotValue` re-stamps
a fresh `dismissAt` and `applyScene` re-arms the timer full-length (a stored absolute `dismissAt` would be
stale). Countdowns are excluded — they own their own end behaviour. `autoDismissSec` lives only in
`style_json` (no schema column), so it round-trips through scene snapshots and graphic CRUD untouched.

**Countdown / clock graphic** (v16) — a `countdown` slot is a self-ticking timer the **output template
owns**: `countdownShow` resolves the anchor in the main process (duration → `endsAt = now + durationSec`;
target-time → next occurrence of `HH:MM`; count-up → `startAt = now`; clock → no anchor) and the bus
carries only that absolute timestamp + config. `graphics-overlay.js` runs a single `setInterval(…, 250ms)`
that recomputes the digits from the anchor and `Date.now()`, so a window opened mid-countdown lands on the
right value, the operator never streams per-second updates, and the countdown self-stops its interval at
zero (showing `endMessage`). The clock editor (GraphicsEditor `countdown` kind) authors mode, duration/
target/format, label + end message, the draggable time box (`time.textBox`/`ltBar`) and label styling.

### `window.cue.graphics`

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[graphics rows]` | Ordered by `order_index, id`. |
| `get(id)` | `graphics row` | — |
| `create(data)` | `id` | `data.style_json` (object or string), `data.target` (default `'ndi'`). |
| `update(id, data)` | void | — |
| `delete(id)` | void | — |
| `reorder(orderedIds)` | void | Single transaction. |
| `presets()` | `[{ id, name, kind, graphic }]` | Built-in design presets read at request time from `resources/graphics/` (NOT DB rows): `*.html` → `kind:'custom'` (`graphic:{ html }`, `<!-- name: … -->` header, comment stripped); `*.json` → structured `lower_third`/`ticker`/`countdown` (`graphic` = partial graphic record incl. `style_json`). The gallery offers these; picking one creates an ordinary graphic. |

The graphic-fire methods (`window.cue.output.graphic.show/hide`, `ticker.show/hide`, `graphic.showCustom/hideCustom`, `countdown.show/hide`) take an `id` in their `show` payload (so liveness matches by identity) and an optional `target` on `hide` (clears one destination kind; omitted = both). See the overlay-bus note in `window.cue.output`.

### `window.cue.scenes` (v24 — multi-output state recall)

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[scenes rows]` | Ordered by `order_index, id`. Rows carry `overlay_json` as a string. |
| `get(id)` | `scene row` | — |
| `create(data)` | `id` | `data` = `{ name, hotkey, program, audio_muted, overlay }` (`overlay` object or null). Binding a `hotkey` frees it on any other scene. |
| `update(id, data)` | void | Same shape as create. |
| `delete(id)` | void | — |
| `reorder(orderedIds)` | void | Single transaction. |
| `apply(scene)` | void | Accepts a DB row OR a live-preview object; `normalizeScene` → `outputManager.applyScene` drives the live bus atomically (§13). Used by number-key recall, the panel's Take, and the editor's Test. |

### `window.cue.outputPresets` (v30 — save & recall the output RIG)

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[output_presets rows]` | Ordered by `order_index, id`. `includes_json`/`data_json` as strings. |
| `get(id)` | `row` | — |
| `create(data)` | `id` | `data` = `{ name, includes, data }` — `includes`/`data` objects (shape in §05). |
| `update(id, data)` | void | Same shape as create. |
| `delete(id)` | void | — |
| `reorder(orderedIds)` | void | Single transaction. |

Pure CRUD — there is **no `apply()`**. Recall is renderer-orchestrated: `OutputPresetsPanel` replays the snapshot through the existing settings IPC (`output.channels`, `output.monitors`, `output.stream`, `output.stage`, `settings.setGlobalBackground/setGlobalLogo`). See §05 `output_presets`.

### `window.cue.liveInput` (v31 — NDI video receive; §14)

| Method | Returns | Notes |
|---|---|---|
| `sources(waitMs)` | `[{name, urlAddress}]` | Discovered NDI senders (Cue's own senders filtered out — feedback guard). `waitMs` lets discovery settle. |
| `available()` | `bool` | Whether the NDI receive runtime (`grandi`) loaded. |
| `getEnabled()` / `setEnabled(v)` | `bool` / void | The `live_inputs_enabled` mid-service kill switch. `setEnabled(false)` drops an on-air feed to 'cleared', tears down receivers/previews, and gates GO/discovery/previews. |
| `previewStart(sourceName)` / `previewStop(sourceName)` | void | Ref-counted operator preview — drives ~2fps JPEG thumbnails over `liveinput:preview` (never a full-frame bus, never a capture loop). |

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[theme rows]` | Each row joins `background_path`/`background_filename`/`background_type`. Ordered by `builtin DESC, sort_order, name` (built-ins first within a category). Filter by `category` in the picker. |
| `get(id)` | `theme row` | — |
| `create(data)` | `id` | `data` = `{ name, style_json, background_id, category }` (category defaults `'song'`; preserved on duplicate). |
| `update(id, data)` | void | `{ name, style_json, background_id }`. |
| `delete(id)` | void | — |
| `applyToSong(themeId, songId, setBg)` | `sectionCount` | Merges style into the song's sections. With `setBg`: the handler first `await`s `resolveThemeBackground` (downloads a media theme's `bgRef`, no-op otherwise, §9), then writes the song default bg / clears per-slot overrides; a `bgCss` theme clears the media bg to NULL so the gradient shows. |
| `applyToRundown(themeId, serviceId, setBg)` | `songCount` | As above for every distinct song in the rundown. |
| `applyToAllSongs(themeId, setBg)` | `songCount` | As above for every song in the library. |
| `resolveBackground(themeId)` | `media_asset\|null` | Eagerly resolve + download a media-theme's `bgRef` (no-op for gradient/CSS themes). Used by the Sermon → Slides flow to ensure the theme background is available before building slides. |

### `window.cue.backgrounds` (Background Library — Phase 1b)

Browsable pool of curated 16:9 worship backgrounds shipped only as a manifest (`resources/media-manifest.json`: tags + dims + hotlinked `thumb` + origin `url`). **Distribution Option A — never rehost:** the grid hotlinks each `thumb`; a pick downloads the origin `url` into the *same* local media library as any import (a normal `media_assets` row, `cue-media://`/`cue-thumb://`). `db/background-library.js`.

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[{ id, kind, source, width, height, tags, thumb, available, mediaId }]` | `mediaId` non-null = already downloaded; `available` false = origin `url` unresolved. No `url` leaves main. |
| `tagCounts()` | `{ tag: count }` | For the tag filter chips. |
| `download(id)` | `media_assets row` | Idempotent (settings `bg_library_downloads` map); streams the origin `url` into `userData/media`. |
| `applyAsDefault(id, surface, toAll)` | void | Downloads then sets the global default bg for `surface` (`'song'`/`'scripture'`/`'slide'`); `toAll` also applies across existing items. |

### `window.cue.media`

| Method | Returns | Notes |
|---|---|---|
| `import(filePaths)` | `[{id, filename, path, type, duration_ms, size_bytes}]` | Copies files to userData/media/. `duration_ms` set for video/audio via ffmpeg probe (null for images or if ffmpeg unavailable); `size_bytes` set for all via `fs.statSync`. |
| `get(id)` | `media_asset \| null` | Single asset by ID. |
| `list(folderId?)` | `[media_asset]` | `null`/`undefined` → root (folder_id IS NULL). Pass folder id for subfolder. |
| `listAll()` | `[media_asset]` | Flat list of every asset across all folders. Used by the command palette's media search (`list` only returns one folder). |
| `delete(id)` | void | Removes DB row and deletes file. |
| `deleteMany(ids)` | `number` | Bulk-delete (rows + files); returns count removed. Used by the unused-media cleanup. |
| `deleteAll()` | `number` | Wipes the whole media library (rows + folders + files) and resets the global media settings keys. Returns assets removed. Danger Zone "Clear media library". |
| `findUnused()` | `[media_asset]` | Media referenced by nothing — not a song `default_background_id`, `service_items.background_override_id`, `output_channels.logo_override_id`, `themes.background_id`, nor a media-bearing `settings` key (`global_logo_id`, `global_bg_*_id`). Settings store ids as JSON-encoded ints, collected separately from the FK columns. `size_bytes` is read from the DB column (populated at import since v29). |
| `getDiskUsage()` | `number` | Total bytes in userData/media/. |
| `getMediaDir()` | `string` | Absolute path to userData/media/. |
| `folders.create(name, parentId?)` | `id` | — |
| `folders.rename(id, name)` | void | — |
| `folders.delete(id)` | void | Moves folder contents to root. |
| `folders.tree()` | `[{id, name, parent_id, children:[...]}]` | Recursive tree. |

### `window.cue.youtube`

| Method | Returns | Notes |
|---|---|---|
| `prefetch(url)` | `status snapshot` | Start (or reuse) an ephemeral download. Idempotent per video id, so the speculative paste-time call and the Confirm-time call never double-download. Resolves on completion but callers usually fire-and-forget and watch the `youtube:status` stream. |
| `status(url)` | `status snapshot \| null` | `{ id, url, status, percent, title, durationMs, path, error }`; `status` ∈ `resolving \| downloading \| processing \| ready \| error`. |
| `cancel(url)` | void | Abandon the download (kill the child) and delete its bytes. Fired on an edited paste and on cue removal. |
| `detect()` | `{ ytDlp, ffmpeg }` | Health check — absolute path of each bundled binary, or null if missing. |
| `readClipboard()` | `string` | OS clipboard text (Electron main `clipboard.readText`). Used by `LibraryPanel` to detect a copied YouTube link on Media-tab entry. Silent, on-demand only. |

The downloaded file is **ephemeral** — never a `media_assets` row (see §6 *Native YouTube player*).

### `window.cue.settings`

| Method | Notes |
|---|---|
| `get(key)` | Returns JSON-parsed value or null. |
| `set(key, value)` | JSON-encodes value, upserts. |
| `setGlobalLogo(mediaId\|null)` | Sets `global_logo_id`. |
| `setGlobalBackground(type, mediaId\|null)` | type: `'song'`, `'scripture'`, or `'slide'`. |
| `applyBackgroundToAll(type, mediaId)` | Song type only: sets default_background_id AND clears the per-slot override on every **unlocked** song (locked songs skipped). |
| `getDiskUsage()` | Delegates to media.getDiskUsage(). |
| `getDataPath()` | Returns app.getPath('userData'). |
| `openDataFolder()` | Opens userData in Finder/Explorer. |
| `exportBackup()` | No args — shows a native save dialog (`Cue <date>.cuebackup`), then writes a gzipped tar of `cue.db` + `media/`. Returns `{ok, path, size}` or `{ok:false, canceled}`. |
| `importBackup()` | No args — shows an open dialog, validates the archive, swaps `cue.db` + `media/` + `fonts/` on disk (media + user-font paths rewritten to this install), then relaunches the app (~400ms after the IPC reply). Returns `{ok}`, `{ok:false, canceled}`, or `{ok:false, error}` (validation/extract failure leaves the install untouched). |
| `factoryReset()` | No args — closes the DB, deletes `cue.db` (+wal/shm), `media/` and `fonts/`, then relaunches as a fresh install (DB + bibles + GHS re-seed on boot). Returns `{ok:true}`. Danger Zone "Reset app to defaults". |
| `checkForUpdate()` | Queries the GitHub Releases API for `will-eze/Cue` (public repo, anonymous HTTPS — no token/`gh`). Returns `{ok, current, latest, isNewer, asset:{name,url,size}, notes}` when a newer version exists, `{ok, current, latest, upToDate:true}` when current, or `{ok:false, current, error}`. |
| `downloadUpdate(asset)` | Streams the asset to `temp/`, emits `update:progress`, strips the macOS quarantine xattr, opens the installer, then quits (~1.2s later). Returns `{ok, path}` or `{ok:false, error}`. |

### In-app updater (`src/main/update/updater.js`)

Manual "Check for Updates" button in the SettingsView footer (`UpdateChecker`). Pulls Cue's own updates across an owned fleet with **no auth, token, `gh` CLI, or Apple Developer ID** — the repo is public, so the GitHub Releases API and asset downloads are anonymous HTTPS, like a browser.

- **Takes `/releases[0]`, never `/releases/latest`** — CI publishes *prereleases*, and `/latest` skips them, so `/latest` would always report "up to date". Index 0 is the newest release including prereleases.
- **Asset chosen by file extension** (`.dmg` on darwin, `…Setup.exe` on win32), never a name template — real asset names are `Cue.dmg` and `Cue-<ver>.Setup.exe` (no arch/version pattern on the dmg). No `RELEASES`/`.nupkg` are uploaded.
- Version compare is `semver` against `app.getVersion()`. Tag `v26.1.0` → `26.1.0`.
- Download follows GitHub's redirect to the asset host (Node's `https.get` does **not** auto-follow), streams to disk (never buffers), reports `{received,total}`.
- **Strips `com.apple.quarantine`** after download: a quarantine xattr on the ad-hoc-signed app is a Gatekeeper hard-block. (Programmatic Node downloads usually aren't quarantined — unlike browser downloads — so this is belt-and-braces, verified working on macOS.)
- This is "Option A" (manual one-click). True silent auto-update ("Option B", Electron `autoUpdater`) is blocked on macOS by ad-hoc signing (needs a $99 Apple Developer ID + notarization); Windows could do it but the squirrel `RELEASES`/`.nupkg` artifacts aren't published. See `deployment-handoff.md` for signing.

### `window.cue.bible`

| Method | Returns | Notes |
|---|---|---|
| `versions()` | `[{id, name, abbrev, language, verse_count}]` | Installed translations. |
| `books(versionId)` | `[{book_num, book_name}]` | Canonical order. |
| `chapters(versionId, bookNum)` | `[chapterNum, …]` | Ascending. |
| `verses(versionId, bookNum, chapter)` | `{bookNum, bookName, chapter, verses:[{chapter, verse, text}]}` | Whole chapter — drives the live verse list. |
| `adjacent(versionId, bookNum, chapter, verse, dir)` | next/prev verse `{book_num, book_name, chapter, verse, text}` or null | `dir` 1\|-1; rolls across chapter/book boundaries. Powers ↑/↓ live nav. |
| `resolve(versionId, ref, versesPerSlide?)` | passage payload | Free-text reference → self-contained passage (Add-to-Rundown scripture items). |
| `search(versionId, query)` | `[{book_name, book_num, chapter, verse, text}]` | FTS5 verse search. |
| `importFile(filePath, meta)` | `{ok, id, name, count}` \| `{ok:false, error}` | Imports JSON / Zefania XML. |
| `delete(id)` | void | Removes a translation (FTS purge + cascade). |
| `online:list` (`onlineList()`) | `{ok, versions:[{abbrev, name, language, license, restricted, installed}]}` | getbible.net v2 catalog (117 versions); installed matched by name. |
| `online:download` (`onlineDownload(abbrev)`) | `{ok, id, name, count}` \| `{ok, already:true}` \| `{ok:false, error}` | Fetch (main-process) + normalize + import one version. |

### `window.cue.remote`

Network control API (Stream Deck / Companion / phone). The renderer only configures the server and feeds it the rundown; transport itself flows back as a `remote:command` event the operator view handles like keyboard input.

| Method | Returns | Notes |
|---|---|---|
| `getConfig()` | `{enabled, port, lan, token, outputEnabled, viewToken, running, urls}` | Current server config + bound URLs. |
| `setConfig({enabled?, port?, lan?, outputEnabled?})` | config | Persists settings keys then (re)starts/stops the server. |
| `regenerateToken()` | config | Mints a new control pairing token (old control links stop working) and restarts. |
| `regenerateViewToken()` | config | Mints a new Remote Output view token (old `/output` links stop working) and restarts. |
| `pushNavState({items, previewItemId, liveItemId, liveSlideIdx})` | void | Renderer pushes the rundown (each item carries `slides:[{index,label,preview}]`) so remote clients can list + jump to a slide. No-op when the server is stopped. |

Control HTTP surface (token via `X-Cue-Token` header or `?token=`): `GET /` (control page), `GET /api/state` (now also lists saved broadcast graphics + which destination kinds each is live on, matched by **id** never content), `GET /api/stream` (SSE), `GET /api/{go,clear,logo,next,prev,live}`, `GET /api/select?itemId=N&slideIdx=M`, `POST /api/command {action, …}`. Broadcast-graphics remote (saved graphics + countdowns): `POST /api/graphic/{fire,clear,pause,resume} {id, target?}` and `POST /api/countdown/{show,hide,pause,resume} {mode?, durationSec?, targetClock?, source?, label?, onEnd?, target?}`. Main injects the graphic control fns into the server (`fireById`/`clearById`/`pauseById`/`resumeById` + `list`/`overlay`); the remote never resolves overlay state itself.

Output HTTP surface (view token via `X-Cue-View-Token` header or `?vt=`): `GET /output` (mirror page, ungated shell), `GET /output/assets/<file>` + `GET /output/fonts/<file>` (ungated static templates/fonts), `GET /output/stream` (SSE program deltas, view-gated), `GET /output/media/<abs-path>` (view-gated, `serveLocalFile`). The mirror taps the manager's screen-kind buses: `setRemoteProgramListener(cb)` fires `{slide|transport|overlay}` deltas → `pushProgram`; `getProgramSnapshot()` returns the full current `{slide, transport, overlay}` frame for a late joiner.

### `window.cue.presentations`

| Method | Returns | Notes |
|---|---|---|
| `list()` | `[{...presentation, slide_count}]` | Ordered by `updated_at` DESC. |
| `get(id)` | `{...presentation, slides:[{id,label,background_id,background_path,notes,elements}]}` | Image-element `mediaId`s resolved to `path`/`mediaType`. |
| `create(data)` | `id` | `data = {title, slides:[{label, background_id, elements}]}`; defaults to one blank slide. |
| `update(id, data)` | void | Slides rebuild (replaces all — mirrors `songs.update`). |
| `delete(id)` | void | Also removes any `presentation` service items referencing it. |
| `reorderSlides(id, orderedIds)` | void | — |
| `templates.{list,get,create,delete}` | — | Reusable slide layouts (`presentation_templates`). |
| `detectLibreOffice()` | `{found, path?, version?}` | UI "check before import" — never spawns a missing binary. |
| `setLibreOfficePath(p)` | `{found, ...}` | Persists `libreoffice_path` and re-detects (Locate manually…). |
| `convertPptx(filePath)` | `{ok, pdf:Uint8Array, name}` \| `{ok:false, error}` | `.pdf` passes through (no LibreOffice); `.ppt/.pptx` → soffice → PDF bytes. `error:'not_found'` = LibreOffice missing. |
| `createFromImages(title, buffers)` | `{id, slideCount}` | Persists each rasterised PNG (`media.importBuffer`) → a presentation whose slides each hold one full-bleed image element. |
| `sermonGenerate(payload)` | `{id}` | Sermon → Slides import. `payload` = `{filePath?, text?, title, themeId?, bibleVersionId?, versionAbbrev?}`. `filePath` for txt/md/docx (main extracts text); `text` for PDF (renderer extracted via pdfjs). Returns the new presentation `id`. See §22. |

`window.cue.openExternal(url)` opens an https URL in the default browser (LibreOffice download link).

### `window.cue.dialog`
- `openFile(options)` → `{canceled, filePaths}` — wraps `dialog.showOpenDialog`.

### `window.cue.fonts`
- `fonts.list` — synchronous: `[{family, label, category, bundled?}]` from `BUNDLED_FONTS` (6 shipped faces + ~22 cross-platform system fonts as fallback stacks)
- `fonts.default` — synchronous: `'Inter'`
- `fonts.listUser()` — async: user-installed fonts `[{id, family, label, filename, path, ext}]`
- `fonts.css()` — async: `@font-face` CSS for all user fonts (cue-media:// URLs); injected into the operator UI + every output window
- `fonts.import()` — async: native multi-file picker → copies + registers each; returns `{ok, added, errors, list}` or `{ok:false, canceled}`
- `fonts.delete(id)` — async: removes a user font (row + file)

Editors load the merged list via the `useFonts()` hook (`renderer/utils/fonts.js`); the picker groups by category, with user fonts under "My Fonts".

### `window.cue.on(channel, callback)` → unsubscribe function
Subscribe to main→renderer events. Returns an unsubscribe function — call it to remove the listener (e.g. in `useEffect` cleanup). Allowed channels:
- `output:unresolved-channels` — array of unresolved channel objects on startup
- `output:state-changed` — fired after go/clear/logo/setLive AND after any channel topology/flag change (`syncChannel` / `setChannelContentMode`); payload: `{activeWindows, outputsEnabled, displayMode, livePayload, transport, overlay}`. OperatorView reloads its channel list on this so the live monitor tracks content-mode changes.
- `output:overlay-changed` — fired after any broadcast-graphics change; payload is the full `overlay` object — each slot a `{screen, ndi, stream}` shape. The Graphics panel + live monitor follow it.
- `output:media-transport` — fired whenever the media transport changes (go / play / pause / restart / seek / setMuted / setLoop / setRate); payload: `{ active, startAt, pausedAt, loop, muted, rate }`. The operator UI follows this to drive `SyncedVideo` and the transport bar; output players make `<video>.loop` follow `transport.loop` so a live loop toggle applies without re-GO. (There is NO `output:media-time` event — the old clock-master time-reporting chain was removed.)
- `youtube:status` — fired as an ephemeral YouTube download progresses; payload: `{ id, url, status, percent, title, durationMs, path, error, setupName }` (`setupName` = which binary is downloading during the `setup` state). The Media-tab modal, the rundown status badge, and `OperatorView` (which patches the matching cue by URL) all follow it. See §6 *Native YouTube player*.
- `output:multiview-captures` — array of `{channelId, dataUrl, isNdi}` objects (~1fps, only while multiview is running). `isNdi: true` for NDI channels (sourced from `ndiLastFrames` JPEG cache at ~1fps); `isNdi: false` for screen channels (capturePage, also ~1fps with an in-flight guard so a slow readback can't pile up and stutter live playback).
- `stream:status` — RTMP stream state changes + ~1Hz health; payload `{active, state, detail?, encoder?, droppedFrames?, sentFrames?, backpressure?}` where `state` ∈ `idle\|starting\|live\|reconnecting\|error`. The Stream tab derives a Stable/Unstable dropped-fps badge from successive frame counts.
- `output:stream-preview` — ~10fps downscaled JPEG data-URL of the stream composite, for the Stream-tab monitor (preview only, not stream quality).
- `output:stream-levels` — `{l, r}` stereo peak levels (0..1) from the stream audio mix, for the Stream-tab meters.
- `output:ndi-unavailable` — fired if grandiose is not installed
- `output:ndi-sender-error` — `{channelId, error}` fired if creating an NDI sender fails (e.g. SDK init error after the window is open)
- `output:ndi-sender-ok` — `{channelId}` fired when the NDI sender is successfully created
- `shortcut:next` / `shortcut:prev` — reserved for future hardware remote
- `remote:command` — a network-control command `{action, itemId?, slideIdx?}` (action: go/clear/logo/next/prev/live/select). OperatorView dispatches it to the same handlers the keyboard uses, so the remote stays in sync with the UI.
- `stage:schedule` — `{scheduled: [{id, text, showAt, clearAt}]}`, fired after any scheduled-stage-message add/remove/prune. The `StagePanel` pending list follows it; the stage output windows also receive it directly. Anchors are absolute epoch-ms (`clearAt:null` = open-ended).
- `stage:layout` — `{channelId, elements:[…]}` fired after `stage.setLayout` and on window open (so a late-joining monitor receives the current layout). The `StageMonitor` in `PreviewLivePanel` subscribes per-channel to keep the operator preview in sync; stage output windows rebuild their DOM on receipt.
- `stage:timer` — `{state, remaining, target}` fired after any `stage.timer()` call, so the stage settings panel can display the live timer state without polling.
- `stage:message` — `{text}` fired after any `stage.message()` call, so the stage settings panel can reflect the live message without polling.
- `update:progress` — `{received, total}` during an in-app update download. The SettingsView `UpdateChecker` shows it as a percentage. See §7 *In-app updater*.
- `liveinput:preview` — `{sourceName, dataUrl}` ~2fps JPEG thumbnail of a previewing NDI source. The Library **Live** tab and the preview/live monitors render it (never the full RGBA frame bus). §14.
- `liveinput:status` — `{sourceName, connected, w?, h?, error?}` receiver connection state for the currently-selected live source.
- `liveinput:enabled` — `bool`, fired when the `live_inputs_enabled` kill switch flips; keeps the operator's `buildPayload` guard and the Library toggle in sync. §14.

---
