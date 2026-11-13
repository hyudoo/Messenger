/** @type {import('tailwindcss').Config} */

// Theme colors are CSS variables (app/globals.css: light in :root, dark in .dark),
// like the portfolio's tokens. Use these instead of raw grays so both themes work:
// bg-background / bg-muted, text-foreground / text-muted-foreground, border-border,
// ring-input. Brand colors (sky, rose, green...) stay as they are.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        muted: token("muted"),
        "muted-foreground": token("muted-foreground"),
        border: token("border"),
        input: token("input"),
      },
      // plain `border` / `border-t` / `divide-*` use the theme border color
      borderColor: { DEFAULT: token("border") },
    },
  },
  plugins: [
    require("@tailwindcss/forms")({
      strategy: "class",
    }),
  ],
};
