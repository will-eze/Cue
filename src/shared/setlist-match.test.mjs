// Unit tests for set-list segmentation + matching against an in-memory library.
//   node --experimental-detect-module src/shared/setlist-match.test.mjs
import { matchSetList, cleanTitleLine, isSegmentHeader, segmentSetList, words } from './setlist-match.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra) => { if (cond) pass++; else { fail++; console.error(`✗ ${label}`, extra !== undefined ? JSON.stringify(extra, null, 0).slice(0, 600) : ''); } };

// ── Fake library: public-domain hymns + invented songs ──────────────────────
const SONGS = [
  ['Amazing Grace', 'John Newton', ['Amazing grace how sweet the sound\nThat saved a wretch like me\nI once was lost but now am found\nWas blind but now I see', 'Twas grace that taught my heart to fear\nAnd grace my fears relieved']],
  ['Great Is Thy Faithfulness', 'Thomas Chisholm', ['Great is Thy faithfulness O God my Father\nThere is no shadow of turning with Thee', 'Summer and winter and springtime and harvest\nSun moon and stars in their courses above', 'Great is Thy faithfulness great is Thy faithfulness\nMorning by morning new mercies I see']],
  ['GHS 12 - Blessed Assurance', null, ['Blessed assurance Jesus is mine\nOh what a foretaste of glory divine', 'This is my story this is my song\nPraising my Saviour all the day long']],
  ['GHS 47 - It Is Well', null, ['When peace like a river attendeth my way\nWhen sorrows like sea billows roll', 'It is well with my soul\nIt is well it is well with my soul']],
  ['Holy, Holy, Holy', 'Reginald Heber', ['Holy holy holy Lord God Almighty\nEarly in the morning our song shall rise to Thee']],
  ['Be Thou My Vision', null, ['Be Thou my vision O Lord of my heart\nNaught be all else to me save that Thou art']],
  ['Rock of Ages', 'Augustus Toplady', ['Rock of ages cleft for me\nLet me hide myself in Thee']],
  ['What a Friend We Have in Jesus', 'Joseph Scriven', ['What a friend we have in Jesus\nAll our sins and griefs to bear']],
  ['To God Be the Glory', 'Fanny Crosby', ['To God be the glory great things He hath done\nSo loved He the world that He gave us His Son', 'Praise the Lord praise the Lord\nLet the earth hear His voice']],
  ['Crown Him with Many Crowns', null, ['Crown Him with many crowns\nThe Lamb upon His throne']],
  ['Abide with Me', 'Henry Lyte', ['Abide with me fast falls the eventide\nThe darkness deepens Lord with me abide']],
  ['Jesus Paid It All', null, ['I hear the Saviour say\nThy strength indeed is small', 'Jesus paid it all\nAll to Him I owe\nSin had left a crimson stain\nHe washed it white as snow']],
  ['I Surrender All', null, ['All to Jesus I surrender\nAll to Him I freely give', 'I surrender all I surrender all\nAll to Thee my blessed Saviour']],
  ['Standing on the Promises', null, ['Standing on the promises of Christ my King\nThrough eternal ages let His praises ring']],
  ['There Is Power in the Blood', null, ['Would you be free from the burden of sin\nThere is power in the blood', 'There is power power wonder working power\nIn the blood of the Lamb']],
  ['When I Survey the Wondrous Cross', 'Isaac Watts', ['When I survey the wondrous cross\nOn which the Prince of glory died']],
  ['Come Thou Fount', 'Robert Robinson', ['Come Thou fount of every blessing\nTune my heart to sing Thy grace']],
  ['Imela (Thank You)', 'Invented', ['Imela imela Onye nwe anyi\nWe lift our hands in thanks today', 'You carried us through the night\nImela imela']],
  ['River of Mercy', 'Invented', ['There is a river flowing from Your throne\nCarry me deeper into Your love', 'River of mercy wash over me\nRiver of mercy set my spirit free']],
  ['Faithful One Forever', 'Invented', ['Morning comes and You are with me\nEvening falls and You remain', 'Faithful one forever You will never fail\nFaithful one forever You prevail']],
  ['Lamp Unto My Feet', 'Invented', ['Your word is a lamp unto my feet\nA light unto my path today']],
  ['Open the Floodgates', 'Invented', ['Open the floodgates of heaven\nLet the rain come down on us']],
  ['Ancient Gates', 'Invented', ['Lift up your heads O ancient gates\nThe King of glory enters in']],
  ['Holy Fire', 'Invented', ['Send Your holy fire burn within us\nSet our hearts ablaze']],
];
const lib = (() => {
  const songs = SONGS.map(([title, author, secs], i) => ({ id: i + 1, title, author, sections: secs }));
  const textOf = (id) => songs.find((s) => s.id === id).sections.join('\n');
  return {
    songs: songs.map((s) => ({ id: s.id, title: s.title, author: s.author, firstLines: s.sections.map((c) => c.split('\n')[0]) })),
    textOf,
    // Emulates FTS5 "a* OR b*" over title+content, per section, bm25-ish (lower = better).
    fts(expr) {
      const toks = expr.split(' OR ').map((t) => t.replace(/\*$/, ''));
      const rows = [];
      for (const s of songs) {
        for (const c of s.sections) {
          const ws = words(`${s.title} ${c}`);
          const tw = words(s.title);
          let score = 0;
          for (const t of toks) { if (ws.some((w) => w.startsWith(t))) score += 1; if (tw.some((w) => w.startsWith(t))) score += 2; }
          if (score) rows.push({ id: s.id, title: s.title, author: s.author, bm: -score });
        }
      }
      return rows.sort((a, b) => a.bm - b.bm).slice(0, 60);
    },
  };
})();
const titles = (rows) => rows.map((r) => (r.match ? r.match.title : `∅(${r.input})`));
const run = (txt) => matchSetList(txt, lib);

