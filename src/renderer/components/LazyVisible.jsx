import React, { useState, useRef, useEffect } from 'react';

// Render heavy children (a live SlidePreview with treatment overlays, backdrop-filter,
// etc.) only once the element scrolls near the viewport — so a 50-card theme gallery
// doesn't mount 50 previews at once. Once shown it stays mounted (no flicker on scroll-
// back). A same-size placeholder holds the layout so nothing jumps.
export default function LazyVisible({ children, placeholder = null, className = '', rootMargin = '400px' }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { rootMargin });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [shown, rootMargin]);

  return <div ref={ref} className={className}>{shown ? children : placeholder}</div>;
}
