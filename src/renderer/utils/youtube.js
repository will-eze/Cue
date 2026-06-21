// Client-side gate for "is this a YouTube link?" — used to enable the modal Confirm
// button, the speculative paste-time fetch, and the clipboard-detection chip. Main
// does the authoritative parse (downloader.parseVideoId); this just avoids firing on
// obviously-non-YouTube input.
export function looksLikeYouTube(s) {
  if (!s) return false;
  const t = s.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return true;
  try {
    const u = new URL(t);
    const h = u.hostname.replace(/^www\./, '');
    if (h === 'youtu.be') return /^[A-Za-z0-9_-]{11}/.test(u.pathname.slice(1));
    if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'music.youtube.com') {
      return !!u.searchParams.get('v') || /^\/(shorts|embed|v|live)\/[A-Za-z0-9_-]{11}/.test(u.pathname);
    }
  } catch {}
  return false;
}
