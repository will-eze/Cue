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

  const menuWidth = 196;
  const itemCount = items.filter(i => !i.separator).length;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - (itemCount * 28 + 14) - 8);

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed', top, left,
        zIndex: 9999,
        width: menuWidth,
        background: '#111008',
        border: '1px solid #2A2520',
        borderRadius: 2,
        boxShadow: '0 8px 28px rgba(0,0,0,0.75), 0 2px 8px rgba(0,0,0,0.5)',
        padding: '4px 0',
      }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} style={{ borderTop: '1px solid #201D18', margin: '3px 0' }} />;
        }
        return (
          <button
            key={i}
            onClick={item.onClick}
            className="w-full text-left cursor-pointer"
            style={{
              display: 'block',
              padding: '6px 14px',
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              fontWeight: 400,
              letterSpacing: '0.01em',
              color: item.danger ? '#C45050' : '#907860',
              background: 'transparent',
              border: 'none',
              transition: 'all 80ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = item.danger ? 'rgba(180,40,40,0.08)' : '#1A1714';
              e.currentTarget.style.color = item.danger ? '#E06060' : '#C8C0B6';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = item.danger ? '#C45050' : '#907860';
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
