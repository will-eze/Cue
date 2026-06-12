import { getDb } from './schema.js';

// Presentations — native multi-element slides (a PowerPoint-style editor that
// drops into the rundown and inherits every existing control). A presentation is
// an ordered list of presentation_slides; each slide's `elements_json` is an array
// of positioned elements on the 1920×1080 canvas:
//
//   { id, type:'text'|'image'|'shape',
//     x, y, w, h,           // percent of the 1920×1080 canvas (same as textBox)
//     rotation, z, opacity,
//     // text:  text, style          (style = song_sections style_json shape, incl. runs)
//     // image: mediaId, fit:'cover'|'contain'   — store the ID, never a path (portable)
//     // shape: shape:'rect'|'ellipse'|'line', fill, stroke:{color,width}, radius }
//
// Image elements store a media id, NOT an absolute path — paths are resolved on
// read (resolveElements), so elements_json carries nothing machine-specific and
// survives backup/restore + data-folder moves untouched.

function parseElements(json) {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Every media id referenced by an image element on a slide/template. Used by
// db/media.js findUnused() (these ids live inside elements_json, not in an FK
// column, so they must be extracted explicitly) — and by resolveElements.
export function collectImageMediaIds(elementsJson) {
  const ids = [];
  for (const el of parseElements(elementsJson)) {
    if (el && el.type === 'image' && el.mediaId != null) ids.push(Number(el.mediaId));
  }
  return ids;
}

// Resolve each image element's mediaId → { path, type } using a pre-fetched map.
function resolveElements(elements, mediaMap) {
  return elements.map((el) => {
    if (el && el.type === 'image' && el.mediaId != null) {
      const asset = mediaMap.get(Number(el.mediaId));
      return { ...el, path: asset?.path || null, mediaType: asset?.type || 'image' };
    }
    return el;
  });
}

// Build a Map<mediaId, asset> covering every image element across a set of slide
// rows plus their background_ids, in one IN(...) query.
function fetchSlideMedia(db, slideRows) {
  const ids = new Set();
  for (const s of slideRows) {
    if (s.background_id != null) ids.add(Number(s.background_id));
    for (const id of collectImageMediaIds(s.elements_json)) ids.add(id);
  }
  const map = new Map();
  if (ids.size) {
    const arr = [...ids];
    const ph = arr.map(() => '?').join(',');
    for (const a of db.prepare(`SELECT * FROM media_assets WHERE id IN (${ph})`).all(...arr)) {
      map.set(a.id, a);
    }
  }
  return map;
}

export function list() {
  return getDb().prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM presentation_slides s WHERE s.presentation_id = p.id) AS slide_count
    FROM presentations p
    ORDER BY p.updated_at DESC, p.id DESC
  `).all();
}

export function get(id) {
  const db = getDb();
  const presentation = db.prepare('SELECT * FROM presentations WHERE id=?').get(id);
  if (!presentation) return null;
  const slideRows = db.prepare('SELECT * FROM presentation_slides WHERE presentation_id=? ORDER BY order_index').all(id);
  const mediaMap = fetchSlideMedia(db, slideRows);
  presentation.slides = slideRows.map((s) => {
    const bg = s.background_id != null ? mediaMap.get(Number(s.background_id)) : null;
    return {
      id: s.id,
      order_index: s.order_index,
      label: s.label,
      background_id: s.background_id,
      background_path: bg?.path || null,
      notes: s.notes,
      elements: resolveElements(parseElements(s.elements_json), mediaMap),
    };
  });
  return presentation;
}

function insertSlides(db, presentationId, slides) {
  const stmt = db.prepare(`
    INSERT INTO presentation_slides (presentation_id, order_index, label, background_id, elements_json, notes)
    VALUES (?,?,?,?,?,?)
  `);
  (slides || []).forEach((s, i) => {
    const elements = Array.isArray(s.elements) ? s.elements : [];
    stmt.run(
      presentationId,
      i,
      s.label || null,
      s.background_id || null,
      JSON.stringify(elements),
      s.notes || null
    );
  });
}

export function create(data) {
  const db = getDb();
  let id;
  db.transaction(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO presentations (title) VALUES (?)').run(data.title || 'Untitled Presentation');
    id = Number(lastInsertRowid);
    const slides = data.slides && data.slides.length ? data.slides : [{ label: null, elements: [] }];
    insertSlides(db, id, slides);
  })();
  return id;
}

export function update(id, data) {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE presentations SET title=?, updated_at=datetime('now') WHERE id=?`).run(data.title || 'Untitled Presentation', id);
    // Slides rebuild — replaces all existing (mirrors songs.update section rebuild).
    db.prepare('DELETE FROM presentation_slides WHERE presentation_id=?').run(id);
    insertSlides(db, id, data.slides || []);
  })();
}

export function del(id) {
  const db = getDb();
  // Remove the deck and any rundown items that reference it (no FK from
  // service_items.ref_id to presentations — same as songs.deleteAll).
  db.transaction(() => {
    db.prepare(`DELETE FROM service_items WHERE item_type='presentation' AND ref_id=?`).run(id);
    db.prepare('DELETE FROM presentations WHERE id=?').run(id);
  })();
}

export function reorderSlides(presentationId, orderedIds) {
  const db = getDb();
  db.transaction(() => {
    orderedIds.forEach((slideId, i) =>
      db.prepare('UPDATE presentation_slides SET order_index=? WHERE id=? AND presentation_id=?').run(i, slideId, presentationId)
    );
  })();
}

// ── Templates — reusable saved slide layouts ─────────────────────────────────

export function listTemplates() {
  return getDb().prepare('SELECT * FROM presentation_templates ORDER BY name COLLATE NOCASE').all();
}

export function getTemplate(id) {
  const db = getDb();
  const tpl = db.prepare('SELECT * FROM presentation_templates WHERE id=?').get(id);
  if (!tpl) return null;
  const mediaMap = fetchSlideMedia(db, [{ background_id: tpl.background_id, elements_json: tpl.elements_json }]);
  const bg = tpl.background_id != null ? mediaMap.get(Number(tpl.background_id)) : null;
  return {
    ...tpl,
    background_path: bg?.path || null,
    elements: resolveElements(parseElements(tpl.elements_json), mediaMap),
  };
}

export function createTemplate(data) {
  const elements = Array.isArray(data.elements) ? data.elements : [];
  const { lastInsertRowid } = getDb().prepare(`
    INSERT INTO presentation_templates (name, background_id, elements_json)
    VALUES (?,?,?)
  `).run(data.name || 'Untitled Layout', data.background_id || null, JSON.stringify(elements));
  return Number(lastInsertRowid);
}

export function delTemplate(id) {
  getDb().prepare('DELETE FROM presentation_templates WHERE id=?').run(id);
}
