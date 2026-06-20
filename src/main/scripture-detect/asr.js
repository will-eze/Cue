// CPU backend adapter for the VAD-segmented ASR core (see asr-core.js).
//
// The VAD state machine + interim/commit orchestration now live in the env-free
// asr-core.js so the WebGPU renderer worker can share the exact same logic. This file
// is the thin MAIN-process adapter: it resolves the two-tier model selection (commit
// model + optional fast interim model, e.g. tiny.en) and injects whisper-bin.js'
// transcribe() as the core's transcribeCommit/transcribeInterim. Behaviour is identical
// to the previous monolithic asr.js — see CLAUDE.md / master reference §17 for the rules
// the interim/commit path must preserve.

import * as whisperBin from './whisper-bin.js';
import { createAsrCore } from './asr-core.js';

// Adapter-level defaults for the two-tier model selection (the timing knobs default in
// asr-core.js). Mirrors the old asr.js so an empty config still means "interims on, fast
// model tiny.en" — the manager always passes these explicitly, this is the fallback.
const ADAPTER_DEFAULTS = { interimEnabled: true, interimModel: 'tiny.en' };

export function createAsr({
  modelName = 'base.en', onTranscript, onCommitted, onInterim, onError, config = {},
} = {}) {
  const c = { ...ADAPTER_DEFAULTS, ...config };
  // Interims only make sense on a model that's actually loadable; if the configured
  // interim model is the commit model, they share one serialized pipe (still safe, just
  // no parallelism). 'off'/null disables the second pipe and reuses the commit.
  const interimModel = c.interimEnabled
    ? (c.interimModel && c.interimModel !== 'off' ? c.interimModel : modelName)
    : null;

  return createAsrCore({
    transcribeCommit: (float32) => whisperBin.transcribe(float32, modelName),
    transcribeInterim: interimModel ? (float32) => whisperBin.transcribe(float32, interimModel) : null,
    onTranscript, onCommitted, onInterim, onError,
    config,
  });
}
