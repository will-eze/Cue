## 14. NDI

**Current state:** Fully implemented. NDI channels publish BGRA frames with alpha transparency over the local network. OBS (and any NDI receiver) picks up the source and composites it natively without chroma keying.

### Package: `grandi`
`grandiose` (the original npm package) could not be compiled on macOS (uses `itoa`, a Windows-only function). `grandi` is an actively maintained fork with prebuilt N-API binaries per platform. Loaded via `createRequire(import.meta.url)` to bypass Vite's CJS bundler (a static ESM import would be converted to `require('grandi')`, which fails because grandi is ESM-only).

### Constants (hardcoded in `ndi.js`)
`grandi`'s TypeScript enums are not exported by the native binary — only by the ESM wrapper, which we cannot import in a CJS bundle:
- `FOURCC_BGRA = 1095911234` — 32-bit BGRA pixel format with alpha
- `FOURCC_FLTP = 1884572742` — Float32 **planar** audio (one channel block after another)
- `FORMAT_TYPE_PROGRESSIVE = 1` — progressive scan

### NDI audio
`ndi.sendAudio(channelId, planar, sampleRate, noChannels, noSamples)` sends a `sender.audio()` frame (`fourCC: FLTp`, `channelStrideBytes = noSamples*4`). `planar` is a Buffer of per-channel Float32 blocks. Audio is small and never dropped (gaps are audible) — unlike video it does not gate on the `inflight` flag. The offscreen NDI window is **always locally muted** (`mute:'1'`); its audio is the program-audio tap (§13 *Program-audio tap*) forwarded by `ingestAudioPcm`, gated per channel by `ndi_audio_muted` via `updateAudioTapState`. NDI audio therefore requires a screen (audible) output to exist as the tap source.

### Frame capture strategy
Offscreen rendering (`offscreen: true` BrowserWindow) + `paint` event + `setInterval(invalidate, frameMs)`:
- `invalidate()` forces Chromium's offscreen compositor to render a new frame at the target rate (without it, the compositor throttles repaints for hidden windows)
- `paint` event delivers the CPU BGRA bitmap directly — no async GPU→CPU readback overhead
- A timestamp gate in `onPaint` prevents burst over-firing if invalidate and content changes coincide
- An `inflight` boolean per sender drops frames when the NDI SDK hasn't completed the previous `sender.video()` call — prevents 8MB buffer queue buildup and crashes

### OBS workflow
1. Settings → Output Channels → create NDI type channel
2. Source appears as `"Cue - <name>"` on the local NDI network
3. OBS → Sources → NDI Source → select the source
4. Alpha is preserved — text composites over camera without chroma keying

### NDI INPUT (live video sources) — `src/main/output/ndi-input.js`
Receives network NDI sources (cameras, ATEM/OBS/vMix) and routes them to the program as a full-frame live feed. Schema v31 adds `service_items.item_type = 'live-input'` (content = `{sourceName, name}` JSON; no media_assets row).

**Pipeline:** one persistent `grandi.find()` finder (own senders filtered by `/\(Cue - /` — feedback guard) → per-source `grandi.receive()` at `RGBX_RGBA`/`Bandwidth.Highest` + `grandi.framesync()` → a `setInterval` pump (33ms on program, 100ms preview-only) pulls `fsync.video()` with an in-flight guard and dedupes repeated frames by PTP timestamp. Frames fan out over IPC (`live:frame`, ~8MB RGBA copies) to fullscreen-template windows + the stream window only (`manager.getLiveInputTargets()`); `fullscreen.js` paints them into a cover-fit `<canvas>` (`ImageData` direct — no swizzle). Live-input payloads always hard-cut (`payloadHasVideo`).

**Lifecycle:** `manager.syncLiveInput()` keeps the receiver in lockstep with the display state machine — pulling only while a `liveInput` payload is on program in content mode; clear/logo/idle/outputs-off release the source and its camera tally (`receiver.tally({onProgram})`). Operator preview (`liveInput.previewStart/Stop`, ref-counted) drives ~2fps JPEG thumbnails (`liveinput:preview`, RGBA→BGRA swizzle → nativeImage → 480px JPEG) consumed by the Library **Live** tab and the preview/live monitors — never a capture loop.

**CRASH GUARD:** never `destroy()` the framesync/receiver while a pull is in flight — the pending native `video()` resolves against freed memory and segfaults the app. `stopReceiver` nulls the handles (pump early-returns), then destroys immediately OR defers to the pump's `finally` via `e.onIdle`. Destroy framesync before receiver.

**Audio:** a second framesync pump (`pumpAudio`, 100ms cadence) pulls 48k stereo while the source is ON PROGRAM (previews are video-only), normalises to tightly-packed planar Float32 (FLTp) and hands it to `manager.routeLiveInputAudio`, which fans out three ways: (1) the single audible screen window over the `live:audio` bus — `fullscreen.js` schedules the chunks gaplessly into a Web Audio graph behind an ~80ms jitter buffer, exiting via `MediaStreamDestination` → hidden `<audio>` registered with `CueMediaPlayer.attachAuxAudio` so the in-room output-device picker (salted-id matching) applies; (2) NDI-out senders directly via `ndi.sendAudio` (planar is already the FLTp layout; the in-room element tap has no media element to capture during a live input); (3) the stream compositor via `CueStreamFeed.pushLivePcm`, mixed into `mixBus` only in `mixed` audio mode. **Feed-health gate (buzz guard):** pulls are skipped while the video side is disconnected or `fsync.audioQueueDepth() <= 0` — a vanished sender otherwise makes the framesync answer with repeated-tail/garbage samples, heard as a high-frequency buzz. Verified silent (max amplitude 0) with a dead sender.

**Master enable (kill switch):** `live_inputs_enabled` setting, toggled live from the Library Live tab (`liveInput:setEnabled`). Disabling mid-service: an on-air feed drops to 'cleared' (black, never a frozen frame), all receivers/previews are torn down, discovery/preview IPC refuse, and the operator's `buildPayload` soft-blocks live-input GO (`liveinput:enabled` event keeps the renderer in sync). Re-enabling re-acquires a still-live payload automatically. Default ON; no restart either way.

**Remote Output mirror:** live-input frames never cross the network mirror (`onLiveFrame`/`onLiveAudio`: unsub in the output-page shim) — a browser viewer shows black for a live-input payload.

---
