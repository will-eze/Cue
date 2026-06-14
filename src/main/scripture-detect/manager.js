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
import * as whisperBin from './whisper-bin.js';
import * as embedBin from './embed-bin.js';

const CONFIG_KEY = 'scriptureDetect';
const REF_COOLDOWN_MS = 8000;       // don't re-fire the same ref while still spoken
const CONTENT_MIN_INTERVAL_MS = 1500;

function defaults() {
  return {
    enabled: false,
    deviceId: null,
    asrModel: whisperBin.autoModel(),
    matchVersionId: null,
    // autoAction: 'off' = suggest only · 'preview' = stage to preview · 'live' = auto go-live.
    // References auto-preview only when confidence clears referenceAutoConfidence;
    // below that (but above the referenceConfidence detection floor) they suggest.
    // Content matches are inherently lower-confidence → suggest by default.
    reference: { enabled: true, autoAction: 'preview' },
    content:   { enabled: true, autoAction: 'off' },
    thresholds: { referenceConfidence: 0.6, referenceAutoConfidence: 0.8, contentMinScore: 0.62, contentMinMargin: 0.05, contentMinWords: 6 },
  };
}

let cfg = defaults();
let mainWindow = null;
let asr = null;
let vectorBuild = { building: false, progress: null };

// rolling state
let recentWords = [];               // recent committed words for reference parsing
let lastRef = null, lastRefAt = 0;
let lastContentRef = null, lastContentAt = 0;
let lastContentRunAt = 0;

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
  cfg = { ...cfg, ...patch,
    reference: { ...cfg.reference, ...(patch.reference || {}) },
    content: { ...cfg.content, ...(patch.content || {}) },
    thresholds: { ...cfg.thresholds, ...(patch.thresholds || {}) },
  };
  settings.set(CONFIG_KEY, cfg);
  // Re-arm ASR with the (possibly new) model.
  if (asr?.isRunning() && patch.asrModel) { stop(); start(); }
  pushStatus();
  return getConfig();
}

function pushStatus() { send('scripture:status', getConfig()); }

export async function init() {
  const saved = settings.get(CONFIG_KEY);
  cfg = { ...defaults(), ...(saved || {}),
    reference: { ...defaults().reference, ...(saved?.reference || {}) },
    content: { ...defaults().content, ...(saved?.content || {}) },
    thresholds: { ...defaults().thresholds, ...(saved?.thresholds || {}) },
  };
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
    .ensureModel(cfg.asrModel, (p) => send('scripture:status', { ...getConfig(), download: { kind: 'asr', ...p } }))
    .then((r) => {
      if (!r?.ok) send('scripture:status', { ...getConfig(), error: r?.error || 'ASR model failed to load' });
      pushStatus(); // clears download field, reflects readiness
    });
  dbg('start: arming VAD/ASR, model =', cfg.asrModel);
  audioFrames = 0; audioSamples = 0;
  asr = createAsr({
    modelName: cfg.asrModel,
    onTranscript: (t) => send('scripture:transcript', t),
    onCommitted: (fresh, committed) => onCommitted(fresh, committed),
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
  pushStatus();
  return { ok: true };
}

function onCommitted(fresh, committed) {
  dbg('committed:', JSON.stringify(fresh));
  recentWords.push(...fresh.split(/\s+/).filter(Boolean));
  if (recentWords.length > 40) recentWords = recentWords.slice(-40);

  if (cfg.reference.enabled) tryReference();
  if (cfg.content.enabled) tryContent();
}

function tryReference() {
  // Parse the last ~12 words — enough to span "first corinthians thirteen verse four".
  const window = recentWords.slice(-12).join(' ');
  const ref = bestReference(window);
  if (!ref) return;
  dbg('reference parse:', JSON.stringify(window), '→', ref.ref, `(conf ${ref.confidence.toFixed(2)}, floor ${cfg.thresholds.referenceConfidence})`);
  if (ref.confidence < cfg.thresholds.referenceConfidence) return;
  const now = Date.now();
  if (ref.ref === lastRef && now - lastRefAt < REF_COOLDOWN_MS) return;
  lastRef = ref.ref; lastRefAt = now;
  // High-confidence references take the configured auto-action (preview/live);
  // lower-confidence ones are suggestions the operator confirms.
  const action = (ref.confidence >= cfg.thresholds.referenceAutoConfidence && cfg.reference.autoAction !== 'off')
    ? cfg.reference.autoAction : 'suggest';
  dbg('DETECTED reference →', ref.ref, `action=${action} conf=${ref.confidence.toFixed(2)}`);
  send('scripture:detected', {
    mode: 'reference',
    ref: ref.ref,
    versionId: cfg.matchVersionId ?? firstVersionId(),
    confidence: ref.confidence,
    action,
  });
}

async function tryContent() {
  const now = Date.now();
  if (now - lastContentRunAt < CONTENT_MIN_INTERVAL_MS) return;
  lastContentRunAt = now;
  const vid = cfg.matchVersionId ?? firstVersionId();
  if (vid == null) return;
  // Never build on the hot path — only match once the index exists (Settings builds it).
  if (!embedBin.isReady() || !contentMatch.isBuilt(vid)) return;
  const window = recentWords.slice(-25).join(' ');
  const gates = {
    minScore: cfg.thresholds.contentMinScore,
    minMargin: cfg.thresholds.contentMinMargin,
    minWords: cfg.thresholds.contentMinWords,
  };
  let res;
  try { res = await contentMatch.match(vid, window, gates); } catch { return; }
  if (!res?.ok) return;
  if (res.hit.ref === lastContentRef && Date.now() - lastContentAt < REF_COOLDOWN_MS) return;
  lastContentRef = res.hit.ref; lastContentAt = Date.now();
  const action = cfg.content.autoAction !== 'off' ? cfg.content.autoAction : 'suggest';
  dbg('DETECTED content →', res.hit.ref, `action=${action} score=${res.score.toFixed(2)}`);
  send('scripture:detected', {
    mode: 'content',
    ref: res.hit.ref,
    coords: { bookNum: res.hit.bookNum, chapter: res.hit.chapter, verse: res.hit.verse },
    versionId: vid,
    confidence: res.score,
    action,
  });
}

// ── provisioning ─────────────────────────────────────────────────────────────
export async function ensureAsrModel() {
  const r = await whisperBin.ensureModel(cfg.asrModel, (p) => send('scripture:status', { ...getConfig(), download: { kind: 'asr', ...p } }));
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
