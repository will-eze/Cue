import { nativeImage } from 'electron';
import { getGrandi, isAvailable } from './ndi.js';

// ── NDI INPUT (receive) ────────────────────────────────────────────────────────
// Receives NDI video sources (cameras, ATEM/vMix/OBS outputs, other machines) and
// routes the frames to Cue's output windows as a live program source.
//
// Architecture:
//  - One persistent Finder discovers sources on the network (listSources()).
//  - One receiver + framesync per active source. The framesync (NDI's time-base
//    corrector) lets US clock the pull loop — fs.video() always returns the best
//    current frame immediately, so a steady setInterval gives smooth motion
//    without buffering or racing the sender's clock.
//  - Video is requested as RGBX_RGBA so the output windows can paint the buffer
//    straight into a <canvas> ImageData with zero per-frame conversion. Frames go
//    to each subscribed window via webContents.send — an ~8MB copy per window per
//    frame at 1080p30, which Electron's IPC handles fine for the 1-3 windows that
//    ever show program video (stage/lower-third windows are excluded).
//  - A source is pulled while it is the PROGRAM source (frames → output windows)
//    and/or PREVIEWED in the operator UI (ref-counted; low-rate JPEG thumbnails
//    only). Receivers are torn down when neither applies.
//  - Thumbnails: the RGBA frame is swizzled to BGRA (nativeImage expects BGRA),
//    downscaled and JPEG-encoded at ~2fps for the operator's monitors — the live
//    monitor renders from this pushed data, never from a screen-capture loop.
//
// Feedback guard: Cue's own NDI senders are filtered out of listSources so an
// operator can't route a Cue output back into Cue's program (infinite mirror).

// grandi enum values (the native binary doesn't export the TS enums — see ndi.js).
const COLOR_FORMAT_RGBX_RGBA = 2;
const BANDWIDTH_HIGHEST = 100;
const FORMAT_TYPE_PROGRESSIVE = 1;

const FRAME_MS = 33;          // ~30fps program pull
const PREVIEW_ONLY_MS = 100;  // 10fps pull when only previewed (thumbnails need less)
const THUMB_MS = 450;         // ~2fps operator thumbnails
const THUMB_WIDTH = 480;

// Audio pull: the framesync resamples to OUR clock and inserts silence on
// underrun, so a steady 100ms cadence at a fixed rate gives gapless PCM.
const AUDIO_MS = 100;
const AUDIO_RATE = 48000;
const AUDIO_CHANNELS = 2;
const AUDIO_SAMPLES = (AUDIO_RATE * AUDIO_MS) / 1000; // per pull
const AUDIO_FORMAT_FLOAT32_INTERLEAVED = 1; // grandi AudioFormat enum

let finder = null;
let finderFailed = false;

// sourceName → {
//   receiver, fsync, timer, pulling,
//   program: boolean, previewRefs: number,
//   lastTimestamp, lastThumbAt, connected,
// }
const inputs = new Map();

// Wired by manager.js: getTargets() → BrowserWindows that render program video;
// notify(channel, payload) → push to the operator renderer; onAudioFrame →
// route a planar Float32 PCM pull (audible window + NDI-out senders).
let getTargets = () => [];
let notify = () => {};
let onAudioFrame = () => {};
export function configure(opts) {
  if (opts.getTargets) getTargets = opts.getTargets;
  if (opts.notify) notify = opts.notify;
  if (opts.onAudioFrame) onAudioFrame = opts.onAudioFrame;
}

let finderStarting = null;
async function ensureFinder() {
  if (finder || finderFailed) return finder;
  const grandi = getGrandi();
  if (!grandi) return null;
  // Coalesce concurrent callers onto one find() so we never create two finders.
  if (!finderStarting) {
    finderStarting = (async () => {
      try {
        // showLocalSources so sources on THIS machine (OBS, a local camera app)
        // are usable too; Cue's own senders are filtered by name below.
        finder = await grandi.find({ showLocalSources: true });
      } catch (err) {
        console.error('[NDI-in] Finder failed:', err.message);
        finderFailed = true;
      } finally {
        finderStarting = null;
      }
      return finder;
    })();
  }
  return finderStarting;
}

// Kick off NDI discovery in the background so the first time the operator opens
// the Live tab the source list is already warm (no perceptible wait). Cheap and
// idempotent — the finder is created once and left running.
export function warmUp() {
  if (!isAvailable()) return;
  ensureFinder();
}

