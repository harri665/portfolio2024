/** @type {import('tailwindcss').Config} */

// Tailwind's default opacity scale only has steps of 5, so modifiers like
// `border-white/12` or `text-white/68` silently generate nothing. Allow every
// whole percentage; JIT still only emits the classes actually used.
const opacity = Object.fromEntries(
  Array.from({ length: 101 }, (_, i) => [String(i), String(i / 100)])
);

// The site's colours live in src/theme/tokens.css as bare channels, so
// `bg-surface/80` or `text-accent/60` work like any other Tailwind colour.
const rgbToken = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      opacity,
      colors: {
        bg: rgbToken('bg'),
        surface: rgbToken('surface'),
        'surface-2': rgbToken('surface-2'),
        line: rgbToken('line'),
        ink: rgbToken('ink'),
        'ink-2': rgbToken('ink-2'),
        'ink-3': rgbToken('ink-3'),
        accent: 'oklch(var(--accent) / <alpha-value>)',
        'on-accent': rgbToken('on-accent'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      // Named for what they round, so they don't shadow Tailwind's own sizes
      borderRadius: {
        chip: 'var(--radius-sm)',
        field: 'var(--radius-md)',
        card: 'var(--radius-lg)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease)',
      },
    },
  },
  plugins: [],
}
