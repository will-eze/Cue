# Plan 1 — In-Room Program Audio: Configurable Output Device

## Context

**Problem.** Cue currently has no way to choose which physical audio device the
in-room program audio plays through. Program audio is emitted by the `<video>`/
`<audio>` elements created in the output template (`src/output/fullscreen.js`),
which always use the OS **default** output device. There is no `setSinkId` call
anywhere in the codebase. In a real venue you want program audio (bumper/clip
sound, lyric-video audio) to go to a specific interface — the PA / FOH mixer —
not the laptop's default speakers.

**Goal.** Add a "Program audio output" device picker so the operator can route
in-room program audio to a chosen output device. Default = system default
(today's behaviour, fully backward compatible). This is the standalone, shippable
piece. Plan 2 (NDI/RTMP audio + streaming) builds the *online* audio path on top
and may later migrate the routing mechanism from `HTMLMediaElement.setSinkId` to
`AudioContext.setSinkId` — see `plan/ndi-rtmp-audio-streaming.md`.

## Key facts from the codebase

- **One audio window by design.** `isPrimaryAudioMonitor()` (`src/main/output/manager.js:206`)
  guarantees exactly one unmuted screen window emits program audio; stage/NDI/
  preview are silent (`baseMuted`, `manager.js:183`). → A **single global device
  setting** is the correct granularity; per-channel would need a new
  `output_channels` column = a schema migration = a forced MAJOR version bump
  (CLAUDE.md "Dev Commands"). Avoid that.
- **Audio element creation:** `src/output/fullscreen.js:157` builds a fresh
  `<video>`/`<audio>` per foreground clip and attaches it via
  `window.CueMediaPlayer.attach()` (`src/output/media-player.js:42`). Because each
  GO creates a NEW element, `setSinkId` must be (re)applied **per element**, not once.
- **Window query params** are how the template learns its role today (`mute`,
  `program`, `graphics`) — set in `createMonitorWindow` (`manager.js:184-192`).
- **Runtime push bus** pattern: `media:transport` is broadcast via
  `webContents.send` and received through `cueOutput.onMediaTransport`
  (`src/main/output-preload.js:14`). Mirror this for live device changes.
- **Device enumeration** already proven: `navigator.mediaDevices.enumerateDevices()`
  filtered by `kind` (`src/renderer/settings/ScriptureDetectionSettings.jsx:35`
  uses `audioinput`; we want `audiooutput`).
- **Settings storage:** key/value `settings.get/set` via `settings:get`/`settings:set`
  (`src/main/ipc/settings.ipc.js:10-11`). No migration needed.
- **UI home:** `src/renderer/settings/OutputChannels.jsx` already renders per-channel
  audio (Mute) controls — natural place for one global "Program audio output" dropdown
  at the top of the panel.
- **No session permission handlers exist** in `src/main/index.js` (only the
  `onHeadersReceived` CSP block at `index.js:289`). `setSinkId` and device **labels**
  need permission — must be added (see Considerations).

## Approach

Store one global device descriptor; apply it in the output window on every media
element; let the operator pick it from a dropdown.

### 1. Persist the choice (settings key, no migration)
- New settings key `program_audio_device` holding `{ deviceId, label, groupId }`
  or `null` (= system default).
- Reuse generic `settings:get`/`settings:set`, OR add a thin dedicated pair
  `output:getAudioDevice` / `output:setAudioDevice` in `src/main/ipc/output.ipc.js`
  so the setter can ALSO broadcast the change to live windows (preferred — keeps
  the broadcast server-side).

### 2. Apply in the output window (`src/output/`)
- Add a helper (e.g. `src/output/audio-sink.js`, or inline in `media-player.js`)
  `applySink(el, descriptor)` that:
  1. `enumerateDevices()` → find best match: **deviceId first, then `label`,
     then `groupId`** (deviceIds are salted per-origin, so the value chosen in the
     operator renderer may not match in the output window's `file://` origin — the
     label/groupId fallback is what makes it robust).
  2. `await el.setSinkId(match.deviceId)` (wrapped in try/catch; on failure leave
     default).
- Call `applySink` in `fullscreen.js` right after the element is created
  (`fullscreen.js:157-176`), and on a runtime device-change event.
- Only the primary audio window matters; applying on muted windows is harmless, so
  no extra gating required (keeps it simple).

### 3. Wire initial + runtime delivery
- **Initial:** add the descriptor as a query param in `createMonitorWindow`
  (`manager.js:184`), alongside `mute`. The template reads it on load.
- **Runtime:** new IPC `audio:output-device` broadcast (mirror `media:transport`)
  sent to all output windows when the setting changes; expose
  `onAudioOutputDevice(cb)` on the `cueOutput` bridge (`src/main/output-preload.js`).

### 4. Settings UI (`src/renderer/settings/OutputChannels.jsx`)
- A single labelled `<select>` "Program audio output" near the top of the panel.
- Options from `enumerateDevices()` filtered to `kind === 'audiooutput'`, plus a
  "System default" entry (stores `null`). Persist via the IPC setter; the setter
  triggers the broadcast so the change is audible without restarting output.

## Considerations / risks

- **Permissions (must handle).** `setSinkId` is gated by Chromium's
  `speaker-selection` permission, and device **labels** are blank until a media
  permission is granted. Add a `session.setPermissionRequestHandler` /
  `setPermissionCheckHandler` in `src/main/index.js` that allows `media` and
  `speaker-selection` for the app's own windows. If labels still come back empty,
  a one-time `getUserMedia({audio:true})` unlocks them (ASR already does this, so
  on machines with detection configured labels are already available).
- **deviceId portability.** If the DB is synced/backed up to another machine the
  stored deviceId won't exist there → the label/groupId fallback degrades to
  "device not found" → system default. Acceptable; document it. (Device routing is
  inherently machine-specific.)
- **Per-element re-apply.** Easy to regress — every new clip = new element. Keep
  `applySink` inside the element-creation path, not a one-shot init.
- **No CSP impact, no native deps, no schema change** → no MAJOR bump; bump
  `VERSION_MINOR` (feature, no migration) per CLAUDE.md.

## Files to touch

- `src/main/ipc/output.ipc.js` — get/set + broadcast device descriptor.
- `src/main/output/manager.js` — pass device query param in `createMonitorWindow`;
  broadcast runtime change to output windows.
- `src/main/output-preload.js` — expose `onAudioOutputDevice`.
- `src/output/media-player.js` and/or new `src/output/audio-sink.js` — `applySink`.
- `src/output/fullscreen.js` — call `applySink` on element create + on runtime event.
- `src/renderer/settings/OutputChannels.jsx` — the dropdown.
- `src/main/index.js` — session permission handler for `media`/`speaker-selection`.

## Verification (end-to-end)

1. `npm start`. Settings → Output: confirm the "Program audio output" dropdown lists
   real devices with labels (not blank).
2. Plug in / select a second output (e.g. USB interface or AirPlay). GO a video clip
   with audio on the in-room screen output → audio comes out the **chosen** device.
3. Change the device while the clip is live → audio moves without re-GO (runtime
   broadcast works).
4. Select "System default" → reverts.
5. Restart app → selection persists.
6. `npm run package` and launch the packaged app once — confirm permission handler
   works in a build (dev-invisible CSP/permission differences) and the picker still
   functions.
