/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'IBM Plex Sans'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      colors: {
        background: "#0f0f0f",
        surface: "#1a1a1a",
        border: "#2a2a2a",
        muted: "#6b6b6b",
        accent: "#e2e8f0",
        destructive: "#ef4444",
        success: "#22c55e",
      },
      borderRadius: {
        DEFAULT: "6px",
      },
    },
  },
  plugins: [],
};
