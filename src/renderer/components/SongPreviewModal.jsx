import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { splitSectionContent } from '../utils/sectionLabels';

const TYPE_LABELS = {
  verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge',
  'pre-chorus': 'Pre-Chorus', tag: 'Tag', intro: 'Intro', outro: 'Outro',
};

export default function SongPreviewModal({ song, onClose, onEdit, onAddToRundown }) {
  const [fullSong, setFullSong] = useState(null);

  useEffect(() => {
    window.cue.songs.get(song.id).then(setFullSong);
  }, [song.id]);

  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl ring-1 ring-white/5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-lg py-md border-b border-outline-variant/20 bg-surface-container-high rounded-t-xl flex-shrink-0">
          <div className="flex items-start justify-between gap-md">
            <div className="min-w-0">
              <h2 className="text-headline-md font-bold text-primary truncate tracking-tight">
                {song.title}
              </h2>
              {song.author && (
                <p className="text-label-sm font-label-sm text-on-surface-variant mt-xs uppercase tracking-[0.05em]">
                  {song.author}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer flex-shrink-0 mt-xs"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-lg">
          {!fullSong ? (
            <div className="text-label-sm font-label-sm text-on-surface-variant/40 uppercase tracking-[0.05em]">Loading…</div>
          ) : fullSong.sections?.length === 0 ? (
            <div className="text-label-sm font-label-sm text-on-surface-variant/40 uppercase tracking-[0.05em]">No sections</div>
          ) : (
            <div className="flex flex-col gap-lg">
              {fullSong.sections?.map((section, i) => {
                const isChorus = section.type === 'chorus' || section.type === 'refrain';
                return (
                  <div key={section.id || i} className={`${isChorus ? 'border-l-2 border-primary pl-md' : 'border-l-2 border-outline-variant/20 pl-md'}`}>
                    <div className={`section-chip mb-sm inline-flex ${isChorus ? 'bg-primary text-on-primary border-transparent' : ''}`}>
                      {TYPE_LABELS[section.type] || section.type}
                    </div>
                    {splitSectionContent(section.content).map((part, pi, arr) => (
                      <React.Fragment key={pi}>
                        {pi > 0 && (
                          <div className="flex items-center gap-sm my-sm text-[8px] font-mono text-on-surface-variant/30 uppercase tracking-[0.1em]">
                            <span className="flex-1 h-px bg-outline-variant/20" />slide break<span className="flex-1 h-px bg-outline-variant/20" />
                          </div>
                        )}
                        <pre className="text-body-sm text-on-surface whitespace-pre-wrap leading-relaxed m-0 font-sans">
                          {part}
                        </pre>
                      </React.Fragment>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-sm px-lg py-md border-t border-outline-variant/20 bg-surface-container-high rounded-b-xl flex-shrink-0">
          <button
            onClick={() => onEdit(fullSong || song)}
            className="px-md h-8 text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface bg-surface-container hover:bg-surface-variant border border-outline-variant/30 rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em]"
          >
            Edit
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-md h-8 text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-variant transition-colors cursor-pointer uppercase tracking-[0.05em]"
          >
            Close
          </button>
          <button
            onClick={() => onAddToRundown(song.id)}
            className="px-md h-8 text-label-sm font-label-sm bg-primary text-on-primary rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em] hover:opacity-90"
          >
            Add to Rundown
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
