/**
 * Convert an absolute filesystem path to a cue-media:// URL.
 *
 * Uses "localhost" as the hostname so Chromium's standard-scheme URL parser
 * doesn't promote the first path segment (e.g. "Users") to the host field,
 * which would strip it from the pathname and produce a broken file path.
 */
export function mediaUrl(absPath) {
  if (!absPath) return null;
  const encoded = absPath.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return 'cue-media://localhost' + encoded;
}
