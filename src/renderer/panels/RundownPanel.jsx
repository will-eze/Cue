import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalGuard } from '../utils/modalGuard';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ContextMenu from '../components/ContextMenu';
import { useToast } from '../components/Toast';
import MediaPickerModal from '../components/MediaPickerModal';
import SongPreviewModal from '../components/SongPreviewModal';
import SongEditor from '../components/SongEditor';
import ThemePickerModal from '../components/ThemePickerModal';
import { ensureThemeBg } from '../utils/ensureThemeBg';
import { isCuratedTheme } from '../utils/themeSort';

// Does a song rundown item carry legacy BAKED styling that "Clear baked styling" would
// strip? True if any section has a base look (keys beyond inline runs/textBox), or the
// song pins its own background / is locked, or the item has a per-slot bg override.
// Mirrors what db/themes.js resetSongToTheme actually clears.
const CONTENT_ONLY_KEYS = new Set(['runs', 'textBox']);
function songHasBakedStyle(item) {
  if (!item || item.item_type !== 'song') return false;
  if (item.song?.default_background_id || item.song?.background_locked) return true;
  if (item.background_override_id) return true;
  for (const sec of item.sections || []) {
    if (!sec.style_json) continue;
    try {
      const s = JSON.parse(sec.style_json);
      if (s && Object.keys(s).some((k) => !CONTENT_ONLY_KEYS.has(k))) return true;
    } catch { /* ignore malformed */ }
  }
  return false;
}
import PresentationEditor from '../components/PresentationEditor';
import MediaThumb from '../components/MediaThumb';

