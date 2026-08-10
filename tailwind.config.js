/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#F4F6F5",
          100: "#E7EBE9",
          200: "#D2D9D5",
          300: "#AFBBB5",
          400: "#7E8F87",
          500: "#5C6E66",
          600: "#465650",
          700: "#394640",
          800: "#2B3531",
          900: "#1B2320",
          950: "#0E1614",
        },
        brand: {
          50: "#EAF5F3",
          100: "#D0EAE6",
          200: "#A3D6CE",
          300: "#6FBBB0",
          400: "#3E9C90",
          500: "#1F7F73",
          600: "#146A60",
          700: "#10554D",
          800: "#0D423C",
          900: "#0A3531",
        },
        signal: {
          green: "#2E7D4F",
          greenSoft: "#E1F0E7",
          amber: "#A8730A",
          amberSoft: "#F8EED6",
          red: "#B33A30",
          redSoft: "#F8E1DE",
        },
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', "system-ui", "-apple-system", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ['"Cascadia Mono"', '"Cascadia Code"', "ui-monospace", "Consolas", '"SF Mono"', "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
