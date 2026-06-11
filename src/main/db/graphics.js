import { getDb } from './schema.js';

// Broadcast graphics — reusable, fully customisable lower-third name/title cards,
// tickers and custom HTML. Pure CRUD; these feed the independent overlay bus (see
// output/manager.js). style_json holds per-graphic appearance (fonts, colours,
// position box, bar); target is the saved default destination ('all'|'screen'|'ndi').

export function list() {
  return getDb()
    .prepare('SELECT * FROM graphics ORDER BY order_index, id')
    .all();
}

export function get(id) {
  return getDb().prepare('SELECT * FROM graphics WHERE id = ?').get(id);
}

export function create(data) {
  const db = getDb();
  const { kind, label, name, title, text, html, speed, style_json, target } = data;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM graphics').get().m;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO graphics (kind, label, name, title, text, html, speed, style_json, target, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      maxOrder + 1
    );
  return Number(lastInsertRowid);
}

export function update(id, data) {
  const { kind, label, name, title, text, html, speed, style_json, target } = data;
  getDb()
    .prepare(
      `UPDATE graphics SET kind=?, label=?, name=?, title=?, text=?, html=?, speed=?, style_json=?, target=?, updated_at=datetime('now') WHERE id=?`
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
