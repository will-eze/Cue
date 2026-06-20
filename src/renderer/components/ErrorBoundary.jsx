import React from 'react';

// Catches render-time exceptions in a view so a single bug can't blank the entire
// operator mid-service. Output windows are separate processes driven by main, so a
// renderer crash never drops the program feed — the fallback says so and offers a
// reload. Wrap each view in its own boundary so a crash in one can't take the others.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface for the dev console / future telemetry. Never re-throws.
    console.error(`[ErrorBoundary${this.props.label ? ' · ' + this.props.label : ''}]`, error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="h-full w-full flex items-center justify-center p-xl bg-surface">
        <div className="max-w-lg w-full bg-surface-container-low border border-error/40 rounded-xl overflow-hidden">
          <div className="px-lg py-md border-b border-outline-variant/20 flex items-center gap-sm">
            <span className="material-symbols-outlined text-error" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
            <h2 className="text-headline-md font-semibold text-on-surface">
              {this.props.label ? `${this.props.label} hit an error` : 'Something broke'}
            </h2>
          </div>
          <div className="px-lg py-md space-y-md">
            <p className="text-body-sm text-on-surface-variant">
              This view stopped rendering. <span className="text-tertiary">Your live outputs are unaffected</span> —
              they run in separate windows and keep showing whatever was last on air. Reload the
              interface to recover.
            </p>
            <pre className="text-[11px] font-mono text-on-surface-variant bg-surface-container-lowest border border-outline-variant/30 rounded-lg px-md py-sm overflow-auto max-h-40 whitespace-pre-wrap">
              {String(error?.stack || error?.message || error)}
            </pre>
            <div className="flex items-center justify-end gap-sm">
              <button
                onClick={() => this.setState({ error: null })}
                className="px-md py-xs text-label-sm font-label-sm font-bold text-on-surface-variant border border-outline-variant/40 rounded-lg hover:text-on-surface hover:border-outline-variant transition-all cursor-pointer uppercase tracking-[0.05em]"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-lg py-xs text-label-sm font-label-sm font-bold bg-primary-container text-on-primary rounded-lg hover:brightness-110 active:scale-95 transition-all cursor-pointer uppercase tracking-[0.05em]"
              >
                Reload UI
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
