import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import AnchoredMenu from './AnchoredMenu';

/**
 * A horizontal toolbar that never lets its controls run off-screen.
 *
 * The classic "priority-plus" pattern: it measures the natural width of every
 * item in a hidden off-screen row, compares that to the space the container
 * actually has, and adapts in two stages —
 *   1. drop button labels to icon-only (for items that allow it), then
 *   2. collapse the trailing, non-pinned items into a "⋯" overflow menu
 *      (portaled + clamped on-screen via AnchoredMenu).
 * The menu always shows each collapsed item's icon + label, so nothing an
 * operator can reach on a big screen becomes unreachable on a laptop.
 *
 * Re-measures on container resize (ResizeObserver) and when the item set
 * changes, so it reacts live as the window is resized.
 *
 * Items (`items` prop) are descriptors, not JSX children, so the overflow menu
 * can render a proper menu row for anything that gets collapsed:
 *   { kind: 'button', id, icon, label, onClick, disabled, active, danger,
 *     title, className, pinned, keepLabel, collapsible }
 *   { kind: 'custom', id, render: ({ compact }) => node, menuRender?, pinned }
 *   { kind: 'divider' }                       // hairline; auto-dropped if orphaned
 *   { kind: 'spacer' }                         // flex-1 gap (push following right)
 *
 * `pinned` items stay inline and never move to the menu (use for primary
 * actions like GO / Save). `keepLabel` items never drop to icon-only.
 * `collapsible: false` is an alias for pinned. Custom items are pinned by
 * default unless they provide `menuRender` (or `render` is safe in a menu row).
 */

// Default inline button — styling matches the app's neutral toolbar buttons.
function DefaultButton({ item, compact }) {
  const base =
    'flex items-center gap-xs rounded text-label-sm font-label-sm transition-colors shrink-0 ' +
    (compact ? 'px-1 py-1 justify-center' : 'px-sm py-1') + ' ' +
    (item.active
      ? 'bg-surface-variant text-on-surface'
      : item.danger
      ? 'text-error hover:bg-error/10'
      : 'text-on-surface-variant hover:bg-surface-variant hover:text-on-surface') +
    ' disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <button
      type="button"
      onClick={item.onClick}
      disabled={item.disabled}
      title={item.title || item.label}
      className={item.className || base}
    >
      {item.icon && <span className="material-symbols-outlined text-[16px]">{item.icon}</span>}
      {!compact && item.label && <span>{item.label}</span>}
    </button>
  );
}

// A collapsed item rendered as a row inside the overflow menu.
function MenuRow({ item, onClose }) {
  if (item.menuRender) return item.menuRender({ onClose });
  return (
    <button
      type="button"
      disabled={item.disabled}
      onClick={() => { item.onClick?.(); onClose?.(); }}
      className={`w-full text-left px-md py-sm text-label-sm font-label-sm flex items-center gap-sm transition-colors ${
        item.disabled
          ? 'opacity-40 cursor-not-allowed text-on-surface-variant'
          : item.danger
          ? 'cursor-pointer text-error hover:bg-error/10'
          : 'cursor-pointer text-on-surface-variant hover:bg-surface-variant hover:text-on-surface'
      } ${item.active ? 'text-on-surface bg-surface-variant/50' : ''}`}
    >
      {item.icon && <span className="material-symbols-outlined text-[16px] shrink-0">{item.icon}</span>}
      <span className="truncate">{item.label}</span>
    </button>
  );
}

const isPinned = (it) => it.pinned || it.collapsible === false || (it.kind === 'custom' && !it.menuRender && it.pinned !== false);

// Content-box width of the toolbar (clientWidth includes horizontal padding, so
// subtract it — otherwise the row is allowed to overflow by the padding amount).
function availWidth(el) {
  const cs = getComputedStyle(el);
  return el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
}

