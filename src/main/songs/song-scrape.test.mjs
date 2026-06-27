// Unit tests for the lyric scraper's offline pieces (HTML extraction, cleaning,
// section parsing of a re-parsed edit). No network.
//   node --experimental-detect-module src/main/songs/song-scrape.test.mjs
import { extractGeniusLyrics, extractGeneric, cleanLyrics, fetchLyrics } from './song-scrape.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`); } };

// ── Genius lyric-container extraction ─────────────────────────────────────────
{
  const html = `
    <html><body>
    <div data-lyrics-container="true">[Verse 1]<br>Amazing grace how sweet the sound<br>That saved a wretch like me<br><br>[Chorus]<br>How great is our God</div>
    <div class="Lyrics__Footer">stuff</div>
    </body></html>`;
  const text = extractGeniusLyrics(html);
  ok('genius keeps [Verse 1] header', /\[Verse 1\]/.test(text));
  ok('genius keeps lyric line', /Amazing grace how sweet the sound/.test(text));
  ok('genius <br> became newlines', /sound\nThat saved/.test(text));
}

// ── cleaning removes site chrome ──────────────────────────────────────────────
{
  const dirty = '7 ContributorsTranslationsEspañolOceans LyricsYou will call me out upon the waters\n\n12Embed';
  const clean = cleanLyrics(dirty);
  ok('strips contributor header', !/Contributors/.test(clean));
  ok('strips Embed footer', !/Embed/.test(clean));
  ok('keeps the actual lyric', /call me out upon the waters/.test(clean));
}

// ── generic extractor finds a hinted lyric container ──────────────────────────
{
  const html = `<html><body><div class="song-lyrics"><p>Be thou my vision</p><p>O Lord of my heart</p></div></body></html>`;
  const text = extractGeneric(html);
  ok('generic finds hinted lyrics', /Be thou my vision/.test(text) && /O Lord of my heart/.test(text));
}

// ── text re-parse path (the Save flow) → Cue sections ─────────────────────────
{
  const res = await fetchLyrics({
    provider: 'text',
    title: 'Test Song',
    artist: 'Tester',
    text: '[Verse 1]\nLine one\nLine two\n\n[Chorus]\nWe sing\nYou reign',
  });
  ok('returns title/author', res.title === 'Test Song' && res.author === 'Tester');
  ok('parsed into 2+ sections', res.sections.length >= 2);
  ok('chorus section typed', res.sections.some((s) => s.type === 'chorus'));
  ok('verse content preserved', res.sections.some((s) => /Line one/.test(s.content)));
}

console.log(`\nsong-scrape: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
