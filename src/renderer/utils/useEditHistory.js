import { useState, useRef, useCallback, useEffect } from 'react';

// Shared in-memory undo/redo for the in-app editors (Song / Scripture / Graphics /
// Presentation). Holds the editor's WORKING DOCUMENT (a plain object/array) plus a
// bounded past/future stack. The editor reads `state` and mutates via `set` (like
// useState); each non-coalesced `set` pushes the prior state onto the undo stack.
//
// Granularity: pass a `coalesce` tag (e.g. 'title', 'lyrics:<key>') to merge a
// rapid run of edits to the SAME field (typing) into one undo step — the snapshot
// is only pushed when the tag changes or after `coalesceMs` of quiet. Structural
// edits (add / remove / reorder / style change) call `set(next)` with no tag, so
// each becomes its own step.
//
// Scope: session-local — the stack lives while the editor modal is mounted and is
// thrown away on close. No DB / IPC; the working copy is committed only on Save.
export default function useEditHistory(initial, { max = 50, coalesceMs = 600 } = {}) {
  const [hist, setHist] = useState({ past: [], present: initial, future: [] });
  // Tracks the last coalesce tag + time so a typing run collapses to one step.
  const coalesceRef = useRef({ tag: null, time: 0 });

  // NOTE: the coalesce bookkeeping happens HERE, in the function body (which runs
  // once per call) — never inside the setHist updater. The updater must stay pure,
  // because React StrictMode invokes it twice in dev; a ref mutation inside it would
  // run twice and clobber the snapshot (the bug this avoids).
  const set = useCallback((updater, coalesce) => {
    const now = Date.now();
    const shouldCoalesce = coalesce != null
      && coalesceRef.current.tag === coalesce
      && now - coalesceRef.current.time < coalesceMs;
    coalesceRef.current = { tag: coalesce ?? null, time: now };
    setHist((h) => {
      const next = typeof updater === 'function' ? updater(h.present) : updater;
      if (Object.is(next, h.present)) return h;
      // Same-tag edit within the window → replace present, don't snapshot, so undo
      // jumps back to before the whole typing run started.
      if (shouldCoalesce) return { past: h.past, present: next, future: [] };
      return { past: [...h.past, h.present].slice(-max), present: next, future: [] };
    });
  }, [max, coalesceMs]);

  // Replace the document WITHOUT recording history — for the initial load from the
  // DB (so the first real edit, not the async hydrate, is the first undo step).
  const reset = useCallback((value) => {
    coalesceRef.current = { tag: null, time: 0 };
    setHist({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    coalesceRef.current = { tag: null, time: 0 };
    setHist((h) => {
      if (!h.past.length) return h;
      return {
        past: h.past.slice(0, -1),
        present: h.past[h.past.length - 1],
        future: [h.present, ...h.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    coalesceRef.current = { tag: null, time: 0 };
    setHist((h) => {
      if (!h.future.length) return h;
      return {
        past: [...h.past, h.present],
        present: h.future[0],
        future: h.future.slice(1),
      };
    });
  }, []);

  return {
    state: hist.present,
    set,
    reset,
    undo,
    redo,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
  };
}

// Editor-local ⌘Z / ⌘⇧Z (Ctrl on Windows/Linux) bound to `undo` / `redo`. Attached
// at the document during the capture phase and stopped from propagating, so it runs
// the editor's history rather than the global operator keydown (which is mounted on
// the same document) or the browser's native text undo. Deliberately ONLY claims
// the Z key — it never touches ⌘C / ⌘X / ⌘A, per the clipboard-accelerator rule.
export function useUndoRedoKeys(undo, redo, { enabled = true } = {}) {
  const isMac = window.cue?.platform === 'darwin';
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey) return;
      if (e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo(); else undo();
    };
    document.addEventListener('keydown', onKey, true); // capture: beat the operator handler
    return () => document.removeEventListener('keydown', onKey, true);
  }, [undo, redo, enabled, isMac]);
}
