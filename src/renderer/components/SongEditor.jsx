import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTION_TYPES = ['verse', 'chorus', 'refrain', 'bridge', 'pre-chorus', 'tag', 'intro', 'outro'];
const FONT_SIZES    = [32, 40, 48, 56, 64, 72, 80, 96, 112, 128];
const DEFAULT_STYLE = { fontFamily: null, fontSize: null, color: null, bold: false, italic: false, align: 'center' };

let keyCounter = 0;
const newKey = () => `k${++keyCounter}`;

// ─── HTML / run helpers (also exported for output windows) ───────────────────

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Produces HTML used in contenteditable init AND output rendering.
export function renderWithRuns(text, runs) {
  if (!text) return '';
  if (!runs || runs.length === 0) return esc(text).replace(/\n/g, '<br>');

  const sorted = [...runs].sort((a, b) => a.start - b.start);
  let html = '';
  let pos  = 0;

  for (const run of sorted) {
    const s = Math.min(Math.max(0, run.start), text.length);
    const e = Math.min(Math.max(s, run.end),   text.length);
    if (pos < s) html += esc(text.slice(pos, s)).replace(/\n/g, '<br>');

    const styles = [];
    if (run.bold)       styles.push('font-weight:700');
    if (run.italic)     styles.push('font-style:italic');
    if (run.color)      styles.push(`color:${run.color}`);
    if (run.fontFamily) styles.push(`font-family:${String(run.fontFamily).replace(/"/g, "'")}`);
    if (run.fontSize)   styles.push(`font-size:${Number(run.fontSize)}px`);

    const inner = esc(text.slice(s, e)).replace(/\n/g, '<br>');
    html += styles.length ? `<span style="${styles.join(';')}">${inner}</span>` : inner;
    pos = e;
  }

  if (pos < text.length) html += esc(text.slice(pos)).replace(/\n/g, '<br>');
  return html;
}

// Reads a contenteditable div → { text, runs }
function extractContentAndRuns(el) {
  let text = '';
  const runs = [];

  function walk(node, style) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const start = text.length;
      text += node.textContent;
      if (Object.keys(style).length && node.textContent.length) {
        runs.push({ start, end: text.length, ...style });
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName;
    if (tag === 'BR') { text += '\n'; return; }

    const s = { ...style };
    if (tag === 'B' || tag === 'STRONG') s.bold   = true;
    if (tag === 'I' || tag === 'EM')     s.italic  = true;
    if (tag === 'SPAN') {
      const cs = node.style;
      if (cs.fontWeight === 'bold' || cs.fontWeight === '700') s.bold   = true;
      if (cs.fontStyle  === 'italic')                          s.italic = true;
      if (cs.color)      s.color      = cs.color;
      if (cs.fontFamily) s.fontFamily = cs.fontFamily;
      if (cs.fontSize)   s.fontSize   = parseInt(cs.fontSize);
    }
    // Chrome wraps new lines in <div> inside contenteditable
    if (tag === 'DIV' && node !== el && text.length > 0 && !text.endsWith('\n')) {
      text += '\n';
    }
    for (const child of node.childNodes) walk(child, s);
  }

  walk(el, {});
  return { text: text.trimEnd(), runs };
}

function styleIsDefault(s) {
  if (!s) return true;
  return !s.fontFamily && !s.fontSize && !s.color && !s.bold && !s.italic &&
    (!s.align || s.align === 'center');
}

function serializeSection(type, text, runs, songStyle) {
  const hasRuns  = runs && runs.length > 0;
  const hasStyle = !styleIsDefault(songStyle);
  if (!hasStyle && !hasRuns) return { type, content: text, style_json: null };
  return {
    type,
    content:    text,
    style_json: JSON.stringify({ ...songStyle, runs: hasRuns ? runs : undefined }),
  };
}

// ─── Song text parser ─────────────────────────────────────────────────────────

