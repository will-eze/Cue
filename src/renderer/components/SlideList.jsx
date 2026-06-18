import React from 'react';
import { sectionLabels } from '../utils/sectionLabels';

export default function SlideList({ slides, activeIdx, onSelect, onDoubleClick, variant = 'preview' }) {
  const isPreview = variant === 'preview';
  // Numbered labels (Verse 1 / Verse 2 / Chorus). Song slides arrive pre-expanded
  // with a per-part `_label`; other lists (scripture) derive labels from type.
  const computed = sectionLabels(slides, { abbrev: true });

  return (
    <div className="flex flex-col gap-sm p-sm">
      {slides.map((slide, idx) => {
        const label = slide._labelAbbr ?? computed[idx];
        const isActive = idx === activeIdx;
        return (
          <button
            key={slide._key ?? slide.id ?? idx}
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
            </p>
            <p className="text-[14px] text-on-surface leading-tight whitespace-pre-wrap max-h-24 overflow-hidden">
              {slide.content}
            </p>
          </button>
        );
      })}
    </div>
  );
}
