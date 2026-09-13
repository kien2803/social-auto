/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Semantic surface tokens — light defaults, overridden under .dark.
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f8fafc', // slate-50
          subtle: '#f1f5f9', // slate-100
          inset: '#eef2f7',
        },
        ink: {
          DEFAULT: '#0f172a', // slate-900
          muted: '#475569', // slate-600
          subtle: '#94a3b8', // slate-400
        },
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        success: { 500: '#10b981', 700: '#047857' },
        warn: { 500: '#f59e0b', 700: '#b45309' },
        danger: { 500: '#ef4444', 700: '#b91c1c' },
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)',
        lift: '0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.06)',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Inter',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};