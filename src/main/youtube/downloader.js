// ── Ephemeral YouTube resolver / downloader ──────────────────────────────────
// Resolves a YouTube URL to a LOCAL video file so it plays through the exact same
// path as any media asset — the single machine-clock transport, cue-media://, NDI
// paint capture, and every operator control — giving a clean, frame-synced,
// fully-controllable feed that an iframe never could.
//
// These downloads are SINGLE-USE and EPHEMERAL: they are never inserted into
// media_assets, never backed up, and the whole cache dir is wiped on quit, on
// startup (crash recovery), and per-clip on removal. Nothing about a YouTube clip
// survives the session except the URL on its rundown cue (which re-resolves).
//
// Latency is hidden by PRE-FETCH: the download starts the moment a URL is pasted
// (speculatively, before Confirm) so the file is usually already local by air time.
import { app } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { ytDlpPath, ffmpegPath, ensureBinaries, refreshYtDlp, isReady } from './bin.js';
import * as settings from '../db/settings.js';

// id → { id, url, status, percent, title, durationMs, path, error, child }
//   status: 'resolving' | 'downloading' | 'processing' | 'ready' | 'error'
const entries = new Map();

let emit = () => {};
// The IPC layer wires this to push 'youtube:status' snapshots to the renderer.
export function setStatusListener(fn) { emit = typeof fn === 'function' ? fn : () => {}; }

export function cacheDir() {
  return path.join(app.getPath('userData'), 'yt-cache');
}

function ensureCacheDir() {
  try { fs.mkdirSync(cacheDir(), { recursive: true }); } catch {}
}

// Extract the 11-char video id from any common YouTube URL form. Returns null for
// non-YouTube / unrecognised input (caller surfaces an error state).
export function parseVideoId(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();
  // Bare id
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1, 12);
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (u.searchParams.get('v')) {
      const id = u.searchParams.get('v').slice(0, 11);
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    const m = /^\/(shorts|embed|v|live)\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
    if (m) return m[2];
  }
  return null;
}

function snapshot(e) {
  if (!e) return null;
  const { child, ...rest } = e; // never leak the child process handle
  return rest;
}

function setStatus(e, patch) {
  Object.assign(e, patch);
  emit(snapshot(e));
}

// Resolve title/duration up front: validates availability (age-gated / private /
// region-locked videos fail here, fast) and gives the cue something to display
// while the bytes download.
function resolveMetadata(id, url, extra = []) {
  return new Promise((resolve) => {
    const args = [
      url, '--no-playlist', '--skip-download', '--no-warnings',
      '--socket-timeout', '30', ...extra,
      '--print', '%(title)s\t%(duration)s',
    ];
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(ytDlpPath(), args, { windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) => {
      if (code !== 0) {
        const line = stderr.split('\n').filter(Boolean).pop() || 'Could not resolve video';
        return resolve({ ok: false, error: line.replace(/^ERROR:\s*/, '') });
      }
      const [title, dur] = stdout.trim().split('\t');
      const durSec = Number(dur);
      resolve({ ok: true, title: title || 'YouTube video', durationMs: Number.isFinite(durSec) ? Math.round(durSec * 1000) : null });
    });
  });
}

// Prefer h264 ≤1080p (hardware-decodable, avoids 4K-AV1 software-decode stutter in
// the offscreen NDI window), then any ≤1080p, then best; always remux/merge to mp4.
const FORMAT = 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b';

// yt-dlp errors that mean YouTube changed and this yt-dlp is stale — a refresh +
// retry usually fixes them (vs a genuine private/region/age error, which won't).
function looksLikeExtractorFailure(err) {
  return !!err && /unable to extract|signature|nsig|jsinterp|player|precondition check failed|http error 403|requested format is not available|sign in to confirm|not a bot/i.test(err);
}