// The finder's live snapshot, with Cue's own senders filtered out. NDI names
// look like "HOST (Cue - Main)" — hide them so an output can never be routed
// back into the program (feedback loop). Synchronous + instant.
function currentSources(f) {
  return (f.sources() || [])
    .filter((s) => !/\(Cue - /.test(s.name || ''))
    .map((s) => ({ name: s.name, urlAddress: s.urlAddress || null }));
}

// Discover current NDI sources. `waitMs` gives the finder a short budget to turn
// up its first source when nothing has been discovered yet.
//
// IMPORTANT: never call the finder's synchronous `wait()` here — it blocks the
// main-process event loop for the whole timeout (the "spinning beach ball" when
// opening the Live tab, and every IPC/window stalls with it). Discovery runs on
// native background threads, so `sources()` is instant; we poll it with awaited
// yields instead, which lets the event loop breathe and returns as soon as a
// source appears.
export async function listSources(waitMs = 0) {
  if (!isAvailable()) return { available: false, sources: [] };
  const f = await ensureFinder();
  if (!f) return { available: false, sources: [] };
  try {
    if (waitMs > 0) {
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline && currentSources(f).length === 0) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }
    return { available: true, sources: currentSources(f) };
  } catch {
    return { available: true, sources: [] };
  }
}

function entryFor(sourceName) {
  let e = inputs.get(sourceName);
  if (!e) {
    e = {
      receiver: null, fsync: null, timer: null, pulling: false, onIdle: null,
      audioTimer: null, audioPulling: false,
      program: false, previewRefs: 0,
      lastTimestamp: null, lastThumbAt: 0, connected: false, starting: false,
    };
    inputs.set(sourceName, e);
  }
  return e;
}

async function startReceiver(sourceName, e) {
  if (e.receiver || e.starting) return;
  e.starting = true;
  const grandi = getGrandi();
  try {
    e.receiver = await grandi.receive({
      source: { name: sourceName },
      colorFormat: COLOR_FORMAT_RGBX_RGBA,
      bandwidth: BANDWIDTH_HIGHEST,
      allowVideoFields: false,
      name: 'Cue Input',
    });
    e.fsync = await grandi.framesync(e.receiver);
    pushTally(e);
    schedulePump(sourceName, e);
    scheduleAudio(sourceName, e);
    console.log(`[NDI-in] Receiving "${sourceName}"`);
  } catch (err) {
    console.error(`[NDI-in] receive("${sourceName}") failed:`, err.message);
    stopReceiver(sourceName, e);
    notify('liveinput:status', { sourceName, connected: false, error: err.message });
  } finally {
    e.starting = false;
  }
}

function stopReceiver(sourceName, e) {
  if (e.timer) { clearInterval(e.timer); e.timer = null; }
  if (e.audioTimer) { clearInterval(e.audioTimer); e.audioTimer = null; }
  const fsync = e.fsync;
  const receiver = e.receiver;
  e.fsync = null;     // pump()/pumpAudio() early-return from here on
  e.receiver = null;
  e.connected = false;
  if (!e.program && e.previewRefs <= 0) inputs.delete(sourceName);
  if (!fsync && !receiver) return;

  const destroy = () => {
    // Destroy order matters: framesync before its receiver (grandi requirement).
    try { fsync?.destroy(); } catch {}
    try { receiver?.tally({ onProgram: false, onPreview: false }); } catch {}
    try { receiver?.destroy(); } catch {}
    console.log(`[NDI-in] Stopped "${sourceName}"`);
  };
  // NEVER destroy while a framesync pull is awaiting in the native layer — the
  // pending video()/audio() then resolves against freed memory and segfaults the
  // whole app. Defer to the pumps' finally (e.onIdle) while any pull is in flight.
  if (e.pulling || e.audioPulling) e.onIdle = destroy;
  else destroy();
}

// Run the deferred teardown once NO pull (video or audio) is in flight.
function maybeRunIdle(e) {
  if (e.pulling || e.audioPulling) return;
  if (e.onIdle) { const f = e.onIdle; e.onIdle = null; f(); }
}

// (Re)start the pull loop at the cadence the current use demands. Program use
// pulls at full rate; preview-only drops to a thumbnail-friendly trickle.
function schedulePump(sourceName, e) {
  if (e.timer) { clearInterval(e.timer); e.timer = null; }
  if (!e.fsync) return;
  const ms = e.program ? FRAME_MS : PREVIEW_ONLY_MS;
  e.timer = setInterval(() => pump(sourceName, e), ms);
}

