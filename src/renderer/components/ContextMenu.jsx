import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const ITEM_CLS = (item) =>
  `w-full text-left cursor-pointer px-md py-sm text-label-sm font-label-sm uppercase tracking-[0.05em] transition-colors flex items-center justify-between gap-sm ${
    item.danger
      ? 'text-error hover:bg-error/10 hover:text-error'
      : 'text-on-surface-variant hover:bg-surface-variant hover:text-on-surface'
  }`;

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Index of the item whose submenu is currently open (one nesting level).
  const [openSub, setOpenSub] = useState(null);

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

  const menuWidth = 200;
  const itemCount = items.filter(i => !i.separator).length;
  const sepCount = items.filter(i => i.separator).length;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - (itemCount * 32 + sepCount * 9 + 16) - 8);
  // Flip submenus to the left when there isn't room for a second column on the right.
  const subLeftSide = left + menuWidth * 2 + 16 > window.innerWidth;

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top, left, zIndex: 9999, width: menuWidth }}
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
                <span className="truncate">{item.label}</span>
                <span className="material-symbols-outlined text-[16px] shrink-0 opacity-70">chevron_right</span>
              </button>
              {open && (
                <div
                  style={{ position: 'absolute', top: -4, [subLeftSide ? 'right' : 'left']: '100%', width: 220, maxHeight: '70vh' }}
                  className="bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl py-xs ring-1 ring-white/5 overflow-y-auto"
                >
                  {item.submenu.map((sub, j) =>
                    sub.separator ? (
                      <div key={j} className="border-t border-outline-variant/20 my-xs" />
                    ) : (
                      <button key={j} onClick={sub.onClick} className={ITEM_CLS(sub)}>
                        <span className="truncate">{sub.label}</span>
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          );
        }
        return (
          <button key={i} onClick={item.onClick} className={ITEM_CLS(item)}>
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}
