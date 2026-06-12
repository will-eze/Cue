import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import * as tar from 'tar';
import Database from 'better-sqlite3';
import { getDb, closeDb } from './schema.js';

// A `.cuebackup` is a gzipped tar of the two things that hold all user state:
//   cue.db   — the single SQLite database (songs, rundowns, themes, settings…)
//   media/   — every imported image / video / audio asset
// Everything else (bundled bibles, hymnal) re-seeds on launch, so this pair is a
// complete, portable snapshot. tar (node-tar) handles both create and extract and
// is already on disk as a dependency.

export async function exportBackup(destPath) {
  const userData = app.getPath('userData');

  // Flush the WAL back into cue.db so the copied file is a complete snapshot —
  // otherwise recent writes still living in cue.db-wal would be lost.
  try { getDb()?.pragma('wal_checkpoint(TRUNCATE)'); } catch {}

  const entries = ['cue.db'];
  if (fs.existsSync(path.join(userData, 'media'))) entries.push('media');
  if (fs.existsSync(path.join(userData, 'fonts'))) entries.push('fonts');

  await tar.create({ gzip: true, file: destPath, cwd: userData }, entries);
  return { ok: true, path: destPath, size: fs.statSync(destPath).size };
}

// Confirm-and-replace: validates the archive, swaps cue.db + media/ on disk, then
// the caller relaunches the app so every process re-reads the restored state.
export async function importBackup(srcPath) {
  const userData = app.getPath('userData');
  const tmpDir = path.join(userData, `.cue-restore-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    await tar.extract({ file: srcPath, cwd: tmpDir });

    const stagedDb = path.join(tmpDir, 'cue.db');
    if (!fs.existsSync(stagedDb)) {
      throw new Error('Not a valid Cue backup — cue.db is missing.');
    }

    // Sanity-check that it actually opens as a Cue database before we touch the
    // live files. A corrupt or unrelated archive aborts here, leaving the running
    // installation untouched.
    const probe = new Database(stagedDb, { readonly: true, fileMustExist: true });
    try {
      const t = probe.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('settings','songs')"
      ).all();
      if (t.length < 2) throw new Error('Archive does not look like a Cue database.');
    } finally {
      probe.close();
    }

    // --- point of no return: swap files on disk ---
    closeDb();

    const dbPath = path.join(userData, 'cue.db');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.rmSync(dbPath + suffix, { force: true }); } catch {}
    }
    fs.copyFileSync(stagedDb, dbPath);

    const mediaDir = path.join(userData, 'media');
    fs.rmSync(mediaDir, { recursive: true, force: true });
    const stagedMedia = path.join(tmpDir, 'media');
    if (fs.existsSync(stagedMedia)) fs.renameSync(stagedMedia, mediaDir);
    else fs.mkdirSync(mediaDir, { recursive: true });

    // User-installed fonts (userData/fonts) travel with the backup too.
    const fontsDir = path.join(userData, 'fonts');
    fs.rmSync(fontsDir, { recursive: true, force: true });
    const stagedFonts = path.join(tmpDir, 'fonts');
    if (fs.existsSync(stagedFonts)) fs.renameSync(stagedFonts, fontsDir);

    // media_assets.path is stored absolute, so a backup restored on a different
    // machine/account would point at the old userData dir. Rewrite each path to
    // this install's media dir (keeping the file's basename) so assets resolve.
    const fixDb = new Database(dbPath);
    try {
      const rows = fixDb.prepare('SELECT id, path FROM media_assets').all();
      const upd = fixDb.prepare('UPDATE media_assets SET path=? WHERE id=?');
      fixDb.transaction(() => {
        for (const r of rows) upd.run(path.join(mediaDir, path.basename(r.path)), r.id);
      })();

      // user_fonts is a JSON array in settings with absolute file paths — rewrite
      // each to this install's fonts dir so custom fonts resolve after a restore.
      const fontsDir = path.join(userData, 'fonts');
      const frow = fixDb.prepare("SELECT value FROM settings WHERE key='user_fonts'").get();
      if (frow) {
        try {
          const list = JSON.parse(frow.value);
          if (Array.isArray(list)) {
            for (const f of list) if (f && f.path) f.path = path.join(fontsDir, path.basename(f.path));
            fixDb.prepare("UPDATE settings SET value=? WHERE key='user_fonts'").run(JSON.stringify(list));
          }
        } catch {}
      }
    } finally {
      fixDb.close();
    }

    return { ok: true };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
