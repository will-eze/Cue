# Broadcast Graphics — Handoff

Status of P1 feature **#4 (Broadcast graphics)** from `plan/feature-roadmap.md`. Built and
building clean; **not yet committed**, and **not yet smoke-tested in the running app** (it
includes DB migrations v10 + v11, so it needs a full app restart to exercise).

---

## What it is

An **independent overlay bus** for broadcast lower-third graphics, separate from the program
slide bus. Graphics are authored in a **Graphics tab** in the Library and fired live directly
(like the Scriptures tab is an independent live source) — they never pass through the
preview/live program bus, so a graphic can **never clobber the in-room lyric program**.

Three overlay kinds, each an independent slot (any combination can be on air at once):

| Kind | What it is | Stored fields |
|---|---|---|
| `lower_third` | Built-in name/title "bug" (blue accent bar, dark gradient) | `name`, `title` |
| `ticker` | Bottom-edge scrolling crawl, speed-controlled | `text`, `speed` (px/s) |
| `custom` | User HTML + inline `<style>` with `{{placeholders}}` + CSS animations | `html`, `name`/`title`/`text` for substitution |

Graphics only render on channels whose template is **`lowerthird`** (screen or NDI). Fullscreen
and stage channels never receive `graphic:update`.

---

## Architecture — the overlay bus

`src/main/output/manager.js` holds a module-level `overlay` state, **independent of**
`state.livePayload` (the program bus):

```js
let overlay = { nameTitle: null, ticker: null, custom: null };
//   nameTitle = { name, title } | null
//   ticker    = { text, speed } | null
//   custom    = { html } | null   (html already has placeholders substituted)
```

- Mutators: `graphicShow(nameTitle)` / `graphicHide()`, `tickerShow(text, speed)` / `tickerHide()`,
  `customShow(html)` / `customHide()`. Each calls `broadcastGraphic()`.
- `broadcastGraphic()` sends `graphic:update` (the whole `overlay` object) to **lower-third
  windows only** (`getLowerThirdWindows()` detects them by loaded URL, same pattern as
  `getAllStageWindows()`), then notifies the renderer via `output:overlay-changed`.
- New lower-third windows are synced on `did-finish-load` via `sendGraphicToWindow(win)`
  (added in both `createMonitorWindow` and `createNdiWindow`).
- `getState()` now includes `overlay`; `getOverlay()` returns the current snapshot.

No interaction with the program bus: a program `clear`/`logo`/`go` does not touch the overlay,
and a graphic show/hide does not touch the program. This is intentional.

---

## Data model

`graphics` table (migrations in `src/main/db/schema.js`):
- **v10** — creates the table (`lower_third`, `ticker`).
- **v11** — rebuilds it to add the `custom` kind + an `html` column (CHECK can't be altered in
  place). FK-off during migrations; the table has no FKs.

```sql
graphics (
  id, kind TEXT CHECK(kind IN ('lower_third','ticker','custom')),
  label, name, title, text, html,
  speed INTEGER DEFAULT 100, order_index INTEGER DEFAULT 0,
  created_at, updated_at
)
```

CRUD in `src/main/db/graphics.js`: `list / get / create / update / del / reorder`.

---

## IPC surface

CRUD — `src/main/ipc/graphics.ipc.js` (registered in `index.js` via `registerGraphicsIpc`):
`graphics:list | get | create | update | delete | reorder` → `window.cue.graphics.*`.

Live overlay — added to `src/main/ipc/output.ipc.js`:
- `output:graphic:show` / `output:graphic:hide` → `window.cue.output.graphic.show(nameTitle)` / `.hide()`
- `output:ticker:show`  / `output:ticker:hide`  → `window.cue.output.ticker.show(text, speed)` / `.hide()`
- `output:custom:show`  / `output:custom:hide`  → `window.cue.output.graphic.showCustom(html)` / `.hideCustom()`
- `output:overlay:get` → `window.cue.output.overlay.get()`

Renderer event: `output:overlay-changed` (allow-listed in `preload.js` `on()`), payload is the
full `overlay` object. Output windows receive `graphic:update` via
`output-preload.js` → `window.cueOutput.onGraphicUpdate(cb)`.

---

## Output rendering — `src/output/lowerthird.{html,css,js}`

Added below the existing lyric band (`#lowerthird`), all independent of it:
- `#lt-namebar` (`#nt-name` + `#nt-title`) — the built-in bug. `body.has-ticker` lifts it 64px
  so it clears the ticker when both are up.
- `#lt-ticker` > `#ticker-inner` — the crawl. `padding-left:100%` parks the text off-screen
  right; `@keyframes ticker-crawl` translates `-100%`; JS sets `animationDuration =
  scrollWidth / speed`, restarting the animation each show.
