// Content matching: identify which verse a minister is quoting/paraphrasing.
//
// Strategy (hybrid, all local): a one-time verse-vector build per translation
// (cached as a Float32 blob in userData), then per spoken window: FTS5 prefilter
// → embed the window → cosine-rerank the candidates → precision-gate. DB reads
// stay on the main thread (better-sqlite3 is already here); embedding runs in a
// worker (embed-worker.js). The blob is a REGENERABLE derived cache (like
// thumbnails): not backed up, no schema, rebuilt if missing or the model/verse
// count changes.

import { app } from 'electron';
import { Worker } from 'worker_threads';
import path from 'path';
import fs from 'fs';
import { getDb } from '../db/schema.js';
import { search } from '../db/bible.js';
import * as embedBin from './embed-bin.js';
import { rankByCosine, gate, DEFAULT_GATES } from './match-score.js';

const cacheDir = () => path.join(app.getPath('userData'), 'scripture-embeddings');
const blobPath = (versionId) => path.join(cacheDir(), `${versionId}.bin`);
const metaPath = (versionId) => path.join(cacheDir(), `${versionId}.json`);

function workerScript() {
  // Copied raw into the asar at the same relative path (see forge.config.js),
  // so app.getAppPath() resolves it in both dev and a packaged build.
  return path.join(app.getAppPath(), 'src', 'main', 'scripture-detect', 'embed-worker.js');
}

// All verses of a version in canonical order — the row order the blob mirrors.
function orderedVerses(versionId) {
  return getDb().prepare(
    `SELECT book_name, book_num, chapter, verse, text
       FROM bible_verses WHERE version_id = ?
       ORDER BY book_num, chapter, verse`,
  ).all(versionId);
}

function verseCount(versionId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM bible_verses WHERE version_id = ?').get(versionId)?.n ?? 0;
}

const keyOf = (r) => `${r.book_num}:${r.chapter}:${r.verse}`;

let worker = null;
let workerReady = null;
let reqSeq = 0;
const pending = new Map();

function ensureWorker() {
  if (workerReady) return workerReady;
  workerReady = new Promise((resolve, reject) => {
    worker = new Worker(workerScript());
    worker.on('message', (m) => {
      if (m.type === 'ready') return resolve(true);
      if (m.type === 'embedded') { pending.get(m.id)?.resolve(m); pending.delete(m.id); }
      if (m.type === 'error') {
        if (m.id != null && pending.has(m.id)) { pending.get(m.id).reject(new Error(m.error)); pending.delete(m.id); }
        else reject(new Error(m.error));
      }
    });
    worker.on('error', reject);
    worker.postMessage({ type: 'load', modelDir: embedBin.modelDir() });
  });
  return workerReady;
}

function embed(texts) {
  return new Promise((resolve, reject) => {
    const id = ++reqSeq;
    pending.set(id, {
      resolve: (m) => resolve({ data: new Float32Array(m.data), dim: m.dim, count: m.count }),
      reject,
    });
    worker.postMessage({ type: 'embed', id, texts });
  });
}

// ── in-memory cache of the active translation's vectors ──────────────────────
let active = null;  // { versionId, dim, vectors: Float32Array, rows: [...], keyIndex: Map }

function vectorAt(i) {
  return active.vectors.subarray(i * active.dim, (i + 1) * active.dim);
}

export function isBuilt(versionId) {
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath(versionId), 'utf8'));
    return meta.modelId === embedBin.MODEL_ID
      && meta.dim === embedBin.EMBED_DIM
      && meta.count === verseCount(versionId);
  } catch { return false; }
}

// Build (or rebuild) the verse vectors for a translation. Heavy + one-time.
export async function buildVectors(versionId, onProgress) {
  const dl = await embedBin.ensureModel((p) => onProgress?.({ phase: 'model', ...p }));
  if (!dl.ok) return { ok: false, error: dl.error };
  await ensureWorker();

  const rows = orderedVerses(versionId);
  const dim = embedBin.EMBED_DIM;
  const vectors = new Float32Array(rows.length * dim);
  const BATCH = 64;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { data } = await embed(slice.map((r) => r.text));
    vectors.set(data.subarray(0, slice.length * dim), i * dim);
    onProgress?.({ phase: 'embed', done: Math.min(i + BATCH, rows.length), total: rows.length });
  }

  fs.mkdirSync(cacheDir(), { recursive: true });
  fs.writeFileSync(blobPath(versionId), Buffer.from(vectors.buffer));
  fs.writeFileSync(metaPath(versionId), JSON.stringify({
    modelId: embedBin.MODEL_ID, dim, count: rows.length, versionId,
  }));
  loadIntoMemory(versionId, vectors, rows, dim);
  return { ok: true, count: rows.length };
}

function loadIntoMemory(versionId, vectors, rows, dim) {
  const keyIndex = new Map();
  rows.forEach((r, i) => keyIndex.set(keyOf(r), i));
  active = { versionId, dim, vectors, rows, keyIndex };
}

// Load the cached blob for a translation into memory. Does NOT build — building is
// an explicit, heavy Settings action (buildVectors), never triggered on the live
// detection path.
export async function ensureActive(versionId) {
  if (active?.versionId === versionId) return { ok: true };
  if (!isBuilt(versionId)) return { ok: false, error: 'verse index not built' };
  await ensureWorker();
  const meta = JSON.parse(fs.readFileSync(metaPath(versionId), 'utf8'));
  const buf = fs.readFileSync(blobPath(versionId));
  const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  loadIntoMemory(versionId, vectors, orderedVerses(versionId), meta.dim);
  return { ok: true };
}

// Match a spoken window against the active translation. Returns
// { ok, hit:{ ref, bookNum, chapter, verse, versionId, text }, score, margin } or
// a non-ok result with a reason. `text` is the last N committed words.
export async function match(versionId, text, gates = DEFAULT_GATES) {
  const r = await ensureActive(versionId);
  if (!r.ok) return { ok: false, reason: 'not-ready', error: r.error };

  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length < gates.minWords) return { ok: false, reason: 'too-short' };

  // FTS prefilter → candidate row indices. Fall back to brute force over all
  // verses if recall is poor (paraphrase with few shared tokens).
  const hits = search(versionId, text, 50);
  let candIdx = [];
  for (const h of hits) {
    const i = active.keyIndex.get(`${h.book_num}:${h.chapter}:${h.verse}`);
    if (i != null) candIdx.push(i);
  }
  if (candIdx.length < 5) candIdx = active.rows.map((_, i) => i); // brute force

  const { data: q } = await embed([text]);
  const queryVec = q.subarray(0, active.dim);
  const candidates = candIdx.map((i) => {
    const row = active.rows[i];
    return {
      vec: vectorAt(i),
      ref: `${row.book_name} ${row.chapter}:${row.verse}`,
      bookNum: row.book_num, chapter: row.chapter, verse: row.verse, text: row.text,
    };
  });

  const ranked = rankByCosine(queryVec, candidates);
  const g = gate(ranked, words.length, gates);
  if (!g.ok) return { ok: false, reason: g.reason, score: g.score, margin: g.margin };
  return {
    ok: true,
    score: g.score, margin: g.margin,
    hit: { ref: g.hit.ref, bookNum: g.hit.bookNum, chapter: g.hit.chapter, verse: g.hit.verse, versionId },
  };
}

export function dispose() {
  try { worker?.terminate(); } catch {}
  worker = null; workerReady = null; active = null; pending.clear();
}
