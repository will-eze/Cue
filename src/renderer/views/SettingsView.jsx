import React, { useState } from 'react';
import OutputChannels from '../settings/OutputChannels';
import LogoSettings from '../settings/LogoSettings';
import BackgroundSettings from '../settings/BackgroundSettings';

const SECTIONS = [
  { id: 'outputs', label: 'Output Channels' },
  { id: 'logo', label: 'Logo' },
  { id: 'backgrounds', label: 'Backgrounds' },
];

export default function SettingsView({ onClose }) {
  const [section, setSection] = useState('outputs');

  return (
    <div className="flex h-full bg-slate-900">
      {/* Sidebar */}
      <div className="w-44 bg-slate-950 border-r border-slate-800 flex flex-col flex-shrink-0 pt-3">
        <span className="panel-label px-4 mb-2">Settings</span>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`text-left px-4 py-2 text-[12px] transition-colors cursor-pointer ${
              section === s.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {section === 'outputs' && <OutputChannels />}
        {section === 'logo' && <LogoSettings />}
        {section === 'backgrounds' && <BackgroundSettings />}
      </div>
    </div>
  );
}
