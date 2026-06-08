/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/renderer/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // OLED-optimised broadcast palette — deep black with subtle blue-grey undertone
        slate: {
          50:  '#EAECF2',
          100: '#D8DCE8',
          200: '#B4BAC9',
          300: '#8890A4',
          400: '#5E657A',
          500: '#3E4354',
          600: '#272B3A',
          700: '#1A1D28',
          800: '#10121C',
          900: '#080A12',
          950: '#030408',
        },
        // Steel blue — broadcast monitor accent (not SaaS indigo)
        indigo: {
          50:  '#E5EEFA',
          100: '#C8DAF4',
          200: '#94B6E8',
          300: '#5F92DC',
          400: '#3A75CC',
          500: '#1E5DBE',
          600: '#1550A8',
          700: '#113F88',
          800: '#0C2E66',
          900: '#071E44',
        },
        // Signal colours — broadcast tally standard
        live:    { DEFAULT: '#EF4444', dim: '#1A0606' },
        preview: { DEFAULT: '#F59E0B', dim: '#180E00' },
      },
    },
  },
  plugins: [],
};
