import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      colors: {
        "otc-bg": "#12041f",
        "otc-bg-soft": "#1e1030",
        "otc-accent": "#ffb347",
        "otc-accent-strong": "#ff5fa2",
        "otc-accent-alt": "#5cf2ff",
        "otc-surface": "#241235",
        "otc-text": "#fef7ff",
        "otc-muted": "#c2b3d9",
      },
      boxShadow: {
        "otc-card": "0 18px 40px rgba(0,0,0,0.65)",
        "otc-glow": "0 0 35px rgba(255,95,162,0.6)",
      },
      backgroundImage: {
        "otc-radial":
          "radial-gradient(circle at top, rgba(255,191,105,0.28), transparent 55%), radial-gradient(circle at bottom, rgba(92,242,255,0.24), transparent 55%)",
      },
    },
  },
  plugins: [],
};

export default config;
