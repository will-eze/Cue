# Scripture Detection — WebGPU Spike Findings (2026-06-19)

> **✅ RESOLVED (2026-06-19, later same day).** Electron was upgraded 30→**42.4.1
> (Chromium ~144)** and merged to `main`. The spike was re-mounted and re-run: the
> `subgroupMinSize` crash documented below **no longer occurs** — `whisper-small.en`
> (fp32, the "local" transformers.js 4.2.0 / ort-web 1.26 engine) **loads and
> benchmarks on WebGPU** on a hardware Apple adapter. JFK 11.0s clip → **median
> 1794 ms** (RTF 0.16, passes 1753/1794/1846), warm-up 3.3s (shader compile), load
> 7.3s incl. download; transcript verbatim-correct. The Chromium-version floor was
> the whole story, exactly as predicted below. **Next:** the full build per
> `scripture-detection-webgpu-plan.md`; before locking model choice, also bench
> small.en **fp16**, **turbo**, and a short ~2s utterance (the 1794ms above is an
> 11s clip, not directly comparable to the ~1450ms/pass CPU floor for a 2s VAD
> utterance). Everything from here down is the **historical** as-blocked record.

**Status (historical): BLOCKED on current Electron. WebGPU ASR does not run on
Electron 30 / Chromium 124.** This documents a spike that tested the approach in
`scripture-detection-webgpu-plan.md` *before* committing to the full build. The
plan's architecture is still sound; it has an unmet **runtime prerequisite** the
plan did not anticipate.

---

## TL;DR

WebGPU Whisper via `transformers.js` + `onnxruntime-web` **crashes on load** in
this app's renderer, on a confirmed *hardware* GPU adapter (Apple Silicon, M-series,
`apple / common-3`). The crash is:

```
load failed: cannot read properties of undefined (reading 'subgroupMinSize')
```

Reproduced across **three** engine versions (see matrix). Root cause is not our
code — it's that current ORT-web's WebGPU init assumes a Chromium that exposes
**subgroup adapter info**, which **Chromium 124 (Electron 30) does not**.

**Decision required (project-level, not scripture-only): upgrade Electron to a
Chromium that exposes WebGPU subgroup info, or shelve the GPU path.** Nothing
short of that makes the beta runnable.

---

## What was tested

A throwaway dev probe (`src/renderer/settings/WebGpuSpike.jsx`, mounted at the
bottom of Settings → Scripture Detection) that loads transformers.js' **web build**
with `device:'webgpu'` and decodes a clip. It ran in the real Electron renderer,
`npm start` — not a browser, not packaged.

Verified working up to the crash point:
- `navigator.gpu` present; `requestAdapter()` returns a **hardware** adapter
  (`isFallbackAdapter === false`). Reported `apple / common-3`. So WebGPU itself is
  available and not a software fallback.
- JFK 16 kHz sample fetched + decoded to Float32 mono (11.0 s) fine.
- Model weights downloaded from the HF Hub fine (`decoder_model_merged.onnx` → 100%).

The crash is at **pipeline construction / WebGPU device init**, after download.

## Engine matrix (all fail identically)

