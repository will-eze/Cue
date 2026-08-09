## 6. Media Handling — Critical Details

### The `cue-media://` protocol

All media file URLs in the renderer and output windows use a custom `cue-media://` protocol. This is necessary because:
- The renderer is served from `http://localhost` (Vite dev server) — `file://` requests are blocked by CORS
- In production the renderer is a local file but `file://` still has cross-origin issues with userData paths

**Protocol registration** (`main/index.js`):
```js
protocol.registerSchemesAsPrivileged([
  { scheme: 'cue-media', privileges: { secure: true, standard: true,
    supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
]);
// Must be called BEFORE app.whenReady()
```

**Protocol handler** (`main/index.js`, inside `app.whenReady()`):
- Receives `cue-media://localhost/absolute/path/to/file`
- Extracts `pathname` via `new URL(request.url).pathname`
- Decodes it: `decodeURIComponent(pathname)` → absolute filesystem path
- **Path containment:** before any fs access, the decoded path is checked by `isUnderUserData(p)` (`path.resolve(p)` must sit under `app.getPath('userData')`); anything outside (a crafted `cue-media://localhost/etc/passwd` or a `../` traversal) returns `403`. Every file these protocols legitimately serve — media, thumbnails + their source, user fonts, yt-cache, bin — lives under userData, so the guard is non-breaking. Applies to both `cue-media://` and `cue-thumb://`.
- Supports HTTP range requests (for video seeking), serving a `206` with `Content-Range`
- **Bodies are streamed, never buffered.** Both the ranged (`206`) and full responses are `fs.createReadStream(...)` piped through `Readable.toWeb(stream)`. A `<video>` opens playback with an open-ended `bytes=0-`; reading that into a single `Buffer` froze the main process and spiked memory on multi-GB clips (a one-hour YouTube download), and a fixed-size chunk cap starved the player of the multi-MB `moov` index so the clip only looped its first few seconds. A lazy stream serves any range with bounded memory and lets Chromium read/seek/cancel freely — it cancels the open-ended request and re-asks for specific windows, so the whole file is never read.
- Returns `Response` with correct MIME type and `Cache-Control: public, max-age=31536000, immutable` — Chromium serves from disk cache after first load so repeated media displays do not re-read from disk
- Responses also carry `Access-Control-Allow-Origin: *` so the output window's program-audio tap (`captureStream` → Web Audio, §13) can read the cross-origin (`file://` → `cue-media://`) media without tainting; the foreground media element sets `crossOrigin='anonymous'`

### CRITICAL URL GOTCHA

`cue-media:///Users/...` (three slashes, no hostname) **does not work**.

Chromium's standard-scheme URL parser treats `cue-media:///Users/...` as having `users` as the hostname (lowercased first path segment), stripping it from `pathname`. The protocol handler then tries to read `/weze/Library/...` which doesn't exist.

**Always use `cue-media://localhost` as the base.** The `localhost` hostname is discarded; only `pathname` is used.

### `mediaUrl.js`
```js
export function mediaUrl(absPath) {
  if (!absPath) return null;
  // Normalize Windows backslashes → forward slashes; ensure leading /
  const normalized = absPath.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  const encoded = pathPart.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return 'cue-media://localhost' + encoded;
}
```

Use this function everywhere in renderer code. Output templates (`fullscreen.js`, `lowerthird.js`) have an equivalent inline `pathToUrl()` with the same Windows normalization.

### Windows protocol handler
On Windows, `new URL('cue-media://localhost/C:/Users/...').pathname` returns `/C:/Users/...` — the leading `/` before the drive letter must be stripped before calling `fs.statSync`. `main/index.js` handles this:
```js
if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
```

### Content-Security-Policy (packaged only)

`main/index.js` sets a CSP via `session.defaultSession.webRequest.onHeadersReceived`, gated to `app.isPackaged` — dev is skipped so Vite HMR (inline/eval + `ws:`) keeps working. The policy allows the app's real remote dependencies — **Google Fonts** (`fonts.googleapis.com`/`fonts.gstatic.com`, for Material Symbols) and **HuggingFace** (`connect-src`, for the WebGPU ASR model fetch; ORT-web WASM is served locally so only `'wasm-unsafe-eval'` + `blob:` workers are needed) — while blocking inline/remote scripts, `<object>`, and locking `base-uri`/`frame-src`. For `script-src 'self'` to hold, `vite.renderer.config.js` sets `build.modulePreload.polyfill = false` (Electron's Chromium supports modulepreload natively), removing the only inline `<script>` from the built HTML. Adding a renderer feature that fetches a new remote origin requires widening the matching CSP directive.

### Media import flow

1. Operator picks files via `dialog.showOpenDialog` (or file input in MediaPickerModal)
2. `media:import` IPC → `media.importFiles(filePaths)` in `db/media.js`
3. Each file: copy to `userData/media/<uuid>.<ext>`, insert into `media_assets` with absolute `destPath`
4. Returns array of `{ id, filename, path, type }` records
5. `path` is the stored absolute path that `mediaUrl()` encodes

### Rendering media

