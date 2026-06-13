// Embedding worker thread. Keeps onnxruntime-node + the MiniLM session off the
// main process so verse-vector builds and per-window query embeds never stall the
// operator UI / output ticks. Tokenizes with a self-contained BERT WordPiece
// tokenizer (vocab.txt) so there is no transformers.js dependency.
//
// CommonJS on purpose: this file is NOT bundled by Vite. It is copied raw into the
// asar (forge.config.js packageAfterPrune) and loaded by path at runtime, exactly
// like src/output. The project is type:commonjs, so a require()-style worker loads
// in both `npm start` and a packaged build; an ESM worker would not.
//
// Messages in:  { type:'load', modelDir }
//               { type:'embed', id, texts: string[] }
// Messages out: { type:'ready', dim } | { type:'error', id?, error }
//               { type:'embedded', id, dim, count, data: Float32Array }  (transferred)

const { parentPort } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const ort = require('onnxruntime-node');

let session = null;
let vocab = null;          // Map token -> id
let dim = 384;

// ── WordPiece tokenizer (BERT uncased) ───────────────────────────────────────
function loadVocab(file) {
  const m = new Map();
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/\r$/, '');
    if (t.length) m.set(t, i);
  }
  return m;
}

function basicTokenize(text) {
  // Lowercase, strip accents, split off punctuation, whitespace-tokenize.
  const cleaned = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const spaced = cleaned.replace(/([^\p{L}\p{N}\s])/gu, ' $1 ');
  return spaced.split(/\s+/).filter(Boolean);
}

function wordpiece(tokens) {
  const ids = [];
  const unk = vocab.get('[UNK]');
  for (const tok of tokens) {
    let start = 0; const sub = []; let bad = false;
    while (start < tok.length) {
      let end = tok.length, cur = null;
      while (start < end) {
        const piece = (start > 0 ? '##' : '') + tok.slice(start, end);
        if (vocab.has(piece)) { cur = vocab.get(piece); break; }
        end--;
      }
      if (cur == null) { bad = true; break; }
      sub.push(cur); start = end;
    }
    if (bad) ids.push(unk); else ids.push(...sub);
  }
  return ids;
}

function encode(text, maxLen = 128) {
  let ids = wordpiece(basicTokenize(text));
  if (ids.length > maxLen - 2) ids = ids.slice(0, maxLen - 2);
  return [vocab.get('[CLS]'), ...ids, vocab.get('[SEP]')];
}

// ── inference ────────────────────────────────────────────────────────────────
async function embedBatch(texts) {
  const encoded = texts.map((t) => encode(t));
  const seqLen = Math.max(1, ...encoded.map((e) => e.length));
  const batch = texts.length;

  const inputIds = new BigInt64Array(batch * seqLen);
  const mask = new BigInt64Array(batch * seqLen);
  const types = new BigInt64Array(batch * seqLen);   // all zeros
  for (let b = 0; b < batch; b++) {
    const e = encoded[b];
    for (let i = 0; i < e.length; i++) {
      inputIds[b * seqLen + i] = BigInt(e[i]);
      mask[b * seqLen + i] = 1n;
    }
  }

  const dims = [batch, seqLen];
  const feeds = {
    input_ids: new ort.Tensor('int64', inputIds, dims),
    attention_mask: new ort.Tensor('int64', mask, dims),
    token_type_ids: new ort.Tensor('int64', types, dims),
  };
  const out = await session.run(feeds);
  const hidden = out.last_hidden_state || out[Object.keys(out)[0]];
  const data = hidden.data;                  // Float32Array [batch*seqLen*dim]
  dim = hidden.dims[2];

  // Mean-pool over real tokens (attention mask), then L2 normalize.
  const result = new Float32Array(batch * dim);
  for (let b = 0; b < batch; b++) {
    let count = 0;
    for (let i = 0; i < seqLen; i++) {
      if (mask[b * seqLen + i] === 0n) continue;
      count++;
      const base = (b * seqLen + i) * dim;
      for (let d = 0; d < dim; d++) result[b * dim + d] += data[base + d];
    }
    let norm = 0;
    for (let d = 0; d < dim; d++) { result[b * dim + d] /= (count || 1); norm += result[b * dim + d] ** 2; }
    const inv = norm > 0 ? 1 / Math.sqrt(norm) : 0;
    for (let d = 0; d < dim; d++) result[b * dim + d] *= inv;
  }
  return { data: result, dim };
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'load') {
      vocab = loadVocab(path.join(msg.modelDir, 'vocab.txt'));
      session = await ort.InferenceSession.create(path.join(msg.modelDir, 'model.onnx'), {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      parentPort.postMessage({ type: 'ready', dim });
      return;
    }
    if (msg.type === 'embed') {
      const { data, dim: d } = await embedBatch(msg.texts);
      parentPort.postMessage(
        { type: 'embedded', id: msg.id, dim: d, count: msg.texts.length, data },
        [data.buffer],
      );
    }
  } catch (err) {
    parentPort.postMessage({ type: 'error', id: msg && msg.id, error: err.message });
  }
});
