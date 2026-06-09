import React, { useState, useEffect, useCallback, useRef } from 'react';

export default function MultiviewView() {
  const [channels, setChannels] = useState([]);
  const [monitors, setMonitors] = useState([]);
  const [captureMap, setCaptureMap] = useState({}); // monitorId → dataUrl
  const [isLive, setIsLive] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

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
      const map = {};
      for (const c of captures) map[c.monitorId] = c.dataUrl;
      setCaptureMap(map);
      setLastUpdated(Date.now());
    });

    window.cue.output.multiview.start();

    return () => {
      window.cue.output.multiview.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge monitors into channel groups with their captures.
  const groups = channels.map((ch) => ({
    ...ch,
    monitors: monitors
      .filter((m) => m.channel_id === ch.id)
      .map((m) => ({ ...m, dataUrl: captureMap[m.id] ?? null })),
  }));

  const totalMonitors = monitors.length;

  return (
    <div className="h-full flex flex-col bg-surface-container-lowest overflow-hidden">

      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-md px-lg py-sm bg-surface-container-low border-b border-outline-variant/20" style={{ height: 44 }}>
        <span
          className="material-symbols-outlined text-[18px] text-primary"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          grid_view
        </span>
        <span className="text-label-sm font-label-sm uppercase tracking-[0.06em] text-on-surface font-semibold">
          Multiview
        </span>

        <span className="w-px h-3 bg-outline-variant/40 shrink-0" />

        <span className="text-label-sm font-label-sm text-on-surface-variant">
          {channels.length} {channels.length === 1 ? 'channel' : 'channels'}
          {' · '}
          {totalMonitors} {totalMonitors === 1 ? 'monitor' : 'monitors'}
        </span>

        <div className="flex-1" />

        {/* Last-update timestamp */}
        {lastUpdated && (
          <span className="text-[10px] font-label-sm text-on-surface-variant/40 uppercase tracking-[0.05em] tabular-nums">
            Updated {new Date(lastUpdated).toLocaleTimeString('en-US', { hour12: false })}
          </span>
        )}

        {/* Live state */}
        <div className="flex items-center gap-xs">
          <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${isLive ? 'bg-secondary dot-pulse' : 'bg-outline-variant'}`} />
          <span className={`text-label-sm font-label-sm uppercase tracking-[0.05em] ${isLive ? 'text-secondary' : 'text-on-surface-variant/40'}`}>
            {isLive ? 'Live' : 'Idle'}
          </span>
        </div>

        {/* Refresh */}
        <button
          onClick={load}
          title="Refresh channels"
          className="p-xs rounded hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
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
  const isActive = !!channel.active;
  const templateLabel = channel.template === 'lowerthird' ? 'Lower Third' : 'Fullscreen';
  const hasMonitors = channel.monitors.length > 0;

  return (
    <div>
      {/* Channel label row */}
      <div className="flex items-center gap-sm mb-sm">
        <span
          className={`w-[7px] h-[7px] rounded-full shrink-0 ${isActive ? 'bg-tertiary' : 'bg-outline-variant'}`}
        />
        <span className={`text-label-sm font-label-sm uppercase tracking-[0.07em] font-bold ${isActive ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>
          {channel.name}
        </span>
        <span className="text-[10px] font-label-sm uppercase tracking-[0.05em] border border-outline-variant/30 rounded px-xs py-[1px] text-on-surface-variant">
          {templateLabel}
        </span>
        {!isActive && (
          <span className="text-[10px] font-label-sm uppercase tracking-[0.05em] text-outline">
            Inactive
          </span>
        )}
      </div>

      {/* Monitor tiles or placeholder */}
      {hasMonitors ? (
        <div
          className="grid gap-gutter"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
        >
          {channel.monitors.map((m) => (
            <MonitorTile
              key={m.id}
              monitor={m}
              isLive={isLive && isActive}
            />
          ))}
        </div>
      ) : (
        <NoScreensPlaceholder />
      )}
    </div>
  );
}

// ─── Monitor Tile ──────────────────────────────────────────────────────────

function MonitorTile({ monitor, isLive }) {
  const hasCapture = !!monitor.dataUrl;
  const bounds = monitor.display_bounds ? JSON.parse(monitor.display_bounds) : null;
  const label = monitor.label || (bounds ? `${bounds.width}×${bounds.height} at (${bounds.x},${bounds.y})` : 'Unknown');

  const tallyLive = isLive && hasCapture;

  return (
    <div
      className={`relative rounded-lg overflow-hidden transition-all ${
        tallyLive
          ? 'ring-2 ring-secondary shadow-[0_0_20px_rgba(255,179,173,0.12)]'
          : 'ring-1 ring-outline-variant/30'
      }`}
    >
      {/* 16:9 capture area */}
      <div className="relative w-full bg-black" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0">
          {hasCapture ? (
            <img
              src={monitor.dataUrl}
              alt=""
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <NoSignal />
          )}
        </div>

        {/* Top-left: LIVE badge */}
        {tallyLive && (
          <div className="absolute top-sm left-sm z-10">
            <span className="inline-flex items-center gap-xs px-xs py-[2px] rounded bg-secondary-container text-secondary text-[9px] font-label-sm font-bold uppercase tracking-[0.08em]">
              <span className="w-[5px] h-[5px] rounded-full bg-secondary animate-pulse shrink-0" />
              Live
            </span>
          </div>
        )}

        {/* Top-right: monitor icon when idle */}
        {!tallyLive && !hasCapture && null}
      </div>

      {/* Label bar */}
      <div className={`flex items-center gap-xs px-sm py-[6px] border-t ${
        tallyLive
          ? 'bg-secondary-container/20 border-secondary/20'
          : 'bg-surface-container-high border-outline-variant/20'
      }`}>
        <span
          className={`material-symbols-outlined text-[13px] shrink-0 ${tallyLive ? 'text-secondary' : 'text-outline'}`}
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
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
      <span className="material-symbols-outlined text-[28px] text-outline-variant/30">
        signal_disconnected
      </span>
      <span className="text-[10px] font-label-sm uppercase tracking-[0.1em] text-outline-variant/40">
        No Signal
      </span>
    </div>
  );
}

function NoScreensPlaceholder() {
  return (
    <div className="flex items-center gap-sm py-md px-md border border-dashed border-outline-variant/20 rounded-lg">
      <span className="material-symbols-outlined text-[16px] text-outline-variant/40">
        add_to_queue
      </span>
      <span className="text-label-sm font-label-sm text-outline-variant/50 uppercase tracking-[0.05em]">
        No screens assigned — configure in Settings
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-md text-center p-xl">
      <span
        className="material-symbols-outlined text-[56px] text-outline-variant/30"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
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
