/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        teal: {
          DEFAULT: '#0D9488',
          50: '#E6F5F3',
          100: '#CCEBE7',
          500: '#0D9488',
          600: '#0B7A70',
          700: '#085F57',
        },
        navy: {
          DEFAULT: '#0A1628',
          light: '#1a2a4a',
        },
        gold: { DEFAULT: '#C8A028' },
        brand: {
          success: '#15803D',
          warning: '#B45309',
          error: '#991B1B',
          admin: '#4B3B8C',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: { card: '12px' },
      boxShadow: { card: '0 2px 8px rgba(0,0,0,0.08)' },
      minHeight: { touch: '44px' },
      height: { touch: '48px', 'touch-lg': '52px' },
    },
  },
  plugins: [],
};