| Engine source | onnxruntime-web | Result |
|---|---|---|
| local `@huggingface/transformers@4.2.0` (the app's installed dep) | `1.26.0-dev` | ✗ `subgroupMinSize` |
| CDN `@huggingface/transformers@3.7.5` (esm.sh) | older (~1.22) | ✗ `subgroupMinSize` |
| CDN `@huggingface/transformers@3.0.2` (esm.sh) | ~1.20 | ✗ `subgroupMinSize` |

Three independent ORT-web versions → this is a **Chromium-version floor**, not a
package-pinning problem we can dodge by choosing a version.

## Root cause (evidence)

ORT-web's WebGPU device init reads subgroup fields off the adapter info. From
`node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs`:

```js
e = L(...).adapterInfo, ... = e.subgroupMinSize, ... = e.subgroupMaxSize
```

`GPUAdapterInfo.subgroupMinSize` / `subgroupMaxSize` are part of the WebGPU
**subgroups** feature, which is **not exposed in Chromium 124**. So `adapterInfo`
(or its subgroup fields) is `undefined` → the read throws → pipeline load fails the
instant the WebGPU EP initializes.

- Electron `30.0.9` → Chromium `124`.
- The plan's packaging note ("Electron 30/Chromium 124 has WebGPU; confirm no flag
  needed") was right that *WebGPU is present* — but the ORT-web **build** needs a
  newer Chromium than mere WebGPU availability.

## Conclusion

There is **no working WebGPU ASR runtime on Chromium 124** with any transformers.js
/ ORT-web version capable of running these Whisper models. The GPU beta cannot be
built on the current Electron — it would crash on load exactly as the spike does,
just after far more implementation work (worker, VAD extraction, ORT-web wasm in the
asar, backend selection). **The spike's entire purpose was to surface this for ~$0
instead of discovering it at packaging time.**

---

## The only unblocking path: upgrade Electron

Target a Chromium that exposes `GPUAdapterInfo.subgroupMinSize` (Chromium ~128+;
**re-run the spike against the candidate Electron to confirm the true minimum** —
do not trust a version number from docs). That is **Electron ~32+**.

This is a **project-level decision with app-wide blast radius**, deliberately *not*
folded into scripture detection:

- **pdfjs-dist v4 is pinned to Chromium 124** (CLAUDE.md): v5/v6 use native
  `Promise.try` that Chromium 124 lacks. A newer Chromium would *unpin* this — an
  upside, but it's a separate migration to do and re-test (the PPTX/PowerPoint
  import rasteriser).
- **Native modules** (`better-sqlite3`, `grandi`) need `npm run rebuild` after any
  Electron bump (CLAUDE.md), and the `prePackage` rebuild hook + packaged-app launch
  per OS must be re-verified — ABI breaks are invisible in `npm start`.
- Full cross-platform **packaged** QA (the CLAUDE.md "works in dev, breaks packaged"
  class of bug), plus the existing media/NDI/output paths.

Recommended sequencing if/when pursued:
1. Bump Electron on a branch; `npm run rebuild`; smoke-test the app.
2. **Re-run the WebGPU spike** (still in the tree) — confirm `small.en` loads and
   benchmarks on WebGPU. THIS is the green light. Capture latency vs the CPU floor
   (~1450 ms/pass small.en q8) and `turbo` accuracy on book names.
3. Only then build the beta per `scripture-detection-webgpu-plan.md` (worker + VAD
   extraction + ORT-web wasm packaging + backend selection).
4. Separately, evaluate unpinning pdfjs-dist now that Chromium supports `Promise.try`.

Reminder from the plan: even with GPU, "near-instant" *preview* is largely a VAD/
end-silence + interim-decode property (already shipped on CPU via tiny.en). The GPU
prize is **higher accuracy at equal-or-better latency** (distil-large / large-v3-
turbo) + a faster *commit* — frame the work around that, not "instant."

Also still open (was never reached): **GPU contention** with live video/NDI output,
since ASR would run in a renderer sharing the GPU process. Measure before committing
to a large model.

---

## Spike artifacts left in the tree (dev-only, uncommitted)

Kept on purpose — it's the verification tool for after an Electron upgrade.

- `src/renderer/settings/WebGpuSpike.jsx` — the probe (engine/model/audio pickers,
  warm-up + 3-pass benchmark).
- `src/renderer/settings/ScriptureDetectionSettings.jsx` — imports + renders
  `<WebGpuSpike />` at the bottom of the section.
- `vite.renderer.config.js` — `optimizeDeps: { exclude: ['@huggingface/transformers'] }`
  so the dev server doesn't choke on the ORT-web wasm.

**To remove** (if you decide against the GPU path): delete `WebGpuSpike.jsx`, drop
its import + `<WebGpuSpike />` mount from `ScriptureDetectionSettings.jsx`, and
remove the `optimizeDeps` block from `vite.renderer.config.js`. No DB / IPC / main-
process changes were made; nothing was wired into the real detection pipeline.
