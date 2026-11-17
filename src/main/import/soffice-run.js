// Run headless LibreOffice to convert a document to PDF, ASYNCHRONOUSLY, with a hard
// timeout and operator-readable errors. Pure of DB/Electron so it unit-tests with a fake
// `soffice`. (The old execFileSync froze the whole main process — outputs included — for
// up to 3 minutes while converting, and surfaced raw "spawnSync … ETIMEDOUT" text.)
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

export const PDF_HINT = 'Tip: export the deck to PDF from PowerPoint/Keynote and import that instead.';

export function convertWithSoffice(soffice, filePath, timeoutMs = 180000) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-pptx-'));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-lo-profile-'));
  const cleanup = () => {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  };
  return new Promise((resolve) => {
    const base = path.basename(filePath, path.extname(filePath));
    execFile(soffice, [
      '--headless', '--norestore', '--invisible',
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      '--convert-to', 'pdf', '--outdir', outDir, filePath,
    ], { timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true }, (err) => {
      try {
        if (err) {
          if (err.killed || err.signal === 'SIGKILL' || err.code === 'ETIMEDOUT') {
            return resolve({ ok: false, error: `The PowerPoint conversion timed out after ${Math.round(timeoutMs / 1000)} seconds. ${PDF_HINT}` });
          }
          if (err.code === 'ENOENT' || err.code === 'EACCES') {
            return resolve({ ok: false, error: 'LibreOffice could not be started. Re-locate it in the import dialog.' });
          }
          return resolve({ ok: false, error: `LibreOffice could not convert this file (it may be corrupt or password-protected). ${PDF_HINT}` });
        }
        const pdfPath = path.join(outDir, base + '.pdf');
        if (!fs.existsSync(pdfPath)) {
          return resolve({ ok: false, error: `LibreOffice produced no PDF (the file may be corrupt or password-protected). ${PDF_HINT}` });
        }
        resolve({ ok: true, pdf: fs.readFileSync(pdfPath), name: base });
      } finally { cleanup(); }
    });
  });
}
