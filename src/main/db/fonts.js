import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import * as settings from './settings.js';
import { getDb } from './schema.js';
import { FONT_CATALOG, fontsourceUrl } from '../fonts-catalog.js';
import { BUNDLED_FONTS } from '../fonts.js';

// ── User-installed fonts ─────────────────────────────────────────────────────
// Custom font files the operator imports through Settings. Each file is copied
// into userData/fonts/<uuid>.<ext>; the metadata list lives in the `user_fonts`
// settings key. The files are served to the renderer and output windows via the
// existing cue-media:// protocol, so no special static route is needed.
//
//   user_fonts = [{ id, family, label, filename, path, ext }]

const SETTINGS_KEY = 'user_fonts';
const SUPPORTED = ['woff2', 'woff', 'ttf', 'otf'];

export function getUserFontsDir() {
  const dir = path.join(app.getPath('userData'), 'fonts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listUserFonts() {
  const list = settings.get(SETTINGS_KEY);
  return Array.isArray(list) ? list : [];
}

// Derive a CSS family name from a filename: strip extension, replace separators
// with spaces, drop common weight/style suffixes, and title-case.
function deriveFamily(filename) {
  let base = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  base = base.replace(/\s*\b(regular|bold|italic|light|medium|semibold|thin|black|book|oblique)\b\s*/gi, ' ').trim();
  if (!base) base = filename.replace(/\.[^.]+$/, '');
  return base.replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Copy a font file into the user fonts dir and register it. If a font with the
// same derived family already exists, the new file replaces its source so a
// family's regular/bold variants can be added under one name.
export function importFont(srcPath, familyOverride) {
  const ext = path.extname(srcPath).slice(1).toLowerCase();
  if (!SUPPORTED.includes(ext)) {
    return { ok: false, error: `Unsupported font type ".${ext}". Use ${SUPPORTED.map((e) => '.' + e).join(', ')}.` };
  }
  const dir = getUserFontsDir();
  const filename = path.basename(srcPath);
  const family = (familyOverride && familyOverride.trim()) || deriveFamily(filename);
  const destName = crypto.randomUUID() + '.' + ext;
  const destPath = path.join(dir, destName);
  fs.copyFileSync(srcPath, destPath);

  const entry = { id: crypto.randomUUID(), family, label: family, filename, path: destPath, ext };
  const list = listUserFonts();
  list.push(entry);
  settings.set(SETTINGS_KEY, list);
  return { ok: true, font: entry };
}

export function deleteFont(id) {
  const list = listUserFonts();
  const entry = list.find((f) => f.id === id);
  if (!entry) return { ok: false };
  settings.set(SETTINGS_KEY, list.filter((f) => f.id !== id));
  try { if (fs.existsSync(entry.path)) fs.unlinkSync(entry.path); } catch {}
  return { ok: true };
}

const FORMAT = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

function fontUrl(absPath) {
  const normalized = absPath.replace(/\\/g, '/');
  const pathPart = normalized.startsWith('/') ? normalized : '/' + normalized;
  return 'cue-media://localhost' + pathPart.split('/').map(encodeURIComponent).join('/');
}

// @font-face rules for every user font — injected into the operator UI and each
// output window so custom families render identically in the editor and on air.
export function buildUserFontCss() {
  const rules = listUserFonts().map((f) => {
    const fmt = FORMAT[f.ext] || 'truetype';
    return `@font-face{font-family:'${String(f.family).replace(/'/g, '')}';`
      + `src:url('${fontUrl(f.path)}') format('${fmt}');font-display:block;}`;
  });
  // Downloaded library fonts — one @font-face per weight, so a family's regular +
  // bold both resolve to real faces (not synthesized) on screen and NDI.
  for (const f of listLibraryFonts()) {
    for (const file of f.files || []) {
      rules.push(`@font-face{font-family:'${String(f.family).replace(/'/g, '')}';`
        + `src:url('${fontUrl(file.path)}') format('woff2');`
        + `font-weight:${file.weight};font-display:block;}`);
    }
  }
  return rules.join('\n');
}

// ── Downloadable font library ────────────────────────────────────────────────
// Curated open-licence families fetched on demand from @fontsource (see
// fonts-catalog.js). Downloaded woff2s live in the same userData/fonts dir and
// are tracked in the `library_fonts` settings key:
//   library_fonts = [{ family, label, category, files:[{ weight, path }] }]

const LIBRARY_KEY = 'library_fonts';

export function listLibraryFonts() {
  const list = settings.get(LIBRARY_KEY);
  return Array.isArray(list) ? list : [];
}

// The full catalog with a `downloaded` flag, for the font-library picker.
export function fontCatalog() {
  const have = new Set(listLibraryFonts().map((f) => f.family));
  return FONT_CATALOG.map((f) => ({
    family: f.family, label: f.family, category: f.category, downloaded: have.has(f.family),
    weights: Array.isArray(f.weights) ? f.weights.length : undefined,
  }));
}

// Fetch a catalog family's weights from @fontsource and cache them locally.
// Idempotent (a already-downloaded family returns immediately). At least one
// weight must download for success; missing weights are skipped silently.
// Candidate URLs for a family weight: a self-hosted OFL pack first (when the maintainer
// has published one and set `font_pack_base` in settings), else the @fontsource CDN.
// Self-hosting removes the runtime third-party dependency; the fallback keeps it working
// out of the box. Pack files are named like fontsource: `<id>-latin-<weight>-normal.woff2`.
function fontWeightUrls(id, weight) {
  const urls = [];
  const base = settings.get('font_pack_base');
  if (base && typeof base === 'string') urls.push(`${base.replace(/\/$/, '')}/${id}-latin-${weight}-normal.woff2`);
  urls.push(fontsourceUrl(id, weight));
  return urls;
}

export async function downloadLibraryFont(family) {
  const entry = FONT_CATALOG.find((f) => f.family === family);
  if (!entry) return { ok: false, error: 'Unknown font' };
  if (listLibraryFonts().some((f) => f.family === family)) return { ok: true, already: true };
  const dir = getUserFontsDir();
  const files = [];
  for (const weight of entry.weights) {
    try {
      let res = null;
      for (const url of fontWeightUrls(entry.id, weight)) {
        try { const r = await fetch(url); if (r.ok) { res = r; break; } } catch { /* try next source */ }
      }
      if (!res) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const dest = path.join(dir, `lib-${entry.id}-${weight}.woff2`);
      fs.writeFileSync(dest, buf);
      files.push({ weight, path: dest });
    } catch { /* skip this weight, try the next */ }
  }
  if (!files.length) return { ok: false, error: 'Download failed — check your connection.' };
  const rec = { family: entry.family, label: entry.family, category: entry.category, files };
  const list = listLibraryFonts();
  list.push(rec);
  settings.set(LIBRARY_KEY, list);
  return { ok: true, font: rec };
}

export function deleteLibraryFont(family) {
  const list = listLibraryFonts();
  const rec = list.find((f) => f.family === family);
  if (!rec) return { ok: false };
  settings.set(LIBRARY_KEY, list.filter((f) => f.family !== family));
  for (const file of rec.files || []) {
    try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch {}
  }
  return { ok: true };
}

// ── Font-picker previews (render an uninstalled font in its own face) ────────
// The picker shows a downloadable font in its own typeface BEFORE downloading it, by
// loading a tiny build-time SUBSET (just the glyphs for the family name + sample line,
// ~2-4 KB each) shipped in resources/font-previews/<catalog-id>.woff2. Registered as
// "<Family> Preview" and inlined as a data: URI (the previews dir isn't under userData,
// so cue-media:// can't serve it). Empty until the previews are generated (see
// scripts/gen-font-previews.mjs) — the picker falls back to a same-class face till then.
function previewFontDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'font-previews')
    : path.join(app.getAppPath(), 'resources', 'font-previews');
}

