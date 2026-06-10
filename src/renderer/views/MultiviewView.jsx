import React, { useState, useEffect, useCallback } from 'react';

export default function MultiviewView() {
  const [channels, setChannels]               = useState([]);
  const [monitors, setMonitors]               = useState([]);
  const [monCaptureMap, setMonCaptureMap]     = useState({}); // monitorId  → dataUrl
  const [ndiCaptureMap, setNdiCaptureMap]     = useState({}); // channelId  → dataUrl
  const [isLive, setIsLive]                   = useState(false);
  const [lastUpdated, setLastUpdated]         = useState(null);

  const load = useCallback(async () => {
    const [chs, mons, outputState] = await Promise.all([
      window.cue.output.channels.list(),
      window.cue.output.monitors.list(),
      window.cue.output.getState(),
    ]);
    setChannels(chs);
    setMonitors(mons);
    setIsLive(outputState.isLive);
  }, []);

  useEffect(() => {
    load();
    window.cue.on('output:state-changed', (s) => setIsLive(s.isLive));
    window.cue.on('output:multiview-captures', (captures) => {
      const monMap = {}, ndiMap = {};
      for (const c of captures) {
        if (c.isNdi) ndiMap[c.channelId] = c.dataUrl;
        else         monMap[c.monitorId] = c.dataUrl;
      }
      setMonCaptureMap(monMap);
      setNdiCaptureMap(ndiMap);
      setLastUpdated(Date.now());
    });
    window.cue.output.multiview.start();
    return () => { window.cue.output.multiview.stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = channels.map((ch) => ({
    ...ch,
    monitors: monitors
      .filter((m) => m.channel_id === ch.id)
      .map((m) => ({ ...m, dataUrl: monCaptureMap[m.id] ?? null })),
    ndiDataUrl: ch.type === 'ndi' ? (ndiCaptureMap[ch.id] ?? null) : null,
  }));

  const totalMonitors = monitors.length;
  const totalNdi      = channels.filter((c) => c.type === 'ndi').length;

  return (
    <div className="h-full flex flex-col bg-surface-container-lowest overflow-hidden">

      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-md px-lg py-sm bg-surface-container-low border-b border-outline-variant/20" style={{ height: 44 }}>
        <span className="material-symbols-outlined text-[18px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
          grid_view
        </span>
        <span className="text-label-sm font-label-sm uppercase tracking-[0.06em] text-on-surface font-semibold">
          Multiview
        </span>

        <span className="w-px h-3 bg-outline-variant/40 shrink-0" />

        <span className="text-label-sm font-label-sm text-on-surface-variant">
          {channels.length} {channels.length === 1 ? 'channel' : 'channels'}
          {totalMonitors > 0 && ` · ${totalMonitors} ${totalMonitors === 1 ? 'screen' : 'screens'}`}
          {totalNdi > 0 && ` · ${totalNdi} NDI`}
        </span>

        <div className="flex-1" />

        {lastUpdated && (
          <span className="text-[10px] font-label-sm text-on-surface-variant/40 uppercase tracking-[0.05em] tabular-nums">
            Updated {new Date(lastUpdated).toLocaleTimeString('en-US', { hour12: false })}
          </span>
        )}

        <div className="flex items-center gap-xs">
          <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${isLive ? 'bg-secondary dot-pulse' : 'bg-outline-variant'}`} />
          <span className={`text-label-sm font-label-sm uppercase tracking-[0.05em] ${isLive ? 'text-secondary' : 'text-on-surface-variant/40'}`}>
            {isLive ? 'Live' : 'Idle'}
          </span>
        </div>

        <button onClick={load} title="Refresh" className="p-xs rounded hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
          <span className="material-symbols-outlined text-[16px]">refresh</span>
        </button>
      </div>

      {/* Content */}
      {channels.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-lg space-y-xl">
          {groups.map((ch) => (
            <ChannelGroup key={ch.id} channel={ch} isLive={isLive} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Channel Group ─────────────────────────────────────────────────────────

function ChannelGroup({ channel, isLive }) {
  const isActive       = !!channel.active;
  const isNdi          = channel.type === 'ndi';
  const templateLabel  = channel.template === 'lowerthird' ? 'Lower Third' : 'Fullscreen';
  const hasMonitors    = channel.monitors.length > 0;

  return (
    <div>
      {/* Channel label row */}
      <div className="flex items-center gap-sm mb-sm">
        <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${isActive ? 'bg-tertiary' : 'bg-outline-variant'}`} />
        <span className={`text-label-sm font-label-sm uppercase tracking-[0.07em] font-bold ${isActive ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>
          {channel.name}
        </span>
        {isNdi && (
          <span className="text-[10px] font-label-sm uppercase tracking-[0.04em] border border-tertiary/50 rounded px-xs py-[1px] text-tertiary">
            NDI
          </span>
        )}
        <span className="text-[10px] font-label-sm uppercase tracking-[0.05em] border border-outline-variant/30 rounded px-xs py-[1px] text-on-surface-variant">
          {templateLabel}
        </span>
        {!isActive && (
          <span className="text-[10px] font-label-sm uppercase tracking-[0.05em] text-outline">Inactive</span>
        )}
        {isNdi && (
          <span className="text-[10px] font-label-sm text-on-surface-variant/50">
            {channel.ndi_width || 1920}×{channel.ndi_height || 1080} · {channel.ndi_fps || 30}fps
          </span>
        )}
      </div>

      {/* Tiles */}
      {isNdi ? (
        <NdiTile channel={channel} isLive={isLive && isActive} />
      ) : hasMonitors ? (
        <div className="grid gap-gutter" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {channel.monitors.map((m) => (
            <ScreenMonitorTile key={m.id} monitor={m} isLive={isLive && isActive} />
          ))}
        </div>
      ) : (
        <NoScreensPlaceholder />
      )}
    </div>
  );
}

// ─── NDI Tile ──────────────────────────────────────────────────────────────
// NDI output has a transparent background — render over a checkerboard so
// alpha areas are visible instead of showing as black.

function NdiTile({ channel, isLive }) {
  const hasCapture = !!channel.ndiDataUrl;
  const isLT       = channel.template === 'lowerthird';

  return (
    <div className={`relative rounded-lg overflow-hidden transition-all max-w-[640px] ${
      isLive && hasCapture
        ? 'ring-2 ring-tertiary shadow-[0_0_20px_rgba(74,225,118,0.1)]'
        : 'ring-1 ring-outline-variant/30'
    }`}>
      {/* 16:9 capture area */}
      <div className="relative w-full bg-black" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0">
          {hasCapture ? (
            <>
              {/* Checkerboard shows through NDI alpha areas */}
              <div className="absolute inset-0" style={{
                backgroundImage: 'repeating-conic-gradient(#222 0% 25%, #333 0% 50%)',
                backgroundSize: '20px 20px',
              }} />
              <img src={channel.ndiDataUrl} alt="" className="absolute inset-0 w-full h-full object-contain" draggable={false} />
            </>
          ) : (
            <NdiNoSignal isLive={isLive} />
          )}
        </div>

        {/* LIVE badge */}
        {isLive && hasCapture && (
          <div className="absolute top-sm left-sm z-10">
            <span className="inline-flex items-center gap-xs px-xs py-[2px] rounded bg-tertiary/20 border border-tertiary/40 text-tertiary text-[9px] font-label-sm font-bold uppercase tracking-[0.08em]">
              <span className="w-[5px] h-[5px] rounded-full bg-tertiary animate-pulse shrink-0" />
              NDI Live
            </span>
          </div>
        )}

        {/* Template badge */}
        <div className="absolute top-sm right-sm z-10">
          <span className="inline-flex items-center gap-xs px-xs py-[2px] rounded bg-surface-container/80 text-on-surface-variant text-[9px] font-label-sm uppercase tracking-[0.06em]">
            {isLT ? 'Lower Third' : 'Fullscreen'}
          </span>
        </div>
      </div>

      {/* Label bar */}
      <div className={`flex items-center gap-xs px-sm py-[6px] border-t ${
        isLive && hasCapture
          ? 'bg-tertiary/10 border-tertiary/20'
          : 'bg-surface-container-high border-outline-variant/20'
      }`}>
        <span className="material-symbols-outlined text-[13px] shrink-0 text-tertiary" style={{ fontVariationSettings: "'FILL' 1" }}>
          wifi_tethering
        </span>
        <span className="text-[10px] font-label-sm text-on-surface-variant truncate">
          {`Cue — ${channel.name}`}
        </span>
        {!hasCapture && (
          <span className="text-[10px] font-label-sm text-on-surface-variant/40 ml-auto">
            Waiting for output…
          </span>
        )}
      </div>
    </div>
  );
}

function NdiNoSignal({ isLive }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-xs" style={{
      backgroundImage: 'repeating-conic-gradient(#1a1a1a 0% 25%, #222 0% 50%)',
      backgroundSize: '20px 20px',
    }}>
      <span className="material-symbols-outlined text-[28px] text-outline-variant/40">
        {isLive ? 'hourglass_empty' : 'wifi_off'}
      </span>
      <span className="text-[10px] font-label-sm uppercase tracking-[0.1em] text-outline-variant/40">
        {isLive ? 'Buffering…' : 'NDI Idle'}
      </span>
    </div>
  );
}

// ─── Screen Monitor Tile ───────────────────────────────────────────────────

function ScreenMonitorTile({ monitor, isLive }) {
  const hasCapture = !!monitor.dataUrl;
  const bounds     = monitor.display_bounds ? JSON.parse(monitor.display_bounds) : null;
  const label      = monitor.label || (bounds ? `${bounds.width}×${bounds.height} at (${bounds.x},${bounds.y})` : 'Unknown');
  const tallyLive  = isLive && hasCapture;

  return (
    <div className={`relative rounded-lg overflow-hidden transition-all ${
      tallyLive
        ? 'ring-2 ring-secondary shadow-[0_0_20px_rgba(255,179,173,0.12)]'
        : 'ring-1 ring-outline-variant/30'
    }`}>
      <div className="relative w-full bg-black" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0">
          {hasCapture
            ? <img src={monitor.dataUrl} alt="" className="w-full h-full object-cover" draggable={false} />
            : <NoSignal />}
        </div>
        {tallyLive && (
          <div className="absolute top-sm left-sm z-10">
            <span className="inline-flex items-center gap-xs px-xs py-[2px] rounded bg-secondary-container text-secondary text-[9px] font-label-sm font-bold uppercase tracking-[0.08em]">
              <span className="w-[5px] h-[5px] rounded-full bg-secondary animate-pulse shrink-0" />
              Live
            </span>
          </div>
        )}
      </div>
      <div className={`flex items-center gap-xs px-sm py-[6px] border-t ${
        tallyLive
          ? 'bg-secondary-container/20 border-secondary/20'
          : 'bg-surface-container-high border-outline-variant/20'
      }`}>
        <span className={`material-symbols-outlined text-[13px] shrink-0 ${tallyLive ? 'text-secondary' : 'text-outline'}`} style={{ fontVariationSettings: "'FILL' 1" }}>
          {hasCapture ? 'monitor' : 'monitor_off'}
        </span>
        <span className={`text-[10px] font-label-sm truncate ${tallyLive ? 'text-secondary/80' : 'text-on-surface-variant'}`}>
          {label}
        </span>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function NoSignal() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-xs bg-black">
      <span className="material-symbols-outlined text-[28px] text-outline-variant/30">signal_disconnected</span>
      <span className="text-[10px] font-label-sm uppercase tracking-[0.1em] text-outline-variant/40">No Signal</span>
    </div>
  );
}

function NoScreensPlaceholder() {
  return (
    <div className="flex items-center gap-sm py-md px-md border border-dashed border-outline-variant/20 rounded-lg">
      <span className="material-symbols-outlined text-[16px] text-outline-variant/40">add_to_queue</span>
      <span className="text-label-sm font-label-sm text-outline-variant/50 uppercase tracking-[0.05em]">
        No screens assigned — configure in Settings
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-md text-center p-xl">
      <span className="material-symbols-outlined text-[56px] text-outline-variant/30" style={{ fontVariationSettings: "'FILL' 1" }}>
        grid_view
      </span>
      <div>
        <p className="text-body-md text-on-surface-variant">No output channels configured</p>
        <p className="text-label-sm font-label-sm text-outline mt-xs uppercase tracking-[0.05em]">
          Go to Settings to create channels and assign screens
        </p>
      </div>
    </div>
  );
}
