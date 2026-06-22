# Plan 2 — NDI Audio + RTMP Streaming (direct-to-YouTube/Facebook)

## Context

**Problem.** Two related gaps:

1. **NDI carries no audio today.** `src/main/output/ndi.js` only ever calls
   `sender.video(...)`; the sender is created with `clockAudio: false` and there is
   no `sender.audio()` call anywhere. The offscreen NDI window is `offscreen: true`
   (no audio device) and the template is muted by default
   (`ndi_audio_muted DEFAULT 1`, schema). So an NDI receiver gets a silent feed —
   in-room video plays with sound, online/NDI viewers hear nothing.
2. **No direct streaming.** Like ProPresenter, we want to push the composited
   program output (lyrics + graphics + video backgrounds) as one encoded feed over
   **RTMP** to YouTube/Facebook, so online viewers get a single self-contained
   broadcast — no external capture/encoder box.

**Goal.** Build the shared **program-audio PCM tap** once, then use it for (a) NDI
audio and (b) the audio track of an RTMP stream whose video is the already-existing
composited frame feed. Reuse the bundled `ffmpeg` (no new dependency).

**Prerequisite.** Plan 1 (`plan/in-room-audio-output-picker.md`) establishes audio
routing in the primary audio window. This plan **extends** that: the PCM tap is
cleanest built with the Web Audio graph, at which point in-room device routing may
migrate from `HTMLMediaElement.setSinkId` to `AudioContext.setSinkId`
(Electron 42 / Chromium ~144 supports it — see `project_electron42_migration`).

## Why Cue is well-positioned

- **Composited video source already exists.** `startNdiCapture` (`manager.js:265`)
  runs an offscreen `BrowserWindow` rendering the full output template and emits a
  BGRA buffer per `paint` event at a target fps; that buffer
  (`image.toBitmap()`, `manager.js:292`) is exactly what an encoder needs.
- **Encoder already ships.** `src/main/youtube/bin.js` auto-downloads `ffmpeg` into
  `userData/bin` (`ffmpegPath()`, `ensureBinaries()`); ffmpeg is also an RTMP
  encoder/pusher. No new `extraResource`, no installer bloat.
- **CSP is not a factor** — ffmpeg performs the RTMP network egress from the main
  process, not a renderer `fetch`, so the packaged-CSP trap (CLAUDE.md "Media URLs"/
  Security) does not apply.
- **NDI frame-drop discipline** (`ndi.js:67` `inflight` guard) is the model to copy
  for encoder backpressure.

## Component A — Shared program-audio PCM tap

The `paint` event is **video only**; program audio lives only in the primary audio
screen window (`isPrimaryAudioMonitor`, `manager.js:206`). Build one tap there.

- In the primary audio output window, route the media element through Web Audio:
  `MediaElementAudioSourceNode → AudioContext`. Connect to `ctx.destination` so it
  is still audible in-room (and apply `AudioContext.setSinkId` for Plan 1's device
  choice). Add a parallel tap: an `AudioWorkletNode` (preferred) or
  `MediaStreamAudioDestinationNode` producing **Float32 PCM**.
- Forward PCM frames to main over IPC (or a `MessageChannel` for throughput) with a
  capture timestamp (`Date.now()` relative to a stream/NDI epoch) for A/V alignment.
- Capture once as Float32; convert per sink (NDI wants float; ffmpeg takes
  `f32le`/`s16le`).
- Apply the same drop/jitter discipline as video, but prefer a **small jitter buffer**
  over dropping — audio underruns are audible.

## Component B — NDI audio

- Add `ndi.sendAudio(channelId, pcm, sampleRate, channels, timestamp)` calling
  grandi's `sender.audio(...)`. **Verify grandi's audio-frame API** (planar float,
  `sampleRate`, `noSamples`, `noChannels`, `channelStrideBytes`) — mirror the existing
  `sender.video(...)` shape in `ndi.js:70`.
