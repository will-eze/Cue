import { getDb } from './schema.js';
import { collectImageMediaIds } from './presentations.js';
import * as youtube from '../youtube/downloader.js';

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
        copyright: `${ref} (${passage.versionAbbrev})`,
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
  const presIds   = [...new Set(items.filter((i) => i.item_type === 'presentation' && i.ref_id).map((i) => i.ref_id))];
  const mediaIds  = new Set();
  for (const i of items) {
    if (i.item_type === 'media' && i.ref_id) mediaIds.add(i.ref_id);
    if (i.background_override_id) mediaIds.add(i.background_override_id);
  }

  // Presentations + their slides. Each slide's background_id and every image
  // element's mediaId join the shared media fetch below, so resolveItems stays a
  // fixed number of round trips regardless of slide count.
  const presMap = new Map();
  const slidesByPres = new Map();
  if (presIds.length) {
    const ph = presIds.map(() => '?').join(',');
    for (const p of db.prepare(`SELECT id, title FROM presentations WHERE id IN (${ph})`).all(...presIds)) {
      presMap.set(p.id, p);
    }
    for (const s of db.prepare(`SELECT * FROM presentation_slides WHERE presentation_id IN (${ph}) ORDER BY presentation_id, order_index`).all(...presIds)) {
      if (!slidesByPres.has(s.presentation_id)) slidesByPres.set(s.presentation_id, []);
      slidesByPres.get(s.presentation_id).push(s);
      if (s.background_id) mediaIds.add(s.background_id);
      for (const id of collectImageMediaIds(s.elements_json)) mediaIds.add(id);
    }
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

  // Tags grouped by song — surfaced on the rundown next to the item name.
  const tagsMap = new Map();
  if (songIds.length) {
    const ph = songIds.map(() => '?').join(',');
    for (const t of db.prepare(`
      SELECT tb.entity_id AS song_id, tg.id, tg.name, tg.colour
      FROM taggables tb JOIN tags tg ON tg.id = tb.tag_id
      WHERE tb.entity_type='song' AND tb.entity_id IN (${ph})
      ORDER BY tg.name COLLATE NOCASE
    `).all(...songIds)) {
      if (!tagsMap.has(t.song_id)) tagsMap.set(t.song_id, []);
      tagsMap.get(t.song_id).push({ id: t.id, name: t.name, colour: t.colour });
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
        resolved.song.tags = tagsMap.get(item.ref_id) || [];
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
    if (item.item_type === 'presentation' && item.ref_id) {
      const pres = presMap.get(item.ref_id);
      if (pres) {
        resolved.presentation = { ...pres };
        resolved.slides = (slidesByPres.get(item.ref_id) || []).map((s) => {
          const bg = s.background_id != null ? mediaMap.get(s.background_id) : null;
          let elements = [];
          try { elements = JSON.parse(s.elements_json) || []; } catch { elements = []; }
          // Resolve image element ids → paths for the renderer (output template
          // converts the path to cue-media:// itself).
          elements = elements.map((el) => {
            if (el && el.type === 'image' && el.mediaId != null) {
              const a = mediaMap.get(Number(el.mediaId));
              return { ...el, path: a?.path || null, mediaType: a?.type || 'image' };
            }
            return el;
          });
          return { id: s.id, label: s.label, background_id: s.background_id, background_path: bg?.path || null, elements };
        });
      }
    }
    if (item.item_type === 'scripture' && item.content) {
      const sc = resolveScripture(item);
      if (sc) Object.assign(resolved, sc);
    }
    if (item.item_type === 'youtube' && item.content) {
      // The URL lives in `content`; the downloaded file (if any) is tracked in
      // main's ephemeral cache. Status is also pushed live over 'youtube:status'.
      const url = item.content;
      const status = youtube.getStatus(url);
      resolved.youtube = status ? { ...status } : { url, status: 'idle', percent: 0, title: null, path: null };
      resolved.youtube.url = url;
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

// Append several items in one transaction with consecutive order_index values —
// used by the Paste Song List importer so a batch lands as one rundown edit
// (and never spawns a service per song, which a per-item loop over a stale
// activeServiceId would). Returns the new item ids in order.
export function addItems(serviceId, items) {
  const db = getDb();
  return db.transaction(() => {
    let { m } = db.prepare('SELECT COALESCE(MAX(order_index),-1) AS m FROM service_items WHERE service_id=?').get(serviceId);
    const insert = db.prepare(`
      INSERT INTO service_items (service_id, item_type, ref_id, order_index, notes, content, background_override_id)
      VALUES (?,?,?,?,?,?,?)
    `);
    const ids = [];
    for (const item of (items || [])) {
      m += 1;
      const { lastInsertRowid } = insert.run(
        serviceId, item.item_type, item.ref_id || null, m,
        item.notes || null, item.content || null, item.background_override_id || null,
      );
      ids.push(Number(lastInsertRowid));
    }
    return ids;
  })();
}

export function removeItem(itemId) {
  const db = getDb();
  // A removed YouTube cue abandons its ephemeral download + deletes the bytes.
  const row = db.prepare('SELECT item_type, content FROM service_items WHERE id=?').get(itemId);
  if (row?.item_type === 'youtube' && row.content) youtube.cancel(row.content);
  db.prepare('DELETE FROM service_items WHERE id=?').run(itemId);
}

export function clearItems(serviceId) {
  const db = getDb();
  for (const r of db.prepare(`SELECT content FROM service_items WHERE service_id=? AND item_type='youtube'`).all(serviceId)) {
    if (r.content) youtube.cancel(r.content);
  }
  db.prepare('DELETE FROM service_items WHERE service_id=?').run(serviceId);
}

// YouTube cues are single-use: their downloaded files are wiped on quit/startup, so
// the cues themselves must not survive a session either — otherwise a clip from last
// time reappears in the rundown on relaunch and starts re-downloading. Called once at
// startup (crash-safe), after the cache wipe.
export function purgeYoutubeItems() {
  getDb().prepare(`DELETE FROM service_items WHERE item_type='youtube'`).run();
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

// Auto-advance interval in seconds + loop mode. Falsy / <= 0 seconds clears the
// interval (stored NULL = manual). loop is 'item' or 'rundown' (default); wrap (only
// meaningful for 'rundown') wraps to the first item at the end vs stopping there.
export function setItemAdvance(itemId, seconds, loop, wrap = true) {
  const v = Number(seconds) > 0 ? Math.round(Number(seconds)) : null;
  const mode = loop === 'item' ? 'item' : 'rundown';
  getDb().prepare('UPDATE service_items SET advance_seconds=?, advance_loop=?, advance_wrap=? WHERE id=?')
    .run(v, v ? mode : null, wrap ? 1 : 0, itemId);
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
    INSERT INTO service_items (service_id, item_type, ref_id, order_index, notes, content, background_override_id, advance_seconds, advance_loop, advance_wrap)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(item.service_id, item.item_type, item.ref_id, m + 1, item.notes, item.content, item.background_override_id, item.advance_seconds ?? null, item.advance_loop ?? null, item.advance_wrap ?? 1);
  return Number(lastInsertRowid);
}
