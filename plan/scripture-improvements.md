# Scripture Detection — Latency Improvement Plan

**Goal:** Close the gap between Cue's current ~5–7 s detection latency and the
"instantaneous" feel of tools like pewbeam.AI. Reach **<1 s perceived** for
announced references and **~1–2 s** for verbatim quotes, **without** new cloud/LLM
calls and **without** requiring a GPU.

**Status:** Phases 0, 1, 2A, 3, 4 **implemented** (2026-06). Phase 2B (streaming-native
engine) remains a future research spike — not adopted. Owner: scripture-detect. Related:
§17 of `plan/cue-master-reference.md`, `plan/scripture-detection-webgpu-plan.md` (GPU
path, complementary not a substitute).

**What shipped:** per-utterance timing traces (`[scripture-detect]`, gated by
`CUE_SCRIPTURE_DEBUG`); configurable VAD close (`endSilenceMs`); VAD-gated interim
decode in `asr.js` (`runInterim`/`kickInterim`, latest-wins, soft-pause + cadence);
two-tier resident pipes in `whisper-bin.js` (tiny.en interims, per-model serialization);
`interim`/`candidateId` on `scripture:detected` with in-place confirm/correct in
`OperatorView` (interims Preview-only, never auto-air); lexical-first content matching
(`lexical-index.js`) with MiniLM as paraphrase fallback; Responsiveness presets
(Instant/Balanced/Accurate) in `manager.js` + `ScriptureDetectionSettings.jsx`. The
CLAUDE.md guard rail + master reference §17 now encode the interim-vs-rolling-window
distinction.

---

## 1. Diagnosis — where the 5–7 s actually goes

The latency is **architectural, not model speed.** Walking the current pipeline
(`asr.js` → `manager.js` → `reference-parser.js`/`content-match.js` →
`OperatorView.jsx`):

| Stage | Cost | Why |
|---|---|---|
| **Wait for utterance to END** | **dominant (3–6 s)** | `asr.js` only transcribes on flush — after `END_SILENCE_MS = 550 ms` of trailing pause closes the segment. A *read* verse is 5–10 s of continuous speech with no pause, so you get **zero text** until the speaker stops. `MAX_UTTERANCE_MS = 18000` is the worst case. |
| Whisper batch inference | 0.5–1.5 s | `whisper-bin.transcribe()` runs once on the whole clip (q8, base/small.en, CPU). Encoder pads to a ≥8 s window, so cost is near-constant per decode. |
| MiniLM content match | 0.2–0.5 s | `content-match.match()`: FTS prefilter → embed window in worker → cosine → gate. Runs on the committed text only. |
| Resolve + stage (renderer) | <50 ms | `bible.resolve` + `handleScriptureLive`/`stageScripturePreview`. Not a bottleneck. |

**Conclusion:** ~70–80 % of latency is *waiting for the talker to pause*. No model
swap or GPU fixes that — only emitting and matching on **partial** transcripts does.

### The physics floor (what "instant" can mean)

You cannot present a verse before enough audio exists to identify it. Realistic
floors after this work:

| Case | Floor | Reachable because |
|---|---|---|
| Announced reference ("John 3:16") | **<1 s, feels instant** | Reference is short, front-loaded, distinctive; parse on partials. |
| Verbatim quote (reading the words) | ~1–2 s | Lexical index localizes a verse from 4–5 distinctive words. |
| Paraphrase | 2–3 s | Inherently needs more audio + semantics (MiniLM). Competitors have the same limit; they hide it with confident self-correcting presentation. |

---

## 2. Guard-rail reconciliation (read before touching `asr.js`)

CLAUDE.md and the `asr.js` header forbid **rolling-window** transcription:
> "Detection ASR is VAD-segmented utterances, not a rolling window — do not
> reintroduce per-tick rolling-window transcription (Whisper hallucinates over the
> silence and the commit step drops correct text)."

That rule is **correct and stays**, but it targets a *specific* failure mode (the old
LocalAgreement scheme re-decoding fixed windows **including silence** → hallucination
+ lossy commit). This plan does **not** reintroduce that. The distinction the plan
relies on:

