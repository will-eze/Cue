import React, { useState, useEffect } from 'react';
import OperatorView from './views/OperatorView';
import SettingsView from './views/SettingsView';

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

export default function App() {
  const [view, setView] = useState('operator');
  const [ndiWarning, setNdiWarning] = useState(false);

  useEffect(() => {
    window.cue.on('output:unresolved-channels', (channels) => {
      if (channels.length > 0) setView('settings');
    });
    window.cue.on('output:ndi-unavailable', () => setNdiWarning(true));
  }, []);

  return (
    <div className="h-screen flex flex-col select-none overflow-hidden" style={{ background: '#060810', color: '#DEE2F0' }}>
      {/* Titlebar */}
      <nav
        className="titlebar-drag flex items-center flex-shrink-0"
        style={{
          height: 38,
          paddingLeft: isMac ? 80 : 12,
          paddingRight: 12,
          background: 'linear-gradient(180deg, #0A0C16 0%, #080A12 100%)',
          borderBottom: '1px solid #181C2A',
        }}
      >
        {/* Wordmark */}
        <div className="titlebar-nodrag flex items-center gap-2 mr-6 flex-shrink-0">
          <div style={{
            width: 18, height: 18,
            background: 'linear-gradient(135deg, #4F6EF7 0%, #7C4DFF 100%)',
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <circle cx="5" cy="5" r="3" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5"/>
              <circle cx="5" cy="5" r="1" fill="rgba(255,255,255,0.9)"/>
            </svg>
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.25em', color: '#E8EBF5' }}>
            CUE
          </span>
        </div>

        {/* Nav tabs */}
        <div className="titlebar-nodrag flex items-center" style={{ gap: 2 }}>
          <NavTab label="Operator" active={view === 'operator'} onClick={() => setView('operator')} />
          <NavTab label="Settings" active={view === 'settings'} onClick={() => setView('settings')} />
        </div>

        {/* NDI warning */}
        {ndiWarning && (
          <div className="titlebar-nodrag ml-4 flex items-center gap-2"
            style={{
              fontSize: 11,
              color: '#FCD34D',
              background: 'rgba(120,80,0,0.25)',
              border: '1px solid rgba(180,120,0,0.4)',
              padding: '0 8px',
              height: 22,
              borderRadius: 3,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="#FCD34D">
              <path d="M5 1.5L9 8.5H1L5 1.5Z" strokeWidth="0"/>
              <rect x="4.5" y="4" width="1" height="2.5" fill="#060810" rx="0.5"/>
              <circle cx="5" cy="7.2" r="0.5" fill="#060810"/>
            </svg>
            NDI SDK not installed
            <button
              onClick={() => setNdiWarning(false)}
              className="cursor-pointer"
              style={{ color: '#FCD34D', opacity: 0.6, marginLeft: 2, lineHeight: 1 }}
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor">
                <path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}
      </nav>

      <div className="flex-1 overflow-hidden">
        {view === 'operator' ? (
          <OperatorView />
        ) : (
          <SettingsView onClose={() => setView('operator')} />
        )}
      </div>
    </div>
  );
}

function NavTab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer transition-all duration-150"
      style={{
        height: 24,
        padding: '0 12px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        borderRadius: 4,
        border: active ? '1px solid rgba(79,110,247,0.5)' : '1px solid transparent',
        background: active
          ? 'linear-gradient(180deg, #2A3A8A 0%, #1E2D72 100%)'
          : 'transparent',
        color: active ? '#A5B4FC' : '#404563',
      }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = '#8890A8'; e.currentTarget.style.background = '#0F1220'; }}}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = '#404563'; e.currentTarget.style.background = 'transparent'; }}}
    >
      {label}
    </button>
  );
}
