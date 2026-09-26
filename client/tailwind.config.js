/** @type {import('tailwindcss').Config} */

// default opacity scale only has steps of 5 so border-white/12 etc silently did nothing
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
