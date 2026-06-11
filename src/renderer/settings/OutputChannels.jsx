import React, { useState, useEffect, useCallback } from 'react';
import { CHANNEL_MODES, channelMode, modeToFlags } from '../utils/channelMode';

export default function OutputChannels() {
  const [channels, setChannels] = useState([]);
  const [monitors, setMonitors] = useState([]); // all monitors flat list
  const [screens, setScreens] = useState([]);   // connected physical displays
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [error, setError] = useState('');
  const [newChannel, setNewChannel] = useState({ name: '', type: 'screen', template: 'fullscreen', ndi_fps: 30, ndi_width: 1920, ndi_height: 1080, ndi_audio_muted: 1 });

  const load = useCallback(async () => {
    const [chs, mons, scrs] = await Promise.all([
      window.cue.output.channels.list(),
      window.cue.output.monitors.list(),
      window.cue.output.screens.list(),
    ]);
    setChannels(chs);
    setMonitors(mons);
    setScreens(scrs);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreateChannel() {
    if (!newChannel.name.trim()) return;
    setError('');
    try {
      await window.cue.output.channels.create(newChannel);
      setCreatingChannel(false);
      setNewChannel({ name: '', type: 'screen', template: 'fullscreen', ndi_fps: 30, ndi_width: 1920, ndi_height: 1080, ndi_audio_muted: 1 });
      load();
    } catch (e) {
      setError(`Couldn't create channel: ${e.message || e}. If you just updated the app, fully quit and restart it.`);
    }
  }

  async function handleUpdateChannel(id, data) {
    setError('');
    try {
      await window.cue.output.channels.update(id, data);
      load();
    } catch (e) {
      setError(`Couldn't update channel: ${e.message || e}.`);
    }
  }

  async function handleDeleteChannel(id) {
    if (!confirm('Delete this channel and remove all its assigned screens?')) return;
    await window.cue.output.channels.delete(id);
    load();
  }

  async function handleAddMonitor(channelId, display) {
    await window.cue.output.monitors.create(channelId, {
      display_bounds: JSON.stringify(display.bounds),
      label: display.label,
    });
    load();
  }

  async function handleRemoveMonitor(monitorId) {
    await window.cue.output.monitors.delete(monitorId);
    load();
  }

  const channelMonitors = (channelId) => monitors.filter((m) => m.channel_id === channelId);

  // Which displays are already assigned to ANY channel (for showing assignment state)
  const assignedBounds = new Set(monitors.map((m) => m.display_bounds));

  return (
    <section className="space-y-md">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
              monitor
            </span>
            Output Channels
          </h2>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Channels define what is displayed. Assign one or more screens to a channel — all update simultaneously on GO.
          </p>
        </div>
        <button
          onClick={() => setCreatingChannel(true)}
          className="bg-primary-container text-on-primary px-md py-sm rounded-lg text-label-sm font-label-sm font-bold flex items-center gap-xs hover:brightness-110 active:scale-95 transition-all cursor-pointer shrink-0"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          New Channel
        </button>
      </div>

      {error && (
        <div className="bg-error-container/20 border border-error/40 rounded-lg px-md py-sm flex items-start gap-sm">
          <span className="material-symbols-outlined text-[16px] text-error shrink-0 mt-[1px]">error</span>
          <p className="text-body-sm text-error flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-error/70 hover:text-error cursor-pointer shrink-0">
            <span className="material-symbols-outlined text-[15px]">close</span>
          </button>
        </div>
      )}

      {/* Connected displays strip */}
      {screens.length > 0 && (
        <div className="flex items-center gap-sm flex-wrap">
          <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em] shrink-0">
            Connected:
          </span>
          {screens.map((d) => (
            <span
              key={d.id}
              className="inline-flex items-center gap-xs bg-surface-container border border-outline-variant/30 rounded px-sm py-[3px] text-label-sm font-label-sm text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-[12px] text-outline">monitor</span>
              {d.label}
            </span>
          ))}
        </div>
      )}

      {/* New channel form */}
      {creatingChannel && (
        <div className="bg-surface-container-low border border-primary/20 rounded-xl p-md space-y-md ring-1 ring-primary/10">
          <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">
            New Channel
          </h3>
          <div className="grid grid-cols-4 gap-md">
            <Field label="Channel Name" className="col-span-2">
              <input
                autoFocus
                value={newChannel.name}
                onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateChannel(); if (e.key === 'Escape') setCreatingChannel(false); }}
                placeholder="e.g. Main Auditorium"
                className="field-input w-full"
              />
            </Field>
            <Field label="Type">
              <select
                value={newChannel.type}
                onChange={(e) => setNewChannel({ ...newChannel, type: e.target.value })}
                className="field-input w-full"
              >
                <option value="screen">Screen</option>
                <option value="ndi">NDI</option>
              </select>
            </Field>
            <Field label="Template">
              <select
                value={newChannel.template}
                onChange={(e) => setNewChannel({ ...newChannel, template: e.target.value })}
                className="field-input w-full"
              >
                <option value="fullscreen">Fullscreen</option>
                <option value="lowerthird">Lower Third</option>
                <option value="stage">Stage Display</option>
              </select>
            </Field>
          </div>
          {newChannel.type === 'ndi' && (
            <div className="grid grid-cols-4 gap-md pt-xs border-t border-outline-variant/20">
              <Field label="Width (px)">
                <input
                  type="number"
                  value={newChannel.ndi_width}
                  onChange={(e) => setNewChannel({ ...newChannel, ndi_width: parseInt(e.target.value) || 1920 })}
                  className="field-input w-full"
                />
              </Field>
              <Field label="Height (px)">
                <input
                  type="number"
                  value={newChannel.ndi_height}
                  onChange={(e) => setNewChannel({ ...newChannel, ndi_height: parseInt(e.target.value) || 1080 })}
                  className="field-input w-full"
                />
              </Field>
              <Field label="Frame Rate">
                <select
                  value={newChannel.ndi_fps}
                  onChange={(e) => setNewChannel({ ...newChannel, ndi_fps: parseInt(e.target.value) })}
                  className="field-input w-full"
                >
                  <option value={24}>24 fps</option>
                  <option value={25}>25 fps</option>
                  <option value={30}>30 fps</option>
                  <option value={50}>50 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </Field>
              <div className="space-y-xs">
                <div className="text-[10px] font-label-sm text-on-surface-variant uppercase tracking-[0.06em]">Audio</div>
                <label className="flex items-center gap-xs h-[34px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!newChannel.ndi_audio_muted}
                    onChange={(e) => setNewChannel({ ...newChannel, ndi_audio_muted: e.target.checked ? 1 : 0 })}
                    className="w-3.5 h-3.5 rounded accent-primary"
                  />
                  <span className="text-label-sm font-label-sm text-on-surface-variant">Mute audio</span>
                </label>
              </div>
            </div>
          )}
          <div className="flex gap-sm justify-end">
            <button
              onClick={() => { setCreatingChannel(false); setNewChannel({ name: '', type: 'screen', template: 'fullscreen', ndi_fps: 30, ndi_width: 1920, ndi_height: 1080, ndi_audio_muted: 1 }); }}
              className="px-md py-sm text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface border border-outline-variant/30 rounded-lg cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateChannel}
              disabled={!newChannel.name.trim()}
              className="px-md py-sm text-label-sm font-label-sm font-bold bg-primary-container text-on-primary rounded-lg hover:brightness-110 active:scale-95 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Channel cards */}
      {channels.length === 0 && !creatingChannel ? (
        <EmptyState onAdd={() => setCreatingChannel(true)} />
      ) : (
        <div className="space-y-gutter">
          {channels.map((ch) => (
            <ChannelCard
              key={ch.id}
              channel={ch}
              monitors={channelMonitors(ch.id)}
              screens={screens}
              assignedBounds={assignedBounds}
              onUpdate={(data) => handleUpdateChannel(ch.id, data)}
              onDelete={() => handleDeleteChannel(ch.id)}
              onAddMonitor={(display) => handleAddMonitor(ch.id, display)}
              onRemoveMonitor={handleRemoveMonitor}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Channel Card ────────────────────────────────────────────────────────────

function ChannelCard({ channel, monitors, screens, assignedBounds, onUpdate, onDelete, onAddMonitor, onRemoveMonitor }) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [showScreenPicker, setShowScreenPicker] = useState(false);
  const isActive = !!channel.active;

  function startEdit() {
    setEditData({ name: channel.name, template: channel.template, active: channel.active });
    setEditing(true);
  }

  async function saveEdit() {
    await onUpdate(editData);
    setEditing(false);
  }

  const isNdi = channel.type === 'ndi';
  const templateLabel = channel.template === 'lowerthird' ? 'Lower Third'
                      : channel.template === 'stage'      ? 'Stage Display'
                      : 'Fullscreen';
  const monitorCount = monitors.length;

  return (
    <div className={`bg-surface-container-low border rounded-xl overflow-hidden transition-all ${
      isActive ? 'border-outline-variant/40' : 'border-outline-variant/20 opacity-60'
    }`}>
      {/* Channel header */}
      <div className="flex items-center gap-md px-md py-sm bg-surface-container-high border-b border-outline-variant/20">
        {/* Active dot */}
        <span className={`w-[7px] h-[7px] rounded-full shrink-0 ${isActive ? 'bg-tertiary' : 'bg-outline-variant'}`} />

        {editing ? (
          /* Inline edit row */
          <div className="flex items-center gap-sm flex-1 min-w-0">
            <input
              autoFocus
              value={editData.name}
              onChange={(e) => setEditData({ ...editData, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
              className="bg-surface-container-lowest border border-primary/40 rounded px-sm py-[3px] text-body-md text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 flex-1 min-w-0"
            />
            <select
              value={editData.template}
              onChange={(e) => setEditData({ ...editData, template: e.target.value })}
              className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[3px] text-label-sm font-label-sm text-on-surface outline-none focus:border-primary shrink-0"
            >
              <option value="fullscreen">Fullscreen</option>
              <option value="lowerthird">Lower Third</option>
              <option value="stage">Stage Display</option>
            </select>
            <label className="flex items-center gap-xs cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={!!editData.active}
                onChange={(e) => setEditData({ ...editData, active: e.target.checked ? 1 : 0 })}
                className="w-3.5 h-3.5 rounded accent-primary"
              />
              <span className="text-label-sm font-label-sm text-on-surface-variant">Active</span>
            </label>
            <button
              onClick={saveEdit}
              className="px-sm py-[3px] text-label-sm font-label-sm font-bold bg-primary-container text-on-primary rounded cursor-pointer hover:brightness-110 transition-all shrink-0"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-on-surface-variant hover:text-on-surface cursor-pointer shrink-0"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        ) : (
          /* Display row */
          <div className="flex items-center gap-sm flex-1 min-w-0">
            <span className="text-body-md font-semibold text-on-surface truncate">{channel.name}</span>
            {isNdi && (
              <span className="shrink-0 text-[10px] font-label-sm uppercase tracking-[0.04em] px-xs py-[1px] rounded border border-tertiary/50 text-tertiary bg-tertiary/10">
                NDI
              </span>
            )}
            <span className="shrink-0 text-[10px] font-label-sm uppercase tracking-[0.04em] px-xs py-[1px] rounded border border-outline-variant/40 text-on-surface-variant">
              {templateLabel}
            </span>
            {/* Lower-third channels: content mode (lyrics + graphics / lyrics / graphics) */}
            {channel.template === 'lowerthird' && (
              <ChannelModeSwitch
                mode={channelMode(channel)}
                onChange={(m) => onUpdate(modeToFlags(m))}
              />
            )}
            {!isNdi && (
              <span className="text-label-sm font-label-sm text-on-surface-variant shrink-0">
                {monitorCount === 0 ? 'no screens' : `${monitorCount} screen${monitorCount !== 1 ? 's' : ''}`}
              </span>
            )}
            {isNdi && (
              <span className="text-label-sm font-label-sm text-on-surface-variant shrink-0">
                {channel.ndi_width || 1920}×{channel.ndi_height || 1080} · {channel.ndi_fps || 30}fps
              </span>
            )}

            <div className="flex-1" />

            <button
              onClick={startEdit}
              className="text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors p-xs rounded hover:bg-surface-container-highest"
              title="Edit channel"
            >
              <span className="material-symbols-outlined text-[15px]">edit</span>
            </button>
            <button
              onClick={onDelete}
              className="text-on-surface-variant hover:text-error cursor-pointer transition-colors p-xs rounded hover:bg-error/10"
              title="Delete channel"
            >
              <span className="material-symbols-outlined text-[15px]">delete</span>
            </button>
          </div>
        )}
      </div>

      {/* Monitors area — NDI channels don't use physical screens */}
      {isNdi ? (
        <div className="px-md py-sm flex items-center justify-between gap-md border-t border-outline-variant/10">
          <div className="flex items-center gap-sm text-on-surface-variant text-label-sm font-label-sm">
            <span className="material-symbols-outlined text-[14px] text-tertiary">wifi_tethering</span>
            Broadcasts as <span className="text-on-surface font-semibold">&quot;Cue - {channel.name}&quot;</span> on the local network — add as NDI Source in OBS.
          </div>
          <button
            onClick={() => onUpdate({ ndi_audio_muted: channel.ndi_audio_muted ? 0 : 1 })}
            className={`shrink-0 flex items-center gap-xs px-sm py-[3px] rounded border text-[10px] font-label-sm uppercase tracking-[0.04em] transition-all cursor-pointer ${
              channel.ndi_audio_muted
                ? 'border-outline-variant/40 text-on-surface-variant hover:border-primary/40 hover:text-on-surface'
                : 'border-tertiary/50 text-tertiary bg-tertiary/10 hover:border-secondary/50 hover:text-secondary hover:bg-secondary/10'
            }`}
            title={channel.ndi_audio_muted ? 'Audio muted — click to enable' : 'Audio enabled — click to mute'}
          >
            <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              {channel.ndi_audio_muted ? 'volume_off' : 'volume_up'}
            </span>
            {channel.ndi_audio_muted ? 'Audio Muted' : 'Audio On'}
          </button>
        </div>
      ) : (
      <div className="p-md">
        {monitors.length === 0 && !showScreenPicker ? (
          <button
            onClick={() => setShowScreenPicker(true)}
            className="w-full flex flex-col items-center justify-center gap-sm py-lg border-2 border-dashed border-outline-variant/30 rounded-lg hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer group"
          >
            <span className="material-symbols-outlined text-2xl text-outline-variant group-hover:text-primary transition-colors">
              add_to_queue
            </span>
            <span className="text-label-sm font-label-sm text-on-surface-variant group-hover:text-primary transition-colors uppercase tracking-[0.05em]">
              Assign a Screen
            </span>
          </button>
        ) : (
          <div className="flex flex-wrap gap-sm items-start">
            {/* Assigned monitor tiles */}
            {monitors.map((m) => (
              <MonitorTile
                key={m.id}
                monitor={m}
                screens={screens}
                onRemove={() => onRemoveMonitor(m.id)}
              />
            ))}

            {/* Add screen button */}
            {!showScreenPicker && (
              <button
                onClick={() => setShowScreenPicker(true)}
                className="flex flex-col items-center justify-center gap-xs w-[100px] aspect-video border-2 border-dashed border-outline-variant/30 rounded-lg hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer group"
              >
                <span className="material-symbols-outlined text-xl text-outline-variant group-hover:text-primary transition-colors">add</span>
                <span className="text-[10px] font-label-sm text-on-surface-variant group-hover:text-primary transition-colors uppercase tracking-[0.04em]">Add Screen</span>
              </button>
            )}
          </div>
        )}

        {/* Screen picker (inline) */}
        {showScreenPicker && (
          <ScreenPicker
            screens={screens}
            assignedBounds={new Set(monitors.map((m) => m.display_bounds))}
            onPick={(display) => { onAddMonitor(display); setShowScreenPicker(false); }}
            onClose={() => setShowScreenPicker(false)}
          />
        )}
      </div>
      )}
    </div>
  );
}

// ─── Monitor Tile ─────────────────────────────────────────────────────────────

function MonitorTile({ monitor, screens, onRemove }) {
  const bounds = monitor.display_bounds ? JSON.parse(monitor.display_bounds) : null;
  const screen = bounds
    ? screens.find(
        (s) =>
          s.bounds.x === bounds.x &&
          s.bounds.y === bounds.y &&
          s.bounds.width === bounds.width &&
          s.bounds.height === bounds.height,
      )
    : null;
  const isConnected = !!screen;
  const label = screen?.label || (bounds ? `${bounds.width}×${bounds.height}` : 'Unknown');

  return (
    <div className={`relative group flex flex-col items-center justify-between w-[100px] aspect-video rounded-lg border-2 p-xs transition-all ${
      isConnected
        ? 'border-primary/40 bg-primary/5'
        : 'border-error/30 bg-error/5'
    }`}>
      <span
        className={`material-symbols-outlined text-xl ${isConnected ? 'text-primary' : 'text-error'}`}
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {isConnected ? 'monitor' : 'monitor_off'}
      </span>
      <span className="text-[10px] font-label-sm text-on-surface-variant text-center leading-tight line-clamp-2 w-full">
        {label}
      </span>
      {!isConnected && (
        <span className="absolute top-1 left-1 text-[9px] font-label-sm text-error uppercase">
          Disconnected
        </span>
      )}
      <button
        onClick={onRemove}
        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-surface-container-high border border-outline-variant/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-error hover:border-error hover:text-white"
        title="Remove screen"
      >
        <span className="material-symbols-outlined text-[11px]">close</span>
      </button>
    </div>
  );
}

// ─── Screen Picker ────────────────────────────────────────────────────────────

function ScreenPicker({ screens, assignedBounds, onPick, onClose }) {
  return (
    <div className="mt-sm border border-primary/20 rounded-xl bg-surface-container-lowest p-md space-y-sm ring-1 ring-primary/10">
      <div className="flex items-center justify-between">
        <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">
          Select a screen to assign
        </span>
        <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface cursor-pointer">
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>

      {screens.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant py-sm">
          No displays detected. Connect a monitor and restart the app.
        </p>
      ) : (
        <div className="flex flex-wrap gap-sm">
          {screens.map((d) => {
            const boundsStr = JSON.stringify(d.bounds);
            const isAssigned = assignedBounds.has(boundsStr);
            return (
              <button
                key={d.id}
                disabled={isAssigned}
                onClick={() => onPick(d)}
                className={`relative flex flex-col items-center justify-center gap-xs w-[110px] aspect-video rounded-lg border-2 transition-all cursor-pointer ${
                  isAssigned
                    ? 'border-primary/40 bg-primary/10 cursor-not-allowed opacity-60'
                    : 'border-outline-variant/30 hover:border-primary hover:bg-primary/5'
                }`}
              >
                <span className={`material-symbols-outlined text-xl ${isAssigned ? 'text-primary' : 'text-outline'}`}
                  style={{ fontVariationSettings: isAssigned ? "'FILL' 1" : "'FILL' 0" }}
                >
                  monitor
                </span>
                <span className="text-[10px] font-label-sm text-on-surface-variant text-center leading-tight px-xs">
                  {d.label}
                </span>
                {isAssigned && (
                  <span
                    className="absolute top-1 right-1 material-symbols-outlined text-primary text-sm"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    check_circle
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd }) {
  return (
    <button
      onClick={onAdd}
      className="w-full flex flex-col items-center justify-center gap-md py-2xl border-2 border-dashed border-outline-variant/20 rounded-xl hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer group"
    >
      <span className="material-symbols-outlined text-4xl text-outline-variant group-hover:text-primary transition-colors">
        add_to_queue
      </span>
      <div className="text-center">
        <p className="text-body-md text-on-surface-variant group-hover:text-on-surface transition-colors">
          No output channels configured
        </p>
        <p className="text-label-sm font-label-sm text-outline group-hover:text-primary transition-colors mt-xs uppercase tracking-[0.05em]">
          Click to create your first channel
        </p>
      </div>
    </button>
  );
}

// ─── Lower-third content mode switch (3-way segmented) ────────────────────────

function ChannelModeSwitch({ mode, onChange }) {
  return (
    <div className="shrink-0 flex items-center gap-[2px] bg-surface-container rounded p-[2px]" title="What this lower-third channel shows">
      {CHANNEL_MODES.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          title={m.label}
          className={`flex items-center gap-xs px-xs py-[1px] rounded text-[10px] font-label-sm uppercase tracking-[0.04em] transition-colors cursor-pointer ${
            mode === m.id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[12px]">{m.icon}</span>
          {m.short}
        </button>
      ))}
    </div>
  );
}

// ─── Field Wrapper ────────────────────────────────────────────────────────────

function Field({ label, children, className = '' }) {
  return (
    <div className={`space-y-xs ${className}`}>
      <label className="text-[10px] font-label-sm text-on-surface-variant uppercase tracking-[0.06em]">
        {label}
      </label>
      {React.cloneElement(children, {
        className: `${children.props.className || ''} bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all`.trim(),
      })}
    </div>
  );
}
