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

export default function SlideList({ slides, activeIdx, onSelect, onDoubleClick }) {
  return (
    <div className="flex flex-col">
      {slides.map((slide, idx) => {
        const label = SECTION_LABELS[slide.type] || slide.type || 'Section';
        const isActive = idx === activeIdx;
        return (
          <button
            key={slide.id ?? idx}
            onClick={() => onSelect(idx)}
            onDoubleClick={onDoubleClick ? () => onDoubleClick(idx) : undefined}
            className={`flex items-start gap-2.5 px-3 py-2.5 text-left w-full cursor-pointer transition-all border-l-2 ${
              isActive ? 'slide-active' : 'border-l-transparent'
            }`}
            style={{ borderBottom: '1px solid #0D101A' }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = '#0C0E18'; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = ''; }}
          >
            <span className="section-chip mt-0.5">
              {label}
            </span>
            <span className="slide-text text-[11px] whitespace-pre-line leading-relaxed flex-1"
              style={{ color: isActive ? undefined : '#3A3F52', lineHeight: '1.55' }}
            >
              {slide.content}
            </span>
          </button>
        );
      })}
    </div>
  );
}
