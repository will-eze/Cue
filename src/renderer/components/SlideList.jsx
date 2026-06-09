import React from 'react';

const SECTION_LABELS = {
  verse: 'Verse',
  chorus: 'Chorus',
  bridge: 'Bridge',
  'pre-chorus': 'Pre-Ch',
  tag: 'Tag',
  intro: 'Intro',
  outro: 'Outro',
  slide: 'Slide',
};

export default function SlideList({ slides, activeIdx, onSelect, onDoubleClick, variant = 'preview' }) {
  const isPreview = variant === 'preview';

  return (
    <div className="flex flex-col gap-sm p-sm">
      {slides.map((slide, idx) => {
        const label = SECTION_LABELS[slide.type] || slide.type || 'Section';
        const isActive = idx === activeIdx;
        return (
          <button
            key={slide.id ?? idx}
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
            <p className={`text-[8px] font-label-sm uppercase mb-xs tracking-widest ${
              isActive ? (isPreview ? 'text-primary' : 'text-secondary') : 'text-on-surface-variant'
            }`}>
              {label}
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
