import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import * as settings from '../db/settings.js';

// PowerPoint import is done by rendering each slide to a high-fidelity image — the
// only reliable, format-complete renderer is LibreOffice (`soffice`), which we
// shell out to for a pptx→pdf conversion (the renderer then rasterises the PDF
// with pdfjs). LibreOffice is detected, never bundled (hundreds of MB); if it's
// missing the UI nudges the user to install it BEFORE any conversion runs, so we
// never spawn a missing binary.

function candidatePaths() {
  const out = [];
  const override = settings.get('libreoffice_path');
  if (override) out.push(override);
  if (process.platform === 'darwin') {
    out.push('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  } else if (process.platform === 'win32') {
    out.push(
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    );
  } else {
    out.push('/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice', '/snap/bin/libreoffice');
  }
  return out;
}

// Absolute path to a working soffice binary, or null.
export function findLibreOffice() {
  for (const c of candidatePaths()) {
    try { if (c && fs.existsSync(c)) return c; } catch {}
  }
  // Fall back to PATH.
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const arg = process.platform === 'win32' ? 'soffice' : 'soffice';
    const found = execFileSync(cmd, [arg], { timeout: 8000 }).toString().trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) return found;
  } catch {}
  return null;
}

// Detection for the UI's "Check for LibreOffice" button. Confirms the binary
// exists and (best-effort) reports its version, without launching the GUI.
export function detectLibreOffice() {
  const soffice = findLibreOffice();
  if (!soffice) return { found: false };
  let version = null;
  try { version = execFileSync(soffice, ['--version'], { timeout: 10000 }).toString().trim().split(/\r?\n/)[0]; } catch {}
  return { found: true, path: soffice, version };
}

// Persist a user-chosen soffice path (Locate manually…) and re-detect.
export function setLibreOfficePath(p) {
  settings.set('libreoffice_path', p || null);
  return detectLibreOffice();
}

// Convert a .ppt/.pptx to PDF via headless LibreOffice and return the PDF bytes.
// Uses an isolated -env:UserInstallation profile so it never collides with a
// LibreOffice instance the user already has open (the classic "soffice silently
// does nothing" lock). Cleans up its temp dirs.
export function convertPptxToPdf(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'Source file not found' };

  // A PDF (e.g. exported straight from PowerPoint / Keynote / Google Slides, which
  // embed their own fonts) is already pixel-perfect — no LibreOffice, no font
  // substitution. Just hand back its bytes for the renderer to rasterise.
  if (path.extname(filePath).toLowerCase() === '.pdf') {
    try {
      return { ok: true, pdf: fs.readFileSync(filePath), name: path.basename(filePath, path.extname(filePath)) };
    } catch (e) {
      return { ok: false, error: e.message || 'Could not read the PDF' };
    }
  }

  const soffice = findLibreOffice();
  if (!soffice) return { ok: false, error: 'not_found' };

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-pptx-'));
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-lo-profile-'));
  try {
    execFileSync(soffice, [
      '--headless', '--norestore', '--invisible',
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      '--convert-to', 'pdf', '--outdir', outDir, filePath,
    ], { timeout: 180000, stdio: 'ignore' });

    const base = path.basename(filePath, path.extname(filePath));
    const pdfPath = path.join(outDir, base + '.pdf');
    if (!fs.existsSync(pdfPath)) return { ok: false, error: 'LibreOffice produced no PDF' };
    const bytes = fs.readFileSync(pdfPath);
    return { ok: true, pdf: bytes, name: base };
  } catch (e) {
    return { ok: false, error: e.message || 'Conversion failed' };
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}
