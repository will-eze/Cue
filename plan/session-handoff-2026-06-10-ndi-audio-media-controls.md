# Session Handoff — NDI Audio Toggle & Media Controls
**Date**: 2026-06-10
**Session focus**: NDI per-channel audio muting, media control broadcast to all outputs, confidence monitor (stage) media control responsiveness

---

## Context Coming In

The previous session had hard-coded NDI audio to always be muted (`el.muted = true` unconditionally for all NDI windows). The user wanted a per-channel toggle instead. Separately, media play/pause controls existed in the operator UI but were not reaching the confidence monitor (stage window), and the NDI audio toggle button was accidentally restarting video on screen output windows.

---

## Problem 1: NDI Audio Should Be User-Configurable

### What was done before this session
NDI windows were force-muted with no user control. Audio elements had `el.muted = true` unconditionally whenever the window had the `?alpha=1` query param.

### Approach taken
**Schema change (v9):**
Added `ndi_audio_muted INTEGER NOT NULL DEFAULT 1` column to `output_channels` table via a new migration in `src/main/db/schema.js`.

```js
function v9(database) {
  database.exec(`
    ALTER TABLE output_channels ADD COLUMN ndi_audio_muted INTEGER NOT NULL DEFAULT 1;
  `);
}
```

**`fullscreen.js` — separated IS_NDI from MUTE_AUDIO:**
Before: one flag `IS_NDI` controlled both transparency AND audio muting.
After: two separate constants read from separate query params.

```js
// Before
const IS_NDI = new URLSearchParams(location.search).get('alpha') === '1';
// IS_NDI gated both transparency and el.muted

// After
const IS_NDI    = new URLSearchParams(location.search).get('alpha') === '1';
const MUTE_AUDIO = new URLSearchParams(location.search).get('mute')  === '1';
if (IS_NDI) { /* transparency only */ }
// MUTE_AUDIO gates all el.muted = true calls
```

`MUTE_AUDIO` is used in three places in `fullscreen.js`:
1. `startLoopMedia` make() factory: `if (MUTE_AUDIO) el.muted = true;`
2. `setForegroundMedia` audio branch: `<audio ... ${MUTE_AUDIO ? ' muted' : ''} ...>`
3. `setForegroundMedia` video branch: `<video ... ${MUTE_AUDIO ? ' muted' : ''} ...>`

**`manager.js` — NDI window creation passes mute param:**
```js
win.loadFile(getTemplatePath(channel.template || 'fullscreen'), {
  query: { alpha: '1', mute: channel.ndi_audio_muted !== 0 ? '1' : '0' },
});
```

**`output.ipc.js` — CREATE and UPDATE handlers:**
- CREATE insert now includes `ndi_audio_muted` column with correct fallback default of 1.
- `allowed` array for UPDATE includes `'ndi_audio_muted'` so the field can be patched via `output:channels:update`.

**`OutputChannels.jsx` — UI toggle:**
- Default `newChannel` state includes `ndi_audio_muted: 1`.
- Create form NDI section changed from `grid-cols-3` to `grid-cols-4`, 4th column is a "Mute audio" checkbox.
- NDI channel card footer shows a toggle button with `volume_off` / `volume_up` Material Symbol icon and "Audio Muted" / "Audio On" label.
- Button calls `onUpdate({ ndi_audio_muted: channel.ndi_audio_muted ? 0 : 1 })`.

### Result: WORKED
The toggle correctly persists to the database and the window is re-created with the correct `?mute=` param when toggled.

---

## Problem 2: NDI Audio Toggle Was Restarting Video on Screen Output Windows

### Symptom
Clicking the mute/unmute button in the Settings UI caused the live video on screen output windows to visibly restart (jump back to the beginning). The audio toggle should have had zero effect on screen windows.

### Root cause identified
`output:channels:update` IPC handler calls `syncChannel(id)`. For NDI channels, `syncChannel` closes and re-creates the NDI window (which is correct — the new `?mute=` param needs a fresh load). However, at the end of `syncChannel` (and also in `openMonitor` and the NDI `did-finish-load` callback), the code called `sendCurrentState()`.

`sendCurrentState()` broadcasts `slide:update` to **every window in the `windows` Map**. This meant screen output windows received a new `slide:update` payload, which caused them to re-run `setForegroundMedia` or `setBackground`, restarting media from scratch.

### Fix applied
Created a new `sendStateToWindow(win, channel)` function that sends the current state to **one specific window only**.

