/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#dde4ff',
          200: '#bccaff',
          300: '#94a8ff',
          400: '#6b81ff',
          500: '#475ef0',
          600: '#3447d8',
          700: '#2937ad',
          800: '#22308a',
          900: '#1f2c6e',
        },
      },
    },
  },
  plugins: [],
};