- ❌ **Naive rolling window** — re-decode a fixed time window every tick, silence
  included. Banned. Stays banned.
- ✅ **VAD-gated interim decode** — while the VAD says speech is *active*, decode the
  accumulated **speech-only** buffer at a coarse cadence and emit an *interim*
  hypothesis. The authoritative **commit** is still the existing single end-of-utterance
  transcription. Never decodes over silence, so the hallucination mode can't occur; the
  commit path is unchanged, so nothing correct is dropped.

**Deliverable:** when Phase 2 lands, update the CLAUDE.md guard rail and the `asr.js`
header to encode this distinction (interim-during-speech is allowed; fixed-window-over-
silence is not), so a future agent doesn't "clean up" the interim path as a banned
rolling window.

---

## 3. Phased plan

Ordered by **impact ÷ effort**. Phases 1, 2A, 4 are independent and can ship
separately; 2B/3 are the heavier ASR-engine work.

### Phase 0 — Instrument the baseline (prerequisite, ~half day)

Before optimizing, measure. Add a single timing trace keyed by utterance id through
the whole chain so every later change is quantified, not guessed.

- `asr.js`: stamp `t_onset`, `t_flush`, `t_transcribed` per utterance.
- `manager.js`: stamp `t_ref_fired` / `t_content_fired` and log
  `t_fired − t_onset` (true end-to-end detection latency) and `t_fired − t_flush`.
- Gate behind the existing `CUE_SCRIPTURE_DEBUG`. No behaviour change.

**Exit:** a console line per detection: `latency onset→detect = N ms (asr X, match Y)`.
This is the number every phase below must move.

---

### Phase 1 — Cheap structural wins (no ASR-engine change) — **highest ROI**

These cut latency with the existing Whisper-on-flush model, purely by reacting sooner
and presenting progressively.

**1.1 — Tighten the VAD close (`asr.js`).**
- Lower `END_SILENCE_MS` 550 → ~350 ms (snappier utterance close). Re-validate it
  doesn't fragment mid-sentence on natural speech; expose as a tunable.
- Add a **mid-utterance flush on a soft pause**: emit an interim commit at a short
  intra-phrase pause (~250 ms) *without* ending the utterance, so a long read produces
  detections before the full stop. Keep the hard `MAX_UTTERANCE_MS` final flush.
- Risk: more frequent transcription. Bounded by the queue cap (`MAX_QUEUE`) and the
  coarse cadence in 2A; tune so the Whisper queue stays real-time (watch Phase 0 trace).

**1.2 — Reference parsing already needs only words — make it fire on the soft-pause
interim** (`manager.js`). `tryReference()` is cheap and stateless; run it on the 1.1
interim commits, not just the final. Announced references resolve mid-sentence. This
alone delivers the "instant" feel for the common "turn with me to ___" case.

**1.3 — Progressive (speculative) presentation** (`manager.js` + `OperatorView.jsx`).
Introduce an `interim` flag + stable `candidateId` on `scripture:detected`:
- Interim high-confidence reference → auto-**Preview** immediately (never auto-Live on
  interim — Live waits for commit or operator GO).
- The committed final with the same `candidateId`/ref **confirms in place** (no
  re-stage, no flicker); a different ref **corrects** the preview.
- `OperatorView`'s suggestion strip updates the existing entry in place rather than
  prepending a duplicate (today it de-dupes by `ref`; extend to `candidateId`).
- Cooldown fix: `REF_COOLDOWN_MS` currently suppresses the final because it equals the
  interim ref. Track the interim candidate separately so the final is allowed through
  as a *confirmation*, not blocked as a duplicate.

**Outcome of Phase 1:** announced references feel instant; reading/quoting still waits
for Whisper but presents at the first soft pause instead of the full stop. No engine
change, no new dependency.

---

### Phase 2 — Interim ASR during speech (VAD-gated)

The real unlock for **verbatim quotes**: produce transcript *while the verse is still
being read*, not after.

