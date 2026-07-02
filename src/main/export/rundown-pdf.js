import { BrowserWindow, dialog, app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as services from '../db/services.js';

// Canonical inline slide-break marker (U+2042). Defined in
// renderer/utils/sectionLabels.js as SLIDE_BREAK — duplicated here as a literal
// so main doesn't import a renderer util. It is symbol-only and lives on its own
// line; for a printable lyric sheet we drop it entirely.
const SLIDE_BREAK = '⁂';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// "Verse"/"Chorus" labels, numbered only where a type repeats within the song
// (Verse 1 / Verse 2, but a lone Bridge stays "Bridge").
function sectionLabels(sections) {
  const total = {};
  for (const s of sections) total[s.type] = (total[s.type] || 0) + 1;
  const seen = {};
  return sections.map((s) => {
    seen[s.type] = (seen[s.type] || 0) + 1;
    const name = s.type.charAt(0).toUpperCase() + s.type.slice(1);
    return total[s.type] > 1 ? `${name} ${seen[s.type]}` : name;
  });
}

// Strip the slide-break marker lines, collapsing the blank gaps they leave.
function cleanLyrics(content) {
  return String(content || '')
    .split('\n')
    .filter((line) => line.trim() !== SLIDE_BREAK)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderItem(item, index) {
  const num = `<span class="num">${index + 1}</span>`;

  if (item.item_type === 'song' && item.song) {
    const labels = sectionLabels(item.sections || []);
    const sections = (item.sections || []).map((sec, i) => {
      const lyrics = cleanLyrics(sec.content);
      if (!lyrics) return '';
      return `<div class="section">
        <div class="seclabel">${esc(labels[i])}</div>
        <div class="lyrics">${esc(lyrics)}</div>
      </div>`;
    }).join('');
    const meta = [item.song.author, item.song.copyright].filter(Boolean).map(esc).join(' · ');
    return `<article class="item song">
      <h2>${num}${esc(item.song.title)}</h2>
      ${meta ? `<div class="meta">${meta}</div>` : ''}
      ${sections || '<div class="empty">(no lyrics)</div>'}
    </article>`;
  }

  if (item.item_type === 'scripture' && item.scripture) {
    const verses = (item.scripture.verses || [])
      .map((v) => `<span class="vnum">${esc(v.verse)}</span>${esc(v.text)}`)
      .join('\n');
    return `<article class="item scripture">
      <h2>${num}${esc(item.scripture.reference || item.title || 'Scripture')}</h2>
      <div class="meta">${esc(item.scripture.versionAbbrev || '')}</div>
      <div class="lyrics">${verses}</div>
    </article>`;
  }

  if (item.item_type === 'slide' && item.content) {
    return `<article class="item slide">
      <h2>${num}Slide</h2>
      <div class="lyrics">${esc(item.content)}</div>
    </article>`;
  }

  if (item.item_type === 'presentation' && item.presentation) {
    const slideLabels = (item.slides || [])
      .filter((s) => s.label)
      .map((s) => `<li>${esc(s.label)}</li>`)
      .join('');
    return `<article class="item presentation">
      <h2>${num}${esc(item.presentation.title)}</h2>
      ${slideLabels ? `<ul class="slides">${slideLabels}</ul>` : '<div class="empty">(no slides)</div>'}
    </article>`;
  }

  // Media / youtube — no printable lyric text, but keep the running order intact.
  const labelByType = {
    media: item.asset ? `Media — ${item.asset.filename}` : 'Media',
    youtube: item.youtube?.title ? `YouTube — ${item.youtube.title}` : `YouTube — ${item.youtube?.url || ''}`,
  };
  const label = labelByType[item.item_type] || item.item_type;
  return `<article class="item placeholder"><h2>${num}<span class="ph">${esc(label)}</span></h2></article>`;
}

function buildHtml(service) {
  const dateStr = service.date
    ? new Date(`${service.date}T00:00:00`).toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : '';
  const body = (service.items || []).map(renderItem).join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(service.title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111; background: #fff; font-size: 12pt; line-height: 1.45;
  }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 18px; }
  header h1 { font-size: 22pt; margin: 0; }
  header .date { font-size: 11pt; color: #555; margin-top: 2px; }
  .item { margin: 0 0 22px; break-inside: avoid-page; }
  .item h2 { font-size: 14pt; margin: 0 0 4px; break-after: avoid; }
  .num {
    display: inline-block; min-width: 1.6em; margin-right: 6px;
    color: #888; font-weight: 600; font-variant-numeric: tabular-nums;
  }
  .meta { font-size: 9.5pt; color: #666; margin: 0 0 8px; }
  .section { margin: 0 0 10px; break-inside: avoid; }
  .seclabel {
    font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.06em;
    color: #999; margin-bottom: 1px;
  }
  .lyrics { white-space: pre-wrap; }
  .vnum {
    font-size: 8pt; vertical-align: super; color: #888;
    margin-right: 3px; font-weight: 600;
  }
  .empty { color: #aaa; font-style: italic; }
  .placeholder h2 { font-weight: 400; }
  .ph { color: #888; font-style: italic; }
  .presentation .slides { margin: 4px 0 0; padding-left: 1.2em; font-size: 10pt; color: #444; }
  .presentation .slides li { margin-bottom: 1px; }
</style></head>
<body>
  <header>
    <h1>${esc(service.title)}</h1>
    ${dateStr ? `<div class="date">${esc(dateStr)}</div>` : ''}
  </header>
  ${body || '<p class="empty">This rundown is empty.</p>'}
</body></html>`;
}

function safeFilename(title) {
  return (title || 'rundown').replace(/[/\\?%*:|"<>]/g, '-').trim() || 'rundown';
}

// Resolve the rundown, lay it out as a printable HTML document, render it to PDF
// with Chromium (printToPDF — no external tooling), and write it to a
// user-chosen path. Returns { canceled } or { canceled:false, path }.
export async function exportRundownPdf(serviceId) {
  const service = services.getById(serviceId);
  if (!service) throw new Error('Service not found');

  const parent = BrowserWindow.getFocusedWindow();
  const saveOptions = {
    title: 'Export Rundown as PDF',
    defaultPath: path.join(app.getPath('documents'), `${safeFilename(service.title)}.pdf`),
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
  };
  const { canceled, filePath } = parent
    ? await dialog.showSaveDialog(parent, saveOptions)
    : await dialog.showSaveDialog(saveOptions);
  if (canceled || !filePath) return { canceled: true };

  const html = buildHtml(service);
  const tmpHtml = path.join(os.tmpdir(), `cue-rundown-${Date.now()}.html`);
  await fs.writeFile(tmpHtml, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(tmpHtml);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    await fs.writeFile(filePath, pdf);
  } finally {
    win.destroy();
    fs.unlink(tmpHtml).catch(() => {});
  }
  return { canceled: false, path: filePath };
}