- Create the sender with `clockAudio: true` (or clock manually); feed from the tap.
- `ndi_audio_muted` (already a column + UI toggle in `OutputChannels.jsx`) finally
  becomes meaningful: gate whether the tap is forwarded to that channel.
- NDI is *designed* for separate A/V frame types with timestamps, so receiver-side
  A/V sync is easier here than for RTMP.

## Component C — RTMP streaming

### Video
- Tap the BGRA buffer already produced in `startNdiCapture` (`manager.js:284`): add a
  stream sink next to `ndi.sendFrame(...)`. For streaming **without** an NDI channel,
  spin a dedicated offscreen window reusing the `createNdiWindow` +
  `startNdiCapture` pattern (`manager.js:221`, `:265`) **minus** the NDI sender.

### Pipeline (new module `src/main/stream/rtmp.js`)
- Spawn `ffmpeg` (`ffmpegPath()`), two inputs:
  - video: `-f rawvideo -pix_fmt bgra -s WxH -r FPS -i pipe:0`
  - audio: `-f f32le -ar 48000 -ac 2 -i <audio pipe/fd>`
- Encode: `-c:v h264_videotoolbox` (macOS) / `h264_nvenc`/`h264_qsv` (Windows) with
  `libx264 -preset veryfast` fallback; `-g <2*fps>` (YouTube ~2s GOP),
  `-b:v` from a bitrate preset; `-c:a aac -b:a 160k`; `-f flv rtmp://.../live2/<key>`.
- **Probe encoders** via `ffmpeg -encoders` once and pick HW→SW. (The pinned
  `eugeneware/ffmpeg-static b6.0` build — `bin.js:42` — must be confirmed to include
  videotoolbox/nvenc; if not, libx264 is the guaranteed path.)
- **Backpressure:** copy the `inflight`/drop-frame guard from `ndi.js:67` for the
  video stdin write; never queue 8 MB buffers.
- **Reconnect** on RTMP drop; surface status (`idle/connecting/live/error`) via an
  IPC event bus to the operator.

### A/V sync
- Separate video(paint) + audio(WebAudio) pipelines have independent clocks → drift.
  Timestamp both off a shared stream epoch and feed ffmpeg with PTS (or
  `-use_wallclock_as_timestamps`) / `-itsoffset` trim. Worship streaming tolerates a
  few tens of ms. **Fallback design if sync proves hard:** a dedicated hidden
  (non-offscreen) renderer + `MediaRecorder` producing already-muxed webm chunks →
  ffmpeg remux to FLV (A/V pre-synced, at the cost of a second render + transcode).

### Quality, resolution & frame rate
- **Exposable** — the offscreen frame source is already parameterized
  (`ndi_width`/`ndi_height`/`ndi_fps` columns; `startNdiCapture` reads
  `channel.ndi_fps`; `setFrameRate(fps)` + window size set the output). The stream
  resolution is **independent of the in-room screen** (render the template at any
  size), so you can project native res and stream 1080p.
- **The bottleneck is the BGRA paint→`image.toBitmap()` copy, not the encoder or
  YouTube.** 1080p30 ≈ 240 MB/s of main-process bandwidth; **4K60 ≈ ~2 GB/s** (~8×
  what NDI handles today). Achievable on strong hardware but frames will drop under
  load (the `inflight` guard drops rather than stalls — keep that behaviour).
