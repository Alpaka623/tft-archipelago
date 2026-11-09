/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Austrian Force for UNICEF: red/black/white, yellow accents, UNICEF cyan
      colors: {
        af: {
          red: '#C42525',
          ink: '#111111',
          yellow: '#FFE14D',
          cyan: '#1CABE2',
          track: '#303030',
        },
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'Impact', 'sans-serif'],
        body: ['Poppins', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