// A YouTube anti-bot / sign-in wall — escalating to another client (web_embedded) or
// supplying browser cookies is what gets past these, not a yt-dlp refresh. YouTube
// phrases this several ways ("Sign in to confirm you're not a bot", a bare "Please
// sign in", age-confirmation, an explicit --cookies hint), so match "sign in" broadly.
function looksLikeBotWall(err) {
  return !!err && /sign in|not a bot|confirm your age|login required|use --cookies|cookies-from-browser/i.test(err);
}

// Errors no client strategy OR account login can fix — surface immediately instead of
// burning the whole cascade. NB: "private"/"members-only" are deliberately NOT here —
// those are auth-gated and the right browser cookies can unlock them, so they must be
// allowed to flow through to the cookies tier.
function isFatalError(err) {
  return !!err && /been removed|has been deleted|does not exist|account.*terminated|copyright grounds|removed for violating|not available in your country/i.test(err);
}

// ── Client cascade ───────────────────────────────────────────────────────────
// Ordered strategies tried against YouTube's anti-bot. Each tier is extra yt-dlp
// args. The cookies tier only exists when the operator has opted into using a
// browser's YouTube login (Settings/modal → `youtube_cookies_browser`). Cookies are
// read by yt-dlp directly from the browser store and never persisted by us.
function clientTiers() {
  const tiers = [
    { name: 'default', extra: [] },
    // Impersonate the embeddable IFrame player — no login, no PO token, but only
    // serves videos whose uploader allows embedding.
    { name: 'web_embedded', extra: ['--extractor-args', 'youtube:player_client=web_embedded'] },
  ];
  const browser = settings.get('youtube_cookies_browser');
  // yt-dlp picks a cookie-compatible client automatically when cookies are present.
  if (browser) tiers.push({ name: 'cookies', extra: ['--cookies-from-browser', browser] });
  return tiers;
}

export function cookieBrowser() { return settings.get('youtube_cookies_browser') || null; }

// Run `attempt(extra)` across the client tiers, escalating on a bot-wall / non-fatal
// failure and refreshing yt-dlp once on a stale-extractor failure. `attempt` returns
// { ok, error, cancelled, ... }. Returns the first ok result (with tierIdx) or the
// last failure. `startIdx` lets a later stage resume at the tier metadata settled on.
async function withClientCascade(e, id, attempt, onTier, startIdx = 0) {
  const tiers = clientTiers();
  let refreshed = false;
  let botWallSeen = false; // tracked across tiers — the last error may differ from the wall
  let last = { ok: false, error: 'No client strategy available' };
  for (let i = Math.min(startIdx, tiers.length - 1); i < tiers.length; i++) {
    onTier?.(tiers[i], i);
    last = await attempt(tiers[i].extra);
    if (entries.get(id) !== e) return { superseded: true };
    if (last.ok) return { ...last, tierIdx: i };
    if (last.cancelled) return last;
    if (looksLikeBotWall(last.error)) botWallSeen = true;
    if (isFatalError(last.error)) return { ...last, botWallSeen }; // no client fixes this — stop now
    // Refresh yt-dlp once and retry the SAME tier before escalating clients. This fires
    // on a stale-extractor failure AND on a bot-wall: a "Please sign in" / "not a bot"
    // wall is very often just an out-of-date yt-dlp (YouTube changes its player every
    // few weeks). refreshYtDlp drops the latest build into userData/bin, which
    // resolveBinary prefers over a stale system/PATH copy — so the retry runs current.
    if (!refreshed && (looksLikeExtractorFailure(last.error) || looksLikeBotWall(last.error))) {
      refreshed = true;
      setStatus(e, { status: 'setup', percent: 0, setupName: 'yt-dlp' });
      const r = await refreshYtDlp((p) => { if (entries.get(id) === e) setStatus(e, { status: 'setup', percent: Math.round((p || 0) * 100), setupName: 'yt-dlp' }); });
      if (entries.get(id) !== e) return { superseded: true };
      if (r.ok) { i--; continue; } // retry same tier with the fresh binary
    }
    // Otherwise escalate to the next client tier (bot-wall, not-embeddable, …).
  }
  return { ...last, botWallSeen }; // tiers exhausted
}

