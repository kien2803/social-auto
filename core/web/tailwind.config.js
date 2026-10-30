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
          200: '#f6b89d',
          300: '#f08b62',
          400: '#e96a38',
          500: '#e04e14',
          600: '#c93f0b',
          700: '#a53207',
          800: '#7e2708',
          900: '#5d1f0a',
          950: '#401506',
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
        soft: '0 1px 1px rgba(60,45,30,0.04), 0 2px 8px -2px rgba(60,45,30,0.08)',
        lift: '0 1px 1px rgba(60,45,30,0.05), 0 8px 24px -8px rgba(60,45,30,0.14)',
        press: 'inset 0 -2px 0 rgba(0,0,0,0.14), 0 1px 1px rgba(60,45,30,0.08)',
        inlay: 'inset 0 1px 0 rgba(255,255,255,0.7)',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'hero-in': {
          from: { opacity: '0', transform: 'translateY(14px) scale(0.985)', filter: 'blur(3px)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
        },
        sweep: {
          '0%': { left: '-4%' },
          '50%': { left: '104%' },
          '100%': { left: '-4%' },
        },
        'wave-drift': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        'wave-bob': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-7px)' },
        },
        ring: {
          '0%': { transform: 'scale(0.15)', opacity: '0.55' },
          '100%': { transform: 'scale(1)', opacity: '0' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.4)', opacity: '0.55' },
        },
        'sig-bar': {
          '0%': { width: '0%', opacity: '1', animationTimingFunction: 'cubic-bezier(0.25, 0.8, 0.35, 1)' },
          '22%': { width: '100%', animationTimingFunction: 'ease' },
          '90%': { width: '100%', opacity: '1' },
          '97%': { width: '100%', opacity: '0' },
          '100%': { width: '0%', opacity: '0' },
        },
        'sig-pop': {
          '0%, 20%': { opacity: '0.3', transform: 'scale(0.92)' },
          '28%': { opacity: '1', transform: 'scale(1.12)', animationTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
          '38%': { transform: 'scale(1)' },
          '90%': { opacity: '1' },
          '100%': { opacity: '0.3', transform: 'scale(0.95)' },
        },
        'node-pop': {
          '0%, 82%': { opacity: '0.45', transform: 'scale(0.94)' },
          '92%': { opacity: '1', transform: 'scale(1.1)' },
          '100%': { opacity: '0.45', transform: 'scale(0.94)' },
        },
        'done-pop': {
          '0%, 24%': { opacity: '0' },
          '30%': { opacity: '1' },
          '88%': { opacity: '1' },
          '95%, 100%': { opacity: '0' },
        },
        eq: {
          '0%, 100%': { transform: 'scaleY(0.25)' },
          '50%': { transform: 'scaleY(1)' },
        },
        blink: {
          '0%, 55%': { opacity: '1' },
          '56%, 100%': { opacity: '0.15' },
        },
      },
      animation: {
        'hero-in': 'hero-in 0.85s cubic-bezier(0.22, 1, 0.36, 1) both',
        sweep: 'sweep 13s ease-in-out infinite',
        'wave-a': 'wave-drift 20s linear infinite',
        'wave-b': 'wave-drift 34s linear infinite',
        'bob-a': 'wave-bob 7s ease-in-out infinite',
        'bob-b': 'wave-bob 11s ease-in-out infinite',
        ring: 'ring 4.2s ease-out infinite',
        breathe: 'breathe 3.2s ease-in-out infinite',
        'sig-bar': 'sig-bar 9s linear both infinite',
        'sig-pop': 'sig-pop 9s linear both infinite',
        'node-pop': 'node-pop 2.6s linear both infinite',
        'done-pop': 'done-pop 9s linear both infinite',
        eq: 'eq 1.15s ease-in-out infinite',
        blink: 'blink 1.4s steps(1) infinite',
      },
    },
  },
  plugins: [],
};
