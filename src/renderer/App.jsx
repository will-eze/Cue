import React, { useState, useEffect, useRef } from 'react';
import OperatorView from './views/OperatorView';
import SettingsView from './views/SettingsView';

const platform = window.cue.platform; // 'darwin' | 'win32' | 'linux'
const isMac    = platform === 'darwin';
const isWin    = platform === 'win32';

export default function App() {
  const [view, setView] = useState('operator');
  const [ndiWarning, setNdiWarning] = useState(false);
  const [headerState, setHeaderState] = useState({ isLive: false, canGo: false });
  const [clock, setClock] = useState(() => formatTime());
  const transportRef = useRef({ go: () => {}, clear: () => {}, logo: () => {} });

  useEffect(() => {
    window.cue.on('output:unresolved-channels', (channels) => {
      if (channels.length > 0) setView('settings');
    });
    window.cue.on('output:ndi-unavailable', () => setNdiWarning(true));
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClock(formatTime()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-screen flex flex-col select-none overflow-hidden bg-background text-on-surface">

      {/* Row 1 — Titlebar (draggable) */}
      <div
        className="titlebar-drag bg-surface-container-high shrink-0 flex items-center border-b border-outline-variant/20"
        style={{ height: 38 }}
      >
        {/*
          macOS: 80px left inset clears the traffic lights (close/min/max).
          Windows: no left inset needed; custom controls sit on the right.
        */}
        <div
          className="titlebar-nodrag flex items-center gap-lg h-full px-md"
          style={{ paddingLeft: isMac ? 80 : undefined }}
        >
          <span className="font-bold text-headline-md text-primary tracking-tight">Cue</span>
          <nav className="flex gap-xs h-full items-center">
            <NavTab label="Operator" active={view === 'operator'} onClick={() => setView('operator')} />
            <NavTab label="Settings" active={view === 'settings'} onClick={() => setView('settings')} />
          </nav>
        </div>

        {/* Windows-only: custom minimize / maximize / close */}
        {isWin && (
          <div className="titlebar-nodrag flex items-center h-full ml-auto">
            <WinControl icon="remove" onClick={() => window.cue.window.minimize()} />
            <WinControl icon="crop_square" onClick={() => window.cue.window.maximize()} />
            <WinControl icon="close" onClick={() => window.cue.window.close()} danger />
          </div>
        )}
      </div>

      {/* Row 2 — Transport toolbar (never draggable) */}
      <div className="bg-surface-container shrink-0 flex items-center px-md gap-md border-b border-outline-variant/20" style={{ height: 40 }}>

        {/* Live indicator */}
        <div className="flex items-center gap-sm">
          <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${headerState.isLive ? 'bg-secondary dot-pulse' : 'bg-outline-variant'}`} />
          <span className={`text-label-sm font-label-sm uppercase tracking-[0.05em] ${headerState.isLive ? 'text-secondary' : 'text-on-surface-variant/50'}`}>
            {headerState.isLive ? 'Live' : 'Idle'}
          </span>
        </div>

        <span className="w-px h-3 bg-outline-variant/40 shrink-0" />
        <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">NDI: OK</span>
        <span className="w-px h-3 bg-outline-variant/40 shrink-0" />
        <span className="text-label-sm font-timecode-lg text-on-surface tabular-nums">{clock}</span>

        {ndiWarning && (
          <div className="flex items-center gap-xs px-sm py-1 bg-error-container/30 border border-error/30 rounded text-label-sm font-label-sm text-error ml-sm">
            <span className="material-symbols-outlined text-[13px]">warning</span>
            NDI SDK missing
            <button
              onClick={() => setNdiWarning(false)}
              className="ml-xs opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
            >
              <span className="material-symbols-outlined text-[13px]">close</span>
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* GO */}
        <button
          onClick={() => transportRef.current.go()}
          disabled={!headerState.canGo}
          className="h-7 px-lg text-headline-md font-display-lg font-extrabold uppercase tracking-widest bg-tertiary text-on-tertiary rounded transition-all active:scale-95 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90"
        >
          GO
        </button>

        {/* CLEAR */}
        <button
          onClick={() => transportRef.current.clear()}
          className="h-7 px-md text-label-sm font-label-sm font-bold uppercase bg-surface-container-high border border-error/50 text-error rounded transition-all active:scale-95 cursor-pointer hover:border-error hover:bg-error/5"
        >
          Clear
        </button>

        {/* LOGO */}
        <button
          onClick={() => transportRef.current.logo()}
          className="h-7 px-md text-label-sm font-label-sm font-bold uppercase bg-surface-container-high border border-primary/50 text-primary rounded transition-all active:scale-95 cursor-pointer hover:border-primary hover:bg-primary/5"
        >
          Logo
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {view === 'operator' ? (
          <OperatorView
            transportRef={transportRef}
            onStateChange={setHeaderState}
          />
        ) : (
          <SettingsView onClose={() => setView('operator')} />
        )}
      </div>
    </div>
  );
}

function formatTime() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function NavTab({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`titlebar-nodrag h-full flex items-center px-sm text-label-sm font-label-sm tracking-[0.05em] uppercase cursor-pointer transition-colors ${
        active
          ? 'text-primary border-b-2 border-primary'
          : 'text-on-surface-variant hover:text-on-surface border-b-2 border-transparent'
      }`}
    >
      {label}
    </button>
  );
}

// Windows-only close/min/max buttons
function WinControl({ icon, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`titlebar-nodrag h-full w-[46px] flex items-center justify-center transition-colors cursor-pointer ${
        danger
          ? 'text-on-surface-variant hover:bg-error hover:text-white'
          : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
      }`}
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
    </button>
  );
}
