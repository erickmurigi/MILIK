/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
       animation: {
        'float': 'float 3s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'fade-in': {
          'from': { opacity: '0', transform: 'translateY(10px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      colors: {
        // The real, in-use brand palette — anchored on the two colors every page already
        // hardcodes (#0B3B2E primary green, #FF8C00 accent orange, plus their established
        // hover shades). The old "brand" scale here didn't match either and had zero usage
        // across the app; this one exists so future work has a correct token to reach for
        // instead of retyping the hex. See src/components/common/ListToolbar.jsx for the
        // shared toolbar primitives that already encode these same colors.
        brand: {
          50: '#EBF5EF',
          100: '#C8E6D4',
          200: '#8ACF9D',
          300: '#55B672',
          400: '#359E55',
          500: '#1A7A44',
          600: '#0F5E36',
          700: '#0C4D2E',
          800: '#0B3B2E', // primary — matches the app's bg-[#0B3B2E]
          900: '#0A3127', // hover — matches the app's hover:bg-[#0A3127]
          DEFAULT: '#0B3B2E',
        },
        accent: {
          50: '#FFF4E5',
          100: '#FFE0B3',
          200: '#FFC966',
          300: '#FFB020',
          400: '#FF9D00',
          500: '#FF8C00', // primary — matches the app's bg-[#FF8C00]
          600: '#E67E00', // hover — matches the app's hover:bg-[#e67e00]
          700: '#CC7000',
          800: '#B36200',
          900: '#8A4C00',
          DEFAULT: '#FF8C00',
        },
      },
      fontFamily: {
        sans: ['Nunito Sans', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}