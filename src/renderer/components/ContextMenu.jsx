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

  const menuWidth = 200;
  const itemCount = items.filter(i => !i.separator).length;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - (itemCount * 30 + 16) - 8);

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 9999,
        width: menuWidth,
        background: '#0F1120',
        border: '1px solid #1E2232',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.5)',
        padding: '4px 0',
        overflow: 'hidden',
      }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} style={{ borderTop: '1px solid #1A1D27', margin: '3px 0' }} />;
        }
        return (
          <button
            key={i}
            onClick={item.onClick}
            className="w-full text-left cursor-pointer transition-colors"
            style={{
              display: 'block',
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 400,
              color: item.danger ? '#F87171' : '#A8AEBE',
              background: 'transparent',
              border: 'none',
              letterSpacing: '0.01em',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = item.danger ? 'rgba(239,68,68,0.08)' : '#141728';
              e.currentTarget.style.color = item.danger ? '#FCA5A5' : '#DEE2F0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = item.danger ? '#F87171' : '#A8AEBE';
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
