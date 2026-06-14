import React, { useState, useEffect, useCallback } from 'react';

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

export default function ScriptureDetectionSettings() {
  const [cfg, setCfg] = useState(null);
  const [devices, setDevices] = useState([]);
  const [versions, setVersions] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setCfg(await window.cue.scriptureDetect.getConfig());
    setVersions(await window.cue.bible.versions());
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'audioinput'));
    } catch { /* permission not yet granted */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Live readiness / download / build progress.
  useEffect(() => {
    const off = window.cue.on('scripture:status', (s) => setCfg(s));
    return off;
  }, []);

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
        </Row>

        <Row label="Speech Model" hint="Larger = more accurate, more CPU">
          <div className="flex items-center gap-sm">
            <select value={cfg.asrModel} onChange={(e) => apply({ asrModel: e.target.value })} className={SELECT}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <StatusChip ok={ready.asr?.model} okText="Ready" pendingText="Download" onClick={downloadAsr} disabled={busy} />
          </div>
        </Row>
      </div>

      {/* Reference detection */}
      <ModeBlock
        title="Reference Detection"
        desc='Catches a spoken citation ("first Corinthians thirteen") and stages the passage.'
        mode={cfg.reference}
        disabled={busy}
        onToggle={() => apply({ reference: { enabled: !cfg.reference.enabled } })}
        onAuto={(v) => apply({ reference: { autoAction: v } })}
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

function ModeRows({ title, desc, mode, disabled, onToggle, onAuto }) {
  return (
    <>
      <Row label={title} hint={desc}>
        <Toggle on={mode.enabled} disabled={disabled} onClick={onToggle} />
      </Row>
      {mode.enabled && (
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
