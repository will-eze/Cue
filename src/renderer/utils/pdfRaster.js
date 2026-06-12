// Rasterise a PDF (the LibreOffice-converted PowerPoint) to one image per page
// using pdfjs. This runs in the renderer because pdfjs needs a DOM <canvas>; the
// resulting buffers are handed back to main to persist as media assets.
//
// The worker is loaded via Vite's `?worker` import + GlobalWorkerOptions.workerPort
// — the only reliable way to get a real off-main-thread worker in Electron. The
// older `workerSrc = <url>` form silently fell back to a main-thread "fake worker"
// (parsing + rendering on the UI thread), which is what made imports crawl. Output
// is JPEG: encoding is ~10× faster than PNG and the IPC payload back to main is a
// fraction of the size, so a deck rasterises in seconds.
import * as pdfjsLib from 'pdfjs-dist';
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

// Lossless PNG so text stays crisp and keeps its true weight — JPEG's chroma
// ringing around black-on-white text reads as a lighter/blurrier font. Rendered at
// 2560px wide (vector source, so this is cost-free fidelity) for clean downscaling
// on 1080p–1440p outputs. Note: this is the renderer's job only; any layout/overflow
// differences come from LibreOffice's font substitution upstream (install the deck's
// fonts on this machine, or embed fonts in the .pptx, to fix those).
export const SLIDE_MIME = 'image/png';
export const SLIDE_EXT = '.png';

export async function rasterizePdf(bytes, targetWidth = 2560, onProgress) {
  // Fresh worker per import — pdfjs may terminate the port on doc.destroy(), so a
  // cached global port could go stale between imports. Worker spin-up is cheap
  // relative to a conversion.
  const worker = new PdfjsWorker();
  pdfjsLib.GlobalWorkerOptions.workerPort = worker;
  // pdfjs may transfer/detach the input buffer; clone so the caller keeps theirs.
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const doc = await pdfjsLib.getDocument({ data, disableAutoFetch: true, disableStream: true }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: targetWidth / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      // White backing so JPEG (no alpha) matches slides with transparent regions.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, SLIDE_MIME));
      pages.push(new Uint8Array(await blob.arrayBuffer()));
      page.cleanup();
      onProgress?.(i, doc.numPages);
    }
  } finally {
    try { await doc.destroy(); } catch {}
    try { worker.terminate(); } catch {}
    if (pdfjsLib.GlobalWorkerOptions.workerPort === worker) pdfjsLib.GlobalWorkerOptions.workerPort = null;
  }
  return pages;
}