export function buildPreviewFontCss() {
  const dir = previewFontDir();
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.woff2')); }
  catch { return { css: '', families: [] }; }
  const byId = new Map(FONT_CATALOG.map((f) => [f.id, f.family]));
  const rules = [];
  const families = [];
  for (const file of files) {
    const family = byId.get(file.replace(/\.woff2$/i, ''));
    if (!family) continue;
    try {
      const b64 = fs.readFileSync(path.join(dir, file)).toString('base64');
      rules.push(`@font-face{font-family:'${family.replace(/'/g, '')} Preview';`
        + `src:url(data:font/woff2;base64,${b64}) format('woff2');font-display:block;}`);
      families.push(family);
    } catch { /* skip unreadable file */ }
  }
  return { css: rules.join('\n'), families };
}

// ── Ensure-present-before-go-live (determinism guard) ────────────────────────
// Text must never fall back to a different face mid-service. A rundown that opened
// on a fresh machine may reference a downloadable font (via a theme, an item override,
// an app default, or a baked song style) that isn't installed yet. Gather every font
// family the rundown could render and pre-download any that are missing — bundled
// families and the user's own imports are skipped (a custom import can't be re-fetched).

const BUNDLED_FAMILIES = new Set(BUNDLED_FONTS.filter((f) => f.bundled).map((f) => f.family));
const CATALOG_FAMILIES = new Set(FONT_CATALOG.map((f) => f.family));