function parseSong(rawText) {
  if (!rawText.trim()) return [];

  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const KW = 'verse|chorus|bridge|pre[-\\s]?chorus|prechorus|tag|intro|outro|refrain';

  const HEADER_PATTERNS = [
    new RegExp('^\\[(.{1,40}?)\\]\\s*:?\\s*$'),
    new RegExp(`^(${KW})\\s*\\d*\\s*:$`, 'i'),
    new RegExp(`^(${KW})\\s*\\d*$`, 'i'),
  ];

  const TYPE_MAP = {
    verse: 'verse', v: 'verse',
    chorus: 'chorus', ch: 'chorus', refrain: 'refrain',
    bridge: 'bridge', br: 'bridge',
    'pre-chorus': 'pre-chorus', 'pre chorus': 'pre-chorus', prechorus: 'pre-chorus',
    tag: 'tag', intro: 'intro', outro: 'outro',
  };

  function matchHeader(line) {
    const t = line.trim();
    if (!t || t.length > 60) return null;
    for (const re of HEADER_PATTERNS) {
      const m = t.match(re);
      if (m) return (m[1] ?? m[0]).replace(/:?\s*$/, '').trim();
    }
    return null;
  }

  function labelToType(label) {
    const l = label.toLowerCase().replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
    const base = l.replace(/\s*\d+$/, '').trim();
    return TYPE_MAP[base] || TYPE_MAP[l] || 'verse';
  }

  const TRAILING_TAG_RE = new RegExp(
    `\\s*\\[(${KW}|ch|br|v)\\s*\\d*\\]\\s*$`, 'i'
  );

  function cleanLine(line) {
    return line
      .trim()
      .replace(TRAILING_TAG_RE, '')
      .replace(/^\s*[\[\(]?\d+[\]\)\.:]?\s+/, '');
  }

  const sections   = [];
  let currentType  = null;
  let currentLines = [];
  let hasHeaders   = false;
  let prevBlank    = true;

  function flush() {
    while (currentLines.length && !currentLines[0].trim()) currentLines.shift();
    while (currentLines.length && !currentLines[currentLines.length - 1].trim()) currentLines.pop();
    const content = currentLines.join('\n').trim();
    if (content) sections.push({ type: currentType || 'verse', content });
    currentLines = [];
    currentType  = null;
  }

  for (const line of lines) {
    const isBlank = !line.trim();

    const headerLabel = matchHeader(line);
    if (headerLabel) {
      flush();
      currentType = labelToType(headerLabel);
      hasHeaders  = true;
      prevBlank   = true;
      continue;
    }

    if (/^\s*\d+[.):]?\s*$/.test(line)) {
      prevBlank = true;
      continue;
    }

    if (prevBlank && !isBlank) {
      const m = line.match(/^\s*(\d{1,2})[.)]?\s+(.+)$/);
      if (m) {
        flush();
        currentType = 'verse';
        hasHeaders  = true;
        currentLines.push(cleanLine(m[2]));
        prevBlank   = false;
        continue;
      }
    }

    if (isBlank) {
      currentLines.push('');
      prevBlank = true;
    } else {
      currentLines.push(cleanLine(line));
      prevBlank = false;
    }
  }
  flush();

  if (!hasHeaders) {
    const blocks = rawText.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    return blocks.map(content => ({ type: 'verse', content }));
  }

  return sections;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const AlignLeftIcon = () => (
  <svg width="12" height="9" viewBox="0 0 12 9" fill="currentColor">
    <rect x="0" y="0" width="12" height="1.5" rx="0.75"/>
    <rect x="0" y="3.75" width="7.5" height="1.5" rx="0.75"/>
    <rect x="0" y="7.5" width="10" height="1.5" rx="0.75"/>
  </svg>
);
const AlignCenterIcon = () => (
  <svg width="12" height="9" viewBox="0 0 12 9" fill="currentColor">
    <rect x="0" y="0" width="12" height="1.5" rx="0.75"/>
    <rect x="2.25" y="3.75" width="7.5" height="1.5" rx="0.75"/>
    <rect x="1" y="7.5" width="10" height="1.5" rx="0.75"/>
  </svg>
);
const AlignRightIcon = () => (
  <svg width="12" height="9" viewBox="0 0 12 9" fill="currentColor">
    <rect x="0" y="0" width="12" height="1.5" rx="0.75"/>
    <rect x="4.5" y="3.75" width="7.5" height="1.5" rx="0.75"/>
    <rect x="2" y="7.5" width="10" height="1.5" rx="0.75"/>
  </svg>
);

// ─── Song-level style bar ─────────────────────────────────────────────────────
// onMouseDown + preventDefault keeps focus inside the active contenteditable.

