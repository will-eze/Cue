// Lower-third channel content mode, derived from two flags on the channel row:
//   show_program (lyric band) + show_graphics (broadcast-graphics overlay).
//   both → Lyrics + Graphics · lyrics → Lyrics Only · graphics → Graphics Only
// Used by Settings → Output Channels and the Graphics panel's quick switcher so an
// operator can flip a channel (e.g. an NDI feed) between lyrics and graphics fast.

export const CHANNEL_MODES = [
  { id: 'both',     label: 'Lyrics + Graphics', short: 'Both',     icon: 'subtitles' },
  { id: 'lyrics',   label: 'Lyrics Only',       short: 'Lyrics',   icon: 'lyrics' },
  { id: 'graphics', label: 'Graphics Only',     short: 'Graphics', icon: 'branding_watermark' },
];

export function channelMode(ch) {
  const program  = ch?.show_program  !== 0;
  const graphics = ch?.show_graphics !== 0;
  if (program && graphics) return 'both';
  if (program) return 'lyrics';
  return 'graphics'; // graphics-only (covers the degenerate !program && !graphics too)
}

export function modeToFlags(mode) {
  if (mode === 'lyrics')   return { show_program: 1, show_graphics: 0 };
  if (mode === 'graphics') return { show_program: 0, show_graphics: 1 };
  return { show_program: 1, show_graphics: 1 }; // both
}