async function pump(sourceName, e) {
  if (e.pulling || !e.fsync) return; // in-flight guard — never queue pulls
  e.pulling = true;
  try {
    const f = await e.fsync.video(FORMAT_TYPE_PROGRESSIVE);
    if (!f || f.type === 'timeout' || !f.data || !f.xres) {
      if (e.connected) {
        e.connected = false;
        notify('liveinput:status', { sourceName, connected: false });
      }
      return;
    }
    if (!e.connected) {
      e.connected = true;
      notify('liveinput:status', { sourceName, connected: true, w: f.xres, h: f.yres });
    }

    // The framesync repeats the last frame when the sender is slower than our
    // clock — skip identical frames (same PTP timestamp) to save the IPC copies.
    const ts = f.timestamp ? `${f.timestamp[0]}:${f.timestamp[1]}` : null;
    const isNew = !ts || ts !== e.lastTimestamp;
    e.lastTimestamp = ts;

    if (e.program && isNew) {
      const msg = {
        sourceName,
        w: f.xres, h: f.yres,
        stride: f.lineStrideBytes || f.xres * 4,
        data: f.data, // RGBA — paints straight into canvas ImageData
      };
      for (const win of getTargets()) {
        try { if (!win.isDestroyed()) win.webContents.send('live:frame', msg); } catch {}
      }
    }

    // Low-rate operator thumbnail (preview picker + live/preview monitors).
    const now = Date.now();
    if ((e.previewRefs > 0 || e.program) && now - e.lastThumbAt >= THUMB_MS && isNew) {
      e.lastThumbAt = now;
      const jpeg = encodeThumb(f);
      if (jpeg) notify('liveinput:preview', { sourceName, dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}` });
    }
  } catch {
    // transient pull failure — keep the loop alive
  } finally {
    e.pulling = false;
    // Deferred teardown parked by stopReceiver while this pull was in flight.
    maybeRunIdle(e);
  }
}

// ── Audio pump ────────────────────────────────────────────────────────────────
// Pulls program audio through the framesync at a steady cadence while the source
// is ON PROGRAM (previews are video-only). The framesync resamples to the rate we
// ask for and inserts silence on underrun, so the stream is gapless by
// construction. Frames are normalised to tightly-packed planar Float32 (FLTp) —
// the exact layout ndi.sendAudio wants and one subarray per channel for Web Audio.
function scheduleAudio(sourceName, e) {
  if (e.audioTimer) { clearInterval(e.audioTimer); e.audioTimer = null; }
  if (!e.fsync || !e.program) return;
  e.audioTimer = setInterval(() => pumpAudio(sourceName, e), AUDIO_MS);
}

async function pumpAudio(sourceName, e) {
  if (e.audioPulling || !e.fsync) return; // in-flight guard — never queue pulls
  e.audioPulling = true;
  try {
    // Feed-health gate: with the sender gone (or not yet connected) the framesync
    // answers audio pulls with repeated tail samples/garbage — an audible
    // high-frequency buzz. Only forward pulls while the VIDEO side is live AND
    // the framesync actually holds real queued audio; otherwise emit nothing
    // (the renderer's scheduler simply drains to silence within ~100ms).
    if (!e.connected) return;
    let depth = 0;
    try { depth = e.fsync.audioQueueDepth(); } catch { depth = 0; }
    if (!(depth > 0)) return;
    const f = await e.fsync.audio({ sampleRate: AUDIO_RATE, noChannels: AUDIO_CHANNELS, noSamples: AUDIO_SAMPLES });
    if (!f || f.type !== 'audio' || !f.data || !f.samples) return;
    const planar = normalizePlanar(f);
    if (planar) onAudioFrame(sourceName, planar, f.sampleRate || AUDIO_RATE, f.channels || AUDIO_CHANNELS, f.samples);
  } catch {
    // transient pull failure — keep the loop alive
  } finally {
    e.audioPulling = false;
    maybeRunIdle(e);
  }
}

// ReceivedAudioFrame → tightly-packed planar Float32 Buffer ([ch0…, ch1…]).
function normalizePlanar(f) {
  try {
    const ch = f.channels || AUDIO_CHANNELS;
    const n = f.samples;
    if (f.audioFormat === AUDIO_FORMAT_FLOAT32_INTERLEAVED) {
      const src = new Float32Array(f.data.buffer, f.data.byteOffset, n * ch);
      const out = Buffer.allocUnsafe(n * ch * 4);
      const view = new Float32Array(out.buffer, out.byteOffset, n * ch);
      for (let c = 0; c < ch; c++) {
        for (let i = 0; i < n; i++) view[c * n + i] = src[i * ch + c];
      }
      return out;
    }
    // Planar (Float32Separate). Tightly packed already → zero-copy slice.
    const stride = f.channelStrideInBytes || n * 4;
    if (stride === n * 4) return f.data.length === n * ch * 4 ? f.data : f.data.subarray(0, n * ch * 4);
    // Padded rows → repack.
    const out = Buffer.allocUnsafe(n * ch * 4);
    for (let c = 0; c < ch; c++) f.data.copy(out, c * n * 4, c * stride, c * stride + n * 4);
    return out;
  } catch {
    return null;
  }
}

// RGBA frame → downscaled JPEG. nativeImage.createFromBitmap expects BGRA, so
// swizzle R↔B first (a few ms at 1080p, and we only run this ~2×/sec).
function encodeThumb(f) {
  try {
    const w = f.xres, h = f.yres;
    const stride = f.lineStrideBytes || w * 4;
    const src = f.data;
    const bgra = Buffer.allocUnsafe(w * h * 4);
    for (let y = 0; y < h; y++) {
      const rowIn = y * stride;
      const rowOut = y * w * 4;
      for (let x = 0; x < w * 4; x += 4) {
        bgra[rowOut + x]     = src[rowIn + x + 2]; // B ← R slot
        bgra[rowOut + x + 1] = src[rowIn + x + 1]; // G
        bgra[rowOut + x + 2] = src[rowIn + x];     // R ← B slot
        bgra[rowOut + x + 3] = 255;
      }
    }
    const img = nativeImage.createFromBitmap(bgra, { width: w, height: h });
    return img.resize({ width: THUMB_WIDTH }).toJPEG(70);
  } catch {
    return null;
  }
}

// Push receiver tally so the camera/source shows its on-air state.
function pushTally(e) {
  try { e.receiver?.tally({ onProgram: !!e.program, onPreview: e.previewRefs > 0 }); } catch {}
}

// Tear down a source when neither program nor preview needs it.
function maybeStop(sourceName, e) {
  if (e.program || e.previewRefs > 0) return;
  stopReceiver(sourceName, e);
  inputs.delete(sourceName);
}

// ── Program source (what the output windows show) ─────────────────────────────
let programSource = null;

// Called by manager.js whenever the live payload / display mode changes.
// sourceName = null when no live-input payload is on program.
export function setProgramSource(sourceName) {
  if (!isAvailable()) return;
  if (programSource === sourceName) return;

  // Drop the old program source.
  if (programSource) {
    const old = inputs.get(programSource);
    if (old) {
      old.program = false;
      pushTally(old);
      if (old.fsync) {
        schedulePump(programSource, old);
        scheduleAudio(programSource, old); // program off → audio pump stops
      }
      maybeStop(programSource, old);
    }
  }
  programSource = sourceName;
  if (!sourceName) return;

  const e = entryFor(sourceName);
  e.program = true;
  if (e.receiver) {
    pushTally(e);
    schedulePump(sourceName, e); // bump to full frame rate
    scheduleAudio(sourceName, e);
  } else {
    startReceiver(sourceName, e);
  }
}

export function getProgramSource() {
  return programSource;
}

// ── Operator preview (ref-counted, thumbnails only) ───────────────────────────
export function previewStart(sourceName) {
  if (!isAvailable() || !sourceName) return { ok: false };
  const e = entryFor(sourceName);
  e.previewRefs++;
  e.lastThumbAt = 0; // emit a thumbnail immediately
  if (e.receiver) pushTally(e);
  else startReceiver(sourceName, e);
  return { ok: true };
}

export function previewStop(sourceName) {
  const e = inputs.get(sourceName);
  if (!e) return;
  e.previewRefs = Math.max(0, e.previewRefs - 1);
  pushTally(e);
  maybeStop(sourceName, e);
}

// Shutdown (app quit / outputs closed).
export function stopAll() {
  for (const [name, e] of inputs) stopReceiver(name, e);
  inputs.clear();
  programSource = null;
  try { finder?.destroy(); } catch {}
  finder = null;
}
