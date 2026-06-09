import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top, left, zIndex: 9999, width: menuWidth }}
      className="bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl py-xs overflow-hidden ring-1 ring-white/5"
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="border-t border-outline-variant/20 my-xs" />;
        }
        return (
          <button
            key={i}
            onClick={item.onClick}
            className={`w-full text-left cursor-pointer px-md py-sm text-label-sm font-label-sm uppercase tracking-[0.05em] transition-colors ${
              item.danger
                ? 'text-error hover:bg-error/10 hover:text-error'
                : 'text-on-surface-variant hover:bg-surface-variant hover:text-on-surface'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
