// Scripture-detection manager. Owns lifecycle + config and orchestrates the
// pieces: audio in (from the renderer) → ASR → reference parser / content matcher
// → 'scripture:detected' to the renderer. State ownership stays in the renderer
// (OperatorView runs the existing scripture-live handlers); main only resolves
// detection candidates and signals, mirroring the remote:command virtual-operator
// pattern. Heavy work is off-thread (whisper child process, embedding worker).

import * as settings from '../db/settings.js';
import { getDb } from '../db/schema.js';
import { createAsr } from './asr.js';
import { bestReference } from './reference-parser.js';
import * as contentMatch from './content-match.js';
import * as lexicalIndex from './lexical-index.js';
import * as whisperBin from './whisper-bin.js';
import * as embedBin from './embed-bin.js';

const CONFIG_KEY = 'scriptureDetect';
const REF_COOLDOWN_MS = 8000;       // don't re-fire the same ref while still spoken
const CONTENT_MIN_INTERVAL_MS = 1500;

// Responsiveness presets bundle the latency-vs-accuracy knobs (asr.js VAD close +
// interim cadence, and the lexical/semantic content path). 'balanced' is the default
// and matches the shipped tuning; 'instant' leans on aggressive interims + a snappy
// VAD close; 'accurate' restores the original behaviour (no interims, slow close).
// endSilenceMs is the trailing-silence window that CLOSES an utterance. Too low and a
// natural mid-citation pause ("Matthew chapter five … verse three") splits the reference
// across two clips so the parser only sees a fragment — kept ≥ ~360ms even on 'instant'
// to protect reference accuracy. interimCadenceMs is the floor gap between live partial
// decodes; partials defer entirely while a commit is in flight (asr.js), so this only
// paces spare-CPU work.
const PRESETS = {
  instant:  { endSilenceMs: 360, interim: { enabled: true,  cadenceMs: 900,  softPauseMs: 240, model: 'tiny.en' }, lexical: { lexicalMinWords: 3, lexicalMinShared: 3, lexicalMinScore: 0.45, lexicalMinMargin: 0.06 } },
  balanced: { endSilenceMs: 500, interim: { enabled: true,  cadenceMs: 1100, softPauseMs: 300, model: 'tiny.en' }, lexical: { lexicalMinWords: 4, lexicalMinShared: 3, lexicalMinScore: 0.50, lexicalMinMargin: 0.08 } },
  accurate: { endSilenceMs: 600, interim: { enabled: false, cadenceMs: 1200, softPauseMs: 280, model: 'tiny.en' }, lexical: { lexicalMinWords: 5, lexicalMinShared: 4, lexicalMinScore: 0.55, lexicalMinMargin: 0.10 } },
};

function defaults() {
  const p = PRESETS.balanced;
  return {
    enabled: false,
    deviceId: null,
    asrModel: whisperBin.autoModel(),
    matchVersionId: null,
    // Responsiveness preset (see PRESETS). Changing it re-bundles the knobs below.
    responsiveness: 'balanced',
    // VAD utterance close + VAD-gated interim decode (asr.js). interim.model is a
    // fast resident model for live partials; the commit still uses asrModel.
    endSilenceMs: p.endSilenceMs,
    interim: { ...p.interim },
    // autoAction: 'off' = suggest only · 'preview' = stage to preview · 'live' = auto go-live.
    // References auto-preview only when confidence clears referenceAutoConfidence;
    // below that (but above the referenceConfidence detection floor) they suggest.
    // Content matches are inherently lower-confidence → suggest by default.
    //
    // autoLive is the upper band ON TOP of autoAction (feature #4): an explicit opt-in
    // that routes a VERY high-confidence reference (≥ referenceAutoLiveConfidence)
    // straight to air, while mid-high confidence still follows autoAction (preview).
    // Off by default — sending wrong text to air is worse than to preview. Only the
    // authoritative commit can auto-live; interims always downgrade to preview.
    reference: { enabled: true, autoAction: 'preview', autoLive: false },
    content:   { enabled: true, autoAction: 'off' },
    // Lexical path (verbatim quotes, runs on interims, cheap) gates first; the
    // contentMin* gates are the MiniLM semantic fallback (paraphrase). See content-match.js.
    thresholds: {
      referenceConfidence: 0.6, referenceAutoConfidence: 0.8, referenceAutoLiveConfidence: 0.97,
      contentMinScore: 0.62, contentMinMargin: 0.05, contentMinWords: 6,
      ...p.lexical,
    },
  };
}

