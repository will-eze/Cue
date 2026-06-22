import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Stream Studio ─────────────────────────────────────────────────────────────
// The broadcast switcher. Brings an external video + audio feed in (capture device /
// audio interface), composites Cue's program + stream-targeted graphics on top, and
// pushes the result to RTMP — independent of the in-room/NDI program. Houses the
// input setup, the live composite monitor, the layout/cut controls, and Go Live.
//
// Mounting opens the offscreen compositor window (ref-counted in main) so the preview
// runs; unmounting releases it. ffmpeg only spawns at Go Live.

const RESOLUTIONS = [
  { label: '720p',  width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: '1440p', width: 2560, height: 1440 },
  { label: '4K',    width: 3840, height: 2160 },
];
const FPS_OPTIONS = [30, 60];
const BITRATES = ['2500k', '4500k', '6000k', '9000k', '13000k', '20000k'];
const STATE_LABEL = { idle: 'Offline', starting: 'Starting…', live: 'Live', reconnecting: 'Reconnecting…', error: 'Error' };

const PIP_SIZES = [{ label: 'S', w: 25 }, { label: 'M', w: 33 }, { label: 'L', w: 42 }];
const PIP_CORNERS = [
  { id: 'tl', label: 'Top-left',  icon: 'north_west' },
  { id: 'tr', label: 'Top-right', icon: 'north_east' },
  { id: 'bl', label: 'Bot-left',  icon: 'south_west' },
  { id: 'br', label: 'Bot-right', icon: 'south_east' },
];
// Resolve a corner + size to an inset box (kept 16:9 by setting h% = w%, since the
// frame is 16:9). Margin 4% from the edges.
function cornerBox(corner, w) {
  const m = 4, h = w;
  const x = corner === 'tr' || corner === 'br' ? 100 - w - m : m;
  const y = corner === 'bl' || corner === 'br' ? 100 - h - m : m;
  return { x, y, w, h };
}
function activeCorner(pip) {
  const right = pip.x > 50, bottom = pip.y > 50;
  return bottom ? (right ? 'br' : 'bl') : (right ? 'tr' : 'tl');
}

