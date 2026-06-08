import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handle);
    document.addEventListener('contextmenu', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('contextmenu', handle);
    };
  }, [onClose]);

  const menuWidth = 192;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - (items.length * 28 + 12) - 8);

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top, left, zIndex: 9999, width: menuWidth }}
      className="bg-slate-800 border border-slate-600 rounded-sm shadow-2xl py-1"
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="border-t border-slate-700 my-1" />;
        }
        return (
          <button
            key={i}
            onClick={item.onClick}
            className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors cursor-pointer ${
              item.danger
                ? 'text-red-400 hover:bg-slate-700 hover:text-red-300'
                : 'text-slate-200 hover:bg-slate-700'
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
