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

  // Known section-type keywords
  const KW = 'verse|chorus|bridge|pre[-\\s]?chorus|prechorus|tag|intro|outro|refrain';

  const HEADER_PATTERNS = [
    // [Verse 1], [CHORUS], [Pre-Chorus], [Refrain], etc.
    new RegExp('^\\[(.{1,40}?)\\]\\s*:?\\s*$'),
    // "Refrain:", "Chorus:", "Bridge 2:" — keyword + optional number + colon, alone on line
    new RegExp(`^(${KW})\\s*\\d*\\s*:$`, 'i'),
    // "Verse 1", "CHORUS", "bridge" — standalone keyword, alone on line
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

  // Strip trailing inline section-reference tags, e.g. "...tonight. [Refrain]"
  // These are performance directions, not content.
  const TRAILING_TAG_RE = new RegExp(
    `\\s*\\[(${KW}|ch|br|v)\\s*\\d*\\]\\s*$`, 'i'
  );

  function cleanLine(line) {
    return line
      .trim()                                      // strip leading and trailing spaces
      .replace(TRAILING_TAG_RE, '')                // "tonight. [Refrain]" → "tonight."
      .replace(/^\s*[\[\(]?\d+[\]\)\.:]?\s+/, ''); // "1. Amazing" → "Amazing"
  }

  const sections   = [];
  let currentType  = null;
  let currentLines = [];
  let hasHeaders   = false;
  // prevBlank tracks whether the previous line was blank (or we're at file start).
  // Used to recognise "N. Content" as a stanza boundary only when it opens a stanza.
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

    // ── Standard section header ──────────────────────────────────────────────
    const headerLabel = matchHeader(line);
    if (headerLabel) {
      flush();
      currentType = labelToType(headerLabel);
      hasHeaders  = true;
      prevBlank   = true; // header is a stanza boundary — next line may be "N. content"
      continue;
    }

    // ── Skip lines that are only a number (stanza number on its own line) ────
    // Also treat as a stanza boundary so the next line can be detected as "N. content"
    if (/^\s*\d+[.):]?\s*$/.test(line)) {
      prevBlank = true;
      continue;
    }

    // ── Numbered stanza: "1. Content" / "2) Content" at the start of a stanza ─
    // Only fires after a blank line (or at file start) so it doesn't incorrectly
    // split lines like "Luke 2. And the angel said…" mid-stanza.
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

    // ── Regular content line ─────────────────────────────────────────────────
    if (isBlank) {
      currentLines.push('');
      prevBlank = true;
    } else {
      currentLines.push(cleanLine(line));
      prevBlank = false;
    }
  }
  flush();

  // Fallback: no section markers found → split by blank lines, all 'verse'
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

  const btnBase = 'h-6 w-6 flex items-center justify-center rounded-sm transition-colors flex-shrink-0 text-[11px] cursor-pointer';
  const btnOn   = 'bg-indigo-600 text-white';
  const btnOff  = 'text-slate-500 hover:text-slate-300 hover:bg-slate-700';

  function set(prop, value) { onChange({ ...songStyle, [prop]: value }); }

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-700 bg-slate-800/60 flex-wrap">
      {/* Font family */}
      <select
        value={songStyle.fontFamily || ''}
        onChange={(e) => set('fontFamily', e.target.value || null)}
        className="bg-slate-700 text-slate-200 text-[11px] rounded-sm px-1.5 h-6 border border-slate-600 w-28 outline-none focus:border-indigo-500 cursor-pointer"
        title="Font family"
      >
        <option value="">Default font</option>
        {fonts.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
      </select>

      {/* Font size */}
      <select
        value={songStyle.fontSize || ''}
        onChange={(e) => set('fontSize', e.target.value ? Number(e.target.value) : null)}
        className="bg-slate-700 text-slate-200 text-[11px] rounded-sm px-1 h-6 border border-slate-600 w-[58px] outline-none focus:border-indigo-500 cursor-pointer"
        title="Font size on output"
      >
        <option value="">Size</option>
        {FONT_SIZES.map((s) => <option key={s} value={s}>{s}px</option>)}
      </select>

      {/* Colour swatch */}
      <div className="relative flex-shrink-0" title="Text colour">
        <div
          className="w-6 h-6 rounded-sm border border-slate-600 cursor-pointer overflow-hidden"
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

      <div className="w-px h-4 bg-slate-700 flex-shrink-0" />

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

      <div className="w-px h-4 bg-slate-700 flex-shrink-0" />

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
          className="text-[10px] text-slate-600 hover:text-amber-400 cursor-pointer ml-1 transition-colors flex-shrink-0"
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

  return (
    <div ref={setNodeRef} style={dndStyle} className={`group ${!isLast ? 'border-b border-slate-700/60' : ''}`}>

      {/* Section header */}
      <div className="flex items-center gap-2 px-3 h-7 bg-slate-800/30">
        <button
          className="drag-handle cursor-grab text-slate-700 hover:text-slate-500 flex-shrink-0 flex items-center"
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
          className="text-[11px] text-slate-400 hover:text-slate-200 bg-transparent border-none outline-none cursor-pointer transition-colors"
        >
          {SECTION_TYPES.map((t) => (
            <option key={t} value={t} className="bg-slate-800 text-slate-200">
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>

        <div className="flex-1 border-t border-slate-700/30" />

        <button
          onClick={() => onDelete(section._key)}
          className="text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-[12px] leading-none flex-shrink-0"
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
        className="px-5 py-3 min-h-[72px] outline-none text-slate-100 leading-relaxed whitespace-pre-wrap caret-white"
        style={contentStyle}
      />
    </div>
  );
}

// ─── Paste view ───────────────────────────────────────────────────────────────

function PasteView({ onParse, onCancel }) {
  const [text, setText] = useState('');

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-slate-400 leading-relaxed">
        Paste the full song text. Headers like{' '}
        <span className="text-slate-300 font-mono">[Verse 1]</span>,{' '}
        <span className="text-slate-300 font-mono">Chorus:</span>, or{' '}
        <span className="text-slate-300 font-mono">BRIDGE</span> are detected and stripped.
        Leading numbers (<span className="text-slate-300 font-mono">1.</span>,{' '}
        <span className="text-slate-300 font-mono">2)</span>) are removed from lyric lines.
        If no headers are found, blank lines split the song.
      </p>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={18}
        placeholder={"[Verse 1]\nAmazing grace, how sweet the sound\nThat saved a wretch like me\n\n[Chorus]\nPraise the Lord..."}
        className="w-full bg-slate-700 text-slate-200 text-[13px] rounded-sm px-3 py-2 border border-slate-600 outline-none focus:border-indigo-500 resize-none font-mono leading-relaxed"
      />
      <div className="flex gap-2">
        <button
          onClick={() => { const p = parseSong(text); if (p.length) onParse(p); }}
          disabled={!text.trim()}
          className="px-4 h-7 text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-sm transition-colors cursor-pointer font-medium"
        >Import Sections</button>
        <button onClick={onCancel} className="px-4 h-7 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer">
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

  // Track execCommand format state for toolbar active indicators
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

        // Derive song-level style from first section that has style_json
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

  const inputClass = 'w-full bg-slate-700 text-slate-100 text-[13px] rounded-sm px-3 py-2 border border-slate-600 outline-none focus:border-indigo-500';
  const labelClass = 'block text-[10px] font-semibold tracking-[0.12em] uppercase text-slate-500 mb-1';

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-sm w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center px-4 py-3 border-b border-slate-700 flex-shrink-0">
          <h2 className="text-[13px] font-semibold text-slate-100">{song?.id ? 'Edit Song' : 'New Song'}</h2>
          <button onClick={onClose} className="ml-auto text-slate-600 hover:text-slate-300 cursor-pointer">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">

          {!showPaste && (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="col-span-2">
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
                <div className="mb-4">
                  <label className={labelClass}>Tags</label>
                  <div className="flex flex-wrap gap-1.5">
                    {allTags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className={`text-[11px] px-2.5 py-1 rounded-sm transition-colors cursor-pointer ${
                          selectedTagIds.includes(tag.id)
                            ? 'text-white'
                            : 'bg-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                        style={selectedTagIds.includes(tag.id) ? { backgroundColor: tag.colour || '#1A6FBA' } : {}}
                      >{tag.name}</button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {showPaste ? (
            <PasteView onParse={handleParsedImport} onCancel={() => setShowPaste(false)} />
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={labelClass} style={{ marginBottom: 0 }}>Sections</label>
                <button
                  onClick={() => setShowPaste(true)}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer transition-colors"
                >↙ Paste Song</button>
              </div>

              {/* Single container — all sections in one unified block */}
              <div className="border border-slate-700 rounded-sm overflow-hidden">
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
                  <div className="flex items-center justify-center h-14 text-slate-700 text-[11px] tracking-wider">
                    NO SECTIONS
                  </div>
                )}
              </div>

              <button
                onClick={addSection}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 mt-2 cursor-pointer transition-colors"
              >+ Add Section</button>
            </div>
          )}
        </div>

        {/* Footer */}
        {!showPaste && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-700 flex-shrink-0">
            <button onClick={onClose}
              className="px-4 h-7 text-[11px] text-slate-400 hover:text-slate-200 rounded-sm cursor-pointer">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!title.trim() || saving}
              className="px-4 h-7 text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-sm transition-colors cursor-pointer font-medium"
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
