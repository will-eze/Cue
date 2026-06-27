import { ipcMain, shell } from 'electron';
import * as presentations from '../db/presentations.js';
import * as media from '../db/media.js';
import * as pptx from '../import/pptx-import.js';
import { generateSermonPresentation } from '../import/sermon-build.js';

export function registerPresentationsIpc() {
  ipcMain.handle('presentations:list', () => presentations.list());
  ipcMain.handle('presentations:get', (_e, id) => presentations.get(id));
  ipcMain.handle('presentations:create', (_e, data) => presentations.create(data));
  ipcMain.handle('presentations:update', (_e, id, data) => presentations.update(id, data));
  ipcMain.handle('presentations:delete', (_e, id) => presentations.del(id));
  ipcMain.handle('presentations:reorderSlides', (_e, id, orderedIds) => presentations.reorderSlides(id, orderedIds));

  ipcMain.handle('presentationTemplates:list', () => presentations.listTemplates());
  ipcMain.handle('presentationTemplates:get', (_e, id) => presentations.getTemplate(id));
  ipcMain.handle('presentationTemplates:create', (_e, data) => presentations.createTemplate(data));
  ipcMain.handle('presentationTemplates:delete', (_e, id) => presentations.delTemplate(id));

  // ── PowerPoint import (LibreOffice → PDF → pdfjs raster → image slides) ──────
  ipcMain.handle('presentations:detectLibreOffice', () => pptx.detectLibreOffice());
  ipcMain.handle('presentations:setLibreOfficePath', (_e, p) => pptx.setLibreOfficePath(p));
  ipcMain.handle('presentations:convertPptx', (_e, filePath) => pptx.convertPptxToPdf(filePath));

  // The renderer rasterises the PDF (pdfjs needs a DOM canvas) and sends back one
  // PNG buffer per slide; we persist each as a media asset and build a presentation
  // whose slides each hold a single full-bleed image element.
  ipcMain.handle('presentations:createFromImages', (_e, title, buffers) => {
    const slides = (buffers || []).map((buf, i) => {
      const asset = media.importBuffer(buf, `${title || 'slide'} ${i + 1}.png`, '.png');
      return {
        label: null, background_id: null,
        elements: [{ id: `img_${i}`, type: 'image', mediaId: asset.id, x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, z: 0, fit: 'contain' }],
      };
    });
    const id = presentations.create({ title: title || 'Imported Presentation', slides });
    return { id, slideCount: slides.length };
  });

  // ── Sermon → Slides ─────────────────────────────────────────────────────────
  // txt/md/docx are read in main; PDF text is extracted in the renderer (pdfjs)
  // and passed in as `text`. Either way generate resolves scripture, applies the
  // theme, and builds the presentation.
  ipcMain.handle('sermon:generate', async (_e, payload) => {
    try { return { ok: true, ...(await generateSermonPresentation(payload || {})) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  // Open an external URL (the LibreOffice download page) in the default browser.
  ipcMain.handle('app:openExternal', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
}
