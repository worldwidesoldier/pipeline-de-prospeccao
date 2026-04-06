/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#0f1117',
        surface:  '#1a1d27',
        surface2: '#22263a',
        brd:      '#2e3248',
        muted:    '#8892a4',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