function download(e, extra = []) {
  return new Promise((resolve) => {
    ensureCacheDir();
    const outTmpl = path.join(cacheDir(), `${e.id}.%(ext)s`);
    const args = [
      e.url, '--no-playlist', '--no-warnings', '--newline',
      '--socket-timeout', '30', '--retries', '3', ...extra,
      // Pull DASH fragments in parallel — a sizeable speed-up on YouTube's
      // fragmented streams with no quality cost (same bytes, more connections).
      '--concurrent-fragments', '5',
      '--ffmpeg-location', ffmpegPath(),
      '-f', FORMAT,
      '--merge-output-format', 'mp4', '--remux-video', 'mp4',
      // Move the MP4 moov atom to the FRONT (faststart). Without this ffmpeg writes
      // the index at the end, so the output <video> must fetch the tail of a multi-GB
      // file before it can render frame 1 — a multi-second black-out on long clips
      // when taken live. Applied to the merge step (bv+ba → mp4).
      '--postprocessor-args', 'ffmpeg:-movflags +faststart',
      '-o', outTmpl,
    ];
    let stderr = '';
    let child;
    try {
      child = spawn(ytDlpPath(), args, { windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, error: err.message });
    }
    e.child = child;

    let buf = '';
    const handleLine = (line) => {
      const m = /\[download\]\s+([\d.]+)%/.exec(line);
      if (m) {
        const pct = parseFloat(m[1]);
        if (Number.isFinite(pct) && e.status !== 'processing') setStatus(e, { status: 'downloading', percent: pct });
      } else if (/^\[(Merger|VideoRemuxer|ExtractAudio)\]/.test(line)) {
        setStatus(e, { status: 'processing' });
      }
    };
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { e.child = null; resolve({ ok: false, error: err.message }); });
    child.on('close', (code) => {
      e.child = null;
      if (code === 0) {
        const finalPath = path.join(cacheDir(), `${e.id}.mp4`);
        if (fs.existsSync(finalPath)) return resolve({ ok: true, path: finalPath });
        // Fallback: locate whatever single output remained for this id.
        try {
          const hit = fs.readdirSync(cacheDir()).find((f) => f.startsWith(`${e.id}.`) && !/\.part$/.test(f) && !/\.f\d+\./.test(f));
          if (hit) return resolve({ ok: true, path: path.join(cacheDir(), hit) });
        } catch {}
        return resolve({ ok: false, error: 'Download finished but no output file was produced' });
      }
      // Cancelled (killed) — caller already cleaned up; don't emit an error.
      if (e.status === 'cancelled') return resolve({ ok: false, cancelled: true });
      const errLine = stderr.split('\n').filter(Boolean).pop() || `yt-dlp exited with code ${code}`;
      resolve({ ok: false, error: errLine.replace(/^ERROR:\s*/, '') });
    });
  });
}

