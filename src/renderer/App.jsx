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
    <div className="h-screen flex flex-col select-none overflow-hidden"
      style={{ background: '#0C0A08', color: '#C8C0B6' }}
    >
      {/* Titlebar */}
      <nav
        className="titlebar-drag flex items-center flex-shrink-0"
        style={{
          height: 36,
          paddingLeft: isMac ? 78 : 12,
          paddingRight: 12,
          background: 'linear-gradient(180deg, #181410 0%, #121008 100%)',
          borderBottom: '1px solid #201D18',
        }}
      >
        {/* Wordmark */}
        <div className="titlebar-nodrag flex items-center gap-2.5 mr-6 flex-shrink-0">
          {/* Amber signal lamp icon */}
          <div style={{ position: 'relative', width: 16, height: 16, flexShrink: 0 }}>
            <div style={{
              width: 16, height: 16,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 35% 35%, #F0A030 0%, #C87C14 50%, #8A5510 100%)',
              boxShadow: '0 0 8px rgba(200,124,20,0.5), 0 0 16px rgba(200,124,20,0.2)',
            }} />
            <div style={{
              position: 'absolute',
              top: 3, left: 3,
              width: 5, height: 4,
              borderRadius: '50%',
              background: 'rgba(255,220,150,0.55)',
              transform: 'rotate(-20deg)',
            }} />
          </div>
          <span style={{
            fontFamily: "'Oswald', 'Inter', sans-serif",
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '0.35em',
            color: '#C8C0B6',
            textTransform: 'uppercase',
          }}>
            CUE
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 16, background: '#2A2520', marginRight: 16, flexShrink: 0 }} />

        {/* Nav buttons */}
        <div className="titlebar-nodrag flex items-center" style={{ gap: 2 }}>
          <TitlebarTab label="Operator" active={view === 'operator'} onClick={() => setView('operator')} />
          <TitlebarTab label="Settings" active={view === 'settings'} onClick={() => setView('settings')} />
        </div>

        {/* Right side spacer */}
        <div style={{ flex: 1 }} />

        {/* NDI warning */}
        {ndiWarning && (
          <div className="titlebar-nodrag flex items-center gap-2"
            style={{
              fontFamily: "'Oswald', sans-serif",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#C87C14',
              background: 'rgba(90,55,0,0.3)',
              border: '1px solid rgba(200,124,20,0.3)',
              padding: '0 10px',
              height: 22,
              borderRadius: 2,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M5 1L9.3 8.5H0.7L5 1Z"/>
              <rect x="4.5" y="4" width="1" height="2.5" fill="#0C0A08" rx="0.4"/>
              <circle cx="5" cy="7.2" r="0.5" fill="#0C0A08"/>
            </svg>
            NDI SDK not installed
            <button
              onClick={() => setNdiWarning(false)}
              className="cursor-pointer"
              style={{ color: '#C87C14', opacity: 0.6, marginLeft: 4, lineHeight: 1 }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1 1l6 6M7 1l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
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

function TitlebarTab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="cursor-pointer"
      style={{
        fontFamily: "'Oswald', 'Inter', sans-serif",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        height: 24,
        padding: '0 12px',
        borderRadius: 2,
        border: active ? '1px solid rgba(200,124,20,0.45)' : '1px solid transparent',
        background: active ? 'rgba(200,124,20,0.12)' : 'transparent',
        color: active ? '#C87C14' : '#504540',
        transition: 'all 120ms',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color = '#7A7068';
          e.currentTarget.style.background = '#1A1714';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color = '#504540';
          e.currentTarget.style.background = 'transparent';
        }
      }}
    >
      {label}
    </button>
  );
}