function StyleBar({ songStyle, onChange, fonts, formatState, hasSelection }) {
  const align       = songStyle.align || 'center';
  const activeBold  = songStyle.bold   || formatState.bold;
  const activeItal  = songStyle.italic || formatState.italic;

  const btnBase = 'h-6 w-6 flex items-center justify-center rounded transition-colors flex-shrink-0 text-[11px] cursor-pointer';
  const btnOn   = 'bg-primary text-on-primary';
  const btnOff  = 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant';

  function set(prop, value) { onChange({ ...songStyle, [prop]: value }); }

  return (
    <div className="flex items-center gap-1.5 px-md py-sm border-b border-outline-variant/30 bg-surface-container flex-wrap">
      {/* Font family */}
      <select
        value={songStyle.fontFamily || ''}
        onChange={(e) => set('fontFamily', e.target.value || null)}
        className="bg-surface-container-high text-on-surface text-[11px] rounded px-1.5 h-6 border border-outline-variant/50 w-28 outline-none focus:border-primary cursor-pointer"
        title="Font family"
      >
        <option value="">Default font</option>
        {fonts.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
      </select>

      {/* Font size */}
      <select
        value={songStyle.fontSize || ''}
        onChange={(e) => set('fontSize', e.target.value ? Number(e.target.value) : null)}
        className="bg-surface-container-high text-on-surface text-[11px] rounded px-1 h-6 border border-outline-variant/50 w-[58px] outline-none focus:border-primary cursor-pointer"
        title="Font size on output"
      >
        <option value="">Size</option>
        {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
      </select>

      {/* Colour swatch */}
      <div className="relative flex-shrink-0" title="Text colour">
        <div
          className="w-6 h-6 rounded border border-outline-variant/50 cursor-pointer overflow-hidden"
          style={{ background: songStyle.color || '#ffffff' }}
        >
          <input
            type="color"
            value={songStyle.color || '#ffffff'}
            onChange={(e) => set('color', e.target.value)}
            className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
          />
        </div>
      </div>

      <div className="w-px h-4 bg-outline-variant/40 flex-shrink-0" />

      {/* Bold */}
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          if (hasSelection()) document.execCommand('bold');
          else set('bold', !songStyle.bold);
        }}
        className={`${btnBase} font-bold ${activeBold ? btnOn : btnOff}`}
        title="Bold (applies to selection if text selected)"
      >B</button>

      {/* Italic */}
      <button
        onMouseDown={(e) => {
          e.preventDefault();
          if (hasSelection()) document.execCommand('italic');
          else set('italic', !songStyle.italic);
        }}
        className={`${btnBase} italic ${activeItal ? btnOn : btnOff}`}
        title="Italic (applies to selection if text selected)"
      >I</button>

      <div className="w-px h-4 bg-outline-variant/40 flex-shrink-0" />

      {/* Alignment */}
      {[
        { v: 'left',   Icon: AlignLeftIcon   },
        { v: 'center', Icon: AlignCenterIcon  },
        { v: 'right',  Icon: AlignRightIcon   },
      ].map(({ v, Icon }) => (
        <button
          key={v}
          onMouseDown={(e) => { e.preventDefault(); set('align', v); }}
          className={`${btnBase} ${align === v ? btnOn : btnOff}`}
          title={`Align ${v}`}
        ><Icon /></button>
      ))}

      {!styleIsDefault(songStyle) && (
        <button
          onMouseDown={(e) => { e.preventDefault(); onChange({ ...DEFAULT_STYLE }); }}
          className="text-[10px] text-on-surface-variant/50 hover:text-primary cursor-pointer ml-1 transition-colors flex-shrink-0 font-mono"
          title="Reset all styling"
        >Reset</button>
      )}
    </div>
  );
}

// ─── SortableSection ──────────────────────────────────────────────────────────