- **HW encoder gate:** 1440p60 / 2160p60 are not viable on software libx264 — gate
  those tiers on detected `h264_videotoolbox`/`nvenc`/`qsv` (Component C "Probe
  encoders").
- **Ship presets:** 720p30 / 1080p30 / **1080p60** as safe defaults; 1440p60 /
  2160p60 as "advanced — requires HW encoder + strong CPU & upload." 1080p30–60 is
  the worship sweet spot (4K60 ingest ≈ 20–51 Mbps upload). Each preset carries a
  matching `-b:v` and `-maxrate`/`-bufsize`.

### Authentication (no OAuth for v1)
- **Streaming the feed needs NO OAuth** — RTMP + a **stream key**. The user copies
  the ingest URL + stream key from YouTube Studio (or Facebook/Twitch/any RTMP
  target) into Cue; ffmpeg pushes to `rtmp://a.rtmp.youtube.com/live2/<key>`. Exactly
  the OBS model. A *persistent* key with auto-start even goes live on ingest.
- **OAuth is only needed for broadcast *management*** (programmatically create/
  schedule a broadcast, set title/thumbnail/privacy, one-click go-live from inside
  Cue) via the YouTube Live Streaming API — Google Cloud project, OAuth 2.0 consent,
  token refresh, and Google app verification for public distribution. **Out of scope
  for v1; a clearly-separable later enhancement**, not a dependency of the core
  streaming feature.

### Config & secrets
- Settings: RTMP base URL + stream key, resolution, fps, bitrate preset. Store under
  `settings` keys. **Stream key is sensitive** — it lives in `cue.db`, which is
  backed up (`autoSnapshot`) and may be synced; flag this and consider excluding the
  key from backup payloads or storing via the OS keychain.

### UI
- New `src/renderer/settings/StreamSettings.jsx` (destination URL/key, quality).
- A "Go Live / Stop Stream" control + status indicator in the operator (use the
  semantic colours: red = on-air per CLAUDE.md UI guard rails).
- **Multistream** (YouTube + Facebook at once) later = ffmpeg `tee` muxer or a
  restream service — out of scope for v1.

## Considerations / risks

- **Performance:** one extra H.264 encode at 1080p30 on top of NDI + screen output.
  The frame source is already produced (free); only encoding is new. Prefer HW
  encoders.
- **`ensureBinaries()`** must run before first stream (ffmpeg may not be downloaded
  yet if YouTube was never used) — reuse the existing single-flight provisioning.
- **Grandi audio API** is the main unknown to verify before committing to Component B.
- **No new native dependency**; ffmpeg already handled by the packaging hook only via
  userData download (not bundled) — nothing to add to `forge.config.js`.
- Schema: only a new migration if any of these need a DB column; settings-key storage
  avoids it. If a migration is added, reset `VERSION_MINOR`/`PATCH` to 0 per CLAUDE.md.

## Files to touch (indicative)

- `src/output/media-player.js` / `fullscreen.js` — Web Audio tap + PCM forwarding
  (shared with Plan 1's routing).
- `src/main/output-preload.js` — PCM/MessageChannel bridge.
- `src/main/output/ndi.js` — `sendAudio()` + `clockAudio`.
- `src/main/output/manager.js` — stream sink off the paint buffer; dedicated stream
  offscreen window; PCM intake; wiring.
- `src/main/stream/rtmp.js` (new) — ffmpeg lifecycle, encoder probe, backpressure,
  reconnect, status.
- `src/main/youtube/bin.js` — reuse `ffmpegPath()`/`ensureBinaries()` (confirm HW
  encoder availability).
- `src/main/ipc/` (new `stream.ipc.js`) — start/stop/status, config get/set.
- `src/renderer/settings/StreamSettings.jsx` (new) + operator Go-Live control.

## Verification (end-to-end)

1. **NDI audio:** start an NDI channel with `ndi_audio_muted = 0`, GO a video clip;
   open NDI Studio Monitor / OBS NDI → confirm audio plays and stays in sync.
2. **RTMP smoke (video-only first):** stream rawvideo→ffmpeg→a local RTMP sink
   (`ffmpeg -listen 1 -i rtmp://127.0.0.1/live`) and play back to prove the
   frame→encode→FLV pipe before adding audio.
3. **RTMP full:** add the audio input; stream to a real YouTube "Stream now" key;
   confirm picture + sound + acceptable A/V sync in YouTube's preview.
4. **Reconnect:** kill network briefly → stream auto-recovers; status indicator
   reflects state transitions.
5. `npm run package` + launch packaged app: confirm `ensureBinaries()` fetches ffmpeg
   and streaming works in a build (encoder availability is build/OS-specific).
