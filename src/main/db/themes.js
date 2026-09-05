import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getDb } from './schema.js';
import { get as getSetting, set as setSetting } from './settings.js';
import { download as downloadBackground } from './background-library.js';

// Media themes (Phase 1b Layer 2) carry a `bgRef` (background-library item id) in
// style_json instead of a bundled background_id — Option A means the media isn't
// local until used. Resolve it lazily: download the item into the media library
// (once) and cache it onto the theme's background_id, after which the theme is an
// ordinary media-backed theme that applyTo* handles unchanged. Call before apply.
export async function resolveThemeBackground(themeId) {
  const db = getDb();
  const theme = db.prepare('SELECT id, style_json, background_id FROM themes WHERE id=?').get(themeId);
  if (!theme || theme.background_id) return;
  let style;
  try { style = theme.style_json ? JSON.parse(theme.style_json) : {}; } catch { style = {}; }
  if (!style.bgRef) return;
  const asset = await downloadBackground(style.bgRef);
  db.prepare("UPDATE themes SET background_id=?, updated_at=datetime('now') WHERE id=?").run(asset.id, themeId);
}

export function list() {
  // Built-ins first within each category, ordered by sort_order; user themes
  // (sort_order 0) fall back to name. The pickers filter by `category`.
  return getDb().prepare(`
    SELECT t.*, ma.path AS background_path, ma.filename AS background_filename, ma.type AS background_type
    FROM themes t
    LEFT JOIN media_assets ma ON ma.id = t.background_id
    ORDER BY t.builtin DESC, t.sort_order ASC, t.name COLLATE NOCASE
  `).all();
}

export function get(id) {
  return getDb().prepare(`
    SELECT t.*, ma.path AS background_path, ma.filename AS background_filename, ma.type AS background_type
    FROM themes t
    LEFT JOIN media_assets ma ON ma.id = t.background_id
    WHERE t.id = ?
  `).get(id);
}

export function create(data) {
  const { name, style_json, background_id, category } = data;
  const { lastInsertRowid } = getDb().prepare(
    `INSERT INTO themes (name, style_json, background_id, category) VALUES (?, ?, ?, ?)`
  ).run(name, style_json ?? null, background_id ?? null, category || 'song');
  return Number(lastInsertRowid);
}

export function update(id, data) {
  const { name, style_json, background_id, category } = data;
  // `category` is optional: when the editor lets the user retarget a theme to a
  // different content surface (song/scripture/presentation) it's passed through;
  // older callers that omit it leave the existing category untouched.
  if (category === undefined) {
    getDb().prepare(
      `UPDATE themes SET name=?, style_json=?, background_id=?, updated_at=datetime('now') WHERE id=?`
    ).run(name, style_json ?? null, background_id ?? null, id);
  } else {
    getDb().prepare(
      `UPDATE themes SET name=?, style_json=?, background_id=?, category=?, updated_at=datetime('now') WHERE id=?`
    ).run(name, style_json ?? null, background_id ?? null, category, id);
  }
}

export function del(id) {
  getDb().prepare('DELETE FROM themes WHERE id = ?').run(id);
}

// ─── Bundled theme packs ─────────────────────────────────────────────────────
// Mirrors seedBundledBibles()/seedGhsHymnal(): import the authored theme JSON
// from resources/themes/ on first run, gated by a `themes_seeded` flag so user
// deletions stick. Each file is one theme:
//   { name, category, sort_order, style: {…§8 style, incl. bgCss…} }
// Built-ins carry an original CSS gradient/solid in style.bgCss (zero licensing),
// so they need no media asset — background_id stays null.

function bundledThemeDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'themes')
    : path.join(app.getAppPath(), 'resources', 'themes');
}

