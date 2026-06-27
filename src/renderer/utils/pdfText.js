// Extract plain text from a PDF in the renderer (pdfjs needs a DOM). Mirrors
// pdfRaster.js's worker setup — a fresh worker per call, loaded via Vite `?worker`
// + GlobalWorkerOptions.workerPort (the only reliable off-main-thread path in
// Electron). Returns the whole document's text; lines are reconstructed from the
// text items' end-of-line flags / y positions so the sermon parser sees real lines.
import * as pdfjsLib from 'pdfjs-dist';
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

export async function extractPdfText(bytes, onProgress) {
  const worker = new PdfjsWorker();
  pdfjsLib.GlobalWorkerOptions.workerPort = worker;
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const doc = await pdfjsLib.getDocument({ data, disableAutoFetch: true, disableStream: true }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const lines = [];
      let line = '';
      let lastY = null;
      for (const it of content.items) {
        const y = it.transform ? it.transform[5] : null;
        // New visual row → flush (pdfjs items are emitted left-to-right, row by row).
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && line) { lines.push(line); line = ''; }
        line += it.str || '';
        if (it.hasEOL) { lines.push(line); line = ''; }
        lastY = y;
      }
      if (line) lines.push(line);
      pages.push(lines.join('\n'));
      page.cleanup();
      onProgress?.(i, doc.numPages);
    }
  } finally {
    try { await doc.destroy(); } catch {}
    try { worker.terminate(); } catch {}
    if (pdfjsLib.GlobalWorkerOptions.workerPort === worker) pdfjsLib.GlobalWorkerOptions.workerPort = null;
  }
  return pages.join('\n\n');
}
