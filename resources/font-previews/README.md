# Font previews

Tiny per-font subset woff2 files (`<catalog-id>.woff2`) that let the font picker render
each downloadable family in its own typeface *before* the full font is downloaded.

Generate them with:

    pip install fonttools brotli
    node scripts/gen-font-previews.mjs

The picker loads whatever is present here (via `db/fonts.js buildPreviewFontCss`); with the
folder empty it falls back to a same-class system face. Regenerate after editing
`src/main/fonts-catalog.js`.