let cfg = defaults();
let mainWindow = null;
let asr = null;
let vectorBuild = { building: false, progress: null };

// rolling state
let recentWords = [];               // recent committed words for reference parsing
let lastRef = null, lastRefAt = 0;          // last COMMITTED reference fired
let interimRef = null;                       // last INTERIM reference (for stability + commit confirm)
let lastContentRef = null, lastContentAt = 0;
let interimContentRef = null, interimContentAt = 0;
let lastContentRunAt = 0;

// Apply a responsiveness preset's bundled knobs onto a config object (mutates a copy
// the caller passes in). Leaves explicit per-key overrides the user later sets intact
// — those are merged on top by setConfig after this runs.
function applyPreset(target, name) {
  const p = PRESETS[name] || PRESETS.balanced;
  target.responsiveness = name;
  target.endSilenceMs = p.endSilenceMs;
  target.interim = { ...p.interim };
  target.thresholds = { ...target.thresholds, ...p.lexical };
  return target;
}

export function setMainWindow(win) { mainWindow = win; }
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function firstVersionId() {
  return getDb().prepare('SELECT id FROM bible_versions ORDER BY id LIMIT 1').get()?.id ?? null;
}

function readiness() {
  const vid = cfg.matchVersionId ?? firstVersionId();
  return {
    asr: { bin: whisperBin.binReady(), model: whisperBin.modelReady(cfg.asrModel), modelName: cfg.asrModel },
    embed: { model: embedBin.isReady() },
    vectors: {
      versionId: vid,
      built: vid != null && contentMatch.isBuilt(vid),
      building: vectorBuild.building,
      progress: vectorBuild.progress,
    },
  };
}

export function getConfig() {
  return { ...cfg, running: !!asr?.isRunning(), ready: readiness() };
}

export function setConfig(patch = {}) {
  const prev = cfg;
  // A responsiveness change first re-bundles the preset's knobs, THEN any explicit
  // fields in the same patch win on top (so the presets stay a starting point).
  let base = cfg;
  if (patch.responsiveness && patch.responsiveness !== cfg.responsiveness) {
    base = applyPreset({ ...cfg }, patch.responsiveness);
  }
  cfg = { ...base, ...patch,
    interim: { ...base.interim, ...(patch.interim || {}) },
    reference: { ...base.reference, ...(patch.reference || {}) },
    content: { ...base.content, ...(patch.content || {}) },
    thresholds: { ...base.thresholds, ...(patch.thresholds || {}) },
  };
  settings.set(CONFIG_KEY, cfg);
  // Re-arm ASR if anything that shapes the VAD/interim loop or the model changed.
  const armChanged = patch.asrModel
    || (patch.responsiveness && patch.responsiveness !== prev.responsiveness)
    || patch.endSilenceMs != null
    || patch.interim != null;
  if (asr?.isRunning() && armChanged) { stop(); start(); }
  pushStatus();
  return getConfig();
}

function pushStatus() { send('scripture:status', getConfig()); }

export async function init() {
  const saved = settings.get(CONFIG_KEY);
  const d = defaults();
  cfg = { ...d, ...(saved || {}),
    interim: { ...d.interim, ...(saved?.interim || {}) },
    reference: { ...d.reference, ...(saved?.reference || {}) },
    content: { ...d.content, ...(saved?.content || {}) },
    thresholds: { ...d.thresholds, ...(saved?.thresholds || {}) },
  };
  // Re-bundle the active responsiveness preset over the saved config so latency tuning
  // shipped in an update (endSilenceMs, interim cadence, lexical gates) reaches existing
  // users — these are preset-derived, with no manual UI, so re-applying them never
  // clobbers a hand-set value. User choices (model, actions, reference thresholds,
  // device, enabled) live outside the preset and are left intact.
  applyPreset(cfg, cfg.responsiveness || 'balanced');
}

