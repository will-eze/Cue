import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

// Unified transient-notification system. One provider at the app root replaces the
// per-page inline toasts that each settings panel used to reinvent, and carries the
// rundown undo affordance. Usage:
//   const toast = useToast();
//   toast.success('Saved');                       // green
//   toast.error('Import failed');                 // red
//   toast.show({ message, kind, duration, action: { label, onClick } });
// `action` renders a button (e.g. Undo); clicking it runs onClick then dismisses.
// duration 0 = sticky (caller dismisses). Returns an id for manual dismiss.
// `kind: 'pending'` renders an animated spinner (for in-flight work).
//   toast.update(id, { message, kind, duration });  // patch a live toast in place
//   await toast.promise(p, { pending, success, error });
// `promise` wraps an async op: it shows a spinner toast (after a short `delay` so
// instant ops don't flash), then swaps it in place to success/error when `p`
// settles. `success`/`error` may be strings or fns of the resolved value/error.

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

let _id = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const durations = useRef(new Map()); // id -> auto-dismiss ms (for re-arming after hover)

  // Errors linger longer than info so a volunteer mid-service has time to read them.
  const defaultDuration = (kind) => (kind === 'error' ? 10000 : 4000);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) { clearTimeout(tm); timers.current.delete(id); }
    durations.current.delete(id);
  }, []);

  // Pause the auto-dismiss while a toast is hovered / focused; re-arm on leave.
  const hold = useCallback((id) => {
    const tm = timers.current.get(id);
    if (tm) { clearTimeout(tm); timers.current.delete(id); }
  }, []);
  const release = useCallback((id) => {
    const d = durations.current.get(id);
    if (!d || timers.current.has(id)) return;
    timers.current.set(id, setTimeout(() => dismiss(id), Math.min(d, 4000)));
  }, [dismiss]);

  const show = useCallback((opts) => {
    const o = typeof opts === 'string' ? { message: opts } : (opts || {});
    const id = ++_id;
    const duration = o.duration ?? defaultDuration(o.kind);
    setToasts((list) => [...list, { id, message: o.message, kind: o.kind || 'info', action: o.action || null }]);
    if (duration > 0) {
      durations.current.set(id, duration);
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
    }
    return id;
  }, [dismiss]);

  // Patch a live toast in place (e.g. spinner → success). Re-arms the auto-dismiss
  // timer from the new duration. If the toast was already dismissed, the map below
  // matches nothing and the re-armed timer harmlessly dismisses a non-existent id.
  const update = useCallback((id, opts) => {
    const o = opts || {};
    setToasts((list) => list.map((t) => (t.id !== id ? t : {
      ...t,
      ...(o.message !== undefined ? { message: o.message } : {}),
      ...(o.kind !== undefined ? { kind: o.kind } : {}),
      ...(o.action !== undefined ? { action: o.action } : {}),
    })));
    const prev = timers.current.get(id);
    if (prev) { clearTimeout(prev); timers.current.delete(id); }
    const duration = o.duration ?? defaultDuration(o.kind);
    if (duration > 0) {
      durations.current.set(id, duration);
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
    } else {
      durations.current.delete(id);
    }
  }, [dismiss]);

  // Wrap an async op with a spinner toast that swaps to success/error in place.
  // The spinner only appears after `delay` ms so instant ops don't flash a toast.
  const promise = useCallback((p, opts = {}) => {
    const {
      pending = 'Working…', success = 'Done', error = 'Something went wrong',
      delay = 150, successDuration, errorDuration,
    } = opts;
    let id = null;
    const timer = setTimeout(() => {
      id = show({ message: pending, kind: 'pending', duration: 0 });
    }, delay);
    const settle = (message, kind, duration) => {
      clearTimeout(timer);
      if (id != null) update(id, { message, kind, duration });
      else show({ message, kind, duration });
    };
    return Promise.resolve(p).then(
      (val) => { settle(typeof success === 'function' ? success(val) : success, 'success', successDuration); return val; },
      (err) => { settle(typeof error === 'function' ? error(err) : error, 'error', errorDuration); throw err; },
    );
  }, [show, update]);

  const api = useRef(null);
  api.current = {
    show,
    dismiss,
    update,
    promise,
    success: (message, opts) => show({ ...opts, message, kind: 'success' }),
    error:   (message, opts) => show({ ...opts, message, kind: 'error' }),
    info:    (message, opts) => show({ ...opts, message, kind: 'info' }),
  };

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismiss} onHold={hold} onRelease={release} />
    </ToastContext.Provider>
  );
}

function ToastHost({ toasts, onDismiss, onHold, onRelease }) {
  // The live region stays mounted (even when empty) so screen readers announce additions.
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-sm pointer-events-none max-w-[calc(100vw-32px)]"
    >
      {toasts.map((t) => (
        <ToastRow
          key={t.id}
          toast={t}
          onDismiss={() => onDismiss(t.id)}
          onHold={() => onHold(t.id)}
          onRelease={() => onRelease(t.id)}
        />
      ))}
    </div>
  );
}

function ToastRow({ toast, onDismiss, onHold, onRelease }) {
  const isError = toast.kind === 'error';
  const isPending = toast.kind === 'pending';
  const border =
    toast.kind === 'error' ? 'border-error/40 ring-1 ring-error/10'
    : toast.kind === 'success' ? 'border-tertiary/40 ring-1 ring-tertiary/10'
    : isPending ? 'border-primary/40 ring-1 ring-primary/10'
    : 'border-outline-variant/40';
  const icon =
    toast.kind === 'error' ? 'error'
    : toast.kind === 'success' ? 'check_circle'
    : isPending ? 'progress_activity'
    : 'info';
  const iconColor =
    toast.kind === 'error' ? 'text-error'
    : toast.kind === 'success' ? 'text-tertiary'
    : isPending ? 'text-primary'
    : 'text-on-surface-variant';

  return (
    <div
      role={isError ? 'alert' : undefined}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
      onFocus={onHold}
      onBlur={onRelease}
      className={`pointer-events-auto flex ${isError ? 'items-start' : 'items-center'} gap-sm bg-surface-container-high border ${border} rounded-xl px-lg py-sm text-on-surface text-body-sm shadow-2xl`}
    >
      <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${iconColor} ${isPending ? 'animate-spin' : ''}`}>{icon}</span>
      <span className={`max-w-[420px] ${isError ? 'line-clamp-3 break-words' : 'truncate'}`}>{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => { try { toast.action.onClick?.(); } finally { onDismiss(); } }}
          className="btn btn-xs btn-secondary ml-sm shrink-0"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={onDismiss}
        className="btn-icon btn-icon-sm ml-xs"
        aria-label="Dismiss notification"
        title="Dismiss"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}
