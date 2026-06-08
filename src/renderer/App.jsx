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
    <div className="h-screen bg-slate-900 text-slate-200 flex flex-col select-none overflow-hidden">
      {/* Titlebar / Nav — draggable region */}
      <nav
        className="titlebar-drag flex items-center flex-shrink-0 bg-slate-950 border-b border-slate-800"
        style={{ height: 36, paddingLeft: isMac ? 76 : 12, paddingRight: 12 }}
      >
        {/* Wordmark */}
        <span className="titlebar-nodrag text-[11px] font-bold tracking-[0.3em] text-slate-100 mr-5 flex-shrink-0">
          CUE
        </span>

        {/* Nav buttons */}
        <div className="titlebar-nodrag flex items-center gap-1">
          <button
            onClick={() => setView('operator')}
            className={`px-3 h-[22px] text-[11px] font-medium rounded-sm transition-colors cursor-pointer ${
              view === 'operator'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            Operator
          </button>
          <button
            onClick={() => setView('settings')}
            className={`px-3 h-[22px] text-[11px] font-medium rounded-sm transition-colors cursor-pointer ${
              view === 'settings'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
            }`}
          >
            Settings
          </button>
        </div>

        {/* NDI warning */}
        {ndiWarning && (
          <div className="titlebar-nodrag ml-4 flex items-center gap-2 text-[11px] text-amber-400 bg-amber-900/20 border border-amber-900/60 px-2.5 h-[22px] rounded-sm">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M5 1L9 8H1L5 1Z" strokeWidth="0" fillOpacity="0.9"/>
            </svg>
            NDI SDK not installed
            <button
              onClick={() => setNdiWarning(false)}
              className="ml-1 text-amber-500 hover:text-amber-300 cursor-pointer"
            >
              ✕
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