// ── audio + detection ────────────────────────────────────────────────────────
// Lightweight pipeline tracing — visible in the `npm start` main-process console.
// Set CUE_SCRIPTURE_DEBUG=0 to silence. Throttled so audio frames don't spam.
const DBG = process.env.CUE_SCRIPTURE_DEBUG !== '0';
function dbg(...a) { if (DBG) console.log('[scripture-detect]', ...a); }
let audioFrames = 0, audioSamples = 0;

export function pushAudio(int16) {
  if (!asr) return;
  audioFrames++; audioSamples += int16?.length || 0;
  if (audioFrames === 1) dbg('audio: first frame received', int16.length, 'samples');
  else if (audioFrames % 40 === 0) dbg(`audio: ${audioFrames} frames, ${(audioSamples / 16000).toFixed(1)}s total`);
  asr.pushAudio(int16);
}

export function start() {
  if (asr?.isRunning()) return { ok: true };
  // Ensure the resident ASR pipeline is loaded. The disk marker only tells us the
  // weights are present — it does NOT mean the model is loaded in memory, which it
  // never is on a fresh app launch. Loading here (reload from cache, or download on
  // a brand-new machine) is the single robust entry point; the ASR loop below idles
  // (transcribe → null) until this resolves. Progress is surfaced as status.
  whisperBin
    .ensureModel(cfg.asrModel, (p) => send('scripture:status', { ...getConfig(), download: { kind: 'asr', ...p } }), { intraOpNumThreads: whisperBin.commitThreads() })
    .then((r) => {
      if (!r?.ok) send('scripture:status', { ...getConfig(), error: r?.error || 'ASR model failed to load' });
      pushStatus(); // clears download field, reflects readiness
    });
  // Two-tier interims: keep a fast model resident for live partials alongside the
  // commit model. Provision it in the background (a different repo from asrModel);
  // until it's ready, interim decodes idle (transcribe → null) like the commit does.
  const interimModel = cfg.interim?.enabled ? (cfg.interim.model || 'tiny.en') : null;
  if (interimModel && interimModel !== cfg.asrModel) {
    // A small thread budget — interims run on spare CPU and must not starve the commit.
    whisperBin.ensureModel(interimModel, undefined, { intraOpNumThreads: whisperBin.interimThreads() }).then(() => pushStatus());
  }
  dbg('start: arming VAD/ASR, model =', cfg.asrModel, 'interim =', interimModel || 'off');
  // Warm the lexical verse index off the hot path so the first interim content match
  // doesn't pay the one-time ~31k-verse build mid-service.
  if (cfg.content.enabled) {
    const vid = cfg.matchVersionId ?? firstVersionId();
    if (vid != null) setImmediate(() => { try { lexicalIndex.build(vid); } catch {} });
  }
  audioFrames = 0; audioSamples = 0;
  asr = createAsr({
    modelName: cfg.asrModel,
    config: {
      endSilenceMs: cfg.endSilenceMs,
      interimEnabled: !!cfg.interim?.enabled,
      interimCadenceMs: cfg.interim?.cadenceMs,
      softPauseMs: cfg.interim?.softPauseMs,
      interimModel: cfg.interim?.model,
    },
    onTranscript: (t) => send('scripture:transcript', t),
    onCommitted: (fresh, committed, meta) => onCommitted(fresh, committed, meta),
    onInterim: (m) => onInterim(m),
    onError: (e) => { dbg('ASR error:', e); send('scripture:status', { ...getConfig(), error: e }); },
  });
  asr.start();
  pushStatus();
  return { ok: true };
}

export function stop() {
  asr?.stop();
  asr = null;
  recentWords = [];
  interimRef = null;
  interimContentRef = null; interimContentAt = 0;
  pushStatus();
  return { ok: true };
}

