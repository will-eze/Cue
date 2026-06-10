import { getDb } from './schema.js';

export function list() {
  return getDb().prepare('SELECT * FROM services ORDER BY date DESC, id DESC').all();
}

export function getById(id) {
  const db = getDb();
  const service = db.prepare('SELECT * FROM services WHERE id=?').get(id);
  if (!service) return null;

  const items = db.prepare('SELECT * FROM service_items WHERE service_id=? ORDER BY order_index').all(id);
  if (!items.length) { service.items = []; return service; }

  // Collect distinct IDs needed across all items in a single pass
  const songIds      = [...new Set(items.filter(i => i.item_type === 'song'  && i.ref_id).map(i => i.ref_id))];
  const overrideIds  = [...new Set(items.filter(i => i.background_override_id).map(i => i.background_override_id))];
  const mediaRefIds  = [...new Set(items.filter(i => i.item_type === 'media' && i.ref_id).map(i => i.ref_id))];

  // Batch-load songs and their sections (2 queries regardless of rundown size)
  const songMap = new Map();
  if (songIds.length) {
    const ph = songIds.map(() => '?').join(',');
    db.prepare(`SELECT id, title, author, copyright, default_background_id FROM songs WHERE id IN (${ph})`).all(...songIds)
      .forEach(s => songMap.set(s.id, { ...s, sections: [] }));
    db.prepare(`SELECT * FROM song_sections WHERE song_id IN (${ph}) ORDER BY order_index`).all(...songIds)
      .forEach(sec => { const s = songMap.get(sec.song_id); if (s) s.sections.push(sec); });
  }

  // Collect background IDs from songs and resolve all media in one query
  const songBgIds   = [...new Set([...songMap.values()].filter(s => s.default_background_id).map(s => s.default_background_id))];
  const allMediaIds = [...new Set([...overrideIds, ...mediaRefIds, ...songBgIds])];

  const mediaMap = new Map();
  if (allMediaIds.length) {
    const ph = allMediaIds.map(() => '?').join(',');
    db.prepare(`SELECT id, path, filename, type FROM media_assets WHERE id IN (${ph})`).all(...allMediaIds)
      .forEach(m => mediaMap.set(m.id, m));
  }

  // Attach backgrounds to songs using the media map
  for (const song of songMap.values()) {
    if (song.default_background_id) song.default_background = mediaMap.get(song.default_background_id) ?? null;
  }

  // Resolve each item from in-memory maps — no further DB queries
  service.items = items.map(item => {
    const resolved = { ...item };
    if (item.item_type === 'song' && item.ref_id) {
      const song = songMap.get(item.ref_id);
      if (song) { resolved.song = song; resolved.sections = song.sections; }
    }
    if (item.item_type === 'media' && item.ref_id) {
      resolved.asset = mediaMap.get(item.ref_id) ?? null;
    }
    if (item.background_override_id) {
      resolved.background_override = mediaMap.get(item.background_override_id) ?? null;
    }
    return resolved;
  });
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

export function clearItems(serviceId) {
  getDb().prepare('DELETE FROM service_items WHERE service_id=?').run(serviceId);
}

export function setItemBackground(itemId, mediaId) {
  const db = getDb();
  db.prepare('UPDATE service_items SET background_override_id=? WHERE id=?').run(mediaId || null, itemId);
  const item = db.prepare('SELECT item_type, ref_id FROM service_items WHERE id=?').get(itemId);
  if (item?.item_type === 'song' && item.ref_id) {
    db.prepare(`UPDATE songs SET default_background_id=?, updated_at=datetime('now') WHERE id=?`).run(mediaId || null, item.ref_id);
  }
}

export function setItemNotes(itemId, notes) {
  getDb().prepare('UPDATE service_items SET notes=? WHERE id=?').run(notes || null, itemId);
}

export function applyBackgroundToRundown(serviceId, mediaId) {
  const db = getDb();
  const songItems = db
    .prepare(`SELECT DISTINCT ref_id FROM service_items WHERE service_id=? AND item_type='song' AND ref_id IS NOT NULL`)
    .all(serviceId);

  if (!songItems.length) return 0;

  db.prepare(`UPDATE service_items SET background_override_id=? WHERE service_id=? AND item_type='song'`)
    .run(mediaId || null, serviceId);

  const updateSong = db.prepare(`UPDATE songs SET default_background_id=?, updated_at=datetime('now') WHERE id=?`);
  db.transaction(() => {
    songItems.forEach(({ ref_id }) => updateSong.run(mediaId || null, ref_id));
  })();

  return songItems.length;
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