- `#lt-custom` — a **Shadow DOM** host. User HTML is injected as
  `<style>:host{…}</style><div class="cue-root cue-in">…user html…</div>`. CSS is fully
  isolated. On hide, the root swaps to `.cue-out` and is removed after 800ms (exit-animation
  window). Scripts are **not** executed (innerHTML injection) — CSS animations only.

`lowerthird.js` handler:
```js
window.cueOutput.onGraphicUpdate((o) => {
  setNameTitle(o && o.nameTitle);
  setTicker(o && o.ticker);
  setCustom(o && o.custom);
});
```

The lyric `onSlideUpdate` handler is untouched and does **not** clear the overlay layers.

---

## Custom HTML contract

- Placeholders `{{name}}`, `{{title}}`, `{{text}}` are substituted (values HTML-escaped) by
  `fillPlaceholders(html, vals)`, exported from `GraphicsEditor.jsx`. Substitution happens in
  the renderer at fire time (`GraphicsPanel.take`) and in the editor preview — the manager
  stores/sends the already-substituted HTML string.
- Content is wrapped in `.cue-root`; it gets `.cue-in` on take and `.cue-out` on clear. Author
  enter/exit animations with `.cue-in .yourEl { animation… }` / `.cue-out .yourEl { … }`.
- A one-click **Starter** template in the editor demonstrates the full pattern.

---

## Operator UI

- `src/renderer/panels/GraphicsPanel.jsx` — the Graphics tab. Quick-ticker bar (ad-hoc, no
  save), grouped cards (Name/Title, Custom HTML, Tickers), per-card **Take/Clear**, **Clear All**,
  edit/delete. Live state via `output:overlay-changed` + initial `output.overlay.get()`; cards
  show a red "Live" badge when their content matches the current overlay slot.
- `src/renderer/components/GraphicsEditor.jsx` — modal editor. Kind tabs (locked when editing),
  kind-specific fields, custom HTML editor with placeholder-insert chips + Starter, and a
  1920×1080 scaled live **preview** (native render for built-in kinds; sandboxed iframe with
  `srcDoc` for custom; **Replay** re-triggers animation).
- `src/renderer/panels/LibraryPanel.jsx` — adds the `graphics` tab and renders `<GraphicsPanel />`.

---

## Files touched

New: `src/main/db/graphics.js`, `src/main/ipc/graphics.ipc.js`,
`src/renderer/panels/GraphicsPanel.jsx`, `src/renderer/components/GraphicsEditor.jsx`.
Modified: `src/main/db/schema.js` (v10, v11), `src/main/output/manager.js`,
`src/main/ipc/output.ipc.js`, `src/main/preload.js`, `src/main/output-preload.js`,
`src/main/index.js`, `src/output/lowerthird.{html,css,js}`, `src/renderer/panels/LibraryPanel.jsx`.

---

## Known limitations / deferred

1. **Operator monitor doesn't render overlays.** The Preview/Live `MonitorFrame` shows the
   program payload only; graphics are confirmed via the Graphics-tab Live badges, the real
   output, or Multiview. Natural next step: render the overlay in `MonitorFrame` when a
   lower-third channel is selected (subscribe to `output:overlay-changed`, draw name/title +
   ticker + custom shadow root at native scale).
2. **No rundown integration.** Graphics are fired from the tab, not added as `service_items`
   (`item_type='graphic'` was deliberately skipped to avoid program-bus coupling). Could be
   added later as a quick-fire rundown row that calls the overlay bus, not `output.go`.
3. **`linked_channel_id`** is still dormant — graphics target all lower-third channels, not a
   specific "L3 over PGM" pairing.
4. **Custom HTML scripts don't run** (CSS animations only). Fine for lower-thirds; JS-driven
   templates (e.g. the OBS plugin's) are out of scope by design.
5. **Editor preview fonts**: the sandboxed iframe can't load bundled Inter (no base URL), so it
   falls back to system sans. The real output uses bundled Inter.

---

## Testing checklist (after restart)

1. Settings → Output Channels → create a channel with template **Lower Third**, assign a screen
   or make it NDI.
2. Library → **Graphics** → New Graphic → try each kind; for Custom HTML click **Starter**, edit
   name/title, watch preview + Replay, Save.
3. **Take** a name/title card → bug appears on the L3 channel only; the fullscreen program is
   untouched. **Clear** removes it.
4. Quick Ticker → type → Start/Stop (crawl at bottom; coexists with a name/title bug).
5. Custom card → Take → CSS enter animation plays; Clear → exit animation then removal.
6. Confirm a program `Clear`/`GO` does not disturb the live graphic, and vice versa.

---

## Commit

Uncommitted as of this handoff. Suggested type: `feat`. Run `/knowledge-update` to sync
`plan/cue-master-reference.md` + `CLAUDE.md` (schema now v11; new `graphics` table; `window.cue.graphics.*`
+ `window.cue.output.graphic/ticker` IPC; `output:overlay-changed` event; Graphics tab/editor)
and commit/push.
