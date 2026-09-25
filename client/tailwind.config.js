/** @type {import('tailwindcss').Config} */

// Tailwind's default opacity scale only has steps of 5, so modifiers like
// `border-white/12` or `text-white/68` silently generate nothing. Allow every
// whole percentage; JIT still only emits the classes actually used.
const opacity = Object.fromEntries(
  Array.from({ length: 101 }, (_, i) => [String(i), String(i / 100)])
);

module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      opacity,
    },
  },
  plugins: [],
}