function SortableItem({ item, index, bgPath, isPreview, isLive, isSelected, liveSlideIdx, liveSlideCount, autoAdvanceStartAt, onClick, onDoubleClick, onContextMenu, onSetItemBackground }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const canDropBg = item.item_type === 'song' || item.item_type === 'scripture';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const dndStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const label = item.item_type === 'song'
    ? item.song?.title || 'Unknown Song'
    : item.item_type === 'media'
    ? item.asset?.filename || 'Media'
    : item.item_type === 'scripture'
    ? item.scripture?.reference || item.title || 'Scripture'
    : item.item_type === 'presentation'
    ? item.presentation?.title || 'Presentation'
    : item.item_type === 'youtube'
    ? item.youtube?.title || 'YouTube video'
    : item.item_type === 'live-input'
    ? item.liveInput?.name || item.liveInput?.sourceName || 'Live Video'
    : (item.content?.split('\n')[0]?.trim()) || 'Slide';

  const sublabel = item.item_type === 'song'
    ? `Song${item.song?.author ? ' · ' + item.song.author : ''}`
    : item.item_type === 'media' ? 'Media'
    : item.item_type === 'scripture'
    ? `Scripture${item.scripture?.versionAbbrev ? ' · ' + item.scripture.versionAbbrev : ''}`
    : item.item_type === 'presentation'
    ? `Presentation · ${item.slides?.length || 0} slide${item.slides?.length === 1 ? '' : 's'}`
    : item.item_type === 'youtube' ? 'YouTube'
    : item.item_type === 'live-input' ? 'Live Input · NDI'
    : 'Slide';

  // Live countdown for the auto-advance badge — ticks every second while live.
  const [, forceAdvTick] = useState(0);
  useEffect(() => {
    if (!isLive || !autoAdvanceStartAt || !item.advance_seconds) return;
    const id = setInterval(() => forceAdvTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [isLive, autoAdvanceStartAt, item.advance_seconds]);
  const advanceRemaining = (isLive && autoAdvanceStartAt && item.advance_seconds > 0)
    ? Math.max(0, Math.ceil(item.advance_seconds - (Date.now() - autoAdvanceStartAt) / 1000))
    : null;

  const typeIcon = item.item_type === 'song' ? 'music_note'
    : item.item_type === 'media' ? 'play_circle'
    : item.item_type === 'scripture' ? 'menu_book'
    : item.item_type === 'presentation' ? 'slideshow'
    : item.item_type === 'youtube' ? 'smart_display'
    : item.item_type === 'live-input' ? 'videocam'
    : 'article';

  // Ephemeral YouTube download state, shown as a compact badge so the operator
  // knows when a cue is safe to take live (GO is soft-blocked until 'ready').
  const yt = item.item_type === 'youtube' ? item.youtube : null;
  const ytBadge = !yt ? null
    : yt.status === 'ready'       ? { text: 'READY',     cls: 'bg-tertiary/15 text-tertiary border border-tertiary/30' }
    : yt.status === 'setup'       ? { text: 'SETUP',     cls: 'bg-primary-container/20 text-primary border border-primary/30' }
    : yt.status === 'downloading' ? { text: `${Math.round(yt.percent || 0)}%`, cls: 'bg-primary-container/20 text-primary border border-primary/30' }
    : yt.status === 'processing'  ? { text: 'PROC',      cls: 'bg-primary-container/20 text-primary border border-primary/30' }
    : yt.status === 'resolving'   ? { text: 'RESOLVING', cls: 'bg-surface-variant text-on-surface-variant' }
    : yt.status === 'error'       ? { text: 'ERROR',     cls: 'bg-error/15 text-error border border-error/30' }
    : { text: 'QUEUED', cls: 'bg-surface-variant text-on-surface-variant' };

  return (
    <div
      ref={setNodeRef}
      data-item-id={item.id}
      style={{ ...dndStyle, minHeight: 44 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (!canDropBg || !e.dataTransfer.types.includes('cue/assetid')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); }}
      onDrop={(e) => {
        setIsDragOver(false);
        if (!canDropBg) return;
        const assetId = Number(e.dataTransfer.getData('cue/assetid'));
        if (assetId) { e.preventDefault(); onSetItemBackground?.(item.id, assetId); }
      }}
      className={`flex items-center gap-sm px-sm cursor-pointer border-b border-outline-variant/20 group ${
        isLive ? 'tally-live' : isPreview ? 'tally-preview' : 'tally-idle hover:bg-surface-variant'
      } ${isSelected ? 'ring-1 ring-inset ring-primary/70 bg-primary/5' : ''} ${isDragOver ? 'ring-2 ring-inset ring-primary bg-primary/10' : ''}`}
    >
      {/* Drag handle */}
      <button
        className="drag-handle shrink-0 flex items-center justify-center opacity-20 group-hover:opacity-100 transition-opacity"
        style={{ width: 14, color: '#424754' }}
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
        tabIndex={-1}
      >
        <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor">
          <circle cx="1.5" cy="1.5" r="1"/><circle cx="4.5" cy="1.5" r="1"/>
          <circle cx="1.5" cy="5" r="1"/><circle cx="4.5" cy="5" r="1"/>
          <circle cx="1.5" cy="8.5" r="1"/><circle cx="4.5" cy="8.5" r="1"/>
        </svg>
      </button>

      {/* Icon / background thumbnail */}
      {(() => {
        // Mirror the live output cascade (lock → override → song → global → black)
        // via the resolver OperatorView passes down; fall back to the item's own
        // assets if no resolver is wired (so the thumbnail never goes blank).
        const thumbPath = bgPath
          ?? (item.background_override || item.song?.default_background
            || (item.item_type === 'media' ? item.asset : null))?.path
          ?? null;
        return (
          <div className={`w-12 h-8 bg-black rounded overflow-hidden shrink-0 relative flex items-center justify-center ${
            isLive ? 'border border-secondary/30' : isPreview ? 'border border-primary/30' : ''
          }`}>
            {thumbPath && (
              <MediaThumb path={thumbPath} className="absolute inset-0 w-full h-full object-cover opacity-70" />
            )}
            <span
              className={`relative material-symbols-outlined text-[18px] ${thumbPath ? 'opacity-0' : ''} ${
                isLive ? 'text-secondary' : isPreview ? 'text-primary' : 'text-outline-variant'
              }`}
              style={isLive ? { fontVariationSettings: "'FILL' 1" } : {}}
            >
              {isLive ? 'sensors' : isPreview ? 'visibility' : typeIcon}
            </span>
          </div>
        );
      })()}

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className={`text-label-sm font-bold truncate ${
          isLive ? 'text-secondary' : isPreview ? 'text-primary' : 'text-on-surface'
        }`}>
          {label}
        </p>
        <div className="flex items-center gap-xs min-w-0 mt-0.5">
          <p className="text-[10px] text-on-surface-variant truncate shrink-0">{sublabel}</p>
          {(item.song?.tags || []).length > 0 && (
            <div className="flex items-center gap-xs min-w-0 overflow-hidden">
              {item.song.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag.id}
                  className="text-[8px] font-mono font-bold leading-none px-xs py-[2px] rounded-full text-white/95 whitespace-nowrap"
                  style={{ background: tag.colour || '#4d8eff' }}
                  title={tag.name}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* State badges */}
      <div className="flex items-center gap-xs shrink-0 pr-xs">
        {isLive && (
          <span className="font-label-sm text-[9px] font-bold tracking-widest bg-secondary-container text-on-secondary-container px-sm py-[2px] rounded uppercase">
            LIVE
          </span>
        )}
        {isPreview && !isLive && (
          <span className="font-label-sm text-[9px] font-bold tracking-widest bg-primary-container/20 text-primary border border-primary/30 px-sm py-[2px] rounded uppercase">
            PRVW
          </span>
        )}
        {ytBadge && (
          <span
            title={yt.status === 'error' ? (yt.error || 'Download failed') : undefined}
            className={`font-label-sm text-[9px] font-bold tracking-wider px-xs py-[2px] rounded uppercase ${ytBadge.cls}`}
          >
            {ytBadge.text}
          </span>
        )}
        {(item.item_type === 'media' || item.item_type === 'youtube') && !!item.media_loop && (
          <span className="font-label-sm text-[9px] tracking-wider bg-primary-container/20 text-primary border border-primary/30 px-xs py-[2px] rounded uppercase">
            LOOP
          </span>
        )}
        {isLive && liveSlideCount > 1 && (
          <span className="font-label-sm text-[9px] tracking-wider text-secondary/80 tabular-nums">
            {liveSlideIdx + 1}/{liveSlideCount}
          </span>
        )}
        {item.advance_seconds > 0 && (
          <span
            className={`flex items-center gap-[2px] font-label-sm text-[9px] tracking-wider px-xs py-[2px] rounded uppercase tabular-nums ${
              advanceRemaining != null
                ? 'bg-tertiary/15 text-tertiary border border-tertiary/30'
                : 'bg-surface-variant text-on-surface-variant'
            }`}
            title={item.advance_loop === 'item' ? 'Auto-advance · loops this item' : 'Auto-advance · continues rundown'}
          >
            <span className="material-symbols-outlined text-[11px] leading-none">
              {item.advance_loop === 'item' ? 'repeat_one' : 'timer'}
            </span>
            {advanceRemaining != null ? `${advanceRemaining}s` : `${item.advance_seconds}s`}
          </span>
        )}
        {/* This item overrides the service/app look (item tier of the cascade). */}
        {item.theme_override_id ? (
          <span title="Custom theme for this item" className="flex items-center font-label-sm text-[9px] tracking-wider px-xs py-[2px] rounded uppercase bg-primary/10 text-primary border border-primary/25">
            <span className="material-symbols-outlined text-[11px] leading-none">palette</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

// Set / clear an item's auto-advance interval. Presets cover the common pre-roll
// rotations; the field accepts any whole-second value. "Off" clears it (manual).
const ADVANCE_PRESETS = [5, 10, 15, 20, 30, 45, 60];

const LOOP_MODES = [
  { id: 'rundown', label: 'Continue rundown', hint: 'Roll into the next item; wrap to the top at the end.' },
  { id: 'item',    label: 'Loop this item',   hint: 'Rotate this item’s slides forever.' },
];

function AutoAdvanceModal({ item, onApply, onClose }) {
  useModalGuard();
  const [secs, setSecs] = useState(item.advance_seconds > 0 ? String(item.advance_seconds) : '');
  const [loop, setLoop] = useState(item.advance_loop === 'item' ? 'item' : 'rundown');
  // Default on (matches the column default) so a brand-new auto-advance wraps.
  const [wrap, setWrap] = useState(item.advance_wrap !== 0);

  function apply(value) {
    const n = Math.round(Number(value));
    onApply(Number.isFinite(n) && n > 0 ? n : null, loop, wrap);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[340px] bg-surface-container-high border border-outline-variant/40 rounded-xl shadow-2xl ring-1 ring-white/5 p-lg">
        <h3 className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface-variant mb-1">Auto-Advance</h3>
        <p className="text-[11px] text-on-surface-variant/70 mb-md leading-snug">
          When this item is live, move forward automatically after the set interval.
        </p>

        <div className="grid grid-cols-4 gap-xs mb-md">
          {ADVANCE_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setSecs(String(p))}
              className={`py-xs text-[11px] font-mono rounded border cursor-pointer transition-colors ${
                Number(secs) === p
                  ? 'border-primary/60 bg-primary-container/20 text-primary'
                  : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-variant hover:text-on-surface'
              }`}
            >
              {p}s
            </button>
          ))}
          <button
            onClick={() => apply(null)}
            className="py-xs text-[11px] font-mono rounded border border-outline-variant/30 text-on-surface-variant hover:bg-surface-variant hover:text-on-surface cursor-pointer transition-colors uppercase"
          >
            Off
          </button>
        </div>

        {/* Loop mode — what happens when the timer reaches the item's last slide. */}
        <p className="text-[10px] font-label-sm uppercase tracking-widest text-on-surface-variant/60 mb-xs">At end of item</p>
        <div className="flex flex-col gap-xs mb-md">
          {LOOP_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setLoop(m.id)}
              className={`text-left px-sm py-xs rounded border cursor-pointer transition-colors ${
                loop === m.id
                  ? 'border-primary/60 bg-primary-container/20'
                  : 'border-outline-variant/30 hover:bg-surface-variant'
              }`}
            >
              <span className={`block text-[11px] font-bold ${loop === m.id ? 'text-primary' : 'text-on-surface'}`}>{m.label}</span>
              <span className="block text-[10px] text-on-surface-variant/70 leading-snug">{m.hint}</span>
            </button>
          ))}
        </div>

        {/* Wrap toggle — only meaningful in 'rundown' mode (item-loop always cycles). */}
        {loop === 'rundown' && (
          <button
            onClick={() => setWrap((w) => !w)}
            className="flex items-center gap-sm w-full text-left mb-md px-xs py-xs rounded hover:bg-surface-variant cursor-pointer transition-colors"
          >
            <span
              className={`shrink-0 w-8 h-[18px] rounded-full relative transition-colors ${wrap ? 'bg-primary' : 'bg-outline-variant/40'}`}
            >
              <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${wrap ? 'left-[16px]' : 'left-[2px]'}`} />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-bold text-on-surface">Wrap at the end</span>
              <span className="block text-[10px] text-on-surface-variant/70 leading-snug">
                {wrap ? 'Loop back to the first item.' : 'Stop after the last slide (one pass).'}
              </span>
            </span>
          </button>
        )}

        <div className="flex items-center gap-sm">
          <input
            autoFocus
            type="number"
            min="1"
            value={secs}
            onChange={(e) => setSecs(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') apply(secs); if (e.key === 'Escape') onClose(); }}
            placeholder="Custom seconds…"
            className="flex-1 min-w-0 bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-xs text-[12px] font-mono text-on-surface outline-none focus:border-primary"
          />
          <button
            onClick={() => apply(secs)}
            className="shrink-0 px-md py-xs bg-primary text-on-primary text-label-sm font-label-sm rounded cursor-pointer hover:brightness-110 active:scale-95"
          >
            Set
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// The service "look" chip — the SERVICE tier of the theme cascade, shown in the
// rundown header. It states the effective look and where it comes from (this
// service, else the app default), and lets the operator set/clear the service look.
// Setting it re-resolves every song in the rundown live via OperatorView's themeMap.
function ServiceLookChip({ serviceData, onChanged }) {
  const toast = useToast();
  const [appDefaultId, setAppDefaultId] = useState(null);
  const [names, setNames] = useState({});
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    window.cue.settings.get('default_theme_id').then((v) => setAppDefaultId(Number(v) || null));
    window.cue.themes.list().then((l) => {
      const m = {};
      for (const t of (l || [])) {
        let accent = null;
        try { accent = t.style_json ? JSON.parse(t.style_json).accent?.color : null; } catch {}
        m[t.id] = { name: t.name, accent };
      }
      setNames(m);
    }).catch(() => {});
  }, [serviceData?.id, picking]);

  const svcId = serviceData?.theme_id || null;
  const effId = svcId || appDefaultId || null;
  const eff = effId ? names[effId] : null;
  const source = svcId ? 'this rundown' : (appDefaultId ? 'app default' : null);

  async function pick(theme) { await ensureThemeBg(theme, toast); await window.cue.services.setServiceTheme(serviceData.id, theme.id); setPicking(false); onChanged?.(); }
  async function reset()  { await window.cue.services.setServiceTheme(serviceData.id, null); onChanged?.(); }

  return (
    <div className="flex items-center gap-xs px-sm py-[5px] border-b border-outline-variant/20 bg-surface-container/40 shrink-0">
      <span className="material-symbols-outlined text-[14px] text-on-surface-variant/50">palette</span>
      <button onClick={() => setPicking(true)} title="Choose this rundown’s theme"
        className="flex items-center gap-xs min-w-0 text-[11px] text-on-surface-variant hover:text-on-surface cursor-pointer">
        <span className="w-2.5 h-2.5 rounded-sm shrink-0 border border-white/10" style={{ background: eff?.accent || '#4d8eff' }} />
        <span className="truncate">Theme: <b className="text-on-surface font-semibold">{eff?.name || 'Default'}</b></span>
        {source && <span className="text-on-surface-variant/50 shrink-0 whitespace-nowrap">· from {source}</span>}
        <span className="material-symbols-outlined text-[15px] text-on-surface-variant/50 shrink-0">expand_more</span>
      </button>
      {svcId && (
        <button onClick={reset} title="Reset to app default" className="shrink-0 w-4 h-4 flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface cursor-pointer">
          <span className="material-symbols-outlined text-[13px]">close</span>
        </button>
      )}
      {picking && <ThemePickerModal category="song" currentId={svcId || appDefaultId} onPick={(t) => pick(t)} onClose={() => setPicking(false)} />}
    </div>
  );
}

export default function RundownPanel({
  services, activeServiceId, serviceData, previewItemId, liveItemId,
  selectedIds = new Set(),
  liveSlideIdx = 0, liveSlideCount = 0, autoAdvanceStartAt = null,
  onSelectService, onClickItem, onToggleSelect, onRangeSelect, onSetSelection, onClearSelection,
  onBulkDelete, onBulkSetBackground,
  onDoubleClickItem, onReorder, onRemoveItem, onDuplicate,
  onAddService, onRenameService, onDeleteService, onRefresh, onSongEdited, onSetItemBackground, resolveItemBg,
}) {
  const toast = useToast();
  const [contextMenu, setContextMenu] = useState(null);
  const [marquee, setMarquee] = useState(null);          // {x0,y0,x1,y1} viewport coords while dragging
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkBgPicker, setBulkBgPicker] = useState(false);
  const listRef = useRef(null);
  const panelRef = useRef(null);
  const suppressClickRef = useRef(false); // set after a marquee so the trailing click doesn't reset selection
  const [showNewService, setShowNewService] = useState(false);
  const [newServiceTitle, setNewServiceTitle] = useState('');
  const [renamingService, setRenamingService] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bgPickerForItem, setBgPickerForItem] = useState(null);
  const [advanceForItem, setAdvanceForItem] = useState(null);
  const [previewSong, setPreviewSong] = useState(null);
  const [editSong, setEditSong] = useState(null);
  const [editPresentation, setEditPresentation] = useState(null);
  const [themes, setThemes] = useState([]);

  // Themes for the item-look menu + the service-look chip. Every theme is one
  // portable look; graphics presets are a separate system, so exclude only those.
  useEffect(() => {
    window.cue.themes.list()
      .then((list) => setThemes((list || []).filter((t) => (t.category || 'song') !== 'graphic')))
      .catch(() => {});
  }, [serviceData?.id]);

  // When the selection clears (e.g. after a bulk delete), drop the inline confirm.
  useEffect(() => { if (selectedIds.size < 2) setConfirmBulkDelete(false); }, [selectedIds]);

  // ContextMenu key opens the context menu for the current preview item without a mouse.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'ContextMenu' || !previewItemId) return;
      const el = listRef.current?.querySelector(`[data-item-id="${previewItemId}"]`);
      if (!el) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const it = (serviceData?.items || []).find((i) => i.id === previewItemId);
      if (it) setContextMenu({ x: r.left + 40, y: r.bottom, item: it });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewItemId, serviceData]);

  // Click outside the rundown panel deselects. Disabled while the bulk background
  // picker is open (it's a portal'd modal that operates ON the selection, so clicking
  // it must not wipe what it's about to apply to). Row/marquee/bar clicks are inside
  // the panel and so never trigger it.
  useEffect(() => {
    if (selectedIds.size === 0 || bulkBgPicker) return;
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClearSelection?.();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [selectedIds, bulkBgPicker, onClearSelection]);

  // Scroll the live row into view when the live item changes (Space at a boundary,
  // auto-advance, network remote). block:'nearest' is a no-op when already visible.
  useEffect(() => {
    if (!liveItemId) return;
    listRef.current
      ?.querySelector(`[data-item-id="${liveItemId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [liveItemId]);

  // Scroll the preview row into view when arrow-key navigation moves to a new item.
  useEffect(() => {
    if (!previewItemId) return;
    listRef.current
      ?.querySelector(`[data-item-id="${previewItemId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [previewItemId]);

  const items = serviceData?.items || [];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    onReorder(arrayMove(items, oldIdx, newIdx).map((i) => i.id));
  }

  // Modifier-aware row click: Ctrl/Cmd toggles, Shift selects a range, plain click
  // previews (and clears selection). Suppressed right after a marquee drag so the
  // trailing click doesn't wipe the freshly-dragged selection.
  function handleRowClick(item, e) {
    if (suppressClickRef.current) return;
    if (e.metaKey || e.ctrlKey) onToggleSelect?.(item.id);
    else if (e.shiftKey) onRangeSelect?.(item.id);
    else onClickItem(item);
  }

  // Marquee select — a drag starting on empty list space (never on a drag handle,
  // which dnd-kit owns). Tracks in viewport coords and hit-tests each row's rect;
  // dnd-kit reorder is unaffected because its listeners live only on the handle.
  function handleListMouseDown(e) {
    if (e.button !== 0 || e.target.closest('.drag-handle')) return;
    const startX = e.clientX, startY = e.clientY;
    let started = false;
    const onMove = (ev) => {
      if (!started && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 6) return;
      started = true;
      const box = { x0: startX, y0: startY, x1: ev.clientX, y1: ev.clientY };
      setMarquee(box);
      const lo = Math.min(box.y0, box.y1), hi = Math.max(box.y0, box.y1);
      const ids = [];
      listRef.current?.querySelectorAll('[data-item-id]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom >= lo && r.top <= hi) {
          const id = Number(el.getAttribute('data-item-id'));
          if (!Number.isNaN(id)) ids.push(id);
        }
      });
      onSetSelection?.(ids);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (started) { suppressClickRef.current = true; setTimeout(() => { suppressClickRef.current = false; }, 0); }
      setMarquee(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  async function handleCreateService() {
    const title = newServiceTitle.trim() ||
      new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    await onAddService(title);
    setShowNewService(false);
    setNewServiceTitle('');
  }

  function startRename() {
    const svc = services.find((s) => s.id === activeServiceId);
    setRenameTitle(svc?.title || '');
    setRenamingService(true);
    setConfirmDelete(false);
  }

  async function confirmRename() {
    if (renameTitle.trim()) await onRenameService?.(renameTitle.trim());
    setRenamingService(false);
  }

  async function confirmDeleteService() {
    setConfirmDelete(false);
    await onDeleteService?.();
  }

  async function handleExportPdf() {
    if (!activeServiceId || exporting) return;
    if (typeof window.cue?.services?.exportPdf !== 'function') {
      toast.error('PDF export is unavailable — restart the app to load the latest version.');
      return;
    }
    setExporting(true);
    try {
      await window.cue.services.exportPdf(activeServiceId);
    } catch (err) {
      console.error('Rundown PDF export failed:', err);
      toast.error(`Couldn't export the rundown PDF: ${err?.message || err}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div ref={panelRef} className="flex flex-col h-full bg-surface-container-low rounded-lg border border-outline-variant/30 overflow-hidden">
      {/* Panel header */}
      <div className="px-md py-sm bg-surface-container-high border-b border-outline-variant/30 shrink-0">
        <h2 className="text-label-sm font-label-sm uppercase tracking-widest text-on-surface-variant mb-1">Rundown</h2>

        {renamingService ? (
          /* Inline rename input */
          <div className="flex items-center gap-xs">
            <input
              autoFocus
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') setRenamingService(false);
              }}
              className="flex-1 min-w-0 bg-surface-container-lowest border border-primary/40 rounded px-sm py-xs text-[11px] font-label-sm text-on-surface outline-none focus:border-primary"
            />
            <button
              onClick={confirmRename}
              className="shrink-0 w-6 h-6 flex items-center justify-center text-tertiary hover:text-tertiary/80 cursor-pointer transition-colors"
              title="Confirm rename"
            >
              <span className="material-symbols-outlined text-[15px]">check</span>
            </button>
            <button
              onClick={() => setRenamingService(false)}
              className="shrink-0 w-6 h-6 flex items-center justify-center text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors"
              title="Cancel"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          </div>
        ) : confirmDelete ? (
          /* Inline delete confirmation */
          <div className="flex items-center gap-sm">
            <span className="text-[10px] font-mono text-error uppercase tracking-[0.04em] shrink-0">Delete rundown?</span>
            <button
              onClick={confirmDeleteService}
              className="text-[10px] font-mono text-error hover:text-error/70 cursor-pointer uppercase tracking-[0.04em] border border-error/40 px-sm py-[2px] rounded transition-colors"
            >Yes</button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.04em] transition-colors"
            >No</button>
          </div>
        ) : (
          /* Normal service select row */
          <div className="flex items-center gap-xs">
            <select
              value={activeServiceId || ''}
              onChange={(e) => onSelectService(Number(e.target.value))}
              className="flex-1 min-w-0 bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-xs text-[11px] font-label-sm text-on-surface outline-none cursor-pointer"
            >
              {services.length === 0 && <option value="">No rundowns</option>}
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
            {activeServiceId && (
              <>
                <button
                  onClick={handleExportPdf}
                  disabled={exporting}
                  title="Export lyrics as PDF"
                  className="shrink-0 w-5 h-5 flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-default"
                >
                  <span className="material-symbols-outlined text-[13px]">{exporting ? 'hourglass_empty' : 'picture_as_pdf'}</span>
                </button>
                <button
                  onClick={startRename}
                  title="Rename rundown"
                  className="shrink-0 w-5 h-5 flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface-variant cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-[13px]">edit</span>
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  title="Delete rundown"
                  className="shrink-0 w-5 h-5 flex items-center justify-center text-on-surface-variant/40 hover:text-error cursor-pointer transition-colors"
                >
                  <span className="material-symbols-outlined text-[13px]">delete</span>
                </button>
              </>
            )}
            <button
              onClick={() => setShowNewService(true)}
              className="shrink-0 w-6 h-6 flex items-center justify-center bg-primary text-on-primary rounded cursor-pointer hover:brightness-110 active:scale-95 transition-all text-sm font-bold"
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* Service look — the SERVICE tier of the theme cascade (inherits app default). */}
      {activeServiceId && serviceData && (
        <ServiceLookChip serviceData={serviceData} onChanged={onRefresh} />
      )}

      {/* New service input */}
      {showNewService && (
        <div className="flex gap-sm px-sm py-xs bg-surface-container border-b border-outline-variant/20 shrink-0">
          <input
            autoFocus
            className="flex-1 bg-surface-container-lowest border border-outline-variant/30 rounded px-sm py-xs text-[11px] font-label-sm text-on-surface outline-none"
            placeholder="Rundown title…"
            value={newServiceTitle}
            onChange={(e) => setNewServiceTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateService();
              if (e.key === 'Escape') { setShowNewService(false); setNewServiceTitle(''); }
            }}
          />
          <button
            onClick={handleCreateService}
            className="shrink-0 px-sm py-xs bg-primary text-on-primary text-label-sm font-label-sm rounded cursor-pointer hover:brightness-110 active:scale-95"
          >
            Create
          </button>
          <button
            onClick={() => { setShowNewService(false); setNewServiceTitle(''); }}
            className="shrink-0 text-on-surface-variant hover:text-on-surface cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Bulk-action bar — appears when 2+ items are selected (Ctrl/Shift-click or marquee) */}
      {selectedIds.size >= 2 && (
        <div className="flex items-center gap-sm px-sm py-xs bg-primary-container/10 border-b border-primary/30 shrink-0">
          <span className="text-[10px] font-label-sm uppercase tracking-[0.05em] text-primary shrink-0">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          {confirmBulkDelete ? (
            <>
              <span className="text-[10px] font-mono text-error uppercase tracking-[0.04em] shrink-0">Delete {selectedIds.size}?</span>
              <button
                onClick={() => { setConfirmBulkDelete(false); onBulkDelete?.(); }}
                className="text-[10px] font-mono text-error hover:text-error/70 cursor-pointer uppercase tracking-[0.04em] border border-error/40 px-sm py-[2px] rounded transition-colors"
              >Yes</button>
              <button
                onClick={() => setConfirmBulkDelete(false)}
                className="text-[10px] font-mono text-on-surface-variant hover:text-on-surface cursor-pointer uppercase tracking-[0.04em] transition-colors"
              >No</button>
            </>
          ) : (
            <>
              <button
                onClick={() => setBulkBgPicker(true)}
                title="Set the same background on all selected songs/scripture"
                className="flex items-center gap-xs text-[10px] font-label-sm uppercase tracking-[0.05em] text-on-surface-variant hover:text-on-surface border border-outline-variant/40 hover:border-outline-variant rounded px-sm py-[2px] cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[13px]">wallpaper</span>
                Background
              </button>
              <button
                onClick={() => setConfirmBulkDelete(true)}
                className="flex items-center gap-xs text-[10px] font-label-sm uppercase tracking-[0.05em] text-error/80 hover:text-error border border-error/40 hover:border-error rounded px-sm py-[2px] cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[13px]">delete</span>
                Delete
              </button>
              <button
                onClick={() => onClearSelection?.()}
                title="Clear selection"
                className="w-5 h-5 flex items-center justify-center text-on-surface-variant/60 hover:text-on-surface cursor-pointer"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Items list */}
      <div ref={listRef} onMouseDown={handleListMouseDown} className="flex-1 overflow-y-auto relative">
        {!serviceData ? (
          <div className="flex flex-col items-center justify-center h-full gap-xs text-outline-variant px-lg text-center">
            <span className="material-symbols-outlined text-4xl">calendar_today</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">
              {services.length === 0 ? 'No Service Yet' : 'Select a Service'}
            </span>
            <span className="text-[11px] text-on-surface-variant/60 max-w-[220px] leading-snug">
              {services.length === 0
                ? 'Create a service with the + above, then add songs, scripture and media to build your rundown.'
                : 'Pick a service from the dropdown above to load its rundown.'}
            </span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-xs text-outline-variant px-lg text-center">
            <span className="material-symbols-outlined text-4xl">playlist_add</span>
            <span className="text-label-sm font-label-sm uppercase tracking-widest">Empty Rundown</span>
            <span className="text-[11px] text-on-surface-variant/60 max-w-[240px] leading-snug">
              Search and add songs from the Library below, or press <span className="font-mono text-on-surface-variant">⌘K</span> (Ctrl+K) to find songs, scripture, scenes &amp; media.
            </span>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              {items.map((item, index) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  index={index}
                  bgPath={resolveItemBg ? resolveItemBg(item) : null}
                  isPreview={item.id === previewItemId}
                  isLive={item.id === liveItemId}
                  isSelected={selectedIds.has(item.id)}
                  liveSlideIdx={item.id === liveItemId ? liveSlideIdx : 0}
                  liveSlideCount={item.id === liveItemId ? liveSlideCount : 0}
                  autoAdvanceStartAt={item.id === liveItemId ? autoAdvanceStartAt : null}
                  onClick={(e) => handleRowClick(item, e)}
                  onDoubleClick={() => onDoubleClickItem(item)}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, item }); }}
                  onSetItemBackground={onSetItemBackground}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Footer */}
      {serviceData && (
        <div className="px-md py-xs border-t border-outline-variant/20 shrink-0">
          <span className="text-[10px] font-label-sm text-outline-variant uppercase tracking-wider">
            {items.length} {items.length !== 1 ? 'items' : 'item'}
          </span>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'Duplicate',
              onClick: () => { onDuplicate?.(contextMenu.item.id); setContextMenu(null); },
            },
            ...(contextMenu.item.item_type === 'song' ? [
              { separator: true },
              {
                label: 'Preview',
                onClick: () => { setPreviewSong(contextMenu.item.song); setContextMenu(null); },
              },
              {
                label: 'Edit',
                onClick: async () => {
                  const full = await window.cue.songs.get(contextMenu.item.song.id);
                  setEditSong(full);
                  setContextMenu(null);
                },
              },
              { separator: true },
              {
                label: 'Set Background Override',
                onClick: () => { setBgPickerForItem(contextMenu.item); setContextMenu(null); },
              },
              ...(contextMenu.item.background_override ? [{
                label: 'Clear Background Override',
                onClick: async () => {
                  await window.cue.services.setItemBackground(contextMenu.item.id, null);
                  onRefresh?.();
                  setContextMenu(null);
                },
              }] : []),
              ...(themes.length ? [
                { separator: true },
                {
                  // Live theme override for THIS item (item tier of the cascade). Non-
                  // destructive — the song keeps no baked style; resolution is live.
                  label: contextMenu.item.theme_override_id ? 'Change theme for this item' : 'Set theme for this item',
                  submenu: themes.filter((t) => isCuratedTheme(t) || t.id === contextMenu.item.theme_override_id).map((t) => ({
                    label: t.name,
                    onClick: async () => {
                      await ensureThemeBg(t, toast); // download the photo/video bg first
                      await window.cue.services.setItemTheme(contextMenu.item.id, t.id);
                      setContextMenu(null);
                      onRefresh?.();
                    },
                  })),
                },
                ...(contextMenu.item.theme_override_id ? [{
                  label: 'Reset to rundown theme',
                  onClick: async () => {
                    await window.cue.services.setItemTheme(contextMenu.item.id, null);
                    setContextMenu(null);
                    onRefresh?.();
                  },
                }] : []),
              ] : []),
              ...(songHasBakedStyle(contextMenu.item) ? [
                { separator: true },
                {
                  // Escape the old baked-theme paint-bucket: strip this song's stored
                  // style + background so it follows the live theme cascade again. Only
                  // offered when the song actually carries a baked style/background.
                  label: 'Clear baked styling (follow theme)',
                  onClick: async () => {
                    await window.cue.themes.resetSongToTheme(contextMenu.item.song.id);
                    setContextMenu(null);
                    onSongEdited?.();
                    onRefresh?.();
                  },
                },
              ] : []),
            ] : []),
            ...(contextMenu.item.item_type === 'scripture' ? [
              { separator: true },
              {
                label: 'Set Background Override',
                onClick: () => { setBgPickerForItem(contextMenu.item); setContextMenu(null); },
              },
              ...(contextMenu.item.background_override ? [{
                label: 'Clear Background Override',
                onClick: async () => {
                  await window.cue.services.setItemBackground(contextMenu.item.id, null);
                  onRefresh?.();
                  setContextMenu(null);
                },
              }] : []),
              ...(themes.length ? [
                { separator: true },
                {
                  // Item-tier theme override for a scripture verse — same live cascade
                  // as songs (a scripture look inherits from the service / app default).
                  label: contextMenu.item.theme_override_id ? 'Change theme for this item' : 'Set theme for this item',
                  submenu: themes.filter((t) => isCuratedTheme(t) || t.id === contextMenu.item.theme_override_id).map((t) => ({
                    label: t.name,
                    onClick: async () => {
                      await ensureThemeBg(t, toast); // download the photo/video bg first
                      await window.cue.services.setItemTheme(contextMenu.item.id, t.id);
                      setContextMenu(null);
                      onRefresh?.();
                    },
                  })),
                },
                ...(contextMenu.item.theme_override_id ? [{
                  label: 'Reset to rundown theme',
                  onClick: async () => {
                    await window.cue.services.setItemTheme(contextMenu.item.id, null);
                    setContextMenu(null);
                    onRefresh?.();
                  },
                }] : []),
              ] : []),
            ] : []),
            ...(contextMenu.item.item_type === 'presentation' ? [
              { separator: true },
              {
                label: 'Edit Presentation',
                onClick: () => { setEditPresentation({ id: contextMenu.item.ref_id }); setContextMenu(null); },
              },
            ] : []),
            ...((contextMenu.item.item_type === 'media' || contextMenu.item.item_type === 'youtube') ? [
              { separator: true },
              {
                label: contextMenu.item.media_loop ? 'Disable Loop' : 'Enable Loop',
                onClick: async () => {
                  await window.cue.services.setItemLoop(contextMenu.item.id, !contextMenu.item.media_loop);
                  onRefresh?.();
                  setContextMenu(null);
                },
              },
            ] : []),
            ...(contextMenu.item.item_type === 'youtube' ? [
              {
                label: 'Re-download',
                onClick: () => { window.cue.youtube.prefetch(contextMenu.item.content); setContextMenu(null); },
              },
            ] : []),
            { separator: true },
            {
              label: contextMenu.item.advance_seconds > 0
                ? `Auto-Advance: ${contextMenu.item.advance_seconds}s`
                : 'Auto-Advance…',
              onClick: () => { setAdvanceForItem(contextMenu.item); setContextMenu(null); },
            },
            ...(services.filter((s) => s.id !== activeServiceId).length > 0 ? [
              { separator: true },
              {
                label: 'Copy to Rundown ›',
                submenu: services.filter((s) => s.id !== activeServiceId).map((s) => ({
                  label: s.title,
                  onClick: async () => {
                    const item = contextMenu.item;
                    await window.cue.services.addItems(s.id, [{
                      item_type: item.item_type, ref_id: item.ref_id ?? null,
                      content: item.content ?? null,
                      background_override_id: item.background_override_id ?? null,
                    }]);
                    setContextMenu(null);
                    toast.success(`Copied to "${s.title}"`);
                  },
                })),
              },
              {
                label: 'Move to Rundown ›',
                submenu: services.filter((s) => s.id !== activeServiceId).map((s) => ({
                  label: s.title,
                  onClick: async () => {
                    const item = contextMenu.item;
                    await window.cue.services.addItems(s.id, [{
                      item_type: item.item_type, ref_id: item.ref_id ?? null,
                      content: item.content ?? null,
                      background_override_id: item.background_override_id ?? null,
                    }]);
                    onRemoveItem(item.id);
                    setContextMenu(null);
                    toast.success(`Moved to "${s.title}"`);
                  },
                })),
              },
            ] : []),
            { separator: true },
            {
              label: 'Remove from Rundown',
              danger: true,
              onClick: () => { onRemoveItem(contextMenu.item.id); setContextMenu(null); },
            },
          ]}
        />
      )}

      {bgPickerForItem && (
        <MediaPickerModal
          initialId={bgPickerForItem.background_override?.id ?? null}
          onSelect={async (asset) => {
            const mediaId = asset?.id ?? null;
            await window.cue.services.setItemBackground(bgPickerForItem.id, mediaId);
            if (bgPickerForItem.item_type === 'song' && bgPickerForItem.song?.id) {
              await window.cue.songs.setBackground(bgPickerForItem.song.id, mediaId);
            }
            onRefresh?.();
            setBgPickerForItem(null);
          }}
          onClose={() => setBgPickerForItem(null)}
        />
      )}

      {advanceForItem && (
        <AutoAdvanceModal
          item={advanceForItem}
          onApply={async (seconds, loop, wrap) => {
            await window.cue.services.setItemAdvance(advanceForItem.id, seconds, loop, wrap);
            onRefresh?.();
            setAdvanceForItem(null);
          }}
          onClose={() => setAdvanceForItem(null)}
        />
      )}

      {previewSong && (
        <SongPreviewModal
          song={previewSong}
          onClose={() => setPreviewSong(null)}
          onEdit={async (song) => {
            const full = await window.cue.songs.get(song.id);
            setPreviewSong(null);
            setEditSong(full);
          }}
          onAddToRundown={() => setPreviewSong(null)}
        />
      )}

      {editSong !== null && (
        <SongEditor
          song={editSong}
          onClose={() => setEditSong(null)}
          onSave={() => { setEditSong(null); onRefresh?.(); onSongEdited?.(); }}
        />
      )}

      {editPresentation !== null && (
        <PresentationEditor
          presentationId={editPresentation.id || null}
          onClose={() => setEditPresentation(null)}
          onSave={() => { setEditPresentation(null); onRefresh?.(); }}
        />
      )}

      {/* Bulk background picker — applies to every selected song/scripture (locked skipped) */}
      {bulkBgPicker && (
        <MediaPickerModal
          initialId={null}
          onSelect={async (asset) => {
            await onBulkSetBackground?.(asset?.id ?? null);
            setBulkBgPicker(false);
          }}
          onClose={() => setBulkBgPicker(false)}
        />
      )}

      {/* Marquee selection rectangle (viewport-fixed while dragging) */}
      {marquee && (
        <div
          className="fixed z-[70] border border-primary/70 bg-primary/10 pointer-events-none rounded-sm"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
    </div>
  );
}