// Start (or reuse) a download for a URL. Idempotent per video id: a second call
// while one is in flight, or after it's ready, returns the existing entry — so the
// speculative paste-time fetch and the Confirm-time fetch never double-download.
export async function prefetch(url) {
  const id = parseVideoId(url);
  if (!id) {
    const e = { id: null, url, status: 'error', percent: 0, title: null, durationMs: null, path: null, error: 'Not a valid YouTube URL' };
    return snapshot(e);
  }

  const existing = entries.get(id);
  if (existing) {
    // Ready file vanished (cache wiped) → fall through and re-download.
    if (existing.status === 'ready' && existing.path && fs.existsSync(existing.path)) return snapshot(existing);
    if (existing.status === 'resolving' || existing.status === 'downloading' || existing.status === 'processing' || existing.status === 'setup') return snapshot(existing);
  }

  const e = { id, url, status: 'resolving', percent: 0, title: null, durationMs: null, path: null, error: null, setupName: null, child: null };
  entries.set(id, e);
  emit(snapshot(e));

  // First YouTube use on this machine: auto-download yt-dlp + ffmpeg into userData
  // (current platform only, ~85 MB, once). Shown as a 'setup' state in the UI.
  if (!isReady()) {
    setStatus(e, { status: 'setup', percent: 0, setupName: null });
    const setup = await ensureBinaries((p) => {
      if (entries.get(id) === e) setStatus(e, { status: 'setup', percent: Math.round((p.percent || 0) * 100), setupName: p.name });
    });
    if (entries.get(id) !== e) return snapshot(entries.get(id));
    if (!setup.ok) {
      setStatus(e, { status: 'error', error: 'Could not download YouTube support (yt-dlp + ffmpeg). Check your connection and retry.' });
      return snapshot(e);
    }
  }

  // Metadata first — also the cheapest probe to find a client tier that gets past
  // YouTube's anti-bot wall. The tier it settles on is reused for the heavy stage.
  const metaRun = await withClientCascade(e, id, (extra) => resolveMetadata(id, url, extra),
    () => setStatus(e, { status: 'resolving' }));
  if (metaRun.superseded) return snapshot(entries.get(id));
  if (!metaRun.ok) { setStatus(e, { status: 'error', error: friendlyError(metaRun) }); return snapshot(e); }
  const startIdx = metaRun.tierIdx;
  setStatus(e, { status: 'downloading', percent: 0, title: metaRun.title, durationMs: metaRun.durationMs });

  const res = await withClientCascade(e, id, (extra) => download(e, extra), null, startIdx);
  if (res.superseded) return snapshot(entries.get(id));
  if (entries.get(id) !== e) return snapshot(entries.get(id));
  if (res.cancelled) return snapshot(e);
  if (!res.ok) { setStatus(e, { status: 'error', error: friendlyError(res) }); return snapshot(e); }
  setStatus(e, { status: 'ready', percent: 100, path: res.path });
  return snapshot(e);
}

// Turn an exhausted-cascade bot-wall into actionable guidance when no browser login is
// configured; otherwise pass the raw yt-dlp error through. Takes the cascade result so
// it can see a bot-wall hit on ANY tier, not just the (possibly different) last error.
function friendlyError(result) {
  const botWall = result?.botWallSeen || looksLikeBotWall(result?.error);
  if (botWall && !cookieBrowser()) {
    return 'YouTube wants a signed-in session for this video. Turn on “Use my browser’s YouTube login” and retry.';
  }
  return result?.error || 'Could not download this video.';
}

export function getStatus(url) {
  const id = parseVideoId(url);
  if (!id) return null;
  return snapshot(entries.get(id));
}

// Ready local path for a URL, or null if not (yet) available.
export function getReadyPath(url) {
  const e = getStatus(url);
  return e && e.status === 'ready' && e.path && fs.existsSync(e.path) ? e.path : null;
}

function killChild(e) {
  if (e && e.child) {
    try { e.child.kill('SIGKILL'); } catch {}
    e.child = null;
  }
}

function removeFilesFor(id) {
  try {
    for (const f of fs.readdirSync(cacheDir())) {
      if (f.startsWith(`${id}.`)) { try { fs.rmSync(path.join(cacheDir(), f), { force: true }); } catch {} }
    }
  } catch {}
}

// Abandon a download (e.g. an edited paste or a removed cue) and delete its bytes.
export function cancel(url) {
  const id = parseVideoId(url);
  if (!id) return;
  const e = entries.get(id);
  if (e) { e.status = 'cancelled'; killChild(e); }
  entries.delete(id);
  removeFilesFor(id);
}

// Wipe everything — kill all children and remove the cache dir. Called on app
// startup (crash recovery) and on quit, satisfying "deleted when the app closes".
export function wipeCache() {
  for (const e of entries.values()) { e.status = 'cancelled'; killChild(e); }
  entries.clear();
  try { fs.rmSync(cacheDir(), { recursive: true, force: true }); } catch {}
}