export default function ResponsiveToolbar({
  items,
  gap = 4,
  className = '',
  moreIcon = 'more_horiz',
  moreLabel = 'More',
  moreClassName = '',
  menuClassName = 'min-w-[180px] max-w-[280px] py-xs bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-2xl ring-1 ring-white/5 overflow-hidden',
  menuAlign = 'right',
}) {
  const containerRef = useRef(null);
  const fullRowRef = useRef(null);       // hidden measurement row (labels shown)
  const compactRowRef = useRef(null);    // hidden measurement row (icon-only)
  const moreRef = useRef(null);          // width of the "⋯" trigger
  const anchorRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  // Measured widths, indexed to `items`. Re-measured on resize/item change.
  const [full, setFull] = useState([]);
  const [compact, setCompact] = useState([]);
  const [moreW, setMoreW] = useState(48);

  // Stable identity for the item set — remeasure when it changes.
  const itemsKey = useMemo(
    () => items.map((it) => `${it.kind || 'button'}:${it.id || ''}:${it.icon || ''}:${it.label || ''}:${it.disabled ? 1 : 0}:${it.active ? 1 : 0}`).join('|'),
    [items]
  );

  useLayoutEffect(() => {
    function measure() {
      if (fullRowRef.current) setFull(Array.from(fullRowRef.current.children).map((c) => c.offsetWidth));
      if (compactRowRef.current) setCompact(Array.from(compactRowRef.current.children).map((c) => c.offsetWidth));
      if (moreRef.current) setMoreW(moreRef.current.offsetWidth);
      if (containerRef.current) setContainerW(availWidth(containerRef.current));
    }
    measure();
    // Fonts (icon glyphs) can change widths after load — re-measure once ready.
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      if (containerRef.current) setContainerW(availWidth(containerRef.current));
    }) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    return () => ro?.disconnect();
  }, [itemsKey]);

  // Decide, given the measured widths and container size, how to render:
  // which items are visible inline, whether labels are dropped, and what
  // collapses into the menu.
  const layout = useMemo(() => {
    const n = items.length;
    if (!containerW || full.length !== n) {
      return { visible: items.map((_, i) => i), compactMode: false, overflow: [] };
    }
    const widthsFull = full;
    const widthsCompact = compact.length === n ? compact : full;
    const gapFor = (count) => Math.max(0, count - 1) * gap;

    // Total width if we show `visibleIdx` inline (using given per-item widths)
    // plus the overflow trigger when there are collapsed items.
    const rowWidth = (visibleIdx, widths, hasOverflow) => {
      let w = 0;
      for (const i of visibleIdx) w += widths[i] || 0;
      const count = visibleIdx.length + (hasOverflow ? 1 : 0);
      return w + gapFor(count) + (hasOverflow ? moreW : 0);
    };

    const allIdx = items.map((_, i) => i);

    // Stage 1: everything inline, labels shown.
    if (rowWidth(allIdx, widthsFull, false) <= containerW) {
      return { visible: allIdx, compactMode: false, overflow: [] };
    }
    // Stage 2: everything inline, icon-only where allowed.
    const canCompact = items.some((it) => it.kind === 'button' && !it.keepLabel);
    if (canCompact && rowWidth(allIdx, widthsCompact, false) <= containerW) {
      return { visible: allIdx, compactMode: true, overflow: [] };
    }
    // Stage 3: icon-only inline (if it helped) + collapse trailing non-pinned
    // items into the menu until the row fits.
    const widths = canCompact ? widthsCompact : widthsFull;
    const compactMode = canCompact;
    let visible = [...allIdx];
    const overflow = [];
    // Collapse from the right, skipping pinned items and structural items.
    const collapsible = (i) => {
      const it = items[i];
      return it.kind !== 'divider' && it.kind !== 'spacer' && !isPinned(it);
    };
    while (rowWidth(visible, widths, overflow.length > 0) > containerW) {
      // find rightmost collapsible still visible
      let target = -1;
      for (let k = visible.length - 1; k >= 0; k--) {
        if (collapsible(visible[k])) { target = k; break; }
      }
      if (target === -1) break; // nothing left to collapse
      overflow.push(visible[target]);
      visible.splice(target, 1);
    }
    overflow.sort((a, b) => a - b);
    return { visible, compactMode, overflow };
  }, [items, containerW, full, compact, moreW, gap]);

  // Drop dividers/spacers that ended up leading, trailing, or doubled once
  // their neighbours collapsed — keeps the inline row tidy.
  const cleanedVisible = useMemo(() => {
    const out = [];
    for (const i of layout.visible) {
      const it = items[i];
      if (it.kind === 'divider') {
        const prev = items[out[out.length - 1]];
        if (!prev || prev.kind === 'divider' || prev.kind === 'spacer') continue;
      }
      out.push(i);
    }
    // trim trailing divider
    while (out.length && items[out[out.length - 1]]?.kind === 'divider') out.pop();
    return out;
  }, [layout.visible, items]);

  const renderInline = (i, forMeasure, forceCompact) => {
    const it = items[i];
    const compactMode = forceCompact ?? layout.compactMode;
    if (it.kind === 'divider') return <span key={i} className="w-px self-stretch my-[3px] bg-outline-variant/40 shrink-0" />;
    if (it.kind === 'spacer') return <span key={i} className={forMeasure ? 'shrink-0' : 'flex-1 min-w-0'} />;
    if (it.kind === 'custom') return <span key={i} className="shrink-0 flex items-center">{it.render?.({ compact: compactMode })}</span>;
    return <DefaultButton key={i} item={it} compact={compactMode && !it.keepLabel} />;
  };

  const overflowItems = layout.overflow.map((i) => items[i]).filter((it) => it.kind !== 'divider' && it.kind !== 'spacer');
  const hasOverflow = overflowItems.length > 0;

  return (
    <div ref={containerRef} className={`relative flex items-center min-w-0 overflow-hidden ${className}`} style={{ gap }}>
      {cleanedVisible.map((i) => renderInline(i, false))}

      {hasOverflow && (
        <>
          <button
            ref={anchorRef}
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            title={moreLabel}
            className={moreClassName || 'flex items-center gap-xs px-sm py-1 rounded text-label-sm font-label-sm text-on-surface-variant hover:bg-surface-variant hover:text-on-surface transition-colors shrink-0'}
          >
            <span className="material-symbols-outlined text-[16px]">{moreIcon}</span>
          </button>
          <AnchoredMenu open={menuOpen} anchorRef={anchorRef} onClose={() => setMenuOpen(false)} align={menuAlign} className={menuClassName}>
            {overflowItems.map((it, k) => <MenuRow key={it.id || k} item={it} onClose={() => setMenuOpen(false)} />)}
          </AnchoredMenu>
        </>
      )}

      {/* Hidden measurement rows — never visible, only measured. */}
      <div aria-hidden ref={fullRowRef} className="absolute -left-[9999px] top-0 flex items-center pointer-events-none opacity-0" style={{ gap }}>
        {items.map((_, i) => renderInline(i, true, false))}
      </div>
      <div aria-hidden ref={compactRowRef} className="absolute -left-[9999px] top-0 flex items-center pointer-events-none opacity-0" style={{ gap }}>
        {items.map((_, i) => renderInline(i, true, true))}
      </div>
      <button aria-hidden ref={moreRef} tabIndex={-1} className="absolute -left-[9999px] top-0 flex items-center gap-xs px-sm py-1 rounded text-label-sm font-label-sm pointer-events-none opacity-0">
        <span className="material-symbols-outlined text-[16px]">{moreIcon}</span>
      </button>
    </div>
  );
}
