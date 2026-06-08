import React, { useState } from 'react';
import OutputChannels from '../settings/OutputChannels';
import LogoSettings from '../settings/LogoSettings';
import BackgroundSettings from '../settings/BackgroundSettings';

const SECTIONS = [
  {
    id: 'outputs',
    label: 'Output Channels',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="1" y="3" width="14" height="10" rx="1.5"/>
        <rect x="6.5" y="13" width="3" height="1.5" rx="0.5"/>
        <line x1="4" y1="14.5" x2="12" y2="14.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'logo',
    label: 'Logo',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    id: 'backgrounds',
    label: 'Backgrounds',
    icon: (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="1" y="2" width="14" height="12" rx="1.5"/>
        <circle cx="5.5" cy="6" r="1.5" fill="currentColor" stroke="none"/>
        <path d="M2 12l4-4 3 3 2-2 3 3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

export default function SettingsView({ onClose }) {
  const [section, setSection] = useState('outputs');

  return (
    <div style={{ display: 'flex', height: '100%', background: '#0C0A08' }}>
      {/* Sidebar */}
      <div style={{ width: 176, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#0F0D0A', borderRight: '1px solid #181510' }}>
        {/* Sidebar header */}
        <div style={{ padding: '0 10px', height: 30, display: 'flex', alignItems: 'center', background: 'linear-gradient(180deg, #1A1714 0%, #141210 100%)', borderTop: '1.5px solid #C8780A', borderBottom: '1px solid #201D18', flexShrink: 0 }}>
          <span className="panel-label">Settings</span>
        </div>

        {/* Nav items */}
        <div style={{ padding: '8px 6px', flex: 1 }}>
          {SECTIONS.map((s) => {
            const isActive = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className="w-full text-left cursor-pointer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '7px 10px',
                  borderRadius: 2,
                  marginBottom: 2,
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12,
                  fontWeight: isActive ? 500 : 400,
                  border: isActive ? '1px solid rgba(200,120,10,0.35)' : '1px solid transparent',
                  background: isActive ? 'rgba(200,120,10,0.10)' : 'transparent',
                  color: isActive ? '#C87C14' : '#403830',
                  transition: 'all 100ms',
                }}
                onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = '#7A7068'; e.currentTarget.style.background = '#141210'; }}}
                onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = '#403830'; e.currentTarget.style.background = 'transparent'; }}}
              >
                <span style={{ flexShrink: 0, color: isActive ? '#C87C14' : '#2A2218' }}>
                  {s.icon}
                </span>
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Back to operator */}
        <div style={{ padding: '10px 6px', borderTop: '1px solid #181510', flexShrink: 0 }}>
          <button
            onClick={onClose}
            className="w-full cursor-pointer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 10px',
              borderRadius: 2,
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              fontWeight: 400,
              border: '1px solid #201D18',
              background: 'transparent',
              color: '#3A332A',
              transition: 'all 100ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#7A7068'; e.currentTarget.style.borderColor = '#3A332A'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#3A332A'; e.currentTarget.style.borderColor = '#201D18'; }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6.5 2L2.5 5l4 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Operator View
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
        {section === 'outputs' && <OutputChannels />}
        {section === 'logo' && <LogoSettings />}
        {section === 'backgrounds' && <BackgroundSettings />}
      </div>
    </div>
  );
}
