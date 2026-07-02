import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GPU_MODELS, downloadGpuModel, removeGpuModel, clearGpuModels } from '../audio/gpuModelStore';

// Scripture detection — listen to the service audio and surface the relevant verse
// automatically (spoken references + quoted/paraphrased content). Fully local: an
// on-device Whisper ASR model and a sentence-embedding model, both auto-downloaded
// on first enable (no manual binary install). References arm a primary suggestion;
// content matches are suggest-only. Auto-go-live is opt-in per mode.

const MODELS = [
  { id: 'tiny.en',  label: 'Tiny (fastest)' },
  { id: 'base.en',  label: 'Base (balanced)' },
  { id: 'small.en', label: 'Small (most accurate)' },
];

// Responsiveness presets bundle the latency knobs (VAD close + live interim decode +
// lexical-match aggressiveness). Instant = present partials as soon as a verse is
// identifiable; Accurate = wait for the full phrase (original behaviour).
const RESPONSIVENESS = [
  ['instant',  'Instant',  'Aggressive live partials + snappy phrase close. Fastest, may briefly self-correct.'],
  ['balanced', 'Balanced', 'Live partials with a steadier phrase close. Recommended.'],
  ['accurate', 'Accurate', 'No live partials — waits for the full phrase. Most stable, slowest.'],
];