// Seed bundled built-in themes by NAME, tracking which names have been seeded in
// `seeded_theme_keys`. This lets a later release add new built-ins (e.g. the
// Phase 1b media themes) on upgrade WITHOUT re-adding any a user has deleted —
// a deleted theme's name stays in the set, so it never resurrects.
export function seedBundledThemes() {
  const dir = bundledThemeDir();
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort();
  } catch {
    return; // no bundled themes present (e.g. dev checkout without resources)
  }
  const db = getDb();
  // Load the seeded-keys set, migrating the legacy all-or-nothing `themes_seeded`
  // flag: an existing install has already seeded its built-ins, so treat every
  // current built-in name as seeded (don't duplicate them).
  let seeded;
  try { seeded = new Set(JSON.parse(getSetting('seeded_theme_keys') || 'null')); } catch { seeded = null; }
  if (!seeded) {
    seeded = new Set();
    if (getSetting('themes_seeded')) {
      for (const r of db.prepare('SELECT name FROM themes WHERE builtin=1').all()) seeded.add(r.name);
    }
  }
  const insert = db.prepare(
    `INSERT INTO themes (name, style_json, background_id, builtin, category, sort_order)
     VALUES (@name, @style_json, NULL, 1, @category, @sort_order)`
  );
  db.transaction(() => {
    for (const file of files) {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (!t?.name || !t?.style) continue;
        const styleJson = JSON.stringify(t.style);
        const category = t.category || 'song';
        const sort = Number.isFinite(t.sort_order) ? t.sort_order : 0;
        const existing = db.prepare('SELECT id, style_json, background_id FROM themes WHERE name=? AND builtin=1').get(t.name);
        if (existing) {
          // Built-ins are read-only, so the bundle is the source of truth — push
          // definition fixes (e.g. a swapped media background) when it changed.
          if (existing.style_json !== styleJson) {
            db.prepare("UPDATE themes SET style_json=?, category=?, sort_order=?, updated_at=datetime('now') WHERE id=?")
              .run(styleJson, category, sort, existing.id);
            // A media theme whose bgRef changed must drop its cached download so the
            // new background re-resolves on next apply (resolveThemeBackground).
            if (t.style.bgRef && existing.background_id != null) {
              db.prepare('UPDATE themes SET background_id=NULL WHERE id=?').run(existing.id);
            }
          }
        } else if (!seeded.has(t.name)) {
          insert.run({ name: t.name, style_json: styleJson, category, sort_order: sort });
        } // else: a built-in the user deleted — don't resurrect it
        seeded.add(t.name);
      } catch (err) {
        console.error('[theme-seed] failed to import', file, err.message);
      }
    }
  })();
  setSetting('seeded_theme_keys', JSON.stringify([...seeded]));
  setSetting('themes_seeded', true);
}

// First-run onboarding: give a fresh install a real app-default theme so output is
// never black out of the box (§4.5). Only sets it when none is chosen — never overrides
// a user's pick. Prefers an offline gradient Collection (works with no internet), then
// any curated Collection, then any built-in.
export function ensureDefaultTheme() {
  if (getSetting('default_theme_id')) return; // respect an existing / user choice
  const db = getDb();
  const pick = db.prepare("SELECT id FROM themes WHERE name=? AND builtin=1").get('Modern Worship')
    || db.prepare("SELECT id FROM themes WHERE builtin=1 AND style_json LIKE '%\"collection\"%' AND style_json LIKE '%bgCss%' ORDER BY sort_order ASC LIMIT 1").get()
    || db.prepare("SELECT id FROM themes WHERE builtin=1 ORDER BY sort_order ASC LIMIT 1").get();
  if (pick) setSetting('default_theme_id', String(pick.id));
}

// Silently pre-download the full-res background for every unresolved built-in
// presentation photo theme so the images are cached before the user opens the picker.
// Fire-and-forget — call once after seedBundledThemes().
export async function preloadPresentationThemeBgs() {
  const db = getDb();
  const unresolved = db.prepare(
    `SELECT id FROM themes WHERE builtin=1 AND category='presentation' AND background_id IS NULL`
  ).all();
  for (const { id } of unresolved) {
    try { await resolveThemeBackground(id); }
    catch (err) { console.warn('[theme-preload]', id, err.message); }
  }
}

