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
            className={`flex items-start gap-2 px-3 py-2.5 text-left border-b border-slate-800 w-full cursor-pointer transition-all ${
              isActive ? 'slide-active border-l-2' : 'hover:bg-slate-800 border-l-2 border-l-transparent'
            }`}
          >
            <span className={`slide-label text-[10px] font-bold tracking-[0.15em] w-14 flex-shrink-0 mt-0.5 uppercase ${
              isActive ? '' : 'text-slate-600'
            }`}>
              {label}
            </span>
            <span className={`text-[11px] whitespace-pre-line leading-relaxed flex-1 ${
              isActive ? 'text-slate-100' : 'text-slate-500'
            }`}>
              {slide.content}
            </span>
          </button>
        );
      })}
    </div>
  );
}
