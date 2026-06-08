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
    <div className="max-w-2xl">
      <div className="flex items-center mb-4">
        <h2 className="text-sm font-semibold text-slate-100">Output Channels</h2>
        <button
          onClick={handleCreate}
          className="ml-auto text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded"
        >
          + Add Channel
        </button>
      </div>

      {/* Available displays */}
      {screens.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Connected Displays</h3>
          <div className="flex flex-wrap gap-2">
            {screens.map((d) => (
              <div key={d.id} className="bg-slate-800 border border-slate-700 rounded p-2 text-xs text-slate-300">
                {d.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New channel form */}
      {newChannel && (
        <div className="bg-slate-800 border border-slate-700 rounded p-3 mb-3">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Name</label>
              <input
                autoFocus
                value={newChannel.name}
                onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                className="w-full bg-slate-700 text-slate-100 text-xs rounded px-2 py-1.5 border border-slate-600 outline-none focus:border-indigo-500"
                placeholder="e.g. Main Auditorium"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Type</label>
              <select
                value={newChannel.type}
                onChange={(e) => setNewChannel({ ...newChannel, type: e.target.value })}
                className="w-full bg-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 border border-slate-600"
              >
                <option value="screen">Screen</option>
                <option value="ndi">NDI</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Template</label>
              <select
                value={newChannel.template}
                onChange={(e) => setNewChannel({ ...newChannel, template: e.target.value })}
                className="w-full bg-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 border border-slate-600"
              >
                <option value="fullscreen">Fullscreen</option>
                <option value="lowerthird">Lower Third</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setNewChannel(null)} className="text-xs text-slate-500 px-3 py-1.5">Cancel</button>
            <button onClick={handleSaveNew} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded">Create</button>
          </div>
        </div>
      )}

      {/* Channel list */}
      <div className="space-y-2">
        {channels.length === 0 ? (
          <div className="text-sm text-slate-600 py-8 text-center">No output channels configured</div>
        ) : (
          channels.map((ch) => (
            <div key={ch.id} className="bg-slate-800 border border-slate-700 rounded p-3">
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
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-100 truncate">{ch.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {ch.type === 'screen' ? 'Screen' : 'NDI'} · {ch.template}
                      {ch.display_bounds && (() => {
                        const b = JSON.parse(ch.display_bounds);
                        return ` · ${b.width}×${b.height}`;
                      })()}
                    </div>
                  </div>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ch.active ? 'bg-green-500' : 'bg-slate-600'}`} />
                  <button
                    onClick={() => setEditing({ ...ch })}
                    className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(ch.id)}
                    className="text-xs text-red-500 hover:text-red-400 px-2 py-1"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ChannelEditForm({ channel, screens, onChange, onSave, onCancel, onAssignDisplay }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Name</label>
          <input
            value={channel.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="w-full bg-slate-700 text-slate-100 text-xs rounded px-2 py-1.5 border border-slate-600 outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Template</label>
          <select
            value={channel.template}
            onChange={(e) => onChange({ template: e.target.value })}
            className="w-full bg-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 border border-slate-600"
          >
            <option value="fullscreen">Fullscreen</option>
            <option value="lowerthird">Lower Third</option>
          </select>
        </div>
        {channel.type === 'ndi' && (
          <>
            <div>
              <label className="block text-xs text-slate-400 mb-1">FPS</label>
              <select
                value={channel.ndi_fps || 30}
                onChange={(e) => onChange({ ndi_fps: Number(e.target.value) })}
                className="w-full bg-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 border border-slate-600"
              >
                {[24, 25, 30, 50, 60].map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
              </select>
            </div>
          </>
        )}
        <div className="flex items-center gap-2 col-span-2">
          <label className="text-xs text-slate-400">Active</label>
          <input
            type="checkbox"
            checked={!!channel.active}
            onChange={(e) => onChange({ active: e.target.checked ? 1 : 0 })}
          />
        </div>
      </div>

      {/* Display assignment for screen channels */}
      {channel.type === 'screen' && screens.length > 0 && (
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-2">Assign Display</label>
          <div className="flex flex-wrap gap-2">
            {screens.map((d) => {
              const assigned = channel.display_bounds &&
                JSON.stringify(d.bounds) === channel.display_bounds;
              return (
                <button
                  key={d.id}
                  onClick={() => onAssignDisplay(d)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    assigned
                      ? 'border-indigo-500 bg-indigo-900 text-indigo-300'
                      : 'border-slate-600 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs text-slate-500 px-3 py-1.5">Cancel</button>
        <button onClick={onSave} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded">Save</button>
      </div>
    </div>
  );
}
