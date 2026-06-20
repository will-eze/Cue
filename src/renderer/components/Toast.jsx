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

  const api = useRef(null);
  api.current = {
    show,
    dismiss,
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
  const border =
    toast.kind === 'error' ? 'border-error/40 ring-1 ring-error/10'
    : toast.kind === 'success' ? 'border-tertiary/40 ring-1 ring-tertiary/10'
    : 'border-outline-variant/40';
  const icon =
    toast.kind === 'error' ? 'error'
    : toast.kind === 'success' ? 'check_circle'
    : 'info';
  const iconColor =
    toast.kind === 'error' ? 'text-error'
    : toast.kind === 'success' ? 'text-tertiary'
    : 'text-on-surface-variant';

  return (
    <div className={`pointer-events-auto flex items-center gap-sm bg-surface-container-high border ${border} rounded-xl px-lg py-sm text-on-surface text-body-sm shadow-2xl`}>
      <span className={`material-symbols-outlined text-[18px] ${iconColor}`}>{icon}</span>
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
