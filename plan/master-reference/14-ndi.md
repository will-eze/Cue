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

---
