import React, { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';

// Network control API — a local HTTP server that turns a Stream Deck (via
// Bitfocus Companion), a MIDI bridge, or any phone on the LAN into a transport
// surface (GO / CLEAR / LOGO / NEXT / PREV / SELECT). Localhost-only by default;
// LAN access is opt-in and always token-gated.

export default function RemoteSettings() {
  const [cfg, setCfg] = useState(null);   // { enabled, port, lan, token, running, urls }
  const [portInput, setPortInput] = useState('7373');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null); // which url/token was just copied

  const load = useCallback(async () => {
    const c = await window.cue.remote.getConfig();
    setCfg(c);
    setPortInput(String(c.port ?? 7373));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function apply(patch) {
    setBusy(true);
    const c = await window.cue.remote.setConfig(patch);
    setCfg(c);
    setPortInput(String(c.port ?? 7373));
    setBusy(false);
  }

  async function commitPort() {
    const p = Math.max(1, Math.min(65535, parseInt(portInput, 10) || 7373));
    if (cfg && p === cfg.port) return;
    await apply({ port: p });
  }

  async function regenerate() {
    setBusy(true);
    setCfg(await window.cue.remote.regenerateToken());
    setBusy(false);
  }

  async function regenerateView() {
    setBusy(true);
    setCfg(await window.cue.remote.regenerateViewToken());
    setBusy(false);
  }

  function copy(text, id) {
    navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  }

  if (!cfg) return null;

  const enabled = cfg.enabled;
  // The pairing URL a phone scans/types — first LAN url if available, else loopback.
  const lanUrl = (cfg.urls || []).find((u) => !u.includes('127.0.0.1'));
  const baseUrl = lanUrl || (cfg.urls || [])[0] || `http://127.0.0.1:${cfg.port}`;
  const pairUrl = cfg.token ? `${baseUrl}/?token=${cfg.token}` : baseUrl;
  // View-only program mirror link (separate token from control).
  const viewUrl = cfg.viewToken ? `${baseUrl}/output?vt=${cfg.viewToken}` : null;

  return (
    <section className="space-y-md">
      <div>
        <h2 className="text-headline-md font-semibold text-on-surface flex items-center gap-sm">
          <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>cell_tower</span>
          Network Control
        </h2>
        <p className="text-body-sm text-on-surface-variant mt-xs">
          Drive live transport from a Stream Deck (via Bitfocus Companion), a MIDI bridge,
          or any phone on the network. Localhost-only by default; every request needs the pairing token.
        </p>
      </div>

      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
        {/* Enable */}
        <div className="px-md py-sm border-b border-outline-variant/20 flex items-center gap-lg">
          <div className="w-44 shrink-0">
            <p className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em]">Remote Server</p>
            <p className="text-[11px] text-on-surface-variant mt-[2px]">
              {cfg.running ? 'Running' : 'Stopped'}
            </p>
          </div>
          <Toggle on={enabled} disabled={busy} onClick={() => apply({ enabled: !enabled })} />
          <span className="flex items-center gap-xs ml-auto">
            <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${cfg.running ? 'bg-tertiary' : 'bg-outline-variant'}`} />
            <span className={`text-label-sm font-mono uppercase tracking-[0.05em] ${cfg.running ? 'text-tertiary' : 'text-on-surface-variant/50'}`}>
              {cfg.running ? 'Online' : 'Offline'}
            </span>
          </span>
        </div>

        {/* Port */}
        <div className="px-md py-sm border-b border-outline-variant/20 flex items-center gap-lg">
          <div className="w-44 shrink-0">
            <p className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em]">Port</p>
            <p className="text-[11px] text-on-surface-variant mt-[2px]">TCP port to listen on</p>
          </div>
          <input
            value={portInput}
            onChange={(e) => setPortInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
            onBlur={commitPort}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            inputMode="numeric"
            className="w-24 h-8 text-center text-label-sm font-mono text-on-surface bg-surface-container-lowest border border-outline-variant/50 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
        </div>

        {/* Allow LAN */}
        <div className="px-md py-sm flex items-center gap-lg">
          <div className="w-44 shrink-0">
            <p className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em]">Allow LAN Access</p>
            <p className="text-[11px] text-on-surface-variant mt-[2px]">
              Bind all interfaces so other devices can connect
            </p>
          </div>
          <Toggle on={cfg.lan} disabled={busy} onClick={() => apply({ lan: !cfg.lan })} />
          {cfg.lan && (
            <span className="ml-auto text-[11px] font-mono text-error/80 flex items-center gap-xs">
              <span className="material-symbols-outlined text-[14px]">public</span>
              Reachable on your network
            </span>
          )}
        </div>
      </div>

      {/* Pairing — only meaningful when enabled */}
      {enabled && cfg.token && (
        <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
          <div className="px-md py-sm border-b border-outline-variant/20 flex items-center justify-between">
            <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">Pairing</span>
            <button
              onClick={regenerate}
              disabled={busy}
              className="text-[11px] font-mono uppercase tracking-[0.05em] text-on-surface-variant hover:text-error transition-colors cursor-pointer flex items-center gap-xs disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[14px]">autorenew</span>
              Regenerate Token
            </button>
          </div>

          {/* Token */}
          <div className="px-md py-sm border-b border-outline-variant/20">
            <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-outline mb-xs">Token</p>
            <div className="flex items-center gap-sm">
              <code className="flex-1 min-w-0 truncate text-label-sm font-mono text-on-surface bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-[6px]">
                {cfg.token}
              </code>
              <CopyBtn copied={copied === 'token'} onClick={() => copy(cfg.token, 'token')} />
            </div>
          </div>

          {/* Connect URL(s) */}
          <div className="px-md py-sm">
            <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-outline mb-xs">
              Open on a phone (token included)
            </p>
            <div className="flex items-center gap-sm">
              <code className="flex-1 min-w-0 truncate text-label-sm font-mono text-primary bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-[6px]">
                {pairUrl}
              </code>
              <CopyBtn copied={copied === 'url'} onClick={() => copy(pairUrl, 'url')} />
            </div>
            {cfg.lan && (
              <div className="mt-sm flex justify-center">
                <QrCode text={pairUrl} />
              </div>
            )}
            {!cfg.lan && (
              <p className="text-[11px] text-on-surface-variant/60 mt-xs">
                Enable “Allow LAN Access” to reach this from another device.
              </p>
            )}
            {cfg.lan && (cfg.urls || []).filter((u) => !u.includes('127.0.0.1')).length > 1 && (
              <p className="text-[11px] text-on-surface-variant/60 mt-xs">
                Multiple network interfaces: {(cfg.urls || []).filter((u) => !u.includes('127.0.0.1')).join('  ·  ')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Remote Output — view-only program mirror */}
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
        <div className="px-md py-sm border-b border-outline-variant/20 flex items-center gap-lg">
          <div className="w-44 shrink-0">
            <p className="text-label-sm font-label-sm text-on-surface uppercase tracking-[0.05em]">Remote Output</p>
            <p className="text-[11px] text-on-surface-variant mt-[2px]">
              Mirror the live program (with audio) to a phone or laptop
            </p>
          </div>
          <Toggle on={cfg.outputEnabled} disabled={busy} onClick={() => apply({ outputEnabled: !cfg.outputEnabled })} />
          <span className="flex items-center gap-xs ml-auto">
            <span className={`w-[6px] h-[6px] rounded-full shrink-0 ${cfg.outputEnabled && cfg.running ? 'bg-tertiary' : 'bg-outline-variant'}`} />
            <span className={`text-label-sm font-mono uppercase tracking-[0.05em] ${cfg.outputEnabled && cfg.running ? 'text-tertiary' : 'text-on-surface-variant/50'}`}>
              {cfg.outputEnabled && cfg.running ? 'Live' : 'Off'}
            </span>
          </span>
        </div>

        {cfg.outputEnabled && viewUrl && (
          <>
            <div className="px-md py-sm border-b border-outline-variant/20 flex items-center justify-between">
              <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">View Link</span>
              <button
                onClick={regenerateView}
                disabled={busy}
                className="text-[11px] font-mono uppercase tracking-[0.05em] text-on-surface-variant hover:text-error transition-colors cursor-pointer flex items-center gap-xs disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[14px]">autorenew</span>
                Regenerate Link
              </button>
            </div>
            <div className="px-md py-sm">
              <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-outline mb-xs">
                Scan or open to watch the program (view-only)
              </p>
              <div className="flex items-center gap-sm">
                <code className="flex-1 min-w-0 truncate text-label-sm font-mono text-primary bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-sm py-[6px]">
                  {viewUrl}
                </code>
                <CopyBtn copied={copied === 'viewUrl'} onClick={() => copy(viewUrl, 'viewUrl')} />
              </div>
              {!cfg.lan ? (
                <p className="text-[11px] text-on-surface-variant/60 mt-xs">
                  Enable “Allow LAN Access” above to reach this from another device.
                </p>
              ) : (
                <div className="mt-sm flex justify-center">
                  <QrCode text={viewUrl} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Companion / API reference */}
      {enabled && (
        <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl overflow-hidden">
          <div className="px-md py-sm border-b border-outline-variant/20">
            <span className="text-label-sm font-label-sm text-on-surface-variant uppercase tracking-[0.05em]">
              HTTP API (Stream Deck / Companion)
            </span>
          </div>
          <div className="px-md py-sm space-y-[6px]">
            <ApiRow method="GET" path="/api/go · /clear · /logo · /next · /prev · /live" desc="Transport actions" />
            <ApiRow method="GET" path="/api/select?itemId=N" desc="Jump to a rundown item" />
            <ApiRow method="GET" path="/api/state" desc="Current state (JSON)" />
            <ApiRow method="GET" path="/api/stream" desc="Live state stream (SSE)" />
            <p className="text-[11px] text-on-surface-variant/60 pt-xs">
              Send the token as the <code className="font-mono text-on-surface-variant">X-Cue-Token</code> header
              or a <code className="font-mono text-on-surface-variant">?token=</code> query parameter.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function QrCode({ text, size = 152 }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: size * 2, color: { dark: '#000000', light: '#ffffff' } })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [text, size]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt="QR code"
      width={size}
      height={size}
      className="rounded-lg bg-white p-2"
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
    />
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
      <span
        className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-on-surface transition-all ${
          on ? 'left-[22px] bg-on-tertiary' : 'left-[3px] bg-on-surface-variant'
        }`}
      />
    </button>
  );
}

function CopyBtn({ copied, onClick }) {
  return (
    <button
      onClick={onClick}
      title="Copy"
      className={`h-8 px-sm shrink-0 rounded-lg border text-[11px] font-mono uppercase tracking-[0.05em] transition-colors cursor-pointer flex items-center gap-xs ${
        copied
          ? 'bg-tertiary-container/60 border-tertiary/50 text-tertiary'
          : 'bg-surface-container-high border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:border-outline-variant'
      }`}
    >
      <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function ApiRow({ method, path, desc }) {
  return (
    <div className="flex items-center gap-sm">
      <span className="text-[10px] font-mono font-bold text-tertiary bg-tertiary-container/30 border border-tertiary/30 rounded px-[6px] py-[2px] shrink-0">
        {method}
      </span>
      <code className="text-label-sm font-mono text-on-surface truncate">{path}</code>
      <span className="text-[11px] text-on-surface-variant/60 ml-auto shrink-0 hidden sm:inline">{desc}</span>
    </div>
  );
}
