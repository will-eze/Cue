// Font library exposed to the editors and font pickers.
// `family` is the CSS font-family applied to slide/graphic text.
//   - bundled:true  → shipped inside the app (woff2 in src/fonts/, declared in fonts.css);
//                     renders identically on every machine.
//   - bundled:false → a platform font (macOS/Windows). Each `family` is a fallback
//                     stack so it resolves to the closest available face, or the
//                     generic family if none is installed.
// The pickers only read `family` + `label`, so extra fields are harmless.

export const BUNDLED_FONTS = [
  // ── Shipped with the app (pixel-identical on every output machine) ──────────
  { family: 'Inter',            label: 'Inter',            category: 'sans-serif', bundled: true },
  { family: 'Montserrat',       label: 'Montserrat',       category: 'sans-serif', bundled: true },
  { family: 'Lato',             label: 'Lato',             category: 'sans-serif', bundled: true },
  { family: 'Oswald',           label: 'Oswald',           category: 'sans-serif', bundled: true },
  { family: 'Playfair Display', label: 'Playfair Display', category: 'serif',      bundled: true },
  { family: 'EB Garamond',      label: 'EB Garamond',      category: 'serif',      bundled: true },
  // ── Theme-pack fonts (free/OFL, woff2 in src/fonts) ─────────────────────────
  { family: 'Archivo',            label: 'Archivo',            category: 'sans-serif', bundled: true },
  { family: 'Barlow Condensed',   label: 'Barlow Condensed',   category: 'sans-serif', bundled: true },
  { family: 'Bebas Neue',         label: 'Bebas Neue',         category: 'display',    bundled: true },
  { family: 'Jost',               label: 'Jost',               category: 'sans-serif', bundled: true },
  { family: 'Overpass',           label: 'Overpass',           category: 'sans-serif', bundled: true },
  { family: 'Poppins',            label: 'Poppins',            category: 'sans-serif', bundled: true },
  { family: 'Roboto',             label: 'Roboto',             category: 'sans-serif', bundled: true },
  { family: 'Cinzel',             label: 'Cinzel',             category: 'serif',      bundled: true },
  { family: 'Cormorant Garamond', label: 'Cormorant Garamond', category: 'serif',      bundled: true },
  { family: 'DM Serif Display',   label: 'DM Serif Display',   category: 'serif',      bundled: true },
  { family: 'Lora',               label: 'Lora',               category: 'serif',      bundled: true },
  { family: 'Marcellus',          label: 'Marcellus',          category: 'serif',      bundled: true },
  { family: 'Rakkas',             label: 'Rakkas',             category: 'display',    bundled: true },
  { family: 'Atma',               label: 'Atma',               category: 'display',    bundled: true },
  { family: 'Dancing Script',     label: 'Dancing Script',     category: 'display',    bundled: true },
  { family: 'DynaPuff',           label: 'DynaPuff',           category: 'display',    bundled: true },
  { family: 'Playpen Sans',       label: 'Playpen Sans',       category: 'display',    bundled: true },

  // ── System sans-serif ───────────────────────────────────────────────────────
  { family: 'Arial, sans-serif',                                   label: 'Arial',           category: 'sans-serif' },
  { family: '"Helvetica Neue", Helvetica, Arial, sans-serif',      label: 'Helvetica',       category: 'sans-serif' },
  { family: 'Verdana, Geneva, sans-serif',                         label: 'Verdana',         category: 'sans-serif' },
  { family: 'Tahoma, Geneva, sans-serif',                          label: 'Tahoma',          category: 'sans-serif' },
  { family: '"Trebuchet MS", Helvetica, sans-serif',              label: 'Trebuchet MS',    category: 'sans-serif' },
  { family: '"Segoe UI", Tahoma, sans-serif',                     label: 'Segoe UI',        category: 'sans-serif' },
  { family: 'Calibri, "Segoe UI", sans-serif',                    label: 'Calibri',         category: 'sans-serif' },
  { family: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif',  label: 'Gill Sans',       category: 'sans-serif' },
  { family: 'Futura, "Trebuchet MS", sans-serif',                label: 'Futura',          category: 'sans-serif' },
  { family: 'Avenir, "Avenir Next", Montserrat, sans-serif',     label: 'Avenir',          category: 'sans-serif' },
  { family: '"Franklin Gothic Medium", "Arial Narrow", sans-serif', label: 'Franklin Gothic', category: 'sans-serif' },
  { family: '"Century Gothic", "Apple Gothic", sans-serif',      label: 'Century Gothic',  category: 'sans-serif' },

  // ── System serif ────────────────────────────────────────────────────────────
  { family: 'Georgia, "Times New Roman", serif',                 label: 'Georgia',         category: 'serif' },
  { family: '"Times New Roman", Times, serif',                   label: 'Times New Roman', category: 'serif' },
  { family: '"Palatino Linotype", Palatino, "Book Antiqua", serif', label: 'Palatino',     category: 'serif' },
  { family: 'Garamond, "EB Garamond", serif',                    label: 'Garamond',        category: 'serif' },
  { family: 'Cambria, Georgia, serif',                           label: 'Cambria',         category: 'serif' },
  { family: 'Baskerville, "Baskerville Old Face", serif',        label: 'Baskerville',     category: 'serif' },
  { family: 'Didot, "Bodoni MT", "Playfair Display", serif',    label: 'Didot',           category: 'serif' },

  // ── Display / monospace ─────────────────────────────────────────────────────
  { family: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif', label: 'Impact',  category: 'display' },
  { family: '"Comic Sans MS", "Comic Sans", cursive',           label: 'Comic Sans',      category: 'display' },
  { family: '"Courier New", Courier, monospace',                label: 'Courier New',     category: 'monospace' },
  { family: '"Lucida Console", Monaco, monospace',              label: 'Lucida Console',  category: 'monospace' },
];

export const DEFAULT_FONT = 'Inter';