// Authoritative end-of-utterance commit (Whisper on the closed clip). This is the
// source of truth: it CONFIRMS an interim already previewed (same candidateId, no
// re-stage/flicker) or corrects it.
function onCommitted(fresh, committed, meta = {}) {
  dbg('committed:', JSON.stringify(fresh));
  recentWords.push(...fresh.split(/\s+/).filter(Boolean));
  if (recentWords.length > 40) recentWords = recentWords.slice(-40);

  if (cfg.reference.enabled) detectReference(recentWords.slice(-12).join(' '), false, meta);
  if (cfg.content.enabled) tryContent(recentWords.slice(-25).join(' '), false, meta);
}

// Interim hypothesis WHILE speech is still active (VAD-gated, latest-wins). Runs the
// same cheap reference parse + lexical content match on the partial so an announced
// reference resolves mid-sentence. Interims only ever stage a Preview — never Live.
function onInterim({ text, onsetAt } = {}) {
  if (!text) return;
  dbg('interim:', JSON.stringify(text));
  const w = text.split(/\s+/).filter(Boolean);
  const meta = { onsetAt, interim: true };
  if (cfg.reference.enabled) {
    detectReference(recentWords.slice(-6).concat(w).slice(-12).join(' '), true, meta);
  }
  if (cfg.content.enabled) {
    tryContent(recentWords.slice(-15).concat(w).slice(-25).join(' '), true, meta);
  }
}

// candidateId is stable across an interim and its confirming/correcting commit (it's
// the resolved ref), so OperatorView updates the suggestion IN PLACE rather than
// prepending a duplicate. `interim` flips the cooldown bookkeeping: interim fires are
// tracked separately so the final commit is allowed through as a CONFIRMATION, not
// suppressed as a duplicate of the interim.
function logLatency(kind, ref, meta) {
  if (DBG && meta?.onsetAt) dbg(`latency onset→${kind} = ${Date.now() - meta.onsetAt} ms (${ref})`);
}

function detectReference(text, interim, meta) {
  const ref = bestReference(text);
  if (!ref) return;
  dbg('reference parse:', JSON.stringify(text), '→', ref.ref, `(conf ${ref.confidence.toFixed(2)}, floor ${cfg.thresholds.referenceConfidence}${interim ? ', interim' : ''})`);
  if (ref.confidence < cfg.thresholds.referenceConfidence) return;
  const now = Date.now();
  const highConf = ref.confidence >= cfg.thresholds.referenceAutoConfidence;

  if (interim) {
    // An interim is a partial hypothesis on the fast model, so by default it only
    // SUGGESTS. But once it parses a COMPLETE reference (an explicit verse, not just a
    // book/chapter), clears the preview band, AND repeats on the next interim (stable,
    // i.e. not a one-frame mis-hear), it's as trustworthy as the commit for that ref —
    // so stage it to Preview now for the speed win. Interims still never auto-air; the
    // commit confirms it in place (or corrects) via the shared candidateId.
    const stable = ref.ref === interimRef;          // same ref as the previous interim
    interimRef = ref.ref;
    const action = (stable && highConf && ref.vStart != null) ? 'preview' : 'suggest';
    logLatency('ref(interim)', ref.ref, meta);
    fireDetected('reference', ref.ref, ref.confidence, action, true, null);
  } else {
    // Confirming the interim we already previewed bypasses the duplicate cooldown.
    const confirming = ref.ref === interimRef;
    if (!confirming && ref.ref === lastRef && now - lastRefAt < REF_COOLDOWN_MS) return;
    lastRef = ref.ref; lastRefAt = now;
    if (confirming) interimRef = null;
    // Band routing (feature #4): very-high confidence + opt-in → live; high → autoAction;
    // floor → suggest. The auto-live band sits ABOVE autoAction, so it can promote a
    // 'preview' (or even 'suggest') default to air for a near-certain citation.
    let action;
    if (cfg.reference.autoLive && ref.confidence >= cfg.thresholds.referenceAutoLiveConfidence) {
      action = 'live';
    } else if (highConf && cfg.reference.autoAction !== 'off') {
      action = cfg.reference.autoAction;
    } else {
      action = 'suggest';
    }
    logLatency('ref', ref.ref, meta);
    fireDetected('reference', ref.ref, ref.confidence, action, false, null);
  }
}

