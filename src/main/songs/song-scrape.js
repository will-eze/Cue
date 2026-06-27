// Online Song Finder — search the web for a song by title/artist, fetch its
// lyrics, clean them, and hand back Cue sections for an editable preview before
// the operator saves. ALL network here runs in the main process (Node `fetch`),
// so the renderer never touches a remote origin — no CSP/CORS to widen, and the
// scraped HTML is parsed where the heavier string work belongs.
//
// Providers:
//   • genius   — public search JSON (no key) + lyric-container page scrape. The
//                workhorse: large catalogue incl. contemporary worship/CCM, and
//                its pages carry [Verse]/[Chorus] headers that map to sections.
//   • azlyrics — deterministic URL from artist+title; plain unlabelled lyric div.
//   • url      — fetch ANY pasted lyrics page (hymnary, hymnal.net, lyrics.com,
//                worship sites, …) and clean it with the matching/generic
//                extractor. This is how "general web search / hymn sites" is
//                covered without fragile search-engine scraping.
//
// Parsing into verses/chorus reuses parseLyricsToSections() so a scraped song
// splits exactly like file import and Paste Song.

import { parseLyricsToSections } from '../import/songs-import.js';

// A realistic desktop UA — Genius/AZLyrics serve plain HTML/JSON to a browser-ish
// client but can short-circuit an obvious bot.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function httpGet(url, { json = false, timeout = 20000 } = {}) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': json ? 'application/json,*/*' : 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return json ? res.json() : res.text();
  });
}

// ── HTML / text helpers ───────────────────────────────────────────────────────

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/gi, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/gi, '&'); // ampersand last so it doesn't double-decode
}

// Turn an HTML fragment into newline-delimited plain text: <br> and block-closers
// become newlines, every other tag is dropped, entities decoded.
function htmlFragmentToText(html) {
  // Consume whitespace right after a <br>/block close: HTML treats a source newline
  // as insignificant whitespace, so "line<br>\nline" must yield ONE break, not two
  // (otherwise every lyric line comes out double-spaced). <pre> lyrics carry no <br>,
  // so their significant newlines are left untouched.
  const withBreaks = String(html || '')
    .replace(/<\s*br\s*\/?\s*>\s*/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|blockquote)\s*>\s*/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(withBreaks);
}

