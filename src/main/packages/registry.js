// Optional-dependency registry — the single source of truth behind the Settings →
// Packages manager. Cue ships lean: heavy or fast-staling dependencies (yt-dlp,
// ffmpeg, the on-device ASR/embedding models) are NOT bundled — they're fetched into
// userData on demand, and LibreOffice is a system install the user provides. This
// module gathers all of them into ONE uniform descriptor shape so the UI can show
// what's installed, where, how big, what each unlocks, and what breaks if removed.
//
// GPU speech models are intentionally NOT here: they live in Chromium's Cache API and
// are downloaded/removed by the renderer (transformers.js web worker) — the modal adds
// that card client-side. Everything in this file is filesystem/binary state in main.

import { shell } from 'electron';
import * as ytbin from '../youtube/bin.js';
import * as whisperBin from '../scripture-detect/whisper-bin.js';
import * as embedBin from '../scripture-detect/embed-bin.js';
import * as pptx from '../import/pptx-import.js';

// Build the live descriptor list. `status` is derived fresh on every call so the UI
// always reflects on-disk reality (a manual install/uninstall outside Cue included).
export function list() {
  const yt = ytbin.binInfo('yt-dlp');
  const ff = ytbin.binInfo('ffmpeg');
  const lo = pptx.detectLibreOffice();
  const whisperSize = whisperBin.storeSizeBytes();
  const whisperReady = whisperBin.anyModelReady();
  const embedReady = embedBin.isReady();

  return [
    {
      id: 'yt-dlp',
      name: 'yt-dlp',
      kind: 'binary',
      status: yt.path ? 'installed' : 'missing',
      location: yt.path,
      managed: yt.inUserDir,              // false = a system/PATH copy we don't own
      size: yt.size,
      approxMB: 30,
      features: ['Add YouTube videos as service items', 'Automatic resolution + format selection'],
      losesOnRemove: 'YouTube cues can no longer be resolved or played.',
      installable: true,
      removable: yt.inUserDir,
      locatable: true,
    },
    {
      id: 'ffmpeg',
      name: 'ffmpeg',
      kind: 'binary',
      status: ff.path ? 'installed' : 'missing',
      location: ff.path,
      managed: ff.inUserDir,
      size: ff.size,
      approxMB: 55,
      features: ['Merge 1080p+ YouTube video + audio', 'Live RTMP streaming to YouTube / Facebook'],
      losesOnRemove: 'High-resolution YouTube playback and live streaming stop working.',
      installable: true,
      removable: ff.inUserDir,
      locatable: true,
    },
    {
      id: 'libreoffice',
      name: 'LibreOffice',
      kind: 'external',
      status: lo.found ? 'installed' : 'missing',
      location: lo.path || null,
      managed: false,                     // system install — Cue never deletes it
      size: 0,
      version: lo.version || null,
      features: ['Import PowerPoint (.ppt / .pptx) as slide images'],
      losesOnRemove: 'PowerPoint import is unavailable (PDF import still works).',
      installable: false,                 // external — provide a download page + locate
      removable: false,
      externalUrl: 'https://www.libreoffice.org/download/download/',
      locatable: true,
    },
    {
      id: 'whisper-cpu',
      name: 'Speech Recognition Model',
      kind: 'model',
      status: whisperReady ? 'installed' : 'missing',
      location: whisperBin.modelStorePath(),
      managed: true,
      size: whisperSize,
      approxMB: 250,
      features: ['Scripture detection from the service audio (CPU engine)', 'Spoken-reference + quoted-verse detection'],
      losesOnRemove: 'Scripture detection has no CPU speech model until re-downloaded.',
      installable: true,
      removable: whisperReady || whisperSize > 0,
    },
    {
      id: 'embed',
      name: 'Verse Matching Model',
      kind: 'model',
      status: embedReady ? 'installed' : 'missing',
      location: embedBin.modelStorePath(),
      managed: true,
      size: embedBin.storeSizeBytes(),
      approxMB: 90,
      features: ['Content matching — detect quoted / paraphrased verses with no citation'],
      losesOnRemove: 'Content matching stops; spoken-reference detection is unaffected.',
      installable: true,
      removable: embedReady,
    },
  ];
}

// Reveal a package's install location in the OS file manager (a system LibreOffice
// path is shown-in-folder too). No-op when the package has no on-disk location.
export function reveal(id) {
  const pkg = list().find((p) => p.id === id);
  if (pkg?.location) { try { shell.showItemInFolder(pkg.location); } catch {} }
  return { ok: !!pkg?.location };
}

// Install a package, reporting 0–1 progress via onProgress(percent, fileName).
// Returns { ok } | { ok:false, error }. LibreOffice is external → not installable here.
export async function install(id, onProgress) {
  const report = (p) => onProgress?.(typeof p === 'number' ? p : (p?.percent ?? 0), p?.name || p?.file);
  switch (id) {
    case 'yt-dlp':
      return ytbin.installBinary('yt-dlp', report);
    case 'ffmpeg':
      return ytbin.installBinary('ffmpeg', report);
    case 'whisper-cpu': {
      // Deferred: the manager owns model choice, thread budgets + status broadcasts.
      const sd = await import('../scripture-detect/manager.js');
      return sd.ensureAsrModel();
    }
    case 'embed':
      return embedBin.ensureModel(report);
    default:
      return { ok: false, error: `unknown or non-installable package: ${id}` };
  }
}

// Remove a package's userData footprint. Only the copies Cue downloaded are ours to
// delete (guarded by `managed` in the descriptor); a system binary is never touched.
export function remove(id) {
  switch (id) {
    case 'yt-dlp':   return ytbin.removeBinary('yt-dlp');
    case 'ffmpeg':   return ytbin.removeBinary('ffmpeg');
    case 'whisper-cpu': return whisperBin.removeModels();
    case 'embed':    return embedBin.removeModel();
    default:         return { ok: false, error: `not removable: ${id}` };
  }
}

// Point Cue at a manually-chosen binary (the "Locate…" flow) for any locatable
// package, persist it, and re-detect. Used when a tool is installed somewhere Cue
// doesn't scan (a custom dir, a portable build, a non-standard LibreOffice).
export function locate(id, filePath) {
  if (!filePath) return { ok: false };
  if (id === 'libreoffice') { const d = pptx.setLibreOfficePath(filePath); return { ok: !!d.found, ...d }; }
  if (id === 'yt-dlp' || id === 'ffmpeg') { ytbin.setBinaryPath(id, filePath); return { ok: !!ytbin.binInfo(id).path }; }
  return { ok: false, error: `not locatable: ${id}` };
}
