export const COLORS = {
  // Surfaces (3 levels)
  bg: "#0f0f1a",      // L0 — screen background
  card: "#1a1a2e",    // L1 — cards
  cardAlt: "#222240", // L2 — elevated elements / inputs inside cards

  // Text
  text: "#eeeef6",
  muted: "#9090b0",
  border: "#2e2e4a",

  // Accent (single)
  accent: "#7c6cf0",
  accentLight: "#b0a4ff",

  // Semantic
  success: "#2ed8a3",  // free, chill, available
  warm: "#ffb347",     // price, soon
  hot: "#ff6b6b",      // saved, packed, urgent

  pink: "#ff6b9d",
  overlay: "rgba(15, 15, 26, 0.85)",
};

export const GRADIENTS = {
  accent: ["#7c6cf0", "#b06cf0"] as const,
  card: ["transparent", "rgba(15, 15, 26, 0.95)"] as const,
  hero: ["transparent", "rgba(15, 15, 26, 0.7)", "rgba(15, 15, 26, 0.98)"] as const,
};

export const RADIUS = {
  sm: 10,     // chips inside cards
  md: 16,     // cards
  lg: 24,     // hero / sheets
  pill: 999,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const SHADOWS = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 6,
  },
  tabBar: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 12,
  },
} as const;

export const OPACITY = {
  disabled: 0.4,
  pressed: 0.75,
  overlay: 0.9,
  borderSubtle: "1F", // ~12%
  borderEmphasis: "55",
} as const;

export const SHEET_HEIGHT = "85%" as const;

export const BOCA_RATON = {
  lat: 26.3587,
  lng: -80.0831,
};

export const DEFAULT_RADIUS_MILES = 5;