// Merge theme style_json into a section's existing style_json, preserving inline
// text runs (per-character bold/italic/colour ranges that belong to that section).
function mergeIntoSection(sectionStyleJson, themeStyleObj) {
  if (!themeStyleObj || !Object.keys(themeStyleObj).length) return sectionStyleJson;
  const existing = sectionStyleJson ? JSON.parse(sectionStyleJson) : {};
  const merged = { ...themeStyleObj };
  if (existing.runs && existing.runs.length) merged.runs = existing.runs;
  return JSON.stringify(merged);
}

// Apply theme to all sections of a single song. Optionally updates the song's
// default_background_id if the theme has one and setBg is true. When the
// background is applied, per-slot overrides on rundown items referencing this
// song are cleared so the theme's background actually shows (an override would
// otherwise win over the song default).
export function applyToSong(themeId, songId, setBg = true) {
  const db = getDb();
  const theme = get(themeId);
  if (!theme) return 0;
  const themeStyle = theme.style_json ? JSON.parse(theme.style_json) : {};
  // A theme's background is either a media asset (background_id) or a license-free
  // CSS gradient/solid (style_json.bgCss). When the theme uses bgCss, the song's
  // media background must be cleared (NULL) so the gradient actually shows —
  // resolveBackground puts a media path above bgCss. A text-only theme (neither)
  // leaves backgrounds untouched.
  const bgTarget = themeStyle.bgCss ? null : theme.background_id;
  const touchesBg = setBg && (theme.background_id || themeStyle.bgCss);
  const sections = db.prepare('SELECT id, style_json FROM song_sections WHERE song_id = ?').all(songId);
  db.transaction(() => {
    for (const sec of sections) {
      db.prepare('UPDATE song_sections SET style_json = ? WHERE id = ?')
        .run(mergeIntoSection(sec.style_json, themeStyle), sec.id);
    }
    if (touchesBg) {
      db.prepare(`UPDATE songs SET default_background_id=?, updated_at=datetime('now') WHERE id=?`)
        .run(bgTarget, songId);
      db.prepare(`UPDATE service_items SET background_override_id=NULL WHERE item_type='song' AND ref_id=?`)
        .run(songId);
    }
  })();
  return sections.length;
}

// Apply theme to all songs referenced by song items in a rundown.
export function applyToRundown(themeId, serviceId, setBg = true) {
  const db = getDb();
  const theme = get(themeId);
  if (!theme) return 0;
  const themeStyle = theme.style_json ? JSON.parse(theme.style_json) : {};
  const bgTarget = themeStyle.bgCss ? null : theme.background_id;
  const touchesBg = setBg && (theme.background_id || themeStyle.bgCss);
  const songIds = db.prepare(
    `SELECT DISTINCT ref_id FROM service_items WHERE service_id=? AND item_type='song' AND ref_id IS NOT NULL`
  ).all(serviceId).map((r) => r.ref_id);
  if (!songIds.length) return 0;
  db.transaction(() => {
    for (const songId of songIds) {
      const sections = db.prepare('SELECT id, style_json FROM song_sections WHERE song_id = ?').all(songId);
      for (const sec of sections) {
        db.prepare('UPDATE song_sections SET style_json = ? WHERE id = ?')
          .run(mergeIntoSection(sec.style_json, themeStyle), sec.id);
      }
      if (touchesBg) {
        db.prepare(`UPDATE songs SET default_background_id=?, updated_at=datetime('now') WHERE id=?`)
          .run(bgTarget, songId);
      }
    }
    // Clear per-slot overrides on this rundown's song items so the theme bg wins.
    if (touchesBg) {
      db.prepare(`UPDATE service_items SET background_override_id=NULL WHERE service_id=? AND item_type='song'`)
        .run(serviceId);
    }
  })();
  return songIds.length;
}

