import { getDb } from './schema.js';

export function list() {
  return getDb().prepare('SELECT * FROM services ORDER BY date DESC, id DESC').all();
}

function resolveItem(db, item) {
  const resolved = { ...item };
  if (item.item_type === 'song' && item.ref_id) {
    const song = db.prepare('SELECT id, title, author, copyright, default_background_id FROM songs WHERE id=?').get(item.ref_id);
    if (song) {
      resolved.song = song;
      resolved.sections = db.prepare('SELECT * FROM song_sections WHERE song_id=? ORDER BY order_index').all(item.ref_id);
      if (song.default_background_id) {
        const bg = db.prepare('SELECT id, path, filename, type FROM media_assets WHERE id=?').get(song.default_background_id);
        if (bg) resolved.song.default_background = bg;
      }
    }
  }
  if (item.item_type === 'media' && item.ref_id) {
    resolved.asset = db.prepare('SELECT * FROM media_assets WHERE id=?').get(item.ref_id);
  }
  if (item.background_override_id) {
    resolved.background_override = db.prepare('SELECT * FROM media_assets WHERE id=?').get(item.background_override_id);
  }
  return resolved;
}

export function getById(id) {
  const db = getDb();
  const service = db.prepare('SELECT * FROM services WHERE id=?').get(id);
  if (!service) return null;
  service.items = db.prepare('SELECT * FROM service_items WHERE service_id=? ORDER BY order_index').all(id)
    .map((item) => resolveItem(db, item));
  return service;
}

export function create(data) {
  const { lastInsertRowid } = getDb().prepare('INSERT INTO services (title, date, notes) VALUES (?, ?, ?)')
    .run(data.title, data.date || null, data.notes || null);
  return Number(lastInsertRowid);
}

export function update(id, data) {
  getDb().prepare('UPDATE services SET title=?, date=?, notes=? WHERE id=?')
    .run(data.title, data.date || null, data.notes || null, id);
}

export function del(id) {
  getDb().prepare('DELETE FROM services WHERE id=?').run(id);
}

export function reorderItems(serviceId, orderedIds) {
  const db = getDb();
  db.transaction(() => {
    orderedIds.forEach((itemId, i) =>
      db.prepare('UPDATE service_items SET order_index=? WHERE id=? AND service_id=?').run(i, itemId, serviceId)
    );
  })();
}

export function addItem(serviceId, item) {
  const db = getDb();
  const { m } = db.prepare('SELECT COALESCE(MAX(order_index),-1) AS m FROM service_items WHERE service_id=?').get(serviceId);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO service_items (service_id, item_type, ref_id, order_index, notes, content, background_override_id)
    VALUES (?,?,?,?,?,?,?)
  `).run(serviceId, item.item_type, item.ref_id || null, m + 1, item.notes || null, item.content || null, item.background_override_id || null);
  return Number(lastInsertRowid);
}

export function removeItem(itemId) {
  getDb().prepare('DELETE FROM service_items WHERE id=?').run(itemId);
}

export function setItemBackground(itemId, mediaId) {
  getDb().prepare('UPDATE service_items SET background_override_id=? WHERE id=?').run(mediaId || null, itemId);
}

export function setItemNotes(itemId, notes) {
  getDb().prepare('UPDATE service_items SET notes=? WHERE id=?').run(notes || null, itemId);
}

export function duplicateItem(itemId) {
  const db = getDb();
  const item = db.prepare('SELECT * FROM service_items WHERE id=?').get(itemId);
  if (!item) return null;
  const { m } = db.prepare('SELECT COALESCE(MAX(order_index),-1) AS m FROM service_items WHERE service_id=?').get(item.service_id);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO service_items (service_id, item_type, ref_id, order_index, notes, content, background_override_id)
    VALUES (?,?,?,?,?,?,?)
  `).run(item.service_id, item.item_type, item.ref_id, m + 1, item.notes, item.content, item.background_override_id);
  return Number(lastInsertRowid);
}
