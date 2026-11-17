import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalGuardWhile } from '../utils/modalGuard';

const ITEM_SEL = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"]), button:not([disabled]), a[href]';

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
  autoFocusFirst = true,
  className = '',
  style: extraStyle,
  children,
}) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, visible: false });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Operator transport shortcuts stand down while a menu is open.
  useModalGuardWhile(open);

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
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        // Hand focus back to the trigger so keyboard users keep their place.
        try { anchorRef.current?.focus?.({ focusVisible: false, preventScroll: true }); } catch { /* best-effort */ }
      }
    }
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

  // Menu semantics + keyboard navigation. Items are whatever buttons/links the
  // caller renders, so roles are applied from the DOM rather than per consumer.
  useEffect(() => {
    if (!open) return undefined;
    const menu = menuRef.current;
    if (!menu) return undefined;
    const items = () => Array.from(menu.querySelectorAll(ITEM_SEL)).filter((el) => el.offsetParent !== null);
    const decorate = () => {
      menu.querySelectorAll('button, a[href]').forEach((el) => { if (!el.getAttribute('role')) el.setAttribute('role', 'menuitem'); });
    };
    decorate();
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(decorate) : null;
    mo?.observe(menu, { childList: true, subtree: true });
    // Move focus to the first item unless something inside already has it
    // (e.g. a search field that autofocuses).
    // (rAF: the panel is visibility:hidden until placed, and hidden nodes can't focus.)
    // Never steal focus from a text field (e.g. an autocomplete whose anchor is an
    // input: its onBlur would close the menu and the operator couldn't type).
    const isTextEl = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    const raf = requestAnimationFrame(() => {
      if (!autoFocusFirst) return;
      const ae = document.activeElement;
      if (isTextEl(ae) || isTextEl(anchorRef.current)) return;
      if (!menu.contains(ae)) items()[0]?.focus({ preventScroll: true });
    });

    const onKeyDown = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing) return;
      const list = items();
      const i = list.indexOf(document.activeElement);
      let next = null;
      if (e.key === 'ArrowDown') next = list[(i + 1) % list.length];
      else if (e.key === 'ArrowUp') next = list[(i <= 0 ? list.length : i) - 1];
      else if (e.key === 'Home') next = list[0];
      else if (e.key === 'End') next = list[list.length - 1];
      else if (e.key === 'Enter' || e.key === ' ') {
        // Native button activation does the work; just keep the operator's
        // GO/Space handler from also firing.
        e.stopPropagation();
        if (i < 0 && list.length) { e.preventDefault(); list[0].click(); }
        return;
      } else return;
      e.preventDefault(); e.stopPropagation();
      next?.focus({ preventScroll: true });
    };
    menu.addEventListener('keydown', onKeyDown);
    return () => { cancelAnimationFrame(raf); menu.removeEventListener('keydown', onKeyDown); mo?.disconnect(); };
  }, [open, autoFocusFirst, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex, visibility: pos.visible ? 'visible' : 'hidden', ...extraStyle }}
      className={className}
    >
      {children}
    </div>,
    document.body
  );
}
