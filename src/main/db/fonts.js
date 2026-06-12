import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import * as settings from './settings.js';

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
  return listUserFonts().map((f) => {
    const fmt = FORMAT[f.ext] || 'truetype';
    return `@font-face{font-family:'${String(f.family).replace(/'/g, '')}';`
      + `src:url('${fontUrl(f.path)}') format('${fmt}');font-display:block;}`;
  }).join('\n');
}