**2A — Interim decode with the current engine (Whisper).**
- In `asr.js`, while `inSpeech`, every ~800–1200 ms decode the **current speech buffer**
  (`utter` so far) and emit `onTranscript({ interim:true, ... })`. Drop stale interim
  jobs — only the latest matters; never let interim work block the final commit
  (separate, low-priority queue slot).
- **Engineering reality / risk:** Whisper is a *chunk* model — each interim decode
  re-encodes the whole growing buffer (`whisper-bin` pads to ≥8 s), so re-decoding every
  ~500 ms on CPU will **not** keep real-time. Mitigations:
  - Coarse cadence (~1 s), latest-wins, on the resident model.
  - **Two-tier ASR:** run interims on **tiny.en** (fast, resident as a second pipeline)
    and keep small/base.en for the authoritative commit. `whisper-bin.js` already
    supports multiple model repos; add a second resident pipe. Accept lower interim
    accuracy — it only needs to be good enough for the lexical/reference match to lock
    on; the commit corrects it.
- Run `tryReference` + the lexical content match (Phase 4) on each interim.

**2B — Streaming-native ASR engine (the architecturally correct fix).**
Whisper fundamentally re-encodes; a streaming CTC/transducer model processes only *new*
audio incrementally and is built for low-latency partials. Evaluate behind the existing
`whisper-bin.js` interface (it was explicitly designed as a swap point — see its header):
- **Candidates:** Moonshine (on-device, low-latency, English), NVIDIA Parakeet /
  FastConformer-CTC, Vosk (mature streaming, small footprint). Must run local CPU via
  onnxruntime-node or a self-downloaded binary, matching the no-bundle provisioning
  policy (`provision.js`).
- **Constraint:** whatever ships must honour the Electron `enableCpuMemArena:false`
  onnxruntime guard rail (the SIGTRAP crash) and the `*.en`-model language-arg rule if
  Whisper-family.
- Keep Whisper available as the high-accuracy commit/fallback; the streaming model
  drives interims. This is a research spike → prototype → benchmark against Phase 0
  numbers before committing.

---

### Phase 3 — Lexical-first content matching (demote MiniLM from the hot path)

For **verbatim** quoting (the common case — they're reading the words), semantic
embedding is overkill and too slow to run on partials.

**3.1 — Add a lexical verse index** (`content-match.js`, new sibling
`lexical-index.js`). Build an in-memory n-gram / inverted index over the active
translation's ~31 k verses (regenerable derived cache, same policy as the existing
embedding blob — not backed up, rebuilt on model/verse-count change). Match a partial
window against it in microseconds; the Bible is fixed and verses are lexically
distinctive, so 4–5 content words usually localize one verse.

**3.2 — Reorder the content path:** lexical index first (runs on every interim, cheap,
no worker round-trip), and only fall back to **MiniLM** when lexical is ambiguous or
below threshold (genuine paraphrase). Keep the existing `sharesAnchor` lexical-anchor
guard and the `match-score` gate. MiniLM moves off the critical path entirely; it
becomes the paraphrase backstop, not the default.

**3.3 — Lower `contentMinWords`** for the lexical path (a distinctive 3–4-word n-gram is
enough to commit a quote) while keeping the embedding path's higher word floor.

---

### Phase 4 — Tuning, config, and UI

- **New config keys** under `scriptureDetect` (`manager.js` `defaults()`): interim
  enable/disable, interim cadence ms, soft-pause ms, two-tier interim model, lexical-vs-
  semantic thresholds. All persisted via the existing `settings.set(CONFIG_KEY)`.
- **Settings UI** (`ScriptureDetectionSettings.jsx`): a "Responsiveness" section —
  Instant / Balanced / Accurate presets that bundle the above (snappy = aggressive
  interim + lexical-first; accurate = current behaviour). Default **Balanced**.
- **Suggestion strip** (`OperatorView.jsx`): show interim vs confirmed state (e.g. a
  pulsing/“listening” style for interim, solid once committed) so the operator trusts
  the progressive presentation.

---

## 4. File-by-file change map

