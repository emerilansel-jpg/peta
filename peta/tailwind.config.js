/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    colors: {
      primary: '#FF6B6B',
      secondary: '#4ECDC4',
      dark: '#2D3436',
      light: '#F5F5F5',
      white: '#FFFFFF',
      gray: {
        200: '#E9ECEF',
        300: '#DEE2E6',
        400: '#CED4DA',
        500: '#ADB5BD',
        600: '#6C757D',
        700: '#495057',
      },
      green: {
        300: '#86EFB1',
        500: '#4ECDC4',
        600: '#16A34A',
      },
      red: {
        300: '#FCA5A5',
        500: '#EF4444',
        600: '#DC2626',
      },
      yellow: {
        300: '#FCD34D',
        500: '#EAB308',
        800: '#854D0E',
      },
      blue: {
        50: '#EFF6FF',
        300: '#93C5FD',
        600: '#2563EB',
      },
      purple: {
        50: '#FAF5FF',
        300: '#D8B4FE',
        600: '#9333EA',
        700: '#7E22CE',
      },
      teal: {
        500: '#14B8A6',
      },
    },
  },
  plugins: [],
}