// ── cleanTitleLine ───────────────────────────────────────────────────────────
{
  const v = (l) => cleanTitleLine(l).variants;
  ok('clean: number + leader', v('1. Amazing Grace - Mary').includes('Amazing Grace'), v('1. Amazing Grace - Mary'));
  ok('clean: key', v('Amazing Grace (Key: G)')[0] === 'Amazing Grace', v('Amazing Grace (Key: G)'));
  ok('clean: key of Bb', v('Amazing Grace key of Bb')[0] === 'Amazing Grace', v('Amazing Grace key of Bb'));
  ok('clean: led by', v('Rock of Ages — led by Esther')[0] === 'Rock of Ages', v('Rock of Ages — led by Esther'));
  ok('clean: x2 + emoji', v('🎶 Holy Fire x2 🙏')[0] === 'Holy Fire', v('🎶 Holy Fire x2 🙏'));
  ok('clean: whatsapp bold', v('*Holy Fire*')[0] === 'Holy Fire', v('*Holy Fire*'));
  ok('clean: leader first', v('Mary - Rock of Ages').includes('Rock of Ages'), v('Mary - Rock of Ages'));
  ok('clean: by artist', v('Abide with Me by Henry Lyte').includes('Abide with Me'), v('Abide with Me by Henry Lyte'));
  ok('clean: segment prefix', v('Opening hymn: Holy, Holy, Holy')[0] === 'Holy, Holy, Holy', v('Opening hymn: Holy, Holy, Holy'));
  ok('clean: medley parts', cleanTitleLine('Holy Fire / River of Mercy').parts.length === 2);
}

// ── Segment headers ──────────────────────────────────────────────────────────
for (const h of ['Worship', 'PRAISE:', 'Praise Session', 'Offertory', 'Sunday 26th October', 'Slow songs', 'Praise & Worship', 'Choir ministration', '— Worship —', 'Order of service']) {
  ok(`segment header: ${h}`, isSegmentHeader(h));
}
for (const h of ['Worship the King', 'Holy Fire', 'Praise the Lord praise the Lord', 'Amazing Grace']) ok(`not segment: ${h}`, !isSegmentHeader(h));

