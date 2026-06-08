import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

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
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-700 rounded-sm w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-slate-100 truncate">
                {song.title}
              </h2>
              {song.author && (
                <p className="text-[11px] text-slate-500 mt-0.5">{song.author}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-slate-600 hover:text-slate-300 flex-shrink-0 mt-0.5 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!fullSong ? (
            <div className="text-slate-500 text-[12px]">Loading…</div>
          ) : fullSong.sections?.length === 0 ? (
            <div className="text-slate-500 text-[12px]">No sections</div>
          ) : (
            fullSong.sections?.map((section, i) => (
              <div key={section.id || i}>
                <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-slate-500 mb-1.5">
                  {TYPE_LABELS[section.type] || section.type}
                </div>
                <pre className="text-[13px] text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">
                  {section.content}
                </pre>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-700 flex-shrink-0">
          <button
            onClick={() => onEdit(fullSong || song)}
            className="px-3 h-7 text-[11px] text-slate-400 hover:text-slate-200 bg-slate-700 hover:bg-slate-600 rounded-sm transition-colors cursor-pointer"
          >
            Edit
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-3 h-7 text-[11px] text-slate-500 hover:text-slate-300 cursor-pointer"
          >
            Close
          </button>
          <button
            onClick={() => onAddToRundown(song.id)}
            className="px-4 h-7 text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white rounded-sm font-semibold transition-colors cursor-pointer"
          >
            Add to Rundown
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
