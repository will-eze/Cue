# Scripture Detection — WebGPU ASR Plan (deferred)

Status: **scoped, not started.** The shipped feature uses the CPU path
(onnxruntime-node, `whisper-small.en` INT8). This document is the full plan for
moving ASR to **WebGPU** to break the CPU speed/accuracy tradeoff. Pick this up as
a dedicated effort with real-hardware validation.

---

## Why (the case for GPU)

Measured in the actual Electron runtime (Apple Silicon, JFK 16 kHz sample):

| Path | 2 s utterance | Accuracy |
|---|---|---|
| small.en fp32 (original) | 2925 ms | baseline |
| small.en **q8** (shipped) | ~1579 ms | unchanged |
| base.en q8 | 694 ms | lower (book names) |

The CPU floor for small.en q8 is **~1450 ms/pass** — decoder/overhead-bound, not
chunk-bound, so it can't be tuned lower. On CPU you can only trade speed for
accuracy (base = fast/less accurate, medium = accurate/slow). **GPU is the only way
to run a *more accurate* model *faster* at the same time.**

CoreML/CPU execution providers in onnxruntime-node gave **nothing** (silent CPU
fallback) — verified. onnxruntime-node ships CPU-only prebuilts; there is no GPU EP
on the node side. WebGPU requires a Chromium context, i.e. the **renderer**.

Expected on capable GPUs (published transformers.js WebGPU figures + Apple Silicon
Metal): whisper-base/small sub-300 ms, and large enough headroom to run
`distil-large-v3` / `large-v3-turbo` (near top-tier accuracy) in real time — i.e.
**both** lower latency and higher accuracy than the CPU path.

---

## Device reality (who benefits) — drives the fallback design

WebGPU runs on **integrated GPUs too**, not just discrete. The dividing line is
"capable *hardware* adapter," not discrete-vs-integrated:

- **Apple Silicon (M1–M4):** big win, low variance — every target Mac has a strong
  integrated GPU; WebGPU→Metal is reliable. **Highest-value, safest target.**
- Intel Mac + AMD discrete: good. Intel Mac + Intel iGPU: modest.
- Windows + discrete (NVIDIA/AMD): big. Windows + modern iGPU (Iris Xe, Radeon
  600M+): moderate. Windows + old/weak iGPU (UHD 620-class): marginal.
- Server / VM / missing drivers: WebGPU absent or only a **software fallback**
  adapter (slower than CPU) → must **not** use it.

**Therefore the GPU path is strictly *additive*:** keep the shipped CPU path as the
universal baseline + fallback. Select WebGPU only when `navigator.gpu` exists AND
the adapter is hardware (not fallback). On marginal iGPUs, optionally time one
GPU vs CPU pass on first run and pick the faster. No device is ever worse than the
shipped CPU build.

---

## Architecture change

Today: capture (renderer) → IPC PCM → **main**: VAD (`asr.js`) → ASR
(`whisper-bin.js`, onnxruntime-node) → parser/content-match → `scripture:detected`.

WebGPU path: move VAD + ASR into a **renderer Web Worker** (audio is already in the
renderer, so this also removes the PCM IPC round-trip). The worker transcribes and
posts the utterance *text* to main; the **parser + content-match stay in main**
(they need the SQLite DB / FTS / verse vectors). The existing `scripture:detected`
flow and all display/output code are unchanged.

```
Renderer                                  Main
useScriptureCapture (getUserMedia)        manager (config, lifecycle, thresholds)
  → AudioWorklet (16k Int16)              parser + content-match (DB)  ← unchanged
  → ASR Web Worker:                       → scripture:detected → OperatorView
       VAD segmentation (port of asr.js)
       transformers.js WEB + WebGPU
       → utterance text  ──IPC──────────► manager.ingestTranscript(text)
```

Backend selection lives behind one interface so `manager` doesn't care which ran.

---

## File-by-file

**New**
- `src/renderer/audio/whisper-worker.web.js` — Web Worker: transformers.js web build,
  `device:'webgpu'`, resident pipeline, `{load}`/`{transcribe}` messages. Mirrors
  `whisper-bin.js` semantics (resident model, prompt_ids, adaptive chunk).
- `src/renderer/audio/vad.js` — extract the VAD state machine from `asr.js` into a
  shared, env-free module usable by both the worker and (optionally) main.
- `src/renderer/audio/useScriptureAsr.js` — picks backend: WebGPU worker when a
  hardware `navigator.gpu` adapter is present, else falls back to the existing
  main-process IPC path.

**Changed**
- `src/renderer/audio/useScriptureCapture.js` — feed frames to the worker (WebGPU
  path) instead of / in addition to `scriptureDetect.pushAudio`.
- `src/main/scripture-detect/manager.js` — add `ingestTranscript(text)` that runs
  the same `onCommitted` → reference/content logic on text from the renderer.
