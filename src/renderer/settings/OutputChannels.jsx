import React, { useState, useEffect } from 'react';

export default function OutputChannels() {
  const [channels, setChannels] = useState([]);
  const [screens, setScreens] = useState([]);
  const [editing, setEditing] = useState(null);
  const [newChannel, setNewChannel] = useState(null);

  useEffect(() => {
    load();
    window.cue.output.screens.list().then(setScreens);
  }, []);

  function load() {
    window.cue.output.channels.list().then(setChannels);
  }

  async function handleCreate() {
    setNewChannel({ name: '', type: 'screen', template: 'fullscreen', active: 1 });
  }

  async function handleSaveNew() {
    if (!newChannel.name.trim()) return;
    await window.cue.output.channels.create(newChannel);
    setNewChannel(null);
    load();
  }

  async function handleUpdate(id, data) {
    await window.cue.output.channels.update(id, data);
    setEditing(null);
    load();
  }

  async function handleDelete(id) {
    if (!confirm('Delete this output channel?')) return;
    await window.cue.output.channels.delete(id);
    load();
  }

  async function handleAssignDisplay(channelId, display) {
    await window.cue.output.channels.update(channelId, {
      display_bounds: JSON.stringify(display.bounds),
      display_index: null,
    });
    load();
  }

  return (
    <section className="space-y-md">
      <div className="flex items-center justify-between">
        <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
          <span className="material-symbols-outlined text-primary">monitor</span>
          Output Channels
        </h2>
        <button
          onClick={handleCreate}
          className="bg-primary text-on-primary px-md py-xs rounded text-label-sm font-label-sm font-bold flex items-center gap-xs hover:brightness-110 active:scale-95 transition-all cursor-pointer"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          Add Output
        </button>
      </div>

      {/* Connected displays info */}
      {screens.length > 0 && (
        <div className="flex flex-wrap gap-sm">
          {screens.map((d) => (
            <div key={d.id} className="bg-surface-container border border-outline-variant/30 rounded px-sm py-xs text-label-sm font-label-sm text-on-surface-variant">
              {d.label}
            </div>
          ))}
        </div>
      )}

      {/* New channel form */}
      {newChannel && (
        <div className="bg-surface-container border border-outline-variant/30 rounded-xl p-md space-y-md">
          <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider">New Output Channel</h3>
          <div className="grid grid-cols-2 gap-md">
            <Field label="Channel Name">
              <input
                autoFocus
                value={newChannel.name}
                onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                className="field-input"
                placeholder="e.g. Main Auditorium"
              />
            </Field>
            <Field label="Output Type">
              <select
                value={newChannel.type}
                onChange={(e) => setNewChannel({ ...newChannel, type: e.target.value })}
                className="field-input"
              >
                <option value="screen">Screen Output</option>
                <option value="ndi">NDI Stream</option>
              </select>
            </Field>
            <Field label="Template">
              <select
                value={newChannel.template}
                onChange={(e) => setNewChannel({ ...newChannel, template: e.target.value })}
                className="field-input"
              >
                <option value="fullscreen">Fullscreen</option>
                <option value="lowerthird">Lower Third</option>
              </select>
            </Field>
          </div>
          <div className="flex gap-md justify-end pt-sm">
            <button onClick={() => setNewChannel(null)} className="text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors px-md py-xs">
              Cancel
            </button>
            <button onClick={handleSaveNew} className="bg-primary text-on-primary px-md py-xs rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 cursor-pointer transition-all">
              Create Channel
            </button>
          </div>
        </div>
      )}

      {/* Channels grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
        {channels.length === 0 ? (
          <div className="col-span-3 text-center py-8 text-on-surface-variant text-body-md">
            No output channels configured
          </div>
        ) : (
          channels.map((ch) => (
            <div key={ch.id}>
              {editing?.id === ch.id ? (
                <ChannelEditForm
                  channel={editing}
                  screens={screens}
                  onChange={(data) => setEditing({ ...editing, ...data })}
                  onSave={() => handleUpdate(ch.id, editing)}
                  onCancel={() => setEditing(null)}
                  onAssignDisplay={(d) => handleAssignDisplay(ch.id, d)}
                />
              ) : (
                <ChannelCard
                  channel={ch}
                  onEdit={() => setEditing({ ...ch })}
                  onDelete={() => handleDelete(ch.id)}
                />
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ChannelCard({ channel, onEdit, onDelete }) {
  const isActive = !!channel.active;
  const bounds = channel.display_bounds ? JSON.parse(channel.display_bounds) : null;
  const typeIcon = channel.type === 'ndi' ? 'settings_input_antenna' : 'screen_share';

  return (
    <div className={`bg-surface-container p-md border rounded-xl space-y-sm transition-all cursor-pointer group ${
      isActive ? 'border-primary/30' : 'border-outline-variant/30 opacity-70 grayscale hover:opacity-100 hover:grayscale-0'
    }`}
    style={isActive ? { boxShadow: '0 0 12px rgba(173,198,255,0.1)' } : {}}
    onClick={onEdit}
    >
      <div className="flex justify-between items-start">
        <div className="p-xs bg-primary-container/20 rounded">
          <span className="material-symbols-outlined text-primary text-xl">{typeIcon}</span>
        </div>
        <span className={`text-[10px] font-label-sm px-sm py-[2px] rounded-full font-bold uppercase ${
          isActive
            ? 'bg-tertiary-container text-on-tertiary-container'
            : 'bg-surface-variant text-on-surface-variant'
        }`}>
          {isActive ? 'ACTIVE' : 'INACTIVE'}
        </span>
      </div>
      <div>
        <h3 className="text-headline-md font-semibold text-on-surface">{channel.name}</h3>
        <p className="text-label-sm font-label-sm text-on-surface-variant">
          Type: {channel.type === 'ndi' ? 'NDI Stream' : 'Physical Screen'}
        </p>
      </div>
      {bounds && (
        <div className="pt-sm flex items-center gap-lg border-t border-outline-variant/30">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-label-sm text-outline">Resolution</span>
            <span className="text-label-sm font-label-sm">{bounds.width} × {bounds.height}</span>
          </div>
          {channel.ndi_fps && (
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-label-sm text-outline">Frame Rate</span>
              <span className="text-label-sm font-label-sm">{channel.ndi_fps} fps</span>
            </div>
          )}
        </div>
      )}
      <div className="flex gap-sm pt-xs opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="text-label-sm font-label-sm text-primary hover:underline cursor-pointer"
        >
          Edit
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-label-sm font-label-sm text-error hover:underline cursor-pointer"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function ChannelEditForm({ channel, screens, onChange, onSave, onCancel, onAssignDisplay }) {
  return (
    <div className="bg-surface-container border border-primary/30 rounded-xl p-md space-y-md" style={{ boxShadow: '0 0 12px rgba(173,198,255,0.1)' }}>
      <h3 className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-wider">Edit: {channel.name}</h3>
      <div className="grid grid-cols-2 gap-md">
        <Field label="Channel Name">
          <input
            value={channel.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="field-input"
          />
        </Field>
        <Field label="Template">
          <select
            value={channel.template}
            onChange={(e) => onChange({ template: e.target.value })}
            className="field-input"
          >
            <option value="fullscreen">Fullscreen</option>
            <option value="lowerthird">Lower Third</option>
          </select>
        </Field>
        {channel.type === 'ndi' && (
          <Field label="Frame Rate">
            <select
              value={channel.ndi_fps || 30}
              onChange={(e) => onChange({ ndi_fps: Number(e.target.value) })}
              className="field-input"
            >
              {[24, 25, 30, 50, 60].map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
            </select>
          </Field>
        )}
        <div className="flex items-center gap-sm col-span-2">
          <label className="flex items-center gap-sm cursor-pointer">
            <input
              type="checkbox"
              checked={!!channel.active}
              onChange={(e) => onChange({ active: e.target.checked ? 1 : 0 })}
              className="w-4 h-4 rounded border-outline-variant bg-surface-container text-primary"
            />
            <span className="text-label-sm font-label-sm text-on-surface-variant">Active</span>
          </label>
        </div>
      </div>

      {channel.type === 'screen' && screens.length > 0 && (
        <div className="space-y-xs">
          <label className="text-label-sm font-label-sm text-on-surface-variant uppercase">Assign Display</label>
          <div className="grid grid-cols-2 gap-sm">
            {screens.map((d) => {
              const assigned = channel.display_bounds && JSON.stringify(d.bounds) === channel.display_bounds;
              return (
                <button
                  key={d.id}
                  onClick={() => onAssignDisplay(d)}
                  className={`aspect-video bg-surface-container-lowest border-2 rounded relative flex flex-col items-center justify-center text-center p-xs cursor-pointer transition-all ${
                    assigned ? 'border-primary' : 'border-outline-variant/30 hover:border-primary/50'
                  }`}
                >
                  <span className={`material-symbols-outlined mb-1 ${assigned ? 'text-primary' : 'text-outline-variant'}`}>monitor</span>
                  <span className="text-[10px] font-label-sm text-on-surface leading-tight">{d.label}</span>
                  {assigned && (
                    <span className="absolute top-1 right-1 material-symbols-outlined text-primary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                      check_circle
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-md justify-end pt-sm border-t border-outline-variant/20">
        <button onClick={onCancel} className="text-label-sm font-label-sm text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors px-md py-xs border border-outline/30 rounded">
          Cancel
        </button>
        <button onClick={onSave} className="bg-primary text-on-primary px-md py-xs rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 cursor-pointer transition-all">
          Save Channel
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-xs">
      <label className="text-[11px] font-label-sm text-on-surface-variant uppercase tracking-wider">{label}</label>
      {React.cloneElement(children, {
        className: `${children.props.className || ''} w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-md py-sm text-body-md text-on-surface outline-none transition-all`.trim(),
      })}
    </div>
  );
}