export default function StreamView() {
  const [studio, setStudio] = useState(null);   // { videoDeviceId, audioDeviceId, audioMode, layout }
  const [cfg, setCfg] = useState(null);          // RTMP config
  const [status, setStatus] = useState({ active: false, state: 'idle', detail: null, encoder: null });
  const [videoInputs, setVideoInputs] = useState([]);
  const [audioInputs, setAudioInputs] = useState([]);
  const [preview, setPreview] = useState(null);  // dataUrl from the compositor
  const [levels, setLevels] = useState({ l: 0, r: 0 }); // stereo peak meters (0..1)
  const [health, setHealth] = useState(null); // { dropRate, sentRate } frames/sec, or null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const triedUnlockRef = useRef(false);
  const healthRef = useRef({ dropped: 0, sent: 0, t: 0 });

  const enumerate = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setVideoInputs(list.filter((d) => d.kind === 'videoinput'));
      setAudioInputs(list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'));
    } catch { /* enumeration unavailable */ }
  }, []);

  // Open the compositor (preview) on mount; release on unmount.
  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await window.cue.output.stream.open();
      if (!alive) return;
      setStudio(s);
      setCfg(await window.cue.output.stream.getConfig());
      setStatus(await window.cue.output.stream.status());
      await enumerate();
    })();
    const offStatus = window.cue.on('stream:status', (s) => {
      setStatus((prev) => ({ ...prev, ...s }));
      // Derive dropped/sent frames-per-second from successive cumulative counts.
      if (s.state === 'idle' || s.active === false) { setHealth(null); healthRef.current = { dropped: 0, sent: 0, t: 0 }; return; }
      if (typeof s.droppedFrames === 'number') {
        const now = Date.now();
        const prev = healthRef.current;
        const dt = (now - prev.t) / 1000;
        if (prev.t && dt > 0 && s.sentFrames >= prev.sent) {
          setHealth({ dropRate: Math.max(0, s.droppedFrames - prev.dropped) / dt, sentRate: Math.max(0, s.sentFrames - prev.sent) / dt });
        }
        healthRef.current = { dropped: s.droppedFrames, sent: s.sentFrames, t: now };
      }
    });
    const offPreview = window.cue.on('output:stream-preview', (dataUrl) => setPreview(dataUrl));
    const offLevels = window.cue.on('output:stream-levels', (lv) => setLevels(lv || { l: 0, r: 0 }));
    const onDev = () => enumerate();
    navigator.mediaDevices?.addEventListener?.('devicechange', onDev);
    return () => {
      alive = false;
      offStatus(); offPreview(); offLevels();
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDev);
      window.cue.output.stream.close();
    };
  }, [enumerate]);

  // Chromium hides device labels until a media grant. Unlock lazily, once.
  const unlockLabelsOnce = useCallback(async () => {
    if (triedUnlockRef.current) return;
    triedUnlockRef.current = true;
    const haveLabels = (videoInputs.every((d) => d.label) && audioInputs.every((d) => d.label));
    if ((videoInputs.length || audioInputs.length) && haveLabels) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await enumerate();
    } catch { /* denied — deviceId fallback still works */ }
  }, [videoInputs, audioInputs, enumerate]);

  const patchStudio = useCallback(async (partial) => {
    setStudio((prev) => {
      const next = { ...prev, ...partial };
      if (partial.layout) next.layout = { ...prev.layout, ...partial.layout, pip: { ...prev.layout.pip, ...(partial.layout.pip || {}) } };
      return next;
    });
    await window.cue.output.stream.setStudio(partial);
  }, []);
  const patchLayout = useCallback((partial) => patchStudio({ layout: partial }), [patchStudio]);

  const patchCfg = useCallback(async (p) => {
    setCfg((prev) => ({ ...prev, ...p }));
    await window.cue.output.stream.setConfig(p);
  }, []);

  async function goLive() {
    setError(''); setBusy(true);
    const res = await window.cue.output.stream.start();
    setBusy(false);
    if (!res?.ok) setError(res?.error || 'Could not start the stream.');
  }
  async function stop() { setBusy(true); await window.cue.output.stream.stop(); setBusy(false); }

  if (!studio || !cfg) return null;

  const live = status.active && status.state !== 'idle';
  const dot = status.state === 'live' ? 'bg-tertiary'
    : status.state === 'error' ? 'bg-error'
    : status.state === 'reconnecting' || status.state === 'starting' ? 'bg-primary'
    : 'bg-outline';
  const selRes = RESOLUTIONS.find((r) => r.width === cfg.width && r.height === cfg.height) || RESOLUTIONS[1];
  const L = studio.layout;
  const pip = L.pip || { which: 'feed', x: 66, y: 4, w: 30, h: 30 };

  // deviceIds can re-salt across sessions — fall back to a label match so the picker
  // still reflects the chosen device.
  const resolveValue = (list, id, label) =>
    list.some((d) => d.deviceId === id) ? id : (list.find((d) => d.label === label)?.deviceId || '');
  const videoValue = resolveValue(videoInputs, studio.videoDeviceId, studio.videoLabel);
  const audioValue = resolveValue(audioInputs, studio.audioDeviceId, studio.audioLabel);

  return (
    <div className="h-full flex bg-surface-container-low text-on-surface overflow-hidden">
      {/* ── Monitor (left) ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col p-md gap-md">
        <div className="flex items-center gap-sm shrink-0">
          <span className="material-symbols-outlined text-[18px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>live_tv</span>
          <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-on-surface-variant">Stream Monitor</span>
          <span className="inline-flex items-center gap-xs text-label-sm font-label-sm ml-auto">
            <span className={`w-2 h-2 rounded-full ${dot} ${status.state === 'live' ? 'animate-pulse' : ''}`} />
            {STATE_LABEL[status.state] || status.state}
            {status.encoder && status.state === 'live' && <span className="text-on-surface-variant/50">· {status.encoder}</span>}
          </span>
          {live && health && <StreamHealth health={health} />}
        </div>

        <div className="flex-1 min-h-0 rounded-xl border border-outline-variant/30 bg-black overflow-hidden flex items-center justify-center relative">
          {preview
            ? <img src={preview} alt="Stream preview" className="max-w-full max-h-full object-contain" style={{ aspectRatio: '16 / 9' }} />
            : <span className="text-on-surface-variant/40 text-label-sm font-label-sm uppercase tracking-widest">Starting preview…</span>}
          {live && <span className="absolute top-3 left-3 px-sm py-[2px] rounded text-label-sm font-label-sm font-bold uppercase bg-secondary text-on-secondary flex items-center gap-xs"><span className="w-[6px] h-[6px] rounded-full bg-on-secondary animate-pulse" />On Air</span>}
        </div>

        {/* Layout / cut switcher */}
        <div className="shrink-0 bg-surface-container border border-outline-variant/30 rounded-xl p-md space-y-sm">
          <p className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline">Program Source</p>
          <div className="flex gap-sm">
            {[
              { id: 'feed', label: 'Camera Feed', icon: 'videocam' },
              { id: 'program', label: 'Cue Program', icon: 'subtitles' },
              { id: 'pip', label: 'Picture-in-Picture', icon: 'picture_in_picture' },
            ].map((m) => (
              <button key={m.id} onClick={() => patchLayout({ mode: m.id })}
                className={`flex-1 flex items-center justify-center gap-xs h-9 rounded-lg text-label-sm font-label-sm font-bold uppercase tracking-[0.04em] transition-all active:scale-95 cursor-pointer border ${
                  L.mode === m.id ? 'bg-primary/15 border-primary/60 text-primary' : 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant/60'
                }`}>
                <span className="material-symbols-outlined text-[16px]">{m.icon}</span>{m.label}
              </button>
            ))}
          </div>

          {L.mode === 'feed' && (
            <label className="flex items-center gap-sm pt-xs cursor-pointer select-none">
              <input type="checkbox" checked={!!L.lyricsOverFeed} onChange={(e) => patchLayout({ lyricsOverFeed: e.target.checked })}
                className="accent-primary w-4 h-4 cursor-pointer" />
              <span className="text-body-sm text-on-surface">Show Cue lyrics / content over the feed</span>
            </label>
          )}

          {L.mode === 'pip' && (
            <div className="flex flex-wrap items-center gap-md pt-xs">
              <div className="flex items-center gap-xs">
                <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline">Inset</span>
                <div className="flex bg-surface-container-lowest border border-outline-variant/40 rounded overflow-hidden">
                  {[['feed', 'Camera'], ['program', 'Program']].map(([id, lbl]) => (
                    <button key={id} onClick={() => patchLayout({ pip: { which: id } })}
                      className={`px-sm h-6 text-label-sm font-label-sm uppercase tracking-[0.05em] cursor-pointer transition-colors ${pip.which === id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-xs">
                <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline">Corner</span>
                {PIP_CORNERS.map((c) => (
                  <button key={c.id} title={c.label} onClick={() => patchLayout({ pip: cornerBox(c.id, pip.w || 33) })}
                    className={`w-7 h-7 flex items-center justify-center rounded cursor-pointer transition-colors border ${activeCorner(pip) === c.id ? 'bg-primary/15 border-primary/60 text-primary' : 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant hover:text-on-surface'}`}>
                    <span className="material-symbols-outlined text-[15px]">{c.icon}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-xs">
                <span className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline">Size</span>
                {PIP_SIZES.map((s) => (
                  <button key={s.label} onClick={() => patchLayout({ pip: cornerBox(activeCorner(pip), s.w) })}
                    className={`w-7 h-7 flex items-center justify-center rounded text-label-sm font-label-sm font-bold cursor-pointer transition-colors border ${Math.round(pip.w) === s.w ? 'bg-primary/15 border-primary/60 text-primary' : 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant hover:text-on-surface'}`}>{s.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Controls (right) ─────────────────────────────────────────────────── */}
      <div className="w-[340px] shrink-0 border-l border-outline-variant/30 bg-surface-container-low overflow-y-auto custom-scrollbar p-md space-y-md">
        {error && (
          <div className="bg-error-container/20 border border-error/40 rounded-lg px-md py-sm flex items-start gap-sm">
            <span className="material-symbols-outlined text-[16px] text-error shrink-0 mt-[1px]">error</span>
            <p className="text-body-sm text-error flex-1">{error}</p>
            <button onClick={() => setError('')} className="text-error/70 hover:text-error cursor-pointer shrink-0"><span className="material-symbols-outlined text-[15px]">close</span></button>
          </div>
        )}

        {/* Inputs */}
        <section className="space-y-sm">
          <p className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline">Inputs</p>
          <label className="block">
            <span className="text-label-sm font-label-sm text-on-surface-variant">Video feed (capture device)</span>
            <select value={videoValue} onClick={unlockLabelsOnce}
              onChange={(e) => { const d = videoInputs.find((x) => x.deviceId === e.target.value); patchStudio({ videoDeviceId: d?.deviceId || null, videoLabel: d?.label || null }); }}
              className="mt-xs w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary cursor-pointer">
              <option value="">None</option>
              {videoInputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-label-sm font-label-sm text-on-surface-variant">Audio feed (audio interface)</span>
            <select value={audioValue} onClick={unlockLabelsOnce}
              onChange={(e) => { const d = audioInputs.find((x) => x.deviceId === e.target.value); patchStudio({ audioDeviceId: d?.deviceId || null, audioLabel: d?.label || null }); }}
              className="mt-xs w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary cursor-pointer">
              <option value="">None</option>
              {audioInputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${i + 1}`}</option>)}
            </select>
          </label>
          <div>
            <span className="text-label-sm font-label-sm text-on-surface-variant">Stream audio</span>
            <div className="mt-xs flex bg-surface-container-lowest border border-outline-variant/40 rounded overflow-hidden">
              {[['external', 'Feed only'], ['mixed', 'Feed + Cue media']].map(([id, lbl]) => (
                <button key={id} onClick={() => patchStudio({ audioMode: id })}
                  className={`flex-1 h-7 text-label-sm font-label-sm uppercase tracking-[0.04em] cursor-pointer transition-colors ${studio.audioMode === id ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}>{lbl}</button>
              ))}
            </div>
          </div>
          {/* Stereo level meters */}
          <div className="flex items-center gap-sm">
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant/60">graphic_eq</span>
            <div className="flex-1 flex flex-col gap-[3px]">
              <LevelBar value={levels.l} label="L" />
              <LevelBar value={levels.r} label="R" />
            </div>
          </div>
        </section>

        <div className="h-px bg-outline-variant/20" />

        {/* Destination */}
        <section className="space-y-sm">
          <p className="text-label-sm font-label-sm uppercase tracking-[0.05em] text-outline">Destination</p>
          <label className="block">
            <span className="text-label-sm font-label-sm text-on-surface-variant">RTMP server URL</span>
            <input type="text" value={cfg.server || ''} disabled={live} placeholder="rtmp://a.rtmp.youtube.com/live2"
              onChange={(e) => patchCfg({ server: e.target.value })}
              className="mt-xs w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary disabled:opacity-50" />
          </label>
          <label className="block">
            <span className="text-label-sm font-label-sm text-on-surface-variant">Stream key</span>
            <input type="password" value={cfg.key || ''} disabled={live} placeholder="xxxx-xxxx-xxxx-xxxx"
              onChange={(e) => patchCfg({ key: e.target.value })}
              className="mt-xs w-full bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary disabled:opacity-50" />
          </label>
          <div className="flex flex-wrap gap-sm">
            <label className="flex flex-col gap-xs flex-1">
              <span className="text-label-sm font-label-sm text-on-surface-variant">Resolution</span>
              <select value={selRes.label} disabled={live}
                onChange={(e) => { const r = RESOLUTIONS.find((x) => x.label === e.target.value); if (r) patchCfg({ width: r.width, height: r.height }); }}
                className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary cursor-pointer disabled:opacity-50">
                {RESOLUTIONS.map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-xs">
              <span className="text-label-sm font-label-sm text-on-surface-variant">FPS</span>
              <select value={cfg.fps} disabled={live} onChange={(e) => patchCfg({ fps: Number(e.target.value) })}
                className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary cursor-pointer disabled:opacity-50">
                {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-xs">
            <span className="text-label-sm font-label-sm text-on-surface-variant">Video bitrate</span>
            <select value={cfg.videoBitrate} disabled={live} onChange={(e) => patchCfg({ videoBitrate: e.target.value })}
              className="bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-[5px] text-body-md text-on-surface outline-none focus:border-primary cursor-pointer disabled:opacity-50">
              {BITRATES.map((b) => <option key={b} value={b}>{b.replace('k', ' kbps')}</option>)}
            </select>
          </label>
        </section>

        {/* Go live */}
        <div className="pt-xs">
          {!live ? (
            <button onClick={goLive} disabled={busy || !cfg.server || !cfg.key}
              className="w-full flex items-center justify-center gap-xs h-10 rounded-lg text-label-sm font-label-sm font-bold uppercase bg-secondary text-on-secondary hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              <span className="material-symbols-outlined text-[18px]">sensors</span>{busy ? 'Starting…' : 'Go Live'}
            </button>
          ) : (
            <button onClick={stop} disabled={busy}
              className="w-full flex items-center justify-center gap-xs h-10 rounded-lg text-label-sm font-label-sm font-bold uppercase bg-error text-on-error hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40">
              <span className="material-symbols-outlined text-[18px]">stop_circle</span>Stop Stream
            </button>
          )}
          {status.detail && status.state !== 'live' && <p className="mt-xs text-[11px] text-on-surface-variant/60 break-words">{status.detail}</p>}
        </div>

        <p className="text-[11px] text-on-surface-variant/60 leading-snug">
          The stream is its own program: your camera/mixer feed with Cue overlays. The in-room screens and NDI outputs keep showing Cue's program, unaffected. The monitor above is a low-rate preview — the live stream is full resolution and frame rate.
        </p>
      </div>
    </div>
  );
}

// Live connection health from the encoder's dropped-frame rate. Stable (green) vs
// Unstable (red) — dropped frames mean upload bandwidth or the encoder can't keep up.
function StreamHealth({ health }) {
  const stable = health.dropRate < 1;
  return (
    <span
      title={stable
        ? 'Encoder and connection are keeping up.'
        : 'Frames are being dropped — your upload bandwidth or the encoder can\'t keep up. Lower the bitrate/resolution, or use a wired connection.'}
      className={`inline-flex items-center gap-xs text-label-sm font-label-sm ${stable ? 'text-tertiary' : 'text-error'}`}>
      <span className="material-symbols-outlined text-[14px]">{stable ? 'check_circle' : 'warning'}</span>
      {stable ? 'Stable' : `Unstable · ${Math.round(health.dropRate)} fps dropped`}
    </span>
  );
}

// Horizontal peak meter. Green up to ~-6dBFS, amber to ~-1.5dBFS, red near clip — the
// filled width tracks the peak (0..1). A non-linear curve gives quiet signal presence.
function LevelBar({ value = 0, label }) {
  const v = Math.max(0, Math.min(1, value));
  const pct = Math.round(Math.pow(v, 0.5) * 100); // perceptual-ish
  const color = v >= 0.85 ? 'bg-error' : v >= 0.5 ? 'bg-tertiary' : 'bg-tertiary/70';
  return (
    <div className="flex items-center gap-xs">
      <span className="text-[9px] font-label-sm text-on-surface-variant/50 w-2">{label}</span>
      <div className="flex-1 h-[6px] rounded-full bg-surface-container-lowest border border-outline-variant/30 overflow-hidden">
        <div className={`h-full ${color} transition-[width] duration-75`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
