// ── RTMP streaming via ffmpeg ────────────────────────────────────────────────
// Encodes the composited program output (raw BGRA frames from an offscreen window
// + raw f32le program audio from the Web Audio tap) to H.264/AAC and pushes it
// over RTMP to YouTube/Facebook/Twitch/any RTMP target. ffmpeg is the same binary
// auto-downloaded for the YouTube player (src/main/youtube/bin.js) — nothing new
// is bundled.
//
// CSP does not apply here: the RTMP egress happens in this main process, not via a
// renderer fetch. Stream URL/key handling lives in the caller (output manager).
import { spawn, execFile } from 'child_process';
import { ffmpegPath } from '../youtube/bin.js';

let proc = null;
let opts = null;
let onStatus = null;
let state = 'idle';            // idle | starting | live | reconnecting | error
let stopping = false;
let videoBackpressure = false; // drop video frames (never audio) while stdin is full
let reconnectTimer = null;
// Health counters (cumulative since the current launch). A rising droppedFrames count
// means the encoder/network can't keep up — surfaced in the Stream tab.
let droppedFrames = 0;
let sentFrames = 0;

// Probe once for a hardware H.264 encoder; fall back to libx264. Hardware encoders
// are effectively required for 1440p60 / 2160p60 — software can't keep up there.
let cachedEncoder = null;
function pickEncoder() {
  if (cachedEncoder) return Promise.resolve(cachedEncoder);
  const ff = ffmpegPath();
  const prefer = process.platform === 'darwin'
    ? ['h264_videotoolbox']
    : ['h264_nvenc', 'h264_qsv', 'h264_amf'];
  return new Promise((resolve) => {
    if (!ff) return resolve('libx264');
    execFile(ff, ['-hide_banner', '-encoders'], { maxBuffer: 4 << 20 }, (_err, stdout) => {
      const out = stdout || '';
      cachedEncoder = prefer.find((e) => out.includes(e)) || 'libx264';
      resolve(cachedEncoder);
    });
  });
}

function setState(s, detail) {
  state = s;
  try { onStatus?.({ state: s, detail: detail || null, encoder: cachedEncoder || null }); } catch {}
}

function kbps(v) { return parseInt(String(v), 10) || 0; }

function buildArgs(o, encoder) {
  const fps = o.fps || 30;
  const gop = Math.max(2, Math.round(fps * 2)); // YouTube wants ~2s keyframe interval
  const vb = o.videoBitrate || '4500k';
  const ab = o.audioBitrate || '160k';
  const args = [
    '-hide_banner', '-loglevel', 'warning',
    // Video: raw BGRA frames on stdin (pipe:0). Wallclock timestamps keep A/V
    // aligned even when frames are dropped under backpressure.
    '-use_wallclock_as_timestamps', '1',
    '-thread_queue_size', '512',
    '-f', 'rawvideo', '-pixel_format', 'bgra',
    '-video_size', `${o.width}x${o.height}`, '-framerate', String(fps),
    '-i', 'pipe:0',
    // Audio: raw f32le interleaved on fd 3 (pipe:3).
    '-use_wallclock_as_timestamps', '1',
    '-thread_queue_size', '512',
    '-f', 'f32le', '-ar', String(o.sampleRate || 48000), '-ac', String(o.channels || 2),
    '-i', 'pipe:3',
    // Video encode.
    '-c:v', encoder,
    '-pix_fmt', 'yuv420p',
    '-r', String(fps), '-vsync', 'cfr',
    '-g', String(gop), '-keyint_min', String(gop),
    '-b:v', vb, '-maxrate', vb, '-bufsize', `${kbps(vb) * 2}k`,
    // Audio encode.
    '-c:a', 'aac', '-b:a', ab, '-ar', String(o.sampleRate || 48000), '-ac', String(o.channels || 2),
    '-af', 'aresample=async=1',
    // FLV / RTMP.
    '-f', 'flv', o.url,
  ];
  // libx264 needs explicit low-latency tuning; hardware encoders default fine.
  if (encoder === 'libx264') {
    const i = args.indexOf('-pix_fmt');
    args.splice(i, 0, '-preset', 'veryfast', '-tune', 'zerolatency');
  }
  return args;
}

async function launch() {
  const ff = ffmpegPath();
  if (!ff) { setState('error', 'ffmpeg not available'); return { ok: false, error: 'ffmpeg not available' }; }
  if (!opts || !opts.url) { setState('error', 'no stream URL'); return { ok: false, error: 'no stream URL' }; }

  const encoder = await pickEncoder();
  setState('starting');

  proc = spawn(ff, buildArgs(opts, encoder), { stdio: ['pipe', 'ignore', 'pipe', 'pipe'] });
  videoBackpressure = false;
  droppedFrames = 0;
  sentFrames = 0;

  proc.stdin.on('error', () => {});            // EPIPE on teardown is expected
  proc.stdio[3].on('error', () => {});
  proc.stdin.on('drain', () => { videoBackpressure = false; });

  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
    // ffmpeg prints "frame=" progress once it is encoding/pushing — treat as live.
    if (state === 'starting' && stderr.includes('frame=')) setState('live');
  });

  proc.on('error', (e) => { setState('error', e.message); cleanup(); });
  proc.on('exit', (code, signal) => {
    const wasStopping = stopping;
    cleanup();
    if (wasStopping) { setState('idle'); return; }
    // Unexpected exit while streaming → reconnect with a short backoff.
    setState('reconnecting', `ffmpeg exited (${signal || code}). ${stderr.slice(-300)}`);
    reconnectTimer = setTimeout(() => { if (!stopping) launch(); }, 3000);
  });

  return { ok: true, encoder };
}

function cleanup() {
  if (proc) { try { proc.removeAllListeners(); } catch {} try { proc.stdin.destroy(); } catch {} }
  proc = null;
  videoBackpressure = false;
}

// ── Public API ──────────────────────────────────────────────────────────────
export function isActive() { return !!proc; }
export function getStatus() {
  return { state, encoder: cachedEncoder || null, droppedFrames, sentFrames, backpressure: videoBackpressure };
}

export async function start(o, statusCb) {
  if (proc) return { ok: false, error: 'already streaming' };
  opts = o;
  onStatus = statusCb || null;
  stopping = false;
  return launch();
}

export async function stop() {
  stopping = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (proc) {
    try { proc.stdin.end(); } catch {}
    try { proc.kill('SIGINT'); } catch {}
    // Hard-kill if ffmpeg ignores SIGINT.
    setTimeout(() => { try { proc?.kill('SIGKILL'); } catch {} }, 2000);
  } else {
    setState('idle');
  }
  return { ok: true };
}

// Raw BGRA frame (Buffer, width*height*4 bytes). Dropped under backpressure so the
// main process never queues multi-MB frames — mirrors the NDI inflight guard.
export function writeVideo(buf) {
  if (!proc || !proc.stdin.writable) return;
  // Dropped under backpressure → counted so the UI can show an unstable connection.
  if (videoBackpressure) { droppedFrames++; return; }
  sentFrames++;
  if (!proc.stdin.write(buf)) videoBackpressure = true;
}

// Raw f32le interleaved audio (Buffer). Never dropped — gaps are audible.
export function writeAudio(buf) {
  const w = proc && proc.stdio[3];
  if (!w || !w.writable) return;
  w.write(buf);
}
