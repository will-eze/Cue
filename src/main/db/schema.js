import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db;

export function getDb() {
  return db;
}

// Closes the live connection (checkpoints WAL on close). Used by backup/restore
// to release the cue.db file handle before the file is swapped on disk.
export function closeDb() {
  if (db) {
    try { db.close(); } catch {}
    db = null;
  }
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

  // v6 — Allow the 'stage' template (stage / confidence display) on output_channels.
  // SQLite can't ALTER a CHECK constraint, so the table is rebuilt. channel_monitors
  // references output_channels with ON DELETE CASCADE; runMigrations disables foreign
  // keys around the transaction so DROP TABLE does not cascade-delete monitor rows.
  function v6(database) {
    database.exec(`
      CREATE TABLE output_channels_v6 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('screen','ndi')),
        display_index INTEGER,
        display_bounds TEXT,
        linked_channel_id INTEGER REFERENCES output_channels(id) ON DELETE SET NULL,
        template TEXT NOT NULL DEFAULT 'fullscreen' CHECK(template IN ('fullscreen','lowerthird','stage')),
        ndi_fps INTEGER DEFAULT 30,
        ndi_width INTEGER DEFAULT 1920,
        ndi_height INTEGER DEFAULT 1080,
        logo_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
        active INTEGER NOT NULL DEFAULT 1
      );

      INSERT INTO output_channels_v6
        (id, name, type, display_index, display_bounds, linked_channel_id,
         template, ndi_fps, ndi_width, ndi_height, logo_override_id, active)
      SELECT id, name, type, display_index, display_bounds, linked_channel_id,
         template, ndi_fps, ndi_width, ndi_height, logo_override_id, active
      FROM output_channels;

      DROP TABLE output_channels;
      ALTER TABLE output_channels_v6 RENAME TO output_channels;
    `);
  },

  // v7 — Scripture (Bible) module. Adds bible_versions + bible_verses (+ FTS),
  // and expands service_items.item_type to allow 'scripture'. The service_items
  // CHECK constraint can't be altered in place, so the table is rebuilt (FK off
  // during migrations prevents the services ON DELETE CASCADE from firing).
  function v7(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS bible_versions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        abbrev     TEXT NOT NULL,
        language   TEXT,
        created_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS bible_verses (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL REFERENCES bible_versions(id) ON DELETE CASCADE,
        book_num   INTEGER NOT NULL,
        book_name  TEXT NOT NULL,
        chapter    INTEGER NOT NULL,
        verse      INTEGER NOT NULL,
        text       TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_bible_verses_ref
        ON bible_verses(version_id, book_num, chapter, verse);

      CREATE VIRTUAL TABLE IF NOT EXISTS bible_verses_fts USING fts5(
        book_name, text, content=''
      );

      CREATE TABLE service_items_v7 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL CHECK(item_type IN ('song','media','slide','scripture')),
        ref_id INTEGER,
        order_index INTEGER NOT NULL,
        notes TEXT,
        content TEXT,
        background_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL
      );

      INSERT INTO service_items_v7
        (id, service_id, item_type, ref_id, order_index, notes, content, background_override_id)
      SELECT id, service_id, item_type, ref_id, order_index, notes, content, background_override_id
      FROM service_items;

      DROP TABLE service_items;
      ALTER TABLE service_items_v7 RENAME TO service_items;

      CREATE INDEX IF NOT EXISTS idx_service_items_service_id ON service_items(service_id);
    `);
  },

  // v8 — Add media_loop flag to service_items for looping video/audio playback.
  function v8(database) {
    database.exec(`
      ALTER TABLE service_items ADD COLUMN media_loop INTEGER NOT NULL DEFAULT 0;
    `);
  },

  // v9 — Per-NDI-channel audio mute flag. Default 1 (muted) prevents doubled
  // audio when a screen output and NDI output play the same media simultaneously.
  // Users who route NDI audio to a broadcast system can disable this per-channel.
  function v9(database) {
    database.exec(`
      ALTER TABLE output_channels ADD COLUMN ndi_audio_muted INTEGER NOT NULL DEFAULT 1;
    `);
  },

  // v10 — Broadcast graphics: reusable lower-third name/title cards and ticker
  // presets. These drive the independent overlay bus (graphic:update), separate
  // from the program slide bus, so a graphic never clobbers the live program.
  function v10(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS graphics (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT NOT NULL CHECK(kind IN ('lower_third','ticker')),
        label       TEXT,
        name        TEXT,
        title       TEXT,
        text        TEXT,
        speed       INTEGER NOT NULL DEFAULT 100,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at  DATETIME NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },

  // v11 — Custom HTML graphics. Adds the 'custom' kind + an html column (an HTML
  // snippet with inline <style>, supporting {{name}}/{{title}}/{{text}} placeholders
  // and CSS enter/exit animations). CHECK can't be altered in place, so rebuild.
  function v11(database) {
    database.exec(`
      CREATE TABLE graphics_v11 (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT NOT NULL CHECK(kind IN ('lower_third','ticker','custom')),
        label       TEXT,
        name        TEXT,
        title       TEXT,
        text        TEXT,
        html        TEXT,
        speed       INTEGER NOT NULL DEFAULT 100,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at  DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO graphics_v11
        (id, kind, label, name, title, text, speed, order_index, created_at, updated_at)
      SELECT id, kind, label, name, title, text, speed, order_index, created_at, updated_at
      FROM graphics;

      DROP TABLE graphics;
      ALTER TABLE graphics_v11 RENAME TO graphics;
    `);
  },

  // v12 — Customisable graphics. style_json holds per-graphic appearance (name/title
  // text styling, draggable/resizable position box, bar background, ticker styling +
  // position) authored in GraphicsEditor. target is the saved default destination
  // ('all' | 'screen' | 'ndi') so an operator can route in-room vs online; it can be
  // overridden per-fire from the panel.
  function v12(database) {
    database.exec(`
      ALTER TABLE graphics ADD COLUMN style_json TEXT;
      ALTER TABLE graphics ADD COLUMN target TEXT NOT NULL DEFAULT 'all';
    `);
  },

  // v13 — show_program lets a lower-third channel be graphics-only. When 0, the
  // channel ignores the program slide text (no lyric band), so a dedicated
  // broadcast-graphics channel (name supers / tickers) doesn't collide with the
  // song lower-third. Default 1 preserves the existing "lyrics as a lower third".
  function v13(database) {
    database.exec(`
      ALTER TABLE output_channels ADD COLUMN show_program INTEGER NOT NULL DEFAULT 1;
    `);
  },

  // v14 — show_graphics pairs with show_program to give a lower-third channel three
  // content modes: Lyrics + Graphics (1/1), Lyrics Only (1/0), Graphics Only (0/1).
  // When 0 the broadcast-graphics overlay is suppressed on that channel.
  function v14(database) {
    database.exec(`
      ALTER TABLE output_channels ADD COLUMN show_graphics INTEGER NOT NULL DEFAULT 1;
    `);
  },

  // v15 — Theme / template library. A theme is a named style_json snapshot
  // (font, colour, shadow, textBox, ltBar) plus an optional default background.
  // Applied to song sections via the settings panel or the song editor.
  function v15(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS themes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        style_json    TEXT,
        background_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
        created_at    DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at    DATETIME NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },

  // v16 — Countdown / clock graphics. Adds the 'countdown' kind: a self-ticking
  // timer rendered in the output template (pre-roll "Service starts in 5:00"
  // countdown, count-up stopwatch, or a live time-of-day clock). The mode +
  // duration/target/format config lives in style_json (see GraphicsEditor); the
  // `text` column holds the optional label ("Service starts in"). CHECK can't be
  // altered in place, so rebuild the table (same pattern as v11).
  function v16(database) {
    database.exec(`
      CREATE TABLE graphics_v16 (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT NOT NULL CHECK(kind IN ('lower_third','ticker','custom','countdown')),
        label       TEXT,
        name        TEXT,
        title       TEXT,
        text        TEXT,
        html        TEXT,
        speed       INTEGER NOT NULL DEFAULT 100,
        style_json  TEXT,
        target      TEXT NOT NULL DEFAULT 'all',
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at  DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO graphics_v16
        (id, kind, label, name, title, text, html, speed, style_json, target, order_index, created_at, updated_at)
      SELECT id, kind, label, name, title, text, html, speed, style_json, target, order_index, created_at, updated_at
      FROM graphics;

      DROP TABLE graphics;
      ALTER TABLE graphics_v16 RENAME TO graphics;
    `);
  },

  // v17 — Auto-advance / timed loops. advance_seconds on a service_item: when that
  // item is live and the value is set (> 0), OperatorView schedules the next slide/
  // item after that many seconds, rolling into the next rundown item at a boundary
  // and wrapping back to the first item at the end (unattended pre-roll loop). NULL
  // (the default) means manual advance only. Scheduling lives in the renderer — live
  // state is owned by OperatorView, never the main process.
  function v17(database) {
    database.exec(`
      ALTER TABLE service_items ADD COLUMN advance_seconds INTEGER;
    `);
  },

  // v18 — Auto-advance loop mode. advance_loop controls what happens when the timer
  // reaches the item's last slide: 'rundown' (default / NULL) rolls into the next
  // rundown item and wraps to the top at the end; 'item' bounces back to this item's
  // first slide and rotates within it forever (a single self-contained announcement
  // loop). Read by OperatorView.handleAutoAdvance.
  function v18(database) {
    database.exec(`
      ALTER TABLE service_items ADD COLUMN advance_loop TEXT;
    `);
  },

  // v19 — Wrap toggle for the 'rundown' auto-advance mode. advance_wrap=1 (default)
  // wraps back to the first rundown item after the last item's final slide; 0 stops
  // there (one unattended pass). Only consulted when advance_loop is 'rundown'.
  function v19(database) {
    database.exec(`
      ALTER TABLE service_items ADD COLUMN advance_wrap INTEGER NOT NULL DEFAULT 1;
    `);
  },

  // v20 — Presentations (native multi-element slides + PowerPoint import). A
  // presentation is an ordered list of slides; each slide is a free-form canvas of
  // positioned elements (text boxes, images, shapes) stored as elements_json (see
  // db/presentations.js for the element shape). presentation_templates are reusable
  // saved slide layouts. service_items.item_type gains 'presentation' so a deck
  // drops into the rundown and inherits every existing control — the CHECK can't be
  // altered in place, so the table is rebuilt (same pattern as v7, carrying every
  // column added since: media_loop/advance_*). FK off during migrations stops the
  // services ON DELETE CASCADE from firing on the DROP.
  function v20(database) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS presentations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS presentation_slides (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        presentation_id INTEGER NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
        order_index     INTEGER NOT NULL,
        label           TEXT,
        background_id   INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
        elements_json   TEXT,
        notes           TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_presentation_slides_presentation
        ON presentation_slides(presentation_id);

      CREATE TABLE IF NOT EXISTS presentation_templates (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        background_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
        elements_json TEXT,
        created_at    DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at    DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE service_items_v20 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL CHECK(item_type IN ('song','media','slide','scripture','presentation')),
        ref_id INTEGER,
        order_index INTEGER NOT NULL,
        notes TEXT,
        content TEXT,
        background_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
        media_loop INTEGER NOT NULL DEFAULT 0,
        advance_seconds INTEGER,
        advance_loop TEXT,
        advance_wrap INTEGER NOT NULL DEFAULT 1
      );

      INSERT INTO service_items_v20
        (id, service_id, item_type, ref_id, order_index, notes, content, background_override_id,
         media_loop, advance_seconds, advance_loop, advance_wrap)
      SELECT id, service_id, item_type, ref_id, order_index, notes, content, background_override_id,
             media_loop, advance_seconds, advance_loop, advance_wrap
      FROM service_items;

      DROP TABLE service_items;
      ALTER TABLE service_items_v20 RENAME TO service_items;

      CREATE INDEX IF NOT EXISTS idx_service_items_service_id ON service_items(service_id);
    `);
  },

  // v21 — Native YouTube player. service_items.item_type gains 'youtube': the cue
  // stores the YouTube URL in `content` (ref_id stays NULL — it is NOT a
  // media_assets row). The downloaded file is ephemeral, tracked in-memory by
  // src/main/youtube and wiped on quit, so it never persists in the DB or backups.
  // CHECK can't be altered in place, so the table is rebuilt (same pattern as v20,
  // carrying every column). FK off during migrations stops the services ON DELETE
  // CASCADE from firing on the DROP.
  function v21(database) {
    database.exec(`
      CREATE TABLE service_items_v21 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL CHECK(item_type IN ('song','media','slide','scripture','presentation','youtube')),
        ref_id INTEGER,
        order_index INTEGER NOT NULL,
        notes TEXT,
        content TEXT,
        background_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
        media_loop INTEGER NOT NULL DEFAULT 0,
        advance_seconds INTEGER,
        advance_loop TEXT,
        advance_wrap INTEGER NOT NULL DEFAULT 1
      );

      INSERT INTO service_items_v21
        (id, service_id, item_type, ref_id, order_index, notes, content, background_override_id,
         media_loop, advance_seconds, advance_loop, advance_wrap)
      SELECT id, service_id, item_type, ref_id, order_index, notes, content, background_override_id,
             media_loop, advance_seconds, advance_loop, advance_wrap
      FROM service_items;

      DROP TABLE service_items;
      ALTER TABLE service_items_v21 RENAME TO service_items;

      CREATE INDEX IF NOT EXISTS idx_service_items_service_id ON service_items(service_id);
    `);
  },

  // v22 — Theme packs. Extends the themes table so bundled (built-in) themes can
  // be seeded, filtered by content type, and ordered in the picker:
  //   builtin    — 1 for seeded themes (protected from edit/delete in the UI,
  //                 re-seedable, excluded from "delete all user themes" flows).
  //   category   — which content surface the theme is meant for: 'song'
  //                 (default), 'scripture', 'graphic', 'presentation'. Phase 1a
  //                 ships 'song' themes only; the column lets the pickers filter.
  //   sort_order — display order within a category (built-ins ordered; user
  //                 themes default 0 and fall back to name).
  // The CSS gradient/solid background a built-in theme carries lives inside
  // style_json as `bgCss` (see §8) — no extra column, it rides the existing
  // applyTo* merge into song_sections.style_json.
  function v22(database) {
    database.exec(`
      ALTER TABLE themes ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE themes ADD COLUMN category TEXT NOT NULL DEFAULT 'song';
      ALTER TABLE themes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
    `);
  },

  // v23 — Repair songs_fts and stop it silently corrupting itself.
  // v3 recreated songs_fts as a plain contentless table (content='') but kept
  // triggers that issue the FTS5 'delete' command with EMPTY-STRING column
  // values. On a contentless table without contentless_delete, 'delete' must be
  // given the original indexed values so FTS5 knows which tokens to remove —
  // empty strings remove nothing, so every section edit/delete orphaned the old
  // tokens. The inverted index eventually decoded to bogus rowids and a
  // MATCH-inside-a-JOIN (exactly what songs.search() runs) threw "database disk
  // image is malformed", so song search returned no results. The runtime SQLite
  // (3.49) supports contentless_delete=1, whose documented delete idiom is a
  // plain `DELETE FROM songs_fts WHERE rowid=?`. Recreate the table with that
  // option, rebuild the index from live data, and replace the triggers.
  function v23(database) {
    database.exec(`
      DROP TRIGGER IF EXISTS songs_fts_insert;
      DROP TRIGGER IF EXISTS songs_fts_update;
      DROP TRIGGER IF EXISTS songs_fts_delete;
      DROP TABLE IF EXISTS songs_fts;

      CREATE VIRTUAL TABLE songs_fts USING fts5(
        title, author, content,
        content='', contentless_delete=1
      );

      INSERT INTO songs_fts(rowid, title, author, content)
        SELECT ss.id, s.title, s.author, ss.content
        FROM song_sections ss
        JOIN songs s ON s.id = ss.song_id;

      CREATE TRIGGER songs_fts_insert AFTER INSERT ON song_sections BEGIN
        INSERT INTO songs_fts(rowid, title, author, content)
        SELECT NEW.id, s.title, s.author, NEW.content
        FROM songs s WHERE s.id = NEW.song_id;
      END;

      CREATE TRIGGER songs_fts_update AFTER UPDATE ON song_sections BEGIN
        DELETE FROM songs_fts WHERE rowid = OLD.id;
        INSERT INTO songs_fts(rowid, title, author, content)
        SELECT NEW.id, s.title, s.author, NEW.content
        FROM songs s WHERE s.id = NEW.song_id;
      END;

      CREATE TRIGGER songs_fts_delete AFTER DELETE ON song_sections BEGIN
        DELETE FROM songs_fts WHERE rowid = OLD.id;
      END;
    `);
  },

  // v24 — Scenes: one-press multi-output state recall (feature-roadmap #11).
  // A scene is a DECLARATIVE snapshot of the service-independent output layers, NOT
  // a reference to a rundown slide (so it survives weekly service changes):
  //   program     — what the program layer should do: 'none' (leave as-is) | 'content'
  //                 (show the live slide / logo off) | 'clear' (blank text, keep bg) |
  //                 'logo' (show the logo bug). Applied via deterministic setters in
  //                 output/manager.js applyScene, so re-applying is idempotent.
  //   audio_muted — program (audience) audio: NULL = don't touch, 0 = unmute, 1 = mute.
  //   overlay_json— the broadcast-graphics overlay snapshot, captured verbatim from the
  //                 live bus as { nameTitle, ticker, custom, countdown }, each a per-kind
  //                 { screen, ndi } slot of self-contained re-fire data. NULL = the scene
  //                 doesn't manage the overlay (leaves graphics untouched). An all-empty
  //                 snapshot = a "hide all graphics" / to-break scene.
  //   hotkey      — optional number key ('1'..'9') for instant recall in OperatorView.
  // No media-asset FKs: overlay slots hold resolved style objects (not media ids) and
  // logo/background resolve from settings at apply time — so scenes need no
  // media.findUnused() entry and ride backups with no path rewriting.
  function v24(database) {
    database.exec(`
      CREATE TABLE scenes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        hotkey TEXT,
        program TEXT NOT NULL DEFAULT 'none',
        audio_muted INTEGER,
        overlay_json TEXT,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },

  // v25 — Per-song background lock. The background a slide shows is resolved by a
  // single, flat cascade (see OperatorView.resolveBackground / output/manager.js):
  //   lock → per-slot override → song's own default → live global default → black.
  // `background_locked` is the top of that cascade: when 1, the song's own
  // default_background_id is pinned and NOTHING below can change it — a slot
  // override is ignored, the live global default is ignored, and the two bulk
  // "apply background" actions (settings.applyBackgroundToAll /
  // services.applyBackgroundToRundown) skip the song entirely. It's a protect+pin
  // flag, not a media reference, so it needs no media.findUnused() entry.
  function v25(database) {
    database.exec(`
      ALTER TABLE songs ADD COLUMN background_locked INTEGER NOT NULL DEFAULT 0;
    `);
  },

  // v26 — Make song search apostrophe-insensitive so missing punctuation never harms
  // results. The default unicode61 tokenizer splits an apostrophe, so "God's" indexes
  // as the two tokens "god" + "s" and a query for "Gods" (token "gods") never matches
  // it. Normalizing only the query can't fix that — the INDEX has to lose the
  // apostrophe too. So we STRIP apostrophes (straight ', curly ' ', modifier ʼ — by
  // codepoint via char() to keep this file ASCII) from title/author/content as they
  // enter songs_fts, then reindex existing rows. The query side strips the same set
  // (songs.js search() + _norm), so both collapse "God's" → "gods" and line up.
  // Hyphens/other punctuation are already word separators on both sides, so they
  // need no special handling — only apostrophes join letters inside a word.
  function v26(database) {
    const strip = (c) =>
      `replace(replace(replace(replace(${c},char(39),''),char(8217),''),char(8216),''),char(700),'')`;
    database.exec(`
      DROP TRIGGER IF EXISTS songs_fts_insert;
      DROP TRIGGER IF EXISTS songs_fts_update;
      DROP TRIGGER IF EXISTS songs_fts_delete;

      INSERT INTO songs_fts(songs_fts) VALUES('delete-all');
      INSERT INTO songs_fts(rowid, title, author, content)
        SELECT ss.id, ${strip('s.title')}, ${strip('s.author')}, ${strip('ss.content')}
        FROM song_sections ss JOIN songs s ON s.id = ss.song_id;

      CREATE TRIGGER songs_fts_insert AFTER INSERT ON song_sections BEGIN
        INSERT INTO songs_fts(rowid, title, author, content)
        SELECT NEW.id, ${strip('s.title')}, ${strip('s.author')}, ${strip('NEW.content')}
        FROM songs s WHERE s.id = NEW.song_id;
      END;

      CREATE TRIGGER songs_fts_update AFTER UPDATE ON song_sections BEGIN
        DELETE FROM songs_fts WHERE rowid = OLD.id;
        INSERT INTO songs_fts(rowid, title, author, content)
        SELECT NEW.id, ${strip('s.title')}, ${strip('s.author')}, ${strip('NEW.content')}
        FROM songs s WHERE s.id = NEW.song_id;
      END;

      CREATE TRIGGER songs_fts_delete AFTER DELETE ON song_sections BEGIN
        DELETE FROM songs_fts WHERE rowid = OLD.id;
      END;
    `);
  },

  // v27 — Customisable WYSIWYG stage display. A stage/confidence channel's layout is
  // now a free-form set of positioned elements (current text, next text, clock, timer,
  // elapsed timer, video countdown, message, static text) instead of the old fixed
  // skeleton. The layout is stored PER CHANNEL as a JSON document; NULL means "use the
  // built-in default layout" (an inset, guttered arrangement of the classic elements).
  // Reusable named layouts live in the `stage_presets` setting (a plain ALTER, no table
  // rebuild needed).
  function v27(database) {
    database.exec(`
      ALTER TABLE output_channels ADD COLUMN stage_layout_json TEXT;
    `);
  },

  // v28 — Background media on broadcast graphics. An optional full-screen
  // video/image rendered behind the overlay text (e.g. countdown + video background).
  // NULL = no background (the overlay is transparent as before). ON DELETE SET NULL
  // so deleting a media asset clears the reference without removing the graphic.
  function v28(database) {
    database.exec(`
      ALTER TABLE graphics ADD COLUMN background_media_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL;
    `);
  },

  // v29 — File size stored on import so the media grid can show it without an fs.stat.
  function v29(database) {
    database.exec(`ALTER TABLE media_assets ADD COLUMN size_bytes INTEGER;`);
  },

  // v30 — Output Presets: save & recall the OUTPUT RIG (which is separate from Scenes,
  // which recall the live LOOK — graphics overlay + program + audio). An output preset
  // is a DECLARATIVE snapshot of output-channel configuration for one-tap re-rigging
  // (e.g. flip a "Rehearsal" rig to a "Live Broadcast" rig, or reset outputs):
  //   includes_json — which layers this preset manages, as booleans
  //                   { channels, displaysNdi, stream, stageLayouts, backgrounds }. A
  //                   layer that is false is left untouched on recall (like scenes' NULL
  //                   overlay). `stageLayouts` and `backgrounds` are separate toggles but
  //                   share the one `backgroundsStage` data blob below.
  //   data_json     — the captured snapshot, only the ticked layers populated:
  //     channels:        [{ id, name, active }]  (per-channel enable flags)
  //     displaysNdi:     { channels:[{ id, name, template, type, ndi_* }],
  //                        monitors:[{ channel_id, display_bounds, label, active }] }
  //     stream:          { studio, config }  (Stream Studio layout + RTMP config)
  //     backgroundsStage:{ settings:{ global_bg_*_id, global_logo_id },   // ← `backgrounds`
  //                        stage:[{ channel_id, layout }] }               // ← `stageLayouts`
  // Presets are machine-local by nature (they reference channel ids + physical
  // display_bounds) — matching the hardware-specific nature of output config. Apply is
  // renderer-orchestrated: the panel replays the snapshot through the same window.cue.*
  // IPC the settings UI uses (channels:update → syncChannel, monitors:create/delete,
  // stream.setStudio/setConfig, stage.setLayout, settings.setGlobalBackground). No
  // media-asset FKs (only ids that live elsewhere), so no media.findUnused() entry and
  // rides backups with no path rewriting.
  function v30(database) {
    database.exec(`
      CREATE TABLE output_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        includes_json TEXT NOT NULL,
        data_json TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },

  // v31 — Live video inputs (NDI receive) + song arrangements + CCLI usage log.
  //
  // service_items.item_type gains 'live-input': the cue stores {sourceName, name}
  // JSON in `content` (ref_id stays NULL — it is NOT a media_assets row; the NDI
  // feed is resolved live at GO time, so nothing on disk and nothing for
  // media.findUnused()). CHECK can't be altered in place, so the table is rebuilt
  // carrying every column (same pattern as v21).
  //
  // songs.arrangement_json — the played ORDER of sections (ProPresenter-style
  // arrangement, e.g. V1 C V2 C B C C) as a JSON array of 0-based section
  // POSITIONS (order_index), with repeats allowed. NULL = natural order.
  // Positions, not ids, because songs.update() rewrites song_sections (ids churn
  // on every save); the editor serializes arrangement and sections together.
  //
  // song_usage — CCLI reporting log. One row per song aired (deduped in code,
  // ~12h window). Title/author/copyright are SNAPSHOTTED at air time and song_id
  // carries no FK, so the report survives later song edits/deletes.
  function v31(database) {
    database.exec(`
      ALTER TABLE songs ADD COLUMN arrangement_json TEXT;

      CREATE TABLE song_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id INTEGER,
        title TEXT NOT NULL,
        author TEXT,
        copyright TEXT,
        used_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_song_usage_used_at ON song_usage(used_at);

      CREATE TABLE service_items_v31 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL CHECK(item_type IN ('song','media','slide','scripture','presentation','youtube','live-input')),
        ref_id INTEGER,
        order_index INTEGER NOT NULL,
        notes TEXT,
        content TEXT,
        background_override_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
        media_loop INTEGER NOT NULL DEFAULT 0,
        advance_seconds INTEGER,
        advance_loop TEXT,
        advance_wrap INTEGER NOT NULL DEFAULT 1
      );

      INSERT INTO service_items_v31
        (id, service_id, item_type, ref_id, order_index, notes, content, background_override_id,
         media_loop, advance_seconds, advance_loop, advance_wrap)
      SELECT id, service_id, item_type, ref_id, order_index, notes, content, background_override_id,
             media_loop, advance_seconds, advance_loop, advance_wrap
      FROM service_items;

      DROP TABLE service_items;
      ALTER TABLE service_items_v31 RENAME TO service_items;

      CREATE INDEX IF NOT EXISTS idx_service_items_service_id ON service_items(service_id);
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

  // Disable FK enforcement during migrations so table rebuilds (DROP + recreate)
  // don't trigger ON DELETE CASCADE on referencing tables. The pragma is a no-op
  // inside a transaction, so it must be toggled outside the db.transaction() call.
  // Restored to ON afterwards (initDb also enables it before migrations run).
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    pending.forEach((migration, i) => {
      migration(db);
      db.prepare('UPDATE db_version SET version = ?').run(currentVersion + i + 1);
    });
  })();
  db.pragma('foreign_keys = ON');
}

export function initDb() {
  const dbPath = path.join(app.getPath('userData'), 'cue.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  // WAL makes synchronous=NORMAL safe (no corruption risk, just loses the last
  // txn on OS crash) and much faster for writes. Larger page cache + in-memory
  // temp tables keep hot reads off disk — matters for live broadcast latency.
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -16000'); // ~16MB
  db.pragma('temp_store = MEMORY');
  db.pragma('foreign_keys = ON');
  runMigrations();
  return db;
}