// ── THE reported bug: grouped titles without numbers collapse to one per group ──
{
  const txt = `Praise
Holy Fire
Open the Floodgates
Ancient Gates
River of Mercy

Worship
Faithful One Forever
Great Is Thy Faithfulness
Be Thou My Vision
Abide with Me

Offering
Imela
To God Be the Glory
Crown Him with Many Crowns
Standing on the Promises
Rock of Ages`;
  const rows = run(txt);
  ok('grouped list: 13 songs found', rows.length === 13, titles(rows));
  ok('grouped list: all matched', rows.every((r) => r.match), titles(rows));
  ok('grouped list: Imela via alt title', rows[8]?.match?.title === 'Imela (Thank You)', titles(rows));
}

// ── Flat list, no blank lines, no numbers ───────────────────────────────────
{
  const rows = run('Amazing Grace\nRock of Ages\nHoly Fire\nAbide with Me');
  ok('flat list: 4 rows', rows.length === 4 && rows.every((r) => r.confidence === 'exact'), titles(rows));
}

// ── Annotated list: leaders, keys, repeats, emoji, bullets ──────────────────
{
  const txt = `PRAISE SESSION (Bro. Mike)
1. Holy Fire - Mary (Key: E)
2. Open the Floodgates x2
3) Lift up your heads O ancient gates
• Imela 🙏
- River of Mercy — led by Esther
#6 Faithful One Forever [Bb]`;
  const rows = run(txt);
  ok('annotated: 6 rows', rows.length === 6, titles(rows));
  ok('annotated: matched in order', JSON.stringify(titles(rows)) === JSON.stringify(['Holy Fire', 'Open the Floodgates', 'Ancient Gates', 'Imela (Thank You)', 'River of Mercy', 'Faithful One Forever']), titles(rows));
}

// ── First LYRIC line instead of title ───────────────────────────────────────
{
  const rows = run('When peace like a river attendeth my way\nSummer and winter and springtime and harvest\nAll to Jesus I surrender');
  ok('first lines: 3 rows', rows.length === 3, titles(rows));
  ok('first lines: correct songs', JSON.stringify(titles(rows)) === JSON.stringify(['GHS 47 - It Is Well', 'Great Is Thy Faithfulness', 'I Surrender All']), titles(rows));
}

// ── Lyric snippet over several lines stays ONE entry ────────────────────────
{
  const rows = run('Amazing grace how sweet the sound\nThat saved a wretch like me\nI once was lost but now am found');
  ok('multi-line snippet: one row', rows.length === 1 && rows[0].match?.title === 'Amazing Grace', titles(rows));
}

// ── Typos ────────────────────────────────────────────────────────────────────
{
  const rows = run('Amazng Grace\nGreat is thy faithfullness\nStandin on the promise');
  ok('typos: matched', JSON.stringify(titles(rows)) === JSON.stringify(['Amazing Grace', 'Great Is Thy Faithfulness', 'Standing on the Promises']), titles(rows));
}

// ── Hymn numbers ─────────────────────────────────────────────────────────────
{
  const rows = run('GHS 12\nHymn 47\nBlessed Assurance');
  ok('hymn numbers', JSON.stringify(titles(rows)) === JSON.stringify(['GHS 12 - Blessed Assurance', 'GHS 47 - It Is Well', 'GHS 12 - Blessed Assurance']), titles(rows));
  ok('duplicate flagged', rows[2].duplicateOf === 0, rows.map((r) => r.duplicateOf));
}

// ── Medley line ──────────────────────────────────────────────────────────────
{
  const rows = run('Medley: Holy Fire / River of Mercy\nRock of Ages');
  ok('medley: split into parts', JSON.stringify(titles(rows)) === JSON.stringify(['Holy Fire', 'River of Mercy', 'Rock of Ages']), titles(rows));
}

