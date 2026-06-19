import { getDb } from './schema.js';

// Scenes — one-press multi-output state recall (feature-roadmap #11). Pure CRUD over
// the `scenes` table; the actual apply (setting the live overlay bus + program mode +
// audio mute atomically) lives in output/manager.js applyScene. A scene row is a
// declarative snapshot of the service-independent output layers — see the v24 migration
// comment in schema.js for the column shape.

export function list() {
  return getDb().prepare('SELECT * FROM scenes ORDER BY order_index, id').all();
}

export function get(id) {
  return getDb().prepare('SELECT * FROM scenes WHERE id = ?').get(id);
}

// `program` ∈ none|content|clear|logo. `audio_muted` ∈ null|0|1 (null = don't touch).
// `hotkey` ∈ null|'1'..'9'. `overlay` is the snapshot object (or null = overlay not
// managed) — stored as JSON. A hotkey is unique: binding it to a scene frees it on any
// other scene so two scenes never fight over the same key.
export function create(data) {
  const db = getDb();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM scenes').get().m;
  const hotkey = normHotkey(data.hotkey);
  return db.transaction(() => {
    if (hotkey) db.prepare('UPDATE scenes SET hotkey = NULL WHERE hotkey = ?').run(hotkey);
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO scenes (name, hotkey, program, audio_muted, overlay_json, order_index)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        (data.name || 'Scene').trim(),
        hotkey,
        normProgram(data.program),
        normMuted(data.audio_muted),
        serializeOverlay(data.overlay),
        maxOrder + 1,
      );
    return Number(lastInsertRowid);
  })();
}

export function update(id, data) {
  const db = getDb();
  const hotkey = normHotkey(data.hotkey);
  db.transaction(() => {
    if (hotkey) db.prepare('UPDATE scenes SET hotkey = NULL WHERE hotkey = ? AND id != ?').run(hotkey, id);
    db.prepare(
      `UPDATE scenes SET name=?, hotkey=?, program=?, audio_muted=?, overlay_json=?, updated_at=datetime('now')
       WHERE id=?`,
    ).run(
      (data.name || 'Scene').trim(),
      hotkey,
      normProgram(data.program),
      normMuted(data.audio_muted),
      serializeOverlay(data.overlay),
      id,
    );
  })();
}

export function del(id) {
  getDb().prepare('DELETE FROM scenes WHERE id = ?').run(id);
}

export function reorder(orderedIds) {
  const db = getDb();
  db.transaction(() => {
    orderedIds.forEach((id, i) => db.prepare('UPDATE scenes SET order_index = ? WHERE id = ?').run(i, id));
  })();
}

// Normalise a scene (DB row OR a live-preview object the renderer assembled) into the
// shape output/manager.js applyScene consumes: { overlay, program, audioMuted }.
export function normalizeScene(s) {
  if (!s) return null;
  let overlay = null;
  if (s.overlay !== undefined) overlay = s.overlay;
  else if (s.overlay_json) { try { overlay = JSON.parse(s.overlay_json); } catch { overlay = null; } }
  let audioMuted = null;
  if (s.audioMuted !== undefined) audioMuted = s.audioMuted;
  else if (s.audio_muted != null) audioMuted = !!s.audio_muted;
  return { overlay, program: normProgram(s.program), audioMuted };
}

const PROGRAM_VALUES = new Set(['none', 'content', 'clear', 'logo']);
function normProgram(p) { return PROGRAM_VALUES.has(p) ? p : 'none'; }
function normMuted(m) { return m == null ? null : (m ? 1 : 0); }
function normHotkey(k) { return /^[1-9]$/.test(String(k ?? '')) ? String(k) : null; }
function serializeOverlay(o) {
  if (o == null) return null;
  return typeof o === 'string' ? o : JSON.stringify(o);
}
