import React, { useState } from 'react';
import OutputChannels from '../settings/OutputChannels';
import LogoSettings from '../settings/LogoSettings';
import BackgroundSettings from '../settings/BackgroundSettings';

const SECTIONS = [
  {
    id: 'outputs',
    label: 'Output Channels',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        <rect x="1" y="3" width="14" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="6" y="13" width="4" height="1.5" rx="0.5"/>
        <line x1="4" y1="14.5" x2="12" y2="14.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'logo',
    label: 'Logo',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="8" cy="8" r="2.5"/>
      </svg>
    ),
  },
  {
    id: 'backgrounds',
    label: 'Backgrounds',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        <rect x="1" y="2" width="14" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4"/>
        <circle cx="5.5" cy="6" r="1.5"/>
        <path d="M2 12l4-4 3 3 2-2 3 3"/>
      </svg>
    ),
  },
];

export default function SettingsView({ onClose }) {
  const [section, setSection] = useState('outputs');

  return (
    <div className="flex h-full" style={{ background: '#060810' }}>
      {/* Sidebar */}
      <div className="flex-shrink-0 flex flex-col" style={{
        width: 180,
        background: '#0A0C14',
        borderRight: '1px solid #181C2A',
        paddingTop: 16,
      }}>
        {/* Sidebar header */}
        <div style={{ padding: '0 14px 14px', borderBottom: '1px solid #12151F' }}>
          <div className="flex items-center gap-2.5 mb-0.5">
            <div style={{ width: 2, height: 14, background: '#4F6EF7', borderRadius: 1 }} />
            <span className="panel-label">Settings</span>
          </div>
        </div>

        {/* Nav items */}
        <div style={{ padding: '8px 8px', flex: 1 }}>
          {SECTIONS.map((s) => {
            const isActive = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className="w-full text-left cursor-pointer transition-all"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '7px 10px',
                  borderRadius: 4,
                  marginBottom: 2,
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  border: isActive ? '1px solid rgba(79,110,247,0.3)' : '1px solid transparent',
                  background: isActive ? 'linear-gradient(90deg, rgba(79,110,247,0.15) 0%, rgba(79,110,247,0.05) 100%)' : 'transparent',
                  color: isActive ? '#A5B4FC' : '#3A3F52',
                }}
                onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = '#7A82A0'; e.currentTarget.style.background = '#0E1018'; }}}
                onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = '#3A3F52'; e.currentTarget.style.background = 'transparent'; }}}
              >
                <span style={{ flexShrink: 0, color: isActive ? '#4F6EF7' : '#2A2E42' }}>
                  {s.icon}
                </span>
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Back to operator */}
        <div style={{ padding: '12px 8px', borderTop: '1px solid #12151F' }}>
          <button
            onClick={onClose}
            className="w-full cursor-pointer transition-all"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 10px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 500,
              border: '1px solid #1A1D27',
              background: 'transparent',
              color: '#3A3F52',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#7A82A0'; e.currentTarget.style.borderColor = '#333852'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#3A3F52'; e.currentTarget.style.borderColor = '#1A1D27'; }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M7.5 2L3.5 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            Operator View
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: 28 }}>
        {section === 'outputs' && <OutputChannels />}
        {section === 'logo' && <LogoSettings />}
        {section === 'backgrounds' && <BackgroundSettings />}
      </div>
    </div>
  );
}
