import { getDb } from './schema.js';

export function list() {
  return getDb().prepare('SELECT * FROM services ORDER BY date DESC, id DESC').all();
}

// Resolve the parsed scripture passage on an item into display slides.
function resolveScripture(item) {
  try {
    const passage = JSON.parse(item.content);
    const vps = Math.max(1, passage.versesPerSlide || 1);
    const slides = [];
    for (let i = 0; i < passage.verses.length; i += vps) {
      const group = passage.verses.slice(i, i + vps);
      const first = group[0];
      const last = group[group.length - 1];
      const ref = group.length > 1
        ? `${passage.bookName} ${first.chapter}:${first.verse}-${last.verse}`
        : `${passage.bookName} ${first.chapter}:${first.verse}`;
      slides.push({
        id: `${item.id}-${i}`,
        type: ref,                              // shown as the slide label
        content: group.map((v) => v.text).join('\n'),
        copyright: `${ref} · ${passage.versionAbbrev}`,
        style_json: null,
      });
    }
    return { scripture: passage, scriptureSlides: slides, title: passage.reference };
  } catch {
    return null; // malformed passage JSON — leave unresolved
  }
}

// Resolve a list of service_items in bulk. Previously each item issued its own
// song / section / media queries (N+1); for a 20-item service that was 60+ round
// trips on every load. Here we fetch every referenced song, section and media
// asset in three IN(...) queries and stitch them together in memory.
function resolveItems(db, items) {
  if (!items.length) return [];

  const songIds   = [...new Set(items.filter((i) => i.item_type === 'song' && i.ref_id).map((i) => i.ref_id))];
  const mediaIds  = new Set();
  for (const i of items) {
    if (i.item_type === 'media' && i.ref_id) mediaIds.add(i.ref_id);
    if (i.background_override_id) mediaIds.add(i.background_override_id);
  }

  // Songs
  const songMap = new Map();
  if (songIds.length) {
    const ph = songIds.map(() => '?').join(',');
    for (const s of db.prepare(`SELECT id, title, author, copyright, default_background_id FROM songs WHERE id IN (${ph})`).all(...songIds)) {
      songMap.set(s.id, s);
      if (s.default_background_id) mediaIds.add(s.default_background_id);
    }
  }

  // Sections grouped by song
  const sectionsMap = new Map();
  if (songIds.length) {
    const ph = songIds.map(() => '?').join(',');
    for (const sec of db.prepare(`SELECT * FROM song_sections WHERE song_id IN (${ph}) ORDER BY song_id, order_index`).all(...songIds)) {
      if (!sectionsMap.has(sec.song_id)) sectionsMap.set(sec.song_id, []);
      sectionsMap.get(sec.song_id).push(sec);
    }
  }

  // Media assets (media items + background overrides + song default backgrounds)
  const mediaMap = new Map();
  if (mediaIds.size) {
    const ids = [...mediaIds];
    const ph = ids.map(() => '?').join(',');
    for (const a of db.prepare(`SELECT * FROM media_assets WHERE id IN (${ph})`).all(...ids)) {
      mediaMap.set(a.id, a);
    }
  }

  return items.map((item) => {
    const resolved = { ...item };
    if (item.item_type === 'song' && item.ref_id) {
      const song = songMap.get(item.ref_id);
      if (song) {
        resolved.song = { ...song };
        resolved.sections = sectionsMap.get(item.ref_id) || [];
        if (song.default_background_id) {
          const bg = mediaMap.get(song.default_background_id);
          if (bg) resolved.song.default_background = bg;
        }
      }
    }
    if (item.item_type === 'media' && item.ref_id) {
      resolved.asset = mediaMap.get(item.ref_id);
    }
    if (item.item_type === 'scripture' && item.content) {
      const sc = resolveScripture(item);
      if (sc) Object.assign(resolved, sc);
    }
    if (item.background_override_id) {
      resolved.background_override = mediaMap.get(item.background_override_id);
    }
    return resolved;
  });
}

export function getById(id) {
  const db = getDb();
  const service = db.prepare('SELECT * FROM services WHERE id=?').get(id);
  if (!service) return null;
  const items = db.prepare('SELECT * FROM service_items WHERE service_id=? ORDER BY order_index').all(id);
  service.items = resolveItems(db, items);
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

export function setItemLoop(itemId, loop) {
  getDb().prepare('UPDATE service_items SET media_loop=? WHERE id=?').run(loop ? 1 : 0, itemId);
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
