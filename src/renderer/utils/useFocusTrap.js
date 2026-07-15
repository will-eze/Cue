import { useEffect, useRef } from 'react';

// Keeps keyboard focus inside a modal/dialog for its lifetime, so Tab never
// escapes to the operator UI visible behind a centred dialog — matching how
// every native app traps focus in a modal. Pair with `useModalGuard` (which
// stands the operator shortcuts down) for a complete "this dialog owns the
// keyboard" experience.
//
//   const ref = useRef(null);
//   useFocusTrap(ref);            // autofocus + trap + restore
//   return <div ref={ref} …>…</div>;
//
// On mount it focuses the first focusable element (or, if `autoFocus` names a
// selector, that element); Tab/Shift+Tab wrap at the boundaries; on unmount the
// element that was focused before the dialog opened is restored.
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap(containerRef, { enabled = true, autoFocus } = {}) {
  const restoreRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    restoreRef.current = document.activeElement;

    const focusables = () =>
      Array.from(container.querySelectorAll(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Focus the requested element, else the first focusable, else the container.
    const initial = (autoFocus && container.querySelector(autoFocus)) || focusables()[0];
    if (initial) initial.focus();
    else { container.setAttribute('tabindex', '-1'); container.focus(); }

    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // If focus has somehow left the dialog, pull it back in.
      if (!container.contains(active)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    container.addEventListener('keydown', onKey);

    return () => {
      container.removeEventListener('keydown', onKey);
      // Restore focus to whatever was focused before the dialog opened.
      const el = restoreRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [containerRef, enabled, autoFocus]);
}
