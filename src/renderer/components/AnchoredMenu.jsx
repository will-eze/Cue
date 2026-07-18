import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A dropdown panel anchored to a trigger element, kept fully on-screen.
 *
 * The panel is portaled to <body> so no `overflow:hidden` ancestor (panels,
 * modals, scroll containers) can clip it, and it's positioned with fixed
 * coordinates measured from the anchor: it opens BELOW the anchor by default,
 * FLIPS ABOVE when there isn't room below, and CLAMPS horizontally so it never
 * runs off the left/right edge of the window. `align` pins the panel's left
 * ('left', default) or right ('right') edge to the matching edge of the anchor.
 *
 * Repositions on scroll/resize while open, and closes on an outside click or
 * Escape (capture-phase, so it doesn't also close a host modal/editor).
 *
 * Usage — the anchor MUST be a real element with a ref:
 *   <button ref={btnRef} onClick={() => setOpen(o => !o)}>…</button>
 *   <AnchoredMenu open={open} anchorRef={btnRef} onClose={() => setOpen(false)}
 *                 align="right" className="w-60 …menu styling…">
 *     …items…
 *   </AnchoredMenu>
 */
export default function AnchoredMenu({
  open,
  anchorRef,
  onClose,
  align = 'left',
  gap = 4,
  margin = 8,
  zIndex = 9999,
  className = '',
  style: extraStyle,
  children,
}) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, visible: false });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Vertical: below unless it would overflow AND there's more room above.
    const spaceBelow = vh - (a.bottom + gap);
    const spaceAbove = a.top - gap;
    let top = m.height <= spaceBelow || spaceBelow >= spaceAbove
      ? a.bottom + gap
      : a.top - gap - m.height;
    top = Math.max(margin, Math.min(top, vh - m.height - margin));

    // Horizontal: pin to the requested edge, then clamp into the viewport.
    let left = align === 'right' ? a.right - m.width : a.left;
    left = Math.max(margin, Math.min(left, vw - m.width - margin));

    setPos({ top, left, visible: true });
  }, [anchorRef, align, gap, margin]);

  useLayoutEffect(() => {
    if (!open) { setPos((p) => ({ ...p, visible: false })); return; }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // Re-place when the menu's own size changes (e.g. async-loaded content) so a
    // menu that grew can still flip/clamp to stay on-screen.
    const ro = menuRef.current && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(place)
      : null;
    if (ro && menuRef.current) ro.observe(menuRef.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      ro?.disconnect();
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (menuRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onCloseRef.current?.();
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.(); } }
    // Defer the outside-click listener so the same click that opened the menu
    // (still bubbling) doesn't immediately close it.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={menuRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex, visibility: pos.visible ? 'visible' : 'hidden', ...extraStyle }}
      className={className}
    >
      {children}
    </div>,
    document.body
  );
}