export default function ScriptureDetectionSettings() {
  const [cfg, setCfg] = useState(null);
  const [devices, setDevices] = useState([]);
  const [versions, setVersions] = useState([]);
  const [busy, setBusy] = useState(false);

  const [deviceError, setDeviceError] = useState('');

  const load = useCallback(async () => {
    setCfg(await window.cue.scriptureDetect.getConfig());
    setVersions(await window.cue.bible.versions());
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'audioinput'));
      setDeviceError('');
    } catch {
      setDeviceError('Microphone access denied — grant permission in System Preferences → Privacy → Microphone, then reopen Settings.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Live readiness / download / build progress.
  useEffect(() => {
    const off = window.cue.on('scripture:status', (s) => setCfg(s));
    return off;
  }, []);

  // Reference detection is configured entirely by the confidence bar, which pins the
  // On-Detect action to 'preview' (the live band is the only path to air, gated by the
  // opt-in toggle). Migrate any legacy autoAction once so the bands stay coherent.
  useEffect(() => {
    if (cfg && cfg.reference && cfg.reference.autoAction !== 'preview') {
      window.cue.scriptureDetect.setConfig({ reference: { autoAction: 'preview' } }).then(setCfg);
    }
  }, [cfg?.reference?.autoAction]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback(async (patch) => {
    setBusy(true);
    setCfg(await window.cue.scriptureDetect.setConfig(patch));
    setBusy(false);
  }, []);

  if (!cfg) return null;
  const ready = cfg.ready || {};
  const vectors = ready.vectors || {};
  const matchVersionId = cfg.matchVersionId ?? vectors.versionId ?? versions[0]?.id ?? null;

  async function downloadAsr() {
    setBusy(true);
    await window.cue.scriptureDetect.ensureAsrModel();
    setBusy(false);
  }
  async function buildVectors() {
    setBusy(true);
    await window.cue.scriptureDetect.buildVectors(matchVersionId);
    setBusy(false);
  }

  const buildPct = vectors.progress?.total
    ? Math.round((vectors.progress.done / vectors.progress.total) * 100)
    : null;

  return (
    <section className="space-y-md">
      <div>
        <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>hearing</span>
          Scripture Detection
        </h2>
        <p className="text-body-sm text-on-surface-variant mt-xs">
          Listen to the service audio and surface the verse automatically — spoken references
          ("turn to John three sixteen") and quoted/paraphrased verses. Fully local; no internet
          needed once the models are downloaded.
        </p>
      </div>

      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
        <Row label="Enable" hint="Show the detection strip in the operator">
          <Toggle on={cfg.enabled} disabled={busy} onClick={() => apply({ enabled: !cfg.enabled })} />
        </Row>

        <Row label="Audio Input" hint="Service / line feed to listen to">
          {deviceError ? (
            <p className="text-body-sm text-error leading-snug">{deviceError}</p>
          ) : (
            <select
              value={cfg.deviceId || ''}
              onChange={(e) => apply({ deviceId: e.target.value || null })}
              className={SELECT}
            >
              <option value="">System default</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0, 6)}`}</option>
              ))}
            </select>
          )}
        </Row>

        <Row label="CPU Model" hint="On-device Whisper for the CPU engine (fallback)">
          <div className="flex items-center gap-sm">
            <select value={cfg.asrModel} onChange={(e) => apply({ asrModel: e.target.value })} className={SELECT}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <StatusChip ok={ready.asr?.model} okText="Ready" pendingText="Download" onClick={downloadAsr} disabled={busy} />
          </div>
        </Row>

        <GpuEngineSettings cfg={cfg} apply={apply} busy={busy} />

        <Row label="Responsiveness" hint="How quickly to present vs how sure to be">
          <div className="flex items-center gap-xs">
            {RESPONSIVENESS.map(([v, lbl, tip]) => (
              <button
                key={v}
                title={tip}
                onClick={() => apply({ responsiveness: v })}
                disabled={busy}
                className={`px-sm h-8 rounded-lg text-label-sm font-mono uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                  (cfg.responsiveness || 'balanced') === v
                    ? 'bg-primary/15 border-primary/50 text-primary'
                    : 'bg-surface-container-high border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </Row>
      </div>

      {/* Reference detection — confidence bands on a single bar (the bar IS the config;
          autoAction is pinned to 'preview' under the hood, the bands express the rest). */}
      <ModeBlock
        title="Reference Detection"
        desc='Catches a spoken citation ("first Corinthians thirteen") and stages the passage.'
        mode={cfg.reference}
        disabled={busy}
        onToggle={() => apply({ reference: { enabled: !cfg.reference.enabled } })}
        bands
        thresholds={cfg.thresholds}
        autoLive={cfg.reference.autoLive}
        onThresholds={(patch) => apply({ reference: { autoAction: 'preview' }, thresholds: patch })}
        onAutoLive={(next, extra) =>
          apply({ reference: { autoAction: 'preview', autoLive: next }, ...(extra ? { thresholds: extra } : {}) })
        }
      />

      {/* Content matching */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
        <ModeRows
          title="Content Matching"
          desc="Identifies a quoted/paraphrased verse with no citation. Needs a verse-vector index."
          mode={cfg.content}
          disabled={busy}
          onToggle={() => apply({ content: { enabled: !cfg.content.enabled } })}
          onAuto={(v) => apply({ content: { autoAction: v } })}
        />
        <Row label="Match Translation" hint="Which version content matches resolve to">
          <select
            value={matchVersionId || ''}
            onChange={(e) => apply({ matchVersionId: Number(e.target.value) })}
            className={SELECT}
          >
            {versions.map((v) => <option key={v.id} value={v.id}>{v.abbrev} — {v.name}</option>)}
          </select>
        </Row>
        <Row label="Verse Index" hint="One-time build per translation (~31k verses)">
          {vectors.building ? (
            <span className="text-label-sm font-mono text-primary">
              Building{buildPct != null ? ` ${buildPct}%` : '…'}
            </span>
          ) : (
            <div className="flex items-center gap-sm">
              <StatusChip ok={vectors.built} okText="Built" pendingText="Build" onClick={buildVectors} disabled={busy} />
              {!ready.embed?.model && <span className="text-[10px] font-mono text-on-surface-variant/50">+ model download</span>}
            </div>
          )}
        </Row>
      </div>
    </section>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────
const SELECT =
  'h-8 px-sm text-label-sm font-mono text-on-surface bg-surface-container-lowest border border-outline-variant/50 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 cursor-pointer max-w-[260px]';

function Row({ label, hint, children }) {
  return (
    <div className="px-md py-sm border-b border-outline-variant/20 last:border-b-0 flex items-center gap-lg">
      <div className="w-44 shrink-0">
        <p className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em]">{label}</p>
        {hint && <p className="text-[11px] text-on-surface-variant mt-[2px]">{hint}</p>}
      </div>
      <div className="ml-auto">{children}</div>
    </div>
  );
}

function ModeBlock(props) {
  return (
    <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
      <ModeRows {...props} />
    </div>
  );
}

function ModeRows({ title, desc, mode, disabled, onToggle, onAuto, bands, thresholds, autoLive, onThresholds, onAutoLive }) {
  const floorPct   = Math.round((thresholds?.referenceConfidence ?? 0.6) * 100);
  const previewPct = Math.round((thresholds?.referenceAutoConfidence ?? 0.8) * 100);
  const livePct    = Math.round((thresholds?.referenceAutoLiveConfidence ?? 0.97) * 100);

  // Enabling auto-live introduces a third divider, so re-normalize the whole triple to
  // a < b < c ≤ 99 in one commit — guarantees the new live band can never sit below the
  // preview band regardless of where the operator had dragged things.
  const toggleAutoLive = () => {
    const next = !autoLive;
    if (!next) { onAutoLive(false); return; }
    let c = Math.min(99, Math.max(livePct, 2));
    let b = Math.min(previewPct, c - 1);
    let a = Math.max(1, Math.min(floorPct, b - 1));
    if (b <= a) b = a + 1;
    if (c <= b) c = Math.min(99, b + 1);
    onAutoLive(true, {
      referenceConfidence: a / 100,
      referenceAutoConfidence: b / 100,
      referenceAutoLiveConfidence: c / 100,
    });
  };

  return (
    <>
      <Row label={title} hint={desc}>
        <Toggle on={mode.enabled} disabled={disabled} onClick={onToggle} />
      </Row>

      {/* Content matching keeps the simple three-way action picker (it has no bands). */}
      {mode.enabled && !bands && (
        <Row label="On Detect" hint="Suggest only, or send straight to air">
          <div className="flex items-center gap-xs">
            {[['off', 'Suggest'], ['preview', 'Auto-Preview'], ['live', 'Auto-Live']].map(([v, lbl]) => (
              <button
                key={v}
                onClick={() => onAuto(v)}
                disabled={disabled}
                className={`px-sm h-8 rounded-lg text-label-sm font-mono uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                  mode.autoAction === v
                    ? v === 'live'
                      ? 'bg-secondary/15 border-secondary/50 text-secondary'
                      : 'bg-primary/15 border-primary/50 text-primary'
                    : 'bg-surface-container-high border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </Row>
      )}

      {/* Reference detection: one bar, drag the dividers to size each confidence band. */}
      {mode.enabled && bands && (
        <>
          <div className="px-md pt-sm pb-md border-b border-outline-variant/20">
            <p className="text-[11px] text-on-surface-variant mb-sm">
              Drag the dividers to set how a citation is handled at each confidence level.
            </p>
            <ConfidenceBar
              floorPct={floorPct}
              previewPct={previewPct}
              livePct={livePct}
              autoLive={!!autoLive}
              disabled={disabled}
              onCommit={(a, b, c) => onThresholds({
                referenceConfidence: a / 100,
                referenceAutoConfidence: b / 100,
                referenceAutoLiveConfidence: c / 100,
              })}
            />
          </div>
          <Row label="Auto-Go-Live" hint="Add a top band that airs a near-certain citation">
            <Toggle on={!!autoLive} disabled={disabled} onClick={toggleAutoLive} />
          </Row>
        </>
      )}
    </>
  );
}

// A single segmented bar (0–100% confidence) with draggable dividers. Bands have fixed
// meanings — Ignore · Suggest · Auto-Preview · Auto-Live (the last only when armed). Drag
// updates locally for a smooth feel; the new thresholds are committed once on release.
function ConfidenceBar({ floorPct, previewPct, livePct, autoLive, disabled, onCommit }) {
  const trackRef = useRef(null);
  const [drag, setDrag] = useState(null);                 // 'a' | 'b' | 'c' | null
  const [vals, setVals] = useState({ a: floorPct, b: previewPct, c: livePct });
  const valsRef = useRef(vals);
  valsRef.current = vals;

  // Mirror external changes when not mid-drag.
  useEffect(() => {
    if (!drag) setVals({ a: floorPct, b: previewPct, c: livePct });
  }, [floorPct, previewPct, livePct, drag]);

  const clampFor = (v, key, pct) => {
    if (key === 'a') return Math.min(Math.max(pct, 1), v.b - 1);
    if (key === 'b') return Math.min(Math.max(pct, v.a + 1), autoLive ? v.c - 1 : 100);
    return Math.min(Math.max(pct, v.b + 1), 99); // 'c'
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      const r = trackRef.current?.getBoundingClientRect();
      if (!r) return;
      const pct = Math.round(((e.clientX - r.left) / r.width) * 100);
      setVals((v) => ({ ...v, [drag]: clampFor(v, drag, pct) }));
    };
    const up = () => {
      setDrag(null);
      const { a, b, c } = valsRef.current;
      onCommit(a, b, c);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag]); // eslint-disable-line react-hooks/exhaustive-deps

  const { a, b, c } = vals;
  const segs = [
    { key: 'ignore',  from: 0, to: a, label: 'Ignore',       cls: 'bg-surface-container-highest', txt: 'text-on-surface-variant/60' },
    { key: 'suggest', from: a, to: b, label: 'Suggest',      cls: 'bg-on-surface-variant/15',     txt: 'text-on-surface-variant' },
    autoLive
      ? { key: 'preview', from: b, to: c,   label: 'Auto-Preview', cls: 'bg-primary/25',   txt: 'text-primary' }
      : { key: 'preview', from: b, to: 100, label: 'Auto-Preview', cls: 'bg-primary/25',   txt: 'text-primary' },
    ...(autoLive ? [{ key: 'live', from: c, to: 100, label: 'Auto-Live', cls: 'bg-secondary/25', txt: 'text-secondary' }] : []),
  ];
  const handles = autoLive ? ['a', 'b', 'c'] : ['a', 'b'];
  const handlePct = { a, b, c };

  return (
    <div
      ref={trackRef}
      className={`relative h-14 w-full rounded-lg overflow-hidden select-none bg-surface-container-lowest border border-outline-variant/40 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      {segs.map((s) => {
        const w = s.to - s.from;
        return (
          <div
            key={s.key}
            className={`absolute top-0 bottom-0 flex flex-col items-center justify-center gap-[2px] ${s.cls} ${s.txt}`}
            style={{ left: `${s.from}%`, width: `${w}%` }}
          >
            {w >= 11 && (
              <>
                <span className="text-[10px] font-mono uppercase tracking-[0.06em] leading-none whitespace-nowrap">{s.label}</span>
                <span className="text-[10px] font-mono opacity-70 leading-none">{s.from}–{s.to}%</span>
              </>
            )}
          </div>
        );
      })}
      {handles.map((key) => (
        <button
          key={key}
          onPointerDown={(e) => { if (!disabled) { e.preventDefault(); setDrag(key); } }}
          className="absolute top-0 bottom-0 w-5 -ml-[10px] z-10 flex items-center justify-center cursor-ew-resize touch-none"
          style={{ left: `${handlePct[key]}%` }}
          aria-label={`${key} divider ${handlePct[key]}%`}
        >
          <span className="w-[3px] h-8 rounded-full bg-on-surface/85" />
        </button>
      ))}
    </div>
  );
}

// WebGPU engine selector + opt-in GPU model store. The GPU path is strictly additive:
// pref Auto/WebGPU/CPU, and the GPU models are downloaded explicitly here (never on arm).
// A hardware (non-fallback) navigator.gpu adapter is required for WebGPU to be usable.
const ENGINE_OPTS = [
  ['auto', 'Auto', 'WebGPU when a GPU + downloaded model are present, else CPU'],
  ['webgpu', 'WebGPU', 'Force the GPU engine (needs a downloaded GPU model)'],
  ['cpu', 'CPU', 'Force the CPU engine'],
];
function fmtMB(bytes) {
  if (!bytes) return '0 MB';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function GpuEngineSettings({ cfg, apply, busy }) {
  const [hw, setHw] = useState(undefined);   // undefined = probing · null = none · { label }
  const [usage, setUsage] = useState(0);
  const [dl, setDl] = useState(null);        // { id, pct } while downloading
  const [err, setErr] = useState(null);

  const refreshUsage = useCallback(() => {
    window.cue.scriptureDetect.getGpuModelUsage().then(setUsage).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.gpu) { if (!cancelled) setHw(null); return; }
        const adapter = await navigator.gpu.requestAdapter();
        if (cancelled) return;
        if (!adapter || adapter.isFallbackAdapter) { setHw(null); return; }
        const info = adapter.info || {};
        setHw({ label: [info.vendor, info.architecture || info.description].filter(Boolean).join(' ') || 'GPU' });
      } catch { if (!cancelled) setHw(null); }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { refreshUsage(); }, [refreshUsage]);

  const engine = cfg.asrEngine || 'auto';
  const gpuModel = cfg.gpuModel || 'small.en';
  const downloaded = cfg.gpuModels || {};

  const onDownload = async (id) => {
    setErr(null); setDl({ id, pct: 0 });
    try {
      await downloadGpuModel(id, (pct) => setDl({ id, pct }));
      await apply({ gpuModels: { ...downloaded, [id]: true } });
      refreshUsage();
    } catch (e) { setErr(`${id}: ${e.message || 'download failed'}`); }
    finally { setDl(null); }
  };
  const onRemove = async (id) => {
    await removeGpuModel(id);
    const next = { ...downloaded }; delete next[id];
    await apply({ gpuModels: next });
    refreshUsage();
  };
  const onClear = async () => {
    await clearGpuModels();
    await apply({ gpuModels: {} });
    refreshUsage();
  };

  return (
    <>
      <Row label="Engine" hint="WebGPU is faster + more accurate where a GPU is available">
        <div className="flex flex-col items-end gap-xs">
          <div className="flex items-center gap-xs">
            {ENGINE_OPTS.map(([v, lbl, tip]) => (
              <button
                key={v}
                title={tip}
                onClick={() => apply({ asrEngine: v })}
                disabled={busy || (v !== 'cpu' && hw === null)}
                className={`px-sm h-8 rounded-lg text-label-sm font-mono uppercase tracking-[0.05em] border transition-colors cursor-pointer disabled:opacity-40 ${
                  engine === v
                    ? 'bg-primary/15 border-primary/50 text-primary'
                    : 'bg-surface-container-high border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <span className="text-[11px] font-mono text-on-surface-variant">
            {hw === undefined ? 'Detecting GPU…' : hw ? `GPU: ${hw.label}` : 'No hardware GPU — CPU only'}
          </span>
        </div>
      </Row>

      {engine !== 'cpu' && hw && (
        <div className="px-md py-sm border-b border-outline-variant/20 space-y-sm">
          <p className="text-[11px] text-on-surface-variant">
            GPU models are downloaded on demand — nothing ships pre-installed. Pick one to use as the active model.
          </p>
          {GPU_MODELS.map((m) => {
            const isDownloaded = !!downloaded[m.id];
            const isActive = gpuModel === m.id;
            const downloading = dl?.id === m.id;
            return (
              <div key={m.id} className="flex items-center gap-sm">
                <button
                  onClick={() => apply({ gpuModel: m.id })}
                  disabled={busy}
                  className={`flex-1 text-left px-sm py-xs rounded-lg border transition-colors cursor-pointer ${
                    isActive ? 'bg-primary/10 border-primary/50' : 'bg-surface-container-high border-outline-variant/40 hover:border-on-surface-variant/60'
                  }`}
                >
                  <span className={`text-label-sm font-mono ${isActive ? 'text-primary' : 'text-on-surface'}`}>{m.label}</span>
                  <span className="block text-[10px] text-on-surface-variant">{m.sub} · ~{m.approxMB} MB</span>
                </button>
                {downloading ? (
                  <span className="text-label-sm font-mono text-primary w-20 text-right animate-pulse">{dl.pct}%</span>
                ) : isDownloaded ? (
                  <div className="flex items-center gap-xs w-20 justify-end">
                    <span className="material-symbols-outlined text-[15px] text-tertiary">check_circle</span>
                    <button onClick={() => onRemove(m.id)} disabled={busy} title="Remove" className="material-symbols-outlined text-[15px] text-on-surface-variant hover:text-error cursor-pointer">delete</button>
                  </div>
                ) : (
                  <button
                    onClick={() => onDownload(m.id)}
                    disabled={busy || !!dl}
                    className="flex items-center gap-xs px-sm h-8 rounded-lg border border-outline-variant/40 bg-surface-container-high text-on-surface-variant text-label-sm font-mono uppercase tracking-[0.05em] hover:text-primary hover:border-primary/50 transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined text-[15px]">download</span>Get
                  </button>
                )}
              </div>
            );
          })}
          {err && <p className="text-[11px] font-mono text-error">{err}</p>}
          <div className="flex items-center justify-between pt-xs">
            <span className="text-[11px] font-mono text-on-surface-variant">Downloaded GPU models: {fmtMB(usage)}</span>
            {usage > 0 && (
              <button onClick={onClear} disabled={busy} className="text-[11px] font-mono text-on-surface-variant hover:text-error transition-colors cursor-pointer disabled:opacity-40">Clear all</button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StatusChip({ ok, okText, pendingText, onClick, disabled }) {
  if (ok) {
    return (
      <span className="flex items-center gap-xs text-label-sm font-mono uppercase tracking-[0.05em] text-tertiary">
        <span className="material-symbols-outlined text-[15px]">check_circle</span>{okText}
      </span>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-xs px-sm h-8 rounded-lg border border-outline-variant/40 bg-surface-container-high text-on-surface-variant text-label-sm font-mono uppercase tracking-[0.05em] hover:text-primary hover:border-primary/50 transition-colors cursor-pointer disabled:opacity-40"
    >
      <span className="material-symbols-outlined text-[15px]">download</span>{pendingText}
    </button>
  );
}

function Toggle({ on, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${
        on ? 'bg-tertiary' : 'bg-surface-container-highest border border-outline-variant/40'
      }`}
    >
      <span className={`absolute top-[3px] w-[18px] h-[18px] rounded-full transition-all ${on ? 'left-[22px] bg-on-tertiary' : 'left-[3px] bg-on-surface-variant'}`} />
    </button>
  );
}
