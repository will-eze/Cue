import React, { useState, useEffect, useCallback, useRef } from 'react';
import ScriptureEditor from '../components/ScriptureEditor';
import ContextMenu from '../components/ContextMenu';
import AnchoredMenu from '../components/AnchoredMenu';
import OnlineBibleModal from '../components/OnlineBibleModal';

// EasyWorship-style live scripture browser.
//
//  • Left rail  — translation picker + import.
//  • Top bar    — predictive reference fields: Book (autocompletes), Chapter, Verse.
//                 Tab advances book → chapter → verse; Enter sends the selected verse live.
//  • Main list  — every verse of the loaded chapter (Trans · Reference · Scripture).
//                 Single-click selects (preview only). Double-click / Enter sends live.
//                 With the list focused, ↑/↓ move the selection AND send it live,
//                 rolling across chapter/book boundaries.

const REF_INPUT =
  'bg-surface-container-lowest border border-outline-variant/50 rounded-lg px-sm h-9 ' +
  'text-body-md text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all';

export default function ScripturePanel({ onGoLive, onAdd, onStyleSaved, onPreview, detectArmed, detectActive, detectDownloadPct, onToggleDetect }) {
  const [versions, setVersions] = useState([]);
  const [versionId, setVersionId] = useState(null);
  const [books, setBooks] = useState([]);
  const [bookMatches, setBookMatches] = useState([]);
  const [showBookMenu, setShowBookMenu] = useState(false);

  const [bookNum, setBookNum] = useState(null);
  const [bookName, setBookName] = useState('');
  const [chapter, setChapter] = useState('');
  const [verseNum, setVerseNum] = useState('');
  const [chapters, setChapters] = useState([]);

  const [chapterData, setChapterData] = useState(null); // { bookNum, bookName, chapter, verses:[{chapter,verse,text}] }
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [liveKey, setLiveKey] = useState(null);          // reference string of the live verse, e.g. "John 1:1"
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [importMenu, setImportMenu] = useState(null);
  const [showOnline, setShowOnline] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Split (compare) view — show every live verse in a second translation alongside
  // the primary. Persisted to settings; OperatorView reads it live to build the payload.
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitVersionId, setSplitVersionId] = useState(null);

  const bookInputRef = useRef(null);
  const chapterInputRef = useRef(null);
  const verseInputRef = useRef(null);
  const listRef = useRef(null);
  const bookTypedRef = useRef('');   // what the user actually typed (before ghost completion)

  const version = versions.find((v) => v.id === versionId) || null;

  // ── data loading ───────────────────────────────────────────────────────────
  const loadVersions = useCallback(async () => {
    const list = await window.cue.bible.versions();
    setVersions(list);
    setVersionId((cur) => cur ?? (list[0]?.id ?? null));
  }, []);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  // Load the persisted split-view setting once on mount.
  useEffect(() => {
    (async () => {
      setSplitEnabled((await window.cue.settings.get('scripture_split_enabled')) === '1');
      setSplitVersionId(Number(await window.cue.settings.get('scripture_split_version_id')) || null);
    })();
  }, []);

  // Persist split state and notify OperatorView (same reload hook as the style editor)
  // so the change reaches the live payload immediately.
  const persistSplit = useCallback(async (enabled, secondaryId) => {
    await window.cue.settings.set('scripture_split_enabled', enabled ? '1' : '');
    await window.cue.settings.set('scripture_split_version_id', secondaryId != null ? String(secondaryId) : '');
    onStyleSaved?.();
  }, [onStyleSaved]);

  function toggleSplit() {
    // Default the secondary to the first translation that isn't the active one.
    const next = !splitEnabled;
    let secondary = splitVersionId;
    if (next && (secondary == null || secondary === versionId)) {
      secondary = versions.find((v) => v.id !== versionId)?.id ?? null;
      setSplitVersionId(secondary);
    }
    setSplitEnabled(next);
    persistSplit(next, secondary);
  }

  function changeSplitVersion(id) {
    setSplitVersionId(id);
    persistSplit(splitEnabled, id);
  }

  // Focus the book field as soon as the Scriptures tab opens so the operator can
  // start typing a reference immediately (mounts fresh each time the tab is shown).
  useEffect(() => {
    const id = setTimeout(() => { bookInputRef.current?.focus(); bookInputRef.current?.select(); }, 0);
    return () => clearTimeout(id);
  }, []);

  // Drop the LIVE marker when the output is cleared or replaced by anything that
  // isn't our current verse (Escape, a song going live, etc.).
  useEffect(() => {
    const off = window.cue.on('output:state-changed', (s) => {
      const ref = s?.displayMode !== 'cleared' ? s?.livePayload?.sectionLabel : null;
      setLiveKey((cur) => (cur && ref === cur ? cur : null));
    });
    return off;
  }, []);

  // Load this version's books whenever the version changes.
  useEffect(() => {
    if (!versionId) { setBooks([]); return; }
    window.cue.bible.books(versionId).then(setBooks);
  }, [versionId]);

  // When the version changes and a passage is already open, reload it in the
  // new translation so the operator can compare verses across versions.
  useEffect(() => {
    if (!versionId || bookNum == null || !chapter) return;
    (async () => {
      const data = await window.cue.bible.verses(versionId, bookNum, Number(chapter));
      setChapterData(data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);

  // Keep the selected row scrolled into view.
  useEffect(() => {
    if (selectedIdx < 0) return;
    const el = listRef.current?.querySelector(`[data-vidx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, chapterData]);

  // ── book autocomplete ────────────────────────────────────────────────────────
  const filterBooks = useCallback((q) => {
    const n = q.trim().toLowerCase();
    if (!n) return books.slice(0, 8);
    const starts = books.filter((b) => b.book_name.toLowerCase().startsWith(n));
    if (starts.length) return starts.slice(0, 8);
    return books.filter((b) => b.book_name.toLowerCase().includes(n)).slice(0, 8);
  }, [books]);

  function handleBookChange(e) {
    const input = e.target;
    const typed = input.value;
    const wasLen = bookTypedRef.current.length;
    bookTypedRef.current = typed;
    setError('');
    const matches = filterBooks(typed);
    setBookMatches(matches);
    setShowBookMenu(true);

    const deleting = typed.length < wasLen;
    const best = matches[0];
    // Ghost-complete: rewrite the field to the best match and select the suffix so
    // the next keystroke overwrites it (classic browser autocomplete feel).
    if (!deleting && best && best.book_name.toLowerCase().startsWith(typed.toLowerCase())
        && best.book_name.length > typed.length) {
      input.value = best.book_name;
      input.setSelectionRange(typed.length, best.book_name.length);
    }
  }

  async function commitBook(rawName) {
    const typed = (rawName ?? bookInputRef.current?.value ?? '').trim();
    const book = books.find((b) => b.book_name.toLowerCase() === typed.toLowerCase())
      || filterBooks(typed)[0];
    setShowBookMenu(false);
    if (!book) { setError(`No book matching "${typed}".`); return false; }
    if (bookInputRef.current) bookInputRef.current.value = book.book_name;
    bookTypedRef.current = book.book_name;
    const sameBook = book.book_num === bookNum;
    setBookNum(book.book_num);
    setBookName(book.book_name);
    const chs = await window.cue.bible.chapters(versionId, book.book_num);
    setChapters(chs);
    if (!sameBook) {
      const ch = chs[0] ?? 1;
      setChapter(String(ch));
      setVerseNum('1');
      await loadChapter(book.book_num, ch, 1);
    }
    return true;
  }

  // ── chapter / verse loading ──────────────────────────────────────────────────
  const loadChapter = useCallback(async (bNum, ch, targetVerse) => {
    const data = await window.cue.bible.verses(versionId, bNum, Number(ch));
    setChapterData(data);
    const idx = Math.max(0, data.verses.findIndex((v) => v.verse === Number(targetVerse)));
    setSelectedIdx(data.verses.length ? idx : -1);
    return data;
  }, [versionId]);

  async function handleChapterChange(e) {
    const val = e.target.value.replace(/[^0-9]/g, '');
    setChapter(val);
    setError('');
    if (val && bookNum != null && chapters.includes(Number(val))) {
      setVerseNum('1');
      await loadChapter(bookNum, Number(val), 1);
    }
  }

  function handleVerseChange(e) {
    const val = e.target.value.replace(/[^0-9]/g, '');
    setVerseNum(val);
    if (val && chapterData) {
      const idx = chapterData.verses.findIndex((v) => v.verse === Number(val));
      if (idx >= 0) setSelectedIdx(idx);
    }
  }

  // ── live dispatch ─────────────────────────────────────────────────────────────
  const emitLive = useCallback((data, idx, focusList = true) => {
    const v = data?.verses?.[idx];
    if (!v) return;
    onGoLive?.({
      versionId,
      versionAbbrev: version?.abbrev ?? '',
      versionName: version?.name ?? '',
      bookNum: data.bookNum,
      bookName: data.bookName,
      chapter: v.chapter,
      verse: v.verse,
      text: v.text,
    });
    setLiveKey(`${data.bookName} ${v.chapter}:${v.verse}`);
    setSelectedIdx(idx);
    setChapter(String(v.chapter));
    setVerseNum(String(v.verse));
    if (focusList) listRef.current?.focus();
  }, [onGoLive, versionId, version]);

  // Move the selection by `dir` (±1) and send it live, rolling across chapter
  // and book boundaries via the canonical-order adjacency query.
  const navigateLive = useCallback(async (dir) => {
    const data = chapterData;
    if (!data || !data.verses.length) return;
    const nextIdx = selectedIdx + dir;
    if (nextIdx >= 0 && nextIdx < data.verses.length) {
      emitLive(data, nextIdx);
      return;
    }
    const edge = data.verses[dir > 0 ? data.verses.length - 1 : 0];
    const adj = await window.cue.bible.adjacent(versionId, data.bookNum, data.chapter, edge.verse, dir);
    if (!adj) return;
    const newData = await window.cue.bible.verses(versionId, adj.book_num, adj.chapter);
    setBookNum(adj.book_num);
    setBookName(adj.book_name);
    if (bookInputRef.current) bookInputRef.current.value = adj.book_name;
    if (adj.book_num !== data.bookNum) {
      window.cue.bible.chapters(versionId, adj.book_num).then(setChapters);
    }
    const idx = newData.verses.findIndex((v) => v.verse === adj.verse);
    setChapterData(newData);
    emitLive(newData, idx >= 0 ? idx : 0);
  }, [chapterData, selectedIdx, versionId, emitLive]);

  function handleListKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); navigateLive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); navigateLive(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (selectedIdx >= 0) emitLive(chapterData, selectedIdx); }
    else if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      if (selectedIdx >= 0 && onPreview) emitPreview(chapterData, selectedIdx);
    }
  }

  function emitPreview(data, idx) {
    const v = data?.verses?.[idx];
    if (!v || !onPreview) return;
    onPreview({
      versionId,
      versionAbbrev: version?.abbrev ?? '',
      versionName: version?.name ?? '',
      bookNum: data.bookNum,
      bookName: data.bookName,
      chapter: v.chapter,
      verse: v.verse,
      text: v.text,
    });
    setSelectedIdx(idx);
    setChapter(String(v.chapter));
    setVerseNum(String(v.verse));
    listRef.current?.focus();
  }

  // Enter anywhere in the reference bar sends the selected verse live.
  function handleRefBarEnter() {
    if (selectedIdx >= 0 && chapterData) emitLive(chapterData, selectedIdx);
  }

  // ── version management ────────────────────────────────────────────────────────
  async function handleImport() {
    setError('');
    const result = await window.cue.dialog.openFile({
      filters: [{ name: 'Bible', extensions: ['json', 'xml'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return;
    setImporting(true);
    try {
      const res = await window.cue.bible.importFile(result.filePaths[0], {});
      if (!res.ok) { setError(res.error || 'Import failed.'); return; }
      await loadVersions();
      setVersionId(res.id);
    } finally { setImporting(false); }
  }

  function handleSelectVersion(id) {
    setVersionId(id);
    setLiveKey(null);
  }

  async function handleDeleteVersion(id) {
    await window.cue.bible.delete(id);
    setConfirmDeleteId(null);
    const list = await window.cue.bible.versions();
    setVersions(list);
    if (versionId === id) {
      setVersionId(list[0]?.id ?? null);
      setChapterData(null); setSelectedIdx(-1); setLiveKey(null);
      setBookNum(null); setBookName(''); setChapter(''); setVerseNum(''); setChapters([]);
    }
  }

  function handleRowClick(idx) {
    setSelectedIdx(idx);
    const v = chapterData.verses[idx];
    setChapter(String(v.chapter));
    setVerseNum(String(v.verse));
    listRef.current?.focus();
  }

  // When split (compare) view is ON, bake the secondary translation into the passage
  // so the rundown item renders as a split verse — captured AT ADD TIME, so toggling
  // split later never rewrites items already in the rundown. Verses are matched by
  // number; if none resolve in the second translation, the single-version passage is
  // kept unchanged.
  async function withSplit(passage) {
    if (!splitEnabled || !splitVersionId || splitVersionId === versionId) return passage;
    const sv = versions.find((v) => v.id === splitVersionId);
    if (!sv) return passage;
    try {
      const chapters = [...new Set(passage.verses.map((v) => v.chapter))];
      const byKey = new Map();
      for (const ch of chapters) {
        const data = await window.cue.bible.verses(splitVersionId, passage.bookNum, ch);
        for (const v of (data?.verses || [])) byKey.set(`${v.chapter}:${v.verse}`, v.text);
      }
      const verses = passage.verses.map((v) => ({ ...v, splitText: byKey.get(`${v.chapter}:${v.verse}`) ?? null }));
      if (!verses.some((v) => v.splitText)) return passage;
      return { ...passage, verses, split: { versionId: sv.id, versionAbbrev: sv.abbrev, versionName: sv.name } };
    } catch { return passage; }
  }

  async function addVerseToRundown(idx) {
    if (!chapterData || !chapterData.verses.length || !version) return;
    const v = chapterData.verses[idx >= 0 ? idx : 0];
    if (!v) return;
    onAdd?.(await withSplit({
      versionId,
      versionAbbrev: version.abbrev,
      versionName: version.name,
      bookNum: chapterData.bookNum,
      bookName: chapterData.bookName,
      reference: `${chapterData.bookName} ${v.chapter}:${v.verse}`,
      versesPerSlide: 1,
      verses: [{ chapter: v.chapter, verse: v.verse, text: v.text }],
    }));
  }

  async function addChapterToRundown() {
    if (!chapterData || !chapterData.verses.length || !version) return;
    onAdd?.(await withSplit({
      versionId,
      versionAbbrev: version.abbrev,
      versionName: version.name,
      bookNum: chapterData.bookNum,
      bookName: chapterData.bookName,
      reference: `${chapterData.bookName} ${chapterData.chapter}`,
      versesPerSlide: 1,
      verses: chapterData.verses.map((v) => ({ chapter: v.chapter, verse: v.verse, text: v.text })),
    }));
  }

  function handleAddToRundown() { addVerseToRundown(selectedIdx); }

  return (
    <div className="flex flex-1 min-h-0">
      {/* ── Translations rail ─────────────────────────────────────────────── */}
      <div className="w-52 border-r border-outline-variant/30 flex flex-col shrink-0 min-h-0">
        <div className="px-md py-sm text-[10px] font-label-sm text-on-surface-variant uppercase tracking-[0.08em] shrink-0">
          Translations
        </div>
        <div className="flex-1 overflow-y-auto px-xs custom-scrollbar">
          {versions.map((v) => {
            const active = v.id === versionId;
            return (
              <div
                key={v.id}
                className={`group w-full flex items-center gap-xs px-sm py-xs rounded-lg transition-colors ${
                  active ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:bg-surface-variant'
                }`}
              >
                <button
                  onClick={() => handleSelectVersion(v.id)}
                  className="flex-1 min-w-0 flex items-center gap-sm text-left cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px] shrink-0"
                    style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}>menu_book</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-label-sm font-label-sm font-bold uppercase tracking-[0.04em] truncate">{v.abbrev}</span>
                    <span className="block text-[10px] text-on-surface-variant/70 truncate">{v.name}</span>
                  </span>
                </button>
                {confirmDeleteId === v.id ? (
                  <span className="flex items-center gap-xs shrink-0">
                    <button title="Confirm delete" onClick={() => handleDeleteVersion(v.id)}
                      className="text-error hover:text-error/80 cursor-pointer flex items-center">
                      <span className="material-symbols-outlined text-[16px]">check</span>
                    </button>
                    <button title="Keep" onClick={() => setConfirmDeleteId(null)}
                      className="text-on-surface-variant hover:text-on-surface cursor-pointer flex items-center">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </span>
                ) : (
                  <button title="Delete translation" onClick={() => setConfirmDeleteId(v.id)}
                    className="opacity-0 group-hover:opacity-100 text-on-surface-variant/60 hover:text-error transition-all cursor-pointer shrink-0 flex items-center">
                    <span className="material-symbols-outlined text-[15px]">delete</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {/* Import + Appearance — equal-width row at the bottom of the left rail */}
        <div className="flex shrink-0 border-t border-outline-variant/30">
          <button
            onClick={() => setShowEditor(true)}
            title="Appearance — scripture text & reference style"
            className="flex-1 flex items-center justify-center gap-xs py-sm text-label-sm font-label-sm text-on-surface-variant hover:text-primary hover:bg-surface-variant transition-colors cursor-pointer border-r border-outline-variant/30"
          >
            <span className="material-symbols-outlined text-[15px]">format_paint</span>
            Theme
          </button>
          <button
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setImportMenu({ x: r.right - 160, y: r.bottom + 4 }); }}
            disabled={importing}
            title="Import a translation (online or file)"
            className="flex-1 flex items-center justify-center gap-xs py-sm text-label-sm font-label-sm text-on-surface-variant hover:text-primary hover:bg-surface-variant transition-colors cursor-pointer disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[15px]">{importing ? 'hourglass_empty' : 'upload'}</span>
            Import
          </button>
        </div>
      </div>

      {/* ── Main column ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Reference bar */}
        <div className="flex items-center gap-xs px-md py-sm border-b border-outline-variant/30 shrink-0">
          <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">search</span>

          {/* Book (predictive) */}
          <div className="relative">
            <input
              ref={bookInputRef}
              type="text"
              placeholder="Book"
              defaultValue=""
              onChange={handleBookChange}
              onFocus={() => { setBookMatches(filterBooks(bookInputRef.current?.value || '')); setShowBookMenu(true); }}
              onBlur={() => setTimeout(() => setShowBookMenu(false), 120)}
              onKeyDown={(e) => {
                if (e.key === 'Tab' || e.key === ':' || e.key === '/' ) {
                  e.preventDefault(); commitBook().then(() => { setTimeout(() => { chapterInputRef.current?.focus(); chapterInputRef.current?.select(); }, 0); });
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  commitBook().then((ok) => { if (ok) setTimeout(() => { chapterInputRef.current?.focus(); chapterInputRef.current?.select(); }, 0); });
                } else if (e.key === 'Escape') { setShowBookMenu(false); }
              }}
              className={`${REF_INPUT} w-44`}
              autoComplete="off" spellCheck={false}
            />
            <AnchoredMenu
              open={showBookMenu && bookMatches.length > 0}
              anchorRef={bookInputRef}
              onClose={() => setShowBookMenu(false)}
              align="left"
              className="w-56 max-h-60 overflow-y-auto rounded-lg border border-outline-variant/40 bg-surface-container-high shadow-2xl ring-1 ring-white/5 custom-scrollbar"
            >
              {bookMatches.map((b) => (
                <button
                  key={b.book_num}
                  onMouseDown={(e) => { e.preventDefault(); commitBook(b.book_name).then(() => { setTimeout(() => { chapterInputRef.current?.focus(); chapterInputRef.current?.select(); }, 0); }); }}
                  className="block w-full text-left px-sm py-xs text-body-sm text-on-surface hover:bg-surface-variant transition-colors cursor-pointer"
                >
                  {b.book_name}
                </button>
              ))}
            </AnchoredMenu>
          </div>

          <span className="text-on-surface-variant/50 text-body-md">·</span>

          {/* Chapter */}
          <input
            ref={chapterInputRef}
            type="text" inputMode="numeric" placeholder="Ch"
            value={chapter}
            onChange={handleChapterChange}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Tab' || e.key === ':') { e.preventDefault(); verseInputRef.current?.focus(); verseInputRef.current?.select(); }
              else if (e.key === 'Enter') { e.preventDefault(); handleRefBarEnter(); }
              else if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (selectedIdx >= 0) emitPreview(chapterData, selectedIdx); }
            }}
            className={`${REF_INPUT} w-16 text-center`}
            autoComplete="off"
          />
          <span className="text-on-surface-variant/50 text-body-md">:</span>

          {/* Verse */}
          <input
            ref={verseInputRef}
            type="text" inputMode="numeric" placeholder="V"
            value={verseNum}
            onChange={handleVerseChange}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleRefBarEnter(); }
              else if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (selectedIdx >= 0) emitPreview(chapterData, selectedIdx); }
            }}
            className={`${REF_INPUT} w-16 text-center`}
            autoComplete="off"
          />

          {/* Previous / Next verse nav */}
          <div className="flex items-center gap-[2px]">
            <button
              onClick={() => navigateLive(-1)}
              disabled={!chapterData}
              title="Previous verse (←)"
              className="flex items-center justify-center w-7 h-7 rounded border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-primary hover:border-primary/50 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[14px]">chevron_left</span>
            </button>
            <button
              onClick={() => navigateLive(1)}
              disabled={!chapterData}
              title="Next verse (→)"
              className="flex items-center justify-center w-7 h-7 rounded border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-primary hover:border-primary/50 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            </button>
          </div>

          {/* Split (compare) view — toggle + inline second-translation picker. Moved
              off the cramped left rail into the reference bar's free space. */}
          <div className="ml-sm pl-sm border-l border-outline-variant/30 flex items-center gap-xs">
            <button
              onClick={toggleSplit}
              title="Split view — show every live verse in two translations at once (full screen + lower third)"
              className={`flex items-center gap-xs px-sm h-9 rounded-lg text-label-sm font-label-sm font-bold uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                splitEnabled
                  ? 'bg-primary/15 border-primary/50 text-primary'
                  : 'bg-surface-container border-outline-variant/40 text-on-surface-variant hover:border-primary/50 hover:text-primary'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]" style={splitEnabled ? { fontVariationSettings: "'FILL' 1" } : undefined}>vertical_split</span>
              Split
            </button>
            {splitEnabled && (
              versions.filter((v) => v.id !== versionId).length > 0 ? (
                <select
                  value={splitVersionId ?? ''}
                  onChange={(e) => changeSplitVersion(Number(e.target.value) || null)}
                  title="Second translation shown alongside the live verse"
                  className="bg-surface-container-lowest border border-outline-variant/50 rounded-lg px-sm h-9 max-w-[7rem] text-body-sm text-on-surface outline-none focus:border-primary cursor-pointer"
                >
                  {versions.filter((v) => v.id !== versionId).map((v) => (
                    <option key={v.id} value={v.id}>{v.abbrev}</option>
                  ))}
                </select>
              ) : (
                <span className="text-[10px] text-on-surface-variant/60 max-w-[7rem] leading-tight">Import a 2nd translation</span>
              )
            )}
          </div>

          <div className="flex-1" />

          {/* Auto-detect: listen to the service audio and surface the spoken verse */}
          {onToggleDetect && (
            <button
              onClick={onToggleDetect}
              title="Auto-detect spoken scripture references and quotes from the live audio"
              className={`flex items-center gap-xs px-sm h-9 rounded-lg text-label-sm font-label-sm font-bold uppercase tracking-[0.05em] border transition-colors cursor-pointer ${
                detectArmed
                  ? 'bg-tertiary-container/60 border-tertiary/50 text-tertiary'
                  : 'bg-surface-container border-outline-variant/40 text-on-surface-variant hover:border-primary/50 hover:text-primary'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]" style={detectArmed ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                {detectArmed ? 'mic' : 'mic_none'}
              </span>
              {detectDownloadPct != null ? `Downloading ${detectDownloadPct}%` : detectArmed ? 'Listening' : 'Auto Detect'}
              {detectArmed && detectActive && detectDownloadPct == null && (
                <span className="w-[6px] h-[6px] rounded-full bg-tertiary animate-pulse" />
              )}
            </button>
          )}

          {onPreview && (
            <button
              onClick={() => { if (selectedIdx >= 0) emitPreview(chapterData, selectedIdx); }}
              disabled={selectedIdx < 0}
              title="Stage selected verse to the preview monitor without going live (P)"
              className="flex items-center gap-xs px-md h-9 rounded-lg bg-primary/10 border border-primary/40 text-primary text-label-sm font-label-sm font-bold uppercase tracking-[0.05em] hover:bg-primary/20 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[16px]">visibility</span>
              Preview
            </button>
          )}

          <button
            onClick={() => { if (selectedIdx >= 0) emitLive(chapterData, selectedIdx); }}
            disabled={selectedIdx < 0}
            title="Send selected verse to live output (Enter)"
            className="flex items-center gap-xs px-md h-9 rounded-lg bg-tertiary-container text-on-tertiary text-label-sm font-label-sm font-bold uppercase tracking-[0.05em] hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[16px]">slideshow</span>
            Go Live
          </button>

          <button
            onClick={handleAddToRundown}
            disabled={selectedIdx < 0}
            title="Add selected verse to the rundown"
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:border-primary/50 hover:text-primary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[16px]">playlist_add</span>
          </button>
        </div>

        {error && (
          <div className="px-md py-xs text-body-sm text-error border-b border-outline-variant/20 shrink-0">{error}</div>
        )}

        {/* Verse list */}
        <div
          ref={listRef}
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          className="flex-1 overflow-y-auto outline-none custom-scrollbar focus:ring-1 focus:ring-inset focus:ring-primary/30"
        >
          {chapterData && chapterData.verses.length > 0 ? (
            chapterData.verses.map((v, idx) => {
              const isSelected = idx === selectedIdx;
              const isLive = liveKey === `${chapterData.bookName} ${v.chapter}:${v.verse}`;
              return (
                <div
                  key={`${v.chapter}:${v.verse}`}
                  data-vidx={idx}
                  onClick={() => handleRowClick(idx)}
                  onDoubleClick={() => emitLive(chapterData, idx)}
                  onContextMenu={(e) => { e.preventDefault(); setSelectedIdx(idx); setContextMenu({ x: e.clientX, y: e.clientY, idx }); }}
                  className={`flex items-start gap-md px-md py-xs cursor-pointer border-l-4 transition-colors ${
                    isLive ? 'border-secondary' : isSelected ? 'border-primary' : 'border-transparent'
                  } ${
                    isSelected ? 'bg-primary/10' : 'hover:bg-surface-variant/50'
                  }`}
                >
                  <span className={`w-28 shrink-0 text-label-sm font-label-sm pt-[1px] ${isLive ? 'text-secondary' : 'text-primary'}`}>
                    {chapterData.bookName} {v.chapter}:{v.verse}
                    {isLive && <span className="ml-xs text-[9px] align-top">● LIVE</span>}
                  </span>
                  <span className="flex-1 min-w-0 text-body-md text-on-surface leading-snug">{v.text}</span>
                </div>
              );
            })
          ) : (
            <div className="flex flex-1 h-full flex-col items-center justify-center gap-sm text-outline-variant">
              <span className="material-symbols-outlined text-4xl">menu_book</span>
              <span className="text-label-sm font-label-sm uppercase tracking-widest">Type a Reference Above</span>
              <p className="text-body-sm text-on-surface-variant max-w-sm text-center px-md">
                e.g. type <span className="text-on-surface">Ge</span> → Genesis, Tab → chapter, Tab → verse, Enter to go live.
                Then use ↑ / ↓ to advance verses live.
              </p>
            </div>
          )}
        </div>

      </div>

      {showEditor && (
        <ScriptureEditor
          onClose={() => setShowEditor(false)}
          onSave={() => onStyleSaved?.()}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            ...(onPreview ? [{ label: 'Preview', onClick: () => { emitPreview(chapterData, contextMenu.idx); setContextMenu(null); } }] : []),
            { label: 'Send Live', onClick: () => { emitLive(chapterData, contextMenu.idx); setContextMenu(null); } },
            { separator: true },
            { label: 'Add Verse to Rundown', onClick: () => { addVerseToRundown(contextMenu.idx); setContextMenu(null); } },
            { label: 'Add Chapter to Rundown', onClick: () => { addChapterToRundown(); setContextMenu(null); } },
          ]}
        />
      )}

      {importMenu && (
        <ContextMenu
          x={importMenu.x} y={importMenu.y}
          onClose={() => setImportMenu(null)}
          items={[
            { label: 'Import from Online', onClick: () => { setImportMenu(null); setShowOnline(true); } },
            { label: 'Import from File', onClick: () => { setImportMenu(null); handleImport(); } },
          ]}
        />
      )}

      {showOnline && (
        <OnlineBibleModal onClose={() => setShowOnline(false)} onImported={loadVersions} />
      )}
    </div>
  );
}
