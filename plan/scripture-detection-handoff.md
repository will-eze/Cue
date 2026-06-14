# Scripture Detection — Handoff

Status as of 2026-06-14. Feature is code-complete on branch **`scripture-detection`**
(not yet pushed). All logic is unit-tested and the app packages clean; the only
unverified part is the live mic→detect→display loop (needs a human + mic).

---

## What it does

Listens to the service audio and surfaces the relevant Bible verse automatically:

1. **Reference detection** — someone says a citation ("turn to John chapter three
   verse sixteen", "first Corinthians thirteen") → the verse is resolved and, when
   confidence is high, auto-staged to **Preview** (operator hits GO) or sent live.
2. **Content matching** — a minister quotes/paraphrases a verse with no citation
   ("for God so loved the world…") → the verse is identified and offered as a
   **suggestion**.

Fully local, no API. ASR + embedding models auto-download to `userData` on first
use (nothing ships in the installer). Target latency ~2–3 s.

Built on top of Cue's **existing scripture display** (verses in SQLite +
`bible_verses_fts`, `bible.resolvePassage`, `ScripturePanel`, the preview→live
path). This feature is only a **detection front-end** feeding that pipeline — no
new display/output code, no schema migration.

---

## Architecture / data flow

```
Renderer (capture)                    Main (detect)                       Renderer (display)
useScriptureCapture.js                scripture-detect/manager.js
  getUserMedia(deviceId)               ├─ asr.js  (rolling 16k buffer,
  → AudioWorklet (captureWorklet.js)   │   LocalAgreement commit)
  → 16 kHz mono Int16 PCM         IPC  │   └─ whisper-bin.js  (transformers.js,
  → window.cue.scriptureDetect    ───► │       resident Whisper, auto-download)
     .pushAudio(int16)                 ├─ reference-parser.js + numbers.js
                                       ├─ content-match.js  (embed-worker.js +
                                       │   match-score.js; FTS prefilter→cosine→gate)
                                       └─ send 'scripture:detected' {action} ──► OperatorView
                                                                                  resolves via
                                                                                  bible.resolve,
                                                                                  reuses
                                                                                  handleScriptureLive
                                                                                  / previewScripture
```

State ownership stays in the renderer (OperatorView), exactly like the network
remote: main resolves a *candidate* and signals; OperatorView runs the existing
scripture handlers. Honors the "main never resolves slide payloads" invariant.

Heavy inference is off the main thread: embeddings run in a `worker_thread`
(`embed-worker.js`); Whisper runs through onnxruntime-node, which executes on its
own native threadpool (the JS main thread stays responsive).

---

## Key files

**Main (`src/main/scripture-detect/`)**
- `manager.js` — lifecycle, config, the detect→action decision, `scripture:detected`/`transcript`/`status` events.
- `asr.js` — sliding-window streaming loop + LocalAgreement (engine-agnostic).
- `whisper-bin.js` — ASR engine: transformers.js Whisper, auto-download + resident model, hardware model auto-pick.
- `reference-parser.js` + `numbers.js` — spoken/written reference → canonical ref string.
- `content-match.js` — verse matcher (FTS prefilter → embed → cosine → gate + lexical-anchor guard).
- `embed-worker.js` — onnxruntime-node + hand-rolled BERT WordPiece tokenizer (CommonJS; copied raw into asar).
- `embed-bin.js` — embedding model (MiniLM ONNX + vocab) auto-download.
- `match-score.js` — pure scoring/gating (unit-tested).
- `provision.js` — shared download/path helpers (mirrors `youtube/bin.js`).
- `*.test.mjs` — run via `npm test` (uses `--experimental-detect-module`).

**Main wiring**
- `ipc/scripture-detect.ipc.js` — IPC handlers (`getConfig/setConfig/start/stop/ensureAsrModel/buildVectors`, `pushAudio`).
- `index.js` — `registerScriptureDetectIpc()`, `setMainWindow`, `init`, `dispose`.
- `preload.js` — `window.cue.scriptureDetect.*` + allowed events `scripture:detected|transcript|status`.

**Renderer**
- `audio/useScriptureCapture.js` + `audio/captureWorklet.js` — capture path.
- `views/OperatorView.jsx` — `scripture:detected` handler, `previewScripture` staging, `onToggleDetect`, the strip.
- `panels/ScriptureDetectionPanel.jsx` — the detection strip (arm, transcript tail, suggestions).
- `panels/ScripturePanel.jsx` — the **mic "Auto Detect"** entry point in the Scriptures tab header.
- `panels/LibraryPanel.jsx` — threads the detect props to ScripturePanel.
- `settings/ScriptureDetectionSettings.jsx` — Settings → Scripture Detection (device, model, modes, Suggest/Auto-Preview/Auto-Live, match translation, verse index build).

**Build/packaging**
- `package.json` — `@huggingface/transformers ^4.2.0`, `onnxruntime-node 1.24.3` (EXACT pin — see Gotchas).
- `vite.main.config.js` — both externalized.
- `forge.config.js` — both in `NATIVE_EXTERNALS`; `embed-worker.js` copied raw in `packageAfterPrune`; `NSMicrophoneUsageDescription` in `extendInfo`.

---

## Behaviour: action tiers (manager)

`scripture:detected` carries `action`: `'suggest' | 'preview' | 'live'`.

- **Reference, confidence ≥ `referenceAutoConfidence` (0.8):** takes `reference.autoAction` (default **`preview`** → stages to the preview monitor; GO airs it). Set to `live` for hands-free.
- **Reference, 0.6–0.8:** `suggest` (strip chip).
- **Content match:** `suggest` by default (`content.autoAction` = `off`).