- `src/main/ipc/scripture-detect.ipc.js` + `preload.js` — channel for renderer→main
  transcript, and a `getGpuCapability`/report so Settings can show which backend is
  active.
- `src/main/scripture-detect/asr.js` — keep as the CPU-path VAD (or re-import the
  shared `vad.js`).
- `vite.renderer.config.js` — bundle the transformers web build; configure ORT-web
  asset handling.
- `forge.config.js` — **the risky part** (see below).
- `src/renderer/settings/ScriptureDetectionSettings.jsx` — show active engine
  (CPU / WebGPU + adapter name), and a model picker appropriate to the backend.

---

## Packaging (highest risk — only shows up in a *packaged* build, not `npm start`)

- **onnxruntime-web wasm/WebGPU artifacts** must be served locally (NO CDN — the
  default `wasmPaths` points at jsdelivr). Set
  `env.backends.onnx.wasm.wasmPaths` to a packaged path and copy the `.wasm`
  (incl. the SIMD/threaded + JSEP/WebGPU variants) from `onnxruntime-web/dist`.
  Wire into `forge.config.js` `packageAfterPrune` + `asar.unpack`, exactly like the
  existing native-externals/output-file copying (see CLAUDE.md "Packaging copies
  what Vite doesn't bundle").
- **Model cache location:** the web build caches to the browser Cache API/IndexedDB,
  not `userData/whisper-model`. Decide: accept browser cache (simplest; one-time
  re-download per machine) or proxy fetches to reuse the userData copy. Note: the
  GPU path likely uses a different dtype (fp16/q4) than the CPU q8, so weights
  differ anyway → a separate download is expected.
- Verify WebGPU is enabled in the packaged renderer (Electron 30/Chromium 124 has
  WebGPU; confirm no `enable-unsafe-webgpu` switch is required, and that
  `contextIsolation`/`sandbox` settings don't block `navigator.gpu`).

---

## Model choice on GPU

GPU affords accuracy the CPU can't. Candidates (validate live):
- `whisper-small.en` fp16 — safe step, much faster on GPU than CPU q8.
- `distil-whisper/distil-large-v3` or `whisper-large-v3-turbo` (q4f16) — near
  top-tier accuracy; turbo's tiny decoder keeps it fast. Bigger download (~hundreds
  of MB–~1 GB) — gate behind an explicit "high-accuracy (GPU)" download in Settings.
- Keep the **book-name `prompt_ids`** bias (already in `whisper-bin.js`) on the GPU
  path too.

---

## Risks / open questions

1. Packaging ORT-web wasm into the asar (the classic "works in dev, breaks
   packaged" trap). **Test with `npm run package` early.**
2. WebGPU availability/perf variance across the Windows iGPU matrix → the
   hardware-adapter check + optional first-run GPU/CPU timing are essential.
3. Maintaining **two ASR backends** (node-CPU + web-WebGPU) is ongoing tax.
4. fp16/q4 numerics on some integrated GPUs can differ or be unsupported → fall
   back to CPU on load failure, not just on missing adapter.
5. Memory: a large model resident in the renderer GPU process; ensure it releases
   on disarm if needed.

---

## Validation checklist (must be live, on real hardware)

- [ ] `npm start`: WebGPU path transcribes; latency < CPU; transcript ≥ CPU quality.
- [ ] Adapter detection: hardware → WebGPU; software/none → CPU fallback; verify the
      Settings engine indicator.
- [ ] `npm run package` on macOS: ORT-web wasm loads from asar; first detection works.
- [ ] Same on Windows: discrete GPU, modern iGPU, and a weak/no-GPU box (fallback).
- [ ] Disarm/re-arm, model switch, and download-progress UX.
- [ ] No regression to the CPU path when WebGPU is unavailable.

## Effort

Medium-large: ~2–3 new files + packaging changes + a second maintained backend +
cross-platform packaged QA. Roughly a few focused days **plus** real-hardware
validation. Not a feature rewrite — parser, content-match, VAD logic, display, and
action tiers are all reused.

## Context / prior decisions (so this isn't re-derived)

- CPU crash root cause: onnxruntime BFCArena large *aligned* alloc trapped by
  Electron's PartitionAlloc shim → SIGTRAP. Fixed on CPU with
  `session_options.enableCpuMemArena:false`. The WebGPU/ORT-web path is a different
  runtime (no onnxruntime-node), so that specific fix won't apply — watch for the
  WebGPU backend's own memory behaviour.
- VAD-segmented utterances replaced rolling-window + LocalAgreement (which discarded
  correct transient hypotheses). Port the VAD as-is.
- Whisper encoder pads to `chunk_length_s`; adaptive chunk (⌈dur⌉+2, floored 8,
  capped 30) is a ~20% win — keep it on GPU too.
- `prompt_ids` book-name bias: +~23 ms, no harm on normal speech — keep it.
