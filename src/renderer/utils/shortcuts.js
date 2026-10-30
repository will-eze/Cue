// The one list of keyboard shortcuts, shown by the ? overlay and Settings › Shortcuts.
// Keys are formatted for the platform: macOS uses symbols with no separator (⌘⇧C),
// Windows/Linux spell them out (Ctrl+Shift+C). Keep this in step with the real
// handlers (OperatorView keydown, App.jsx, SongEditor handleEditorKeyDown,
// utils/lyricsClipboard.js) — it is what operators learn the app from.

export const isMac = window.cue?.platform === 'darwin';

const NAMES = isMac
  ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' }
  : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl' };

// combo('mod', 'shift', 'C') → '⌘⇧C' / 'Ctrl+Shift+C'
export function combo(...parts) {
  const out = parts.map((p) => NAMES[p] || p);
  return out.join(isMac ? '' : '+');
}

// `sc` = the operator's configurable bare keys { go, logo, live }.
export function shortcutGroups(sc = { go: 'g', logo: 'l', live: 'o' }) {
  const up = (s) => (s || '').toUpperCase();
  return [
    {
      title: 'Going live',
      rows: [
        { keys: ['Space'], desc: 'Next slide on live' },
        { keys: [up(sc.go)], desc: 'GO: send preview to live (when Hotkeys are on)' },
        { keys: ['Esc'], desc: 'Clear all outputs (when Hotkeys are on)' },
        { keys: [up(sc.logo)], desc: 'Show the logo' },
        { keys: [up(sc.live)], desc: 'Turn outputs on or off (when Hotkeys are on)' },
        { keys: ['Q', 'W', 'E…'], desc: 'Jump live to slide 1, 2, 3… (when Jump is on)' },
        { keys: ['1–9'], desc: 'Recall the Scene with that number' },
      ],
    },
    {
      title: 'Moving around',
      rows: [
        { keys: ['↓', '↑'], desc: 'Next / previous slide or item in preview' },
        { keys: ['S', combo('mod', 'F')], desc: 'Search songs' },
        { keys: [combo('mod', 'K'), combo('mod', 'N')], desc: 'Command palette: find and add anything' },
        isMac
          ? { keys: [combo('ctrl', 'Tab'), combo('ctrl', '.')], desc: 'Next Library tab (⌃⇧Tab or ⌃, for previous)' }
          : { keys: [combo('ctrl', 'Tab')], desc: 'Next Library tab (Ctrl+Shift+Tab for previous)' },
        { keys: ['`'], desc: 'Open or close the Stage controls' },
        { keys: [combo('mod', ',')], desc: 'Open or leave Settings' },
        { keys: ['?'], desc: 'Show or hide this list' },
      ],
    },
    {
      title: 'Song editor',
      rows: [
        { keys: [combo('mod', 'Enter')], desc: 'New slide here (shown as a scissors line)' },
        { keys: ['Enter'], desc: 'After a section name on its own line ("Chorus"), start that section' },
        { keys: [combo('alt', '↑'), combo('alt', '↓')], desc: 'Previous / next section' },
        { keys: [combo('mod', 'S')], desc: 'Save' },
        { keys: [combo('mod', 'B'), combo('mod', 'I'), combo('mod', 'U')], desc: 'Bold / italic / underline the selection' },
      ],
    },
    {
      title: 'Copy and edit',
      rows: [
        { keys: [combo('mod', 'C')], desc: 'Copy lyrics with section labels' },
        { keys: [combo('mod', 'shift', 'C')], desc: 'Copy lyrics only, no labels (editor and song previews)' },
        { keys: [combo('mod', 'X'), combo('mod', 'V')], desc: 'Cut / paste. Pasting a whole song splits it into sections' },
        { keys: [combo('mod', 'Z'), combo('mod', 'shift', 'Z')], desc: 'Undo / redo in editors' },
        { keys: [combo('mod', 'A')], desc: 'Select all rundown items (or all text, when text is selected)' },
        { keys: [combo('mod', 'D')], desc: 'Duplicate the selected rundown items' },
      ],
    },
  ];
}
