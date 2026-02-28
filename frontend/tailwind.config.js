/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: {
          50:  "#F0EEF8",
          100: "#D8D4F0",
          200: "#A89FDB",
          300: "#7A6DC4",
          400: "#5A50AA",
          500: "#3D348B",
          600: "#2D266B",
          700: "#1E1A4A",
          800: "#120F2E",
          900: "#0A0A0F",
        },
        cream: "#F8F6F0",
        amber: "#F5A623",
        rose:  "#E85D75",
      },
      fontFamily: {
        display: ["Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
