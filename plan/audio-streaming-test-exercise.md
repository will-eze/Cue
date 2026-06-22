# Test Exercise — In-Room Audio Routing + NDI Audio + RTMP Streaming

Run this end-to-end to validate Plan 1 (`in-room-audio-output-picker.md`) and Plan 2
(`ndi-rtmp-audio-streaming.md`). Work top to bottom — later parts assume earlier
parts pass. Fill in the **Result** column as you go.

> Most of this CANNOT be checked in `npm start` alone — you need real audio devices,
> an NDI receiver, and a stream target. Do the dev run first, then repeat the starred
> (★) rows against a packaged build.

---

## 0. Prerequisites & setup

Gather before starting:

- [ ] A **second audio output device** (USB interface, HDMI display with speakers,
      AirPods/Bluetooth, or a virtual device like BlackHole/VB-Cable). You need at
      least two selectable outputs.
- [ ] An **NDI receiver** on the same machine or LAN: OBS + the obs-ndi/DistroAV
      plugin, or NDI Tools "Studio Monitor". (For audio you need a receiver that
      plays/meters audio — Studio Monitor does.)
- [ ] A **stream target**. Either:
  - Local smoke test (no account): a terminal to run a throwaway RTMP server, **or**
  - A real **YouTube "Stream now"** (Studio → Go Live → Stream) — copy its
    **Stream URL** (`rtmp://a.rtmp.youtube.com/live2`) and **Stream key**.
- [ ] A **video clip with clear audio** imported into a service (so program audio
      exists to route/stream). A song with a background video also works.
- [ ] At least one **screen output channel** assigned to a display (this is the
      audio source — see the limitation note in Part D).

Build & run:

```
nvm use --delete-prefix 22     # per project_node22_toolchain
npm start
```

Open DevTools on the operator window (View menu / shortcut) and keep the **Console**
visible — the tap and worklet log failures there (`[audio-tap] …`).

---

## Part A — In-room program audio output device (Plan 1)

| # | Step | Expected | Result |
|---|------|----------|--------|
| A1 | Settings → **Channels**. Find the **"Program audio output"** dropdown near the top. | Dropdown lists your real output devices **with readable names** (not blank / "Output 1"). | |
| A2 | Leave it on **System default**. GO the video clip live (in-room screen). | Audio plays from the system default device. | |
| A3 | Change the dropdown to your **second device** while the clip is still playing. | Audio moves to that device within ~1s, **no re-GO needed**. | |
| A4 | GO a *different* clip. | New clip's audio also comes from the chosen device (per-element re-apply works). | |
| A5 | Set dropdown back to **System default**. | Audio returns to default. | |
| A6 | Quit and relaunch the app. Reopen Settings → Channels. | Your last device selection is **still selected** and still routes. | |
| A7 ★ | Repeat A1–A3 on a **packaged build** (`npm run package`, launch the app). | Labels appear and routing works (permission handler is dev-invisible). | |

**If A1 shows blank labels:** the one-shot `getUserMedia` unlock or the permission
handler (`src/main/index.js`) isn't granting — check console for permission errors.
**If A3 doesn't move audio:** `setSinkId` failed — check `applySink` in
`src/output/media-player.js` and that the device matched (deviceId→label→groupId).

---

## Part B — NDI audio (Plan 2 / Component B)

Setup: Settings → Channels → add (or enable) an **NDI** channel. Open your NDI
receiver and subscribe to the **"Cue - <name>"** source.

| # | Step | Expected | Result |
|---|------|----------|--------|
| B1 | With the NDI channel showing **"Audio Muted"**, GO the video clip. | NDI receiver shows **video**, **no audio** (baseline — audio off by default). | |
| B2 | On the NDI channel row, click the audio toggle to **"Audio On"**. | (No crash; channel rebuilds.) | |
| B3 | GO the video clip again. | NDI receiver now plays **audio**, reasonably in sync with the NDI video. | |
| B4 | Watch the in-room speakers AND the receiver. | Audio is **not doubled / echoed** in-room (the offscreen NDI window must stay locally muted). | |
| B5 | Toggle NDI audio **Off** again mid-clip, then On. | Audio stops, then resumes on the receiver. | |
| B6 | Pause / mute program from the operator. | NDI audio follows (pause stops it). | |

**If B3 has video but no audio:** confirm a **screen** channel exists and is the
primary audio monitor (the tap lives there, not in the NDI window). Check console for
`[audio-tap]` errors; verify grandi `sender.audio` isn't throwing.
**If B4 doubles audio:** the NDI offscreen window isn't muted — check `mute:'1'` in
`createNdiWindow` (`manager.js`).

---

## Part C — RTMP streaming (Plan 2 / Component C)

### C-smoke (optional, no account) — prove the pipe locally

In a terminal, start a throwaway RTMP sink and a player:

```
# Use the ffmpeg Cue downloaded (or any ffmpeg). Listen for one stream:
ffmpeg -y -loglevel info -listen 1 -i rtmp://127.0.0.1:1935/live/test -c copy /tmp/cue-stream.flv
# (leave running; Ctrl-C after ~20s, then play /tmp/cue-stream.flv)
```

