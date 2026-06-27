import React, { useState, useEffect, useRef } from 'react';
import { mediaUrl } from '../utils/mediaUrl';
import { renderTextContent } from './SongEditor';

// Shared read-only renderer for presentation slide elements (the §21 elements_json
// shape). A 4th parallel renderer alongside fullscreen.js / PreviewLivePanel /
// PresentationEditor (the established editor-vs-DOM duplication), used for static
// PREVIEWS: the PresentationEditor theme gallery + the ThemeSettings card.
const NATIVE_W = 1920, NATIVE_H = 1080;

// One element's inner content (no positioning — the caller boxes it by percent).
export function elementInner(el) {
  if (el.type === 'text') {
    const s = el.style || {};
    const shadow = s.textShadow;
    const shadowCss = shadow?.enabled
      ? `${shadow.x ?? 0}px ${shadow.y ?? 2}px ${shadow.blur ?? 16}px ${shadow.color ?? '#000'}`
      : 'none';
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        justifyContent: s.verticalAlign === 'top' ? 'flex-start' : s.verticalAlign === 'bottom' ? 'flex-end' : 'center' }}>
        <div style={{ width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontFamily: s.fontFamily || undefined,
          fontSize: (s.fontSize ?? 48) + 'px',
          textAlign: s.align || 'center',
          fontWeight: s.bold ? 700 : 400,
          fontStyle: s.italic ? 'italic' : 'normal',
          textDecoration: s.underline ? 'underline' : 'none',
          textTransform: s.uppercase ? 'uppercase' : 'none',
          color: s.color || '#ffffff',
          lineHeight: s.lineSpacing ? String(s.lineSpacing) : '1.25',
          letterSpacing: s.letterSpacing ? `${s.letterSpacing}em` : undefined,
          textShadow: shadowCss,
          WebkitTextStroke: s.textStroke?.enabled ? `${s.textStroke.width ?? 2}px ${s.textStroke.color ?? '#000'}` : undefined,
        }} dangerouslySetInnerHTML={{ __html: renderTextContent(el.text || '', null, s) }} />
      </div>
    );
  }
  if (el.type === 'image' && el.path) {
    const fit = el.fit === 'cover' ? 'cover' : 'contain';
    const isVideo = el.mediaType === 'video' || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(el.path);
    return isVideo
      ? <video src={mediaUrl(el.path)} style={{ width: '100%', height: '100%', objectFit: fit }} autoPlay loop muted />
      : <img src={mediaUrl(el.path)} style={{ width: '100%', height: '100%', objectFit: fit }} alt="" />;
  }
  if (el.type === 'shape') {
    const stroke = el.stroke || {};
    const shapeStyle = el.shape === 'line'
      ? { background: stroke.color || el.fill || '#fff' }
      : { background: el.fill || 'transparent',
          border: (stroke.color && stroke.width) ? `${stroke.width}px solid ${stroke.color}` : undefined,
          borderRadius: el.shape === 'ellipse' ? '50%' : (el.radius ? `${el.radius}px` : undefined) };
    return <div style={{ width: '100%', height: '100%', ...shapeStyle }} />;
  }
  return null;
}

// A 16:9 tile rendering an element layout from the fixed 1920×1080 stage, scaled to
// fit its container (so px font sizes stay WYSIWYG with editor/monitor/output).
// backgroundPath: local media path (via cue-media://). backgroundRaw: direct URL
// (Unsplash thumb, etc.) used as-is — skips mediaUrl(). Either suppresses the
// gradient bgShape, so caller should filter role='background' elements when passing.
export function StaticSlide({ elements, backgroundPath = null, backgroundRaw = null }) {
  const ref = useRef(null);
  const [scale, setScale] = useState(0.2);
  useEffect(() => {
    if (!ref.current) return;
    const update = () => { if (ref.current) setScale(ref.current.offsetWidth / NATIVE_W); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const bgSrc = backgroundRaw || (backgroundPath ? mediaUrl(backgroundPath) : null);
  return (
    <div ref={ref} className="relative w-full bg-black overflow-hidden rounded" style={{ aspectRatio: '16 / 9' }}>
      {bgSrc && <img src={bgSrc} className="absolute inset-0 w-full h-full object-cover" alt="" />}
      <div className="absolute inset-0" style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: NATIVE_W, height: NATIVE_H }}>
        {[...(elements || [])].sort((a, b) => (a.z || 0) - (b.z || 0)).map((el) => (
          <div key={el.id} style={{ position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
            transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, opacity: el.opacity ?? 1, overflow: 'hidden' }}>
            {elementInner(el)}
          </div>
        ))}
      </div>
    </div>
  );
}