function SortableSection({ section, onTypeChange, onDelete, onRef, songStyle, isLast }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section._key });

  const editorRef = useRef(null);

  // Set initial HTML once on mount — contenteditable is uncontrolled after this
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = renderWithRuns(section.content || '', section.runs || []);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const registerRef = useCallback((el) => {
    editorRef.current = el;
    onRef(section._key, el);
  }, [section._key, onRef]);

  const dndStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  function handlePaste(e) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertLineBreak');
    }
  }

  const contentStyle = {
    fontFamily: songStyle.fontFamily || undefined,
    fontSize:   songStyle.fontSize   ? `${songStyle.fontSize}px` : undefined,
    color:      songStyle.color      || undefined,
    fontWeight: songStyle.bold       ? '700' : undefined,
    fontStyle:  songStyle.italic     ? 'italic' : undefined,
    textAlign:  songStyle.align      || 'center',
  };

  const isChorus = section.type === 'chorus' || section.type === 'refrain';

  return (
    <div
      ref={setNodeRef}
      style={dndStyle}
      className={`group ${isChorus ? 'bg-primary/5 border-l-2 border-primary' : 'border-l-2 border-outline-variant/20'} ${!isLast ? 'border-b border-outline-variant/20' : ''}`}
    >
      {/* Section header */}
      <div className="flex items-center gap-2 px-sm h-7 bg-surface-container/40">
        <button
          className="drag-handle cursor-grab text-on-surface-variant/30 hover:text-on-surface-variant flex-shrink-0 flex items-center transition-colors"
          {...attributes} {...listeners} tabIndex={-1}
        >
          <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
            <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
            <circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/>
            <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
          </svg>
        </button>

        <select
          value={section.type}
          onChange={(e) => onTypeChange(section._key, e.target.value)}
          className={`text-[10px] font-mono font-bold uppercase tracking-[0.05em] bg-transparent border-none outline-none cursor-pointer transition-colors ${isChorus ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
        >
          {SECTION_TYPES.map((t) => (
            <option key={t} value={t} className="bg-surface-container text-on-surface normal-case font-normal tracking-normal">
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>

        <div className="flex-1 border-t border-outline-variant/20" />

        <button
          onClick={() => onDelete(section._key)}
          className="text-on-surface-variant/30 hover:text-error opacity-0 group-hover:opacity-100 transition-all cursor-pointer text-[11px] leading-none flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-error/10"
          tabIndex={-1}
          title="Remove section"
        >✕</button>
      </div>

      {/* Contenteditable text */}
      <div
        ref={registerRef}
        contentEditable="true"
        suppressContentEditableWarning
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        className="px-lg py-md min-h-[72px] outline-none text-on-surface leading-relaxed whitespace-pre-wrap caret-primary text-body-md"
        style={contentStyle}
      />
    </div>
  );
}

// ─── Paste view ───────────────────────────────────────────────────────────────

function PasteView({ onParse, onCancel }) {
  const [text, setText] = useState('');

  return (
    <div className="flex flex-col gap-md">
      <p className="text-body-sm text-on-surface-variant leading-relaxed">
        Paste the full song text. Headers like{' '}
        <span className="text-on-surface font-mono">[Verse 1]</span>,{' '}
        <span className="text-on-surface font-mono">Chorus:</span>, or{' '}
        <span className="text-on-surface font-mono">BRIDGE</span> are detected and stripped.
        Leading numbers (<span className="text-on-surface font-mono">1.</span>,{' '}
        <span className="text-on-surface font-mono">2)</span>) are removed from lyric lines.
        If no headers are found, blank lines split the song.
      </p>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={18}
        placeholder={"[Verse 1]\nAmazing grace, how sweet the sound\nThat saved a wretch like me\n\n[Chorus]\nPraise the Lord..."}
        className="w-full bg-surface-container-lowest text-on-surface text-body-sm rounded-lg px-md py-sm border border-outline-variant/50 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 resize-none font-mono leading-relaxed"
      />
      <div className="flex gap-sm">
        <button
          onClick={() => { const p = parseSong(text); if (p.length) onParse(p); }}
          disabled={!text.trim()}
          className="px-lg h-8 text-label-sm font-mono bg-primary text-on-primary disabled:bg-surface-variant disabled:text-on-surface-variant/50 rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em]"
        >Import Sections</button>
        <button
          onClick={onCancel}
          className="px-lg h-8 text-label-sm font-mono text-on-surface-variant hover:text-on-surface cursor-pointer rounded-lg hover:bg-surface-variant transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────

export default function SongEditor({ song, onClose, onSave }) {
  const [title, setTitle]         = useState('');
  const [author, setAuthor]       = useState('');
  const [copyright, setCopyright] = useState('');
  const [sections, setSections]   = useState([]);
  const [allTags, setAllTags]     = useState([]);
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [songStyle, setSongStyle] = useState({ ...DEFAULT_STYLE });
  const [saving, setSaving]       = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [formatState, setFormatState] = useState({ bold: false, italic: false });

  const fonts       = window.cue.fonts.list;
  const sectionRefs = useRef({});
  const sensors     = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    function onSel() {
      setFormatState({
        bold:   document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
      });
    }
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  useEffect(() => {
    window.cue.tags.list().then(setAllTags);
    if (song?.id) {
      window.cue.songs.get(song.id).then((s) => {
        setTitle(s.title);
        setAuthor(s.author || '');
        setCopyright(s.copyright || '');
        setSelectedTagIds((s.tags || []).map((t) => t.id));

        const firstStyled = (s.sections || []).find((sec) => sec.style_json);
        if (firstStyled) {
          const { runs: _r, ...base } = JSON.parse(firstStyled.style_json);
          setSongStyle({ ...DEFAULT_STYLE, ...base });
        }

        setSections((s.sections || []).map((sec) => {
          const parsed = sec.style_json ? JSON.parse(sec.style_json) : {};
          return { ...sec, _key: String(sec.id), content: sec.content || '', runs: parsed.runs || [] };
        }));
      });
    } else {
      setSections([{ _key: newKey(), type: 'verse', content: '', runs: [] }]);
    }
  }, [song?.id]);

  // ── Refs ──────────────────────────────────────────────────────────────────

  const registerRef = useCallback((key, el) => {
    if (el) sectionRefs.current[key] = el;
    else    delete sectionRefs.current[key];
  }, []);

  function hasSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return false;
    const anchor = sel.anchorNode;
    return Object.values(sectionRefs.current).some((el) => el?.contains(anchor));
  }

  // ── Section mutations ─────────────────────────────────────────────────────

  function addSection() {
    setSections((prev) => [...prev, { _key: newKey(), type: 'verse', content: '', runs: [] }]);
  }

  function onTypeChange(key, value) {
    setSections((prev) => prev.map((s) => s._key === key ? { ...s, type: value } : s));
  }

  function deleteSection(key) {
    delete sectionRefs.current[key];
    setSections((prev) => prev.filter((s) => s._key !== key));
  }

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const oi = sections.findIndex((s) => s._key === active.id);
    const ni = sections.findIndex((s) => s._key === over.id);
    setSections(arrayMove(sections, oi, ni));
  }

  function handleParsedImport(parsed) {
    setSections(parsed.map((p) => ({ _key: newKey(), type: p.type, content: p.content, runs: [] })));
    setShowPaste(false);
  }

  // ── Tags ──────────────────────────────────────────────────────────────────

  function toggleTag(id) {
    setSelectedTagIds((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const sectionData = sections.map((sec) => {
        const el = sectionRefs.current[sec._key];
        const { text, runs } = el
          ? extractContentAndRuns(el)
          : { text: sec.content || '', runs: sec.runs || [] };
        return serializeSection(sec.type, text, runs, songStyle);
      });

      const data = {
        title:     title.trim(),
        author:    author.trim()    || null,
        copyright: copyright.trim() || null,
        sections:  sectionData,
        tagIds:    selectedTagIds,
      };

      if (song?.id) await window.cue.songs.update(song.id, data);
      else          await window.cue.songs.create(data);
      onSave();
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'w-full bg-surface-container-lowest text-on-surface text-body-sm rounded-lg px-md py-sm border border-outline-variant/50 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors';
  const labelClass = 'block text-label-sm font-mono text-on-surface-variant mb-1 uppercase tracking-[0.05em]';

  return createPortal(
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl ring-1 ring-white/5">

        {/* Header */}
        <div className="flex items-center px-lg py-md border-b border-outline-variant/30 bg-surface-container-high rounded-t-xl flex-shrink-0">
          <div>
            <h2 className="text-headline-md font-bold text-primary tracking-tight">
              {song?.id ? 'Edit Song' : 'New Song'}
            </h2>
            <p className="text-label-sm font-mono text-on-surface-variant uppercase tracking-[0.05em]">
              {song?.id ? 'Song Editor · Edit' : 'Song Editor · New'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors cursor-pointer"
          >✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">

          {!showPaste && (
            <>
              {/* Metadata row */}
              <div className="grid grid-cols-3 gap-md px-lg py-md bg-surface-container/50 border-b border-outline-variant/20">
                <div className="col-span-3 sm:col-span-1">
                  <label className={labelClass}>Title *</label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)}
                    className={inputClass} placeholder="Song title" />
                </div>
                <div>
                  <label className={labelClass}>Author</label>
                  <input value={author} onChange={(e) => setAuthor(e.target.value)}
                    className={inputClass} placeholder="Songwriter / band" />
                </div>
                <div>
                  <label className={labelClass}>Copyright</label>
                  <input value={copyright} onChange={(e) => setCopyright(e.target.value)}
                    className={inputClass} placeholder="© Year Publisher" />
                </div>
              </div>

              {allTags.length > 0 && (
                <div className="px-lg py-sm border-b border-outline-variant/20">
                  <label className={labelClass}>Tags</label>
                  <div className="flex flex-wrap gap-xs mt-xs">
                    {allTags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className={`text-label-sm font-mono px-sm py-xs rounded-full transition-colors cursor-pointer border ${
                          selectedTagIds.includes(tag.id)
                            ? 'text-white border-transparent'
                            : 'bg-surface-container border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant'
                        }`}
                        style={selectedTagIds.includes(tag.id) ? { backgroundColor: tag.colour || '#4d8eff' } : {}}
                      >{tag.name}</button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Sections area */}
          <div className="p-lg">
            {showPaste ? (
              <PasteView onParse={handleParsedImport} onCancel={() => setShowPaste(false)} />
            ) : (
              <div>
                <div className="flex items-center justify-between mb-sm">
                  <span className={labelClass} style={{ marginBottom: 0 }}>Sections</span>
                  <button
                    onClick={() => setShowPaste(true)}
                    className="text-label-sm font-mono text-primary hover:text-primary/80 cursor-pointer transition-colors uppercase tracking-[0.05em]"
                  >↙ Paste Song</button>
                </div>

                {/* Unified section block */}
                <div className="border border-outline-variant/30 rounded-lg overflow-hidden">
                  <StyleBar
                    songStyle={songStyle}
                    onChange={setSongStyle}
                    fonts={fonts}
                    formatState={formatState}
                    hasSelection={hasSelection}
                  />

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={sections.map((s) => s._key)} strategy={verticalListSortingStrategy}>
                      {sections.map((section, idx) => (
                        <SortableSection
                          key={section._key}
                          section={section}
                          onTypeChange={onTypeChange}
                          onDelete={deleteSection}
                          onRef={registerRef}
                          songStyle={songStyle}
                          isLast={idx === sections.length - 1}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>

                  {sections.length === 0 && (
                    <div className="flex items-center justify-center h-14 text-on-surface-variant/30 text-label-sm font-mono uppercase tracking-[0.05em]">
                      No sections
                    </div>
                  )}
                </div>

                <button
                  onClick={addSection}
                  className="text-label-sm font-mono text-primary hover:text-primary/80 mt-sm cursor-pointer transition-colors uppercase tracking-[0.05em]"
                >+ Add Section</button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {!showPaste && (
          <div className="flex items-center justify-between px-lg py-md border-t border-outline-variant/30 bg-surface-container-high rounded-b-xl flex-shrink-0">
            <div className="flex items-center gap-xs text-on-surface-variant/40">
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary/60" />
              <span className="text-label-sm font-mono uppercase tracking-[0.05em]">
                {sections.length} section{sections.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center gap-sm">
              <button
                onClick={onClose}
                className="px-lg h-8 text-label-sm font-mono text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-variant transition-colors cursor-pointer uppercase tracking-[0.05em]"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!title.trim() || saving}
                className="px-lg h-8 text-label-sm font-mono bg-tertiary-container text-on-tertiary-container disabled:bg-surface-variant disabled:text-on-surface-variant/50 rounded-lg transition-colors cursor-pointer uppercase tracking-[0.05em] hover:opacity-90"
              >{saving ? 'Saving…' : 'Save Song'}</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
