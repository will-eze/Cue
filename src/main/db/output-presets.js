import { getDb } from './schema.js';

// Output Presets — save & recall the OUTPUT RIG (channels on/off, display/NDI
// assignment, Stream Studio, background/stage config). A SEPARATE feature from Scenes
// (which recall the live LOOK). Pure CRUD over the `output_presets` table; the actual
// apply is renderer-orchestrated (OutputPresetsPanel replays the snapshot through the
// same window.cue.* IPC the settings UI uses), so there is no apply() here — unlike
// scenes. See the v30 migration comment in schema.js for the column shape.

export function list() {
  return getDb().prepare('SELECT * FROM output_presets ORDER BY order_index, id').all();
}

export function get(id) {
  return getDb().prepare('SELECT * FROM output_presets WHERE id = ?').get(id);
}

// `includes` — { channels, displaysNdi, stream, stageLayouts, backgrounds } booleans
// (which layers this preset manages; `stageLayouts`+`backgrounds` share the one
// `backgroundsStage` data blob). `data` — the captured snapshot; only ticked layers are
// populated. Both stored as JSON.
export function create(data) {
  const db = getDb();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM output_presets').get().m;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO output_presets (name, includes_json, data_json, order_index)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      (data.name || 'Output Preset').trim(),
      serialize(data.includes),
      serialize(data.data),
      maxOrder + 1,
    );
  return Number(lastInsertRowid);
}

export function update(id, data) {
  getDb()
    .prepare(
      `UPDATE output_presets SET name=?, includes_json=?, data_json=?, updated_at=datetime('now')
       WHERE id=?`,
    )
    .run(
      (data.name || 'Output Preset').trim(),
      serialize(data.includes),
      serialize(data.data),
      id,
    );
}

export function del(id) {
  getDb().prepare('DELETE FROM output_presets WHERE id = ?').run(id);
}

export function reorder(orderedIds) {
  const db = getDb();
  db.transaction(() => {
    orderedIds.forEach((id, i) => db.prepare('UPDATE output_presets SET order_index = ? WHERE id = ?').run(i, id));
  })();
}

function serialize(o) {
  if (o == null) return '{}';
  return typeof o === 'string' ? o : JSON.stringify(o);
}