```jsx
// In renderer:
<img src={mediaUrl(asset.path)} />
<video src={mediaUrl(asset.path)} autoPlay loop muted />

// In output templates (fullscreen.js / lowerthird.js):
function pathToUrl(p) {
  if (!p) return null;
  const normalized = p.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  return 'cue-media://localhost' + pathPart.split('/').map(encodeURIComponent).join('/');
}
```

### Native YouTube player (ephemeral video)

A pasted YouTube URL is resolved by **yt-dlp** into a local video file, which then flows through the *identical* path as any media asset — the single machine-clock transport, `cue-media://`, NDI paint capture, and every operator control — giving a clean, full-screen, frame-synced feed with full controls. An iframe could not (branding/end-screens, independent per-window players drift, no NDI capture path).

**Single-use / ephemeral.** A YouTube cue is a `service_items` row with `item_type='youtube'` and the URL in `content` (`ref_id` is NULL — it is **never** a `media_assets` row). The downloaded file lives in `userData/yt-cache/<videoId>.mp4`, tracked only in-memory by `src/main/youtube/downloader.js`. Nothing survives a session: the cache is wiped on quit and on startup (crash recovery, `youtube.wipeCache()`), the cues are purged on startup (`services.purgeYoutubeItems()`), and per-clip files are removed on cue removal (`youtube.cancel`). Because it is not a `media_assets` row, it is automatically excluded from backups and `media.findUnused()`.

