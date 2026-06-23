// Local-file serving over plain Node http (req/res) — used by the network remote
// to stream media (backgrounds, foreground clips, logos) to a browser viewer that
// re-renders the program. This is the http twin of the cue-media:// protocol
// handler in index.js (which uses the Web Request/Response API); both share the
// same MIME table and the same userData containment guard.
//
// SECURITY: serveLocalFile streams RAW filesystem paths, so it MUST keep the
// isUnderUserData() containment check — without it, a crafted /output/media path
// is an arbitrary-file-read. Mirrors the cue-media:// guard rail.

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export const MEDIA_MIME = {
  // Images
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', tiff: 'image/tiff',
  // Video
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  m4v: 'video/mp4', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  // Audio
  mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac',
  flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4',
  // Fonts (user-installed custom families)
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
};

// Every file the remote may serve (media, user fonts) lives under userData. A
// decoded path resolving OUTSIDE userData is a traversal attempt — reject it.
// path.resolve normalises any `..`, so this can't be walked around.
export function isUnderUserData(p) {
  const root = path.resolve(app.getPath('userData'));
  const resolved = path.resolve(p);
  return resolved === root || resolved.startsWith(root + path.sep);
}

// Stream a userData-contained file to a Node http response, honouring Range
// requests (videos open with `bytes=0-`). Never buffers the file — uses a lazy
// read stream so multi-GB clips stay bounded in memory (same rule as cue-media).
export function serveLocalFile(filePath, req, res) {
  // On Windows a path may arrive as /C:/... — strip the leading slash.
  if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(filePath)) {
    filePath = filePath.slice(1);
  }
  if (!isUnderUserData(filePath)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404); res.end('Not found');
    return;
  }
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeType = MEDIA_MIME[ext] || 'application/octet-stream';
  const baseHeaders = {
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    // Let a viewer's <video> tap audio (captureStream) without tainting; harmless otherwise.
    'Access-Control-Allow-Origin': '*',
  };

  const rangeHeader = req.headers['range'];
  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    const start = match && match[1] ? parseInt(match[1], 10) : 0;
    const end   = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
    if (start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' });
      res.end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': String(chunkSize),
    });
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => { try { res.end(); } catch {} });
    stream.pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': String(stat.size) });
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => { try { res.end(); } catch {} });
  stream.pipe(res);
}
