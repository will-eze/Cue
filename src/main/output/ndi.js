import { createRequire } from 'module';

// Use createRequire to load the platform binary at runtime — bypasses Vite's CJS
// bundler which would convert a static `import grandi from 'grandi'` to
// `require('grandi')`, failing with ERR_REQUIRE_ESM (grandi is ESM-only).
// The @grandi/<os>-<arch> package exports a .node binary directly, which is CJS-loadable.
const _require = createRequire(import.meta.url);

// FourCC and FrameType constants from grandi's TypeScript enums — the native
// binary does not export them, only the ESM wrapper does.
const FOURCC_BGRA            = 1095911234;
const FOURCC_FLTP           = 1884572742; // Float32, planar (one channel block after another)
const FORMAT_TYPE_PROGRESSIVE = 1;

const ARCH_PACKAGES = {
  'darwin-arm64': '@grandi/darwin-arm64',
  'darwin-x64':   '@grandi/darwin-x64',
  'win32-x64':    '@grandi/win32-x64',
  'win32-ia32':   '@grandi/win32-ia32',
  'linux-x64':    '@grandi/linux-x64',
  'linux-arm64':  '@grandi/linux-arm64',
};

let grandi = null;
let ndiAvailable = false;

try {
  const archKey = `${process.platform}-${process.arch}`;
  const pkg = ARCH_PACKAGES[archKey];
  if (!pkg) throw new Error(`No NDI prebuilt for ${archKey}`);
  grandi = _require(pkg);
  ndiAvailable = grandi.isSupportedCPU() && grandi.initialize();
  if (ndiAvailable) console.log('[NDI] Initialized —', grandi.version());
  else console.warn('[NDI] isSupportedCPU or initialize() returned false');
} catch (err) {
  console.error('[NDI] Init failed:', err.message);
  ndiAvailable = false;
}

// channelId → { sender, inflight }
// inflight: frame-drop guard — if the NDI SDK hasn't finished the previous
// sender.video() call, we skip the incoming paint rather than queuing 8MB
// buffers that pile up and exhaust memory.
const senders = new Map();

// Log the first failure of each kind, then at most once every 10s (with a count of
// what was suppressed) — NDI send errors used to be swallowed entirely, which made
// "NDI is black / not arriving" impossible to diagnose from a packaged build.
const errLog = new Map(); // key → { last, suppressed }
function logNdiError(key, msg) {
  const now = Date.now();
  const e = errLog.get(key) || { last: 0, suppressed: 0 };
  if (e.last && now - e.last < 10000) { e.suppressed++; errLog.set(key, e); return; }
  console.error(`[NDI] ${key}: ${msg}${e.suppressed ? ` (+${e.suppressed} similar suppressed)` : ''}`);
  errLog.set(key, { last: now, suppressed: 0 });
}

export function isAvailable() {
  return ndiAvailable;
}

// The initialized native handle, shared with ndi-input.js so receive/find reuse
// the single per-process NDI initialization (grandi.initialize() must run once).
export function getGrandi() {
  return ndiAvailable ? grandi : null;
}

// Sender lifecycle is serialised per channel. grandi.send() is async, so two quick
// re-syncs (or Outputs off→on) used to overlap: a destroy that arrived while a create
// was still pending found nothing to destroy, and the late sender was then orphaned —
// still holding the NDI name, so the replacement was published as "Name (2)" while
// receivers stayed bound to the dead, frameless original. Three guards fix it:
//   generation — every create/destroy bumps it; a create that resolves into a newer
//                generation destroys its own sender instead of registering it.
//   chain      — creates for one channel run strictly one after another.
//   freed      — a destroy deferred behind an in-flight video() must finish before
//                the next create, or the old name is still registered.
const generation = new Map(); // channelId → number
const chain = new Map();      // channelId → Promise (tail of the create queue)
const freed = new Map();      // channelId → Promise (pending deferred destroy)
const bump = (id) => { const g = (generation.get(id) || 0) + 1; generation.set(id, g); return g; };

export function createSender(channelId, name) {
  if (!ndiAvailable) return Promise.resolve(null);
  const myGen = bump(channelId);
  const run = (chain.get(channelId) || Promise.resolve())
    .then(() => createSenderNow(channelId, name, myGen));
  chain.set(channelId, run.catch(() => {}));
  return run;
}