// Every font family a rundown references (themes it uses + app defaults + baked styles).
export function collectServiceFontFamilies(serviceId) {
  const db = getDb();
  const fams = new Set();
  const addStyle = (sj) => {
    if (!sj) return;
    try { const s = JSON.parse(sj); if (s.fontFamily) fams.add(s.fontFamily); if (s.lt && s.lt.fontFamily) fams.add(s.lt.fontFamily); } catch { /* ignore */ }
  };
  const themeIds = new Set();
  for (const key of ['default_theme_id', 'default_theme_id_song', 'default_theme_id_scripture', 'default_theme_id_slide']) {
    const v = Number(settings.get(key)); if (v) themeIds.add(v);
  }
  const svc = db.prepare('SELECT theme_id FROM services WHERE id=?').get(serviceId);
  if (svc && svc.theme_id) themeIds.add(svc.theme_id);
  for (const r of db.prepare('SELECT DISTINCT theme_override_id AS id FROM service_items WHERE service_id=? AND theme_override_id IS NOT NULL').all(serviceId)) themeIds.add(r.id);
  for (const id of themeIds) {
    const t = db.prepare('SELECT style_json FROM themes WHERE id=?').get(id);
    if (t) addStyle(t.style_json);
  }
  // Baked per-section styles for the rundown's songs.
  const songIds = db.prepare("SELECT DISTINCT ref_id AS id FROM service_items WHERE service_id=? AND item_type='song' AND ref_id IS NOT NULL").all(serviceId).map((r) => r.id);
  if (songIds.length) {
    const ph = songIds.map(() => '?').join(',');
    for (const s of db.prepare(`SELECT style_json FROM song_sections WHERE song_id IN (${ph})`).all(...songIds)) addStyle(s.style_json);
  }
  return [...fams];
}

// Download any downloadable font a rundown references that isn't installed. Returns
// { missing, results }. Bundled + user-imported families are never "missing".
export async function ensureServiceFonts(serviceId) {
  const referenced = collectServiceFontFamilies(serviceId);
  const have = new Set(listLibraryFonts().map((f) => f.family));
  const missing = referenced.filter((f) => f && !BUNDLED_FAMILIES.has(f) && !have.has(f) && CATALOG_FAMILIES.has(f));
  const results = [];
  for (const family of missing) {
    try { results.push({ family, ...(await downloadLibraryFont(family)) }); }
    catch (err) { results.push({ family, ok: false, error: err.message }); }
  }
  return { missing, results };
}
