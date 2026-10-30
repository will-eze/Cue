import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { splitSectionContent, splitByMaxLines, maxLinesOf, sectionLabels } from '../utils/sectionLabels';
import { useLyricsCopy, sectionChipClass } from '../utils/lyricsClipboard';
import { useToast } from './Toast';
import { useModalGuard } from '../utils/modalGuard';

const TYPE_LABELS = {
  verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge',
  'pre-chorus': 'Pre-Chorus', tag: 'Tag', intro: 'Intro', outro: 'Outro',
};

export default function SongPreviewModal({ song, onClose, onEdit, onAddToRundown }) {
  useModalGuard();
  const [fullSong, setFullSong] = useState(null);
  const [globalMaxLines, setGlobalMaxLines] = useState(0);
  const lyricsRef = React.useRef(null);
  const toast = useToast();
  // ⌘C copies with section labels, ⌘⇧C lyrics only — same as the Song Editor.
  useLyricsCopy(lyricsRef, (msg) => toast.show({ message: msg, duration: 2000 }));

  useEffect(() => {
    window.cue.songs.get(song.id).then(setFullSong);
  }, [song.id]);

  // Global max-lines default — matches the operator's fallback so the preview
  // paginates identically to output. Per-song cap (fullSong.max_lines) wins.
  useEffect(() => {
    window.cue.settings.get('song_max_lines').then((v) => {
      const n = Number(v);
      setGlobalMaxLines(isFinite(n) && n > 0 ? n : 0);
    });
  }, []);

  // Effective cap for a section, mirroring expandSongSections' cascade:
  // per-song → section theme → global. (0 = unlimited.)
  const effectiveMax = (section) =>
    (Number(fullSong?.max_lines) > 0 ? Number(fullSong.max_lines) : 0)
    || maxLinesOf(section)
    || globalMaxLines;

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
                <p className="text-label-sm font-label-sm text-on-surface-variant mt-xs">
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
        <div ref={lyricsRef} className="flex-1 overflow-y-auto custom-scrollbar p-lg select-text">
          {!fullSong ? (
            <div className="text-label-sm font-label-sm text-on-surface-variant/60">Loading…</div>
          ) : fullSong.sections?.length === 0 ? (
            <div className="text-label-sm font-label-sm text-on-surface-variant/60">No sections</div>
          ) : (
            <div className="flex flex-col gap-lg">
              {fullSong.sections?.map((section, i) => {
                const labels = sectionLabels(fullSong.sections);
                return (
                  <div key={section.id || i} data-sec>
                    <div className="mb-sm">
                      <span data-sec-label className={sectionChipClass(section.type)}>{labels[i] || TYPE_LABELS[section.type] || section.type}</span>
                    </div>
                    <div data-sec-body className="whitespace-pre-wrap">
                    {splitSectionContent(section.content)
                      .flatMap((p) => splitByMaxLines(p, effectiveMax(section)))
                      .map((part, pi, arr) => (
                      <React.Fragment key={pi}>
                        {pi > 0 && <span className="hidden">{'\n\n'}</span>}
                        {pi > 0 && (
                          <div data-no-copy className="flex items-center gap-sm my-sm text-[11px] font-mono text-on-surface-variant/60 whitespace-normal">
                            <span className="flex-1 h-px bg-outline-variant/20" />slide break<span className="flex-1 h-px bg-outline-variant/20" />
                          </div>
                        )}
                        <pre className="text-body-sm text-on-surface whitespace-pre-wrap leading-relaxed m-0 font-sans">
                          {part}
                        </pre>
                      </React.Fragment>
                    ))}
                    </div>
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
            className="btn btn-secondary"
          >
            Edit
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="btn btn-ghost"
          >
            Close
          </button>
          <button
            onClick={() => onAddToRundown(song.id)}
            className="btn btn-primary"
          >
            Add to Rundown
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
