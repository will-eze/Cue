import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db;

export function getDb() {
  return db;
}

const migrations = [
  function v1(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author TEXT,
        copyright TEXT,
        default_background_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
        created_at DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS song_sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('verse','chorus','bridge','pre-chorus','tag','intro','outro')),
        order_index INTEGER NOT NULL,
        content TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
        title, author, content,
        content='', contentless_delete=1
      );

      CREATE TRIGGER IF NOT EXISTS songs_fts_insert AFTER INSERT ON song_sections BEGIN
        INSERT INTO songs_fts(rowid, title, author, content)
        SELECT NEW.id, s.title, s.author, NEW.content
        FROM songs s WHERE s.id = NEW.song_id;
      END;

      CREATE TRIGGER IF NOT EXISTS songs_fts_update AFTER UPDATE ON song_sections BEGIN
        INSERT INTO songs_fts(songs_fts, rowid, title, author, content)
        VALUES('delete', OLD.id, '', '', '');
        INSERT INTO songs_fts(rowid, title, author, content)
        SELECT NEW.id, s.title, s.author, NEW.content
        FROM songs s WHERE s.id = NEW.song_id;
      END;

      CREATE TRIGGER IF NOT EXISTS songs_fts_delete AFTER DELETE ON song_sections BEGIN
        INSERT INTO songs_fts(songs_fts, rowid, title, author, content)
        VALUES('delete', OLD.id, '', '', '');
      END;

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        colour TEXT
      );

      CREATE TABLE IF NOT EXISTS taggables (
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        UNIQUE(tag_id, entity_type, entity_id)
      );

      CREATE TABLE IF NOT EXISTS media_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER REFERENCES media_folders(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS media_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK(type IN ('image','video','audio')),
        folder_id INTEGER REFERENCES media_folders(id) ON DELETE SET NULL,
        duration_ms INTEGER,
        created_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        date DATE,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS service_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL CHECK(item_type IN ('song','media','slide')),
        ref_id INTEGER,
        order_index INTEGER NOT NULL,
        notes TEXT,
        content TEXT,
        background_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS output_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('screen','ndi')),
        display_index INTEGER,
        display_bounds TEXT,
        linked_channel_id INTEGER REFERENCES output_channels(id) ON DELETE SET NULL,
        template TEXT NOT NULL DEFAULT 'fullscreen' CHECK(template IN ('fullscreen','lowerthird')),
        ndi_fps INTEGER DEFAULT 30,
        ndi_width INTEGER DEFAULT 1920,
        ndi_height INTEGER DEFAULT 1080,
        logo_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  },

  // v2 — add style_json column and expand type CHECK to include 'refrain'.
  function v2(database) {
    database.exec(`
      CREATE TABLE song_sections_v2 (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id      INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
        type         TEXT    NOT NULL CHECK(type IN (
                       'verse','chorus','refrain','bridge',
                       'pre-chorus','tag','intro','outro'
                     )),
        order_index  INTEGER NOT NULL,
        content      TEXT    NOT NULL,
        style_json   TEXT
      );

      INSERT INTO song_sections_v2 (id, song_id, type, order_index, content)
      SELECT id, song_id, type, order_index, content FROM song_sections;

      DROP TABLE song_sections;

      ALTER TABLE song_sections_v2 RENAME TO song_sections;

      CREATE TRIGGER songs_fts_insert AFTER INSERT ON song_sections BEGIN
        INSERT INTO songs_fts(rowid, title, author, content)
        SELECT NEW.id, s.title, s.author, NEW.content
        FROM songs s WHERE s.id = NEW.song_id;
      END;

      CREATE TRIGGER songs_fts_update AFTER UPDATE ON song_sections BEGIN
        INSERT INTO songs_fts(songs_fts, rowid, title, author, content)
        VALUES('delete', OLD.id, '', '', '');
        INSERT INTO songs_fts(rowid, title, author, content)
        SELECT NEW.id, s.title, s.author, NEW.content
        FROM songs s WHERE s.id = NEW.song_id;
      END;

      CREATE TRIGGER songs_fts_delete AFTER DELETE ON song_sections BEGIN
        INSERT INTO songs_fts(songs_fts, rowid, title, author, content)
        VALUES('delete', OLD.id, '', '', '');
      END;
    `);
  },
  // v3 — Replace contentless_delete=1 FTS table with plain contentless FTS.
  // SQLite 3.49 (bundled with Electron 30) rejects the special 'delete' INSERT
  // command on contentless_delete=1 tables when empty-string column values are
  // provided. Removing contentless_delete=1 restores the prior behaviour where
  // the trigger fires without error. The FTS index is rebuilt from live data.
  function v3(database) {
    database.exec(`
      DROP TABLE IF EXISTS songs_fts;

      CREATE VIRTUAL TABLE songs_fts USING fts5(
        title, author, content,
        content=''
      );

      INSERT INTO songs_fts(rowid, title, author, content)
        SELECT ss.id, s.title, s.author, ss.content
        FROM song_sections ss
        JOIN songs s ON s.id = ss.song_id;
    `);
  },

  // v4 — Separate channels (content streams) from monitors (physical screens).
  // channel_monitors holds display_bounds per physical screen assigned to a channel.
  // Multiple monitors can share one channel and all update simultaneously on GO.
  // Existing display_bounds on output_channels are migrated to channel_monitors.
  function v4(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS channel_monitors (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id     INTEGER NOT NULL REFERENCES output_channels(id) ON DELETE CASCADE,
        display_bounds TEXT    NOT NULL,
        label          TEXT,
        active         INTEGER NOT NULL DEFAULT 1
      );

      INSERT INTO channel_monitors (channel_id, display_bounds, active)
      SELECT id, display_bounds, 1
      FROM output_channels
      WHERE display_bounds IS NOT NULL AND type = 'screen';
    `);
  },

  // v5 — Add indices on FK and filter columns to eliminate full table scans.
  function v5(database) {
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_song_sections_song_id    ON song_sections(song_id);
      CREATE INDEX IF NOT EXISTS idx_service_items_service_id ON service_items(service_id);
      CREATE INDEX IF NOT EXISTS idx_taggables_entity         ON taggables(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_channel_monitors_channel ON channel_monitors(channel_id);
      CREATE INDEX IF NOT EXISTS idx_media_assets_folder      ON media_assets(folder_id);
    `);
  },
];

function runMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS db_version (version INTEGER NOT NULL)`);
  const row = db.prepare('SELECT version FROM db_version').get();
  const currentVersion = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO db_version (version) VALUES (0)').run();

  const pending = migrations.slice(currentVersion);
  if (!pending.length) return;

  db.transaction(() => {
    pending.forEach((migration, i) => {
      migration(db);
      db.prepare('UPDATE db_version SET version = ?').run(currentVersion + i + 1);
    });
  })();
}

export function initDb() {
  const dbPath = path.join(app.getPath('userData'), 'cue.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations();
  return db;
}
