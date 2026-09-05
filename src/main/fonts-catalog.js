// Downloadable font library — curated open-licence (OFL / Apache 2.0) families
// that are NOT bundled with the app. Each is fetched on demand from the
// @fontsource jsDelivr CDN (which packages only redistributable open fonts) and
// cached into userData/fonts, after which it renders everywhere via the existing
// cue-media:// user-font path. See src/main/db/fonts.js downloadLibraryFont().
//
//   family  — the CSS font-family name (matches what fontsource registers)
//   id      — the @fontsource package id (…/npm/@fontsource/<id>/files/<id>-latin-<w>-normal.woff2)
//   weights — the weights to fetch (a missing weight is skipped gracefully)
//
// Curated for worship/broadcast: the free fonts ProPresenter templates use plus
// open look-alikes for the popular commercial faces (Gotham→Montserrat, etc.).
// Bundled families (Inter, Montserrat, Oswald, Lora, Bebas Neue, …) are NOT here —
// they ship in src/fonts and always show as installed.

export const FONT_CATALOG = [
  // ── Sans-serif (grotesque / geometric / humanist) ──────────────────────────
  { family: 'Work Sans',        id: 'work-sans',            category: 'sans-serif', weights: [400, 700] },
  { family: 'Libre Franklin',   id: 'libre-franklin',       category: 'sans-serif', weights: [400, 700] },
  { family: 'Manrope',          id: 'manrope',              category: 'sans-serif', weights: [400, 700] },
  { family: 'Hanken Grotesk',   id: 'hanken-grotesk',       category: 'sans-serif', weights: [400, 700] },
  { family: 'Figtree',          id: 'figtree',              category: 'sans-serif', weights: [400, 700] },
  { family: 'Sora',             id: 'sora',                 category: 'sans-serif', weights: [400, 700] },
  { family: 'Public Sans',      id: 'public-sans',          category: 'sans-serif', weights: [400, 700] },
  { family: 'Outfit',           id: 'outfit',               category: 'sans-serif', weights: [400, 700] },
  { family: 'Lexend',           id: 'lexend',               category: 'sans-serif', weights: [400, 700] },
  { family: 'Questrial',        id: 'questrial',            category: 'sans-serif', weights: [400] },
  { family: 'Josefin Sans',     id: 'josefin-sans',         category: 'sans-serif', weights: [400, 700] },
  { family: 'Nunito Sans',      id: 'nunito-sans',          category: 'sans-serif', weights: [400, 700] },
  { family: 'Open Sans',        id: 'open-sans',            category: 'sans-serif', weights: [400, 700] },
  { family: 'Mulish',           id: 'mulish',               category: 'sans-serif', weights: [400, 700] },
  { family: 'Cabin',            id: 'cabin',                category: 'sans-serif', weights: [400, 700] },
  { family: 'Source Sans 3',    id: 'source-sans-3',        category: 'sans-serif', weights: [400, 700] },
  { family: 'Rubik',            id: 'rubik',                category: 'sans-serif', weights: [400, 700] },
  { family: 'Assistant',        id: 'assistant',            category: 'sans-serif', weights: [400, 700] },
  { family: 'Barlow Semi Condensed', id: 'barlow-semi-condensed', category: 'sans-serif', weights: [400, 700] },

  // ── Display (tall / condensed / characterful — title & lyric slides) ────────
  { family: 'Anton',            id: 'anton',                category: 'display', weights: [400] },
  { family: 'Archivo Narrow',   id: 'archivo-narrow',       category: 'display', weights: [400, 700] },
  { family: 'Fjalla One',       id: 'fjalla-one',           category: 'display', weights: [400] },
  { family: 'Teko',             id: 'teko',                 category: 'display', weights: [400, 700] },
  { family: 'Saira Condensed',  id: 'saira-condensed',      category: 'display', weights: [400, 700] },
  { family: 'Pathway Gothic One', id: 'pathway-gothic-one', category: 'display', weights: [400] },
  { family: 'Staatliches',      id: 'staatliches',          category: 'display', weights: [400] },
  { family: 'Fraunces',         id: 'fraunces',             category: 'display', weights: [400, 700] },
  { family: 'Bricolage Grotesque', id: 'bricolage-grotesque', category: 'display', weights: [400, 700] },
  { family: 'Big Shoulders Display', id: 'big-shoulders-display', category: 'display', weights: [400, 700] },
  { family: 'Unbounded',        id: 'unbounded',            category: 'display', weights: [400, 700] },

  // ── Serif (elegant / reverent — scripture & sanctuary looks) ────────────────
  { family: 'Libre Baskerville', id: 'libre-baskerville',   category: 'serif', weights: [400, 700] },
  { family: 'Crimson Pro',      id: 'crimson-pro',          category: 'serif', weights: [400, 700] },
  { family: 'Spectral',         id: 'spectral',             category: 'serif', weights: [400, 700] },
  { family: 'Source Serif 4',   id: 'source-serif-4',       category: 'serif', weights: [400, 700] },
  { family: 'Newsreader',       id: 'newsreader',           category: 'serif', weights: [400, 700] },
  { family: 'DM Serif Text',    id: 'dm-serif-text',        category: 'serif', weights: [400] },
  { family: 'Cormorant',        id: 'cormorant',            category: 'serif', weights: [400, 700] },
  { family: 'Cardo',            id: 'cardo',                category: 'serif', weights: [400, 700] },
  { family: 'Alegreya',         id: 'alegreya',             category: 'serif', weights: [400, 700] },

  // ── Slab serif ──────────────────────────────────────────────────────────────
  { family: 'Zilla Slab',       id: 'zilla-slab',           category: 'slab', weights: [400, 700] },
  { family: 'Roboto Slab',      id: 'roboto-slab',          category: 'slab', weights: [400, 700] },
  { family: 'Arvo',             id: 'arvo',                 category: 'slab', weights: [400, 700] },
  { family: 'Bitter',           id: 'bitter',               category: 'slab', weights: [400, 700] },
  { family: 'Alfa Slab One',    id: 'alfa-slab-one',        category: 'slab', weights: [400] },

  // ── Script / handwritten (title cards — use sparingly) ──────────────────────
  { family: 'Sacramento',       id: 'sacramento',           category: 'script', weights: [400] },
  { family: 'Great Vibes',      id: 'great-vibes',          category: 'script', weights: [400] },
  { family: 'Caveat',           id: 'caveat',               category: 'script', weights: [400, 700] },
  { family: 'Parisienne',       id: 'parisienne',           category: 'script', weights: [400] },
  { family: 'Kalam',            id: 'kalam',                category: 'script', weights: [400, 700] },

  // ── Monospace (broadcast / timecode) ────────────────────────────────────────
  { family: 'Space Mono',       id: 'space-mono',           category: 'monospace', weights: [400, 700] },
  { family: 'JetBrains Mono',   id: 'jetbrains-mono',       category: 'monospace', weights: [400, 700] },
  { family: 'IBM Plex Mono',    id: 'ibm-plex-mono',        category: 'monospace', weights: [400, 700] },
];

export const FONT_CATALOG_LABEL = (family) => family;

// Build the on-demand woff2 URL for a family/weight from @fontsource on jsDelivr.
export function fontsourceUrl(id, weight) {
  return `https://cdn.jsdelivr.net/npm/@fontsource/${id}/files/${id}-latin-${weight}-normal.woff2`;
}