// Strip site chrome and tidy whitespace so parseLyricsToSections sees clean lyric
// text. Removes Genius' contributor/translation header, "You might also like" and
// "…Embed" footer cruft, zero-width chars, and collapses blank-line runs.
export function cleanLyrics(text) {
  let t = String(text || '').replace(/​| /g, ' ');
  t = t.replace(/^[\s\S]*?\d+\s+Contributors?[\s\S]*?Lyrics/i, ''); // Genius header block
  t = t.replace(/You might also like/gi, '\n');
  t = t.replace(/\d*Embed\s*$/i, '');
  t = t.replace(/See .*?LiveGet tickets.*$/gim, '');
  return t
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Read an <meta property="…" content="…"> value, tolerant of attribute order —
// Genius (and others) emit `content="…" property="og:title"` with content FIRST,
// which an order-fixed regex misses (the title then falls back to "Untitled").
function metaProp(html, prop) {
  const p = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i').exec(html)
    || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${p}["']`, 'i').exec(html);
  return m ? decodeEntities(m[1]).trim() : '';
}

// ── Genius ────────────────────────────────────────────────────────────────────

async function geniusSearch(query) {
  // The song-specific endpoint ranks by title relevance (the `multi` endpoint
  // leads with a trending "top hit" that is often unrelated to the query).
  const url = `https://genius.com/api/search/song?q=${encodeURIComponent(query)}`;
  let data;
  try { data = await httpGet(url, { json: true }); } catch { return []; }
  const out = [];
  const seen = new Set();
  const hits = [
    ...(data?.response?.sections || []).flatMap((s) => s.hits || []),
    ...(data?.response?.hits || []),
  ];
  for (const hit of hits) {
    const r = hit.result;
    if (!r || (hit.type && hit.type !== 'song') || !r.url) continue;
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push({
      provider: 'genius',
      id: r.url,
      url: r.url,
      title: r.title || r.full_title || '',
      artist: r.primary_artist?.name || '',
      thumb: r.song_art_image_thumbnail_url || r.header_image_thumbnail_url || null,
    });
  }
  return out;
}

// Remove every element flagged `data-exclude-from-selection="true"` — Genius'
// own marker for the non-lyric chrome nested INSIDE the lyrics container
// (contributor header, the "Read More" song description, inline ad slots).
function stripExcluded(html) {
  const re = /<(div|span|p|section|aside)\b[^>]*data-exclude-from-selection="true"[^>]*>/i;
  let out = html, guard = 0, m;
  while ((m = re.exec(out)) && guard++ < 200) {
    const end = balancedElementEnd(out, m.index, m[1]);
    out = end < 0
      ? out.slice(0, m.index) + out.slice(m.index + m[0].length) // unbalanced: drop just the tag
      : out.slice(0, m.index) + out.slice(end);
  }
  return out;
}

// Pull lyric text from a Genius song page. Modern pages split the lyrics across
// one-or-more <div data-lyrics-container="true">…</div> blocks; each is grabbed
// depth-aware (they nest annotation <a>/<span> + a header block) and the flagged
// non-lyric chrome is stripped before the text is reduced.
export function extractGeniusLyrics(html) {
  const containers = [];
  for (const o of String(html || '').matchAll(/<div[^>]*data-lyrics-container[^>]*>/gi)) {
    const inner = balancedInner(html, o.index, 'div');
    if (inner) containers.push(inner);
  }
  if (!containers.length) {
    const legacy = /<div class="lyrics">([\s\S]*?)<\/div>/i.exec(html);
    if (legacy) containers.push(legacy[1]);
  }
  return cleanLyrics(htmlFragmentToText(stripExcluded(containers.join('\n'))));
}

// ── AZLyrics ──────────────────────────────────────────────────────────────────

// AZLyrics slugs: lowercase, strip everything but [a-z0-9], drop a leading "the"
// from the artist. e.g. ("Hillsong United","Oceans") → /lyrics/hillsongunited/oceans.html
function azSlug(s, isArtist = false) {
  let v = String(s || '').toLowerCase();
  if (isArtist) v = v.replace(/^the\s+/, '');
  return v.replace(/[^a-z0-9]/g, '');
}

async function extractAzLyrics(artist, title) {
  const a = azSlug(artist, true);
  const t = azSlug(title);
  if (!a || !t) throw new Error('AZLyrics needs both an artist and a title.');
  const html = await httpGet(`https://www.azlyrics.com/lyrics/${a}/${t}.html`);
  // The lyric body is an unlabelled <div> right after a warning comment.
  const m = /<!--\s*Usage of azlyrics\.com[\s\S]*?-->([\s\S]*?)<\/div>/i.exec(html);
  if (!m) throw new Error('Could not locate the lyrics on the page.');
  return cleanLyrics(htmlFragmentToText(m[1]));
}

// ── Generic page extractor (any pasted lyrics URL) ────────────────────────────

// Return the inner HTML of the element whose open tag starts at `openIdx`,
// scanning depth-aware for the matching close tag (so nested <p>/<div> don't end
// the slice early). Null if no matching close is found.
function balancedInner(html, openIdx, tag) {
  const gt = html.indexOf('>', openIdx);
  if (gt < 0) return null;
  const open = new RegExp(`<${tag}\\b`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  const innerStart = gt + 1;
  let depth = 1, i = innerStart;
  while (i < html.length) {
    open.lastIndex = i; close.lastIndex = i;
    const o = open.exec(html);
    const c = close.exec(html);
    if (!c) return null;
    if (o && o.index < c.index) { depth++; i = o.index + 1; }
    else { depth--; if (depth === 0) return html.slice(innerStart, c.index); i = c.index + 1; }
  }
  return null;
}

// Index just past the matching </tag> for the element opening at `openIdx`, or -1.
function balancedElementEnd(html, openIdx, tag) {
  const gt = html.indexOf('>', openIdx);
  if (gt < 0) return -1;
  const open = new RegExp(`<${tag}\\b`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1, i = gt + 1;
  while (i < html.length) {
    open.lastIndex = i; close.lastIndex = i;
    const o = open.exec(html);
    const c = close.exec(html);
    if (!c) return -1;
    if (o && o.index < c.index) { depth++; i = o.index + 1; }
    else { depth--; if (depth === 0) return c.index + c[0].length; i = c.index + 1; }
  }
  return -1;
}

// Whole-subtree site chrome — never lyrics. Removed before extraction so their
// text (nav links, search box, "Skip to main content", footers) can't leak into
// the lyric body on a site we don't have a tuned extractor for. `head` is stripped
// too (its <title>/<meta> are read from the original HTML, not this working copy).
const CHROME_TAGS = ['head', 'nav', 'header', 'footer', 'aside', 'form', 'noscript',
  'svg', 'iframe', 'button', 'select', 'textarea', 'figure', 'dialog'];

// Class/id tokens that mark a CONTAINER as chrome (menus, related-song lists,
// share/comment widgets, field labels…). Deliberately HIGH-PRECISION: only tokens
// that almost never appear on a content/lyric wrapper. Ambiguous LAYOUT words —
// `sidebar`, `header`, `footer`, `search`, `banner` — are intentionally NOT here:
// they double as state classes ("content sidebar", "content-header"), so removing
// them by class can take the lyrics with them. Real sidebars/headers/footers are
// dropped by their SEMANTIC tags (CHROME_TAGS) and by the link-density penalty in
// scoreLyricBlock instead.
// Token-aware — `\b` honours the `-`/space separators in multi-token class lists,
// so a real lyric class like "field-name-body" is never matched. `field-label` uses
// strict boundaries (2nd alternative) so it hits only a bare "field-label" token and
// NOT Drupal's "field-label-above" modifier (which sits on the lyric body field).
const CHROME_CLASS_RE = /\b(?:nav(?:bar|igation)?|menu|breadcrumbs?|pager|pagination|masthead|cookie|consent|social|share|sharing|related|recommend(?:ed|ations?)?|comments?|disqus|advert(?:isement)?|ads?|widget|toolbar|site-(?:name|slogan|branding|logo)|skip-?link|region-(?:header|footer|sidebar))\b|(?<![\w-])field-label(?![\w-])/i;

// Containers whose class/id positively marks them as the lyric/article body. Strong
// hints (lyric-specific) outweigh content hints (a generic page/article wrapper that
// often also holds copyright/scripture/CCLI siblings we'd rather not swallow).
const STRONG_HINT_RE = /(?:class|id)\s*=\s*["'][^"']*\b(?:lyrics?|verse|song-?text|song-?lyrics|chant|hymn|field-name-body)\b[^"']*["']/i;
const CONTENT_HINT_RE = /(?:class|id)\s*=\s*["'][^"']*\b(?:entry-content|post-content|node-content|article-content|main-content)\b[^"']*["']/i;

// A line that looks like a section header (Verse / Chorus / [Bridge] …) — mirrors
// the keywords parseLyricsToSections splits on, so rewarding them favours the block
// that actually carries singable, slide-splittable lyrics.
const SECTION_HINT_RE = /^\s*[\[(]?\s*(?:verse|chorus|bridge|pre[-\s]?chorus|prechorus|refrain|tag|intro|outro|interlude|ending|coda|vamp|hook)\b/i;

// Forward-scan removal of every element whose tag is in `tags` (and its subtree),
// depth-aware and nesting-safe. One linear pass; indices never shift mid-scan.
function removeElements(html, tags) {
  const re = new RegExp(`<(${tags.join('|')})\\b`, 'gi');
  let out = '', last = 0, skipUntil = -1, m;
  while ((m = re.exec(html))) {
    if (m.index < skipUntil) continue; // already inside a dropped subtree
    const end = balancedElementEnd(html, m.index, m[1]);
    const gt = html.indexOf('>', m.index);
    const dropTo = end > 0 ? end : (gt > 0 ? gt + 1 : m.index + m[0].length);
    out += html.slice(last, m.index);
    last = dropTo; skipUntil = dropTo; re.lastIndex = dropTo;
  }
  return out + html.slice(last);
}

// Forward-scan removal of containers whose class/id matches CHROME_CLASS_RE.
function removeChromeContainers(html) {
  const re = /<(div|section|aside|ul|ol|span|table|tr)\b([^>]*)>/gi;
  let out = '', last = 0, skipUntil = -1, m;
  while ((m = re.exec(html))) {
    if (m.index < skipUntil) continue;
    const cls = (/(?:class|id)\s*=\s*["']([^"']*)["']/i.exec(m[2] || '') || [])[1];
    if (!cls || !CHROME_CLASS_RE.test(cls)) continue;
    const end = balancedElementEnd(html, m.index, m[1]);
    if (end <= 0) continue;
    out += html.slice(last, m.index);
    last = end; skipUntil = end; re.lastIndex = end;
  }
  return out + html.slice(last);
}

function stripChrome(html) {
  let h = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  h = removeElements(h, CHROME_TAGS);
  h = removeChromeContainers(h);
  return h;
}

// Score a candidate container by how lyric-like its text is. Rewards short song
// lines and section headers; penalises link-density (nav/related lists) and long
// prose lines (song descriptions, comments). -Infinity = too small to be lyrics.
function scoreLyricBlock(innerHtml) {
  const text = cleanLyrics(htmlFragmentToText(innerHtml));
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return { score: -Infinity, text, len: text.length };
  const linkCount = (innerHtml.match(/<a\b/gi) || []).length;
  let lyric = 0, headers = 0, prose = 0;
  for (const l of lines) {
    if (SECTION_HINT_RE.test(l) && l.length <= 24) { headers++; continue; }
    const words = l.split(/\s+/).length;
    if (l.length > 140 || words > 22) prose++;
    else lyric++;
  }
  const score = lyric + headers * 5 - linkCount * 3 - prose * 4;
  return { score, text, len: text.length };
}

// Extract lyrics from an arbitrary lyrics page. Strips site chrome, then scores
// every block container and keeps the best — biased toward an explicitly hinted
// lyric/body container, and (on near-ties) toward the TIGHTEST block so it doesn't
// swallow copyright/scripture/CCLI siblings. Falls back to the whole cleaned body.
export function extractGeneric(html) {
  const cleaned = stripChrome(html);
  const re = /<(div|section|article|main|pre|td|blockquote)\b([^>]*)>/gi;
  let best = null, m;
  while ((m = re.exec(cleaned))) {
    const inner = balancedInner(cleaned, m.index, m[1]);
    if (!inner) continue;
    const s = scoreLyricBlock(inner);
    if (s.score === -Infinity) continue;
    const attrs = `<x ${m[2] || ''}>`;
    const bonus = STRONG_HINT_RE.test(attrs) ? 60 : CONTENT_HINT_RE.test(attrs) ? 20 : 0;
    const c = { ...s, score: s.score + bonus };
    // Higher score wins; near-ties (within 2) break toward the shorter block.
    if (!best || c.score > best.score || (c.score >= best.score - 2 && c.len < best.len)) best = c;
  }
  if (best && best.score > 0) return best.text;
  const body = (/<body[^>]*>([\s\S]*?)<\/body>/i.exec(cleaned)?.[1]) || cleaned;
  return cleanLyrics(htmlFragmentToText(body));
}

// ── Public API ────────────────────────────────────────────────────────────────

// Search the web for a song. `query` is "title" or "title artist". Returns a
// best-first candidate list; never throws (a dead provider just contributes none).
export async function searchSongs(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const results = await geniusSearch(q);
  return results.slice(0, 12);
}

// Fetch + clean + parse one candidate (or a pasted URL) into an editable preview.
// Shapes: {provider:'genius', url} | {provider:'azlyrics', artist, title} |
//          {provider:'url', url} | {provider:'genius'|'url', url, artist, title}.
export async function fetchLyrics(candidate = {}) {
  const { provider } = candidate;
  let lyrics = '';
  let title = candidate.title || '';
  let author = candidate.artist || '';
  let source = candidate.url || '';

  if (provider === 'text') {
    // Network-free re-parse: the operator edited the lyrics in the preview, so
    // re-clean + re-split the supplied text (same pipeline) on Save.
    lyrics = cleanLyrics(candidate.text || '');
  } else if (provider === 'azlyrics') {
    lyrics = await extractAzLyrics(candidate.artist, candidate.title);
    source = `https://www.azlyrics.com/lyrics/${azSlug(candidate.artist, true)}/${azSlug(candidate.title)}.html`;
  } else {
    const url = candidate.url;
    if (!url || !/^https?:\/\//i.test(url)) throw new Error('A valid http(s) URL is required.');
    const html = await httpGet(url);
    if (/genius\.com/i.test(url)) {
      lyrics = extractGeniusLyrics(html);
      if (!title) {
        // Genius og:title is reliably "Artist – Title" (en-dash) — split so a pasted
        // URL fills the author too, matching what the search path already provides.
        const og = metaProp(html, 'og:title').replace(/\s+Lyrics\s*$/i, '').trim();
        const parts = og.split(/\s+–\s+/);
        if (parts.length >= 2) { author = author || parts[0].trim(); title = parts.slice(1).join(' – ').trim(); }
        else title = og;
      }
    } else if (/azlyrics\.com/i.test(url)) {
      const m = /<!--\s*Usage of azlyrics\.com[\s\S]*?-->([\s\S]*?)<\/div>/i.exec(html);
      lyrics = m ? cleanLyrics(htmlFragmentToText(m[1])) : extractGeneric(html);
    } else {
      lyrics = extractGeneric(html);
      if (!title) {
        const og = metaProp(html, 'og:title');
        let t = og || decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
        // Sites stuff junk into og:title/<title> ("SONG Lyrics - ARTIST | Site.net").
        // Two low-risk cuts: drop a "| Site" segment, and everything from a "Lyrics"
        // marker onward. Only the <title> fallback also cuts a trailing "- Site".
        t = t.replace(/\s*[|·•].*$/, '').replace(/\s+lyrics\b[\s\S]*$/i, '');
        if (!og) t = t.replace(/\s*[-–].*$/, '');
        title = t.trim();
      }
    }
  }

  if (!lyrics || lyrics.replace(/\s/g, '').length < 12) {
    throw new Error('No lyrics could be extracted from that page.');
  }

  // "Title Lyrics" / a trailing artist suffix sneaks in from <title> tags — tidy.
  // Also drop a trailing breadcrumb separator ("Amazing Grace >", "Song |").
  title = String(title || '').replace(/\s+Lyrics\s*$/i, '').replace(/\s*[>|•·]+\s*$/, '').trim();
  // Many pages print the song title as the first line of the lyric body; once it's
  // become our title, drop that leading duplicate so it doesn't make a junk slide.
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (title) {
    const lines = lyrics.split('\n');
    let i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    if (i < lines.length && norm(lines[i]) === norm(title)) {
      lines.splice(0, i + 1);
      lyrics = lines.join('\n').replace(/^\n+/, '');
    }
  }

  const sections = parseLyricsToSections(lyrics);
  if (!sections.length) throw new Error('Lyrics were found but could not be split into sections.');
  title = title || 'Untitled';
  return { title, author: author || null, sections, source, raw: lyrics };
}
