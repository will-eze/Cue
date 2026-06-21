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

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) { clearTimeout(tm); timers.current.delete(id); }
  }, []);

  const show = useCallback((opts) => {
    const o = typeof opts === 'string' ? { message: opts } : (opts || {});
    const id = ++_id;
    const duration = o.duration ?? 4000;
    setToasts((list) => [...list, { id, message: o.message, kind: o.kind || 'info', action: o.action || null }]);
    if (duration > 0) {
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
    const duration = o.duration ?? 4000;
    if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
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
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastHost({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-sm pointer-events-none">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastRow({ toast, onDismiss }) {
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
    <div className={`pointer-events-auto flex items-center gap-sm bg-surface-container-high border ${border} rounded-xl px-lg py-sm text-on-surface text-body-sm shadow-2xl`}>
      <span className={`material-symbols-outlined text-[18px] ${iconColor} ${isPending ? 'animate-spin' : ''}`}>{icon}</span>
      <span className="max-w-[420px] truncate">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => { try { toast.action.onClick?.(); } finally { onDismiss(); } }}
          className="ml-sm shrink-0 px-md py-[3px] text-label-sm font-bold uppercase tracking-[0.05em] text-primary border border-primary/40 rounded-lg hover:bg-primary-container/20 active:scale-95 transition-all cursor-pointer"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={onDismiss}
        className="ml-xs shrink-0 w-5 h-5 flex items-center justify-center text-on-surface-variant/60 hover:text-on-surface cursor-pointer"
        aria-label="Dismiss"
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}