**Binaries — auto-downloaded, not bundled.** `yt-dlp` + `ffmpeg` are *not* shipped in the installer (bundling ~85 MB per platform bloats the download and, worse, `yt-dlp` goes stale — YouTube breaks extractors every few weeks and a baked-in copy can't be updated). `src/main/youtube/bin.js resolveBinary()` resolves each binary in order: (1) a persisted manual override (Settings → Packages "Locate…", `bin_<name>_path` setting) → (2) `userData/bin` (auto-downloaded, kept fresh) → (3) system PATH → (4) well-known install dirs (`commonBinDirs()` — `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`, `~/.local/bin`, …; a GUI-launched app on macOS/Linux inherits a **stripped PATH**, `/usr/bin:/bin:/usr/sbin:/sbin` only, so `which` silently misses a Homebrew/MacPorts/pip tool that resolves fine in a terminal) → (5) a dev-only `resources/bin/<platform>-<arch>` copy that exists only in a checkout, never in a packaged build. If none has it, `ensureBinaries()` downloads the current platform's pair into `userData/bin` on first use (single-flight, ~85 MB once; `fetch` → streamed write → chmod → atomic rename, with 0–1 progress). `refreshYtDlp()` re-downloads the latest `yt-dlp` (throttled 10 min) when a download fails with an extractor-style error (`looksLikeExtractorFailure`), then retries once. Sources: `yt-dlp` from its GitHub `latest` release (`yt-dlp_macos` universal / `yt-dlp.exe`); `ffmpeg` pinned to the `eugeneware/ffmpeg-static` b6.0 release per arch.

**Settings → Packages manager** (`src/main/packages/registry.js`, `PackagesSettings.jsx` + `PackageManagerModal.jsx`) is a uniform install/remove/locate UI over every optional dependency: `yt-dlp`, `ffmpeg` (both via `bin.installBinary`/`removeBinary`/`binInfo`, one-at-a-time unlike the YouTube flow's paired `ensureBinaries`), LibreOffice (external — detect/locate only, no install), and the two ASR models (`whisper-cpu` via `scripture-detect/whisper-bin.js`, `embed` via `embed-bin.js`). `registry.list()` derives live status from disk on every call (a manual install/removal outside Cue is picked up); each descriptor's `managed`/`removable` flags mean Cue only ever deletes a copy it downloaded itself, never a system/PATH binary. GPU ASR models are NOT in this registry — they live in Chromium's Cache API and are downloaded/removed client-side by the renderer; the modal adds that card separately.

**Download command** (`downloader.js`): format `bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/...` (prefer h264 ≤1080p for hardware decode, avoid 4K-AV1 software-decode stutter in the offscreen NDI window), `--merge-output-format mp4 --remux-video mp4`, `--concurrent-fragments 5` (parallel DASH fragments — faster, no quality loss; also the throttle-defeating access pattern), and `--postprocessor-args "ffmpeg:-movflags +faststart"` (moov atom at front; without it a long clip black-screens on go-live while the player fetches the tail index).

**Anti-bot client cascade.** YouTube increasingly walls downloads with "Sign in to confirm you're not a bot" / "Please sign in". Every yt-dlp invocation (`resolveMetadata`, `download`) runs through `withClientCascade()`, which tries ordered client *tiers* and escalates on failure: (1) **default** (no extra args); (2) **`web_embedded`** (`--extractor-args youtube:player_client=web_embedded` — the embeddable IFrame player, no login/PO-token, but embeddable videos only); (3) **`cookies`** (`--cookies-from-browser <browser>`) — present *only* when the operator has opted in via the `youtube_cookies_browser` setting. Escalation rule (`looksLikeBotWall` / `isFatalError`): a **fatal** error (removed/deleted/region-locked) surfaces immediately; a **stale-binary OR bot-wall** error refreshes yt-dlp once and retries the same tier (a bot-wall is most often just an out-of-date yt-dlp, since `refreshYtDlp` drops the latest build into `userData/bin` which `resolveBinary` prefers over a stale PATH copy); anything else escalates to the next tier. Metadata settles on a working tier and the download stage resumes from it (`tierIdx`). On exhaustion, `friendlyError()` turns a bot-wall (`botWallSeen` across all tiers) into "turn on browser login" guidance when no browser is configured. Cookies are read by yt-dlp directly from the browser store and never persisted/logged by Cue.

**Pre-fetch / status flow.** Latency is hidden by pre-fetching: the download starts the moment a valid URL is pasted (speculatively, before Confirm — `AddYouTubeModal.jsx`). If the URL is edited before Confirm, the speculative download is abandoned and the submitted URL fetched. Status is `setup (first-use binary download / yt-dlp refresh) → resolving → downloading (percent) → processing → ready | error`, pushed live to all windows over the `youtube:status` event and surfaced as a rundown badge (`RundownPanel`) and in the modal (with a Retry on error). `services.resolveItems` attaches the current status as `item.youtube`; `OperatorView` patches it live from the event and re-prefetches any `idle` cue on load. GO is soft-blocked until `ready` (`buildPayload` returns null otherwise), then resolves the ready path into a normal full-screen media payload (`{ media: { path, type:'video', loop } }`).

**Clipboard detection.** On entering the Media tab, `LibraryPanel` reads the OS clipboard once via `window.cue.youtube.readClipboard()` (Electron main-process `clipboard.readText()` over the `clipboard:readText` IPC — silent, no permission prompt, never polled). If it holds a YouTube link (`utils/youtube.js → looksLikeYouTube`), a one-click chip offers to add it; clicking opens `AddYouTubeModal` with `initialUrl` pre-filled and already resolving. The link is offered once per distinct clipboard value (a `clipboardSeenRef` marks add/dismiss) so re-entering the tab does not re-nag. Editing/pasting a different URL in the modal cancels the in-flight resolve and switches to the new one (`startSpeculative`).

### Thumbnails — the `cue-thumb://` protocol

Media grids/lists never load the full-resolution original (an 8 MB photo decoded into a 100px tile is what made the Media tab slow). They use a second privileged protocol, registered alongside `cue-media` before `app.whenReady()`:

```js
{ scheme: 'cue-thumb', privileges: { secure: true, standard: true,
  supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }
```

The handler (`main/index.js`):
- Resolves the absolute source path (same Windows drive-letter stripping as `cue-media`).
- Cache path = `userData/thumbnails/<sha1(srcPath)>.jpg` (`media.thumbCachePath`). Serves the cached JPEG if present.
- Otherwise generates one with `nativeImage.createThumbnailFromPath(src, { width: 480, height: 480 })` — the OS thumbnail service (QuickLook on macOS, the shell thumbnail handler on Windows), so it posters **videos as well as images**, is async, and needs no extra dependency — then `.toJPEG(72)`, writes the cache fire-and-forget, and serves it.
- **ffmpeg fallback poster (video only):** when the OS service comes up empty for a video extension (`THUMB_VIDEO_EXTS`), `ffmpegVideoThumb(srcPath)` grabs a single frame via the bundled/downloaded ffmpeg (seek 1s to skip a common black fade-in, retry at 0s once if the clip is shorter; `scale=480:480:force_original_aspect_ratio=decrease`, 8s kill timeout) and caches it identically. This covers codecs/containers QuickLook can't poster, and — critically — the **sandboxed packaged app**, where OS thumbnailing is restricted and silently returns nothing. If ffmpeg isn't provisioned yet, `ensureFfmpegForThumbs()` kicks off a single-flight background download (the same `youtube/bin.js installBinary('ffmpeg')` the Packages manager uses) and the request 404s for now — `MediaThumb`'s retry (below) picks up the poster once it lands.
- Fallback: if generation (OS + ffmpeg) fails and the source is an image extension, serve the original bytes (so the tile still renders); for a non-image return 404 so the renderer shows its placeholder instead of feeding video bytes to an `<img>`.

The thumbnail cache is **pure derived data**: keyed by source path, regenerated on demand. It is therefore *not* a media reference (excluded from `media.findUnused`), *not* in backups, and is cleared alongside the assets it mirrors — `media.del()` removes the asset's thumb, `media.deleteAllMedia()` empties `userData/thumbnails`.

**Renderer usage:** `thumbUrl(absPath)` in `mediaUrl.js` builds the URL; the `<MediaThumb path={…} />` component (`components/MediaThumb.jsx`) renders it as an `<img>` with an error-fallback icon and is used by every grid/list tile (LibraryPanel media grid, MediaPickerModal, MediaCleanup, RundownPanel item thumb). A first 404 can be transient (poster still generating, or ffmpeg mid-download) — `MediaThumb` retries up to `MAX_RETRIES` (3) with a backoff (`1500ms × attempt`, cache-busting `?retry=N`) before falling back to the placeholder icon. Keep `mediaUrl()` for live output, full-size previews, and playing video.

---
