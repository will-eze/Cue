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

// Parse a single-range `Range` header against a file of `size` bytes.
// Returns {start,end} (inclusive, end clamped to size-1), 'unsatisfiable' (416), or
// null when the header is absent/malformed/unsupported (caller serves the whole file).
// Supports `bytes=a-b`, `bytes=a-` and suffix `bytes=-N`. Multi-range uses the first.
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)/i.exec(String(header));
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') {
    // Suffix range: the last N bytes.
    const n = parseInt(m[2], 10);
    if (!(n > 0) || size <= 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : parseInt(m[2], 10);
    if (start >= size || end < start) return 'unsatisfiable';
    if (end > size - 1) end = size - 1;
  }
  return { start, end };
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

  const range = parseRange(req.headers['range'], stat.size);
  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' });
    res.end();
    return;
  }

  const stream = range
    ? fs.createReadStream(filePath, { start: range.start, end: range.end })
    : fs.createReadStream(filePath);
  if (range) {
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
      'Content-Length': String(range.end - range.start + 1),
    });
  } else {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': String(stat.size) });
  }
  // Release the fd if the client aborts (seek, tab close) before the stream finishes.
  res.on('close', () => { try { stream.destroy(); } catch {} });
  stream.on('error', () => { try { res.end(); } catch {} });
  stream.pipe(res);
}
