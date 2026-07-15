import React, { useState, useEffect, useRef } from 'react';
import { useModalGuard } from '../utils/modalGuard';
import { useFocusTrap } from '../utils/useFocusTrap';

// CCLI reporting — every song that goes live is logged automatically (deduped
// per ~half-day in main). The Settings section stays compact: it just opens the
// report in a modal, where you pick a date range, review the aggregated rows, and
// export the CSV. Rows snapshot title/author/copyright at air time, so renamed or
// deleted songs still report what was actually shown.

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The full report lives here, behind a button, so the whole usage table no longer
// crowds the Settings page.
function CcliReportModal({ onClose }) {
  useModalGuard();
  const panelRef = useRef(null);
  useFocusTrap(panelRef);

  const [from, setFrom] = useState(() => isoDaysAgo(90));
  const [to, setTo] = useState(() => isoDaysAgo(0));
  const [report, setReport] = useState({ rows: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  async function load() {
    setLoading(true);
    try { setReport(await window.cue.songs.usageReport(from, to)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  function exportCsv() {
    const header = 'Title,Author,Copyright,Times Used,First Used,Last Used';
    const lines = report.rows.map((r) =>
      [r.title, r.author, r.copyright, r.times_used, r.first_used, r.last_used].map(csvEscape).join(','));
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cue-song-usage-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function clearLog() {
    await window.cue.songs.usageClear();
    setConfirmClear(false);
    load();
  }

  const dateCls = 'bg-surface-container-lowest border border-outline-variant/40 rounded px-md py-xs text-label-sm font-label-sm text-on-surface outline-none focus:border-primary [color-scheme:dark]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="CCLI Report"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        className="w-[900px] max-w-[92vw] max-h-[85vh] bg-surface-container-high border border-outline-variant/40 rounded-xl ring-1 ring-white/5 shadow-2xl flex flex-col"
      >
        <div className="flex items-start justify-between gap-md px-lg py-md border-b border-outline-variant/20 shrink-0">
          <div className="min-w-0">
            <h2 className="text-body-lg text-on-surface font-medium flex items-center gap-sm">
              <span className="material-symbols-outlined text-primary text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>receipt_long</span>
              Song Usage · CCLI Report
            </h2>
            <p className="text-label-sm font-label-sm text-on-surface-variant tracking-normal normal-case mt-xs">
              Pick a reporting period, review the songs aired, and export the CSV for your CCLI licence report.
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-variant cursor-pointer shrink-0">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        <div className="px-lg py-md flex flex-col gap-md min-h-0">
          <div className="flex items-center gap-md flex-wrap">
            <label className="flex items-center gap-sm text-label-sm font-label-sm text-on-surface-variant">
              From
              <input type="date" className={dateCls} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex items-center gap-sm text-label-sm font-label-sm text-on-surface-variant">
              To
              <input type="date" className={dateCls} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
            <div className="flex items-center gap-sm ml-auto">
              <button
                onClick={exportCsv}
                disabled={!report.rows.length}
                className="bg-primary text-on-primary px-lg py-sm rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-xs"
              >
                <span className="material-symbols-outlined text-[15px]">download</span>
                Export CSV
              </button>
              {confirmClear ? (
                <div className="flex items-center gap-xs">
                  <button onClick={clearLog} className="bg-error text-on-error px-md py-sm rounded text-label-sm font-label-sm cursor-pointer">Really clear?</button>
                  <button onClick={() => setConfirmClear(false)} className="bg-surface-container text-on-surface px-md py-sm rounded text-label-sm font-label-sm cursor-pointer">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  title="Delete the entire usage log"
                  className="bg-surface-container text-on-surface-variant px-md py-sm rounded text-label-sm font-label-sm hover:text-error transition-all cursor-pointer"
                >
                  Clear Log
                </button>
              )}
            </div>
          </div>

          <div className="border border-outline-variant/30 rounded-lg overflow-hidden flex flex-col min-h-0">
            <div className="grid grid-cols-[1fr_180px_220px_80px_110px] gap-md px-md py-sm bg-surface-container-high text-[10px] uppercase tracking-[0.1em] font-label-sm text-on-surface-variant/70 shrink-0">
              <span>Title</span><span>Author</span><span>Copyright</span><span className="text-right">Used</span><span className="text-right">Last Used</span>
            </div>
            <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: '48vh' }}>
              {loading ? (
                <div className="px-md py-lg text-label-sm font-label-sm text-on-surface-variant/50">Loading…</div>
              ) : report.rows.length === 0 ? (
                <div className="px-md py-lg text-label-sm font-label-sm text-on-surface-variant/50">
                  No songs were aired in this period. Usage is logged automatically the moment a song goes live.
                </div>
              ) : report.rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_180px_220px_80px_110px] gap-md px-md py-sm border-t border-outline-variant/15 text-body-sm text-on-surface items-baseline">
                  <span className="truncate font-medium">{r.title}</span>
                  <span className="truncate text-on-surface-variant">{r.author || '—'}</span>
                  <span className="truncate text-on-surface-variant">{r.copyright || '—'}</span>
                  <span className="text-right tabular-nums">{r.times_used}</span>
                  <span className="text-right tabular-nums text-on-surface-variant">{String(r.last_used).slice(0, 10)}</span>
                </div>
              ))}
            </div>
          </div>
          {report.rows.length > 0 && (
            <p className="text-label-sm font-label-sm text-on-surface-variant/60 shrink-0">
              {report.rows.length} distinct song{report.rows.length !== 1 ? 's' : ''} · {report.total} total plays in this period
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SongUsageSettings() {
  const [open, setOpen] = useState(false);

  return (
    <section className="space-y-md">
      <div className="flex items-center justify-between gap-md">
        <div>
          <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
            <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>receipt_long</span>
            Song Usage · CCLI Report
          </h2>
          <p className="text-body-md text-on-surface-variant mt-xs max-w-2xl">
            Every song aired is logged automatically (once per service). Open the report to pick a
            reporting period, review what was shown, and export the CSV for your CCLI licence report.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 bg-primary text-on-primary px-lg py-sm rounded text-label-sm font-label-sm font-bold hover:brightness-110 active:scale-95 transition-all cursor-pointer flex items-center gap-xs"
        >
          <span className="material-symbols-outlined text-[15px]">summarize</span>
          Open CCLI Report
        </button>
      </div>

      {open && <CcliReportModal onClose={() => setOpen(false)} />}
    </section>
  );
}
