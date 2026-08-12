/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Triton navy — primary brand scale
        navy: {
          50: "#F4F7FB",
          100: "#E7EDF5",
          200: "#C9D6E8",
          300: "#9AB2D0",
          400: "#5F82AC",
          500: "#33587F",
          600: "#1F3D61",
          700: "#182B49",
          800: "#12213A",
          900: "#0C1626",
        },
        // Triton gold — accent, used sparingly
        gold: {
          300: "#FFE07A",
          400: "#FFCD00",
          500: "#C69214",
          600: "#9C7410",
        },
      },
      fontFamily: {
        serif: [
          "ui-serif",
          "Charter",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "serif",
        ],
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(16 24 40 / 0.05)",
        panel: "0 1px 3px 0 rgb(16 24 40 / 0.06), 0 1px 2px -1px rgb(16 24 40 / 0.06)",
      },
    },
  },
  plugins: [],
}