// ── Choir sends FULL LYRICS for several songs, with singer names on headers ──
{
  const txt = `1. River of Mercy
Verse 1 — Mary
There is a river flowing from Your throne
Carry me deeper into Your love

Chorus — All
River of mercy wash over me

2. Faithful One Forever
Verse 1 - John
Morning comes and You are with me

Chorus
Faithful one forever You will never fail

3. Open the Floodgates
Open the floodgates of heaven`;
  const rows = run(txt);
  ok('choir lyrics: 3 songs (not one per verse)', rows.length === 3, titles(rows));
  ok('choir lyrics: right songs', JSON.stringify(titles(rows)) === JSON.stringify(['River of Mercy', 'Faithful One Forever', 'Open the Floodgates']), titles(rows));
  ok('choir lyrics: label is the title', rows[0].input === 'River of Mercy', rows[0].input);
}

// ── Unnumbered lyrics for two songs separated by blank lines ────────────────
{
  const txt = `Holy Fire
Verse 1 - Ada
Send Your holy fire burn within us
Set our hearts ablaze

Chorus
Send Your holy fire

Rock of Ages
Verse 1
Rock of ages cleft for me
Let me hide myself in Thee`;
  const rows = run(txt);
  ok('unnumbered lyrics: 2 songs', JSON.stringify(titles(rows)) === JSON.stringify(['Holy Fire', 'Rock of Ages']), titles(rows));
}

// ── Hymn with numbered stanzas stays one song ───────────────────────────────
{
  const txt = `Great Is Thy Faithfulness
1. Great is Thy faithfulness O God my Father
There is no shadow of turning with Thee
2. Summer and winter and springtime and harvest
Sun moon and stars in their courses above`;
  const rows = run(txt);
  ok('numbered stanzas: one song', rows.length === 1 && rows[0].match?.title === 'Great Is Thy Faithfulness', titles(rows));
}

// ── Title followed by its first lyric line (no blank) merges ────────────────
{
  const rows = run('Abide with Me\nAbide with me fast falls the eventide\n\nRock of Ages');
  ok('title + lyric line merge', JSON.stringify(titles(rows)) === JSON.stringify(['Abide with Me', 'Rock of Ages']), titles(rows));
}

// ── Unknown songs stay separate rows (so each can be created) ───────────────
{
  const rows = run('Holy Fire\nSome Brand New Song\nAnother Unknown Tune\nRock of Ages');
  ok('unknown titles: 4 rows', rows.length === 4, titles(rows));
  ok('unknown titles: 2 not found', rows.filter((r) => !r.match).length === 2, titles(rows));
}

// ── Unknown song pasted with lyrics → pre-parsed for "Create" ───────────────
{
  const txt = `Brand New Song
Verse 1 - Mary
Walking through the valley green
Chorus
You are good, You are kind`;
  const rows = run(txt);
  ok('unknown lyrics: one row', rows.length === 1 && !rows[0].match, titles(rows));
  ok('unknown lyrics: parsed sections', rows[0].parsed && rows[0].parsed.sections.length === 2 && rows[0].parsed.title === 'Brand New Song', rows[0].parsed);
  ok('unknown lyrics: no singer name', !/Mary/.test(JSON.stringify(rows[0].parsed?.sections)), rows[0].parsed);
}

{
  const rows = run('2. Rock of Ages\n3. Brand New Song\nVerse 1\nWalking through the valley green\nChorus\nYou are good, You are kind');
  ok('numbered unknown lyrics: title kept', rows.length === 2 && rows[1].parsed?.title === 'Brand New Song' && rows[1].parsed.sections.length === 2, rows[1]?.parsed);
}

// ── Old-format compat: numbered list with blank lines ───────────────────────
{
  const rows = run('Worship\n1. Abide with me fast falls the eventide\n\n2. Crown Him with many crowns\n\nRock of ages cleft for me');
  ok('legacy example', JSON.stringify(titles(rows)) === JSON.stringify(['Abide with Me', 'Crown Him with Many Crowns', 'Rock of Ages']), titles(rows));
}

// ── Segmenter never yields empty units ──────────────────────────────────────
ok('segment: empty', segmentSetList('').length === 0);
ok('segment: only headers', segmentSetList('Worship\nPraise\n\nOffering').length === 0);

console.log(`setlist-match: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
