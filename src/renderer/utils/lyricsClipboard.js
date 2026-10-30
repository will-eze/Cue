// Shared lyrics presentation + copy behaviour for read-only song views (library
// preview, rundown song preview, set-list preview pane), matching the Song Editor:
//   ⌘C / Ctrl+C        → lyrics WITH section labels ("Verse 1 / Chorus …")
//   ⌘⇧C / Ctrl+Shift+C → lyrics only
// Markup contract: each section is an element with `data-sec`, its label `data-sec-label`
// and its lyrics `data-sec-body` (whitespace-pre-wrap text). Anything marked
// `data-copy-meta` (title / author) is included by ⌘C only; `data-no-copy` never.

import { useEffect, useRef } from 'react';

// Section label chip colours — one place so the editor and every preview agree.
// Blue = chorus-like (the bit everyone sings), green = bridge/tag, neutral = verse.
export const SECTION_CHIP = {
  verse: 'bg-surface-variant text-on-surface border-outline-variant/60',
  chorus: 'bg-primary/20 text-primary border-primary/40',
  refrain: 'bg-primary/20 text-primary border-primary/40',
  'pre-chorus': 'bg-primary/10 text-primary border-primary/30',
  bridge: 'bg-tertiary/15 text-tertiary border-tertiary/40',
  tag: 'bg-tertiary/10 text-tertiary border-tertiary/30',
  intro: 'bg-surface-container-highest text-on-surface-variant border-outline-variant/50',
  outro: 'bg-surface-container-highest text-on-surface-variant border-outline-variant/50',
};
export const sectionChipClass = (type) =>
  `inline-flex items-center h-[22px] px-sm rounded-md border text-[12px] font-semibold leading-none ${SECTION_CHIP[type] || SECTION_CHIP.verse}`;

function selectionText(root, { labels }) {
  const sel = window.getSelection();
  if (!root || !sel || !sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const frag = range.cloneContents();
  frag.querySelectorAll('[data-no-copy]').forEach((n) => n.remove());
  const secs = frag.querySelectorAll('[data-sec]');
  // Selection inside one section's lyrics: no structure in the fragment — plain text.
  if (!secs.length && !frag.querySelector('[data-sec-body],[data-copy-meta]')) {
    return (frag.textContent || '').trim();
  }
  const parts = [];
  if (labels) {
    frag.querySelectorAll('[data-copy-meta]').forEach((m) => {
      const t = [...m.children].map((c) => c.textContent.trim()).filter(Boolean).join('\n') || m.textContent.trim();
      if (t) parts.push(t);
    });
  }
  const units = secs.length ? [...secs] : [...frag.querySelectorAll('[data-sec-body]')].map((b) => ({ querySelector: (q) => (q === '[data-sec-body]' ? b : null) }));
  for (const s of units) {
    const label = s.querySelector('[data-sec-label]')?.textContent?.trim();
    const body = (s.querySelector('[data-sec-body]')?.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    if (!body && !label) continue;
    parts.push(labels && label ? `${label}\n${body}`.trim() : body);
  }
  return parts.filter(Boolean).join('\n\n');
}

// Attach the copy behaviour to a container (ref). Returns nothing; cleans up itself.
export function useLyricsCopy(ref, onCopied) {
  const plain = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onCopy = (e) => {
      const text = selectionText(el, { labels: !plain.current });
      plain.current = false;
      if (text == null) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
    };
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !el.contains(sel.anchorNode)) return;
        e.preventDefault();
        e.stopPropagation();
        plain.current = true;
        document.execCommand('copy');
        plain.current = false;
        onCopied?.('Copied lyrics without section labels');
      }
    };
    // Listen on document for the key (a read-only preview rarely has focus) but only
    // act when the selection is inside this container.
    el.addEventListener('copy', onCopy);
    document.addEventListener('keydown', onKey, true);
    return () => { el.removeEventListener('copy', onCopy); document.removeEventListener('keydown', onKey, true); };
  });
}
