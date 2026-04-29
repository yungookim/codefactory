module.exports = {
  content: [
    "./docs/index.html",
    "./docs/public/_site/**/*.html",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          300: "#bfdbfe",
          400: "#93c5fd",
          500: "#60a5fa",
          600: "#2563eb",
          700: "#1d4ed8",
        },
        dark: {
          900: "#0f1115",
          800: "#1e2128",
          700: "#2c313c",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
    },
  },
  plugins: [],
};
