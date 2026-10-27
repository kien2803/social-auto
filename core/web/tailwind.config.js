/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Warm paper surfaces; dark = warm charcoal (not pitch black).
        surface: {
          DEFAULT: '#faf9f6',
          muted: '#f4f1ec',
          subtle: '#eae6de',
          inset: '#e2ded5',
        },
        ink: {
          DEFAULT: '#1b1814',
          muted: '#5d564d',
          subtle: '#a39a8d',
        },
        // Vermilion — replaces the indigo default.
        brand: {
          50: '#fdf1ea',
          100: '#fad9c7',
          500: '#e04e14',
          600: '#c93f0b',
          700: '#a53207',
        },
        success: { 500: '#15803d', 700: '#14532d' },
        warn: { 500: '#b45309', 700: '#92400e' },
        danger: { 500: '#dc2626', 700: '#991b1b' },
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '5px',
        md: '6px',
        lg: '8px',
        xl: '10px',
      },
      boxShadow: {
        soft: 'none',
        lift: '0 1px 0 rgba(27,24,20,0.06)',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