In Cue: Settings → **Stream**. Server `rtmp://127.0.0.1:1935/live`, key `test`,
**1080p / 30 / 4500k**. GO a clip, click **Go Live**. After ~20s, Stop, then open
`/tmp/cue-stream.flv` in VLC.

| # | Step | Expected | Result |
|---|------|----------|--------|
| C0 | Recorded `/tmp/cue-stream.flv` | Plays back with **picture + sound**, A/V roughly aligned. | |

### C-live — real YouTube

| # | Step | Expected | Result |
|---|------|----------|--------|
| C1 | Settings → **Stream**. Enter YouTube **Server URL** + **Stream key**. Pick **1080p / 30 / 4500k**. | Fields save (status shows **Offline**). | |
| C2 | GO a clip with audio live. Click **Go Live**. | Status → *Starting…* → **Live** (green dot). Encoder name shows (e.g. `h264_videotoolbox` or `libx264`). | |
| C3 | Open YouTube Studio's stream preview. | Picture appears (lyrics/graphics/video composited), **with audio**, within ~10–30s. | |
| C4 | Advance slides, show a graphic/lower-third, play a video background. | All appear in the stream, matching the in-room output. | |
| C5 | Watch A/V sync in the YouTube preview for ~1 min. | Lips/beat stay aligned (no growing drift). | |
| C6 | Briefly disable Wi-Fi for ~5s, re-enable. | Status → **Reconnecting…** → **Live** again (auto-reconnect). | |
| C7 | Click **Stop Stream**. | Status → **Offline**; YouTube ends ingest. | |
| C8 | Change resolution to **1080p / 60** (or 1440p/4K if you have a HW encoder), Go Live again. | Streams at the higher setting; if it stutters, the info note about HW encoders applies. | |
| C9 ★ | Repeat C1–C3 on a **packaged build**. | `ensureBinaries()` fetches ffmpeg if missing; stream works in the build. | |

**If C2 never reaches Live / exits immediately:** open the main-process logs — ffmpeg
stderr is captured in `rtmp.js`; a bad URL/key or missing encoder shows there.
**If C3 has video but no audio:** same as B3 — the tap needs a screen window; check
console for AudioWorklet `addModule` failure (the #1 risk — see Part D).
**If A/V drift grows (C5):** tune the timestamp flags in `buildArgs`
(`src/main/stream/rtmp.js`) — try removing `-use_wallclock_as_timestamps`, or adjust
`-vsync`/`-af aresample=async=1`.

---

## Part D — Combined & edge cases

| # | Step | Expected | Result |
|---|------|----------|--------|
| D1 | Run **screen + NDI(audio on) + streaming** all at once with a video playing. | In-room audio on chosen device; NDI receiver has audio; YouTube has audio. One tap feeds all three. | |
| D2 | While streaming, change the **in-room** output device (Part A). | In-room audio moves; **NDI/stream audio unaffected** (separate paths). | |
| D3 | Stop streaming but keep NDI audio on. | Stream ends; NDI audio keeps working (tap stays on for NDI). | |
| D4 | Turn NDI audio off and stop streaming. | Tap deactivates (no consumers). Console quiet. | |
| D5 | **Limitation check:** remove all **screen** channels, keep only NDI(audio on). GO a clip. | Expected: **no NDI audio** (no audible window = no tap source). This is a documented v1 limitation — confirm it degrades gracefully (no crash), not silently wrong elsewhere. | |
| D6 | Quit the app while streaming. | Clean shutdown; ffmpeg process ends (no orphaned ffmpeg in Activity Monitor / Task Manager). | |

---

## Risk-targeted probes (do these deliberately)

1. **AudioWorklet load (highest risk).** During B3/C3, watch the **output window**
   console (or main logs). If you see `[audio-tap] worklet load failed` or
   `addModule` errors, the worklet didn't load from `file://` → audio tap is dead.
   *Fix path:* switch `addModule` to a blob URL in `src/output/audio-tap.js`.
2. **HW encoder.** In C2, note the encoder shown. If it's `libx264` on a machine you
   expected hardware on, the static ffmpeg build lacks it (`src/main/youtube/bin.js`).
3. **Double audio (B4).** Specifically listen in-room while NDI audio is on.
4. **Backpressure / drops at 60fps+ (C8).** Watch for frozen/stuttery stream video —
   that's the BGRA copy ceiling, expected behavior is dropped frames, not a crash.
5. **Stream key persistence.** After C1 + relaunch, the key should still be there
   (it's in `cue.db`) — and remember it rides backups (sensitive).

---

## Sign-off

- [ ] Part A (in-room device) — all pass
- [ ] Part B (NDI audio) — all pass
- [ ] Part C (RTMP) — all pass
- [ ] Part D (combined/edges) — all pass
- [ ] Re-ran ★ rows on a packaged build

Log any failures with the row number + console/log snippet so they can be triaged
against the file references above.
