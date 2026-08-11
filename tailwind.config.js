/**
 * Doggie Retreat brand tokens (Brand Guidelines v1.0, August 2026).
 *
 * The existing scale NAMES are kept — `brand-*`, `ink-*`, `signal-*` — and
 * their values remapped to the brand palette. That rebrands every screen from
 * one file instead of rewriting class names across a dozen components.
 *
 *   brand-*  -> Primary Pink #EC4899 and its tints
 *   ink-*    -> Charcoal #1F2937 / Gray #6B7280 / soft pink borders
 *   signal-* -> semantic status, kept visually secondary to pink
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutrals. 100–300 carry the soft-pink border tones the guidelines
        // specify for cards and dividers, so borders read warm, not grey.
        ink: {
          50: "#FFF5F8",  // Background Pink — page background
          100: "#F3F4F6", // Light Gray — segmented controls, table dividers
          200: "#F3D6E2", // Soft pink card border
          300: "#E7D3DB", // Input border
          // Metadata tone. Darkened from the usual #9CA3AF, which measures
          // only 2.5:1 on white and fails WCAG AA; this is 4.5:1. Hierarchy
          // comes from size and weight rather than from unreadable grey.
          400: "#6E7787",
          500: "#6B7280", // Gray — secondary text
          600: "#6B7280", // Gray
          700: "#374151",
          800: "#1F2937", // Charcoal
          900: "#1F2937", // Charcoal — primary text
          950: "#111827",
        },
        brand: {
          50: "#FFF5F8",  // Background Pink
          100: "#FDEBF0", // Soft Pink — active nav, selected states
          200: "#FBD9E6",
          300: "#F6C6DA", // Alert border
          400: "#F472B6",
          500: "#EC4899", // Primary Pink
          600: "#EC4899", // Primary Pink — buttons, active icons
          700: "#DB2777", // Hover
          800: "#BE185D",
          900: "#9D174D",
        },
        signal: {
          green: "#059669",
          greenSoft: "#E7F6F0",
          amber: "#D99A00",
          amberSoft: "#FDF3DC",
          red: "#DC2626",
          redSoft: "#FCE8E8",
          info: "#2563EB",
          infoSoft: "#E8EFFD",
        },
        // Pale-pink informational surface, used instead of a loud amber banner
        // when a message is informational rather than dangerous.
        // Keys avoid the name "text" — `text-notice-text` collides with
        // Tailwind's own text- prefix and fails to resolve under @apply.
        notice: {
          surface: "#FFF5F8",
          edge: "#F6C6DA",
          ink: "#6B4A58",
        },
      },
      fontFamily: {
        // Inter for all functional UI; Playfair reserved for brand moments.
        sans: ['"Inter Variable"', "Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ['"Playfair Display"', "Georgia", "serif"],
        mono: ['"Cascadia Mono"', "ui-monospace", "Consolas", "SF Mono", "Menlo", "monospace"],
      },
      // Soft, rounded geometry per the brand shape language.
      borderRadius: {
        none: "0",
        sm: "8px",
        DEFAULT: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        "2xl": "40px",
        full: "9999px",
      },
      boxShadow: {
        // Subtle framing rather than heavy shadows.
        sm: "0 1px 2px rgba(31, 41, 55, 0.05)",
        DEFAULT: "0 1px 3px rgba(31, 41, 55, 0.07)",
        lg: "0 8px 24px rgba(236, 72, 153, 0.12)",
      },
    },
  },
  plugins: [],
};
