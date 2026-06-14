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
export function pushAudio(int16) { asr?.pushAudio(int16); }

export function start() {
  if (asr?.isRunning()) return { ok: true };
  asr = createAsr({
    modelName: cfg.asrModel,
    onTranscript: (t) => send('scripture:transcript', t),
    onCommitted: (fresh, committed) => onCommitted(fresh, committed),
    onError: (e) => send('scripture:status', { ...getConfig(), error: e }),
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
  recentWords.push(...fresh.split(/\s+/).filter(Boolean));
  if (recentWords.length > 40) recentWords = recentWords.slice(-40);

  if (cfg.reference.enabled) tryReference();
  if (cfg.content.enabled) tryContent();
}

function tryReference() {
  // Parse the last ~12 words — enough to span "first corinthians thirteen verse four".
  const window = recentWords.slice(-12).join(' ');
  const ref = bestReference(window);
  if (!ref || ref.confidence < cfg.thresholds.referenceConfidence) return;
  const now = Date.now();
  if (ref.ref === lastRef && now - lastRefAt < REF_COOLDOWN_MS) return;
  lastRef = ref.ref; lastRefAt = now;
  // High-confidence references take the configured auto-action (preview/live);
  // lower-confidence ones are suggestions the operator confirms.
  const action = (ref.confidence >= cfg.thresholds.referenceAutoConfidence && cfg.reference.autoAction !== 'off')
    ? cfg.reference.autoAction : 'suggest';
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