```js
function sendStateToWindow(win, channel) {
  if (win.isDestroyed()) return;
  if (state.displayMode === 'idle') {
    win.webContents.send('slide:update', { type: 'clear', ... });
    return;
  }
  if (state.displayMode === 'cleared') {
    win.webContents.send('slide:update', { type: 'clear', backgroundPath: state.livePayload?.backgroundPath ?? null, ... });
    return;
  }
  if (state.displayMode === 'logo') {
    // resolves logo for this specific channel
    win.webContents.send('slide:update', { type: 'logo', logoPath, logoScaleMode, ... });
    return;
  }
  win.webContents.send('slide:update', { ...state.livePayload, type: 'content' });
}
```

Replaced ALL `sendCurrentState()` calls inside `did-finish-load` event handlers (there are three: screen monitor window, NDI window, stage window) with `sendStateToWindow(win, channel)`.

`sendCurrentState()` itself was kept for legitimate broadcasts (go/clear/logo operations that genuinely need to reach all windows).

### Result: WORKED
Toggling NDI audio mute now only affects the NDI window being re-created. Screen outputs continue playing without interruption.

---

## Problem 3: Confidence Monitor (Stage) Media Controls Not Working

### Symptom
Pressing pause/play in the operator transport bar had no effect on the stage window's video preview. Screen output windows responded correctly. NDI output windows responded correctly. Stage window ignored the control entirely.

### Root cause analysis

**Why screen outputs worked**: `fullscreen.js` has always had an `onMediaControl` handler:
```js
window.cueOutput.onMediaControl((action) => {
  const el = document.getElementById('cue-media-el');
  if (!el) return;
  if (action === 'play') { el.play(); }
  else if (action === 'pause') { el.pause(); }
  else if (action === 'restart') { el.currentTime = 0; el.play(); }
});
```

**Why stage didn't work**: `stage.js` had NO `onMediaControl` handler whatsoever. The stage video (`showStageVideo`) was managed entirely by the `onSlideUpdate` path and a sync loop — there was no code path for the `media:control` IPC event.

**Secondary issue — `mediaControl()` only targeted DB-queried windows**: The original `mediaControl` function used `getAllOutputWindows()` which queries `output_channels` + `channel_monitors` DB tables to build the window list. The stage window is stored in the `windows` Map under a `'stage'` key but is NOT in the DB tables (it has no channel row). So even if `stage.js` had a handler, the IPC event was never sent to it.

### Fix 1: Added onMediaControl handler to stage.js
```js
let stagePausedByCtrl = false; // module-level flag

// In clearStageVideo:
stagePausedByCtrl = false;

// In showStageVideo onMediaTime callback:
stageTimeUnsub = window.cueOutput.onMediaTime((t) => {
  if (!v || !Number.isFinite(t) || stagePausedByCtrl) return; // guard added
  ...
});

// Fallback sync timer:
stageSyncTimer = setInterval(() => {
  if (!mediaStartAt || !v || stagePausedByCtrl || v.paused || ...) return; // guard added
  ...
}, 5000);

// New handler at bottom of stage.js:
if (window.cueOutput.onMediaControl) {
  window.cueOutput.onMediaControl((action) => {
    if (action === 'pause') {
      stagePausedByCtrl = true;
      if (stageVideoEl) stageVideoEl.pause();
    } else if (action === 'play') {
      stagePausedByCtrl = false;
      if (stageVideoEl) stageVideoEl.play().catch(() => {});
    } else if (action === 'restart') {
      stagePausedByCtrl = false;
      if (stageVideoEl) { stageVideoEl.currentTime = 0; stageVideoEl.play().catch(() => {}); }
    }
  });
}
```

The `stagePausedByCtrl` flag is critical — without it, the `onMediaTime` sync loop would immediately re-play the video after an operator pause (the sync loop sees the video is paused and at a different time than the output, so it seeks and plays it).

### Fix 2: Changed mediaControl() to iterate raw windows Map
```js
// Before (broken — misses stage window):
export function mediaControl(action) {
  for (const win of getAllOutputWindows()) {
    try { if (!win.isDestroyed()) win.webContents.send('media:control', action); } catch {}
  }
}

// After (correct — all windows including stage):
export function mediaControl(action) {
  for (const [, win] of windows) {
    try { if (!win.isDestroyed()) win.webContents.send('media:control', action); } catch {}
  }
}
```

### Result: CODE IS CORRECT — requires full app restart to take effect
`stage.js` and `manager.js` (main process) are static/compiled files not served by Vite dev server. Changes to these files require killing and restarting the Electron app. The user needs to do a full restart for the fix to load.

---

## Problem 4: Background Opacity Appeared Washed Out (Reported at End of Session)

