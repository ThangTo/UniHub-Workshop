/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9eaff',
          200: '#b6d6ff',
          300: '#85b8ff',
          400: '#4c91ff',
          500: '#2670ff',
          600: '#1455e6',
          700: '#1043b3',
          800: '#10398f',
          900: '#11326f',
        },
      },
    },
  },
  plugins: [],
};
