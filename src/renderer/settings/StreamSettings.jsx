import React, { useState, useEffect, useCallback } from 'react';

// Direct-to-RTMP streaming (YouTube / Facebook / Twitch / any RTMP). Sends the
// composited program output (lyrics + graphics + video) as one encoded feed —
// no external encoder box. Uses a stream key, not OAuth.
const RESOLUTIONS = [
  { label: '720p',  width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: '1440p', width: 2560, height: 1440 },
  { label: '4K',    width: 3840, height: 2160 },
];
const FPS_OPTIONS = [30, 60];
const BITRATES = ['2500k', '4500k', '6000k', '9000k', '13000k', '20000k'];

const STATE_LABEL = {
  idle: 'Offline', starting: 'Starting…', live: 'Live', reconnecting: 'Reconnecting…', error: 'Error',
};

export default function StreamSettings() {
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState({ active: false, state: 'idle', detail: null, encoder: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setCfg(await window.cue.output.stream.getConfig());
    setStatus(await window.cue.output.stream.status());
  }, []);
  useEffect(() => { load(); }, [load]);

  // Live status pushed from main (start/stop, reconnect, ffmpeg errors).
  useEffect(() => window.cue.on('stream:status', (s) => setStatus((prev) => ({ ...prev, ...s }))), []);

  const patch = useCallback(async (p) => {
    const next = { ...cfg, ...p };
    setCfg(next);
    await window.cue.output.stream.setConfig(p);
  }, [cfg]);

  async function goLive() {
    setError('');
    setBusy(true);
    const res = await window.cue.output.stream.start();
    setBusy(false);
    if (!res?.ok) setError(res?.error || 'Could not start the stream.');
  }
  async function stop() {
    setBusy(true);
    await window.cue.output.stream.stop();
    setBusy(false);
  }

  if (!cfg) return null;
  const live = status.active && status.state !== 'idle';
  const dot = status.state === 'live' ? 'bg-tertiary'
    : status.state === 'error' ? 'bg-error'
    : status.state === 'reconnecting' || status.state === 'starting' ? 'bg-primary'
    : 'bg-outline';
  const selRes = RESOLUTIONS.find((r) => r.width === cfg.width && r.height === cfg.height) || RESOLUTIONS[1];
  const hiQuality = (cfg.width >= 2560) && cfg.fps >= 60;

  return (
    <section className="space-y-md">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>live_tv</span>
            Streaming
          </h2>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Push the program output straight to YouTube / Facebook / any RTMP destination. Uses a stream key — no sign-in.
          </p>
        </div>
        <span className="inline-flex items-center gap-xs text-label-sm font-label-sm text-on-surface-variant shrink-0">
          <span className={`w-2 h-2 rounded-full ${dot} ${status.state === 'live' ? 'animate-pulse' : ''}`} />
          {STATE_LABEL[status.state] || status.state}
          {status.encoder && status.state === 'live' && <span className="text-on-surface-variant/50">· {status.encoder}</span>}
        </span>
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

      <div className="bg-surface-container-low border border-primary/20 rounded-xl p-md space-y-md ring-1 ring-primary/10">
        {/* Destination */}
        <label className="block">
          <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">RTMP server URL</span>
          <input
            type="text"
            value={cfg.server || ''}
            disabled={live}
            placeholder="rtmp://a.rtmp.youtube.com/live2"
            onChange={(e) => patch({ server: e.target.value })}
            className="mt-xs w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Stream key</span>
          <input
            type="password"
            value={cfg.key || ''}
            disabled={live}
            placeholder="xxxx-xxxx-xxxx-xxxx"
            onChange={(e) => patch({ key: e.target.value })}
            className="mt-xs w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
          />
          <span className="text-[10px] text-on-surface-variant/60">Stored on this machine. Keep it private.</span>
        </label>

        {/* Quality */}
        <div className="flex flex-wrap gap-md">
          <label className="flex flex-col gap-xs">
            <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Resolution</span>
            <select
              value={selRes.label}
              disabled={live}
              onChange={(e) => { const r = RESOLUTIONS.find((x) => x.label === e.target.value); if (r) patch({ width: r.width, height: r.height }); }}
              className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary cursor-pointer disabled:opacity-50"
            >
              {RESOLUTIONS.map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-xs">
            <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Frame rate</span>
            <select
              value={cfg.fps}
              disabled={live}
              onChange={(e) => patch({ fps: Number(e.target.value) })}
              className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary cursor-pointer disabled:opacity-50"
            >
              {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f} fps</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-xs">
            <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Video bitrate</span>
            <select
              value={cfg.videoBitrate}
              disabled={live}
              onChange={(e) => patch({ videoBitrate: e.target.value })}
              className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary cursor-pointer disabled:opacity-50"
            >
              {BITRATES.map((b) => <option key={b} value={b}>{b.replace('k', ' kbps')}</option>)}
            </select>
          </label>
        </div>

        {hiQuality && (
          <p className="text-[11px] text-on-surface-variant/70 flex items-start gap-xs">
            <span className="material-symbols-outlined text-[14px] text-outline shrink-0 mt-[1px]">info</span>
            1440p / 4K at 60 fps needs a hardware encoder and a strong CPU &amp; upload. If playback stutters, drop to 1080p.
          </p>
        )}

        {/* Go live */}
        <div className="flex items-center gap-sm pt-xs">
          {!live ? (
            <button
              onClick={goLive}
              disabled={busy || !cfg.server || !cfg.key}
              className="flex items-center gap-xs px-md py-sm rounded-lg text-label-sm font-label-sm font-bold bg-secondary text-on-secondary hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[16px]">sensors</span>
              {busy ? 'Starting…' : 'Go Live'}
            </button>
          ) : (
            <button
              onClick={stop}
              disabled={busy}
              className="flex items-center gap-xs px-md py-sm rounded-lg text-label-sm font-label-sm font-bold bg-error text-on-error hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">stop_circle</span>
              Stop Stream
            </button>
          )}
          {status.detail && status.state !== 'live' && (
            <span className="text-[11px] text-on-surface-variant/60 truncate max-w-[320px]">{status.detail}</span>
          )}
        </div>
      </div>

      <p className="text-[11px] text-on-surface-variant/60 flex items-start gap-xs">
        <span className="material-symbols-outlined text-[14px] text-outline shrink-0 mt-[1px]">volume_up</span>
        Stream audio is the in-room program audio. Create your broadcast in the platform's studio, copy its server URL + key here, then Go Live.
      </p>
    </section>
  );
}