### Symptom
User asked: "Did you change the opacity of the background? The backgrounds look washed on my output monitors."

### Investigation
No changes were made to any visual rendering properties this session. Specifically:
- `setBackground()` in `fullscreen.js` — untouched
- `applyStyle()` in `fullscreen.js` — untouched  
- `fullscreen.css` — not read or modified
- CSS `opacity`, `filter`, `backdrop-filter` — not touched anywhere
- `sendStateToWindow` spreads `...state.livePayload` identically to the original `sendCurrentState`

The `IS_NDI`/`MUTE_AUDIO` split is **functionally identical** for screen windows. Screen windows never had `?alpha=1`, so `IS_NDI` was always false before and after. The transparent background logic in `fullscreen.js` applies only to NDI windows.

### Conclusion
The washed appearance is NOT caused by this session's edits. Possible real causes:
- Display HDR mode switch
- Pre-existing CSS in `fullscreen.css` not noticed before
- Different background image/asset loaded
- Monitor calibration

---

## Files Modified This Session

| File | Change |
|---|---|
| `src/main/db/schema.js` | Added v9 migration: `ALTER TABLE output_channels ADD COLUMN ndi_audio_muted INTEGER NOT NULL DEFAULT 1` |
| `src/output/fullscreen.js` | Split `IS_NDI` / `MUTE_AUDIO` constants; `MUTE_AUDIO` gates all audio muting |
| `src/main/output/manager.js` | Added `sendStateToWindow(win, channel)`; replaced all 3 `did-finish-load` → `sendCurrentState()` calls with `sendStateToWindow`; changed `mediaControl()` to iterate raw `windows` Map |
| `src/main/ipc/output.ipc.js` | CREATE includes `ndi_audio_muted`; `allowed` update fields includes `ndi_audio_muted` |
| `src/renderer/settings/OutputChannels.jsx` | Default state, create form (4-col grid), card footer toggle button |
| `src/output/stage.js` | Added `stagePausedByCtrl` flag; guards in `onMediaTime` and `stageSyncTimer`; new `onMediaControl` handler block |

---

## Approaches That Did NOT Work / Were Superseded

### Attempt 1: Using sendCurrentState() for newly-opened windows
Initially, `did-finish-load` callbacks called `sendCurrentState()` to initialize the new window with the current state. This worked for initialisation but caused all OTHER windows to also receive a new `slide:update`, restarting any playing media. Superseded by `sendStateToWindow`.

### Attempt 2: Using getAllOutputWindows() for media control broadcast
`getAllOutputWindows()` queries the DB for active channels and monitors. This correctly reaches screen and NDI windows but misses the stage window (which has no DB row). Fixed by iterating the raw `windows` Map instead.

---

## Architecture Notes for Next Session

### Why static file changes require full restart
`src/output/stage.js`, `src/output/fullscreen.js`, `src/output/stage.html`, `src/output/fullscreen.html`, and `src/output/*.css` are **plain files loaded directly from disk** by `BrowserWindow.loadFile()`. They are NOT served by Vite's dev server and NOT hot-reloaded. Any change to these files requires:
1. Stopping the app (`Ctrl+C`)
2. Restarting (`npm start`)

Main process files (`src/main/**`) also require a full restart.

Only `src/renderer/**` files (React components) benefit from Vite HMR.

### windows Map key scheme
The `windows` Map in `manager.js` uses these key conventions:
- Screen monitor windows: `monitor-{monitorId}` (e.g. `monitor-3`)
- NDI channel windows: `ndi-{channelId}` (e.g. `ndi-1`)
- Stage window: `'stage'`

`getAllOutputWindows()` returns only screen/NDI windows. To reach ALL windows (including stage), iterate `windows` directly.

### stagePausedByCtrl flag
This flag in `stage.js` is essential for correct pause behaviour. The stage video syncs to the output window's `currentTime` via `onMediaTime` IPC. Without the flag, pausing would be immediately undone by the sync loop. The flag short-circuits the sync loop until an explicit `play` or `restart` command clears it. It is also cleared by `clearStageVideo()` so a new slide starting always begins in the playing state.

### NDI window mute vs IS_NDI
`IS_NDI` (`?alpha=1`) — structural: controls transparency and suppresses time-reporting (NDI window is not the clock master).
`MUTE_AUDIO` (`?mute=1`) — user preference: controls whether audio elements are muted. These are now independent and can be set separately if needed in future.

---

## Outstanding / Not Tested

- **Stage media controls**: All code is in place. Requires a full app restart to verify. The user had not confirmed working as of end of session.
- **Background wash**: Root cause not identified. User reported it at end of session; it is not caused by this session's changes.