Config persists under the `scriptureDetect` settings key. Thresholds:
`referenceConfidence 0.6`, `referenceAutoConfidence 0.8`, `contentMinScore 0.62`,
`contentMinMargin 0.05`, `contentMinWords 6`.

The Scriptures-tab mic toggle (`onToggleDetect`) enables the feature, kicks off the
ASR model download on first use, then arms. The strip appears once armed.

---

## Decisions / divergences from the cloud draft

A cloud agent produced the first full implementation; it was reconciled with local
work (local pre-cloud work preserved on branch `local-scripture`). Where they
differed, the local approach won:

- **ASR engine: transformers.js, NOT whisper.cpp.** The cloud's whisper.cpp needed a
  manual binary install (no cross-platform auto-download). transformers.js
  auto-downloads the same Whisper weights and keeps the model resident.
  Benchmarked at RTF ~0.22 (base.en, Apple Silicon). Engine is behind
  `whisper-bin.js` so a faster whisper.cpp/ggml path could swap in later.
- **Reference parser:** cloud's (fuzzy/phonetic mishear, ambiguous-abbrev rejection,
  confidence) + local fixes for single-chapter books (Jude/Philemon) and digit
  ranges ("3:16-18").
- **Embeddings:** kept the cloud's lean onnxruntime-node + hand-rolled tokenizer
  worker.
- **Content matcher:** cloud's pipeline + local lexical-anchor guard.

---

## Gotchas (read before touching this)

1. **English-only Whisper models reject `language`/`task`.** `whisper-bin.transcribe`
   must NOT pass them (throws "Cannot specify task or language for an English-only
   model"). This silently broke ALL detection once. Only pass `chunk_length_s`.
2. **AudioWorklet must NOT load via `?url`.** Vite inlines small files to a `data:`
   URL that `addModule()` handles unreliably under file://. Use `?raw` + a Blob URL
   (see `useScriptureCapture.js`).
3. **`onnxruntime-node` pinned to EXACTLY `1.24.3`.** transformers.js@4.2.0 pins
   1.24.3; a `^` range floats the direct dep to 1.26 → TWO copies of the ~210 MB
   native libs. Keep them equal.
4. **`embed-worker.js` is CommonJS on purpose** and copied raw into the asar by
   `forge.config.js` `packageAfterPrune` (Vite doesn't bundle it). An ESM worker
   wouldn't load in this `type:commonjs` project.
5. **macOS mic:** packaged app needs `NSMicrophoneUsageDescription` (in
   `extendInfo`) or `getUserMedia` is denied. Dev works off Electron.app's own plist.
6. **Models auto-download, runtimes are bundled.** `onnxruntime-node` (~255 MB) is the
   inherent cost of local ONNX inference (already required by embeddings). Packaged
   app ≈ 695 MB. Don't bundle the models.

---

## Verified vs. not

**Verified**
- `npm test` → reference-parser 15/15, match-score 5/5 (plus a 16-case local battery).
- `npm run package` builds + codesigns clean; deps land in `app.asar.unpacked`;
  dynamic `import("@huggingface/transformers")` preserved; no `data:` worklet;
  Info.plist mic string present; app ≈ 695 MB.
- Transcription correctness via standalone spike (whisper-base.en on synthesized speech).

**NOT verified (needs a human + mic)**
- The live loop: arm → speak → transcript tail → reference auto-preview / content
  suggestion → GO to air. Couldn't be driven headlessly.

---

## How to test (live)

1. `npm start` (dev) or launch `out/Cue-darwin-arm64/Cue.app` (packaged).
2. Settings → Bible: ensure a translation is installed (KJV/WEB ship bundled).
3. Scriptures tab → click the **mic "Auto Detect"** → grant the mic prompt.
   (First time downloads the ASR model ~150 MB; the button shows "Downloading %".)
4. Speak a reference: *"Let us turn to John chapter three verse sixteen."* Within
   ~2–3 s the strip transcript should update and the verse auto-stage to Preview;
   press GO to air.
5. For content matching: Settings → Scripture Detection → build the verse index for
   your translation (one-time, embeds ~31k verses), then quote a verse.
6. If nothing fires, the strip now shows the error (mic denied / model not loaded).

---

## Remaining work

- Live end-to-end verification (above).
- **Push + PR:** branch `scripture-detection` is NOT pushed (the cloud's signing
  server blocked its commits; local git is unaffected).
  `git push -u origin scripture-detection` then open a PR.
- Optional later: a faster whisper.cpp/ggml engine behind `whisper-bin.js` if a weak
  target machine misses 2–3 s; prune unused `sharp`/`@img` (~16 MB) from the
  transformers closure.

## Branch state

```
90c7096 fix: audio→transcription pipeline (English-only options; worklet data-URL; mic plist)
caa59cb feat: Scriptures-tab mic entry point + confidence-tiered actions
7e1bd59 reconcile: lexical-anchor guard
ec27c7a reconcile: drop stale whisper UI; dedupe onnxruntime-node
53b068a reconcile: swap ASR engine to transformers.js
522dfe7 reconcile: single-chapter + digit-range parser fixes
3c44ee8 cloud: scripture detection (full feature, 26 files)
abe911a (main) preserve EasyWorship inline formatting on import
```

Version: `package.json` is at **21.3.0** (MINOR bump, no migration). Confirm the
Settings-footer version matches before releasing.