// Apply theme to every song in the library.
export function applyToAllSongs(themeId, setBg = true) {
  const db = getDb();
  const theme = get(themeId);
  if (!theme) return 0;
  const themeStyle = theme.style_json ? JSON.parse(theme.style_json) : {};
  const bgTarget = themeStyle.bgCss ? null : theme.background_id;
  const touchesBg = setBg && (theme.background_id || themeStyle.bgCss);
  const songIds = db.prepare('SELECT id FROM songs').all().map((r) => r.id);
  if (!songIds.length) return 0;
  db.transaction(() => {
    for (const songId of songIds) {
      const sections = db.prepare('SELECT id, style_json FROM song_sections WHERE song_id = ?').all(songId);
      for (const sec of sections) {
        db.prepare('UPDATE song_sections SET style_json = ? WHERE id = ?')
          .run(mergeIntoSection(sec.style_json, themeStyle), sec.id);
      }
      if (touchesBg) {
        db.prepare(`UPDATE songs SET default_background_id=?, updated_at=datetime('now') WHERE id=?`)
          .run(bgTarget, songId);
      }
    }
    // Clear every song slot's per-slot override so the theme bg wins everywhere.
    if (touchesBg) {
      db.prepare(`UPDATE service_items SET background_override_id=NULL WHERE item_type='song'`).run();
    }
  })();
  return songIds.length;
}

// ─── Reset to theme (adopt the live cascade) ─────────────────────────────────
// Strip a baked theme look from a section's style_json, keeping only content-level
// inline runs / textBox so the section falls back to the LIVE theme cascade. Mirrors
// the renderer's mergeSlideStyle rule (utils/themeStyle.js).
function stripBakedLook(styleJson) {
  if (!styleJson) return null;
  let s;
  try { s = JSON.parse(styleJson); } catch { return null; }
  const keep = {};
  if (Array.isArray(s.runs) && s.runs.length) keep.runs = s.runs;
  if (s.textBox) keep.textBox = s.textBox;
  return Object.keys(keep).length ? JSON.stringify(keep) : null;
}

// "Reset to theme": drop a song's baked per-section styling AND its own default
// background / lock / rundown slot overrides, so the song follows the live theme
// cascade (App→Service→Item) everywhere it's used. Inline runs are preserved. This is
// the escape hatch out of the old paint-bucket bake — the theme can finally override it.
export function resetSongToTheme(songId) {
  const db = getDb();
  db.transaction(() => {
    const sections = db.prepare('SELECT id, style_json FROM song_sections WHERE song_id=?').all(songId);
    for (const sec of sections) {
      db.prepare('UPDATE song_sections SET style_json=? WHERE id=?').run(stripBakedLook(sec.style_json), sec.id);
    }
    db.prepare("UPDATE songs SET default_background_id=NULL, background_locked=0, updated_at=datetime('now') WHERE id=?").run(songId);
    db.prepare("UPDATE service_items SET background_override_id=NULL WHERE item_type='song' AND ref_id=?").run(songId);
  })();
  return true;
}

// "Reset ALL songs to the live theme": the same, library-wide — the one-click hammer
// that clears every baked look so the theme cascade fully takes over. Returns the count.
export function resetAllSongsToTheme() {
  const db = getDb();
  let count = 0;
  db.transaction(() => {
    const sections = db.prepare('SELECT id, style_json FROM song_sections').all();
    for (const sec of sections) {
      const next = stripBakedLook(sec.style_json);
      if (next !== sec.style_json) db.prepare('UPDATE song_sections SET style_json=? WHERE id=?').run(next, sec.id);
    }
    db.prepare("UPDATE songs SET default_background_id=NULL, background_locked=0, updated_at=datetime('now')").run();
    db.prepare("UPDATE service_items SET background_override_id=NULL WHERE item_type='song'").run();
    count = db.prepare('SELECT COUNT(*) AS c FROM songs').get().c;
  })();
  return count;
}