async function createSenderNow(channelId, name, myGen) {
  try {
    if (generation.get(channelId) !== myGen) return null; // superseded while queued
    if (senders.has(channelId)) releaseSender(channelId);
    // Wait (bounded) for a deferred destroy so the name is free again.
    const pending = freed.get(channelId);
    if (pending) await Promise.race([pending, new Promise((r) => setTimeout(r, 1500))]);
    const sender = await grandi.send({
      name: `Cue - ${name}`,
      clockVideo: false,
      clockAudio: false,
    });
    if (generation.get(channelId) !== myGen) {
      // Destroyed or re-created while grandi.send() was pending — never register it.
      try { sender.destroy(); } catch {}
      return null;
    }
    senders.set(channelId, { sender, inflight: false, audioInflight: 0 });
    console.log(`[NDI] Sender "${name}" ready as "${sender.sourcename()}"`);
    return null;
  } catch (err) {
    console.error(`[NDI] Failed to create sender "${name}":`, err.message);
    return err.message || 'NDI sender creation failed';
  }
}

export function sendFrame(channelId, bgraBuffer, width, height, fps) {
  if (!ndiAvailable) return;
  const entry = senders.get(channelId);
  if (!entry || entry.inflight) return;

  // The buffer must be exactly stride*height. A mismatch (e.g. a scaled/HiDPI paint
  // bitmap) would make the native layer read past the end or skew the picture.
  if (!bgraBuffer || bgraBuffer.length < width * height * 4) {
    logNdiError('frame size mismatch', `buffer ${bgraBuffer ? bgraBuffer.length : 0}B < ${width}x${height}x4 — frame dropped`);
    return;
  }

  entry.inflight = true;
  entry.sender
    .video({
      xres: width,
      yres: height,
      frameRateN: Math.round(fps * 1000),
      frameRateD: 1000,
      pictureAspectRatio: width / height,
      frameFormatType: FORMAT_TYPE_PROGRESSIVE,
      lineStrideBytes: width * 4,
      data: bgraBuffer,
      fourCC: FOURCC_BGRA,
    })
    .catch((err) => logNdiError('video send failed', err && err.message))
    .finally(() => {
      entry.inflight = false;
      finishIfIdle(entry);
    });
}

// destroySender() was requested mid-send: free the sender only once BOTH the video
// and every audio native call have returned (freeing under a pending call = UAF).
function finishIfIdle(entry) {
  if (!entry.destroyWhenIdle || entry.inflight || entry.audioInflight > 0 || entry.destroyed) return;
  entry.destroyed = true;
  try { entry.sender.destroy(); } catch {}
  entry.onFreed?.();
}

// Send one program-audio frame to a sender. `planar` is a Buffer of Float32
// samples laid out per-channel (ch0 block, then ch1 block, …) — i.e. FLTp.
// Audio is small and must not be dropped (gaps are audible), so unlike video we
// don't gate on the video inflight flag; we just fire-and-forget.
export function sendAudio(channelId, planar, sampleRate, noChannels, noSamples) {
  if (!ndiAvailable) return;
  const entry = senders.get(channelId);
  if (!entry) return;
  entry.audioInflight = (entry.audioInflight || 0) + 1;
  entry.sender
    .audio({
      sampleRate,
      noChannels,
      noSamples,
      channelStrideBytes: noSamples * 4, // 4 bytes per Float32 sample, planar
      data: planar,
      fourCC: FOURCC_FLTP,
    })
    .catch((err) => logNdiError('audio send failed', err && err.message))
    .finally(() => {
      entry.audioInflight--;
      finishIfIdle(entry);
    });
}

export function destroySender(channelId) {
  bump(channelId); // invalidates any create still pending for this channel
  releaseSender(channelId);
}

function releaseSender(channelId) {
  const entry = senders.get(channelId);
  if (entry) {
    // Never free the sender while sender.video() is awaiting in the native layer
    // (same use-after-free hazard as the NDI-input receiver) — defer to its finally.
    if (entry.inflight || entry.audioInflight > 0) {
      entry.destroyWhenIdle = true;
      const p = new Promise((resolve) => { entry.onFreed = resolve; });
      freed.set(channelId, p);
      p.then(() => { if (freed.get(channelId) === p) freed.delete(channelId); });
    } else { try { entry.sender.destroy(); } catch {} }
    senders.delete(channelId);
    console.log(`[NDI] Sender ${channelId} destroyed`);
  }
}