async function tryContent(text, interim, meta) {
  // The commit path throttles its own cadence; interims are already rate-limited by
  // the ASR interim cadence, so they bypass this gate to stay responsive.
  const now = Date.now();
  if (!interim) {
    if (now - lastContentRunAt < CONTENT_MIN_INTERVAL_MS) return;
    lastContentRunAt = now;
  }
  const vid = cfg.matchVersionId ?? firstVersionId();
  if (vid == null) return;
  const gates = {
    minScore: cfg.thresholds.contentMinScore,
    minMargin: cfg.thresholds.contentMinMargin,
    minWords: cfg.thresholds.contentMinWords,
    lexicalMinWords: cfg.thresholds.lexicalMinWords,
    lexicalMinShared: cfg.thresholds.lexicalMinShared,
    lexicalMinScore: cfg.thresholds.lexicalMinScore,
    lexicalMinMargin: cfg.thresholds.lexicalMinMargin,
  };
  // Lexical-first (verbatim) runs from the DB only; the MiniLM semantic fallback
  // (paraphrase) needs the embedding index, which content-match handles internally.
  let res;
  try { res = await contentMatch.match(vid, text, gates); } catch { return; }
  if (!res?.ok) return;

  if (interim) {
    if (res.hit.ref === interimContentRef && now - interimContentAt < REF_COOLDOWN_MS) return;
    interimContentRef = res.hit.ref; interimContentAt = now;
    const action = cfg.content.autoAction === 'preview' ? 'preview' : 'suggest'; // never auto-live on interim
    dbg('DETECTED content (interim) →', res.hit.ref, `via ${res.method || 'semantic'} action=${action} score=${res.score.toFixed(2)}`);
    logLatency('content(interim)', res.hit.ref, meta);
    fireDetected('content', res.hit.ref, res.score, action, true, res.hit);
  } else {
    const confirming = res.hit.ref === interimContentRef;
    if (!confirming && res.hit.ref === lastContentRef && Date.now() - lastContentAt < REF_COOLDOWN_MS) return;
    lastContentRef = res.hit.ref; lastContentAt = Date.now();
    if (confirming) interimContentRef = null;
    const action = cfg.content.autoAction !== 'off' ? cfg.content.autoAction : 'suggest';
    dbg('DETECTED content →', res.hit.ref, `via ${res.method || 'semantic'} action=${action} score=${res.score.toFixed(2)}`);
    logLatency('content', res.hit.ref, meta);
    fireDetected('content', res.hit.ref, res.score, action, false, res.hit);
  }
}

function fireDetected(mode, ref, confidence, action, interim, hit) {
  send('scripture:detected', {
    mode,
    ref,
    candidateId: `${mode}:${ref}`,
    interim: !!interim,
    coords: hit ? { bookNum: hit.bookNum, chapter: hit.chapter, verse: hit.verse } : undefined,
    versionId: (mode === 'content' ? hit?.versionId : null) ?? cfg.matchVersionId ?? firstVersionId(),
    confidence,
    action,
  });
}

// ── provisioning ─────────────────────────────────────────────────────────────
export async function ensureAsrModel() {
  const r = await whisperBin.ensureModel(cfg.asrModel, (p) => send('scripture:status', { ...getConfig(), download: { kind: 'asr', ...p } }), { intraOpNumThreads: whisperBin.commitThreads() });
  pushStatus(); // clears the download field + reflects new model readiness
  return r;
}

export async function buildVectors(versionId) {
  const vid = versionId ?? cfg.matchVersionId ?? firstVersionId();
  if (vid == null) return { ok: false, error: 'No Bible translation installed' };
  vectorBuild = { building: true, progress: { phase: 'start' } };
  pushStatus();
  const res = await contentMatch.buildVectors(vid, (p) => {
    vectorBuild.progress = p;
    send('scripture:status', { ...getConfig() });
  });
  vectorBuild = { building: false, progress: null };
  pushStatus();
  return res;
}

export function dispose() {
  stop();
  contentMatch.dispose();
}
