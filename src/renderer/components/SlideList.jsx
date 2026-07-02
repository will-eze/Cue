import React, { useRef, useEffect } from 'react';
import { sectionLabels } from '../utils/sectionLabels';

export default function SlideList({ slides, activeIdx, onSelect, onDoubleClick, variant = 'preview', jumpKeys = null }) {
  const isPreview = variant === 'preview';
  // Numbered labels (Verse 1 / Verse 2 / Chorus). Song slides arrive pre-expanded
  // with a per-part `_label`; other lists (scripture) derive labels from type.
  const computed = sectionLabels(slides, { abbrev: true });

  const containerRef = useRef(null);

  // Scroll the active slide into view whenever activeIdx changes.
  // block:'nearest' is unobtrusive — no-op when the slide is already visible.
  useEffect(() => {
    if (activeIdx == null || activeIdx < 0) return;
    containerRef.current
      ?.querySelector(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  return (
    <div ref={containerRef} className="flex flex-col gap-sm p-sm">
      {slides.map((slide, idx) => {
        const label = slide._labelAbbr ?? computed[idx];
        const isActive = idx === activeIdx;
        // Positional verse-jump hint (Q W E …) — only when the jump keys are armed
        // and this slide is within the key set. A small monospace chip on the right.
        const jumpKey = jumpKeys && idx < jumpKeys.length ? jumpKeys[idx] : null;
        return (
          <button
            key={slide._key ?? slide.id ?? idx}
            data-idx={idx}
            onClick={() => onSelect(idx)}
            onDoubleClick={onDoubleClick ? () => onDoubleClick(idx) : undefined}
            className={`shrink-0 p-sm rounded text-left w-full cursor-pointer transition-all border-l-4 ${
              isActive
                ? isPreview
                  ? 'bg-primary-container/20 border-primary'
                  : 'bg-secondary-container/20 border-secondary'
                : 'bg-surface-container border-outline-variant/30 opacity-60 hover:opacity-100'
            }`}
          >
            <p className={`text-[8px] font-label-sm uppercase mb-xs tracking-widest flex items-center gap-1 ${
              isActive ? (isPreview ? 'text-primary' : 'text-secondary') : 'text-on-surface-variant'
            }`}>
              <span>{label}</span>
              {slide._partCount > 1 && (
                <span className="text-on-surface-variant/60 tabular-nums normal-case tracking-normal">
                  {slide._partIndex + 1}/{slide._partCount}
                </span>
              )}
              {jumpKey && (
                <span className={`ml-auto inline-flex items-center justify-center min-w-[14px] h-[14px] px-[3px] rounded-sm text-[8px] font-mono font-bold leading-none border ${
                  isActive
                    ? (isPreview
                        ? 'border-primary/50 text-primary bg-primary-container/20'
                        : 'border-secondary/50 text-secondary bg-secondary-container/20')
                    : 'border-outline-variant/40 text-on-surface-variant/70'
                }`}>
                  {jumpKey.toUpperCase()}
                </span>
              )}
            </p>
            <p className="text-[14px] text-on-surface leading-tight whitespace-pre-wrap">
              {slide.content}
            </p>
          </button>
        );
      })}
    </div>
  );
}
