import React, { useState, useEffect, useRef } from 'react';
import OperatorView from './views/OperatorView';
import MultiviewView from './views/MultiviewView';
import SettingsView from './views/SettingsView';
import { injectUserFontFaces } from './utils/fonts';

const platform = window.cue.platform; // 'darwin' | 'win32' | 'linux'
const isMac    = platform === 'darwin';
const isWin    = platform === 'win32';

export default function App() {
  const [view, setView] = useState('operator');
  const [bgRefreshTick, setBgRefreshTick] = useState(0);
  const [activeServiceId, setActiveServiceId] = useState(null);
  const [ndiWarning, setNdiWarning] = useState(false);
  const [headerState, setHeaderState] = useState({ isLive: false, canGo: false });
  const [outputWindows, setOutputWindows] = useState(0);
  const [outputsEnabled, setOutputsEnabled] = useState(true);
  const [displayMode, setDisplayMode] = useState('idle');
  // Shared start time for live foreground media — lets the operator preview seek
  // its video to match the audience output. null when no media is live.
  const [liveMediaStartAt, setLiveMediaStartAt] = useState(null);
  const [clock, setClock] = useState(() => formatTime());
  const transportRef = useRef({ go: () => {}, clear: () => {}, logo: () => {} });

  // Stage controls panel
  const [stageOpen, setStageOpen] = useState(false);
  const stagePanelRef = useRef(null);

  // Register user-installed @font-face rules once so editor previews and the
  // live/preview monitors render custom families (refreshed after a font import).
  useEffect(() => { injectUserFontFaces(); }, [bgRefreshTick]);

  // Close stage panel on outside click
  useEffect(() => {
    if (!stageOpen) return;
    const handler = (e) => {
      if (stagePanelRef.current && !stagePanelRef.current.contains(e.target)) setStageOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [stageOpen]);

  useEffect(() => {
    const offNdi   = window.cue.on('output:ndi-unavailable', () => setNdiWarning(true));
    const applyState = (s) => {
      setOutputWindows(s.activeWindows ?? 0);
      setOutputsEnabled(s.outputsEnabled ?? true);
      setDisplayMode(s.displayMode ?? 'idle');
      setLiveMediaStartAt(s.livePayload?.media ? (s.livePayload.mediaStartAt ?? null) : null);
    };
    const offState = window.cue.on('output:state-changed', applyState);
    window.cue.output.getState().then(applyState);
    return () => { offNdi(); offState(); };
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
            <NavTab label="Operator" active={view === 'operator'} onClick={() => {
              if (view === 'settings') setBgRefreshTick((t) => t + 1);
              setView('operator');
            }} />
            <NavTab label="Multiview" active={view === 'multiview'} onClick={() => setView('multiview')} />
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
        <div className="flex items-center gap-xs">
          <span
            className={`material-symbols-outlined text-[14px] ${outputWindows > 0 ? 'text-tertiary' : 'text-outline-variant'}`}
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            monitor
          </span>
          <span className={`text-label-sm font-label-sm uppercase tracking-[0.05em] ${outputWindows > 0 ? 'text-tertiary' : 'text-on-surface-variant/50'}`}>
            {outputWindows > 0 ? `${outputWindows} output${outputWindows !== 1 ? 's' : ''}` : 'No outputs'}
          </span>
        </div>
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
          title="GO — send preview to live (G)"
          className="h-7 px-lg text-headline-md font-display-lg font-extrabold uppercase tracking-widest bg-tertiary text-on-tertiary rounded transition-all active:scale-95 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90"
        >
          GO
        </button>

        {/* CLEAR — active when text is cleared, background stays */}
        <button
          onClick={() => transportRef.current.clear()}
          title="Clear output (Esc)"
          className={`h-7 px-md text-label-sm font-label-sm font-bold uppercase rounded transition-all active:scale-95 cursor-pointer flex items-center gap-xs ${
            displayMode === 'cleared'
              ? 'bg-error-container text-error border border-error/70 shadow-[0_0_8px_rgba(255,180,171,0.2)]'
              : 'bg-surface-container-high border border-error/40 text-error/80 hover:border-error hover:text-error hover:bg-error/5'
          }`}
        >
          {displayMode === 'cleared' && (
            <span className="w-[5px] h-[5px] rounded-full bg-error shrink-0" />
          )}
          Clear
        </button>

        {/* LOGO — active when logo is showing */}
        <button
          onClick={() => transportRef.current.logo()}
          title="Show logo (L)"
          className={`h-7 px-md text-label-sm font-label-sm font-bold uppercase rounded transition-all active:scale-95 cursor-pointer flex items-center gap-xs ${
            displayMode === 'logo'
              ? 'bg-primary-container/40 text-primary border border-primary/70 shadow-[0_0_8px_rgba(173,198,255,0.2)]'
              : 'bg-surface-container-high border border-primary/40 text-primary/80 hover:border-primary hover:text-primary hover:bg-primary/5'
          }`}
        >
          {displayMode === 'logo' && (
            <span className="w-[5px] h-[5px] rounded-full bg-primary shrink-0" />
          )}
          Logo
        </button>

        <span className="w-px h-3 bg-outline-variant/40 shrink-0" />

        {/* LIVE — toggles output BrowserWindows on/off */}
        <button
          onClick={() => window.cue.output.setLive(!outputsEnabled)}
          title={outputsEnabled ? 'Outputs running — click to close all output windows' : 'Outputs offline — click to open output windows'}
          className={`h-7 px-md text-label-sm font-label-sm font-bold uppercase rounded transition-all active:scale-95 cursor-pointer flex items-center gap-xs ${
            outputsEnabled
              ? 'bg-secondary-container/60 border border-secondary/50 text-secondary hover:bg-secondary-container/80'
              : 'bg-surface-container-high border border-outline-variant/30 text-on-surface-variant/50 hover:border-outline-variant/60'
          }`}
        >
          <span className={`w-[5px] h-[5px] rounded-full shrink-0 transition-colors ${outputsEnabled ? 'bg-secondary animate-pulse' : 'bg-outline-variant'}`} />
          Live
        </button>

        {/* STAGE — opens confidence monitor controls */}
        <div className="relative" ref={stagePanelRef}>
          <button
            onClick={() => setStageOpen((v) => !v)}
            title="Stage display controls"
            className={`h-7 px-md text-label-sm font-label-sm font-bold uppercase rounded transition-all active:scale-95 cursor-pointer flex items-center gap-xs ${
              stageOpen
                ? 'bg-surface-container-highest border border-outline-variant/60 text-on-surface'
                : 'bg-surface-container-high border border-outline-variant/30 text-on-surface-variant/70 hover:border-outline-variant/60 hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>monitor_heart</span>
            Stage
          </button>

          {stageOpen && <StagePanel />}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {/* OperatorView always mounted — CSS-hidden when inactive so preview/live state survives tab switches */}
        <div style={{ display: view === 'operator' ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
          <OperatorView
            transportRef={transportRef}
            onStateChange={setHeaderState}
            displayMode={displayMode}
            liveMediaStartAt={liveMediaStartAt}
            bgRefreshTick={bgRefreshTick}
            activeServiceId={activeServiceId}
            onServiceChange={setActiveServiceId}
            outputsEnabled={outputsEnabled}
            onToggleLive={() => window.cue.output.setLive(!outputsEnabled)}
          />
        </div>
        {view === 'multiview' && <MultiviewView />}
        {view === 'settings' && <SettingsView
          activeServiceId={activeServiceId}
          onClose={() => { setBgRefreshTick((t) => t + 1); setView('operator'); }}
          onRundownCleared={() => setBgRefreshTick((t) => t + 1)}
          onRundownDeleted={(deletedId) => {
            if (activeServiceId === deletedId) setActiveServiceId(null);
            setBgRefreshTick((t) => t + 1);
          }}
          onLibraryCleared={() => setBgRefreshTick((t) => t + 1)}
        />}
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

// ── Stage controls popover ────────────────────────────────────────────────────
function fmtSecs(s) {
  s = Math.max(0, Math.round(s));
  return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
}

function StagePanel() {
  const [mins, setMins]       = useState(10);
  const [secs, setSecs]       = useState(0);
  const [remaining, setRemaining] = useState(600); // displayed countdown
  const [running, setRunning] = useState(false);
  const [stageMsg, setStageMsg] = useState('');

  const tickRef      = useRef(null);
  const startedAtRef = useRef(null);
  const remAtStartRef = useRef(0);

  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

  function stopTick() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }

  function startTick(fromRemaining) {
    stopTick();
    startedAtRef.current  = Date.now();
    remAtStartRef.current = fromRemaining;
    tickRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      const rem     = Math.max(0, remAtStartRef.current - elapsed);
      setRemaining(rem);
      if (rem <= 0) { stopTick(); setRunning(false); }
    }, 100);
  }

  function adjMins(delta) {
    const n = Math.max(0, Math.min(99, mins + delta));
    setMins(n);
    if (!running) setRemaining(n * 60 + secs);
  }

  function adjSecs(delta) {
    const n = Math.max(0, Math.min(59, secs + delta));
    setSecs(n);
    if (!running) setRemaining(mins * 60 + n);
  }

  function handleSet() {
    const total = mins * 60 + secs;
    if (total <= 0) return;
    stopTick();
    setRemaining(total);
    setRunning(false);
    window.cue.output.stage.timer('set', total);
  }

  function handleToggle() {
    if (running) {
      stopTick();
      const elapsed = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0;
      const rem = Math.max(0, remAtStartRef.current - elapsed);
      setRemaining(rem);
      setRunning(false);
      window.cue.output.stage.timer('pause');
    } else {
      const cur = remaining > 0 ? remaining : mins * 60 + secs;
      startTick(cur);
      setRunning(true);
      window.cue.output.stage.timer('start');
    }
  }

  function handleReset() {
    stopTick();
    const total = mins * 60 + secs;
    setRemaining(total);
    setRunning(false);
    window.cue.output.stage.timer('reset');
  }

  function sendMsg() { window.cue.output.stage.message(stageMsg); }
  function clearMsg() { setStageMsg(''); window.cue.output.stage.message(''); }

  const dispColor = running ? 'text-secondary' : remaining > 0 ? 'text-on-surface' : 'text-outline-variant';

  return (
    <div className="absolute right-0 top-[calc(100%+6px)] w-76 bg-surface-container-low border border-outline-variant/30 rounded-xl shadow-2xl ring-1 ring-white/5 z-50 overflow-hidden" style={{ width: 296 }}>
      <div className="px-md pt-md pb-md flex flex-col gap-md">

        {/* ── Timer ── */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-outline mb-sm">Time Remaining</p>

          {/* Live countdown display */}
          <div className={`text-center font-mono font-bold tabular-nums mb-sm transition-colors ${dispColor}`} style={{ fontSize: 36 }}>
            {fmtSecs(remaining)}
          </div>

          {/* MM : SS spin controls */}
          <div className="flex items-center justify-center gap-sm mb-sm">
            {/* Minutes */}
            <div className="flex flex-col items-center gap-[3px]">
              <button onClick={() => adjMins(1)}  className="w-7 h-5 flex items-center justify-center text-[11px] text-on-surface-variant hover:text-on-surface bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/30 rounded cursor-pointer transition-colors">▲</button>
              <span className="text-[22px] font-mono font-bold tabular-nums text-on-surface w-10 text-center leading-none py-[2px]">{String(mins).padStart(2,'0')}</span>
              <button onClick={() => adjMins(-1)} className="w-7 h-5 flex items-center justify-center text-[11px] text-on-surface-variant hover:text-on-surface bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/30 rounded cursor-pointer transition-colors">▼</button>
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] text-outline mt-[2px]">min</span>
            </div>

            <span className="text-[24px] font-bold text-outline-variant pb-4">:</span>

            {/* Seconds */}
            <div className="flex flex-col items-center gap-[3px]">
              <button onClick={() => adjSecs(10)} className="w-7 h-5 flex items-center justify-center text-[11px] text-on-surface-variant hover:text-on-surface bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/30 rounded cursor-pointer transition-colors">▲</button>
              <span className="text-[22px] font-mono font-bold tabular-nums text-on-surface w-10 text-center leading-none py-[2px]">{String(secs).padStart(2,'0')}</span>
              <button onClick={() => adjSecs(-10)} className="w-7 h-5 flex items-center justify-center text-[11px] text-on-surface-variant hover:text-on-surface bg-surface-container-high hover:bg-surface-container-highest border border-outline-variant/30 rounded cursor-pointer transition-colors">▼</button>
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] text-outline mt-[2px]">sec</span>
            </div>
          </div>

          {/* Action row */}
          <div className="flex gap-xs">
            <button onClick={handleSet}
              className="h-7 px-sm text-[10px] font-mono uppercase tracking-[0.05em] bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:border-outline-variant hover:text-on-surface rounded transition-colors cursor-pointer whitespace-nowrap">
              Set
            </button>
            <button onClick={handleToggle}
              className={`flex-1 h-7 text-[10px] font-mono uppercase tracking-[0.05em] rounded border transition-colors cursor-pointer ${
                running
                  ? 'bg-surface-container-high border-outline-variant/40 text-on-surface-variant hover:border-outline-variant'
                  : 'bg-tertiary-container/80 border-tertiary/50 text-tertiary hover:bg-tertiary-container'
              }`}>
              {running ? '⏸ Pause' : '▶ Start'}
            </button>
            <button onClick={handleReset}
              className="h-7 px-sm text-[10px] font-mono uppercase tracking-[0.05em] bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:border-outline-variant hover:text-on-surface rounded transition-colors cursor-pointer">
              ↺
            </button>
          </div>
        </div>

        <div className="h-px bg-outline-variant/20" />

        {/* ── Message ── */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-outline mb-sm">Stage Message</p>
          <textarea
            value={stageMsg}
            onChange={(e) => setStageMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendMsg(); }}
            placeholder="Type a message for the presenter…"
            rows={2}
            className="w-full px-sm py-xs bg-surface-container-lowest border border-outline-variant/50 rounded-lg text-[12px] text-on-surface focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none resize-none custom-scrollbar"
          />
          <div className="flex gap-xs mt-xs">
            <button onClick={sendMsg} disabled={!stageMsg.trim()}
              className="flex-1 h-7 text-[10px] font-mono uppercase tracking-[0.05em] bg-primary-container/70 border border-primary/40 text-primary hover:bg-primary-container rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
              Send
            </button>
            <button onClick={clearMsg}
              className="h-7 px-sm text-[10px] font-mono uppercase tracking-[0.05em] bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:border-outline-variant hover:text-on-surface rounded transition-colors cursor-pointer">
              Clear
            </button>
          </div>
        </div>

      </div>
    </div>
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
