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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 16,
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0E1120',
          border: '1px solid #1E2232',
          borderRadius: 6,
          width: '100%',
          maxWidth: 460,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid #181C2A',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{
                fontSize: 14,
                fontWeight: 600,
                color: '#E8EBF5',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                letterSpacing: '0.01em',
              }}>
                {song.title}
              </h2>
              {song.author && (
                <p style={{ fontSize: 11, color: '#3A3F52', marginTop: 2 }}>{song.author}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="cursor-pointer flex-shrink-0"
              style={{ color: '#2A2E42', marginTop: 2 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#7A82A0'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#2A2E42'; }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {!fullSong ? (
            <div style={{ color: '#3A3F52', fontSize: 12 }}>Loading…</div>
          ) : fullSong.sections?.length === 0 ? (
            <div style={{ color: '#3A3F52', fontSize: 12 }}>No sections</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {fullSong.sections?.map((section, i) => (
                <div key={section.id || i}>
                  <div className="section-chip" style={{ marginBottom: 8, width: 'auto', display: 'inline-flex' }}>
                    {TYPE_LABELS[section.type] || section.type}
                  </div>
                  <pre style={{
                    fontSize: 12.5,
                    color: '#A8AEBE',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'inherit',
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
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderTop: '1px solid #181C2A',
          flexShrink: 0,
        }}>
          <button
            onClick={() => onEdit(fullSong || song)}
            className="cursor-pointer transition-all"
            style={{
              height: 28,
              padding: '0 12px',
              fontSize: 11,
              fontWeight: 500,
              background: '#131626',
              border: '1px solid #1E2232',
              color: '#7A82A0',
              borderRadius: 3,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#DEE2F0'; e.currentTarget.style.borderColor = '#333852'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#7A82A0'; e.currentTarget.style.borderColor = '#1E2232'; }}
          >
            Edit
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            className="cursor-pointer"
            style={{ height: 28, padding: '0 12px', fontSize: 11, color: '#3A3F52' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#7A82A0'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#3A3F52'; }}
          >
            Close
          </button>
          <button
            onClick={() => onAddToRundown(song.id)}
            className="cursor-pointer transition-all"
            style={{
              height: 28,
              padding: '0 14px',
              fontSize: 11,
              fontWeight: 600,
              background: 'linear-gradient(180deg, #2A3A8A 0%, #1E2D72 100%)',
              border: '1px solid rgba(79,110,247,0.45)',
              color: '#A5B4FC',
              borderRadius: 3,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(79,110,247,0.8)'; e.currentTarget.style.color = '#C7D2FE'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(79,110,247,0.45)'; e.currentTarget.style.color = '#A5B4FC'; }}
          >
            Add to Rundown
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
