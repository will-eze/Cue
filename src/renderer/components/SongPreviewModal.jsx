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
    function handleKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#111008',
          border: '1px solid #2A2520',
          borderTop: '2px solid #C8780A',
          borderRadius: 2,
          width: '100%',
          maxWidth: 460,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.85)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #201D18', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 14, fontWeight: 600,
                color: '#C8C0B6',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                letterSpacing: '0.01em',
              }}>
                {song.title}
              </h2>
              {song.author && (
                <p style={{ fontFamily: "'Inter', sans-serif", fontSize: 11, color: '#3A332A', marginTop: 2 }}>{song.author}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="cursor-pointer flex-shrink-0"
              style={{ color: '#2A2218', marginTop: 2 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#7A7068'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#2A2218'; }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {!fullSong ? (
            <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#3A332A' }}>Loading…</div>
          ) : fullSong.sections?.length === 0 ? (
            <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#3A332A' }}>No sections</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {fullSong.sections?.map((section, i) => (
                <div key={section.id || i}>
                  <div className="section-chip" style={{ marginBottom: 8, width: 'auto', display: 'inline-flex' }}>
                    {TYPE_LABELS[section.type] || section.type}
                  </div>
                  <pre style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12.5,
                    color: '#807060',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.65,
                    margin: 0,
                  }}>
                    {section.content}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: '1px solid #201D18', flexShrink: 0 }}>
          <button
            onClick={() => onEdit(fullSong || song)}
            className="cursor-pointer"
            style={{
              fontFamily: "'Inter', sans-serif",
              height: 28, padding: '0 12px', fontSize: 11, fontWeight: 500,
              background: '#141210', border: '1px solid #2A2520',
              color: '#7A7068', borderRadius: 2,
              transition: 'all 100ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#C8C0B6'; e.currentTarget.style.borderColor = '#3A332A'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#7A7068'; e.currentTarget.style.borderColor = '#2A2520'; }}
          >
            Edit
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            className="cursor-pointer"
            style={{ fontFamily: "'Inter', sans-serif", height: 28, padding: '0 12px', fontSize: 11, color: '#3A332A' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#7A7068'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#3A332A'; }}
          >
            Close
          </button>
          <button
            onClick={() => onAddToRundown(song.id)}
            className="cursor-pointer"
            style={{
              fontFamily: "'Oswald', 'Inter', sans-serif",
              fontSize: 10, fontWeight: 500, letterSpacing: '0.16em', textTransform: 'uppercase',
              height: 28, padding: '0 14px',
              background: 'linear-gradient(180deg, #3A2C10 0%, #261E08 100%)',
              border: '1px solid rgba(200,120,10,0.4)',
              color: '#C87C14', borderRadius: 2,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
              transition: 'all 100ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(200,120,10,0.75)'; e.currentTarget.style.color = '#E8A020'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(200,120,10,0.4)'; e.currentTarget.style.color = '#C87C14'; }}
          >
            Add to Rundown
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
