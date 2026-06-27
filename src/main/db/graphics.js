import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getDb } from './schema.js';

// Broadcast graphics — reusable, fully customisable lower-third name/title cards,
// tickers and custom HTML. Pure CRUD; these feed the independent overlay bus (see
// output/manager.js). style_json holds per-graphic appearance (fonts, colours,
// position box, bar); target is the saved default destination ('all'|'screen'|'ndi').

export function list() {
  return getDb()
    .prepare(`
      SELECT g.*, m.path AS background_path, m.filename AS background_filename
      FROM graphics g
      LEFT JOIN media_assets m ON m.id = g.background_media_id
      ORDER BY g.order_index, g.id
    `)
    .all();
}

export function get(id) {
  return getDb()
    .prepare(`
      SELECT g.*, m.path AS background_path, m.filename AS background_filename
      FROM graphics g
      LEFT JOIN media_assets m ON m.id = g.background_media_id
      WHERE g.id = ?
    `)
    .get(id);
}

export function create(data) {
  const db = getDb();
  const { kind, label, name, title, text, html, speed, style_json, target, background_media_id } = data;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM graphics').get().m;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO graphics (kind, label, name, title, text, html, speed, style_json, target, background_media_id, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      kind,
      label || null,
      name || null,
      title || null,
      text || null,
      html || null,
      Number.isFinite(speed) ? speed : 100,
      style_json ? (typeof style_json === 'string' ? style_json : JSON.stringify(style_json)) : null,
      target || 'ndi',
      background_media_id ? Number(background_media_id) : null,
      maxOrder + 1
    );
  return Number(lastInsertRowid);
}

export function update(id, data) {
  const { kind, label, name, title, text, html, speed, style_json, target, background_media_id } = data;
  getDb()
    .prepare(
      `UPDATE graphics SET kind=?, label=?, name=?, title=?, text=?, html=?, speed=?, style_json=?, target=?, background_media_id=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(
      kind,
      label || null,
      name || null,
      title || null,
      text || null,
      html || null,
      Number.isFinite(speed) ? speed : 100,
      style_json ? (typeof style_json === 'string' ? style_json : JSON.stringify(style_json)) : null,
      target || 'ndi',
      background_media_id ? Number(background_media_id) : null,
      id
    );
}

export function del(id) {
  getDb().prepare('DELETE FROM graphics WHERE id = ?').run(id);
}

export function reorder(orderedIds) {
  const db = getDb();
  db.transaction(() => {
    orderedIds.forEach((id, i) =>
      db.prepare('UPDATE graphics SET order_index = ? WHERE id = ?').run(i, id)
    );
  })();
}

// ─── Built-in design presets ─────────────────────────────────────────────────
// Ship built-in broadcast-overlay designs in resources/graphics/, in two forms:
//   • *.html  — self-contained custom-HTML designs (transparent bg, 1920×1080,
//               {{name}}/{{title}}/{{text}} placeholders, `<!-- name: … -->` header)
//   • *.json  — STRUCTURED designs for the lower-third / ticker / countdown kinds,
//               carrying { name, kind, graphic:{…partial graphic record incl.
//               style_json…} } so the design stays fully editable via the normal
//               toolbar controls (it's a style preset, not frozen HTML).
// These are NOT seeded into the DB — they're read at request time and offered by
// the gallery as starting points; picking one creates an ordinary graphic of that
// kind the user can edit. Each preset is returned as
//   { id, name, kind, graphic }   (graphic = the fields to seed onto a new graphic)
// Mirrors the bundled-theme resource-path pattern in db/themes.js (process.
// resourcesPath packaged / app path in dev).

function presetDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'graphics')
    : path.join(app.getAppPath(), 'resources', 'graphics');
}

export function presets() {
  const dir = presetDir();
  let files;
  try {
    files = fs.readdirSync(dir).sort();
  } catch {
    return []; // no bundled designs present (e.g. dev checkout without resources)
  }
  const out = [];
  for (const file of files) {
    const lower = file.toLowerCase();
    try {
      if (lower.endsWith('.html')) {
        const raw = fs.readFileSync(path.join(dir, file), 'utf8');
        const m = raw.match(/<!--\s*name:\s*(.+?)\s*-->/i);
        const name = m ? m[1].trim() : file.replace(/\.html$/i, '');
        // Strip the leading metadata comment block so the editor textarea is clean.
        const html = raw.replace(/^\s*(?:<!--[\s\S]*?-->\s*)+/, '').trim();
        out.push({ id: file.replace(/\.html$/i, ''), name, kind: 'custom', graphic: { html } });
      } else if (lower.endsWith('.json')) {
        const j = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        if (!j?.name || !j?.kind || !j?.graphic) continue;
        out.push({ id: file.replace(/\.json$/i, ''), name: j.name, kind: j.kind, graphic: j.graphic });
      }
    } catch (err) {
      console.error('[graphics-presets] failed to read', file, err.message);
    }
  }
  return out;
}
