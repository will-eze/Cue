/**
 * Convert an absolute filesystem path to a cue-media:// URL.
 *
 * Uses "localhost" as the hostname so Chromium's standard-scheme URL parser
 * doesn't promote the first path segment (e.g. "Users") to the host field,
 * which would strip it from the pathname and produce a broken file path.
 */
export function mediaUrl(absPath) {
  if (!absPath) return null;
  // Normalize Windows backslashes → forward slashes, then ensure a leading /
  // so the URL is always cue-media://localhost/... regardless of platform.
  const normalized = absPath.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  const encoded = pathPart.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return 'cue-media://localhost' + encoded;
}

/**
 * Convert an absolute media path to a cue-thumb:// URL — a small, cached,
 * OS-generated JPEG poster of the asset (see the cue-thumb protocol handler in
 * main). Use this for grid/list thumbnails instead of mediaUrl(); the latter
 * serves the full-resolution original, which is what made media grids slow to
 * load. Only use mediaUrl() where the full asset is genuinely needed (live
 * output, full-size previews, playing video).
 */
export function thumbUrl(absPath) {
  if (!absPath) return null;
  const normalized = absPath.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  const encoded = pathPart.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return 'cue-thumb://localhost' + encoded;
}
