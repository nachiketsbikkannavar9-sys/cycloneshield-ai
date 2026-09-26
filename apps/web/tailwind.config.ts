export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Mirrors the token layer in src/styles/index.css. Severity colours are
        // intentionally absent: those come from lib/risk-colors.ts.
        surface: {
          app: "var(--surface-app)",
          sunken: "var(--surface-sunken)",
          card: "var(--surface-card)",
          raised: "var(--surface-raised)",
          inset: "var(--surface-inset)"
        },
        hairline: {
          DEFAULT: "var(--hairline)",
          strong: "var(--hairline-strong)"
        },
        ink: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          faint: "var(--text-faint)"
        },
        accent: {
          DEFAULT: "var(--accent)",
          strong: "var(--accent-strong)",
          quiet: "var(--accent-quiet)"
        },
        ocean: {
          50: "#effbff",
          100: "#dff6ff",
          500: "#0ea5e9",
          700: "#0369a1",
          900: "#0c4a6e"
        }
      },
      borderRadius: {
        card: "var(--radius-card)",
        panel: "var(--radius-panel)"
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        lift: "var(--shadow-lift)"
      },
      fontSize: {
        // A slightly more confident display step for the hero headline.
        display: ["clamp(2.1rem, 1.35rem + 3.1vw, 4rem)", { lineHeight: "1.04", letterSpacing: "-0.035em" }]
      },
      transitionTimingFunction: {
        calm: "cubic-bezier(0.22, 0.61, 0.36, 1)"
      }
    }
  },
  plugins: []
};
