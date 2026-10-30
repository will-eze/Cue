import React from 'react';

// Operator confirmation surface for scripture detection. A slim strip: arm/disarm,
// the live transcript tail (so the operator trusts what's being heard), and the
// current verse suggestion(s) with a GO LIVE button. References arrive as the
// primary suggestion; content (quoted/paraphrased) matches are suggest-only.
// Guard rails: blue = staged/suggestion, red = live, green = GO; mono labels.

export default function ScriptureDetectionPanel({
  armed, onToggleArm, transcript, suggestions, onGoLive, onDismiss, captureActive, captureError,
}) {
  return (
    <div className="shrink-0 border-t border-outline-variant/30 bg-surface-container-low px-md py-xs flex items-center gap-md min-h-[44px]">
      {/* Arm/disarm */}
      <button
        onClick={onToggleArm}
        className={`btn btn-toggle btn-toggle-outline shrink-0 ${armed ? 'is-on-go' : ''}`}
        title="Listen for spoken scripture references and quotes"
      >
        <span className="material-symbols-outlined text-[16px]" style={armed ? { fontVariationSettings: "'FILL' 1" } : undefined}>
          {armed ? 'hearing' : 'hearing_disabled'}
        </span>
        {armed ? 'Listening' : 'Detect'}
      </button>

      {/* Live activity dot */}
      <span className="flex items-center gap-xs shrink-0">
        <span className={`w-[6px] h-[6px] rounded-full ${
          captureError ? 'bg-error' : armed && captureActive ? 'bg-tertiary animate-pulse' : 'bg-outline-variant'
        }`} />
      </span>

      {/* Transcript tail */}
      <div className="flex-1 min-w-0">
        {captureError ? (
          <span className="text-label-sm font-mono text-error truncate block">{captureError}</span>
        ) : (
          <span className="text-body-sm text-on-surface-variant/70 italic truncate block">
            {armed ? (transcript || 'Listening…') : 'Detection idle'}
          </span>
        )}
      </div>

      {/* Suggestions */}
      <div className="flex items-center gap-xs shrink-0 max-w-[55%] overflow-x-auto custom-scrollbar">
        {suggestions.map((s) => (
          <div
            key={s.id}
            className={`flex items-center gap-xs pl-sm pr-xs h-8 rounded-lg border shrink-0 transition-colors ${
              s.interim
                ? 'border-dashed border-primary/40 bg-primary/5 animate-pulse'
                : s.mode === 'reference'
                  ? 'border-primary/50 bg-primary/10'
                  : 'border-outline-variant/40 bg-surface-container-high'
            }`}
            title={s.interim ? 'Hearing… (interim — confirms when the phrase completes)' : undefined}
          >
            <span className={`material-symbols-outlined text-[15px] ${s.interim ? 'text-primary/70' : s.mode === 'reference' ? 'text-primary' : 'text-on-surface-variant'}`}>
              {s.interim ? 'graphic_eq' : s.mode === 'reference' ? 'menu_book' : 'format_quote'}
            </span>
            <span className="flex flex-col leading-tight min-w-0">
              <span className="text-label-sm font-mono font-bold text-on-surface truncate">{s.ref}</span>
              <span className="text-[11px] font-mono text-on-surface-variant/60">
                {s.interim ? 'hearing…' : `${s.mode} · ${Math.round((s.confidence || 0) * 100)}%`}
              </span>
            </span>
            <button
              onClick={() => onGoLive(s)}
              className="btn btn-sm btn-go"
              title="Send this verse live"
            >
              Go
            </button>
            <button
              onClick={() => onDismiss(s)}
              className="btn-icon btn-icon-danger"
              title="Dismiss"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          </div>
        ))}
        {armed && suggestions.length === 0 && !captureError && (
          <span className="text-[11px] font-mono text-on-surface-variant/60 px-sm">
            No verse detected yet
          </span>
        )}
      </div>
    </div>
  );
}