| File | Phase | Change |
|---|---|---|
| `src/main/scripture-detect/asr.js` | 0,1,2A | Per-utterance timing stamps; lower/expose `END_SILENCE_MS`; soft-pause interim commits; VAD-gated interim decode loop (latest-wins, separate queue). Update header comment (guard-rail distinction). |
| `src/main/scripture-detect/whisper-bin.js` | 2A,2B | Optional second resident pipe (tiny.en) for interims; (2B) new engine behind the same `transcribe()`/`ensureModel()` interface. Preserve `enableCpuMemArena:false` + `*.en` arg rules. |
| `src/main/scripture-detect/manager.js` | 0,1,3,4 | `interim`/`candidateId` on `scripture:detected`; run reference + lexical match on interim; interim-vs-final cooldown bookkeeping; new config keys + presets; latency logging. |
| `src/main/scripture-detect/reference-parser.js` | — | No change (already pure/stateless — just called more often). |
| `src/main/scripture-detect/content-match.js` | 3 | Lexical-first reorder; MiniLM as fallback. |
| `src/main/scripture-detect/lexical-index.js` (new) | 3 | In-memory n-gram/inverted verse index + matcher; regenerable cache. |
| `src/renderer/views/OperatorView.jsx` | 1,4 | Handle `interim`/`candidateId` (in-place preview update + confirm/correct on commit); strip shows interim vs confirmed. |
| `src/renderer/settings/ScriptureDetectionSettings.jsx` | 4 | Responsiveness presets + advanced tunables. |
| `CLAUDE.md` / `plan/cue-master-reference.md` §17 | 2 | Encode the interim-vs-rolling-window distinction; document the two-tier/streaming engine. |

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Interim re-decode can't keep real-time on CPU (Whisper re-encodes) | Coarse cadence + latest-wins + two-tier tiny.en interims; ultimately Phase 2B streaming engine. Gate by Phase 0 trace — back off cadence if the queue grows. |
| Flicker/false flashes from interim corrections | Interim → **Preview only**, never auto-Live; in-place confirm/correct by `candidateId`; operator GO is the only path to air on interim. |
| Re-introducing the banned hallucination mode | Interim decodes only the **speech-active** buffer, never silence; commit path unchanged. Documented in §2 and the guard-rail update. |
| Electron onnxruntime SIGTRAP on a new model | Any new engine must set `enableCpuMemArena:false`/`enableMemPattern:false`; verify in a **packaged** build, not just `npm start`. |
| Lexical index false positives on common phrasing | Keep `sharesAnchor` + `match-score` gate; require distinctive (≥4-char, non-stopword) n-gram overlap; semantic fallback for ambiguity. |
| Tuning regresses accuracy for snappy presets | Ship **Balanced** as default; presets are opt-in; keep current behaviour reachable as "Accurate". |

---

## 6. Success criteria

Measured via the Phase 0 trace on representative samples (announced reference, read
verse, paraphrase):

- Announced reference: **onset→preview < 1 s** (today ~5–7 s).
- Verbatim quote: **onset→suggest ≤ 2 s**.
- No increase in false auto-Live events (interim never auto-airs).
- Whisper/interim queue stays real-time (no unbounded backlog under continuous speech).
- Packaged-build smoke test passes on macOS + Windows (onnxruntime stability).

---

## 7. Recommended sequencing

1. **Phase 0** (instrument) — do first; everything else is judged against it.
2. **Phase 1** (cheap structural wins) — ship independently; delivers the "instant"
   feel for announced references, which is most real-service usage.
3. **Phase 3** (lexical-first) — ship independently; speeds verbatim quotes and is the
   prerequisite for cheap matching on interims.
4. **Phase 2A** (Whisper interims, two-tier) — combine with 1+3 for verbatim "near-
   instant."
5. **Phase 2B** (streaming engine) — research spike; adopt only if it beats 2A on the
   Phase 0 numbers. The biggest long-term win but the highest effort/risk.

Phases 1 and 3 alone — no new dependency, no engine swap — should take the common cases
from 5–7 s to sub-2 s and make announced references feel instant. That is the bulk of
the perceived improvement; 2/2B are how you match the *hardest* (read-aloud, paraphrase)
cases.
