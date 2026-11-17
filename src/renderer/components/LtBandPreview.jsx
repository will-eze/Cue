import React, { useRef, useState, useLayoutEffect } from 'react';
import { resolveLtStyle, buildBarBg, buildDecorationCss, accentRuleStyle } from './SongEditor';
import { mediaUrl } from '../utils/mediaUrl';

// A small 16:9 picture of what a lower-third channel shows for ONE page of a presentation slide:
// the band at the bottom, styled by the real theme text style (resolveLtStyle + the theme's
// lower-third bar), one nowrap block per line with the optional title on top. It is laid out at
// the output's native 1920x1080 and scaled to fit, like the operator monitors, and applies the
// same shrink-to-fit idea as output/lowerthird.js (approximated from the line length, since an
// editor thumbnail does not need to measure real glyphs).
const NW = 1920, NH = 1080;

export default function LtBandPreview({ lines = [], title = '', style = null, fontScale = 1, bgPath = null, className = '' }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.1);
  useLayoutEffect(() => {
    if (!wrapRef.current) return undefined;
    const update = () => { if (wrapRef.current) setScale(wrapRef.current.offsetWidth / NW); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const s = resolveLtStyle(style) || {};
  const base = (Number(s.fontSize) || 72) * (Number(fontScale) > 0 ? Number(fontScale) : 1);
  const lh = Number(s.lineSpacing) || 1.2;
  const all = title ? [title, ...lines] : lines;
  const longest = all.reduce((m, l) => Math.max(m, String(l).length), 1);
  // Fit: no line wider than the band (~0.52em per character), block within 45% of the frame.
  const px = Math.max(20, Math.min(base, (NW - 120) / (longest * 0.52), (NH * 0.45) / (lh * Math.max(1, all.length))));
  const shadow = s.textShadow
    ? (s.textShadow.enabled ? `${s.textShadow.x ?? 0}px ${s.textShadow.y ?? 2}px ${s.textShadow.blur ?? 16}px ${s.textShadow.color ?? '#000'}` : 'none')
    : '0 2px 8px rgba(0,0,0,0.6)';
  const stroke = s.textStroke;
  const textStyle = {
    fontFamily: s.fontFamily || undefined,
    fontSize: px + 'px',
    textAlign: s.align || 'center',
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: buildDecorationCss(s),
    textTransform: s.uppercase ? 'uppercase' : 'none',
    color: s.color || '#ffffff',
    lineHeight: String(lh),
    letterSpacing: s.letterSpacing ? `${s.letterSpacing}em` : undefined,
    textShadow: shadow,
    WebkitTextStroke: stroke?.enabled ? `${stroke.width ?? 2}px ${stroke.color ?? '#000'}` : undefined,
    whiteSpace: 'nowrap',
    width: '100%',
  };
  const accent = accentRuleStyle(s.accent);
  const bgIsVideo = bgPath && /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(bgPath);

  return (
    <div ref={wrapRef} className={`w-full aspect-video relative overflow-hidden bg-black ${className}`}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: NW, height: NH, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {bgPath && !bgIsVideo
          ? <img src={mediaUrl(bgPath)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : style?.bgCss ? <div style={{ position: 'absolute', inset: 0, background: style.bgCss }} /> : null}
        {all.length > 0 && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            padding: '24px 60px 32px',
            background: buildBarBg(s.ltBar),
            minHeight: 160,
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          }}>
            <div style={textStyle}>
              {title ? <div style={{ fontWeight: 700 }}>{title}</div> : null}
              {lines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
            {accent && <div style={accent} />}
          </div>
        )}
      </div>
    </div>
  );
}
