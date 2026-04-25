import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0b0d10",
          raised: "#12151a",
          sunken: "#080a0d",
          panel: "#10141a",
        },
        line: "#1f242c",
        ink: {
          DEFAULT: "#e7ecf3",
          dim: "#9aa4b2",
          faint: "#626b78",
        },
        accent: { DEFAULT: "#7c5cff", soft: "#2a2250" },
        danger: "#ff5c6c",
        good: "#22c55e",
        warn: "#f59e0b",
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow:
          "0 0 0 1px rgba(124,92,255,0.35), 0 8px 40px -8px rgba(124,92,255,0.35)",
      },
      animation: {
        "pulse-rec": "pulseRec 1.4s ease-in-out infinite",
        "fade-in": "fadeIn 0.25s ease-out",
        "slide-down": "slideDown 0.35s cubic-bezier(0.2,0.8,0.2,1)",
      },
      keyframes: {
        pulseRec: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(255,92,108,0.6)" },
          "50%": { boxShadow: "0 0 0 10px rgba(255,92,108,0)" },
        },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideDown: {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
