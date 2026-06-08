// Bundled font library — all fonts ship inside the app bundle (src/fonts/).
// The `family` string matches the CSS font-family name declared in fonts.css.
// The text editor and font picker import this list.

export const BUNDLED_FONTS = [
  { family: 'Inter',           label: 'Inter',            category: 'sans-serif' },
  { family: 'Montserrat',      label: 'Montserrat',       category: 'sans-serif' },
  { family: 'Lato',            label: 'Lato',             category: 'sans-serif' },
  { family: 'Oswald',          label: 'Oswald',           category: 'sans-serif' },
  { family: 'Playfair Display',label: 'Playfair Display', category: 'serif'      },
  { family: 'EB Garamond',     label: 'EB Garamond',      category: 'serif'      },
];

export const DEFAULT_FONT = 'Inter';
