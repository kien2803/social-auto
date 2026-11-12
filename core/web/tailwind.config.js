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
        // One type family across the product: headings use Plex Sans at
        // heavier weights instead of a second typeface.
        display: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
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
        // Broadcast scene — a 15s storyboard; each beat owns the whole
        // stage alone (scenes are inset-0 layers gated by opacity):
        //   s1 0–33%   cursor drags the clip into the dropzone, clicks transmit
        //   s3 33–50%  lines ignite, sparks travel to the platform chips
        //   s4 50–68%  one card cycles all four platform skins, same video
        //   s5 68–96%  the card splits into four platform cards
        //   s6 93–100% the Omnicast logo fades up to sign off.
        'bc-s1': {
          '0%, 32%': { opacity: '1', transform: 'scale(1)' },
          '35%, 100%': { opacity: '0', transform: 'scale(0.97)' },
        },
        'bc-s3': {
          '0%, 33%': { opacity: '0', transform: 'scale(0.97)' },
          '38%, 46%': { opacity: '1', transform: 'scale(1)' },
          '50%, 100%': { opacity: '0', transform: 'scale(0.97)' },
        },
        'bc-s4': {
          '0%, 49%': { opacity: '0', transform: 'scale(0.97)' },
          '54%, 64%': { opacity: '1', transform: 'scale(1)' },
          '68%, 100%': { opacity: '0', transform: 'scale(0.97)' },
        },
        'bc-s5': {
          '0%, 68%': { opacity: '0', transform: 'scale(0.97)' },
          '73%, 92%': { opacity: '1', transform: 'scale(1)' },
          '96%, 100%': { opacity: '0', transform: 'scale(0.97)' },
        },
        'bc-s6': {
          '0%, 93%': { opacity: '0', transform: 'scale(0.96)' },
          '97%, 99%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(0.96)' },
        },
        // s1 — cursor: the tip rides just below each element's bottom edge
        // so the arrow never covers the card, dropzone or button.
        'bc-cursor': {
          '0%': { opacity: '0', left: '12%', top: '72%', transform: 'scale(1)' },
          '4%': { opacity: '1' },
          '7%': { left: '18%', top: '66%' },
          '15%': { left: '50%', top: '48%' },
          '17.5%': { transform: 'scale(0.78)' },
          '20%': { transform: 'scale(1)' },
          '26%': { left: '44%', top: '67%' },
          '30%': { transform: 'scale(0.76)' },
          '33%': { transform: 'scale(1)', opacity: '1' },
          '35%, 100%': { opacity: '0', left: '44%', top: '67%' },
        },
        // s1 — dashed reticle tracking the dragged file.
        'bc-track': {
          '0%, 4%': { left: '18%', top: '60%', opacity: '0', transform: 'translate(-50%,-50%) scale(1.15)' },
          '7%': { opacity: '1' },
          '15%': { left: '50%', top: '38%', opacity: '1' },
          '19%, 100%': { left: '50%', top: '38%', opacity: '0', transform: 'translate(-50%,-50%) scale(0.3)' },
        },
        // s1 — the file card riding the cursor, swallowed by the dropzone.
        'bc-clip': {
          '0%, 6%': { left: '18%', top: '60%', transform: 'translate(-50%,-50%) rotate(-5deg) scale(1)', opacity: '1' },
          '15%': { left: '50%', top: '38%', transform: 'translate(-50%,-50%) rotate(3deg) scale(1)', opacity: '1' },
          '19%': { transform: 'translate(-50%,-50%) rotate(0deg) scale(0.12)', opacity: '0' },
          '20%, 100%': { left: '50%', top: '38%', opacity: '0' },
        },
        // s1 — dropzone pulses on swallow and on the confirm click.
        'bc-dz': {
          '0%, 16%': { transform: 'translate(-50%,-50%) scale(1)' },
          '19.5%': { transform: 'translate(-50%,-50%) scale(1.06)' },
          '23%': { transform: 'translate(-50%,-50%) scale(1)' },
          '30%': { transform: 'translate(-50%,-50%) scale(0.95)' },
          '33%, 100%': { transform: 'translate(-50%,-50%) scale(1)' },
        },
        // s1 — confirm pill: appears after the drop, pressed at ~4.4s.
        'bc-btn': {
          '0%, 20%': { opacity: '0', transform: 'translate(-50%,-50%) scale(0.7)' },
          '23%': { opacity: '1', transform: 'translate(-50%,-50%) scale(1)' },
          '29%, 30.5%': { transform: 'translate(-50%,-50%) scale(0.86)' },
          '33%': { opacity: '1', transform: 'translate(-50%,-50%) scale(1)' },
          '35%, 100%': { opacity: '0' },
        },
        // s3 — pathLength=100 → dashoffset 100→0 draws the conductor.
        'bc-line': {
          '0%, 33%': { strokeDashoffset: '100', opacity: '0' },
          '36%': { opacity: '1' },
          '45%': { strokeDashoffset: '0', opacity: '1' },
          '49%, 100%': { strokeDashoffset: '0', opacity: '0' },
        },
        // s3 — a short bright segment (dash 4/96) travelling the line.
        'bc-spark': {
          '0%, 41%': { strokeDashoffset: '100', opacity: '0' },
          '43%': { opacity: '1' },
          '50%': { strokeDashoffset: '0', opacity: '1' },
          '52%, 100%': { strokeDashoffset: '0', opacity: '0' },
        },
        // s3 — endpoint chips light up as the lines land.
        'bc-recv': {
          '0%, 44%': { opacity: '0.45', transform: 'translate(-50%,-50%) scale(0.85)' },
          '50%, 100%': { opacity: '1', transform: 'translate(-50%,-50%) scale(1)' },
        },
        // s4 — each platform skin owns a ~0.65s slice (staggered delay).
        'bc-skin': {
          '0%, 49%': { opacity: '0' },
          '50%, 54%': { opacity: '1' },
          '55%, 100%': { opacity: '0' },
        },
        // s5 — the card splits into four, flying to a row (--fx/--fy per element).
        'bc-copy': {
          '0%, 67%': { left: '50%', top: '48%', opacity: '0', transform: 'translate(-50%,-50%) scale(1)' },
          '71%': { opacity: '1' },
          '87%, 100%': { left: 'var(--fx)', top: 'var(--fy)', opacity: '1', transform: 'translate(-50%,-50%) scale(0.85)' },
        },
        'bc-check': {
          '0%, 87%': { opacity: '0', transform: 'scale(0.4)' },
          '91%': { opacity: '1', transform: 'scale(1.15)' },
          '95%, 100%': { opacity: '1', transform: 'scale(1)' },
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
        'bc-s1': 'bc-s1 15s linear infinite',
        'bc-s3': 'bc-s3 15s linear infinite',
        'bc-s4': 'bc-s4 15s linear infinite',
        'bc-s5': 'bc-s5 15s linear infinite',
        'bc-s6': 'bc-s6 15s linear infinite',
        'bc-cursor': 'bc-cursor 15s linear infinite',
        'bc-track': 'bc-track 15s linear infinite',
        'bc-clip': 'bc-clip 15s linear infinite',
        'bc-dz': 'bc-dz 15s linear infinite',
        'bc-btn': 'bc-btn 15s linear infinite',
        'bc-line': 'bc-line 15s linear infinite',
        'bc-spark': 'bc-spark 15s linear infinite',
        'bc-recv': 'bc-recv 15s linear infinite',
        'bc-skin': 'bc-skin 15s linear infinite',
        'bc-copy': 'bc-copy 15s linear infinite',
        'bc-check': 'bc-check 15s linear infinite',
      },
    },
  },
  plugins: [],
};
