import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalGuard } from '../utils/modalGuard';

const ITEM_CLS = (item) =>
  `w-full text-left px-md py-sm text-label-sm font-label-sm uppercase tracking-[0.05em] transition-colors flex items-center justify-between gap-sm ${
    item.disabled
      ? 'opacity-40 cursor-not-allowed text-on-surface-variant'
      : item.danger
      ? 'cursor-pointer text-error hover:bg-error/10 hover:text-error'
      : 'cursor-pointer text-on-surface-variant hover:bg-surface-variant hover:text-on-surface'
  }`;

export default function ContextMenu({ x, y, items, onClose }) {
  useModalGuard();
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Index of the item whose submenu is currently open (one nesting level).
  const [openSub, setOpenSub] = useState(null);
  // Index of the item waiting for inline confirmation (confirm: true items).
  const [confirmIdx, setConfirmIdx] = useState(null);

  useEffect(() => {
    function handleMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onCloseRef.current();
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') onCloseRef.current();
    }
    // Small delay so this listener doesn't fire on the mousedown that opened the menu
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown);
    }, 0);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const [pos, setPos] = useState({ top: y, left: x, visible: false });
  const subLeftSide = pos.left + 500 > window.innerWidth;

  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPos({
      top: Math.min(y, window.innerHeight - height - 8),
      left: Math.min(x, window.innerWidth - width - 8),
      visible: true,
    });
  }, [x, y]);

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, minWidth: 180, visibility: pos.visible ? 'visible' : 'hidden' }}
      className="bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl py-xs ring-1 ring-white/5"
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="border-t border-outline-variant/20 my-xs" />;
        }
        if (item.submenu) {
          const open = openSub === i;
          return (
            <div
              key={i}
              className="relative"
              onMouseEnter={() => setOpenSub(i)}
              onMouseLeave={() => setOpenSub((cur) => (cur === i ? null : cur))}
            >
              <button className={ITEM_CLS(item)}>
                <span className="whitespace-nowrap">{item.label}</span>
                <span className="material-symbols-outlined text-[16px] shrink-0 opacity-70">chevron_right</span>
              </button>
              {open && (
                <div
                  style={{ position: 'absolute', top: -4, [subLeftSide ? 'right' : 'left']: '100%', minWidth: 180, maxHeight: '70vh' }}
                  className="bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl py-xs ring-1 ring-white/5 overflow-y-auto"
                >
                  {item.submenu.map((sub, j) =>
                    sub.separator ? (
                      <div key={j} className="border-t border-outline-variant/20 my-xs" />
                    ) : (
                      <button key={j} onClick={sub.onClick} className={ITEM_CLS(sub)}>
                        <span className="whitespace-nowrap">{sub.label}</span>
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          );
        }
        if (item.confirm) {
          if (confirmIdx === i) {
            return (
              <div key={i} className="flex items-center gap-xs px-md py-sm">
                <span className="text-[10px] font-mono text-error uppercase tracking-[0.04em] flex-1 truncate">Delete?</span>
                <button
                  onClick={() => { item.onClick(); onCloseRef.current(); }}
                  className="text-[10px] font-mono text-error hover:text-error/70 cursor-pointer uppercase tracking-[0.04em] border border-error/40 px-sm py-[2px] rounded transition-colors shrink-0"
                >Yes</button>
                <button
                  onClick={() => setConfirmIdx(null)}
                  className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.04em] transition-colors shrink-0"
                >No</button>
              </div>
            );
          }
          return (
            <button key={i} onClick={() => setConfirmIdx(i)} className={ITEM_CLS(item)}>
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          );
        }
        return (
          <button key={i} onClick={item.disabled ? undefined : item.onClick} disabled={item.disabled} className={ITEM_CLS(item)}>
            <span className="whitespace-nowrap">{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}
