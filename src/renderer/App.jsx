import React, { useState, useEffect, useRef } from 'react';
import OperatorView from './views/OperatorView';
import MultiviewView from './views/MultiviewView';
import StreamView from './views/StreamView';
import StageView from './views/StageView';
import SettingsView from './views/SettingsView';
import TopBarTabs from './components/TopBarTabs';
import ErrorBoundary from './components/ErrorBoundary';
import UpdateAvailableModal from './components/UpdateAvailableModal';
import { injectUserFontFaces } from './utils/fonts';
import { hasOpenModal } from './utils/modalGuard';
import { resolveAnchors, collides, overlapIds } from '../shared/stage-schedule.js';

const platform = window.cue.platform; // 'darwin' | 'win32' | 'linux'
const isMac    = platform === 'darwin';
const isWin    = platform === 'win32';

export default function App() {
  const [view, setView] = useState('operator');
  // Deep-link into a Settings subsection (set when a pinned subsection tab is used);
  // the nonce re-fires the scroll even when the same tab is re-clicked.
  const [settingsSection, setSettingsSection] = useState(null);
  const [settingsNonce, setSettingsNonce] = useState(0);
  // Operator-customised extra top-bar tabs (pinned Settings subsections, ordered).
  // Persisted in settings under `topbar_tabs`. Base Operator/Multiview/Settings tabs
  // are always shown and live outside this list.
  const [extraTabs, setExtraTabs] = useState([]);
  const [bgRefreshTick, setBgRefreshTick] = useState(0);
  const [activeServiceId, setActiveServiceId] = useState(null);
  const [ndiWarning, setNdiWarning] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null); // launch-time auto-check result, see index.js
  const [headerState, setHeaderState] = useState({ isLive: false, canGo: false, micActive: false });
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

  // Stage panel keyboard shortcut (backtick)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '`' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      setStageOpen((v) => !v);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
    const offUpdate = window.cue.on('update:available', (res) => setUpdateInfo(res));
    const applyState = (s) => {
      setOutputWindows(s.activeWindows ?? 0);
      setOutputsEnabled(s.outputsEnabled ?? true);
      setDisplayMode(s.displayMode ?? 'idle');
      setLiveMediaStartAt(s.livePayload?.media ? (s.livePayload.mediaStartAt ?? null) : null);
    };
    const offState = window.cue.on('output:state-changed', applyState);
    window.cue.output.getState().then(applyState);
    return () => { offNdi(); offUpdate(); offState(); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClock(formatTime()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load the persisted custom top-bar tabs once.
  useEffect(() => {
    window.cue.settings.get('topbar_tabs').then((list) => {
      if (Array.isArray(list)) setExtraTabs(list.filter((t) => typeof t === 'string'));
    });
  }, []);

  function persistTabs(next) {
    setExtraTabs(next);
    window.cue.settings.set('topbar_tabs', next);
  }

  // Single entry point for top-bar navigation. Routes base views and `settings:<id>`
  // deep-links, and preserves the existing "refresh operator state when leaving
  // Settings" behaviour (so background/shortcut edits take effect on return).
  function navigateTo(tabId) {
    const leavingSettings = view === 'settings';
    if (tabId === 'operator' || tabId === 'multiview' || tabId === 'stream' || tabId === 'stage') {
      if (leavingSettings) setBgRefreshTick((t) => t + 1);
      setView(tabId);
      return;
    }
    const section = tabId.startsWith('settings:') ? tabId.slice('settings:'.length) : null;
    setSettingsSection(section);
    setSettingsNonce((n) => n + 1);
    setView('settings');
  }

  // ⌘, / Ctrl+, — the universal "Preferences" accelerator: jump to Settings, or
  // back to Operator if already there. Stands down while a modal/editor owns the
  // screen so it can't yank the view out from under an open dialog. A ref keeps
  // the always-mounted listener reading the current view + navigateTo.
  const settingsShortcutRef = useRef(null);
  settingsShortcutRef.current = () => navigateTo(view === 'settings' ? 'operator' : 'settings');
  useEffect(() => {
    const onKey = (e) => {
      const mod = window.cue.platform === 'darwin' ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey || e.key !== ',') return;
      if (hasOpenModal()) return;
      e.preventDefault();
      settingsShortcutRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // The currently-active tab id, so exactly one tab highlights (a pinned subsection
  // wins over the base Settings tab when its section is the deep-link target).
  const activeTabId = view === 'settings'
    ? (settingsSection ? `settings:${settingsSection}` : 'settings')
    : view;

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
            <NavTab label="Operator" active={activeTabId === 'operator'} onClick={() => navigateTo('operator')} />
            <NavTab label="Multiview" active={activeTabId === 'multiview'} onClick={() => navigateTo('multiview')} />
            <NavTab label="Stream" active={activeTabId === 'stream'} onClick={() => navigateTo('stream')} />
            <NavTab label="Stage" active={activeTabId === 'stage'} onClick={() => navigateTo('stage')} />
            <NavTab label="Settings" active={activeTabId === 'settings'} onClick={() => navigateTo('settings')} />
            <TopBarTabs
              extraTabs={extraTabs}
              activeTabId={activeTabId}
              onNavigate={navigateTo}
              onReorder={persistTabs}
              onRemove={(id) => persistTabs(extraTabs.filter((t) => t !== id))}
              onAdd={(id) => { if (!extraTabs.includes(id)) persistTabs([...extraTabs, id]); }}
              onReset={() => persistTabs([])}
            />
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
        <button
          onClick={outputWindows === 0 ? () => window.cue.output.setLive(true) : undefined}
          title={outputWindows === 0 ? 'Click to open output windows' : `${outputWindows} output window${outputWindows !== 1 ? 's' : ''} open`}
          className={`flex items-center gap-xs ${outputWindows === 0 ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'}`}
        >
          <span
            className={`material-symbols-outlined text-[14px] ${outputWindows > 0 ? 'text-tertiary' : 'text-outline-variant'}`}
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            monitor
          </span>
          <span className={`text-label-sm font-label-sm uppercase tracking-[0.05em] ${outputWindows > 0 ? 'text-tertiary' : 'text-on-surface-variant/50'}`}>
            {outputWindows > 0 ? `${outputWindows} output${outputWindows !== 1 ? 's' : ''}` : 'No outputs'}
          </span>
        </button>
        <span className="w-px h-3 bg-outline-variant/40 shrink-0" />
        <span className="text-label-sm font-timecode-lg text-on-surface tabular-nums">{clock}</span>
        {headerState.micActive && (
          <div className="flex items-center gap-xs px-sm py-[2px] bg-tertiary/10 border border-tertiary/30 rounded text-tertiary text-label-sm font-label-sm" title="Scripture detection listening">
            <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>mic</span>
            <span className="w-[5px] h-[5px] rounded-full bg-tertiary animate-pulse" />
          </div>
        )}

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
          title={
            !headerState.canGo
              ? 'Select a rundown item to preview first'
              : outputWindows === 0
              ? 'No output windows open — enable outputs with the Live button'
              : 'GO — send preview to live (G)'
          }
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
          <ErrorBoundary label="Operator">
            <OperatorView
              transportRef={transportRef}
              onStateChange={setHeaderState}
              displayMode={displayMode}
              liveMediaStartAt={liveMediaStartAt}
              bgRefreshTick={bgRefreshTick}
              activeServiceId={activeServiceId}
              onServiceChange={setActiveServiceId}
              outputsEnabled={outputsEnabled}
              outputWindows={outputWindows}
              onToggleLive={() => window.cue.output.setLive(!outputsEnabled)}
              viewActive={view === 'operator'}
            />
          </ErrorBoundary>
        </div>
        {view === 'multiview' && <ErrorBoundary label="Multiview"><MultiviewView /></ErrorBoundary>}
        {view === 'stream' && <ErrorBoundary label="Stream"><StreamView /></ErrorBoundary>}
        {view === 'stage' && <ErrorBoundary label="Stage"><StageView /></ErrorBoundary>}
        {view === 'settings' && <ErrorBoundary label="Settings"><SettingsView
          activeServiceId={activeServiceId}
          initialSection={settingsSection}
          sectionNonce={settingsNonce}
          onRundownCleared={() => setBgRefreshTick((t) => t + 1)}
          onRundownDeleted={(deletedId) => {
            if (activeServiceId === deletedId) setActiveServiceId(null);
            setBgRefreshTick((t) => t + 1);
          }}
          onRundownRestored={(newId) => { setActiveServiceId(newId); setBgRefreshTick((t) => t + 1); }}
          onLibraryCleared={() => setBgRefreshTick((t) => t + 1)}
          onBackgroundDefaultChanged={() => setBgRefreshTick((t) => t + 1)}
        /></ErrorBoundary>}
      </div>

      {updateInfo && (
        <UpdateAvailableModal info={updateInfo} onClose={() => setUpdateInfo(null)} />
      )}
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
  s = Math.round(s);
  const neg = s < 0;
  s = Math.abs(s);
  return `${neg ? '-' : ''}${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
}

// Parse a typed timer duration into seconds. A bare number is MINUTES ("10" =>
// 10:00) because that's overwhelmingly what a presenter timer is set to; anything
// with a colon is explicit MM:SS ("0:45", "10:30"). Returns null when unparseable
// so the caller can revert the field instead of committing a garbage duration.
const MAX_TIMER_SEC = 99 * 60 + 59;
function parseDuration(text) {
  const t = String(text).trim();
  if (!t) return null;
  if (t.includes(':')) {
    const [m, s] = t.split(':');
    const mi = parseInt(m || '0', 10);
    const se = parseInt(s || '0', 10);
    if (Number.isNaN(mi) || Number.isNaN(se)) return null;
    return Math.max(0, Math.min(MAX_TIMER_SEC, mi * 60 + se));
  }
  const n = parseInt(t, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(MAX_TIMER_SEC, n * 60));
}

// Wall-clock HH:MM for an epoch-ms scheduled anchor.
function fmtClockShort(epoch) {
  const d = new Date(epoch);
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${String(h % 12 || 12)}:${m} ${ampm}`;
}

// Compact "in 4m 32s" / "in 45s" relative label for a future epoch.
function fmtCountdown(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s >= 60) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

function StagePanel() {
  // The duration field is free text (MM:SS) rather than spin dials — it is only
  // parsed on commit, so a half-typed "1" never momentarily means one minute.
  const [draft, setDraft]     = useState('10:00');
  const [remaining, setRemaining] = useState(600); // displayed countdown
  const [running, setRunning] = useState(false);
  // Main's authoritative totalSeconds. 0 = never Set, so the dials below are just
  // an uncommitted proposal — main would count from 0 if we sent a bare 'start'.
  const [totalSec, setTotalSec] = useState(0);
  const [stageMsg, setStageMsg] = useState('');
  const [msgPresets, setMsgPresets] = useState([]);

  // Load + persist stage message presets (stored as JSON in settings).
  useEffect(() => {
    window.cue.settings.get('stage_message_presets').then((v) => {
      if (Array.isArray(v)) setMsgPresets(v);
    });
  }, []);

  function savePreset(text) {
    if (!text.trim() || msgPresets.includes(text)) return;
    const next = [...msgPresets, text];
    setMsgPresets(next);
    window.cue.settings.set('stage_message_presets', next);
  }

  function deletePreset(text) {
    const next = msgPresets.filter((p) => p !== text);
    setMsgPresets(next);
    window.cue.settings.set('stage_message_presets', next);
  }

  // Scheduled messages — list lives in main (absolute epoch anchors); we mirror it.
  const [schedule, setSchedule]   = useState([]);
  const [schedMode, setSchedMode] = useState('in'); // 'in' (countdown) | 'at' (wall-clock)
  const [schedMins, setSchedMins] = useState(0);    // 'in' mode minutes
  const [schedSecs, setSchedSecs] = useState(30);   // 'in' mode seconds
  const [schedTime, setSchedTime] = useState('');   // 'HH:MM' for 'at' mode
  const [clearMins, setClearMins] = useState(0);     // auto-clear after N min (0 = never)
  const [nowTick, setNowTick]     = useState(Date.now()); // re-render pending list ticks

  const tickRef      = useRef(null);
  const startedAtRef = useRef(null);
  const remAtStartRef = useRef(0);

  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

  // Load the pending schedule and stay synced with main's broadcasts.
  useEffect(() => {
    let alive = true;
    window.cue.output.stage.getSchedule().then((s) => { if (alive) setSchedule(s || []); });
    const off = window.cue.on('stage:schedule', ({ scheduled }) => setSchedule(scheduled || []));
    const id  = setInterval(() => setNowTick(Date.now()), 1000);
    return () => { alive = false; off && off(); clearInterval(id); };
  }, []);

  // ── Seed timer + message from main on mount; stay in sync with push events ──
  // applyTimerState: given the canonical timer object from main, rehydrate local UI
  // without touching the IPC command flow (Set/Start/Pause/Reset still send the
  // same commands as before; this only seeds state when the popover first opens or
  // when main pushes an update from another source).
  function applyTimerState(t) {
    if (!t || t.totalSeconds <= 0) return; // no timer configured yet — leave defaults
    const total = t.totalSeconds;
    setTotalSec(total);
    // The field mirrors the COMMITTED total, never the live remaining — otherwise
    // it would scroll as the clock runs and there'd be no record of what to reset to.
    setDraft(fmtSecs(total));
    if (t.running && t.startedAt) {
      const rem = t.remainingSeconds - (Date.now() - t.startedAt) / 1000;
      setRemaining(rem);
      setRunning(true);
      startTick(rem);
    } else {
      const rem = t.remainingSeconds ?? total;
      setRemaining(rem);
      setRunning(false);
      stopTick();
    }
  }

  useEffect(() => {
    let alive = true;
    // Fetch initial state
    window.cue.output.stage.getTimer().then((t) => { if (alive) applyTimerState(t); });
    window.cue.output.stage.getMessage().then((m) => { if (alive && m?.text) setStageMsg(m.text); });
    // Stay in sync with changes from any source (including our own commands echoed back)
    const offTimer = window.cue.on('stage:timer', (t) => { if (alive) applyTimerState(t); });
    const offMsg   = window.cue.on('stage:message', ({ text }) => { if (alive) setStageMsg(text ?? ''); });
    return () => { alive = false; offTimer(); offMsg(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopTick() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }

  function startTick(fromRemaining) {
    stopTick();
    startedAtRef.current  = Date.now();
    remAtStartRef.current = fromRemaining;
    tickRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      const rem     = remAtStartRef.current - elapsed;
      setRemaining(rem);
    }, 100);
  }

  // Commit whatever is typed in the duration field as the new total, stopped and
  // ready to run. Unparseable or empty input reverts the field rather than wiping
  // a perfectly good committed timer.
  function commitDraft() {
    const total = parseDuration(draft);
    if (total == null || total <= 0) {
      setDraft(fmtSecs(totalSec > 0 ? totalSec : 0));
      return null;
    }
    setDraft(fmtSecs(total));
    if (total === totalSec) return total; // no change — don't disturb a running clock
    stopTick();
    setTotalSec(total);
    setRemaining(total);
    setRunning(false);
    window.cue.output.stage.timer('set', total);
    return total;
  }

  // Quick-set chip: commit N seconds immediately, stopped.
  function applyQuick(total) {
    stopTick();
    setDraft(fmtSecs(total));
    setTotalSec(total);
    setRemaining(total);
    setRunning(false);
    window.cue.output.stage.timer('set', total);
  }

  function handleToggle() {
    if (running) {
      stopTick();
      const elapsed = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0;
      const rem = remAtStartRef.current - elapsed;
      setRemaining(rem);
      setRunning(false);
      window.cue.output.stage.timer('pause');
      return;
    }
    // There is no separate "Set" step any more: Start commits whatever is currently
    // typed. That's the fix for "I pick a time, press Start, and nothing happens" —
    // previously an uncommitted duration meant main started from a total of 0.
    const typed = parseDuration(draft);
    let from = remaining;
    if (typed != null && typed > 0 && typed !== totalSec) {
      // A newly-typed duration always wins and restarts from the top.
      setTotalSec(typed);
      setDraft(fmtSecs(typed));
      setRemaining(typed);
      window.cue.output.stage.timer('set', typed);
      from = typed;
    } else if (totalSec <= 0) {
      return; // nothing typed and nothing committed — nothing to run
    }
    // Otherwise resume from OUR remaining, mirroring main's stored value, so
    // resuming mid-overrun continues at -00:05 instead of jumping back to 10:00.
    setRemaining(from);
    startTick(from);
    setRunning(true);
    window.cue.output.stage.timer('start');
  }

  function handleReset() {
    stopTick();
    // Reset restores main's committed total, not a half-typed field value.
    const total = totalSec > 0 ? totalSec : (parseDuration(draft) ?? 0);
    setDraft(fmtSecs(total));
    setRemaining(total);
    setRunning(false);
    window.cue.output.stage.timer('reset');
  }

  function sendMsg() { window.cue.output.stage.message(stageMsg); }
  function clearMsg() { setStageMsg(''); window.cue.output.stage.message(''); }

  async function scheduleMsg() {
    const text = stageMsg.trim();
    const s = buildSpec();
    if (!text || !s) return;
    const next = await window.cue.output.stage.schedule({ text, ...s });
    if (next) setSchedule(next);
    setStageMsg('');
  }

  async function unschedule(id) {
    const next = await window.cue.output.stage.unschedule(id);
    if (next) setSchedule(next);
  }

  const canSchedule = stageMsg.trim() &&
    (schedMode === 'in' ? (schedMins * 60 + schedSecs) > 0 : !!schedTime);

  // Build the timing spec from the current inputs (shared with the actual schedule
  // call so the preview can't drift from what main resolves). Returns null when the
  // inputs aren't a valid schedule yet.
  function buildSpec() {
    const clearAfter = clearMins > 0 ? clearMins * 60 : null;
    if (schedMode === 'in') {
      const after = schedMins * 60 + schedSecs;
      if (after <= 0) return null;
      return { afterSeconds: after, clearAfter };
    }
    if (!schedTime) return null;
    const [h, m] = schedTime.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return { atHour: h, atMinute: m, clearAfter };
  }

  // Live preview of the exact appear/clear instants (resolved the same way main
  // will, via the shared module) so the operator sees them before committing.
  const spec = canSchedule ? buildSpec() : null;
  const preview = spec ? resolveAnchors(spec, nowTick) : null;

  // Collision flags from the shared logic — the stage bar shows one message at a
  // time, so genuinely-overlapping windows are surfaced to the operator.
  const overlaps = overlapIds(schedule);
  const previewOverlaps = preview && schedule.some((m) => collides(preview, m));

  // Overrun reads red even when paused — a frozen negative is still "over time".
  const dispColor = (running || remaining < 0) ? 'text-secondary'
    : remaining > 0 ? 'text-on-surface' : 'text-outline-variant';

  return (
    <div className="absolute right-0 top-[calc(100%+6px)] w-76 bg-surface-container-low border border-outline-variant/30 rounded-xl shadow-2xl ring-1 ring-white/5 z-50 overflow-hidden" style={{ width: 296 }}>
      <div className="px-md pt-md pb-md flex flex-col gap-md max-h-[calc(100vh-80px)] overflow-y-auto custom-scrollbar">

        {/* ── Timer ── */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-outline mb-sm">Time Remaining</p>

          {/* Live countdown display */}
          <div className={`text-center font-mono font-bold tabular-nums mb-sm transition-colors ${dispColor}`} style={{ fontSize: 36 }}>
            {fmtSecs(remaining)}
          </div>

          {/* Duration field + transport. Typing commits on Enter/blur, and Start
              commits too — there is no separate "Set" step to forget. */}
          <div className="flex items-center gap-xs mb-xs">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                if (e.key === 'Escape') { e.preventDefault(); setDraft(fmtSecs(totalSec)); e.currentTarget.blur(); }
              }}
              onBlur={commitDraft}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="MM:SS"
              aria-label="Timer duration in minutes and seconds"
              className="w-[68px] h-7 px-xs bg-surface-container-lowest border border-outline-variant/50 rounded text-center text-[14px] font-bold tabular-nums text-on-surface focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none"
            />
            <button onClick={handleToggle}
              title={running ? 'Pause the timer' : 'Start (commits the duration shown)'}
              className={`flex-1 h-7 text-[10px] font-mono uppercase tracking-[0.05em] rounded border transition-colors cursor-pointer ${
                running
                  ? 'bg-secondary-container/70 border-secondary/50 text-secondary hover:bg-secondary-container'
                  : 'bg-tertiary-container/80 border-tertiary/50 text-tertiary hover:bg-tertiary-container'
              }`}>
              {running ? '⏸ Pause' : (totalSec > 0 && remaining !== totalSec ? '▶ Resume' : '▶ Start')}
            </button>
            <button onClick={handleReset} title="Reset to the set duration"
              className="h-7 px-sm text-[10px] font-mono uppercase tracking-[0.05em] bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:border-outline-variant hover:text-on-surface rounded transition-colors cursor-pointer">
              ↺
            </button>
          </div>

          {/* Quick durations — replaces the one-minute-per-click spin buttons. */}
          <div className="flex gap-[4px] mb-xs">
            {[5, 10, 15, 20, 30].map((m) => (
              <button key={m} onClick={() => applyQuick(m * 60)}
                className={`flex-1 h-6 text-[10px] font-mono tabular-nums rounded border transition-colors cursor-pointer ${
                  totalSec === m * 60
                    ? 'bg-primary/15 border-primary/50 text-primary'
                    : 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant'
                }`}>
                {m}m
              </button>
            ))}
          </div>

          <p className="text-[9px] text-outline leading-tight">
            {remaining < 0
              ? 'Over time — Pause to stop the overrun, ↺ to reset.'
              : 'Type minutes (10) or MM:SS (10:30) · Enter to set'}
          </p>
        </div>

        <div className="h-px bg-outline-variant/20" />

        {/* ── Message ── */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-outline mb-sm">Stage Message</p>
          {/* Presets */}
          {msgPresets.length > 0 && (
            <div className="flex flex-wrap gap-[4px] mb-sm">
              {msgPresets.map((preset) => (
                <div key={preset} className="group flex items-center gap-[2px] bg-surface-container-high border border-outline-variant/40 rounded px-[6px] py-[2px]">
                  <button
                    onClick={() => { window.cue.output.stage.message(preset); }}
                    className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer max-w-[140px] truncate"
                    title={preset}
                  >
                    {preset}
                  </button>
                  <button
                    onClick={() => deletePreset(preset)}
                    className="opacity-0 group-hover:opacity-70 hover:!opacity-100 text-on-surface-variant hover:text-error cursor-pointer transition-all ml-[2px]"
                  >
                    <span className="material-symbols-outlined text-[10px]">close</span>
                  </button>
                </div>
              ))}
            </div>
          )}
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
            <button
              onClick={() => savePreset(stageMsg.trim())}
              disabled={!stageMsg.trim() || msgPresets.includes(stageMsg.trim())}
              title="Save as preset"
              className="h-7 px-sm text-[10px] font-mono uppercase tracking-[0.05em] bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:border-outline-variant hover:text-on-surface rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              + Preset
            </button>
            <button onClick={clearMsg}
              className="h-7 px-sm text-[10px] font-mono uppercase tracking-[0.05em] bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:border-outline-variant hover:text-on-surface rounded transition-colors cursor-pointer">
              Clear
            </button>
          </div>

          {/* ── Schedule ── */}
          <div className="mt-md pt-md border-t border-outline-variant/20">
            <div className="flex items-center justify-between mb-sm">
              <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-outline">Schedule</p>
              <div className="flex bg-surface-container-lowest border border-outline-variant/40 rounded overflow-hidden">
                {[['in','In'],['at','At']].map(([m, lbl]) => (
                  <button key={m} onClick={() => setSchedMode(m)}
                    className={`px-sm h-5 text-[9px] font-mono uppercase tracking-[0.08em] transition-colors cursor-pointer ${
                      schedMode === m ? 'bg-primary-container/70 text-primary' : 'text-on-surface-variant hover:text-on-surface'
                    }`}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {schedMode === 'in' ? (
              <div className="flex items-center gap-xs mb-sm">
                <div className="flex flex-col items-center">
                  <input type="number" min={0} max={99} value={schedMins}
                    onChange={(e) => setSchedMins(Math.max(0, Math.min(99, Math.floor(+e.target.value) || 0)))}
                    className="w-14 h-7 px-xs bg-surface-container-lowest border border-outline-variant/50 rounded text-[12px] text-on-surface text-center tabular-nums focus:border-primary outline-none" />
                  <span className="text-[9px] font-mono uppercase tracking-[0.05em] text-outline mt-[2px]">min</span>
                </div>
                <span className="text-[16px] font-bold text-outline-variant pb-4">:</span>
                <div className="flex flex-col items-center">
                  <input type="number" min={0} max={59} value={schedSecs}
                    onChange={(e) => setSchedSecs(Math.max(0, Math.min(59, Math.floor(+e.target.value) || 0)))}
                    className="w-14 h-7 px-xs bg-surface-container-lowest border border-outline-variant/50 rounded text-[12px] text-on-surface text-center tabular-nums focus:border-primary outline-none" />
                  <span className="text-[9px] font-mono uppercase tracking-[0.05em] text-outline mt-[2px]">sec</span>
                </div>
                <span className="text-[9px] font-mono uppercase tracking-[0.05em] text-outline ml-xs self-start mt-2">from now</span>
              </div>
            ) : (
              <input type="time" value={schedTime}
                onChange={(e) => setSchedTime(e.target.value)}
                className="w-full h-7 px-sm mb-sm bg-surface-container-lowest border border-outline-variant/50 rounded text-[12px] text-on-surface tabular-nums focus:border-primary outline-none" />
            )}

            <div className="flex items-center gap-xs mb-sm">
              <span className="text-[9px] font-mono uppercase tracking-[0.05em] text-outline">Auto-clear after</span>
              <input type="number" min={0} max={999} value={clearMins}
                onChange={(e) => setClearMins(Math.max(0, Math.min(999, +e.target.value || 0)))}
                className="w-12 h-6 px-xs bg-surface-container-lowest border border-outline-variant/50 rounded text-[11px] text-on-surface text-center tabular-nums focus:border-primary outline-none" />
              <span className="text-[9px] font-mono uppercase text-outline">min{clearMins === 0 ? ' (never)' : ''}</span>
            </div>

            <button onClick={scheduleMsg} disabled={!canSchedule}
              className="w-full h-7 text-[10px] font-mono uppercase tracking-[0.05em] bg-surface-container-high border border-outline-variant/40 text-on-surface-variant hover:border-outline-variant hover:text-on-surface rounded transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
              + Schedule Message
            </button>

            {/* Live preview of what the current inputs will schedule */}
            {preview && (
              <p className="mt-xs text-[10px] font-mono text-on-surface-variant leading-snug">
                Appears <span className="text-primary">{fmtClockShort(preview.showAt)}</span>
                <span className="text-outline"> · in {fmtCountdown(preview.showAt - nowTick)}</span>
                {preview.clearAt && <span className="text-outline"> · clears {fmtClockShort(preview.clearAt)}</span>}
                {previewOverlaps && <span className="text-secondary"> · ⚠ overlaps an existing message</span>}
              </p>
            )}

            {/* Pending list */}
            {schedule.length > 0 && (
              <div className="mt-md">
                <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-outline mb-xs">
                  Queued · {schedule.length}
                </p>
                {overlaps.size > 0 && (
                  <p className="text-[9px] font-mono text-on-surface-variant mb-xs leading-snug">
                    ⚠ Overlapping messages share the bar — the later-starting one shows while they coincide.
                  </p>
                )}
                <ul className="flex flex-col gap-xs">
                  {schedule.map((m) => {
                    const live = nowTick >= m.showAt && (m.clearAt == null || nowTick < m.clearAt);
                    return (
                      <li key={m.id}
                        className={`flex items-start gap-sm px-sm py-xs rounded border ${
                          live ? 'bg-secondary-container/30 border-secondary/50' : 'bg-surface-container-lowest border-outline-variant/30'
                        }`}>
                        <span className="flex flex-col items-center gap-[2px] shrink-0 pt-[1px]">
                          {live ? (
                            <span className="px-[5px] py-[1px] rounded-full text-[8px] font-mono font-bold uppercase tracking-[0.08em] bg-secondary-container text-secondary leading-none flex items-center gap-[3px]">
                              <span className="w-[5px] h-[5px] rounded-full bg-secondary animate-pulse" />ON
                            </span>
                          ) : (
                            <span className="px-[5px] py-[1px] rounded-full text-[8px] font-mono uppercase tracking-[0.08em] bg-primary-container/40 text-primary leading-none">
                              in {fmtCountdown(m.showAt - nowTick)}
                            </span>
                          )}
                          {overlaps.has(m.id) && (
                            <span title="Overlaps another scheduled message — only the later-starting one shows while they coincide"
                              className="px-[4px] py-[1px] rounded-full text-[7px] font-mono uppercase tracking-[0.06em] border border-outline-variant/50 text-on-surface-variant leading-none">
                              overlap
                            </span>
                          )}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-on-surface truncate" title={m.text}>{m.text}</p>
                          <p className="text-[9px] font-mono tabular-nums text-outline mt-[1px]">
                            {fmtClockShort(m.showAt)}
                            {m.clearAt && <> → {fmtClockShort(m.clearAt)}</>}
                            {live && m.clearAt && <span className="text-secondary"> · {fmtCountdown(m.clearAt - nowTick)} left</span>}
                          </p>
                        </div>
                        <button onClick={() => unschedule(m.id)}
                          className="shrink-0 w-4 h-4 flex items-center justify-center text-[13px] leading-none text-outline hover:text-error cursor-pointer transition-colors"
                          title="Remove">×</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
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
