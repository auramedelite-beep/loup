const path = require('node:path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [path.resolve(__dirname, 'index.html'), path.resolve(__dirname, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07070b',
          900: '#0b0b12',
          850: '#101018',
          800: '#15151f',
          700: '#1d1d2a',
          600: '#29293a',
        },
        blood: {
          900: '#3d0710',
          800: '#5a0a16',
          700: '#7a0d1d',
          600: '#9b1226',
          500: '#bf1a31',
          400: '#e23b50',
        },
        gold: {
          700: '#8a6a1f',
          600: '#b18a2c',
          500: '#d4af37',
          400: '#e8c96a',
          300: '#f3e0a0',
        },
        parchment: {
          100: '#f7f0df',
          200: '#e9dfc7',
          300: '#d3c5a5',
          400: '#b3a37e',
        },
        mist: '#9aa0b4',
        night: '#0d1020',
      },
      fontFamily: {
        display: ['Cinzel', 'Georgia', 'Times New Roman', 'serif'],
        body: ['Inter', 'Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'],
        arabic: ['Tajawal', 'Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 30px rgba(212, 175, 55, 0.18)',
        blood: '0 0 32px rgba(191, 26, 49, 0.22)',
        card: '0 18px 50px -22px rgba(0, 0, 0, 0.9)',
        inset: 'inset 0 1px 0 rgba(255,255,255,0.05)',
      },
      backgroundImage: {
        'radial-night': 'radial-gradient(circle at 50% 0%, #1b1b2b 0%, #0b0b12 55%, #07070b 100%)',
        'radial-blood': 'radial-gradient(circle at 50% 10%, rgba(122,13,29,0.35) 0%, transparent 60%)',
        'gold-line': 'linear-gradient(90deg, transparent, rgba(212,175,55,0.6), transparent)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'spin-slow': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s ease-out both',
        'fade-in': 'fade-in 0.4s ease-out both',
        'pulse-slow': 'pulse-slow 3.5s ease-in-out infinite',
        'float-slow': 'float-slow 6s ease-in-out infinite',
        'spin-slow': 'spin-slow 26s linear infinite',
        shimmer: 'shimmer 2.4s linear infinite',
      },
    },
  },
  plugins: [],
};
