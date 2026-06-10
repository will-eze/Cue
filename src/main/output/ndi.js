import { createRequire } from 'module';

// Use createRequire to load the platform binary at runtime — bypasses Vite's CJS
// bundler which would convert a static `import grandi from 'grandi'` to
// `require('grandi')`, failing with ERR_REQUIRE_ESM (grandi is ESM-only).
// The @grandi/<os>-<arch> package exports a .node binary directly, which is CJS-loadable.
const _require = createRequire(import.meta.url);

// FourCC and FrameType constants from grandi's TypeScript enums — the native
// binary does not export them, only the ESM wrapper does.
const FOURCC_BGRA            = 1095911234;
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

export function isAvailable() {
  return ndiAvailable;
}

export async function createSender(channelId, name) {
  if (!ndiAvailable) return;
  try {
    const sender = await grandi.send({
      name: `Cue - ${name}`,
      clockVideo: false,
      clockAudio: false,
    });
    senders.set(channelId, { sender, inflight: false });
    console.log(`[NDI] Sender "${name}" ready as "${sender.sourcename()}"`);
  } catch (err) {
    console.error(`[NDI] Failed to create sender "${name}":`, err.message);
  }
}

export function sendFrame(channelId, bgraBuffer, width, height, fps) {
  if (!ndiAvailable) return;
  const entry = senders.get(channelId);
  if (!entry || entry.inflight) return;

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
    .catch(() => {})
    .finally(() => { entry.inflight = false; });
}

export function destroySender(channelId) {
  const entry = senders.get(channelId);
  if (entry) {
    try { entry.sender.destroy(); } catch {}
    senders.delete(channelId);
    console.log(`[NDI] Sender ${channelId} destroyed`);
  }
}
